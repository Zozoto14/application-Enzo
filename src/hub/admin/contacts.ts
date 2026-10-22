/**
 * Contacts des comptes, propres à l'Administration : l'adresse e-mail de
 * chaque ami et l'historique des invitations envoyées (date, canal).
 *
 * Ces données vivent **uniquement** dans les données chiffrées de
 * l'Administration du compte qui les saisit (`donnees.ts`, base chiffrée du
 * Fondateur ; synchronisées entre SES appareils, scellées par sa clé de
 * synchronisation, `fusionDonnees.ts`). Elles ne sont jamais écrites dans la
 * liste des profils (lisible par le hub des amis), jamais publiées en clair
 * sur le relais, jamais inscrites au journal (le journal dit « invitation
 * envoyée par e-mail », pas l'adresse).
 *
 * Aucun e-mail ne part d'un serveur : « Envoyer par e-mail » ouvre la
 * messagerie de l'appareil (lien `mailto:`, voir `modeleInvitation.ts`).
 *
 * Tout est pur : l'horloge est passée en argument.
 */

export const LONGUEUR_MAX_EMAIL = 254;
/** Envois gardés par compte (les plus récents). */
export const MAX_ENVOIS = 30;
const MOTIF_ID = /^[a-z0-9]{2,16}$/;

/** Canal par lequel une invitation a été transmise. */
export type CanalInvitation = 'email' | 'copie' | 'partage' | 'qr' | 'lien';
export const CANAUX: readonly CanalInvitation[] = ['email', 'copie', 'partage', 'qr', 'lien'];
export const LIBELLES_CANAL: Record<CanalInvitation, string> = {
  email: 'E-mail',
  copie: 'Message copié',
  partage: 'Partage',
  qr: 'QR code',
  lien: 'Lien copié',
};

export interface EnvoiInvitation {
  /** Horodatage ISO. */
  date: string;
  canal: CanalInvitation;
  /** Vrai pour une relance (le compte avait déjà reçu une invitation). */
  relance?: boolean;
}

/** Langue d'un compte pour les e-mails (et l'interface Esport tant que l'utilisateur n'a pas choisi la sienne). */
export type LangueCompte = 'fr' | 'en';
export const LANGUES_COMPTE: readonly LangueCompte[] = ['fr', 'en'];
export const NOMS_LANGUES: Record<LangueCompte, string> = { fr: 'Français', en: 'English' };
export const estLangueCompte = (v: unknown): v is LangueCompte => v === 'fr' || v === 'en';

export interface ContactCompte {
  email?: string;
  /** Dernière modification de l'adresse (ISO) : départage deux appareils. */
  emailLe?: string;
  /**
   * Langue par défaut du compte, réglée par le Fondateur (absente : français). Elle suit l'adresse : chiffrée
   * avec les données de l'Administration, jointe à la demande d'envoi d'un e-mail (le serveur ne la garde pas).
   */
  langue?: LangueCompte;
  envois: EnvoiInvitation[];
}

/**
 * Adresse e-mail plausible (la seule vraie vérification est l'envoi) : une
 * partie locale, un @, un domaine à points, une extension alphabétique.
 */
export function emailValide(email: string): boolean {
  const e = email.trim();
  if (e.length < 6 || e.length > LONGUEUR_MAX_EMAIL) return false;
  const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(e);
  if (!m) return false;
  const [, local, domaine] = m;
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const parties = domaine.split('.');
  if (parties.some(p => p.length === 0 || p.length > 63 || p.startsWith('-') || p.endsWith('-'))) return false;
  return /^[A-Za-z]{2,}$/.test(parties[parties.length - 1]);
}

/** Forme enregistrée : sans espaces ni « mailto: », domaine en minuscules (la partie locale est gardée telle quelle). */
export function normaliserEmail(saisie: string): string {
  const propre = saisie.trim().replace(/^mailto:/i, '').replace(/\s+/g, '');
  const arobase = propre.lastIndexOf('@');
  return arobase < 0 ? propre : `${propre.slice(0, arobase)}@${propre.slice(arobase + 1).toLowerCase()}`;
}

/** Message d'erreur d'une saisie (vide : facultatif, donc valable), ou undefined si elle est bonne. */
export function erreurEmail(saisie: string): string | undefined {
  const propre = normaliserEmail(saisie);
  if (!propre) return undefined;
  return emailValide(propre) ? undefined : 'Adresse e-mail invalide (exemple : lea@exemple.fr).';
}

function lireEnvoi(brut: unknown): EnvoiInvitation | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  if (typeof o.date !== 'string' || Number.isNaN(Date.parse(o.date)) || !CANAUX.includes(o.canal as CanalInvitation)) return undefined;
  return { date: o.date, canal: o.canal as CanalInvitation, ...(o.relance === true ? { relance: true } : {}) };
}

