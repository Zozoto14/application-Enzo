/**
 * Connecteur IA générique (assistant des profils de jeu). Le Fondateur choisit son fournisseur : la clé
 * d'API et le modèle se règlent dans ~/.appdashboard/esport.env (jamais dans le dépôt) :
 *
 *   IA_API_URL      adresse de l'API « chat completions » compatible OpenAI (https seulement) ; l'adresse
 *                   de base suffit (…/v1), « /chat/completions » est ajouté s'il manque
 *   IA_API_CLE      clé d'API (secret : jamais renvoyée par le serveur, jamais journalisée)
 *   IA_MODELE       modèle (ex. gpt-4o-mini, mistral-small-latest, gemini-2.0-flash…)
 *   IA_FOURNISSEUR  facultatif : openai, mistral, gemini, deepseek, groq, autre (déduit de l'adresse sinon) ;
 *                   règle les petites différences (sortie JSON forcée ou non)
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
    requete(config, messages, { json = true, maxJetons = 4000, temperature = 0.2 } = {}) {
      const corps = { model: config.modele, messages, temperature, max_tokens: maxJetons };
      // Sortie JSON forcée chez les fournisseurs qui la gèrent (le prompt la demande de toute façon).
      if (json && (FOURNISSEURS[config.fournisseur]?.jsonForce ?? false)) corps.response_format = { type: 'json_object' };
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
      return { texte, jetons: { entree: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null, sortie: Number.isFinite(u.completion_tokens) ? u.completion_tokens : null } };
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
 * Connecteur prêt à l'emploi. `fetch` est injectable (tests : faux serveur, jamais de réseau réel).
 * `discuter(messages, options)` → { texte, jetons, dureeMs } ; erreurs : ErreurEsport au code stable
 * (ia-non-configuree, ia-cle-refusee, ia-limite-fournisseur, ia-delai, ia-injoignable, ia-reponse),
 * dont le message ne contient JAMAIS la clé.
 */
export function creerConnecteur(config, { fetch: fetchIa = (...a) => globalThis.fetch(...a), delai = DELAI_IA_MS, maintenant = () => Date.now() } = {}) {
  const adaptateur = ADAPTATEURS[config?.format ?? 'openai-chat'];
  return {
    config,
    disponible: () => Boolean(config?.actif && adaptateur),
    async discuter(messages, options = {}) {
      if (!config?.actif || !adaptateur) throw echec(503, 'ia-non-configuree', 'Assistant IA non configuré (clé d’API absente).');
      const { url, init } = adaptateur.requete(config, messages, options);
      const debut = maintenant();
      let r;
      try {
        r = await fetchIa(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(options.delai ?? delai) });
      } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw echec(504, 'ia-delai', 'Le service d’IA met trop de temps à répondre.');
        throw echec(502, 'ia-injoignable', 'Service d’IA injoignable.');
      }
      const texte = await lireBorne(r, TAILLE_MAX_REPONSE_IA).catch(() => null);
      if (r.status === 401 || r.status === 403) throw echec(502, 'ia-cle-refusee', 'Le service d’IA refuse la clé d’API (vérifiez IA_API_CLE).');
      if (r.status === 429) throw echec(502, 'ia-limite-fournisseur', 'Le service d’IA limite les appels (quota du fournisseur atteint) : réessayez plus tard.');
      if (r.status === 404) throw echec(502, 'ia-modele', 'Modèle ou adresse inconnus du service d’IA (vérifiez IA_MODELE et IA_API_URL).');
      if (!r.ok) throw echec(502, 'ia-injoignable', 'Service d’IA injoignable.');
      let json;
      try {
        json = texte === null ? null : JSON.parse(texte);
      } catch {
        json = null;
      }
      const sortie = json ? adaptateur.reponse(json) : null;
      if (!sortie) throw echec(502, 'ia-reponse', 'Réponse du service d’IA illisible.');
      return { ...sortie, dureeMs: maintenant() - debut };
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
