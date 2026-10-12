/**
 * Claude Office v4 : alertes à l'exécution. Range réglages et journal sur
 * l'appareil (base du profil, clés `claude-office.alertes.*`, jamais envoyées),
 * évalue les règles (logiqueAlertes.ts) à chaque changement de l'activité ou de
 * l'horloge, notifie le système sur le PC (`window.applibourse.systeme.notifier`,
 * mécanisme existant) pour les règles qui le demandent, et donne le nombre
 * d'alertes non lues (pastille de l'onglet « Suivi » et de la tuile du hub).
 *
 * En démo : journal et état en mémoire seulement (rien n'est écrit), marqués « démo ».
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import type { EntreeHistorique } from './logiqueHistorique';
import {
  ajouterAuJournal, ETAT_VIDE, evaluerAlertes, lireJournalAlertes, lireReglagesAlertes, marquerToutLu, nonLues,
  type Alerte, type EtatAlertes, type ReglagesAlertes,
} from './logiqueAlertes';

export const CLE_REGLAGES_ALERTES = 'claude-office.alertes.reglages';
export const CLE_JOURNAL_ALERTES = 'claude-office.alertes.journal';
/** Au plus ce nombre de notifications du système par évaluation. */
export const MAX_NOTIFICATIONS = 3;

type Notifier = (titre: string, corps: string, d?: string) => Promise<boolean>;
const notifierSysteme = (): Notifier | undefined =>
  (globalThis as { applibourse?: { systeme?: { notifier?: Notifier } } }).applibourse?.systeme?.notifier;

export function lireReglagesStockes(base: BasePrefs | undefined): ReglagesAlertes {
  try {
    return lireReglagesAlertes(base?.lire(CLE_REGLAGES_ALERTES) ?? undefined);
  } catch {
    return lireReglagesAlertes(undefined);
  }
}

function lireJournalStocke(base: BasePrefs | undefined): { journal: Alerte[]; etat: EtatAlertes } {
  try {
    return lireJournalAlertes(base?.lire(CLE_JOURNAL_ALERTES) ?? undefined);
  } catch {
    return { journal: [], etat: ETAT_VIDE };
  }
}

const ecrire = (base: BasePrefs | undefined, cle: string, valeur: unknown) => {
  try {
    base?.ecrire(cle, JSON.stringify(valeur));
  } catch {
    // Stockage indisponible : vaut pour cette fois.
  }
};

export interface AlertesOffice {
  reglages: ReglagesAlertes;
  journal: Alerte[];
  nonLues: number;
  changerReglages(r: ReglagesAlertes): void;
  toutLu(): void;
  vider(): void;
}

/** Démo : journal partagé en mémoire (survit aux changements d'onglet, oublié en quittant l'écran). */
let memoireDemo: { journal: Alerte[]; etat: EtatAlertes } = { journal: [], etat: ETAT_VIDE };
export const oublierDemoAlertes = (): void => void (memoireDemo = { journal: [], etat: ETAT_VIDE });

/**
 * Évalue les alertes sur `entrees` (activité lue par l'écran ou par la tuile).
 * `notifier` : seulement sur le PC (pont présent). `actif` faux : rien n'est évalué.
 */
export function useAlertesOffice(o: {
  base?: BasePrefs;
  entrees: readonly EntreeHistorique[];
  references?: Record<string, number>;
  maintenant: number;
  lu: boolean;
  demo?: boolean;
  surPc?: boolean;
  actif?: boolean;
}): AlertesOffice {
  const { base, entrees, references, maintenant, lu, demo = false, surPc = false, actif = true } = o;
  const [reglages, setReglages] = useState<ReglagesAlertes>(() => lireReglagesStockes(base));
  const [donnees, setDonnees] = useState(() => (demo ? memoireDemo : lireJournalStocke(base)));
  const courant = useRef(donnees);
  courant.current = donnees;

  // Relu quand la base, la démo ou l'activité changent (l'écran et la tuile du hub partagent le journal).
  useEffect(() => {
    if (!actif) return;
    setReglages(lireReglagesStockes(base));
    setDonnees(demo ? memoireDemo : lireJournalStocke(base));
  }, [base, demo, actif]);

  const enregistrer = useCallback((d: { journal: Alerte[]; etat: EtatAlertes }) => {
    setDonnees(d);
    courant.current = d;
    if (demo) memoireDemo = d;
    else ecrire(base, CLE_JOURNAL_ALERTES, d);
  }, [base, demo]);

  // Évaluation : à chaque nouvelle lecture ou tic d'horloge (le délai d'une attente s'écoule sans événement).
  const minute = Math.floor(maintenant / 15_000);
  useEffect(() => {
    if (!actif || !lu) return;
    // Hors démo, l'état peut avoir été écrit ailleurs (tuile du hub) : relu avant d'évaluer.
    const d = demo ? courant.current : lireJournalStocke(base);
    const r = evaluerAlertes(entrees, { maintenant, reglages, etat: d.etat, ...(references ? { references } : {}), demo });
    if (!r.nouvelles.length && JSON.stringify(r.etat) === JSON.stringify(d.etat)) return;
    enregistrer({ journal: ajouterAuJournal(d.journal, r.nouvelles), etat: r.etat });
    const notifier = surPc && !demo ? notifierSysteme() : undefined;
    if (notifier) {
      for (const a of r.nouvelles.filter(x => reglages[x.regle].notifier).slice(0, MAX_NOTIFICATIONS)) {
        void notifier(a.titre, a.detail, '').catch(() => undefined);
      }
    }
  }, [actif, lu, entrees, references, minute, reglages, demo, surPc, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const changerReglages = useCallback((r: ReglagesAlertes) => {
    setReglages(r);
    if (!demo) ecrire(base, CLE_REGLAGES_ALERTES, r);
  }, [base, demo]);

  return {
    reglages,
    journal: donnees.journal,
    nonLues: nonLues(donnees.journal, reglages),
    changerReglages,
    toutLu: () => enregistrer({ ...courant.current, journal: marquerToutLu(courant.current.journal) }),
    vider: () => enregistrer({ ...courant.current, journal: [] }),
  };
}

/** Tuile du hub : nombre d'alertes non lues rangées sur l'appareil (sans évaluer). */
export function nonLuesStockees(base: BasePrefs | undefined): number {
  return nonLues(lireJournalStocke(base).journal, lireReglagesStockes(base));
}
