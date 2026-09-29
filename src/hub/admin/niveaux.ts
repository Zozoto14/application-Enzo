/**
 * Niveaux d'accès par app, et modèles de permissions.
 *
 * Une app déclare dans le registre les niveaux qu'elle sait faire respecter
 * (`AppHub.niveaux`) ; sans déclaration, elle n'en connaît qu'un : l'accès
 * complet. L'administration ne propose jamais un niveau qu'une app ne
 * déclare pas : un « lecture seule » qu'elle ignorerait serait une promesse
 * fausse.
 *
 * Tout est pur : ni stockage, ni horloge.
 */

import type { AppHub } from '../types';

export type NiveauAcces = 'aucun' | 'lecture' | 'complet';
/** Niveau qu'une app peut déclarer (« aucun » va de soi). */
export type NiveauDeclare = Exclude<NiveauAcces, 'aucun'>;

export const NIVEAUX: readonly NiveauAcces[] = ['aucun', 'lecture', 'complet'];

export const LIBELLES_NIVEAU: Record<NiveauAcces, string> = {
  aucun: 'Aucun accès',
  lecture: 'Lecture seule',
  complet: 'Accès complet',
};

export function estNiveau(valeur: unknown): valeur is NiveauAcces {
  return typeof valeur === 'string' && (NIVEAUX as readonly string[]).includes(valeur);
}

type AppNiveaux = Pick<AppHub, 'niveaux'>;

/** Niveaux proposés pour une app, du plus fermé au plus ouvert. */
export function niveauxDe(app: AppNiveaux): NiveauAcces[] {
  const declares = app.niveaux && app.niveaux.length > 0 ? app.niveaux : (['complet'] as const);
  return NIVEAUX.filter(niveau => niveau === 'aucun' || declares.includes(niveau as NiveauDeclare));
}

/**
 * Ramène un niveau voulu à ce que l'app sait faire, sans jamais ouvrir plus
 * que demandé : une « lecture seule » sur une app qui ne la connaît pas
 * devient « aucun accès », pas « accès complet ».
 */
export function ajusterNiveau(app: AppNiveaux, voulu: NiveauAcces): NiveauAcces {
  const possibles = niveauxDe(app);
  if (possibles.includes(voulu)) {
    return voulu;
  }
  const rang = NIVEAUX.indexOf(voulu);
  const inferieurs = possibles.filter(niveau => NIVEAUX.indexOf(niveau) <= rang);
  return inferieurs[inferieurs.length - 1] ?? 'aucun';
}

/** Un seul choix réel (ouvert / fermé) : l'interface montre un interrupteur. */
export function simpleInterrupteur(app: AppNiveaux): boolean {
  return niveauxDe(app).length <= 2;
}

// --- Modèles -----------------------------------------------------------------

export type IdModele = 'ami' | 'lecture' | 'aucun' | 'personnalise';

export interface ModelePermissions {
  id: IdModele;
  nom: string;
  description: string;
  /** Niveau visé pour chaque app ; ajusté à ce que l'app sait faire. */
  niveau?: NiveauAcces;
}

export const MODELES: readonly ModelePermissions[] = [
  { id: 'ami', nom: 'Ami', description: 'Accès complet à toutes les apps partageables.', niveau: 'complet' },
  {
    id: 'lecture',
    nom: 'Lecture seule',
    description: 'Consultation seulement, sur les apps qui savent la faire respecter ; aucune autre.',
    niveau: 'lecture',
  },
  { id: 'aucun', nom: 'Aucun accès', description: 'Le compte existe mais n’ouvre aucune app.', niveau: 'aucun' },
  { id: 'personnalise', nom: 'Personnalisé', description: 'Réglage app par app.' },
];

export type Niveaux = Record<string, NiveauAcces>;

/** Niveaux qu'un modèle donne sur les apps attribuables. */
export function niveauxDuModele(apps: readonly AppHub[], id: IdModele, actuels: Niveaux = {}): Niveaux {
  const modele = MODELES.find(m => m.id === id);
  if (!modele?.niveau) {
    return { ...actuels };
  }
  const niveau = modele.niveau;
  return Object.fromEntries(apps.filter(app => !app.adminSeulement).map(app => [app.id, ajusterNiveau(app, niveau)]));
}

/** Modèle auquel correspondent des niveaux, « Personnalisé » sinon. */
export function modeleCorrespondant(apps: readonly AppHub[], niveaux: Niveaux): IdModele {
  const attribuables = apps.filter(app => !app.adminSeulement);
  for (const modele of MODELES) {
    if (!modele.niveau) {
      continue;
    }
    const attendus = niveauxDuModele(attribuables, modele.id);
    if (attribuables.every(app => (niveaux[app.id] ?? 'aucun') === attendus[app.id])) {
      return modele.id;
    }
  }
  return 'personnalise';
}
