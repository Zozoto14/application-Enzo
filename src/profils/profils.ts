/**
 * Profils : plusieurs personnes sur le même appareil, chacune avec son
 * portefeuille, son mot de passe et son code d'authentification.
 *
 * Le profil principal est celui qui existait avant les profils : c'est
 * l'**administrateur**. Lui seul ajoute ou supprime un profil — depuis ses
 * Paramètres, donc déverrouillé. Il ne peut pas lire les autres : chaque
 * profil a son propre coffre, et son portefeuille est scellé par sa propre
 * clé.
 *
 * La liste ne contient que des prénoms et des identifiants : elle doit être
 * lisible avant tout déverrouillage, pour qu'on puisse choisir qui ouvre.
 */

import { estNiveau, type NiveauAcces } from '../hub/admin/niveaux';
import { ecrirePolitique, lirePolitique, type PolitiqueHub } from '../hub/admin/politique';

export const ID_PRINCIPAL = 'principal';

/**
 * Version du format de la liste, portée par l'entrée de l'administrateur.
 * 1 : prénoms, apps, actif (hub). 2 : niveaux d'accès, invitations,
 * expirations, dernière connexion, politique des apps. Une version 1 se lit
 * telle quelle (voir `migrerProfil`) ; une version antérieure de l'app qui
 * lirait une liste 2 en ignore simplement les champs nouveaux.
 */
export const VERSION_PROFILS = 2;
// Le rôle (facultatif, « ami » par défaut) s'ajoute à la version 2 sans la changer :
// une version antérieure ignore simplement le champ.

/**
 * Séquestre d'un compte ami (vu par l'administrateur seulement) :
 * `actif` — ouvrable avec le code d'accès ; `depose` — dépôt reçu, à
 * convertir ; `attendu` — créé à la prochaine connexion de l'ami ;
 * `revoque` — l'administrateur y a renoncé.
 */
export type EtatSequestre = 'actif' | 'depose' | 'attendu' | 'revoque' | 'absent';

/**
 * Rôle d'un compte qui n'est pas l'administrateur. Absent = « ami » (défaut
 * des listes enregistrées avant les rôles : rien à migrer, rien à perdre).
 * « gestionnaire » : un ami à qui l'administrateur confie une Administration
 * limitée (voir `src/hub/admin/roles.ts`) — jamais le contenu d'un compte.
 */
export type RoleProfil = 'ami' | 'gestionnaire' | 'administrateur' | 'fondateur';

export function estRole(valeur: unknown): valeur is RoleProfil {
  return valeur === 'ami' || valeur === 'gestionnaire' || valeur === 'administrateur' || valeur === 'fondateur';
}

/** Rang enregistré d'un compte (jamais « ami », qui est l'absence de rang). */
export function roleEnregistre(valeur: unknown): Exclude<RoleProfil, 'ami'> | undefined {
  return valeur === 'gestionnaire' || valeur === 'administrateur' || valeur === 'fondateur' ? valeur : undefined;
}

export interface Profil {
  id: string;
  nom: string;
  admin: boolean;
  creeLe: string;
  /**
   * Apps du hub ouvertes à ce profil (identifiants du registre, voir
   * `src/hub/registre.tsx`). Sans objet pour l'administrateur, qui voit tout.
   */
  apps?: string[];
  /** Faux : désactivé par l'administrateur, le profil ne s'ouvre plus. */
  actif?: boolean;
  /**
   * Niveau des apps ouvertes quand il n'est pas « accès complet » (seule
   * « lecture » y figure) ; `apps` reste la liste qui fait foi pour l'accès.
   */
  niveaux?: Record<string, NiveauAcces>;
  /** Invitation en attente : l'ami doit ouvrir son profil avant cette date (ISO). */
  invitationExpireLe?: string;
  /** Fin d'accès du compte (ISO) : au-delà, il ne s'ouvre plus. */
  expireLe?: string;
  /** Désactivation temporaire : le profil se rouvre seul à cette date (ISO). */
  desactiveJusquau?: string;
  /** Dernière ouverture du profil sur cet appareil (ISO). */
  derniereConnexion?: string;
  connexions?: number;
  /** Compte antérieur au suivi des connexions : « jamais connecté » n'a pas de sens pour lui. */
  anterieur?: boolean;
  /** Entrée de l'administrateur seulement : politique globale des apps. */
  politique?: PolitiqueHub;
  /** Vue de l'administrateur : état du séquestre de ce compte ami. */
  sequestre?: EtatSequestre;
  /** Rang du compte ; absent pour le compte historique (toujours Fondateur), et pour un ami « ordinaire ». */
  role?: RoleProfil;
  /**
   * Vue d'un titulaire : état de la paire de séquestre d'un Administrateur ou
   * d'un Fondateur — `actif` (confirmée, les comptes inférieurs lui sont
   * scellés) ou `en-attente` (créée à sa prochaine connexion, ou à confirmer
   * par un Fondateur).
   */
  titulaire?: 'actif' | 'en-attente';
  /** Vue de l'administrateur : identifiant du gestionnaire qui a créé ce compte, s'il y en a un. */
  creePar?: string;
}

