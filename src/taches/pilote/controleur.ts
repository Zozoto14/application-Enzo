/**
 * Pilote de semaine : état de l'écran « Ta semaine » (brouillon, validation,
 * réglages), conservé dans la base de CET appareil (`taches.pilote`, jamais
 * synchronisé : aucune écriture sur le relais). La seule écriture qui compte
 * est la validation : une modification des données de Tâches, donc un seul
 * dépôt par la synchronisation existante.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContexteHub } from '../../hub/types';
import { lireReglagesPilote, type BilanJour, type ReglagesPilote, type Semaine } from '../../hub/pilote/contrats';
import {
  bilanJours,
  decalerElement,
  deplacerElement,
  etatRecompenses,
  proposerSemaine,
  remettreElement,
  resumerSemaine,
  retirerElement,
  semaineProposee,
  type EtatRecompense,
  type ResumeSemaine,
} from '../../hub/pilote/planification';
import type { EtatApp } from '../ui/etat';
import { annulerValidation, construireEntree, ecrireEtatBase, lireEtatBase, tachesFaites, validerSemaine, type EtatPilote, type ValidationPilote } from './hote';

export interface ControleurPilote {
  reglages: ReglagesPilote;
  /** Lundi de la semaine proposée. */
  lundi: string;
  semaine: Semaine;
  /** Validation en vigueur pour cette semaine. */
  valide?: ValidationPilote;
  faites: ReadonlySet<string>;
  recompenses: Record<string, EtatRecompense>;
  bilans: BilanJour[];
  resume: ResumeSemaine;
  /** Dernier message (validation, annulation). */
  avis?: string;
  /** Un membre qui regarde ses projets personnels : la semaine planifie les projets partagés. */
  horsPartage: boolean;
  deplacer(id: string, jour: string): void;
  decaler(id: string, delta: number): void;
  retirer(id: string): void;
  remettre(id: string): void;
  regenerer(): void;
  valider(): void;
  annuler(): void;
  changerReglages(c: Partial<ReglagesPilote>): void;
}

