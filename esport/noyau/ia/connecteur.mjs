/**
 * Connecteur IA générique (assistant des profils de jeu). Le Fondateur choisit son fournisseur : la clé
 * d'API et le modèle se règlent dans ~/.appdashboard/esport.env (jamais dans le dépôt) :
 *
 *   IA_API_URL      adresse de l'API « chat completions » compatible OpenAI (https seulement) ; l'adresse
 *                   de base suffit (…/v1), « /chat/completions » est ajouté s'il manque
 *   IA_API_CLE      clé d'API (secret : jamais renvoyée par le serveur, jamais journalisée)
 *   IA_MODELE       modèle (ex. gpt-4o-mini, mistral-small-latest, gemini-2.0-flash…)
 *   IA_FOURNISSEUR  facultatif : openai, mistral, gemini, deepseek, groq, autre (déduit de l'adresse sinon) ;
 *                   règle les petites différences (sortie JSON forcée ou non). « local » : l'IA LOCALE
 *                   (llama.cpp sur le serveur, voir `configIaLocale` et docs/esport/ia-locale.md) est le mode
 *                   par défaut ; une clé d'API éventuelle sert alors de secours (mode « Locale d'abord »)
 *   IA_FORMAT       facultatif : « openai-chat » (seul format pour l'instant ; voir ADAPTATEURS)
 *   IA_RECHERCHE    facultatif : « serveur » (défaut : le serveur lit lui-même quelques pages web),
 *                   « modele » (le modèle sait naviguer : il cherche lui-même), « aucune »
 *
 * Sans IA_API_CLE (ou sans modèle) : l'assistant est désactivé, tout reste faisable à la main.
 *
 * Un ADAPTATEUR par format d'API (`ADAPTATEURS`) : `requete(config, messages, options)` → { url, init },
 * `reponse(json)` → { texte, jetons }. Ajouter un format (API Anthropic, Gemini native…) = ajouter une
 * entrée, sans toucher au reste de l'assistant.
 */

import { echec } from '../outils.mjs';

/** Adresses par défaut des fournisseurs connus (si IA_API_URL est vide). */
export const FOURNISSEURS = {
  openai: { url: 'https://api.openai.com/v1', jsonForce: true },
  mistral: { url: 'https://api.mistral.ai/v1', jsonForce: true },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', jsonForce: true },
  deepseek: { url: 'https://api.deepseek.com/v1', jsonForce: true },
  groq: { url: 'https://api.groq.com/openai/v1', jsonForce: true },
  autre: { url: '', jsonForce: false },
};

const HOTES = [
  ['api.openai.com', 'openai'],
  ['api.mistral.ai', 'mistral'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['api.deepseek.com', 'deepseek'],
  ['api.groq.com', 'groq'],
];

export const DELAI_IA_MS = 90_000;
export const TAILLE_MAX_REPONSE_IA = 512 * 1024;

/** Fournisseur déduit de l'adresse (hôte exact ou sous-domaine). */
export function fournisseurDeUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return HOTES.find(([hote]) => h === hote || h.endsWith(`.${hote}`))?.[1] ?? 'autre';
  } catch {
    return 'autre';
  }
}

