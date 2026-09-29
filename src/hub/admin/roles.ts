/**
 * Rôles de l'Administration et droits de chacun, en données pures.
 *
 * Trois rôles :
 *  - **administrateur** : tout, y compris le séquestre (ouvrir le compte d'un
 *    ami) et les réglages de sécurité ;
 *  - **gestionnaire** : un ami à qui l'administrateur confie une
 *    Administration LIMITÉE — tableau de bord, création d'amis, permissions
 *    par app, activation/suspension, journal de ses propres actions,
 *    identifiants des amis qu'il a lui-même créés. Il n'a JAMAIS accès au
 *    contenu d'un compte (ni séquestre, ni code d'accès, ni bascule vers un
 *    compte), ne touche ni à l'administrateur ni à un autre gestionnaire,
 *    ni aux réglages de sécurité, ni aux apps globales, et ne peut pas
 *    exporter le journal ;
 *  - **ami** : aucune Administration.
 *
 * Ces règles sont la SEULE source de vérité : l'interface les consulte pour
 * masquer ce qui est interdit, mais chaque action les revérifie (`exiger`,
 * et les fonctions de `actions.ts`), de sorte qu'un bouton oublié ne donne
 * jamais un droit. Aucun stockage, aucune horloge.
 */

import { ErreurProfil, ID_PRINCIPAL, type Profil } from '../../profils/profils';

export type RoleAdmin = 'admin' | 'gestionnaire' | 'ami';

export const LIBELLES_ROLE: Record<RoleAdmin, string> = {
  admin: 'Administrateur',
  gestionnaire: 'Gestionnaire',
  ami: 'Ami',
};

/** Rôle effectif d'un profil (un profil absent, appareil sans comptes, est l'administrateur). */
export function roleDe(profil: Pick<Profil, 'admin' | 'role'> | undefined): RoleAdmin {
  if (!profil || profil.admin) {
    return 'admin';
  }
  return profil.role === 'gestionnaire' ? 'gestionnaire' : 'ami';
}

export type ActionAdmin =
  // Consultation
  | 'voir-tableau'
  | 'voir-journal'
  // Comptes des amis
  | 'creer-ami'
  | 'permissions-ami'
  | 'etat-ami'
  | 'invitation-ami'
  | 'regenerer-identifiants'
  | 'renommer-ami'
  | 'supprimer-ami'
  | 'notes'
  // Réservé à l'administrateur
  | 'changer-role'
  | 'exporter-journal'
  | 'reglages-admin'
  | 'reglages-securite'
  | 'politique-apps'
  | 'acces-sequestre'
  | 'ouvrir-compte'
  | 'modifier-admin';

/** Ce que peut faire un gestionnaire (tout le reste lui est refusé). */
export const ACTIONS_GESTIONNAIRE: readonly ActionAdmin[] = [
  'voir-tableau',
  'voir-journal',
  'creer-ami',
  'permissions-ami',
  'etat-ami',
  'invitation-ami',
  'regenerer-identifiants',
];

/** Actions qui visent un compte précis (et dont la cible est donc vérifiée). */
const ACTIONS_SUR_CIBLE: readonly ActionAdmin[] = [
  'permissions-ami',
  'etat-ami',
  'invitation-ami',
  'regenerer-identifiants',
  'renommer-ami',
  'supprimer-ami',
  'notes',
  'changer-role',
  'acces-sequestre',
  'ouvrir-compte',
];

export class ErreurPermission extends ErreurProfil {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurPermission';
  }
}

export interface Verdict {
  ok: boolean;
  motif?: string;
}

const REFUS = (motif: string): Verdict => ({ ok: false, motif });

/**
 * L'acteur a-t-il le droit d'effectuer cette action, sur cette cible s'il y en a une ?
 * `cible` est le profil visé tel que l'acteur le connaît (avec `creePar` renseigné).
 */
export function autorise(acteur: Pick<Profil, 'id' | 'admin' | 'role'> | undefined, action: ActionAdmin, cible?: Pick<Profil, 'id' | 'admin' | 'role' | 'creePar'>): Verdict {
  if (!acteur) {
    return REFUS('Action refusée : aucun compte connu.');
  }
  const role = roleDe(acteur);
  if (role === 'ami') {
    return REFUS('Réservé à l’administrateur et aux gestionnaires.');
  }
  const visee = ACTIONS_SUR_CIBLE.includes(action);
  if (visee && !cible) {
    return REFUS('Compte visé introuvable.');
  }
  if (role === 'admin') {
    if (visee && cible && (cible.admin || cible.id === ID_PRINCIPAL) && action !== 'notes') {
      return REFUS('Action impossible sur le profil administrateur.');
    }
    return { ok: true };
  }
  // Gestionnaire.
  if (!ACTIONS_GESTIONNAIRE.includes(action)) {
    return REFUS('Réservé à l’administrateur : un gestionnaire ne peut pas faire cela.');
  }
  if (visee && cible) {
    if (cible.id === acteur.id) {
      return REFUS('Un gestionnaire ne modifie pas ses propres droits ni son propre compte.');
    }
    if (cible.admin || cible.id === ID_PRINCIPAL) {
      return REFUS('Un gestionnaire ne peut pas agir sur l’administrateur.');
    }
    if (roleDe(cible) !== 'ami') {
      return REFUS('Un gestionnaire ne peut pas agir sur un autre gestionnaire.');
    }
    if (action === 'regenerer-identifiants' && cible.creePar !== acteur.id) {
      return REFUS('Un gestionnaire ne régénère que les identifiants des amis qu’il a lui-même créés.');
    }
  }
  return { ok: true };
}

/** Comme `autorise`, mais lève `ErreurPermission` en cas de refus. */
export function exiger(acteur: Pick<Profil, 'id' | 'admin' | 'role'> | undefined, action: ActionAdmin, cible?: Pick<Profil, 'id' | 'admin' | 'role' | 'creePar'>): void {
  const verdict = autorise(acteur, action, cible);
  if (!verdict.ok) {
    throw new ErreurPermission(verdict.motif ?? 'Action refusée.');
  }
}

// --- Promotion / rétrogradation ------------------------------------------------

/** Ce que permet le rôle de gestionnaire : texte de la confirmation montrée à l'administrateur. */
export const CE_QUE_PERMET_GESTIONNAIRE: readonly string[] = [
  'voir le tableau de bord (chiffres globaux, sans aucun prénom) et le journal de ses propres actions ;',
  'créer et inviter des amis, puis gérer ceux qu’il a lui-même créés : accès par app, activation, suspension, identifiants.',
];
export const CE_QUE_NE_PERMET_PAS_GESTIONNAIRE: readonly string[] = [
  'ouvrir ou lire un compte : ni séquestre, ni code d’accès, ni bascule vers un compte ;',
  'voir ou modifier les autres comptes, vous-même ou un autre gestionnaire ;',
  'toucher à la sécurité, aux apps globales (activation, maintenance) ou exporter le journal.',
];

/** Nouvelle liste où le rôle de `id` est changé. Ne concerne que les amis et gestionnaires. */
export function definirRole(profils: readonly Profil[], id: string, role: 'ami' | 'gestionnaire'): Profil[] {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('Le profil administrateur n’a pas de rôle à changer.');
  }
  if (!profils.some(p => p.id === id && !p.admin)) {
    throw new ErreurProfil('Profil introuvable.');
  }
  return profils.map(p => {
    if (p.id !== id) {
      return p;
    }
    const suivant: Profil = { ...p };
    if (role === 'gestionnaire') {
      suivant.role = 'gestionnaire';
    } else {
      delete suivant.role;
    }
    return suivant;
  });
}