export function usePilote(contexte: Pick<ContexteHub, 'profil' | 'profils' | 'admin' | 'portefeuille' | 'baseProfil'>, etat: EtatApp): ControleurPilote {
  const base = contexte.baseProfil;
  const [ep, setEp] = useState<EtatPilote>(() => lireEtatBase(base));
  const epRef = useRef(ep);
  epRef.current = ep;
  const maintenant = etat.maintenant();
  const lundi = semaineProposee(maintenant, ep.reglages, etat.aujourdhui).lundi;
  const horsPartage = etat.perso;

  const sauver = useCallback(
    (partiel: Partial<EtatPilote>) => {
      const suivant: EtatPilote = { ...epRef.current, ...partiel };
      epRef.current = suivant;
      setEp(suivant);
      ecrireEtatBase(base, suivant);
    },
    [base],
  );

  const donneesRef = useRef(etat);
  donneesRef.current = etat;
  const generer = useCallback(
    (reglages: ReglagesPilote, jourLundi: string): Semaine => {
      const e = donneesRef.current;
      return proposerSemaine(construireEntree(contexte, { role: e.role, moi: e.moi, donnees: e.donnees }, reglages, jourLundi, e.aujourdhui), e.maintenant());
    },
    // Le contexte change à chaque rendu : les sources sont relues au moment de générer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contexte.profil?.id, contexte.baseProfil, contexte.admin, contexte.portefeuille, contexte.profils],
  );

  // Semaine affichée : la validée, sinon le brouillon, sinon une proposition neuve (enregistrée comme brouillon).
  const [semaine, setSemaine] = useState<Semaine>(() => {
    const v = ep.valide;
    if (v && v.debut === lundi) return v.semaine;
    if (ep.brouillon && ep.brouillon.debut === lundi) return ep.brouillon;
    return generer(ep.reglages, lundi);
  });
  const dejaPersistee = useRef(false);
  useEffect(() => {
    const e = epRef.current;
    if (e.valide?.debut === lundi) {
      setSemaine(s => (s.debut === lundi && s === e.valide!.semaine ? s : e.valide!.semaine));
      return;
    }
    if (e.brouillon?.debut === lundi) {
      setSemaine(s => (s.debut === lundi ? s : e.brouillon!));
      return;
    }
    const neuve = semaine.debut === lundi && !dejaPersistee.current ? semaine : generer(e.reglages, lundi);
    dejaPersistee.current = true;
    setSemaine(neuve);
    sauver({ brouillon: neuve });
    // Seul le changement de semaine relance ce choix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lundi]);

  const valide = ep.valide && ep.valide.debut === lundi ? ep.valide : undefined;
  const [avis, setAvis] = useState<string | undefined>();

  const semaineRef = useRef(semaine);
  semaineRef.current = semaine;
  const modifier = useCallback(
    (f: (s: Semaine, r: ReglagesPilote) => Semaine) => {
      if (epRef.current.valide?.debut === lundi) return;
      const avant = semaineRef.current;
      const suivante = f(avant, epRef.current.reglages);
      if (suivante !== avant) {
        semaineRef.current = suivante;
        setSemaine(suivante);
        sauver({ brouillon: suivante });
      }
      setAvis(undefined);
    },
    [lundi, sauver],
  );

  const regenerer = useCallback(() => {
    if (epRef.current.valide?.debut === lundi) return;
    const neuve = generer(epRef.current.reglages, lundi);
    setSemaine(neuve);
    sauver({ brouillon: neuve });
    setAvis('Semaine régénérée.');
  }, [generer, lundi, sauver]);

  const valider = useCallback(() => {
    const e = donneesRef.current;
    if (epRef.current.valide?.debut === lundi || e.perso) return;
    const sem = semaineRef.current;
    let annulation: ValidationPilote['annulation'] = [];
    let appliquees = 0;
    let ignorees = 0;
    e.maj((d, ctx) => {
      const b = validerSemaine(d, sem, ctx, e.role, e.moi);
      annulation = b.annulation;
      appliquees = b.appliquees;
      ignorees = b.ignorees;
      return b.donnees;
    });
    sauver({ valide: { debut: lundi, le: e.maintenant(), annulation, semaine: sem }, brouillon: undefined });
    setAvis(`Semaine validée : ${appliquees} tâche${appliquees > 1 ? 's' : ''} planifiée${appliquees > 1 ? 's' : ''} dans Tâches${ignorees ? ` (${ignorees} ignorée${ignorees > 1 ? 's' : ''} : terminée${ignorees > 1 ? 's' : ''} ou plus modifiable${ignorees > 1 ? 's' : ''})` : ''}.`);
  }, [lundi, sauver]);

  const annuler = useCallback(() => {
    const v = epRef.current.valide;
    if (!v || v.debut !== lundi) return;
    const e = donneesRef.current;
    let restaurees = 0;
    let conservees = 0;
    e.maj((d, ctx) => {
      const b = annulerValidation(d, v, ctx);
      restaurees = b.restaurees;
      conservees = b.conservees;
      return b.donnees;
    });
    setSemaine(v.semaine);
    sauver({ valide: undefined, brouillon: v.semaine });
    setAvis(`Validation annulée : ${restaurees} tâche${restaurees > 1 ? 's' : ''} retrouve${restaurees > 1 ? 'nt' : ''} son échéance d’avant${conservees ? ` (${conservees} modifiée${conservees > 1 ? 's' : ''} depuis : laissée${conservees > 1 ? 's' : ''} telle${conservees > 1 ? 's' : ''} quelle${conservees > 1 ? 's' : ''})` : ''}.`);
  }, [lundi, sauver]);

  const changerReglages = useCallback(
    (c: Partial<ReglagesPilote>) => {
      const r = lireReglagesPilote({ ...epRef.current.reglages, ...c });
      sauver({ reglages: r });
      if (epRef.current.valide?.debut !== lundi) {
        const neuve = generer(r, lundi);
        setSemaine(neuve);
        sauver({ brouillon: neuve });
      }
    },
    [generer, lundi, sauver],
  );

  const faites = useMemo(() => tachesFaites(etat.donnees, semaine), [etat.donnees, semaine]);
  const recompenses = useMemo(() => etatRecompenses(semaine, faites), [semaine, faites]);
  const bilans = useMemo(() => bilanJours(semaine, ep.reglages), [semaine, ep.reglages]);
  const resume = useMemo(() => resumerSemaine(semaine), [semaine]);

  return {
    reglages: ep.reglages,
    lundi,
    semaine,
    valide,
    faites,
    recompenses,
    bilans,
    resume,
    avis,
    horsPartage,
    deplacer: (id, jour) => modifier((s, r) => deplacerElement(s, r, id, jour)),
    decaler: (id, delta) => modifier((s, r) => decalerElement(s, r, id, delta)),
    retirer: id => modifier((s, r) => retirerElement(s, r, id)),
    remettre: id => modifier((s, r) => remettreElement(s, r, id)),
    regenerer,
    valider,
    annuler,
    changerReglages,
  };
}
