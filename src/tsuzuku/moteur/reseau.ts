/**
 * Acces reseau du moteur, INJECTE.
 *
 * Le moteur ne connait ni `fetch`, ni `http`, ni XMLHttpRequest : il recoit
 * un objet `Reseau` fourni par la plateforme (processus principal
 * d'Electron, React Native, navigateur via relais). Il l'enveloppe dans un
 * client « sur » qui :
 *
 * - valide l'adresse avec la garde avant chaque appel ;
 * - suit LUI-MEME les redirections, en validant chaque saut (sinon un site
 *   public pourrait rediriger l'application vers 192.168.1.1) ;
 * - impose un delai et une taille maximale de reponse.
 */

import { adresseEnTexte, analyserAdresse } from './adresse';
import { echec, ErreurMoteur } from './erreurs';
import { verifierUrlPublique, type OptionsGarde, type ResolveurDns } from './garde';
import { octetsUtf8 } from './outils';

export interface RequeteReseau {
  url: string;
  methode: 'GET' | 'POST';
  /** En-tetes a envoyer (noms en minuscules). */
  entetes: Record<string, string>;
  corps?: string;
  /** Delai maximal en millisecondes ; l'implementation doit abandonner au-dela. */
  delaiMs: number;
  /** Taille maximale du corps en octets ; l'implementation doit abandonner au-dela. */
  tailleMax: number;
}

export interface ReponseReseau {
  statut: number;
  /** En-tetes recus, noms en minuscules. */
  entetes: Record<string, string>;
  corps: string;
}

/**
 * Ce que la plateforme doit fournir.
 *
 * CONTRAT : `requete` ne suit PAS les redirections (elle renvoie la reponse
 * 3xx avec son en-tete `location`), respecte `delaiMs` et `tailleMax`, et
 * n'envoie aucun cookie ni identifiant propre a l'utilisateur.
 */
export interface Reseau {
  requete(r: RequeteReseau): Promise<ReponseReseau>;
  /** Facultatif : resolution DNS pour verifier que l'hote est public. */
  resoudre?: ResolveurDns;
}

export interface OptionsClient extends OptionsGarde {
  delaiMs?: number;
  tailleMax?: number;
  redirectionsMax?: number;
  agentUtilisateur?: string;
}

export interface OptionsAppel {
  delaiMs?: number;
  tailleMax?: number;
  agentUtilisateur?: string;
  entetes?: Record<string, string>;
  /** En-tête Referer (page « d'où l'on vient ») : certains sites refusent une requête sans. */
  referer?: string;
}

export interface ReponseTexte {
  /** Adresse finale, apres redirections. */
  url: string;
  statut: number;
  entetes: Record<string, string>;
  corps: string;
  typeContenu: string | null;
  octets: number;
  ms: number;
}

export interface ClientSur {
  /** GET texte ; les reponses >= 400 sont renvoyees (a l'appelant de juger). */
  obtenir(url: string, options?: OptionsAppel): Promise<ReponseTexte>;
  /** GET texte ; leve une ErreurMoteur si le statut est >= 400. */
  texte(url: string, options?: OptionsAppel): Promise<ReponseTexte>;
  /** GET JSON ; leve si statut >= 400 ou JSON invalide. */
  json<T = unknown>(url: string, options?: OptionsAppel): Promise<T>;
  /** POST JSON (sans redirection) ; renvoie le JSON de la reponse. */
  envoyerJson<T = unknown>(url: string, corps: unknown, options?: OptionsAppel): Promise<{ statut: number; donnees: T }>;
  /** POST d'un formulaire encodé (point d'entrée AJAX d'un site) ; réponse brute, statut non jugé. */
  envoyerFormulaire(url: string, corps: string, options?: OptionsAppel): Promise<ReponseTexte>;
}

/** Ce qu'un navigateur annonce accepter pour une page : sans cet en-tête, des pare-feu applicatifs répondent 403. */
export const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7';

export const AGENT_PAR_DEFAUT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const DELAI_PAR_DEFAUT = 15000;
const TAILLE_PAR_DEFAUT = 8 * 1024 * 1024;

function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(echec(`Delai depasse (${ms} ms)`, 'delai', 504)), ms);
  });
  return Promise.race([promesse, limite]).finally(() => clearTimeout(minuteur));
}

function minuscules(entetes: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entetes || {})) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

