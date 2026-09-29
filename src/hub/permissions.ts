/**
 * Qui voit quoi dans le hub. Données pures, testées à part.
 *
 * Règle unique : l'administrateur (ou un appareil sans profils, dont
 * l'unique utilisateur est administrateur) voit toutes les apps disponibles ;
 * un ami ne voit que celles que l'administrateur lui a ouvertes, et jamais
 * une app réservée à l'administrateur — même si la liste enregistrée, qui
 * est lisible sans déverrouillage, a été retouchée pour la lui donner.
 *
 * La politique globale (`admin/politique.ts`) s'ajoute : une app désactivée
 * disparaît pour tous sauf l'administrateur ; une app en maintenance reste
 * visible mais ne s'ouvre plus pour un ami, sa tuile affiche le message.
 */

import type { Profil } from '../profils/profils';
import { niveauProfil } from './admin/comptes';
import type { NiveauAcces } from './admin/niveaux';
import { etatApp, messageMaintenance, type PolitiqueHub } from './admin/politique';
import type { AppHub, ContexteHub } from './types';

type ProfilAcces = Pick<Profil, 'admin' | 'apps'>;

export function peutOuvrir(app: Pick<AppHub, 'id' | 'adminSeulement'>, profil: ProfilAcces | undefined): boolean {
  if (!profil || profil.admin) {
    return true;
  }
  if (app.adminSeulement) {
    return false;
  }
  return (profil.apps ?? []).includes(app.id);
}

/** Politique globale des apps, portée par l'entrée de l'administrateur. */
export function politiqueDe(contexte: Pick<ContexteHub, 'profils'>): PolitiqueHub | undefined {
  return contexte.profils?.tous.find(profil => profil.admin)?.politique;
}

function estAdmin(contexte: Pick<ContexteHub, 'profil'>): boolean {
  return !contexte.profil || contexte.profil.admin;
}

/** Apps à montrer dans le hub, dans l'ordre du registre. */
export function appsVisibles(registre: readonly AppHub[], contexte: ContexteHub): AppHub[] {
  const politique = politiqueDe(contexte);
  const admin = estAdmin(contexte);
  return registre.filter(
    app =>
      (app.disponible?.(contexte) ?? true) &&
      peutOuvrir(app, contexte.profil) &&
      (admin || etatApp(politique, app.id).active),
  );
}

export interface EtatTuile {
  /** Message de maintenance à afficher sur la tuile. */
  maintenance?: string;
  /** Désactivée pour les amis (l'administrateur la voit encore). */
  desactivee: boolean;
  /** Faux : la tuile ne s'ouvre pas (maintenance, pour un ami). */
  ouvrable: boolean;
  niveau: NiveauAcces;
}

export function etatTuile(app: AppHub, contexte: ContexteHub): EtatTuile {
  const etat = etatApp(politiqueDe(contexte), app.id);
  const admin = estAdmin(contexte);
  const maintenance = messageMaintenance(etat);
  return {
    maintenance,
    desactivee: !etat.active,
    ouvrable: admin || (etat.active && maintenance === undefined),
    niveau: niveauProfil(contexte.profil, app),
  };
}

/** Apps qu'un administrateur peut ouvrir à un ami (cases de l'Administration). */
export function appsAttribuables(registre: readonly AppHub[]): AppHub[] {
  return registre.filter(app => !app.adminSeulement);
}

/** Nombre d'amis actifs qui ont accès à une app. */
export function nombreUtilisateurs(app: AppHub, profils: readonly Profil[]): number {
  return profils.filter(profil => profil.actif !== false && peutOuvrir(app, profil)).length;
}

/** Bascule une app dans une liste d'autorisations. */
export function basculerApp(apps: readonly string[], id: string, ouverte: boolean): string[] {
  const sans = apps.filter(app => app !== id);
  return ouverte ? [...sans, id] : sans;
}
