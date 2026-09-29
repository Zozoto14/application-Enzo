/**
 * Informations en direct des tuiles, en données pures.
 */

import type { Profil } from '../profils/profils';
import type { InfoLive, ResumePortefeuille } from './types';

export function infoPortefeuille(resume: ResumePortefeuille | undefined): InfoLive | undefined {
  if (!resume) {
    return undefined;
  }
  if (resume.sansCompte) {
    return { sousTitre: 'Créez votre premier compte titre pour commencer.', indicateurs: [] };
  }
  return {
    sousTitre: resume.variation ? `Dernière séance : ${resume.variation.date}` : undefined,
    indicateurs: [
      { libelle: 'Valeur', valeur: resume.valeur },
      resume.variation
        ? { libelle: 'Aujourd’hui', valeur: resume.variation.pourcentage, tendance: resume.variation.tendance }
        : { libelle: 'Aujourd’hui', valeur: '—' },
    ],
  };
}

export function infoAdministration(profils: readonly Profil[] | undefined): InfoLive | undefined {
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
