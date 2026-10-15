/**
 * Rangs de l'Administration et droits de chacun, en données pures.
 *
 * Quatre rangs, strictement ordonnés :
 *
 *   Fondateur > Administrateur > Gestionnaire > Ami
 *
 *  - **Fondateur** : tout, sur les rangs inférieurs. Le compte historique
 *    (`principal`, l'ancien « administrateur ») est Fondateur et le reste ;
 *    il peut y en avoir plusieurs (seul un Fondateur en nomme un autre). Il
 *    promeut et rétrograde les Administrateurs, règle les apps globales ;
 *  - **Administrateur** : l'Administration complète sur les Gestionnaires et
 *    les Amis — y compris ouvrir leur compte par séquestre avec SES propres
 *    codes d'accès —, mais jamais sur un Fondateur ni sur un autre
 *    Administrateur, et il ne nomme personne Administrateur ou Fondateur ;
 *  - **Gestionnaire** : une Administration LIMITÉE (amis qu'il a créés, sans
 *    aucun accès au contenu d'un compte) ;
 *  - **Ami** : aucune Administration.
 *
 * Règle d'or : un rang n'agit que sur des rangs STRICTEMENT inférieurs (voir,
 * modifier, suspendre, supprimer, régénérer, ouvrir, envoyer un code de
 * connexion, changer le rang). Ces règles sont la SEULE source de vérité :
 * l'interface les consulte pour masquer ce qui est interdit, mais chaque
 * action les revérifie (`exiger`, `actions.ts`, l'hôte `bureau/index.tsx`) ;
 * un bouton oublié ne donne jamais un droit. Aucun stockage, aucune horloge.
 *
 * La cryptographie suit la même règle (`docs/hub/sequestre.md`) : la clé
 * maîtresse d'un compte n'est scellée que pour les titulaires de rang
 * strictement supérieur ; un droit « oublié » ici ne suffirait donc toujours
 * pas à ouvrir un compte.
 */

import { ErreurProfil, ID_PRINCIPAL, type Profil, type RoleProfil } from '../../profils/profils';

export type Rang = 'fondateur' | 'administrateur' | 'gestionnaire' | 'ami';
/** Ancien nom (rôles) : c'est désormais le rang. */
export type RoleAdmin = Rang;

/** Ordre des rangs : plus grand = plus haut. */
export const NIVEAU_RANG: Record<Rang, number> = { ami: 0, gestionnaire: 1, administrateur: 2, fondateur: 3 };

/** Du plus haut au plus bas. */
export const RANGS: readonly Rang[] = ['fondateur', 'administrateur', 'gestionnaire', 'ami'];

export const LIBELLES_RANG: Record<Rang, string> = {
  fondateur: 'Fondateur',
  administrateur: 'Administrateur',
  gestionnaire: 'Gestionnaire',
  ami: 'Ami',
};
export const LIBELLES_ROLE = LIBELLES_RANG;

/** Rangs dont la clé de séquestre reçoit les comptes inférieurs (titulaires). */
export const RANGS_TITULAIRES: readonly Rang[] = ['fondateur', 'administrateur'];

export function estRang(valeur: unknown): valeur is Rang {
  return valeur === 'fondateur' || valeur === 'administrateur' || valeur === 'gestionnaire' || valeur === 'ami';
}

type ProfilRang = Pick<Profil, 'admin' | 'role'> & { id?: string };

/**
 * Rang effectif d'un profil. Le compte historique (`admin`, ou `principal`)
 * est toujours Fondateur, quoi que dise son champ `role` ; un profil absent
 * (appareil sans comptes) aussi. Le reste : le champ `role` (absent = ami).
 */
export function rangDe(profil: ProfilRang | undefined): Rang {
  if (!profil || profil.admin || profil.id === ID_PRINCIPAL) {
    return 'fondateur';
  }
  return estRang(profil.role) ? profil.role : 'ami';
}
export const roleDe = rangDe;

export const estTitulaire = (profil: ProfilRang | undefined): boolean => RANGS_TITULAIRES.includes(rangDe(profil));

