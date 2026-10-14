/**
 * État de l'app Tâches : données du rôle (Fondateur : les siennes ; ami : la
 * copie partagée), relues après une synchronisation et toutes les 3 s (une
 * réception arrive sans prévenir), et écrites dans la base chiffrée du
 * profil à chaque modification VALIDÉE (jamais à chaque frappe). Chaque
 * modification repart de ce qui est enregistré : une réception arrivée entre
 * deux gestes n'est pas écrasée.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContexteHub } from '../../hub/types';
import { aleatoireParDefaut } from '../../securite/aleatoire';
import { roleTaches, type RoleTaches } from '../acces';
import { jourDe } from '../dates';
import { ecrireDonnees, lireDonnees, type Auteur, type Contexte, type DonneesTaches } from '../modele';
import { changerDroit, inviterMembre, nomsMembres, retirerMembre, type DroitOuAucun } from '../membres';
import { CLES_TACHES, lireCopie, type CopieAmi } from '../partage';
import { lireEtatRappels, marquerRappelsLus, type AlerteRappel } from '../rappels';

export interface EtatApp {
  role: RoleTaches;
  /** Mon code d'auteur : « fondateur », « ami » (ami des V1/V2) ou mon identifiant de membre. */
  moi: Auteur;
  donnees: DonneesTaches;
  copie?: CopieAmi;
  noms: Record<Auteur, string>;
  /** « par le Fondateur » / « par Enzo ». */
  parFondateur: string;
  aujourdhui: string;
  maintenant(): number;
  /** Applique une modification ; rend les données enregistrées. */
  maj(changer: (d: DonneesTaches, ctx: Contexte) => DonneesTaches): DonneesTaches;
  rappels: AlerteRappel[];
  rappelsLus(): void;
  /** Fondateur : invite un compte (ami ou gestionnaire) et lui ouvre l'app. */
  inviter(compte: string, nom: string, rang?: 'ami' | 'gestionnaire'): Promise<void>;
  /** Fondateur : retire un membre (droits, clés tournées, app fermée, dépôt effacé au tour suivant). */
  retirer(compte: string): Promise<void>;
  /** Fondateur : droit d'un membre sur un projet. */
  changerDroit(projetId: string, compte: string, droit: DroitOuAucun): void;
  /** Relit la base (après une écriture faite hors de l'écran : liens, notification de test). */
  relire(): void;
}


