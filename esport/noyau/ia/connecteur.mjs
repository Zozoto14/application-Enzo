/**
 * Connecteur IA générique (assistant des profils de jeu, et tout module qui a besoin d'un modèle : traductions,
 * textes de la section CM, post-correction des transcriptions…). Les clés d'API et les modèles se règlent dans
 * ~/.appdashboard/esport.env (jamais dans le dépôt) ; mode d'emploi : docs/esport/ia-api.md.
 *
 * TROIS MOTEURS, essayés dans un ORDRE DE REPLI propre à chaque tâche :
 *  - « api »   moteur d'API PRINCIPAL :
 *     IA_API_URL      adresse de l'API « chat completions » compatible OpenAI (https seulement) ; l'adresse
 *                     de base suffit (…/v1), « /chat/completions » est ajouté s'il manque
 *     IA_API_CLE      clé d'API (secret : jamais renvoyée par le serveur, jamais journalisée)
 *     IA_MODELE       modèle (ex. mistralai/mistral-large-4-1t-a52b chez NVIDIA, gpt-4o-mini, mistral-small-latest…)
 *     IA_FOURNISSEUR  facultatif : nvidia, openai, mistral, gemini, deepseek, groq, autre (déduit de l'adresse
 *                     sinon) ; règle les petites différences (sortie JSON forcée ou non). « local » : l'IA LOCALE
 *                     passe en tête de l'ordre de repli par défaut des profils de jeu
 *  - « api2 »  moteur d'API SECONDAIRE (facultatif ; tâches légères par défaut) : IA_API2_URL (même adresse
 *     que IA_API_URL si vide), IA_API2_CLE, IA_MODELE2, IA_FOURNISSEUR2 ;
 *  - « local » IA LOCALE (llama.cpp sur le serveur, voir `configIaLocale` et docs/esport/ia-locale.md).
 *
 *   Réglages fins d'un moteur d'API (facultatifs ; « API2 » pour le secondaire) :
 *     IA_API_DELAI_S   durée maximale d'une réponse (défaut 90 s ; 300 s pour un modèle « à raisonnement »)
 *     IA_API_EFFORT    effort de raisonnement envoyé (low, medium, high ; « aucun » pour ne rien envoyer) ;
 *                      par défaut celui du profil du modèle (`PROFILS_MODELES`), rien pour un modèle inconnu
 *     IA_API_FLUX      « oui » : réponse en flux (SSE), utile pour les très longues réponses
 *     IA_API_IMAGES    « oui » / « non » : le modèle lit-il des images (défaut : profil du modèle)
 *
 *   IA_ORDRE         ordre de repli des PROFILS DE JEU (brouillons, vérifications) : défaut « api,api2,local »
 *                    (« local,api,api2 » avec IA_FOURNISSEUR=local)
 *   IA_ORDRE_LEGER   ordre de repli des TÂCHES LÉGÈRES (traductions, posts CM, post-correction des
 *                    transcriptions) : défaut « api2,api,local »
 *   (l'Administration IA peut changer ces deux ordres ; son choix l'emporte sur ces lignes)
 *   IA_FORMAT        facultatif : « openai-chat » (seul format pour l'instant ; voir ADAPTATEURS)
 *   IA_RECHERCHE     facultatif : « serveur » (défaut : le serveur lit lui-même quelques pages web),
 *                    « modele » (le modèle sait naviguer : il cherche lui-même), « aucune »
 *
 * Sans aucune clé ni IA locale : l'assistant est désactivé, tout reste faisable à la main.
 *
 * Un ADAPTATEUR par format d'API (`ADAPTATEURS`) : `requete(config, messages, options, etat)` → { url, init },
 * `reponse(json)` → { texte, jetons }. Ajouter un format (API Anthropic, Gemini native…) = ajouter une
 * entrée, sans toucher au reste de l'assistant.
 *
 * Point d'entrée des autres modules : `creerIaDepuisEnv(env, { local })` puis `discuterPour(tache, messages,
 * options)` (voir `creerRepartiteurIa`) ; le service des profils de jeu en expose un qui compte les appels et
 * respecte l'ordre choisi dans l'Administration IA (`servicesJeux(...).discuterPour`).
 */

import { ErreurEsport, echec } from '../outils.mjs';

/** Adresses par défaut des fournisseurs connus (si IA_API_URL est vide). */
export const FOURNISSEURS = {
  openai: { url: 'https://api.openai.com/v1', jsonForce: true },
  mistral: { url: 'https://api.mistral.ai/v1', jsonForce: true },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', jsonForce: true },
  deepseek: { url: 'https://api.deepseek.com/v1', jsonForce: true },
  groq: { url: 'https://api.groq.com/openai/v1', jsonForce: true },
  // NVIDIA (build.nvidia.com) : `response_format` n'est pas accepté par tous les modèles ; s'il est refusé
  // (HTTP 400), la requête est refaite sans, et le connecteur s'en souvient (consigne + extraction robuste).
  nvidia: { url: 'https://integrate.api.nvidia.com/v1', jsonForce: true },
  autre: { url: '', jsonForce: false },
};

const HOTES = [
  ['api.openai.com', 'openai'],
  ['api.mistral.ai', 'mistral'],
  ['generativelanguage.googleapis.com', 'gemini'],
  ['api.deepseek.com', 'deepseek'],
  ['api.groq.com', 'groq'],
  ['integrate.api.nvidia.com', 'nvidia'],
];

export const DELAI_IA_MS = 90_000;
export const TAILLE_MAX_REPONSE_IA = 512 * 1024;
export const EFFORTS_IA = ['low', 'medium', 'high'];

/**
 * Profils des modèles connus (nom du modèle tel que l'API l'attend). `raisonnement` : le modèle « réfléchit »
 * avant de répondre (réponses longues : délai et jetons relevés) ; `effort` : `reasoning_effort` envoyé par
 * défaut (null : le modèle ne l'accepte pas, rien n'est envoyé) ; `images` : lit les images (multimodal).
 */