/** Lecture défensive d'un contact : toute valeur inattendue est écartée. */
export function lireContact(brut: unknown): ContactCompte | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const contact: ContactCompte = { envois: [] };
  if (typeof o.email === 'string' && emailValide(o.email)) contact.email = normaliserEmail(o.email);
  if (typeof o.emailLe === 'string' && !Number.isNaN(Date.parse(o.emailLe))) contact.emailLe = o.emailLe;
  if (estLangueCompte(o.langue)) contact.langue = o.langue;
  if (Array.isArray(o.envois)) {
    contact.envois = o.envois.map(lireEnvoi).filter((e): e is EnvoiInvitation => Boolean(e)).sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ENVOIS);
  }
  return contact.email || contact.langue || contact.envois.length > 0 || contact.emailLe ? contact : undefined;
}

export function lireContacts(brut: unknown): Record<string, ContactCompte> {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const contacts: Record<string, ContactCompte> = {};
  for (const [id, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (!MOTIF_ID.test(id)) continue;
    const contact = lireContact(valeur);
    if (contact) contacts[id] = contact;
  }
  return contacts;
}

type AvecContacts = { contacts: Record<string, ContactCompte> };

/** Enregistre (ou efface, chaîne vide) l'adresse d'un compte. Lève si l'adresse est invalide. */
export function avecEmail<T extends AvecContacts>(donnees: T, id: string, saisie: string, maintenant: number): T {
  const email = normaliserEmail(saisie);
  if (email && !emailValide(email)) throw new Error('Adresse e-mail invalide (exemple : lea@exemple.fr).');
  const avant = donnees.contacts[id] ?? { envois: [] };
  const suivant: ContactCompte = { ...avant, envois: [...avant.envois], emailLe: new Date(maintenant).toISOString() };
  if (email) suivant.email = email;
  else delete suivant.email;
  return { ...donnees, contacts: { ...donnees.contacts, [id]: suivant } };
}

/** Langue par défaut d'un compte (français sans réglage). */
export const langueDuCompte = (contact: ContactCompte | undefined): LangueCompte => contact?.langue ?? 'fr';

/**
 * Langue d'un e-mail pour un compte : la langue effective côté Esport quand on la connaît (choix de l'utilisateur,
 * sinon langue par défaut du serveur Esport), sinon la langue par défaut de sa fiche, sinon le français.
 */
export const langueEffective = (contact: ContactCompte | undefined, esport?: { langueChoisie?: LangueCompte | null; langueDefaut?: LangueCompte }): LangueCompte =>
  esport?.langueChoisie ?? esport?.langueDefaut ?? contact?.langue ?? 'fr';

/** Règle la langue par défaut d'un compte ; `undefined` revient au français. Lève si la langue est inconnue. */
export function avecLangue<T extends AvecContacts>(donnees: T, id: string, langue: LangueCompte | undefined): T {
  if (langue !== undefined && !estLangueCompte(langue)) throw new Error('Langue : fr ou en.');
  const avant = donnees.contacts[id] ?? { envois: [] };
  const suivant: ContactCompte = { ...avant, envois: [...avant.envois] };
  if (langue) suivant.langue = langue;
  else delete suivant.langue;
  return { ...donnees, contacts: { ...donnees.contacts, [id]: suivant } };
}

/** Note un envoi d'invitation (canal) ; `relance` est déduit des envois précédents. */
export function avecEnvoi<T extends AvecContacts>(donnees: T, id: string, canal: CanalInvitation, maintenant: number): T {
  const avant = donnees.contacts[id] ?? { envois: [] };
  const envoi: EnvoiInvitation = { date: new Date(maintenant).toISOString(), canal, ...(avant.envois.length > 0 ? { relance: true } : {}) };
  const suivant: ContactCompte = { ...avant, envois: [...avant.envois, envoi].slice(-MAX_ENVOIS) };
  return { ...donnees, contacts: { ...donnees.contacts, [id]: suivant } };
}

/** Oublie le contact d'un compte (suppression du compte). */
export function sansContact<T extends AvecContacts>(donnees: T, id: string): T {
  if (!(id in donnees.contacts)) return donnees;
  const contacts = { ...donnees.contacts };
  delete contacts[id];
  return { ...donnees, contacts };
}

/** Dernier envoi d'invitation d'un compte. */
export function dernierEnvoi(contact: ContactCompte | undefined): EnvoiInvitation | undefined {
  return contact?.envois[contact.envois.length - 1];
}
