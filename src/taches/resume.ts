/**
 * Tâches dans le hub : information en direct de la tuile (pastille des
 * rappels non lus, en retard, aujourd'hui) et, tant que l'application est
 * déverrouillée, la passe des liens avec les autres apps et l'évaluation des
 * notifications selon les réglages de chacun (notification du système sur le
 * PC par le pont existant `window.applibourse.systeme.notifier`, ou du
 * navigateur si elle y est déjà autorisée).
 */

import { useEffect, useRef, useState } from 'react';
import type { ContexteHub, InfoLive } from '../hub/types';
import type { BasePrefs } from '../tsuzuku/plateforme/stockage';
import { roleTaches, type RoleTaches } from './acces';
import { jourDe } from './dates';
import { maJournee } from './filtres';
import { synchroniserLiens } from './integrations/moteur';
import { ecrireDonnees, lireDonnees, projetsDe, type Auteur, type DonneesTaches } from './modele';
import { enHeuresCalmes, evaluerNotifications, nomAppareil, prefsDe, type EvenementNotif, type NotifSysteme } from './notifications';
import { CLES_TACHES, lireCopie } from './partage';
import { lireEtatRappels, type AlerteRappel } from './rappels';

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

type Notifier = (titre: string, corps: string, d?: string, options?: { silencieux?: boolean }) => Promise<boolean>;
const notifierSysteme = (): Notifier | undefined => {
  const g = globalThis as { applibourse?: { systeme?: { notifier?: Notifier } }; Notification?: { permission?: string; new (t: string, o?: { body?: string; silent?: boolean }): unknown } };
  if (g.applibourse?.systeme?.notifier) return g.applibourse.systeme.notifier;
  // Site : notification du navigateur seulement si elle est déjà autorisée (jamais de demande ici).
  if (g.Notification && g.Notification.permission === 'granted') {
    const N = g.Notification;
    return async (t, c, _d, o) => {
      new N(t, { body: c, silent: Boolean(o?.silencieux) });
      return true;
    };
  }
  return undefined;
};
export const notificationSystemeDisponible = (): boolean => Boolean(notifierSysteme());

export const INTERVALLE_RAPPELS_MS = 30_000;
/** Liens avec les autres apps : une passe toutes les 5 min au plus. */
export const INTERVALLE_LIENS_MS = 5 * 60_000;