export const PROFILS_MODELES = [
  { motif: /^mistralai\/mistral-large-4/i, raisonnement: true, effort: 'high', images: true, temperature: 0.5, topP: 1 },
  { motif: /^openai\/gpt-oss-/i, raisonnement: true, effort: null, images: false, temperature: 1, topP: 1 },
];
/** Modèle à raisonnement : au moins 4096 jetons (le raisonnement en consomme), 5 min par réponse (2 min au moins). */
const REGLAGES_RAISONNEMENT = { jetonsMin: 4096, delaiMs: 5 * 60_000, delaiMinMs: 2 * 60_000 };

/** Profil d'un modèle (réglages par défaut ; rien de particulier pour un modèle inconnu). */
export function profilModele(modele) {
  const p = PROFILS_MODELES.find(x => x.motif.test(String(modele ?? '')));
  if (!p) return { raisonnement: false, effort: null, images: false };
  const { motif: _motif, ...reste } = p;
  return { ...reste, ...(p.raisonnement ? REGLAGES_RAISONNEMENT : {}) };
}

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

// ------------------------------------------------------------------ Moteurs, tâches, ordres de repli

export const MOTEURS_IA = ['api', 'api2', 'local'];
/** Tâches : « profils » (brouillons, vérifications de profils de jeu) et « leger » (traductions, posts CM, transcription). */
export const TACHES_IA = ['profils', 'leger'];
export const ORDRES_IA_DEFAUT = { profils: ['api', 'api2', 'local'], leger: ['api2', 'api', 'local'] };
const ALIAS_TACHES = {
  profils: 'profils',
  brouillon: 'profils',
  verification: 'profils',
  sources: 'profils',
  test: 'profils',
  leger: 'leger',
  traduction: 'leger',
  cm: 'leger',
  transcription: 'leger',
  correction: 'leger',
};

/** Catégorie d'une tâche (« profils » ou « leger ») ; une tâche inconnue est légère. */
export const tacheIa = t => ALIAS_TACHES[String(t ?? '')] ?? 'leger';

/** Ordre de repli lu (« api,api2,local », tableau…) : moteurs connus, sans doublon ; `defaut` si rien de valable. */
export function lireOrdreIa(v, defaut = ORDRES_IA_DEFAUT.profils) {
  const brut = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;>]+/);
  const ordre = [...new Set(brut.map(x => String(x ?? '').trim().toLowerCase()).filter(m => MOTEURS_IA.includes(m)))];
  return ordre.length ? ordre : [...defaut];
}

/** Ordres de repli de l'environnement (IA_ORDRE, IA_ORDRE_LEGER). */
export function ordresIaEnv(env = process.env) {
  const local = String(env.IA_FOURNISSEUR ?? '').trim().toLowerCase() === 'local';
  return {
    profils: lireOrdreIa(env.IA_ORDRE, local ? ['local', 'api', 'api2'] : ORDRES_IA_DEFAUT.profils),
    leger: lireOrdreIa(env.IA_ORDRE_LEGER, ORDRES_IA_DEFAUT.leger),
  };
}

const oui = v => ['1', 'oui', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const non = v => ['0', 'non', 'false', 'no', 'off'].includes(String(v ?? '').trim().toLowerCase());

/**
 * Configuration d'un moteur d'API lue dans l'environnement : le principal (« api », variables IA_API_*,
 * IA_MODELE…) ou, avec `{ suffixe: '2' }`, le secondaire (« api2 », IA_API2_*, IA_MODELE2…). Rend un objet
 * SANS la clé en clair dans ses champs publics : `etatPublic()` est ce que l'API peut montrer (fournisseur,
 * modèle, hôte, clé présente ou non). Le principal porte aussi `secondaire` (config du moteur « api2 ») et
 * `ordres` (ordres de repli de l'environnement).
 */
export function configIa(env = process.env, { suffixe = '' } = {}) {
  const s = suffixe === '2' ? '2' : '';
  const lire = nom => String(env[nom] ?? '').trim();
  const cle = lire(`IA_API${s}_CLE`);
  const modele = lire(`IA_MODELE${s}`).slice(0, 100);
  let fournisseurDemande = lire(`IA_FOURNISSEUR${s}`).toLowerCase();
  // Le secondaire reprend l'adresse (et le fournisseur) du principal s'il n'en a pas.
  const urlBrute = lire(`IA_API${s}_URL`) || (s ? lire('IA_API_URL') : '');
  if (s && !fournisseurDemande && !lire('IA_API2_URL')) fournisseurDemande = lire('IA_FOURNISSEUR').toLowerCase();
  const fournisseur = FOURNISSEURS[fournisseurDemande] ? fournisseurDemande : urlBrute ? fournisseurDeUrl(urlBrute) : 'autre';
  // IA_FOURNISSEUR=local : l'IA locale passe en tête de l'ordre des profils de jeu (Administration IA pour changer).
  const modeDefaut = !s && fournisseurDemande === 'local' ? 'local' : 'api';
  const url = adresseCompletions(urlBrute || FOURNISSEURS[fournisseur]?.url || '');
  const format = ['openai-chat'].includes(env.IA_FORMAT) ? env.IA_FORMAT : 'openai-chat';
  const recherche = ['serveur', 'modele', 'aucune'].includes(env.IA_RECHERCHE) ? env.IA_RECHERCHE : 'serveur';
  const profil = profilModele(modele);
  const effortEnv = lire(`IA_API${s}_EFFORT`).toLowerCase();
  const effort = EFFORTS_IA.includes(effortEnv) ? effortEnv : ['aucun', 'none', 'non'].includes(effortEnv) ? null : profil.effort;
  const delaiS = Number.parseInt(lire(`IA_API${s}_DELAI_S`), 10);
  const imagesEnv = lire(`IA_API${s}_IMAGES`);
  let raison = null;
  if (!cle) raison = 'cle-absente';
  else if (!modele) raison = 'modele-absent';
  else if (!url) raison = 'url-invalide';
  const config = {
    moteur: s ? 'api2' : 'api',
    actif: !raison,
    raison,
    fournisseur,
    modele,
    url,
    format,
    recherche,
    modeDefaut,
    raisonnement: Boolean(profil.raisonnement),
    effort,
    images: oui(imagesEnv) ? true : non(imagesEnv) ? false : Boolean(profil.images),
    flux: oui(lire(`IA_API${s}_FLUX`)),
    temperature: profil.temperature ?? null,
    topP: profil.topP ?? null,
    jetonsMin: profil.jetonsMin ?? 0,
    delaiMs: Number.isInteger(delaiS) ? Math.min(1800, Math.max(10, delaiS)) * 1000 : (profil.delaiMs ?? null),
    delaiMinMs: profil.delaiMinMs ?? 0,
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
    /** État public détaillé d'un moteur (Administration IA) : jamais la clé, seulement « présente » ou « absente ». */
    moteurPublic() {
      return { id: this.moteur, ...this.etatPublic(), raisonnement: this.raisonnement, effort: this.effort, images: this.images, flux: this.flux, delaiS: Math.round((this.delaiMs ?? DELAI_IA_MS) / 1000) };
    },
    toJSON() {
      return this.etatPublic();
    },
  };
  if (!s) {
    Object.defineProperty(config, 'secondaire', { value: configIa(env, { suffixe: '2' }), enumerable: false });
    Object.defineProperty(config, 'ordres', { value: ordresIaEnv(env), enumerable: false });
  }
  return config;
}

// ------------------------------------------------------------------ Images (modèles multimodaux)

const MOTIF_IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Taille maximale d'une image (adresse data: en caractères, ≈ 3 Mo d'image). */
export const TAILLE_MAX_IMAGE_IA = 4 * 1024 * 1024;