/** Adresse finale de l'API (…/chat/completions), https seulement ; '' si invalide. */
export function adresseCompletions(url) {
  const brut = String(url ?? '').trim();
  if (!brut) return '';
  let u;
  try {
    u = new URL(brut);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  const chemin = u.pathname.replace(/\/+$/, '');
  u.pathname = /\/chat\/completions$/.test(chemin) ? chemin : `${chemin}/chat/completions`;
  u.hash = '';
  return u.href;
}

/**
 * Configuration lue dans l'environnement. Rend un objet SANS la clé en clair dans ses champs publics :
 * `etatPublic()` est ce que l'API peut montrer (fournisseur, modèle, hôte, clé présente ou non).
 */
export function configIa(env = process.env) {
  const cle = String(env.IA_API_CLE ?? '').trim();
  const modele = String(env.IA_MODELE ?? '').trim().slice(0, 100);
  const fournisseurDemande = String(env.IA_FOURNISSEUR ?? '').trim().toLowerCase();
  const urlBrute = String(env.IA_API_URL ?? '').trim();
  const fournisseur = FOURNISSEURS[fournisseurDemande] ? fournisseurDemande : urlBrute ? fournisseurDeUrl(urlBrute) : 'autre';
  // IA_FOURNISSEUR=local : mode par défaut « IA locale » (le choix se change dans Administration IA).
  const modeDefaut = fournisseurDemande === 'local' ? 'local' : 'api';
  const url = adresseCompletions(urlBrute || FOURNISSEURS[fournisseur]?.url || '');
  const format = ['openai-chat'].includes(env.IA_FORMAT) ? env.IA_FORMAT : 'openai-chat';
  const recherche = ['serveur', 'modele', 'aucune'].includes(env.IA_RECHERCHE) ? env.IA_RECHERCHE : 'serveur';
  let raison = null;
  if (!cle) raison = 'cle-absente';
  else if (!modele) raison = 'modele-absent';
  else if (!url) raison = 'url-invalide';
  return {
    actif: !raison,
    raison,
    fournisseur,
    modele,
    url,
    format,
    recherche,
    modeDefaut,
    // La clé reste dans une fermeture : elle ne sort jamais par JSON.stringify ni par l'API.
    lireCle: () => cle,
    etatPublic() {
      let hote = null;
      try {
        hote = url ? new URL(url).host : null;
      } catch {
        hote = null;
      }
      return { configure: !raison, raison, fournisseur, modele: modele || null, hote, format, recherche, cle: cle ? 'presente' : 'absente' };
    },
    toJSON() {
      return this.etatPublic();
    },
  };
}

// ------------------------------------------------------------------ Adaptateurs

export const ADAPTATEURS = {
  'openai-chat': {
    requete(config, messages, { json = true, maxJetons = 4000, temperature = 0.2, schema = null } = {}) {
      const corps = { model: config.modele, messages, temperature, max_tokens: maxJetons };
      // IA locale (llama-server) : sortie CONTRAINTE par le schéma JSON (grammaire), sinon un objet JSON.
      if (json && config.fournisseur === 'local') corps.response_format = schema ? { type: 'json_schema', json_schema: { name: 'reponse', schema, strict: true } } : { type: 'json_object' };
      // Sortie JSON forcée chez les fournisseurs qui la gèrent (le prompt la demande de toute façon).
      else if (json && (FOURNISSEURS[config.fournisseur]?.jsonForce ?? false)) corps.response_format = { type: 'json_object' };
      return {
        url: config.url,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.lireCle()}` },
          body: JSON.stringify(corps),
        },
      };
    },
    reponse(json) {
      const texte = json?.choices?.[0]?.message?.content;
      if (typeof texte !== 'string' || !texte.trim()) return null;
      const u = json?.usage ?? {};
      // llama-server ajoute ses mesures (`timings`) : vitesse de génération en jetons par seconde.
      const v = Number(json?.timings?.predicted_per_second);
      return { texte, jetons: { entree: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null, sortie: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null }, ...(Number.isFinite(v) && v > 0 ? { vitesse: v } : {}) };
    },
  },
};

/** Lit un corps de réponse en texte, borné (une API qui renverrait des mégaoctets est coupée). */
async function lireBorne(reponse, max) {
  if (!reponse.body?.getReader) {
    const t = await reponse.text();
    return t.length > max ? null : t;
  }
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) {
    octets.set(m, i);
    i += m.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(octets);
}

/**
 * Un échange « chat completions » : requête de l'adaptateur, délai, lecture bornée, erreurs au code
 * stable dont le message ne contient JAMAIS la clé. Partagé par le connecteur d'API et l'IA locale.
 */
/**
 * Cause technique d'un échec de `fetch` (code système ou d'undici : ECONNREFUSED, ECONNRESET,
 * UND_ERR_HEADERS_TIMEOUT…), pour le journal et le message. Seulement un code court en majuscules (jamais
 * un texte libre qui pourrait contenir une adresse ou une clé).
 */
export function causeEchec(e) {
  for (const v of [e?.cause?.code, e?.code, e?.cause?.cause?.code, e?.cause?.name, e?.name]) {
    const c = String(v ?? '');
    if (/^[A-Z][A-Z0-9_]{1,39}$/.test(c)) return c;
    if (/^[A-Za-z]{2,40}Error$/.test(c) && c !== 'TypeError' && c !== 'Error') return c;
  }
  return 'inconnue';
}

const COUPURES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'ECONNABORTED']);
const DELAIS_CLIENT = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT']);

/** Erreur stable d'un `fetch` échoué (code précis pour l'IA locale), avec sa cause technique jointe. */
function erreurTransport(e, local) {
  const cause = causeEchec(e);
  let err;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') err = echec(504, 'ia-delai', 'Le service d’IA met trop de temps à répondre.');
  else if (DELAIS_CLIENT.has(cause)) err = echec(504, 'ia-delai-connexion', `La connexion au service d’IA a expiré avant sa réponse (${cause}).`);
  else if (local && cause === 'ECONNREFUSED') err = echec(502, 'ia-locale-arretee', 'L’IA locale ne répond plus : son moteur s’est arrêté (voir ~/logs/esport-ia-locale.log).');
  else if (local && COUPURES.has(cause)) err = echec(502, 'ia-locale-coupee', `Le moteur d’IA locale a coupé la connexion pendant le calcul (${cause} ; voir ~/logs/esport-ia-locale.log).`);
  else err = echec(502, 'ia-injoignable', `Service d’IA injoignable${cause !== 'inconnue' ? ` (${cause})` : ''}.`);
  err.cause = cause;
  return err;
}

async function echanger({ adaptateur, config, messages, options, fetchIa, delai, maintenant, journaliser = null }) {
  const { url, init } = adaptateur.requete(config, messages, options);
  const debut = maintenant();
  const local = config.fournisseur === 'local';
  let r;
  try {
    r = await fetchIa(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(options.delai ?? delai) });
  } catch (e) {
    const err = erreurTransport(e, local);
    try {
      journaliser?.(`requête échouée après ${Math.round((maintenant() - debut) / 1000)} s : ${err.code} (cause ${err.cause})`, err.code);
    } catch {
      // Journal indisponible : l'erreur reste rendue.
    }
    throw err;
  }
  const texte = await lireBorne(r, TAILLE_MAX_REPONSE_IA).catch(() => null);
  if (r.status === 401 || r.status === 403) throw echec(502, 'ia-cle-refusee', 'Le service d’IA refuse la clé d’API (vérifiez IA_API_CLE).');
  if (r.status === 429) throw echec(502, 'ia-limite-fournisseur', 'Le service d’IA limite les appels (quota du fournisseur atteint) : réessayez plus tard.');
  if (r.status === 404) throw echec(502, 'ia-modele', 'Modèle ou adresse inconnus du service d’IA (vérifiez IA_MODELE et IA_API_URL).');
  if (!r.ok) {
    try {
      journaliser?.(`réponse HTTP ${r.status} après ${Math.round((maintenant() - debut) / 1000)} s`, 'ia-injoignable');
    } catch {
      // Journal indisponible.
    }
    throw echec(502, 'ia-injoignable', `Service d’IA injoignable (HTTP ${r.status}).`);
  }
  let json;
  try {
    json = texte === null ? null : JSON.parse(texte);
  } catch {
    json = null;
  }
  const sortie = json ? adaptateur.reponse(json) : null;
  if (!sortie) {
    try {
      journaliser?.(`réponse illisible après ${Math.round((maintenant() - debut) / 1000)} s (${texte === null ? 'corps coupé ou trop long' : `${texte.length} caractères`})`, 'ia-reponse');
    } catch {
      // Journal indisponible.
    }
    throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
  }
  return { ...sortie, dureeMs: maintenant() - debut };
}

/**
 * Connecteur prêt à l'emploi. `fetch` est injectable (tests : faux serveur, jamais de réseau réel).
 * `discuter(messages, options)` → { texte, jetons, dureeMs } ; erreurs : ErreurEsport au code stable
 * (ia-non-configuree, ia-cle-refusee, ia-limite-fournisseur, ia-delai, ia-delai-connexion, ia-injoignable,
 * ia-reponse ; IA locale : ia-locale-arretee, ia-locale-coupee),
 * dont le message ne contient JAMAIS la clé.
 */
export function creerConnecteur(config, { fetch: fetchIa = (...a) => globalThis.fetch(...a), delai = DELAI_IA_MS, maintenant = () => Date.now() } = {}) {
  const adaptateur = ADAPTATEURS[config?.format ?? 'openai-chat'];
  return {
    config,
    disponible: () => Boolean(config?.actif && adaptateur),
    async discuter(messages, options = {}) {
      if (!config?.actif || !adaptateur) throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
      return echanger({ adaptateur, config, messages, options, fetchIa, delai, maintenant });
    },
  };
}

// ------------------------------------------------------------------ IA locale

const entier = (v, defaut, min, max) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : defaut;
};

/**
 * Réglages de l'IA LOCALE (llama.cpp sur le serveur, installée par esport/serveur/installer-ia-locale.sh) :
 *
 *   IA_LOCALE_DOSSIER          dossier de l'installation (défaut ~/.appdashboard/ia-locale, rempli par le serveur)
 *   IA_LOCALE_MODELE           qwen2.5-7b (défaut) ou qwen3-4b (plus petit, plus rapide)
 *   IA_LOCALE_THREADS          fils de calcul (défaut 8, de 1 à 32)
 *   IA_LOCALE_CONTEXTE         taille du contexte en jetons (défaut 16384, de 4096 à 32768)
 *   IA_LOCALE_INACTIVITE_MIN   arrêt du moteur après N minutes sans requête (défaut 5 ; 0 = tout de suite)
 *   IA_LOCALE_DELAI_MIN        durée maximale d'UNE requête, attente comprise (défaut 20 min)
 *   IA_LOCALE_DEMARRAGE_S      chargement du modèle au plus (défaut 300 s)
 *   IA_LOCALE_JETONS_MAX       jetons générés au plus par requête (défaut 4096)
 *   IA_LOCALE_FILE_MAX         requêtes en attente au plus (défaut 4)
 *   IA_LOCALE_NICE             priorité du moteur (défaut 19, la plus basse)
 *   IA_LOCALE_DUREE_TRAVAILLEUR_MIN  durée de travail d'un processus de fond avant de passer la main (défaut 60)
 *
 * Pas de quota mensuel ici (rien n'est payé) : la durée et la concurrence sont bornées à la place.
 */
export function configIaLocale(env = process.env) {
  const modele = String(env.IA_LOCALE_MODELE ?? '').trim().toLowerCase() || 'qwen2.5-7b';
  return {
    dossier: String(env.IA_LOCALE_DOSSIER ?? '').trim() || null,
    modele: /^[a-z0-9._-]{1,40}$/.test(modele) ? modele : 'qwen2.5-7b',
    threads: entier(env.IA_LOCALE_THREADS, 8, 1, 32),
    contexte: entier(env.IA_LOCALE_CONTEXTE, 16_384, 4096, 32_768),
    inactiviteMs: entier(env.IA_LOCALE_INACTIVITE_MIN, 5, 0, 120) * 60_000,
    delaiMs: entier(env.IA_LOCALE_DELAI_MIN, 20, 1, 120) * 60_000,
    demarrageMs: entier(env.IA_LOCALE_DEMARRAGE_S, 300, 10, 1800) * 1000,
    jetonsMax: entier(env.IA_LOCALE_JETONS_MAX, 4096, 256, 16_384),
    fileMax: entier(env.IA_LOCALE_FILE_MAX, 4, 1, 20),
    nice: entier(env.IA_LOCALE_NICE, 19, 0, 19),
    dureeTravailleurMs: entier(env.IA_LOCALE_DUREE_TRAVAILLEUR_MIN, 60, 5, 600) * 60_000,
  };
}

/**
 * Connecteur de l'IA locale : même contrat que `creerConnecteur`. `gestionnaire.executer(fn)` démarre le
 * serveur d'inférence au besoin et passe `{ port, cle }`. L'adresse est construite ICI, et seulement ici :
 * http://127.0.0.1:<port entier>/v1/chat/completions — c'est la seule exception à « https public seulement »,
 * réservée au serveur local géré (jamais une adresse venue de la configuration, d'une page ou du modèle).
 */
export function creerConnecteurLocal(gestionnaire, { modele = 'local', jetonsMax = 4096, delai = 20 * 60_000, fetch: fetchIa = (...a) => globalThis.fetch(...a), maintenant = () => Date.now() } = {}) {
  // Diagnostic : la cause réelle d'un échec va dans ~/logs/esport-ia-locale.log (via le gestionnaire).
  const journaliser = (texte, code) => gestionnaire?.noterIncident?.(texte, code);
  const adaptateur = ADAPTATEURS['openai-chat'];
  return {
    local: true,
    modele,
    disponible: () => Boolean(gestionnaire),
    async discuter(messages, options = {}) {
      if (!gestionnaire) throw echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).');
      const total = options.delaiLocal ?? delai;
      const r = await gestionnaire.executer(
        async ({ port, cle, limite }) => {
          if (!Number.isInteger(port) || port < 1024 || port > 65535) throw echec(502, 'ia-injoignable', 'Service d’IA injoignable.');
          const config = { fournisseur: 'local', modele, url: `http://127.0.0.1:${port}/v1/chat/completions`, lireCle: () => cle };
          const reste = Math.max(1000, limite - maintenant());
          return echanger({ adaptateur, config, messages, options: { ...options, json: options.json ?? true, maxJetons: Math.min(options.maxJetons ?? jetonsMax, jetonsMax), delai: reste }, fetchIa, delai: reste, maintenant, journaliser });
        },
        { delai: total },
      );
      gestionnaire.noterMesure?.({ jetonsParSeconde: r.vitesse, dureeMs: r.dureeMs });
      return r;
    },
  };
}

/**
 * Extrait l'objet JSON d'une réponse de modèle (bloc ```json … ```, texte autour) ; null si illisible.
 * Le texte vient d'une IA : c'est une DONNÉE, jamais du code (JSON.parse seulement, borné).
 */
export function extraireJson(texte, max = TAILLE_MAX_REPONSE_IA) {
  const t = String(texte ?? '');
  if (!t || t.length > max) return null;
  const essais = [t.trim()];
  const bloc = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (bloc) essais.push(bloc[1].trim());
  const debut = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (debut >= 0 && fin > debut) essais.push(t.slice(debut, fin + 1));
  for (const e of essais) {
    try {
      const v = JSON.parse(e);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // essai suivant
    }
  }
  return null;
}
