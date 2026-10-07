/**
 * Qui voit quoi dans le hub. Données pures, testées à part.
 *
 * Règle unique : l'administrateur (ou un appareil sans profils, dont
 * l'unique utilisateur est administrateur) voit toutes les apps disponibles ;
 * un ami ne voit que celles que l'administrateur lui a ouvertes, et jamais
 * une app réservée à l'administrateur — même si la liste enregistrée, qui
 * est lisible sans déverrouillage, a été retouchée pour la lui donner.
 */

import type { Profil } from '../profils/profils';
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

/** Apps à montrer dans le hub, dans l'ordre du registre. */
export function appsVisibles(registre: readonly AppHub[], contexte: ContexteHub): AppHub[] {
  return registre.filter(app => (app.disponible?.(contexte) ?? true) && peutOuvrir(app, contexte.profil));
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