/**
 * Message « texte + images » (format OpenAI : `content` en parties `text` / `image_url`), pour un modèle
 * multimodal (ex. lire une capture de bracket ou de résultat). Images : adresses `data:image/…;base64,…`
 * (png, jpeg, webp, gif ; 4 Mo au plus) ou https publiques ; 4 images au plus. Lève 400 `ia-image` sinon.
 */
export function messageAvecImages(texte, images = [], role = 'user') {
  if (!Array.isArray(images) || images.length > 4) throw echec(400, 'ia-image', 'Images : 4 au plus.');
  const parties = [{ type: 'text', text: String(texte ?? '') }];
  for (const i of images) {
    const url = String(i ?? '');
    let ok = url.length <= TAILLE_MAX_IMAGE_IA && MOTIF_IMAGE_DATA.test(url);
    if (!ok && url.length <= 2048) {
      try {
        const u = new URL(url);
        ok = u.protocol === 'https:' && !u.username && !u.password;
      } catch {
        ok = false;
      }
    }
    if (!ok) throw echec(400, 'ia-image', 'Image refusée : data:image/png|jpeg|webp|gif en base64 (4 Mo au plus) ou adresse https.');
    parties.push({ type: 'image_url', image_url: { url } });
  }
  return { role, content: parties };
}

/** Les messages contiennent-ils une image ? */
export const contientImages = messages => Array.isArray(messages) && messages.some(m => Array.isArray(m?.content) && m.content.some(p => p?.type === 'image_url'));

const imageNonGeree = () => echec(422, 'ia-image-non-geree', 'Ce moteur d’IA ne lit pas les images.');

// ------------------------------------------------------------------ Adaptateurs