const PRINCIPAL: Profil = { id: ID_PRINCIPAL, nom: 'Moi', admin: true, creeLe: '' };
const MOTIF_ID = /^[a-z0-9]{6,16}$/;
const MOTIF_APP = /^[a-z0-9-]{2,32}$/;

/**
 * Apps d'un profil d'ami enregistré avant le hub : le portefeuille, qui était
 * alors tout ce qu'il pouvait ouvrir. Il ne perd donc rien à la mise à jour.
 */
export const APPS_PAR_DEFAUT: readonly string[] = ['portefeuille'];

/** Liste d'apps propre : identifiants valides, sans doublon. */
export function nettoyerApps(apps: unknown): string[] {
  if (!Array.isArray(apps)) {
    return [...APPS_PAR_DEFAUT];
  }
  return [...new Set(apps.filter((app): app is string => typeof app === 'string' && MOTIF_APP.test(app)))];
}

/** Niveaux propres : seulement ceux des apps ouvertes, et seulement s'ils restreignent. */
export function nettoyerNiveaux(niveaux: unknown, apps: readonly string[]): Record<string, NiveauAcces> | undefined {
  if (!niveaux || typeof niveaux !== 'object' || Array.isArray(niveaux)) {
    return undefined;
  }
  const propres = Object.entries(niveaux as Record<string, unknown>).filter(
    (entree): entree is [string, NiveauAcces] => apps.includes(entree[0]) && estNiveau(entree[1]) && entree[1] === 'lecture',
  );
  return propres.length > 0 ? Object.fromEntries(propres) : undefined;
}

/** Date ISO valide, ou rien. */
function dateIso(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.length <= 40 && !Number.isNaN(Date.parse(valeur)) ? valeur : undefined;
}

/**
 * Relit une entrée d'ami, quelle que soit la version qui l'a écrite.
 * Version 1 (ou absente) : rien de plus que prénom, apps et actif ; on la
 * marque « antérieure » pour ne pas la signaler comme jamais connectée.
 */
function migrerProfil(p: Record<string, unknown>, version: number): Profil {
  const apps = nettoyerApps(p.apps);
  const profil: Profil = {
    id: String(p.id),
    nom: String(p.nom),
    admin: false,
    creeLe: String(p.creeLe ?? ''),
    apps,
    actif: p.actif !== false,
  };
  const niveaux = nettoyerNiveaux(p.niveaux, apps);
  const optionnels = {
    // Rang « ami » par défaut : seuls Gestionnaire, Administrateur et Fondateur sont conservés.
    role: roleEnregistre(p.role),
    niveaux,
    invitationExpireLe: dateIso(p.invitationExpireLe),
    expireLe: dateIso(p.expireLe),
    desactiveJusquau: dateIso(p.desactiveJusquau),
    derniereConnexion: dateIso(p.derniereConnexion),
    connexions: typeof p.connexions === 'number' && Number.isFinite(p.connexions) && p.connexions >= 0 ? Math.floor(p.connexions) : undefined,
    anterieur: version < 2 || p.anterieur === true ? true : undefined,
  };
  for (const [cle, valeur] of Object.entries(optionnels)) {
    if (valeur !== undefined) {
      (profil as unknown as Record<string, unknown>)[cle] = valeur;
    }
  }
  return profil;
}

