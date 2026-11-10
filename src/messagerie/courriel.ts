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
  /** Le relais n'a pas pu traiter la demande (voir `libelleProblemeRelais`) ; `erreur` contient la phrase. */
  probleme?: ProblemeRelais;
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
  'expediteur-refuse': 'expéditeur refusé par le serveur SMTP : MAIL_FROM doit être l’adresse de la boîte SMTP_USER',
  'smtp-authentification': 'identifiants SMTP refusés : vérifie SMTP_USER (adresse complète) et SMTP_PASS',
  'smtp-certificat': 'certificat SMTP ne correspond pas au nom du serveur : utilise SMTP_HOST=<nom du serveur> (celui affiché par cPanel)',
  'smtp-refuse': 'connexion refusée par le serveur SMTP : vérifie SMTP_HOST et SMTP_PORT (465 SSL/TLS ou 587 STARTTLS)',
  'smtp-delai': 'le serveur SMTP ne répond pas (délai dépassé) : vérifie SMTP_PORT (465 SSL/TLS ou 587 STARTTLS)',
  'smtp-hote-inconnu': 'serveur SMTP introuvable : SMTP_HOST est mal écrit',
  'smtp-injoignable': 'serveur SMTP injoignable',
  'smtp-limite': 'limite d’envoi de l’hébergeur atteinte : réessaie plus tard',
  'smtp-temporaire': 'refus temporaire du serveur SMTP',
  'smtp-erreur': 'erreur du serveur SMTP',
  'non-configure': 'envoi par le serveur non configuré',
  limite: 'limite d’envoi du relais atteinte (100 par heure, 300 par jour) : réessaie plus tard',
};

export const libelleErreurCourriel = (code: string | undefined): string => (code ? (LIBELLES_ERREURS[code] ?? code) : '');

/**
 * Pourquoi le relais n'a pas répondu comme prévu (jamais silencieux : chaque cas a sa phrase et sa solution).
 *  - non-relie : cet appareil n'a pas de relais ou pas de jeton ;
 *  - reseau / delai : relais injoignable (hors ligne, DNS, coupure) ou trop lent ;
 *  - relais-indisponible : l'hébergeur répond à la place du relais (502, 503, 504 sans réponse du relais : app arrêtée) ;
 *  - ancien-relais : la route n'existe pas (le relais tourne une ancienne version : il n'a pas redémarré) ;
 *  - refuse : jeton refusé ou pas le jeton maître (401, 403).
 */
export type ProblemeRelais = 'non-relie' | 'reseau' | 'delai' | 'relais-indisponible' | 'ancien-relais' | 'refuse' | 'reponse';

const REDEMARRER = 'cPanel › Setup Node.js App › application-enzo/relais › Restart, puis lire ~/logs/relais.log (tail -n 50 ~/logs/relais.log dans le Terminal de cPanel)';

export function libelleProblemeRelais(p: ProblemeRelais, statut?: number): string {
  switch (p) {
    case 'non-relie':
      return 'Cet appareil n’est pas relié au relais avec le jeton maître du Fondateur : rien ne peut partir d’ici. Ouvrez l’app sur le PC du Fondateur, ou reliez cet appareil avec un code de liaison (AB1.…) créé sur le PC, ou connectez-vous avec l’identifiant du Fondateur.';
    case 'reseau':
      return 'Relais injoignable (pas de réseau, ou serveur relais.appdashboard.fr arrêté). Vérifiez la connexion ; si elle marche, redémarrez le relais : ' + REDEMARRER + '.';
    case 'delai':
      return 'Le relais n’a pas répondu à temps. Réessayez ; si cela se répète : ' + REDEMARRER + '.';
    case 'relais-indisponible':
      return `Le relais ne répond pas (erreur ${statut ?? '?'} de l’hébergeur : l’app relais est arrêtée ou ne démarre plus). ${REDEMARRER}.`;
    case 'ancien-relais':
      return `Le relais tourne une ancienne version (il n’a pas redémarré après la dernière mise à jour). ${REDEMARRER}.`;
    case 'refuse':
      return 'Le relais refuse cet appareil : réservé au Fondateur (jeton maître). Reliez cet appareil avec le jeton maître ou connectez-vous avec l’identifiant du Fondateur.';
    default:
      return `Réponse inattendue du relais (HTTP ${statut ?? '?'}). ${REDEMARRER}.`;
  }
}

export interface Reponse<T> {
  statut: number;
  corps: T | undefined;
  probleme?: ProblemeRelais;
}

/** Délais : 15 s pour une lecture, 120 s pour un envoi (un e-mail par destinataire). */
const DELAI_MS = 15_000;
const DELAI_ENVOI_MS = 120_000;