export function useEtatTaches(contexte: ContexteHub): EtatApp {
  const role = roleTaches(contexte) ?? 'fondateur';
  const base = contexte.baseProfil;
  const cle = role === 'fondateur' ? CLES_TACHES.donnees : CLES_TACHES.copie;
  const lireBrut = useCallback(() => {
    try {
      return base?.lire(cle) ?? '';
    } catch {
      return '';
    }
  }, [base, cle]);
  const [brut, setBrut] = useState(lireBrut);
  const [brutRappels, setBrutRappels] = useState(() => base?.lire(CLES_TACHES.rappels) ?? '');
  const relire = useCallback(() => {
    const b = lireBrut();
    setBrut(p => (p === b ? p : b));
    const r = base?.lire(CLES_TACHES.rappels) ?? '';
    setBrutRappels(p => (p === r ? p : r));
  }, [lireBrut, base]);
  const version = contexte.profils?.versionComptes ?? 0;
  useEffect(() => relire(), [relire, version]);
  useEffect(() => {
    const t = setInterval(relire, 3000);
    return () => clearInterval(t);
  }, [relire]);

  const copie = useMemo(() => (role === 'ami' ? lireCopie(brut) : undefined), [role, brut]);
  const donnees = useMemo(() => (role === 'ami' ? copie!.donnees : lireDonnees(brut || undefined)), [role, brut, copie]);
  const maintenant = useCallback(() => contexte.maintenant ?? Date.now(), [contexte.maintenant]);
  const nomMoi = contexte.profil?.nom && contexte.profil.nom !== 'Moi' ? contexte.profil.nom : 'Moi';
  const moi: Auteur = role === 'fondateur' ? 'fondateur' : (copie?.moi ?? 'ami');
  const noms: Record<Auteur, string> =
    role === 'fondateur'
      ? nomsMembres(donnees, nomMoi)
      : { ami: 'Ami', ...(copie?.membres ?? {}), fondateur: copie?.fondateur ?? 'Fondateur', [moi]: copie?.ami ?? nomMoi };

  const courant = useRef({ role, cle, base, moi });
  courant.current = { role, cle, base, moi };
  const maj = useCallback(
    (changer: (d: DonneesTaches, ctx: Contexte) => DonneesTaches): DonneesTaches => {
      const { role: r, cle: c, base: b, moi: m } = courant.current;
      const enregistre = b?.lire(c) ?? '';
      const copieActuelle = r === 'ami' ? lireCopie(enregistre) : undefined;
      const actuelles = copieActuelle ? copieActuelle.donnees : lireDonnees(enregistre || undefined);
      const suivantes = changer(actuelles, { maintenant: maintenant(), auteur: r === 'fondateur' ? 'fondateur' : (copieActuelle?.moi ?? m) });
      if (suivantes === actuelles) return actuelles;
      const texte = copieActuelle ? JSON.stringify({ ...copieActuelle, donnees: suivantes }) : ecrireDonnees(suivantes);
      b?.ecrire(c, texte);
      setBrut(texte);
      return suivantes;
    },
    [maintenant],
  );

  const rappels = useMemo(() => lireEtatRappels(brutRappels).nonLus, [brutRappels]);
  const rappelsLus = useCallback(() => {
    const etat = marquerRappelsLus(lireEtatRappels(base?.lire(CLES_TACHES.rappels)));
    const texte = JSON.stringify(etat);
    base?.ecrire(CLES_TACHES.rappels, texte);
    setBrutRappels(texte);
  }, [base]);

  const profils = contexte.profils;
  const ouvrirApp = useCallback(
    async (compte: string, ouvrir: boolean) => {
      // L'app s'ouvre au membre invité, se ferme au membre retiré (accès `taches` de son compte).
      const p = (profils?.tous ?? []).find(x => x.id === compte);
      if (!p || p.admin || !profils?.onAutoriser) return;
      const apps = p.apps ?? [];
      if (ouvrir && !apps.includes('taches')) await profils.onAutoriser(p.id, [...apps, 'taches']);
      if (!ouvrir && apps.includes('taches')) await profils.onAutoriser(p.id, apps.filter(a => a !== 'taches'));
    },
    [profils],
  );
  const inviter = useCallback(
    async (compte: string, nom: string, rang?: 'ami' | 'gestionnaire') => {
      maj((d, ctx) => inviterMembre(d, compte, nom, { ...ctx, aleaOctets: aleatoireParDefaut }, rang));
      await ouvrirApp(compte, true);
    },
    [maj, ouvrirApp],
  );
  const retirer = useCallback(
    async (compte: string) => {
      maj((d, ctx) => retirerMembre(d, compte, { ...ctx, aleaOctets: aleatoireParDefaut }));
      await ouvrirApp(compte, false);
    },
    [maj, ouvrirApp],
  );
  const changerDroitMembre = useCallback(
    (projetId: string, compte: string, droit: DroitOuAucun) => void maj((d, ctx) => changerDroit(d, projetId, compte, droit, { ...ctx, aleaOctets: aleatoireParDefaut })),
    [maj],
  );

  const parFondateur = noms.fondateur === 'Fondateur' ? 'le Fondateur' : noms.fondateur;
  return { role, moi, donnees, copie, noms, parFondateur, aujourdhui: jourDe(maintenant()), maintenant, maj, rappels, rappelsLus, inviter, retirer, changerDroit: changerDroitMembre, relire };
}