/** Lit la liste enregistrée ; le profil principal y est toujours, en tête. */
export function lireProfils(brut: string | undefined): Profil[] {
  let lus: unknown = [];
  try {
    lus = brut ? JSON.parse(brut) : [];
  } catch {
    lus = [];
  }
  const liste = (Array.isArray(lus) ? lus : []) as Array<Record<string, unknown> | null>;
  const principal = liste.find(p => p?.id === ID_PRINCIPAL);
  const version = typeof principal?.v === 'number' ? principal.v : 1;
  const autres = liste
    .filter((p): p is Record<string, unknown> => !!p && typeof p.id === 'string' && p.id !== ID_PRINCIPAL && MOTIF_ID.test(p.id) && typeof p.nom === 'string')
    .map(p => migrerProfil(p, version));
  const admin: Profil = { ...PRINCIPAL, nom: typeof principal?.nom === 'string' ? principal.nom : PRINCIPAL.nom };
  if (typeof principal?.creeLe === 'string') {
    admin.creeLe = principal.creeLe;
  }
  const politique = principal?.politique !== undefined ? ecrirePolitique(lirePolitique(principal.politique)) : undefined;
  if (politique) {
    admin.politique = lirePolitique(politique);
  }
  const derniere = dateIso(principal?.derniereConnexion);
  if (derniere) {
    admin.derniereConnexion = derniere;
  }
  return [admin, ...autres];
}

export function ecrireProfils(profils: readonly Profil[]): string {
  return JSON.stringify(
    profils.map(p => {
      if (p.admin) {
        return { id: p.id, nom: p.nom, creeLe: p.creeLe, v: VERSION_PROFILS, politique: p.politique ? ecrirePolitique(p.politique) : undefined, derniereConnexion: p.derniereConnexion };
      }
      const apps = nettoyerApps(p.apps ?? APPS_PAR_DEFAUT);
      return {
        id: p.id,
        nom: p.nom,
        creeLe: p.creeLe,
        apps,
        actif: p.actif !== false,
        role: roleEnregistre(p.role),
        niveaux: nettoyerNiveaux(p.niveaux, apps),
        invitationExpireLe: p.invitationExpireLe,
        expireLe: p.expireLe,
        desactiveJusquau: p.desactiveJusquau,
        derniereConnexion: p.derniereConnexion,
        connexions: p.connexions,
        anterieur: p.anterieur,
      };
    }),
  );
}

export class ErreurProfil extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurProfil';
  }
}

/** Réglages facultatifs d'un compte créé depuis l'Administration. */
export interface OptionsNouveauProfil {
  niveaux?: Record<string, NiveauAcces>;
  invitationExpireLe?: string;
  expireLe?: string;
}

export function ajouterProfil(
  profils: readonly Profil[],
  nom: string,
  id: string,
  maintenant: string,
  apps: readonly string[] = APPS_PAR_DEFAUT,
  options: OptionsNouveauProfil = {},
): Profil[] {
  const propre = nom.trim().slice(0, 30);
  if (!propre) {
    throw new ErreurProfil('Donnez un prénom au profil.');
  }
  if (profils.some(p => p.nom.toLowerCase() === propre.toLowerCase())) {
    throw new ErreurProfil(`Un profil « ${propre} » existe déjà.`);
  }
  if (!MOTIF_ID.test(id)) {
    throw new ErreurProfil('Identifiant de profil invalide.');
  }
  const nouveau: Profil = { id, nom: propre, admin: false, creeLe: maintenant, apps: nettoyerApps(apps), actif: true };
  const niveaux = nettoyerNiveaux(options.niveaux, nouveau.apps ?? []);
  if (niveaux) {
    nouveau.niveaux = niveaux;
  }
  if (options.invitationExpireLe) {
    nouveau.invitationExpireLe = options.invitationExpireLe;
  }
  if (options.expireLe) {
    nouveau.expireLe = options.expireLe;
  }
  return [...profils, nouveau];
}

export function supprimerProfil(profils: readonly Profil[], id: string): Profil[] {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('Le profil administrateur ne se supprime pas.');
  }
  return profils.filter(p => p.id !== id);
}

export function renommerProfil(profils: readonly Profil[], id: string, nom: string): Profil[] {
  const propre = nom.trim().slice(0, 30);
  if (!propre) {
    throw new ErreurProfil('Donnez un prénom au profil.');
  }
  if (profils.some(p => p.id !== id && p.nom.toLowerCase() === propre.toLowerCase())) {
    throw new ErreurProfil(`Un profil « ${propre} » existe déjà.`);
  }
  return profils.map(p => (p.id === id ? { ...p, nom: propre } : p));
}

/** Change les apps ouvertes à un ami ; l'administrateur, lui, voit tout. */
export function autoriserApps(profils: readonly Profil[], id: string, apps: readonly string[]): Profil[] {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('L’administrateur a accès à toutes les apps.');
  }
  return profils.map(p => {
    if (p.id !== id) {
      return p;
    }
    const propres = nettoyerApps(apps);
    const suivant: Profil = { ...p, apps: propres };
    const niveaux = nettoyerNiveaux(p.niveaux, propres);
    if (niveaux) {
      suivant.niveaux = niveaux;
    } else {
      delete suivant.niveaux;
    }
    return suivant;
  });
}

