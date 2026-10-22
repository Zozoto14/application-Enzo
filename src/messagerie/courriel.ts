/**
 * E-mails envoyés par le serveur (relais, `/courriel/…`), pour le Fondateur seulement (jeton maître).
 *
 * Les adresses vivent dans la base CHIFFRÉE de l'Administration, sur l'appareil du Fondateur : l'app
 * les joint à la demande d'envoi, le relais les utilise pour CET envoi et ne garde qu'une trace
 * masquée (l***@e***.fr) dans son journal (docs/emails.md). Sans SMTP configuré sur le serveur
 * (`non-configure`), l'app retombe sur la messagerie de l'appareil (`mailto:`).
 */

import { relaisDuCompte } from '../sync/relais/actif';

export type LangueCourriel = 'fr' | 'en';
export type ModeleCourriel = 'libre' | 'invitation';

export interface Destinataire {
  adresse: string;
  nom?: string;
  langue?: LangueCourriel;
}

export interface ResultatDestinataire {
  /** Adresse masquée (jamais en clair dans une réponse du serveur). */
  a: string;
  statut: 'envoye' | 'echec';
  erreur?: string;
  /** Langue dans laquelle l'e-mail est parti (ou aurait dû partir). */
  langue?: LangueCourriel;
}

export interface ResultatCourriel {
  ok: boolean;
  /** Le serveur n'envoie pas d'e-mails (SMTP absent) : utiliser `mailto:`. */
  nonConfigure?: boolean;
  envoyes: number;
  resultats: ResultatDestinataire[];
  erreur?: string;
}

export interface EnvoiJournal {
  id: string;
  date: string;
  modele: string;
  objet: string;
  ref?: string;
  resultats: ResultatDestinataire[];
}

/** Version anglaise d'un message (objet et corps), pour les destinataires en anglais. */
export interface VersionCourriel {
  objet: string;
  message: string;
}

/** Aperçu rendu par le serveur : exactement ce que recevra le destinataire. */
export interface ApercuCourriel {
  langue: LangueCourriel;
  objet: string;
  texte: string;
  html: string;
}

export interface LiaisonRelais {
  relais: string;
  jeton: string;
}

type Requete = typeof fetch;

/** Liaison du relais de cet appareil (remplaçable par les tests). */
export const liaisonCourriel: { relais: () => LiaisonRelais | undefined; requete: () => Requete } = {
  relais: () => relaisDuCompte(),
  requete: () => globalThis.fetch,
};

const LIBELLES_ERREURS: Record<string, string> = {
  'adresse-invalide': 'adresse invalide',
  'destinataire-refuse': 'destinataire refusé par le serveur de messagerie',
  'smtp-authentification': 'identifiants SMTP refusés (SMTP_USER / SMTP_PASS)',
  'smtp-injoignable': 'serveur SMTP injoignable',
  'smtp-temporaire': 'refus temporaire du serveur SMTP',
  'smtp-erreur': 'erreur du serveur SMTP',
  'non-configure': 'envoi par le serveur non configuré',
};

export const libelleErreurCourriel = (code: string | undefined): string => (code ? (LIBELLES_ERREURS[code] ?? code) : '');