/** Retire les blocs de « pensée » (<think>…</think>) qu'un modèle à raisonnement laisse parfois dans sa réponse. */
export const sansPensees = t => String(t ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export const ADAPTATEURS = {
  'openai-chat': {
    /**
     * `etat` (propre à un connecteur) : `sansEffort` / `sansFormat` quand le fournisseur a refusé
     * `reasoning_effort` / `response_format` (on ne les renvoie plus).
     */
    requete(config, messages, { json = true, maxJetons = 4000, temperature, schema = null, effort, flux = false } = {}, etat = {}) {
      const corps = { model: config.modele, messages, temperature: temperature ?? config.temperature ?? 0.2, max_tokens: Math.max(maxJetons, config.jetonsMin ?? 0) };
      if (config.topP !== null && config.topP !== undefined) corps.top_p = config.topP;
      // Effort de raisonnement : seulement pour un modèle qui l'accepte (profil ou IA_API_EFFORT) ; `effort` le change (test : low).
      if (config.effort && !etat.sansEffort) corps.reasoning_effort = EFFORTS_IA.includes(effort) ? effort : config.effort;
      // IA locale (llama-server) : sortie CONTRAINTE par le schéma JSON (grammaire), sinon un objet JSON.
      if (json && config.fournisseur === 'local') corps.response_format = schema ? { type: 'json_schema', json_schema: { name: 'reponse', schema, strict: true } } : { type: 'json_object' };
      // Sortie JSON forcée chez les fournisseurs qui la gèrent (le prompt la demande de toute façon).
      else if (json && !etat.sansFormat && (FOURNISSEURS[config.fournisseur]?.jsonForce ?? false)) corps.response_format = { type: 'json_object' };
      if (flux) Object.assign(corps, { stream: true, stream_options: { include_usage: true } });
      return {
        url: config.url,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.lireCle()}` },
          body: JSON.stringify(corps),
        },
      };
    },
    /**
     * Seul `message.content` est la réponse. `message.reasoning_content` (raisonnement des modèles à
     * raisonnement, ex. gpt-oss chez NVIDIA) est IGNORÉ : jamais lu comme la réponse, jamais journalisé.
     */
    reponse(json) {
      const brut = json?.choices?.[0]?.message?.content;
      const texte = typeof brut === 'string' ? sansPensees(brut) : '';
      if (!texte) return null;
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

/** Attente conseillée après un HTTP 429 : en-tête Retry-After (secondes ou date HTTP), sinon 2 s, 4 s, 8 s… (1 min au plus). */
export function attenteApres429(entetes, essai = 0, maintenant = Date.now()) {
  const v = entetes?.get?.('retry-after');
  if (v) {
    const s = Number(v);
    if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
    const d = Date.parse(v);
    if (Number.isFinite(d)) return Math.max(0, d - maintenant);
  }
  return Math.min(60_000, 2000 * 2 ** essai);
}

const dormir = ms => new Promise(ok => setTimeout(ok, ms));
const ERREUR_FLUX_API = () => echec(502, 'ia-injoignable', 'Le service d’IA a signalé une erreur pendant sa réponse.');

/**
 * Un échange « chat completions » avec une API externe : requête de l'adaptateur, délai (relevé pour un modèle à
 * raisonnement), lecture bornée (ou en flux), erreurs au code stable dont le message ne contient JAMAIS la clé.
 *  - HTTP 429 (limite de débit, ex. NVIDIA) : on attend `Retry-After` (ou 2 s, 4 s…) et on réessaie
 *    `options.essais429` fois (1 par défaut) si l'attente ne dépasse pas `attente429MaxMs` ; sinon
 *    `ia-limite-fournisseur` (avec `reessayerApresMs`), et le répartiteur passe au moteur suivant ;
 *  - HTTP 400 qui refuse `reasoning_effort` ou `response_format` : refait sans, et `etat` s'en souvient.
 * Le journal ne reçoit que des codes, durées et tailles (jamais un corps, une clé ni un raisonnement).
 */
async function echanger({ adaptateur, config, messages, options, fetchIa, delai, maintenant, journaliser = null, etat = {}, attendre = dormir, attente429MaxMs = 15_000 }) {
  const debut = maintenant();
  const local = config.fournisseur === 'local';
  const noter = (texte, code) => {
    try {
      journaliser?.(texte, code);
    } catch {
      // Journal indisponible : l'erreur reste rendue.
    }
  };
  const secondes = () => Math.round((maintenant() - debut) / 1000);
  const flux = Boolean(options.flux ?? config.flux);
  const duree0 = options.delai !== undefined && options.delai !== null ? Math.max(options.delai, config.delaiMinMs ?? 0) : (config.delaiMs ?? delai);
  // Plafond imposé par l'appelant (test de connexion de l'Administration IA) : même pour un modèle à raisonnement.
  const duree = options.delaiMax > 0 ? Math.min(duree0, options.delaiMax) : duree0;
  const essais429 = Number.isInteger(options.essais429) ? Math.max(0, options.essais429) : 1;
  let attentes = 0;
  for (let tour = 0; tour < 6; tour++) {
    const { url, init } = adaptateur.requete(config, messages, { ...options, flux }, etat);
    const envoye = JSON.parse(init.body);
    let r;
    try {
      r = await fetchIa(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(duree) });
    } catch (e) {
      const err = erreurTransport(e, local);
      noter(`requête échouée après ${secondes()} s : ${err.code} (cause ${err.cause})`, err.code);
      throw err;
    }
    const enFlux = r.ok && flux && /event-stream/i.test(r.headers?.get?.('content-type') ?? '');
    const texte = enFlux ? null : await lireBorne(r, TAILLE_MAX_REPONSE_IA).catch(() => null);
    if (r.status === 401 || r.status === 403) throw echec(502, 'ia-cle-refusee', `Le service d’IA refuse la clé d’API (vérifiez ${config.moteur === 'api2' ? 'IA_API2_CLE' : 'IA_API_CLE'}).`);
    if (r.status === 429) {
      const ms = attenteApres429(r.headers, attentes, Date.now());
      if (attentes < essais429 && ms <= attente429MaxMs) {
        attentes++;
        noter(`limite de débit (HTTP 429) : nouvel essai dans ${Math.ceil(ms / 1000)} s`, 'ia-limite-fournisseur');
        await attendre(ms);
        continue;
      }
      noter(`limite de débit (HTTP 429) après ${secondes()} s : moteur suivant`, 'ia-limite-fournisseur');
      throw Object.assign(echec(502, 'ia-limite-fournisseur', 'Le service d’IA limite les appels (quota ou débit du fournisseur atteint) : réessayez plus tard.'), { reessayerApresMs: ms });
    }
    if (r.status === 404) throw echec(502, 'ia-modele', `Modèle ou adresse inconnus du service d’IA (vérifiez ${config.moteur === 'api2' ? 'IA_MODELE2 et IA_API2_URL' : 'IA_MODELE et IA_API_URL'}).`);
    if (r.status === 400 || r.status === 422) {
      // Paramètre refusé par ce modèle : on le retire et on réessaie (le corps n'est que testé, jamais journalisé).
      const t = String(texte ?? '').slice(0, 4000);
      if (envoye.reasoning_effort && !etat.sansEffort && /reasoning[_ ]?effort/i.test(t)) {
        etat.sansEffort = true;
        noter('reasoning_effort refusé par le modèle : renvoyé sans', 'ia-parametre');
        continue;
      }
      if (envoye.response_format && !etat.sansFormat && /response[_ ]?format|json_object|json mode|guided/i.test(t)) {
        etat.sansFormat = true;
        noter('response_format refusé par le modèle : renvoyé sans (consigne JSON seulement)', 'ia-parametre');
        continue;
      }
      noter(`requête refusée (HTTP ${r.status}) après ${secondes()} s`, 'ia-requete-refusee');
      throw echec(502, 'ia-requete-refusee', `Le service d’IA refuse la requête (HTTP ${r.status}) : modèle ou paramètres non acceptés.`);
    }
    if (!r.ok) {
      noter(`réponse HTTP ${r.status} après ${secondes()} s`, 'ia-injoignable');
      throw echec(502, 'ia-injoignable', `Service d’IA injoignable (HTTP ${r.status}).`);
    }
    if (enFlux) {
      let f;
      try {
        f = await lireFluxLocal(r.body, {
          surVie: () => undefined,
          surMorceau: m => {
            try {
              options.progression?.(m);
            } catch {
              // Affichage de la progression : jamais bloquant.
            }
          },
          erreur: ERREUR_FLUX_API,
        });
      } catch (e) {
        if (e instanceof ErreurEsport) throw e;
        throw erreurTransport(e, false);
      }
      const t = sansPensees(f.texte);
      if (f.fin === 'length' && !t) throw echec(502, 'ia-reponse-tronquee', 'Réponse du service d’IA incomplète (limite de jetons atteinte, raisonnement compris).');
      if (!t) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
      const u = f.usage ?? {};
      return { texte: t, jetons: { entree: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null, sortie: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null }, dureeMs: maintenant() - debut };
    }
    let json;
    try {
      json = texte === null ? null : JSON.parse(texte);
    } catch {
      json = null;
    }
    const sortie = json ? adaptateur.reponse(json) : null;
    if (!sortie) {
      const choix = json?.choices?.[0];
      const raisonnement = choix?.message?.reasoning_content;
      // Seulement des tailles : ni la réponse ni le raisonnement ne sont copiés dans le journal.
      noter(`réponse illisible après ${secondes()} s (${texte === null ? 'corps coupé ou trop long' : `${texte.length} caractères`}${typeof raisonnement === 'string' ? `, raisonnement ignoré : ${raisonnement.length} caractères` : ''})`, 'ia-reponse');
      if (choix?.finish_reason === 'length') throw echec(502, 'ia-reponse-tronquee', 'Réponse du service d’IA incomplète (limite de jetons atteinte, raisonnement compris).');
      throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
    }
    return { ...sortie, dureeMs: maintenant() - debut };
  }
  throw echec(502, 'ia-requete-refusee', 'Le service d’IA refuse la requête : modèle ou paramètres non acceptés.');
}

/**
 * Connecteur d'un moteur d'API prêt à l'emploi. `fetch` est injectable (tests : faux serveur, jamais de réseau
 * réel) ; `journal(texte, code)` facultatif (codes et durées seulement) ; `attendre(ms)` injectable (429).
 * `discuter(messages, options)` → { texte, jetons, dureeMs } ; options : `json` (défaut true), `maxJetons`,
 * `temperature`, `effort` (low/medium/high, modèle à raisonnement seulement), `delai`, `flux`, `essais429`,
 * `progression` (flux). Erreurs : ErreurEsport au code stable (ia-non-configuree, ia-cle-refusee,
 * ia-limite-fournisseur, ia-requete-refusee, ia-modele, ia-delai, ia-delai-connexion, ia-injoignable, ia-reponse,
 * ia-reponse-tronquee, ia-image-non-geree ; IA locale : ia-locale-arretee, ia-locale-coupee…), dont le message ne
 * contient JAMAIS la clé.
 */
export function creerConnecteur(config, { fetch: fetchIa = (...a) => globalThis.fetch(...a), delai = DELAI_IA_MS, maintenant = () => Date.now(), journal = null, attendre = dormir, attente429MaxMs = 15_000 } = {}) {
  const adaptateur = ADAPTATEURS[config?.format ?? 'openai-chat'];
  // Paramètres refusés par ce modèle (reasoning_effort, response_format), retenus pour les appels suivants.
  const etat = {};
  const journaliser = journal ? (texte, code) => journal(`[ia ${config?.moteur ?? 'api'}] ${texte}`, code) : null;
  return {
    config,
    moteur: config?.moteur ?? 'api',
    images: Boolean(config?.images),
    disponible: () => Boolean(config?.actif && adaptateur),
    async discuter(messages, options = {}) {
      if (!config?.actif || !adaptateur) throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
      if (contientImages(messages) && !config.images) throw imageNonGeree();
      return echanger({ adaptateur, config, messages, options, fetchIa, delai, maintenant, journaliser, etat, attendre, attente429MaxMs });
    },
  };
}

// ------------------------------------------------------------------ Répartiteur (ordre de repli par tâche)

/** Erreurs après lesquelles on essaie le moteur suivant : moteur en panne ou saturé, plafond, image non lue… */
const CODES_REPLI = new Set(['ia-limite-fournisseur', 'quota-ia', 'ia-image-non-geree', 'ia-non-configuree', 'ia-locale-absente', 'ia-locale-indisponible']);
export const peutReplier = e => CODES_REPLI.has(e?.code) || (e?.statut ?? 500) >= 500;

/**
 * Répartiteur : envoie une demande au premier moteur disponible de l'ordre de repli de la TÂCHE, puis au suivant
 * si celui-ci échoue (panne, délai, limite de débit 429, plafond mensuel, image non lue…). Une erreur de la
 * demande elle-même (400, 403…) n'est pas répétée ailleurs.
 *
 *  - `moteurs` : { api, api2, local } → connecteurs (`disponible()`, `discuter()`, `images`) ; un absent est ignoré ;
 *  - `ordres` : { profils, leger } (défaut ORDRES_IA_DEFAUT), ou `ordrePour(categorie)` (async : réglage en base) ;
 *  - `executer(moteur, tache, messages, options)` : facultatif, remplace `moteurs[m].discuter` (comptage, plafond).
 *
 * `discuterPour(tache, messages, options)` → { texte, jetons, dureeMs, moteur }. `tache` : « profils »,
 * « leger », ou un alias (brouillon, verification, sources, test → profils ; traduction, cm, transcription,
 * correction → leger ; inconnue → leger). Options en plus de celles du connecteur : `cible` (un seul moteur),
 * `moteurs` (ordre imposé pour cet appel).
 */
export function creerRepartiteurIa({ moteurs = {}, ordres = ORDRES_IA_DEFAUT, ordrePour = null, executer = null, journal = null } = {}) {
  const pret = m => {
    try {
      return Boolean(moteurs[m]?.disponible?.());
    } catch {
      return false;
    }
  };
  const ordreDe = async tache => {
    const c = tacheIa(tache);
    return lireOrdreIa(ordrePour ? await ordrePour(c) : ordres?.[c], ORDRES_IA_DEFAUT[c]);
  };
  async function discuterPour(tache, messages, options = {}) {
    const { cible, moteurs: impose, ...reste } = options;
    const ordre = cible ? [String(cible)].filter(m => MOTEURS_IA.includes(m)) : impose ? lireOrdreIa(impose, []) : await ordreDe(tache);
    const images = contientImages(messages);
    const prets = ordre.filter(pret);
    const candidats = images ? prets.filter(m => moteurs[m].images) : prets;
    if (!candidats.length) {
      if (images && prets.length) throw imageNonGeree();
      if (ordre.includes('local') && moteurs.local && !pret('local') && moteurs.local.indisponible?.()) {
        throw echec(503, 'ia-locale-indisponible', 'IA locale indisponible sur cet hébergement : son moteur est arrêté de force (SIGKILL) par l’hébergeur. Elle est sautée dans l’ordre de repli (voir Administration IA).');
      }
      throw ordre[0] === 'local'
        ? echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).')
        : echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
    }
    for (const [i, m] of candidats.entries()) {
      try {
        const r = executer ? await executer(m, tache, messages, reste) : await moteurs[m].discuter(messages, reste);
        return { ...r, moteur: m };
      } catch (e) {
        if (i === candidats.length - 1 || !peutReplier(e)) throw e;
        try {
          journal?.(`[ia] moteur ${m} en échec (${e?.code ?? 'erreur'}) : repli sur ${candidats[i + 1]}`);
        } catch {
          // Journal indisponible.
        }
      }
    }
    throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
  }
  return { discuterPour, ordrePour: ordreDe, disponibles: async tache => (await ordreDe(tache)).filter(pret), pret };
}

/**
 * Répartiteur prêt à l'emploi depuis l'environnement (IA_API_*, IA_API2_*, IA_ORDRE, IA_ORDRE_LEGER), pour un
 * module qui n'a pas le service des profils de jeu sous la main (processus de fond de la transcription…).
 * `local` : connecteur de l'IA locale (creerConnecteurLocal), facultatif ; `ordrePour` : pour lire l'ordre
 * réglé dans l'Administration IA (voir `ordreIaReglee` du service des profils de jeu). Les appels faits ainsi
 * ne sont pas comptés dans les plafonds mensuels de l'Administration IA.
 */
export function creerIaDepuisEnv(env = process.env, { local = null, fetch, journal = null, ordrePour = null, maintenant } = {}) {
  const c = configIa(env);
  const opts = { ...(fetch ? { fetch } : {}), ...(maintenant ? { maintenant } : {}), ...(journal ? { journal } : {}) };
  const moteurs = { api: creerConnecteur(c, opts), api2: creerConnecteur(c.secondaire, opts), ...(local ? { local } : {}) };
  return creerRepartiteurIa({ moteurs, ordres: c.ordres, ordrePour, journal });
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
 *   IA_LOCALE_CONTEXTE         taille du contexte en jetons (défaut 8192, de 4096 à 32768 ; plus = plus de mémoire)
 *   IA_LOCALE_INACTIVITE_MIN   arrêt du moteur après N minutes sans requête (défaut 5 ; 0 = tout de suite)
 *   IA_LOCALE_DELAI_MIN        durée maximale d'UNE requête, attente comprise (défaut 20 min)
 *   IA_LOCALE_DEMARRAGE_S      chargement du modèle au plus (défaut 300 s)
 *   IA_LOCALE_JETONS_MAX       jetons générés au plus par requête (défaut 4096)
 *   IA_LOCALE_FILE_MAX         requêtes en attente au plus (défaut 4)
 *   IA_LOCALE_NICE             priorité du moteur (défaut 19, la plus basse)
 *   IA_LOCALE_DUREE_TRAVAILLEUR_MIN  durée de travail d'un processus de fond avant de passer la main (défaut 60)
 *   IA_LOCALE_TUES_MAX         arrêts de force (SIGKILL de l'hébergeur) de suite avant de déclarer l'IA locale
 *                              « indisponible sur cet hébergement » et de la sauter dans les ordres de repli (défaut 2)
 *
 * Pas de quota mensuel ici (rien n'est payé) : la durée et la concurrence sont bornées à la place.
 */
export function configIaLocale(env = process.env) {
  const modele = String(env.IA_LOCALE_MODELE ?? '').trim().toLowerCase() || 'qwen2.5-7b';
  return {
    dossier: String(env.IA_LOCALE_DOSSIER ?? '').trim() || null,
    modele: /^[a-z0-9._-]{1,40}$/.test(modele) ? modele : 'qwen2.5-7b',
    threads: entier(env.IA_LOCALE_THREADS, 8, 1, 32),
    contexte: entier(env.IA_LOCALE_CONTEXTE, 8192, 4096, 32_768),
    inactiviteMs: entier(env.IA_LOCALE_INACTIVITE_MIN, 5, 0, 120) * 60_000,
    delaiMs: entier(env.IA_LOCALE_DELAI_MIN, 20, 1, 120) * 60_000,
    demarrageMs: entier(env.IA_LOCALE_DEMARRAGE_S, 300, 10, 1800) * 1000,
    jetonsMax: entier(env.IA_LOCALE_JETONS_MAX, 4096, 256, 16_384),
    fileMax: entier(env.IA_LOCALE_FILE_MAX, 4, 1, 20),
    nice: entier(env.IA_LOCALE_NICE, 19, 0, 19),
    dureeTravailleurMs: entier(env.IA_LOCALE_DUREE_TRAVAILLEUR_MIN, 60, 5, 600) * 60_000,
    tuesMax: entier(env.IA_LOCALE_TUES_MAX, 2, 1, 50),
  };
}

/** Silence maximal du moteur local pendant un calcul en flux (le moteur envoie un signe de vie toutes les 30 s). */
export const SILENCE_MAX_LOCAL_MS = 5 * 60_000;
/** Battement demandé au moteur (« ping » SSE) pendant un calcul en flux. */
export const PING_LOCAL_S = 30;
const LIGNE_MAX_FLUX = 1024 * 1024;
const TYPE_ERREUR = /^[a-z_]{1,40}$/;

/** Erreur du moteur local (statut HTTP ≠ 200, ou événement d'erreur dans le flux) → code stable et clair. */
function erreurMoteurLocal(statut, json) {
  const e = json?.error && typeof json.error === 'object' ? json.error : {};
  const type = TYPE_ERREUR.test(String(e.type ?? '')) ? String(e.type) : null;
  if (type === 'exceed_context_size_error' || /context size|context length/i.test(String(e.message ?? '').slice(0, 300))) {
    return Object.assign(echec(502, 'ia-locale-contexte', 'La demande dépasse la mémoire de travail (contexte) de l’IA locale : moins de pages de référence, ou IA_LOCALE_CONTEXTE plus grand.'), { cause: type ?? `HTTP_${statut}` });
  }
  const detail = `HTTP ${statut}${type ? `, ${type}` : ''}`;
  return Object.assign(echec(502, 'ia-locale-refus', `Le moteur d’IA locale a refusé la requête (${detail} ; voir ~/logs/esport-ia-locale.log).`), { cause: type ?? `HTTP_${statut}` });
}

/**
 * Lit le flux SSE de llama-server (`stream: true`) : morceaux de texte (`delta.content`), progression de la
 * lecture du texte (`prompt_progress`), fin (`finish_reason`, `[DONE]`), mesures (`usage`, `timings`), erreur
 * en cours de route (`{"error": …}`), signes de vie (`:`). Lecture bornée ; `surVie` réarme le chien de garde.
 */
async function lireFluxLocal(corps, { surMorceau, surVie, erreur = j => erreurMoteurLocal(200, j) }) {
  const lecteur = corps.getReader();
  const decodeur = new TextDecoder('utf-8', { fatal: false });
  const etat = { texte: '', fin: null, termine: false, usage: null, timings: null, morceaux: 0 };
  let tampon = '';
  const ligne = l => {
    if (!l.startsWith('data:')) return;
    const donnee = l.slice(5).trim();
    if (!donnee) return;
    if (donnee === '[DONE]') {
      etat.termine = true;
      return;
    }
    let j;
    try {
      j = JSON.parse(donnee);
    } catch {
      return;
    }
    if (j?.error) throw erreur(j);
    const choix = Array.isArray(j?.choices) ? j.choices[0] : null;
    const bout = choix?.delta?.content;
    if (typeof bout === 'string' && bout) {
      etat.texte += bout;
      etat.morceaux += 1;
      if (etat.texte.length > TAILLE_MAX_REPONSE_IA) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
    }
    if (typeof choix?.finish_reason === 'string') etat.fin = choix.finish_reason;
    if (j?.usage && typeof j.usage === 'object') etat.usage = j.usage;
    if (j?.timings && typeof j.timings === 'object') etat.timings = j.timings;
    const p = j?.prompt_progress;
    surMorceau({ lecture: p && Number.isFinite(p.total) ? { total: p.total, cache: Number(p.cache) || 0, traites: Number(p.processed) || 0 } : null, ecrits: etat.morceaux });
  };
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    surVie();
    tampon += decodeur.decode(value, { stream: true });
    if (tampon.length > LIGNE_MAX_FLUX && !tampon.includes('\n')) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
    let i;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const l = tampon.slice(0, i).replace(/\r$/, '');
      tampon = tampon.slice(i + 1);
      ligne(l);
    }
  }
  if (tampon.trim()) ligne(tampon.trim());
  return etat;
}

/**
 * Un échange avec le MOTEUR LOCAL, en flux (SSE) : la connexion reste vivante pendant tout le calcul (lecture
 * du texte, puis écriture), la progression est visible, et un moteur qui meurt en route est repéré (flux
 * interrompu). Sortie JSON contrainte par schéma comme sans flux (la grammaire s'applique jeton par jeton) ;
 * `cache_prompt` : le début commun des requêtes successives d'un même travail n'est lu qu'une fois.
 * Un moteur qui répond sans flux (JSON) est lu comme avant.
 */
async function echangerLocal({ config, messages, options, fetchIa, delai, maintenant, silenceMaxMs, progression }) {
  const adaptateur = ADAPTATEURS['openai-chat'];
  const { url, init } = adaptateur.requete(config, messages, options);
  const corps = JSON.parse(init.body);
  Object.assign(corps, { stream: true, stream_options: { include_usage: true }, return_progress: true, cache_prompt: true, sse_ping_interval: PING_LOCAL_S });
  const debut = maintenant();
  const garde = new AbortController();
  let silence = false;
  let chien = null;
  const surVie = () => {
    clearTimeout(chien);
    chien = setTimeout(() => {
      silence = true;
      garde.abort(new DOMException('moteur muet', 'AbortError'));
    }, silenceMaxMs);
    chien.unref?.();
  };
  const bloquee = () => Object.assign(echec(504, 'ia-locale-bloquee', 'L’IA locale ne donne plus signe de vie : calcul abandonné (voir ~/logs/esport-ia-locale.log).'), { cause: 'SILENCE' });
  surVie();
  try {
    let r;
    try {
      r = await fetchIa(url, { ...init, headers: { ...init.headers, Accept: 'text/event-stream, application/json' }, body: JSON.stringify(corps), redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(delai), garde.signal]) });
    } catch (e) {
      throw silence ? bloquee() : erreurTransport(e, true);
    }
    surVie();
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok) {
      const texte = await lireBorne(r, 64 * 1024).catch(() => null);
      let json = null;
      try {
        json = texte ? JSON.parse(texte) : null;
      } catch {
        json = null;
      }
      throw erreurMoteurLocal(r.status, json);
    }
    if (!/event-stream/i.test(type)) {
      // Moteur sans flux : réponse JSON complète, lue comme avant.
      const texte = await lireBorne(r, TAILLE_MAX_REPONSE_IA).catch(() => null);
      let json = null;
      try {
        json = texte === null ? null : JSON.parse(texte);
      } catch {
        json = null;
      }
      const sortie = json ? adaptateur.reponse(json) : null;
      if (!sortie) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
      return { ...sortie, dureeMs: maintenant() - debut };
    }
    let flux;
    try {
      flux = await lireFluxLocal(r.body, {
        surVie,
        surMorceau: m => {
          try {
            progression?.(m);
          } catch {
            // Affichage de la progression : jamais bloquant.
          }
        },
      });
    } catch (e) {
      if (e instanceof ErreurEsport) throw e;
      throw silence ? bloquee() : erreurTransport(e, true);
    }
    if (!flux.termine && !flux.fin) {
      // Flux fermé sans fin ni [DONE] : le moteur a coupé en route.
      throw Object.assign(echec(502, 'ia-locale-coupee', 'Le moteur d’IA locale a coupé la connexion pendant le calcul (FLUX_INTERROMPU ; voir ~/logs/esport-ia-locale.log).'), { cause: 'FLUX_INTERROMPU' });
    }
    if (flux.fin === 'length') throw Object.assign(echec(502, 'ia-reponse-tronquee', 'Réponse de l’IA locale incomplète (limite de jetons atteinte) : relancez, ou augmentez IA_LOCALE_JETONS_MAX.'), { cause: 'LONGUEUR' });
    if (!flux.texte.trim()) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
    const u = flux.usage ?? {};
    const t = flux.timings ?? {};
    const v = Number(t.predicted_per_second);
    const l = Number(t.prompt_per_second);
    return {
      texte: flux.texte,
      jetons: { entree: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null, sortie: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null },
      ...(Number.isFinite(v) && v > 0 ? { vitesse: v } : {}),
      ...(Number.isFinite(l) && l > 0 ? { lecture: l } : {}),
      ...(Number.isFinite(Number(t.cache_n)) ? { cache: Number(t.cache_n) } : {}),
      dureeMs: maintenant() - debut,
    };
  } finally {
    clearTimeout(chien);
  }
}

const COUPURES_LOCALES = new Set(['ia-locale-coupee', 'ia-locale-arretee', 'ia-locale-bloquee']);

/**
 * Connecteur de l'IA locale : même contrat que `creerConnecteur`. `gestionnaire.executer(fn)` démarre le
 * serveur d'inférence au besoin et passe `{ port, cle, limite, pid }`. L'adresse est construite ICI, et
 * seulement ici : http://127.0.0.1:<port entier>/v1/chat/completions — c'est la seule exception à « https public
 * seulement », réservée au serveur local géré (jamais une adresse venue de la configuration, d'une page ou du
 * modèle).
 *
 * Requête EN FLUX (voir `echangerLocal`). `options.progression({ lecture, ecrits })` : progression du calcul.
 * Connexion coupée : on regarde si le moteur est MORT (et de quoi) pour un message précis — tué par le système
 * (SIGKILL reçu sans que nous l'ayons envoyé : un autre processus ou l'hébergeur) ou planté (autre signal, code d'erreur).
 */
export function creerConnecteurLocal(gestionnaire, { modele = 'local', jetonsMax = 4096, delai = 20 * 60_000, fetch: fetchIa = (...a) => globalThis.fetch(...a), maintenant = () => Date.now(), silenceMaxMs = SILENCE_MAX_LOCAL_MS, attenteSortieMs = 2000 } = {}) {
  const noter = (texte, code) => {
    try {
      gestionnaire?.noterIncident?.(texte, code);
    } catch {
      // Journal indisponible : l'erreur reste rendue.
    }
  };
  return {
    local: true,
    moteur: 'local',
    modele,
    images: false,
    // Moteur arrêté de force par l'hébergeur trop souvent : sauté dans l'ordre de repli (sans quitter la configuration).
    disponible: () => Boolean(gestionnaire) && !gestionnaire.indisponible?.(),
    indisponible: () => Boolean(gestionnaire?.indisponible?.()),
    async discuter(messages, options = {}) {
      if (!gestionnaire) throw echec(503, 'ia-locale-absente', 'IA locale non installée (lancer esport/serveur/installer-ia-locale.sh).');
      if (contientImages(messages)) throw imageNonGeree();
      const total = options.delaiLocal ?? delai;
      const { progression, ...reste } = options;
      const r = await gestionnaire.executer(
        async ({ port, cle, limite, pid }) => {
          if (!Number.isInteger(port) || port < 1024 || port > 65535) throw echec(502, 'ia-injoignable', 'Service d’IA injoignable.');
          const config = { fournisseur: 'local', modele, url: `http://127.0.0.1:${port}/v1/chat/completions`, lireCle: () => cle };
          const duree = Math.max(1000, limite - maintenant());
          const debut = maintenant();
          try {
            return await echangerLocal({ config, messages, options: { ...reste, json: reste.json ?? true, maxJetons: Math.min(reste.maxJetons ?? jetonsMax, jetonsMax) }, fetchIa, delai: duree, maintenant, silenceMaxMs, progression });
          } catch (e0) {
            let e = e0;
            // Connexion coupée : le moteur est-il mort, et de quoi ?
            // (Seulement un arrêt IMPRÉVU : nos propres arrêts — inactivité, sortie du processus — ne sont pas des plantages.)
            const sortie = COUPURES_LOCALES.has(e.code) ? await Promise.resolve(gestionnaire.attendreSortie?.(pid, attenteSortieMs)).then(s => (s?.imprevue ? s : null), () => null) : null;
            if (sortie?.signal === 'SIGKILL') {
              e = Object.assign(echec(502, 'ia-locale-tuee', 'Le moteur d’IA locale a été arrêté de force pendant le calcul (SIGKILL), par un autre processus ou par l’hébergeur (voir ~/logs/esport-ia-locale.log).'), { cause: 'SIGKILL' });
            } else if (sortie && (sortie.signal || sortie.code !== 0)) {
              const quoi = sortie.signal ?? `code ${sortie.code}`;
              e = Object.assign(echec(502, 'ia-locale-plantage', `Le moteur d’IA locale s’est arrêté brutalement pendant le calcul (${quoi} ; voir ~/logs/esport-ia-locale.log).`), { cause: String(quoi).replace(/\s+/g, '_').toUpperCase() });
            }
            noter(`requête échouée après ${Math.round((maintenant() - debut) / 1000)} s : ${e.code} (cause ${e.cause ?? causeEchec(e0)})`, e.code ?? 'erreur');
            throw e;
          }
        },
        { delai: total },
      );
      gestionnaire.noterMesure?.({ jetonsParSeconde: r.vitesse, dureeMs: r.dureeMs });
      try {
        gestionnaire.noter?.(`requête terminée en ${Math.round(r.dureeMs / 1000)} s (lu ${r.jetons?.entree ?? '?'} jetons${Number.isFinite(r.cache) ? ` dont ${r.cache} déjà en cache` : ''}${r.lecture ? ` à ${r.lecture.toFixed(1)}/s` : ''}, écrit ${r.jetons?.sortie ?? '?'} jetons${r.vitesse ? ` à ${r.vitesse.toFixed(1)}/s` : ''}).`);
      } catch {
        // Journal indisponible.
      }
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