/** `a` est-il strictement au-dessus de `b` ? */
export function superieur(a: ProfilRang | undefined, b: ProfilRang | undefined): boolean {
  return NIVEAU_RANG[rangDe(a)] > NIVEAU_RANG[rangDe(b)];
}

export type ActionAdmin =
  // Consultation
  | 'voir-tableau'
  | 'voir-journal'
  | 'voir-compte'
  // Comptes
  | 'creer-ami'
  | 'permissions-ami'
  | 'etat-ami'
  | 'invitation-ami'
  | 'regenerer-identifiants'
  | 'renommer-ami'
  | 'supprimer-ami'
  | 'notes'
  | 'code-site'
  /** Adresse e-mail et historique des invitations d'un compte (données chiffrées de l'acteur). */
  | 'contact-ami'
  // Rangs
  | 'changer-rang'
  /** Ancien nom de `changer-rang`. */
  | 'changer-role'
  // Panneau et journal
  | 'exporter-journal'
  | 'reglages-admin'
  | 'reglages-securite'
  // Fondateurs seulement
  /** Réglages des comptes et invitations : modèle du message, politique de mot de passe des amis, appareils, durée par défaut. */
  | 'reglages-comptes'
  /** Sauvegarde chiffrée (export / import) des données de l'Administration. */
  | 'sauvegarde-admin'
  | 'politique-apps'
  | 'modifier-admin'
  // Abonnements (suivi manuel) : Fondateurs seulement, sur des rangs strictement inférieurs
  | 'abonnements-voir'
  | 'abonnements-gerer'
  | 'abonnements-reglages'
  // Séquestre
  | 'acces-sequestre'
  | 'ouvrir-compte';

/** Ce que peut faire un gestionnaire (tout le reste lui est refusé). */
export const ACTIONS_GESTIONNAIRE: readonly ActionAdmin[] = [
  'voir-tableau',
  'voir-journal',
  'creer-ami',
  'permissions-ami',
  'etat-ami',
  'invitation-ami',
  'regenerer-identifiants',
  'contact-ami',
];

/**
 * Ce que ne peut PAS faire un administrateur (en plus de la règle des rangs) :
 * les apps globales, et renommer un compte (le prénom vit dans le bloc privé
 * des Fondateurs). `code-site` exige le jeton maître du relais, qui reste aux
 * Fondateurs.
 */
export const ACTIONS_REFUSEES_ADMINISTRATEUR: readonly ActionAdmin[] = [
  'politique-apps',
  'modifier-admin',
  'renommer-ami',
  'code-site',
  // Réglages des comptes (politique des mots de passe des amis, modèle d'invitation) et sauvegarde : Fondateurs.
  'reglages-comptes',
  'sauvegarde-admin',
  // Abonnements : option la plus protectrice. Ces données (paiements, notes) vivent dans la base chiffrée du
  // compte historique ; un Administrateur n'y touche pas, même sur ses Gestionnaires et Amis.
  'abonnements-voir',
  'abonnements-gerer',
  'abonnements-reglages',
];