/** Identifiant de cet appareil (base de l'appareil, jamais synchronisée) : « un appareil seulement ». */
export function appareilTaches(base: Pick<BasePrefs, 'lire' | 'ecrire'> | undefined): { id: string; nom: string } {
  const nom = nomAppareil((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent);
  try {
    const lu = base?.lire(CLES_TACHES.appareil);
    if (lu && /^[a-z0-9-]{4,40}$/.test(lu)) return { id: lu, nom };
    const id = `ap-${Math.floor(Math.random() * 36 ** 8).toString(36)}`;
    base?.ecrire(CLES_TACHES.appareil, id);
    return { id, nom };
  } catch {
    return { id: 'ap-inconnu', nom };
  }
}

/** Prénoms affichés dans les notifications. */
export function nomsTaches(role: RoleTaches, contexte: Pick<ContexteHub, 'profil' | 'baseProfil'>, d: DonneesTaches): Record<Auteur, string> {
  const moi = contexte.profil?.nom && contexte.profil.nom !== 'Moi' ? contexte.profil.nom : 'Moi';
  if (role === 'fondateur') return { fondateur: moi, ami: d.reglages.amiNom ?? 'L’ami' };
  const copie = lireCopie(contexte.baseProfil?.lire(CLES_TACHES.copie));
  return { fondateur: copie.fondateur ?? 'Le Fondateur', ami: copie.ami ?? moi };
}

/** Montre les notifications du système (son selon les réglages). */
function montrer(liste: readonly NotifSysteme[], son: boolean): void {
  const notifier = notifierSysteme();
  if (!notifier) return;
  for (const n of liste) void notifier(n.titre, n.corps, '', { silencieux: !son }).catch(() => undefined);
}

let derniereSynchroLiens = 0;
export const reinitialiserLiens = () => void (derniereSynchroLiens = 0);

/**
 * Tour du hub (toutes les 30 s, et à l'ouverture) : liens avec les autres apps
 * (Fondateur, toutes les 5 min), puis notifications du profil ouvert, triées
 * selon SES réglages. Rend les alertes ajoutées à la pastille.
 */
export function verifierRappels(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil' | 'profils' | 'portefeuille'>, maintenant: number, extra: readonly EvenementNotif[] = []): AlerteRappel[] {
  const role = roleTaches(contexte);
  const base = contexte.baseProfil;
  if (!role || !base) return [];
  let d = donneesPour(role, base);
  if (role === 'fondateur' && (maintenant - derniereSynchroLiens >= INTERVALLE_LIENS_MS || maintenant < derniereSynchroLiens)) {
    derniereSynchroLiens = maintenant;
    try {
      const r = synchroniserLiens(d, { profil: contexte.profil, profils: contexte.profils, admin: contexte.admin, rappelsPortefeuille: contexte.portefeuille?.rappelsTaches }, { maintenant, auteur: 'fondateur' }, jourDe(maintenant));
      if (r.donnees !== d) {
        // Repart de ce qui est enregistré : rien n'est écrasé.
        d = r.donnees;
        base.ecrire(CLES_TACHES.donnees, ecrireDonnees(d));
      }
    } catch {
      // Réessayé au tour suivant.
    }
  }
  const etat = lireEtatRappels(base.lire(CLES_TACHES.rappels));
  const appareil = appareilTaches(base);
  const r = evaluerNotifications(d, etat, maintenant, role, { appareilId: appareil.id, noms: nomsTaches(role, contexte, d) }, extra);
  if (r.pastille.length === 0 && r.systeme.length === 0 && JSON.stringify(r.etat) === JSON.stringify(etat)) return [];
  try {
    base.ecrire(CLES_TACHES.rappels, JSON.stringify(r.etat));
  } catch {
    return [];
  }
  montrer(r.systeme, prefsDe(d, role).son);
  return r.pastille;
}

/** « Tester une notification » : une notification du système (si l'appareil en a) et une ligne dans la pastille. */
export function testerNotification(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil'>, maintenant: number): { systeme: boolean; calme: boolean; autreAppareil: boolean } {
  const role = roleTaches(contexte);
  const base = contexte.baseProfil;
  if (!role || !base) return { systeme: false, calme: false, autreAppareil: false };
  const d = donneesPour(role, base);
  const prefs = prefsDe(d, role);
  const etat = lireEtatRappels(base.lire(CLES_TACHES.rappels));
  const alerte: AlerteRappel = { cle: `test|${maintenant}`, tacheId: '', titre: 'Notification de test', texte: 'Les notifications de Tâches fonctionnent sur cet appareil.', date: new Date(maintenant).toISOString(), type: 'test' };
  base.ecrire(CLES_TACHES.rappels, JSON.stringify({ ...etat, nonLus: [...etat.nonLus, alerte].slice(-50) }));
  const systeme = notificationSystemeDisponible();
  montrer([{ titre: 'Tâches : notification de test', corps: alerte.texte }], prefs.son);
  return { systeme, calme: enHeuresCalmes(prefs, maintenant), autreAppareil: Boolean(prefs.appareil && prefs.appareil.id !== appareilTaches(base).id) };
}

export function useRappelsTaches(contexte: Pick<ContexteHub, 'profil' | 'admin' | 'baseProfil' | 'profils' | 'portefeuille'>, actif: boolean): number {
  const [version, setVersion] = useState(0);
  const role = roleTaches(contexte);
  const courant = useRef(contexte);
  courant.current = contexte;
  useEffect(() => {
    if (!actif || !role) return undefined;
    const tour = () => {
      if (verifierRappels(courant.current, Date.now()).length > 0) setVersion(v => v + 1);
    };
    tour();
    const minuterie = setInterval(tour, INTERVALLE_RAPPELS_MS);
    return () => clearInterval(minuterie);
    // Le contexte change à chaque rendu : seuls le rôle, le profil et la base comptent (le reste est lu à chaque tour).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, role, contexte.profil?.id, contexte.baseProfil]);
  return version;
}