export function creerClient(reseau: Reseau, options: OptionsClient = {}): ClientSur {
  const garde: OptionsGarde = {
    portsAutorises: options.portsAutorises,
    resoudre: options.resoudre ?? reseau.resoudre,
  };
  const redirectionsMax = options.redirectionsMax ?? 5;

  async function appeler(
    url: string,
    methode: 'GET' | 'POST',
    appel: OptionsAppel,
    corps?: string,
  ): Promise<ReponseTexte> {
    const debut = Date.now();
    const delaiMs = appel.delaiMs ?? options.delaiMs ?? DELAI_PAR_DEFAUT;
    const tailleMax = appel.tailleMax ?? options.tailleMax ?? TAILLE_PAR_DEFAUT;
    const entetes: Record<string, string> = {
      'user-agent': appel.agentUtilisateur || options.agentUtilisateur || AGENT_PAR_DEFAUT,
      accept: ACCEPT_HTML,
      'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      ...(appel.referer ? { referer: appel.referer } : {}),
      ...minuscules(appel.entetes),
    };
    let cookiesDemandes = 0;

    let courante = await verifierUrlPublique(url, garde);
    for (let saut = 0; saut <= redirectionsMax; saut += 1) {
      let rep: ReponseReseau;
      try {
        rep = await avecDelai(reseau.requete({ url: courante, methode, entetes, corps, delaiMs, tailleMax }), delaiMs);
      } catch (err) {
        if (err instanceof ErreurMoteur) {
          throw err;
        }
        throw echec(`Reseau indisponible : ${err instanceof Error ? err.message : String(err)}`, 'reseau', 502);
      }
      const recus = minuscules(rep.entetes);
      const location = recus.location;
      // Le transport ne garde aucun cookie ; il signale seulement qu'un site en pose (`x-tsuzuku-cookie`).
      if (recus['set-cookie'] || recus['x-tsuzuku-cookie']) {
        cookiesDemandes += 1;
      }
      if (rep.statut >= 300 && rep.statut < 400 && location) {
        if (methode !== 'GET') {
          throw echec('Redirection refusee pour un envoi', 'redirections', 502);
        }
        const suivante = analyserAdresse(location, courante);
        if (!suivante) {
          throw echec('Redirection vers une adresse invalide', 'redirections', 502);
        }
        // Chaque saut repasse par la garde.
        courante = await verifierUrlPublique(adresseEnTexte(suivante), garde);
        continue;
      }
      const corpsRecu = typeof rep.corps === 'string' ? rep.corps : String(rep.corps ?? '');
      const octets = octetsUtf8(corpsRecu);
      if (octets > tailleMax) {
        throw echec(`Reponse trop volumineuse (${octets} octets)`, 'taille', 502);
      }
      return {
        url: courante,
        statut: rep.statut,
        entetes: recus,
        corps: corpsRecu,
        typeContenu: recus['content-type']?.split(';')[0].trim() || null,
        octets,
        ms: Date.now() - debut,
      };
    }
    if (cookiesDemandes) {
      throw echec('Le site redirige en boucle en posant des cookies : il exige des cookies (connexion, consentement ou protection anti-robot), que Tsuzuku n’envoie pas.', 'cookies', 502);
    }
    throw echec('Trop de redirections', 'redirections', 502);
  }

  const verifierStatut = (r: ReponseTexte) => {
    const blocage = detecterBlocage(r);
    if (blocage) {
      throw echec(messageBlocage(blocage), 'anti-robot', r.statut >= 400 ? r.statut : 403);
    }
    if (r.statut >= 400) {
      throw echec(`Le site a repondu ${r.statut}`, r.statut === 404 ? 'introuvable' : 'service', r.statut === 404 ? 404 : 502);
    }
    return r;
  };

  const lireJson = <T>(r: ReponseTexte): T => {
    try {
      return JSON.parse(r.corps) as T;
    } catch {
      throw echec('Reponse JSON invalide', 'service', 502);
    }
  };

  return {
    obtenir: (url, appel = {}) => appeler(url, 'GET', appel),
    texte: async (url, appel = {}) => verifierStatut(await appeler(url, 'GET', appel)),
    json: async <T>(url: string, appel: OptionsAppel = {}) =>
      lireJson<T>(verifierStatut(await appeler(url, 'GET', { ...appel, entetes: { accept: 'application/json', ...appel.entetes } }))),
    envoyerJson: async <T>(url: string, corps: unknown, appel: OptionsAppel = {}) => {
      const r = await appeler(
        url,
        'POST',
        { ...appel, entetes: { 'content-type': 'application/json', accept: 'application/json', ...appel.entetes } },
        JSON.stringify(corps),
      );
      return { statut: r.statut, donnees: lireJson<T>(r) };
    },
    envoyerFormulaire: (url, corps, appel = {}) =>
      appeler(
        url,
        'POST',
        { ...appel, entetes: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', ...appel.entetes } },
        corps,
      ),
  };
}

// ---------------------------------------------------------------------------
// Protections anti-robot
// ---------------------------------------------------------------------------

export interface Blocage {
  /** Ce qui a été reconnu (pour le diagnostic). */
  indice: string;
}

/** Marqueurs des pages de vérification (pare-feu, captcha, « vérification du navigateur »). Génériques, aucun site nommé. */
const MARQUEURS_BLOCAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/<title>\s*just a moment/i, 'page « Just a moment… » (vérification du navigateur)'],
  [/cf[-_]chl|challenge-platform|cf-browser-verification|__cf_bm|cf-turnstile/i, 'défi de vérification du navigateur'],
  [/<title>\s*attention required/i, 'page « Attention required »'],
  [/checking (?:if the site connection is secure|your browser)|vérification (?:de votre navigateur|que vous êtes humain)|verify you are human|are you a robot|êtes-vous un robot/i, 'vérification « êtes-vous humain ? »'],
  [/g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api|captcha-delivery|px-captcha|class=["'][^"']*captcha/i, 'captcha'],
  [/ddos[- ]protection|ddos-guard|_incapsula_resource|access denied.{0,80}(?:bot|automated)|request unsuccessful\. incapsula/i, 'protection anti-DDoS'],
  [/enable javascript and cookies to continue|please enable cookies|activez (?:le )?javascript et les cookies/i, 'page « activez JavaScript et les cookies »'],
];

/**
 * Page de protection anti-robot plutôt que le contenu demandé : en-tête
 * `cf-mitigated`, ou statut 403/429/503 (parfois 200) avec une page de
 * vérification reconnaissable. `null` sinon.
 */
export function detecterBlocage(r: Pick<ReponseTexte, 'statut' | 'entetes' | 'corps'>): Blocage | null {
  const entetes = r.entetes || {};
  if (/challenge/i.test(entetes['cf-mitigated'] ?? '')) {
    return { indice: 'en-tête de défi (cf-mitigated)' };
  }
  const debut = String(r.corps ?? '').slice(0, 60_000);
  // Une vraie page de contenu (longue) qui contient un captcha de commentaire n'est pas un blocage.
  const court = debut.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 3000;
  for (const [motif, indice] of MARQUEURS_BLOCAGE) {
    if (motif.test(debut) && (r.statut >= 400 || court)) {
      return { indice };
    }
  }
  if ((r.statut === 403 || r.statut === 503 || r.statut === 429) && /cloudflare|ddos|akamai|sucuri|imperva|incapsula|captcha/i.test(`${entetes.server ?? ''} ${debut.slice(0, 3000)}`)) {
    return { indice: `réponse ${r.statut} d'un pare-feu (${(entetes.server || 'protection').slice(0, 40)})` };
  }
  if (r.statut === 429) {
    return { indice: 'trop de requêtes (429)' };
  }
  return null;
}

export function messageBlocage(b: Blocage): string {
  return `Le site bloque les requêtes automatiques (${b.indice}) : Tsuzuku ne contourne pas ces protections. Ouvrez le site dans votre navigateur pour vérifier qu’il fonctionne, réessayez plus tard, ou utilisez un lien direct vers la page de l’épisode.`;
}

// ---------------------------------------------------------------------------
// Adaptateur pour une fonction `fetch` standard (Electron, React Native)
// ---------------------------------------------------------------------------

/** Forme minimale d'une reponse fetch, pour ne pas dependre des types DOM. */
interface ReponseFetch {
  status: number;
  type?: string;
  headers: { forEach(cb: (valeur: string, nom: string) => void): void };
  text(): Promise<string>;
}

export type FonctionFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: 'manual';
    credentials: 'omit';
    signal?: unknown;
  },
) => Promise<ReponseFetch>;