/** Active ou désactive un ami. L'administrateur ne se désactive pas. */
export function activerProfil(profils: readonly Profil[], id: string, actif: boolean): Profil[] {
  if (id === ID_PRINCIPAL) {
    throw new ErreurProfil('Le profil administrateur ne se désactive pas.');
  }
  return profils.map(p => {
    if (p.id !== id) {
      return p;
    }
    const suivant: Profil = { ...p, actif };
    // Réactiver à la main annule la date de réactivation prévue.
    delete suivant.desactiveJusquau;
    return suivant;
  });
}

/**
 * Pourquoi un profil ne s'ouvre pas, ou rien s'il s'ouvre. L'administrateur
 * s'ouvre toujours. Une désactivation temporaire échue ne ferme plus rien.
 */
export function motifFermeture(profil: Profil, maintenant: number = Date.now()): string | undefined {
  if (profil.admin) {
    return undefined;
  }
  if (profil.actif === false) {
    const fin = profil.desactiveJusquau ? Date.parse(profil.desactiveJusquau) : Number.NaN;
    if (Number.isNaN(fin) || maintenant < fin) {
      return Number.isNaN(fin)
        ? 'Ce profil est désactivé : demandez à l’administrateur de le réactiver.'
        : `Ce profil est suspendu jusqu’au ${new Date(fin).toLocaleDateString('fr-FR')}.`;
    }
  }
  if (profil.expireLe && maintenant >= Date.parse(profil.expireLe)) {
    return 'L’accès de ce profil a expiré : demandez à l’administrateur de le prolonger.';
  }
  if (profil.invitationExpireLe && !profil.derniereConnexion && maintenant >= Date.parse(profil.invitationExpireLe)) {
    return 'L’invitation de ce profil a expiré : demandez à l’administrateur de la prolonger.';
  }
  return undefined;
}

/** Vrai quand le profil peut être ouvert (l'administrateur l'est toujours). */
export function profilOuvrable(profil: Profil, maintenant: number = Date.now()): boolean {
  return motifFermeture(profil, maintenant) === undefined;
}

/**
 * Note l'ouverture d'un profil sur cet appareil : date, compteur, et fin de
 * l'invitation (elle est acceptée). Ne touche à rien d'autre.
 */
export function noterConnexion(profils: readonly Profil[], id: string, maintenantIso: string): Profil[] {
  return profils.map(p => {
    if (p.id !== id) {
      return p;
    }
    const suivant: Profil = { ...p, derniereConnexion: maintenantIso };
    if (!p.admin) {
      suivant.connexions = (p.connexions ?? 0) + 1;
      delete suivant.invitationExpireLe;
    }
    return suivant;
  });
}

/**
 * Contrôle d'une liste modifiée par l'Administration avant de l'enregistrer :
 * mêmes profils (ni ajout ni retrait par ce chemin, qui ne crée ni n'efface
 * de fichier), prénoms uniques, et un passage par l'écriture/relecture qui
 * retire tout champ inattendu (un ami ne devient jamais administrateur).
 */
export function validerModification(avant: readonly Profil[], apres: readonly Profil[]): Profil[] {
  const ids = (liste: readonly Profil[]) => liste.map(p => p.id).sort().join(',');
  if (ids(avant) !== ids(apres)) {
    throw new ErreurProfil('Modification refusée : la liste des profils a changé entre-temps.');
  }
  const noms = new Set(apres.map(p => p.nom.trim().toLowerCase()));
  if (noms.size !== apres.length || apres.some(p => !p.nom.trim())) {
    throw new ErreurProfil('Deux profils ne peuvent pas porter le même prénom.');
  }
  return lireProfils(ecrireProfils(apres.map(p => ({ ...p, nom: p.nom.trim().slice(0, 30), admin: p.id === ID_PRINCIPAL }))));
}

/** Fichiers d'un profil : ceux d'avant pour le principal, suffixés sinon. */
export function fichiersDuProfil(id: string): { coffre: string; portefeuille: string } {
  return id === ID_PRINCIPAL
    ? { coffre: 'coffre', portefeuille: 'portefeuille' }
    : { coffre: `coffre-${id}`, portefeuille: `portefeuille-${id}` };
}

/** Identifiant aléatoire de 10 caractères. */
export function nouvelIdentifiant(alea: (n: number) => Uint8Array): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(alea(10), octet => alphabet[octet % alphabet.length]).join('');
}
