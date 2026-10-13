/**
 * Tâches dans le hub : information en direct de la tuile (pastille des
 * rappels non lus, en retard, aujourd'hui) et évaluation des rappels tant que
 * l'application est déverrouillée (notification du système sur le PC, par le
 * pont existant `window.applibourse.systeme.notifier`).
 */

import { useEffect, useState } from 'react';
import type { ContexteHub, InfoLive } from '../hub/types';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { roleTaches, type RoleTaches } from './acces';
import { jourDe } from './dates';
import { maJournee } from './filtres';
import { lireDonnees, projetsDe, type DonneesTaches } from './modele';
import { CLES_TACHES, lireCopie } from './partage';
import { evaluerRappels, lireEtatRappels, type AlerteRappel } from './rappels';

/** Données visibles pour ce rôle : les siennes (Fondateur), la copie partagée (ami). */
export function donneesPour(role: RoleTaches, base: Pick<BasePrefs, 'lire'> | undefined): DonneesTaches {
  try {
    return role === 'fondateur' ? lireDonnees(base?.lire(CLES_TACHES.donnees) ?? undefined) : lireCopie(base?.lire(CLES_TACHES.copie)).donnees;
  } catch {
    return lireDonnees(undefined);
  }
}

export function rappelsNonLus(base: Pick<BasePrefs, 'lire'> | undefined): AlerteRappel[] {
  try {
    return lireEtatRappels(base?.lire(CLES_TACHES.rappels)).nonLus;
  } catch {
    return [];
  }
}

export function infoTaches(contexte: ContexteHub): InfoLive | undefined {
  const role = roleTaches(contexte);
  if (!role || !contexte.baseProfil) return undefined;
  const d = donneesPour(role, contexte.baseProfil);
  const j = maJournee(d, jourDe(contexte.maintenant ?? Date.now()), role);
  const rappels = rappelsNonLus(contexte.baseProfil).length;
  const projets = projetsDe(d).length;
  const aujourdhui = j.aujourdhui.length + j.choisies.length;
  const sousTitre =
    projets === 0
      ? role === 'ami'
        ? 'Aucun projet partagé pour l’instant'
        : 'Créez votre premier projet'
      : j.retard.length > 0
        ? `${j.retard.length} en retard · ${aujourdhui} aujourd’hui`
        : aujourdhui > 0
          ? `${aujourdhui} tâche${aujourdhui > 1 ? 's' : ''} pour aujourd’hui`
          : 'Rien d’urgent aujourd’hui';
  return {
    sousTitre,
    ...(rappels > 0 ? { pastille: `${rappels} RAPPEL${rappels > 1 ? 'S' : ''}` } : {}),
    indicateurs: [
      { libelle: 'Aujourd’hui', valeur: String(aujourdhui) },
      { libelle: 'En retard', valeur: String(j.retard.length), tendance: j.retard.length > 0 ? 'baisse' : 'neutre' },
    ],
  };
}

type Notifier = (titre: string, corps: string, d?: string) => Promise<boolean>;
const notifierSysteme = (): Notifier | undefined =>
  (globalThis as { applibourse?: { systeme?: { notifier?: Notifier } } }).applibourse?.systeme?.notifier;

export const INTERVALLE_RAPPELS_MS = 30_000;
export const MAX_NOTIFICATIONS = 3;

/**
 * Évalue les rappels du profil ouvert (toutes les 30 s, et à l'ouverture).
 * Rend un numéro qui change à chaque nouveau rappel (la tuile se relit).
 */
export function verifierRappels(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>, maintenant: number): AlerteRappel[] {
  const role = roleTaches(contexte);
  const base = contexte.baseProfil;
  if (!role || !base) return [];
  const d = donneesPour(role, base);
  const etat = lireEtatRappels(base.lire(CLES_TACHES.rappels));
  const r = evaluerRappels(d, etat, maintenant, role);
  if (r.nouvelles.length === 0 && JSON.stringify(r.etat.vus) === JSON.stringify(etat.vus)) return [];
  try {
    base.ecrire(CLES_TACHES.rappels, JSON.stringify(r.etat));
  } catch {
    return [];
  }
  const notifier = notifierSysteme();
  if (notifier) {
    for (const a of r.nouvelles.slice(0, MAX_NOTIFICATIONS)) void notifier(`Tâche : ${a.titre}`, a.texte, '').catch(() => undefined);
  }
  return r.nouvelles;
}

export function useRappelsTaches(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>, actif: boolean): number {
  const [version, setVersion] = useState(0);
  const role = roleTaches(contexte);
  useEffect(() => {
    if (!actif || !role) return undefined;
    const tour = () => {
      if (verifierRappels(contexte, Date.now()).length > 0) setVersion(v => v + 1);
    };
    tour();
    const minuterie = setInterval(tour, INTERVALLE_RAPPELS_MS);
    return () => clearInterval(minuterie);
    // Le contexte change à chaque rendu : seuls le rôle, le profil et la base comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, role, contexte.profil?.id, contexte.baseProfil]);
  return version;
}
