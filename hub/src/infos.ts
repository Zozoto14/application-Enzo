/**
 * Informations en direct des tuiles, en données pures.
 */

import type { InfoLive, ProfilHub } from './types';

export function infoAdministration(profils: readonly ProfilHub[] | undefined): InfoLive | undefined {
  if (!profils) {
    return undefined;
  }
  const amis = profils.filter(profil => !profil.admin);
  return {
    sousTitre: 'Comptes des amis et accès aux apps',
    indicateurs: [
      { libelle: 'Utilisateurs', valeur: String(profils.length) },
      { libelle: 'Amis actifs', valeur: String(amis.filter(ami => ami.actif !== false).length) },
    ],
  };
}

/** « Bonjour » ou « Bonsoir », selon l'heure. */
export function salutation(heure: number, nom: string | undefined): string {
  const mot = heure >= 5 && heure < 18 ? 'Bonjour' : 'Bonsoir';
  // « Moi » est le nom par défaut du profil principal : « Bonsoir, Moi. » sonnerait faux.
  return nom && nom !== 'Moi' ? `${mot}, ${nom}.` : `${mot}.`;
}