async function appel<T>(chemin: string, init: RequestInit = {}): Promise<{ statut: number; corps: T | undefined }> {
  const l = liaisonCourriel.relais();
  if (!l?.jeton) return { statut: 0, corps: undefined };
  let r: Response;
  try {
    r = await liaisonCourriel.requete()(`${l.relais.replace(/\/+$/, '')}${chemin}`, {
      ...init,
      headers: { Authorization: `Bearer ${l.jeton}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    return { statut: 0, corps: undefined };
  }
  let corps: T | undefined;
  try {
    corps = (await r.json()) as T;
  } catch {
    corps = undefined;
  }
  return { statut: r.status, corps };
}

/** Le serveur sait-il envoyer des e-mails ? (`false` aussi hors ligne, sans relais, ou sans jeton maître.) */
export async function courrielDisponible(): Promise<boolean> {
  const r = await appel<{ configure?: boolean }>('/courriel/etat');
  return r.statut === 200 && r.corps?.configure === true;
}

/** Envoi (un e-mail par destinataire). Ne lève jamais : le résultat dit ce qui s'est passé. */
export async function envoyerCourriel(demande: {
  destinataires: Destinataire[];
  modele?: ModeleCourriel;
  langue?: LangueCourriel;
  objet: string;
  message: string;
  /** Version anglaise (facultative) : les destinataires en anglais la reçoivent à la place du texte principal. */
  en?: VersionCourriel;
  lien?: string;
  ref?: string;
}): Promise<ResultatCourriel> {
  const r = await appel<Partial<ResultatCourriel> & { erreur?: string; motif?: string }>('/courriel/envoyer', {
    method: 'POST',
    body: JSON.stringify({
      destinataires: demande.destinataires,
      modele: demande.modele ?? 'libre',
      langue: demande.langue ?? 'fr',
      variables: { objet: demande.objet, message: demande.message, ...(demande.en ? { en: demande.en } : {}), ...(demande.lien ? { lien: demande.lien } : {}) },
      ...(demande.ref ? { ref: demande.ref } : {}),
    }),
  });
  if (r.statut === 0) return { ok: false, envoyes: 0, resultats: [], erreur: 'Serveur injoignable (hors ligne ou relais non relié).' };
  if (r.statut === 503 || r.corps?.motif === 'non-configure' || r.statut === 404) return { ok: false, nonConfigure: true, envoyes: 0, resultats: [], erreur: libelleErreurCourriel('non-configure') };
  if (r.statut === 403) return { ok: false, envoyes: 0, resultats: [], erreur: 'Réservé au Fondateur (appareil relié avec le jeton maître).' };
  const c = r.corps ?? {};
  return {
    ok: Boolean(c.ok),
    envoyes: Number(c.envoyes ?? 0),
    resultats: Array.isArray(c.resultats) ? c.resultats : [],
    ...(typeof c.erreur === 'string' ? { erreur: c.erreur } : {}),
  };
}

/**
 * Aperçu de l'e-mail dans une langue (objet, texte brut, HTML), rendu par le serveur avec les MÊMES modèles que
 * l'envoi : aucune adresse n'est envoyée et rien n'est expédié (marche même sans SMTP). `undefined` : indisponible.
 */
export async function apercuCourriel(demande: {
  langue: LangueCourriel;
  modele?: ModeleCourriel;
  objet: string;
  message: string;
  en?: VersionCourriel;
  lien?: string;
}): Promise<ApercuCourriel | undefined> {
  const r = await appel<Partial<ApercuCourriel>>('/courriel/apercu', {
    method: 'POST',
    body: JSON.stringify({
      modele: demande.modele ?? 'libre',
      langue: demande.langue,
      variables: { objet: demande.objet, message: demande.message, ...(demande.en ? { en: demande.en } : {}), ...(demande.lien ? { lien: demande.lien } : {}) },
    }),
  });
  const c = r.corps;
  if (r.statut !== 200 || !c || typeof c.html !== 'string' || typeof c.objet !== 'string') return undefined;
  return { langue: c.langue === 'en' ? 'en' : 'fr', objet: c.objet, texte: String(c.texte ?? ''), html: c.html };
}

/** Historique des envois (adresses masquées). */
export async function journalCourriel(): Promise<EnvoiJournal[] | undefined> {
  const r = await appel<{ envois?: EnvoiJournal[] }>('/courriel/journal');
  return r.statut === 200 && Array.isArray(r.corps?.envois) ? r.corps!.envois : undefined;
}

/** Adresses en copie cachée pour le secours `mailto:` (plusieurs destinataires, personne ne voit les autres). */
export function mailtoSecours(adresses: readonly string[], objet: string, texte: string): string {
  const bcc = adresses.map(a => encodeURIComponent(a.trim()).replace(/%40/g, '@')).join(',');
  return `mailto:?bcc=${bcc}&subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(texte.replace(/\r?\n/g, '\r\n'))}`.slice(0, 2000);
}