interface ControleurAbandon {
  signal: unknown;
  abort(): void;
}

/**
 * Construit un `Reseau` a partir d'une fonction fetch INJECTEE.
 *
 * Limites : dans un navigateur, `redirect: 'manual'` rend une reponse
 * opaque sans en-tete `location` ; elle est refusee ici (le navigateur
 * passera par un relais). La taille est controlee par Content-Length puis
 * apres lecture.
 */
export function reseauDepuisFetch(
  fetchFn: FonctionFetch,
  outils: { creerControleur?: () => ControleurAbandon; resoudre?: ResolveurDns } = {},
): Reseau {
  const creerControleur =
    outils.creerControleur ??
    (() => {
      const Ctor = (globalThis as { AbortController?: new () => ControleurAbandon }).AbortController;
      return Ctor ? new Ctor() : null;
    });
  return {
    resoudre: outils.resoudre,
    async requete(r) {
      const controleur = creerControleur();
      const minuteur = setTimeout(() => controleur?.abort(), r.delaiMs);
      try {
        const rep = await fetchFn(r.url, {
          method: r.methode,
          headers: r.entetes,
          body: r.corps,
          redirect: 'manual',
          credentials: 'omit',
          signal: controleur?.signal,
        });
        if (rep.type === 'opaqueredirect') {
          throw echec('Redirection illisible dans ce contexte (passer par le relais)', 'redirections', 502);
        }
        const entetes: Record<string, string> = {};
        rep.headers.forEach((valeur, nom) => {
          entetes[nom.toLowerCase()] = valeur;
        });
        const annonce = Number(entetes['content-length']);
        if (Number.isFinite(annonce) && annonce > r.tailleMax) {
          controleur?.abort();
          throw echec(`Reponse trop volumineuse (${annonce} octets)`, 'taille', 502);
        }
        const corps = rep.status >= 300 && rep.status < 400 ? '' : await rep.text();
        return { statut: rep.status, entetes, corps };
      } finally {
        clearTimeout(minuteur);
      }
    },
  };
}