/** Appel authentifié au relais du compte (jeton de cet appareil), avec la raison précise d'un échec. */
export async function appel<T>(chemin: string, init: RequestInit = {}, delaiMs = DELAI_MS): Promise<Reponse<T>> {
  const l = liaisonCourriel.relais();
  if (!l?.relais || !l?.jeton) return { statut: 0, corps: undefined, probleme: 'non-relie' };
  let r: Response;
  const controle = typeof AbortController === 'function' ? new AbortController() : undefined;
  let expire = false;
  const minuteur = controle
    ? setTimeout(() => {
        expire = true;
        controle.abort();
      }, delaiMs)
    : undefined;
  try {
    r = await liaisonCourriel.requete()(`${l.relais.replace(/\/+$/, '')}${chemin}`, {
      ...init,
      ...(controle ? { signal: controle.signal } : {}),
      headers: { Authorization: `Bearer ${l.jeton}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    return { statut: 0, corps: undefined, probleme: expire ? 'delai' : 'reseau' };
  } finally {
    if (minuteur !== undefined) clearTimeout(minuteur);
  }
  let corps: T | undefined;
  try {
    corps = (await r.json()) as T;
  } catch {
    corps = undefined;
  }
  // Réponse qui ne vient pas du relais (page d'erreur HTML de l'hébergeur) : l'app relais est arrêtée.
  const probleme: ProblemeRelais | undefined =
    corps === undefined || corps === null || typeof corps !== 'object'
      ? r.status >= 500 || r.status === 404
        ? 'relais-indisponible'
        : r.ok
          ? undefined
          : 'reponse'
      : r.status === 401 || r.status === 403
        ? 'refuse'
        : undefined;
  return { statut: r.status, corps: corps ?? undefined, ...(probleme ? { probleme } : {}) };
}

/** Vérification SMTP faite par le relais à son démarrage. */
export interface VerificationSmtp {
  statut: 'non-configure' | 'en-cours' | 'ok' | 'echec';
  code?: string;
  technique?: string;
  explication?: string;
  le?: string;
}

/** État de l'envoi d'e-mails, avec la raison précise quand il n'est pas prêt. */
export interface EtatCourriel {
  /** true : prêt ; false : SMTP non configuré (`manques`) ; undefined : on ne sait pas (`probleme`). */
  configure?: boolean;
  expediteur?: string | null;
  /** Noms des variables absentes de relais.env (jamais une valeur). */
  manques?: string[];
  verification?: VerificationSmtp;
  /** Le relais connaît « Tester l'envoi » (sinon : ancienne version, pas redémarré). */
  test?: boolean;
  probleme?: ProblemeRelais;
  /** Phrase prête à afficher quand `probleme`. */
  message?: string;
}

export async function etatCourriel(): Promise<EtatCourriel> {
  const r = await appel<{ configure?: boolean; expediteur?: string | null; manques?: unknown; verification?: VerificationSmtp; test?: boolean; erreur?: string }>('/courriel/etat');
  if (r.probleme) return { probleme: r.probleme, message: libelleProblemeRelais(r.probleme, r.statut) };
  if (r.statut === 404) return { probleme: 'ancien-relais', message: libelleProblemeRelais('ancien-relais') };
  if (r.statut !== 200 || !r.corps) return { probleme: 'reponse', message: libelleProblemeRelais('reponse', r.statut) };
  const c = r.corps;
  return {
    configure: c.configure === true,
    expediteur: typeof c.expediteur === 'string' ? c.expediteur : null,
    ...(Array.isArray(c.manques) ? { manques: c.manques.filter((m): m is string => typeof m === 'string') } : {}),
    ...(c.verification && typeof c.verification === 'object' ? { verification: c.verification } : {}),
    test: c.test === true,
  };
}

/** Le serveur sait-il envoyer des e-mails ? (`false` aussi hors ligne, sans relais, ou sans jeton maître.) */
export async function courrielDisponible(): Promise<boolean> {
  return (await etatCourriel()).configure === true;
}

/** Résultat de « Tester l'envoi ». */
export interface ResultatTest {
  ok: boolean;
  /** Étape atteinte : configuration, connexion (identifiants SMTP), envoi (e-mail de test) ; relais : rien n'a répondu. */
  etape: 'relais' | 'configuration' | 'connexion' | 'envoi';
  code?: string;
  /** Phrase prête à afficher (précise, avec la solution). */
  message: string;
  manques?: string[];
  technique?: string;
  /** Adresse (masquée) qui a reçu l'e-mail de test. */
  a?: string;
}

/**
 * « Tester l'envoi » : le relais vérifie la connexion et les identifiants SMTP, puis envoie un e-mail de test à
 * `adresse` (sinon à sa propre boîte d'envoi). Ne lève jamais.
 */
export async function testerCourriel(adresse?: string): Promise<ResultatTest> {
  const r = await appel<{ ok?: boolean; etape?: ResultatTest['etape']; code?: string; explication?: string; manques?: string[]; technique?: string; a?: string; erreur?: string }>(
    '/courriel/tester',
    { method: 'POST', body: JSON.stringify(adresse?.trim() ? { adresse: adresse.trim() } : {}) },
    60_000,
  );
  const c = r.corps;
  if (r.statut === 404 && c && !c.etape) return { ok: false, etape: 'relais', code: 'ancien-relais', message: libelleProblemeRelais('ancien-relais') };
  if (r.probleme) return { ok: false, etape: 'relais', code: r.probleme, message: libelleProblemeRelais(r.probleme, r.statut) };
  if (!c || typeof c !== 'object') return { ok: false, etape: 'relais', code: 'reponse', message: libelleProblemeRelais('reponse', r.statut) };
  if (c.ok) return { ok: true, etape: 'envoi', message: `Connexion SMTP vérifiée et e-mail de test envoyé à ${c.a ?? 'la boîte d’envoi'} : regardez la boîte de réception (et les indésirables).`, ...(c.a ? { a: c.a } : {}) };
  const code = c.code ?? 'smtp-erreur';
  const prefixe = c.etape === 'configuration' ? 'Envoi non configuré' : c.etape === 'connexion' ? 'Connexion SMTP impossible' : 'E-mail de test refusé';
  return {
    ok: false,
    etape: c.etape ?? 'envoi',
    code,
    message: `${prefixe} : ${c.explication ?? c.erreur ?? libelleErreurCourriel(code)}${c.technique ? ` (code ${c.technique})` : ''}`,
    ...(Array.isArray(c.manques) ? { manques: c.manques } : {}),
    ...(c.technique ? { technique: c.technique } : {}),
    ...(c.a ? { a: c.a } : {}),
  };
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
  }, DELAI_ENVOI_MS);
  // Jamais silencieux : chaque échec rend une phrase précise (`erreur`), avec la solution.
  if (r.probleme === 'refuse' || r.statut === 403) return { ok: false, envoyes: 0, resultats: [], probleme: 'refuse', erreur: libelleProblemeRelais('refuse') };
  if (r.probleme) return { ok: false, envoyes: 0, resultats: [], probleme: r.probleme, erreur: libelleProblemeRelais(r.probleme, r.statut) };
  if (r.corps?.motif === 'non-configure') return { ok: false, nonConfigure: true, envoyes: 0, resultats: [], erreur: libelleErreurCourriel('non-configure') };
  if (r.statut === 503) return { ok: false, envoyes: 0, resultats: [], probleme: 'reponse', erreur: r.corps?.erreur ? `le relais répond : ${r.corps.erreur}` : libelleProblemeRelais('reponse', 503) };
  if (r.statut === 404) return { ok: false, envoyes: 0, resultats: [], probleme: 'ancien-relais', erreur: libelleProblemeRelais('ancien-relais') };
  if (r.statut === 429) return { ok: false, envoyes: 0, resultats: [], erreur: r.corps?.erreur ?? libelleErreurCourriel('limite') };
  if (r.statut === 400) return { ok: false, envoyes: 0, resultats: [], erreur: r.corps?.erreur ?? 'demande refusée par le relais' };
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
  return (await lireJournalCourriel()).envois;
}

/** Historique, ou la raison précise pour laquelle il est indisponible. */
export async function lireJournalCourriel(): Promise<{ envois?: EnvoiJournal[]; message?: string }> {
  const r = await appel<{ envois?: EnvoiJournal[] }>('/courriel/journal');
  if (r.statut === 200 && Array.isArray(r.corps?.envois)) return { envois: r.corps!.envois };
  if (r.probleme) return { message: libelleProblemeRelais(r.probleme, r.statut) };
  return { message: libelleProblemeRelais(r.statut === 404 ? 'ancien-relais' : 'reponse', r.statut) };
}

/** Adresses en copie cachée pour le secours `mailto:` (plusieurs destinataires, personne ne voit les autres). */
export function mailtoSecours(adresses: readonly string[], objet: string, texte: string): string {
  const bcc = adresses.map(a => encodeURIComponent(a.trim()).replace(/%40/g, '@')).join(',');
  return `mailto:?bcc=${bcc}&subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(texte.replace(/\r?\n/g, '\r\n'))}`.slice(0, 2000);
}