/** Actions qui visent un compte précis (et dont la cible est donc vérifiée). */
const ACTIONS_SUR_CIBLE: readonly ActionAdmin[] = [
  'voir-compte',
  'permissions-ami',
  'etat-ami',
  'invitation-ami',
  'regenerer-identifiants',
  'renommer-ami',
  'supprimer-ami',
  'notes',
  'code-site',
  'contact-ami',
  'changer-rang',
  'changer-role',
  'acces-sequestre',
  'ouvrir-compte',
  'abonnements-gerer',
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

type Acteur = Pick<Profil, 'id' | 'admin' | 'role'>;
type Cible = Pick<Profil, 'id' | 'admin' | 'role' | 'creePar'>;

/**
 * L'acteur a-t-il le droit d'effectuer cette action, sur cette cible s'il y en a une ?
 * `cible` est le profil visé tel que l'acteur le connaît (avec `creePar` renseigné).
 */
export function autorise(acteur: Acteur | undefined, action: ActionAdmin, cible?: Cible): Verdict {
  if (!acteur) {
    return REFUS('Action refusée : aucun compte connu.');
  }
  const rang = rangDe(acteur);
  if (rang === 'ami') {
    return REFUS('Réservé aux fondateurs, administrateurs et gestionnaires.');
  }
  const visee = ACTIONS_SUR_CIBLE.includes(action);
  if (visee && !cible) {
    return REFUS('Compte visé introuvable.');
  }
  if (rang === 'gestionnaire' && !ACTIONS_GESTIONNAIRE.includes(action)) {
    return REFUS('Un gestionnaire ne peut pas faire cela.');
  }
  if (rang === 'administrateur' && ACTIONS_REFUSEES_ADMINISTRATEUR.includes(action)) {
    return REFUS(action === 'politique-apps' ? 'Réservé aux fondateurs : les apps globales.' : 'Réservé aux fondateurs.');
  }
  if (visee && cible) {
    const soi = cible.id === acteur.id;
    // Ses propres notes : sans risque (elles sont chiffrées avec ses données).
    if (soi && action === 'notes' && rang !== 'gestionnaire') {
      return { ok: true };
    }
    if (soi) {
      return REFUS('On n’agit pas sur son propre compte depuis l’Administration.');
    }
    const rangCible = rangDe(cible);
    if (NIVEAU_RANG[rangCible] >= NIVEAU_RANG[rang]) {
      if (rangCible === 'fondateur') {
        return REFUS('Action impossible sur un Fondateur.');
      }
      if (rangCible === rang) {
        return REFUS(`Un ${LIBELLES_RANG[rang].toLowerCase()} n’agit pas sur un autre ${LIBELLES_RANG[rang].toLowerCase()}.`);
      }
      return REFUS(`Un ${LIBELLES_RANG[rang].toLowerCase()} n’agit pas sur un rang supérieur.`);
    }
    if (rang === 'gestionnaire' && action === 'regenerer-identifiants' && cible.creePar !== acteur.id) {
      return REFUS('Un gestionnaire ne régénère que les identifiants des amis qu’il a lui-même créés.');
    }
  }
  return { ok: true };
}

/** Comme `autorise`, mais lève `ErreurPermission` en cas de refus. */
export function exiger(acteur: Acteur | undefined, action: ActionAdmin, cible?: Cible): void {
  const verdict = autorise(acteur, action, cible);
  if (!verdict.ok) {
    throw new ErreurPermission(verdict.motif ?? 'Action refusée.');
  }
}

// --- Changer le rang -----------------------------------------------------------

/**
 * Rangs que `acteur` peut donner à `cible` (hors son rang actuel) : un
 * Fondateur, tous (jusqu'à Fondateur) ; un Administrateur, Gestionnaire ou
 * Ami ; personne d'autre. La cible doit être strictement inférieure.
 */
export function rangsAttribuables(acteur: Acteur | undefined, cible: Cible | undefined): Rang[] {
  return rangsPermis(acteur, cible).filter(r => !cible || r !== rangDe(cible));
}

/** Comme `rangsAttribuables`, rang actuel compris (redonner le même rang ne change rien). */
function rangsPermis(acteur: Acteur | undefined, cible: Cible | undefined): Rang[] {
  if (!acteur || !cible || !autorise(acteur, 'changer-rang', cible).ok) {
    return [];
  }
  return rangDe(acteur) === 'fondateur' ? ['fondateur', 'administrateur', 'gestionnaire', 'ami'] : rangDe(acteur) === 'administrateur' ? ['gestionnaire', 'ami'] : [];
}

export function exigerRang(acteur: Acteur | undefined, cible: Cible | undefined, rang: Rang): void {
  exiger(acteur, 'changer-rang', cible);
  if (!rangsPermis(acteur, cible).includes(rang)) {
    throw new ErreurPermission(
      rang === 'fondateur' || rang === 'administrateur' ? `Seul un Fondateur nomme un ${LIBELLES_RANG[rang]}.` : 'Ce rang ne peut pas être attribué ici.',
    );
  }
}

/** Nombre de Fondateurs actifs de la liste (le compte historique compte toujours). */
export function nombreFondateurs(profils: readonly Pick<Profil, 'id' | 'admin' | 'role' | 'actif'>[]): number {
  return profils.filter(p => rangDe(p) === 'fondateur' && (p.admin || p.actif !== false)).length;
}

/**
 * Nouvelle liste où le rang de `id` est changé. Le compte historique reste
 * Fondateur ; il reste toujours au moins un Fondateur actif.
 */
export function definirRang(profils: readonly Profil[], id: string, rang: Rang): Profil[] {
  if (id === ID_PRINCIPAL || profils.some(p => p.id === id && p.admin)) {
    throw new ErreurProfil('Le compte historique reste Fondateur : son rang ne change pas.');
  }
  if (!profils.some(p => p.id === id)) {
    throw new ErreurProfil('Profil introuvable.');
  }
  const suivants = profils.map(p => {
    if (p.id !== id) {
      return p;
    }
    const suivant: Profil = { ...p };
    if (rang === 'ami') {
      delete suivant.role;
    } else {
      suivant.role = rang as RoleProfil;
    }
    return suivant;
  });
  if (nombreFondateurs(suivants) < 1) {
    throw new ErreurProfil('Il doit toujours rester au moins un Fondateur actif.');
  }
  return suivants;
}

/** Ancien nom (rôle de gestionnaire seulement). */
export function definirRole(profils: readonly Profil[], id: string, role: 'ami' | 'gestionnaire'): Profil[] {
  return definirRang(profils, id, role);
}

// --- Textes ----------------------------------------------------------------------

/** Ce que permet le rôle de gestionnaire : texte de la confirmation. */
export const CE_QUE_PERMET_GESTIONNAIRE: readonly string[] = [
  'voir le tableau de bord (chiffres globaux, sans aucun prénom) et le journal de ses propres actions ;',
  'créer et inviter des amis, puis gérer ceux qu’il a lui-même créés : accès par app, activation, suspension, identifiants.',
];
export const CE_QUE_NE_PERMET_PAS_GESTIONNAIRE: readonly string[] = [
  'ouvrir ou lire un compte : ni séquestre, ni code d’accès, ni bascule vers un compte ;',
  'voir ou modifier les autres comptes, vous-même ou un autre gestionnaire ;',
  'toucher à la sécurité, aux apps globales (activation, maintenance) ou exporter le journal.',
];

/** Ce que permet chaque rang (confirmation de « Changer le rang »). */
export const CE_QUE_PERMET: Record<Rang, readonly string[]> = {
  fondateur: [
    'tout, sur les Administrateurs, Gestionnaires et Amis : ouvrir leur compte avec ses propres codes d’accès, les promouvoir, les rétrograder ;',
    'nommer d’autres Fondateurs et régler les apps globales.',
  ],
  administrateur: [
    'l’Administration complète sur les Gestionnaires et les Amis, y compris ouvrir leur compte avec SES propres codes d’accès (chaque accès est journalisé) ;',
    'l’Administration sur le site aussi, avec son code de connexion.',
  ],
  gestionnaire: CE_QUE_PERMET_GESTIONNAIRE,
  ami: ['aucune Administration : son compte, ses apps.'],
};
export const CE_QUE_NE_PERMET_PAS: Record<Rang, readonly string[]> = {
  fondateur: ['agir sur un autre Fondateur (même rang) : ni voir son contenu, ni le modifier, ni le rétrograder.'],
  administrateur: [
    'voir, ouvrir, modifier, suspendre ou supprimer un Fondateur ou un autre Administrateur ;',
    'nommer quelqu’un Administrateur ou Fondateur, renommer un compte, ni régler les apps globales.',
  ],
  gestionnaire: CE_QUE_NE_PERMET_PAS_GESTIONNAIRE,
  ami: [],
};

/** Qui peut accéder au compte d'un rang donné (transparence) ; rien pour un Fondateur. */
export function texteTransparence(rang: Rang): string | undefined {
  switch (rang) {
    case 'fondateur':
      return undefined;
    case 'administrateur':
      return 'Les fondateurs peuvent accéder à ton compte.';
    default:
      return 'Les administrateurs et fondateurs peuvent accéder à ton compte.';
  }
}
