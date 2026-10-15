/**
 * Tâches (V3) : appels réseau de l'aide de l'IA et du lien GitHub, faits par
 * le processus principal d'Electron (la page ne joint ni l'API Claude ni
 * GitHub elle-même).
 *
 *  - `appelerClaude` : POST https://api.anthropic.com/v1/messages, avec la clé
 *    du Fondateur (passée à chaque appel, depuis la base chiffrée de son
 *    profil ; jamais écrite ici). Sortie structurée (JSON Schema) ; refus et
 *    réponse tronquée rendus comme des erreurs lisibles. Les modèles qui le
 *    permettent ont le repli serveur (`fallbacks: "default"`).
 *    Pas de SDK ici : l'application installée n'embarque aucun module de
 *    `node_modules` (voir « files » de package.json) ; seulement `fetch`.
 *  - `lireGithub` : GET https://api.github.com sur une LISTE FERMÉE de chemins
 *    (dépôt, PR, vérifications d'un commit), avec le jeton en lecture.
 *
 * Aucune dépendance : `fetch` et `AbortSignal` (Node 18+, Electron).
 */

export const URL_API_CLAUDE = 'https://api.anthropic.com/v1/messages';
const MOTIF_CLE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;
const MOTIF_MODELE = /^claude-[a-z0-9.-]{2,60}$/;
/** Modèles qui acceptent le repli serveur `fallbacks: "default"` (en-tête server-side-fallback-2026-07-01). */
const AVEC_REPLI = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5', 'claude-fable-5-1']);
const DELAI_MS = 120_000;

/**
 * @param {{ cle: string; modele: string; systeme: string; message: string; schema: object; maxTokens: number }} r
 * @param {typeof fetch} [f]
 * @returns {Promise<{ ok: true; json: unknown } | { ok: false; erreur: string }>}
 */
export async function appelerClaude(r, f = fetch) {
  if (!r || typeof r !== 'object') return { ok: false, erreur: 'Demande invalide.' };
  if (typeof r.cle !== 'string' || !MOTIF_CLE.test(r.cle)) return { ok: false, erreur: 'Clé de l’API Claude invalide (elle commence par « sk-ant- »).' };
  if (typeof r.modele !== 'string' || !MOTIF_MODELE.test(r.modele)) return { ok: false, erreur: 'Nom de modèle invalide.' };
  if (typeof r.systeme !== 'string' || typeof r.message !== 'string' || r.systeme.length > 4000 || r.message.length > 60_000) return { ok: false, erreur: 'Demande trop longue.' };
  if (!r.schema || typeof r.schema !== 'object' || JSON.stringify(r.schema).length > 8000) return { ok: false, erreur: 'Schéma de réponse invalide.' };
  const maxTokens = Math.min(16_000, Math.max(256, Math.round(Number(r.maxTokens) || 4000)));
  const repli = AVEC_REPLI.has(r.modele);
  const corps = {
    model: r.modele,
    max_tokens: maxTokens,
    system: r.systeme,
    messages: [{ role: 'user', content: r.message }],
    output_config: { format: { type: 'json_schema', schema: r.schema } },
    ...(repli ? { fallbacks: 'default' } : {}),
  };
  let reponse;
  try {
    reponse = await f(URL_API_CLAUDE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': r.cle,
        'anthropic-version': '2023-06-01',
        ...(repli ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (e) {
    return { ok: false, erreur: e && e.name === 'TimeoutError' ? 'L’IA met trop de temps à répondre : réessayez.' : 'API Claude injoignable (réseau).' };
  }
  let json;
  try {
    json = await reponse.json();
  } catch {
    return { ok: false, erreur: `Réponse illisible de l’API Claude (${reponse.status}).` };
  }
  if (!reponse.ok) {
    const type = json && json.error && json.error.type;
    if (reponse.status === 401) return { ok: false, erreur: 'Clé de l’API Claude refusée.' };
    if (reponse.status === 429) return { ok: false, erreur: 'Trop de demandes à l’API Claude : patientez un peu.' };
    if (reponse.status === 529 || reponse.status >= 500) return { ok: false, erreur: 'L’API Claude est surchargée : réessayez dans un moment.' };
    return { ok: false, erreur: `L’API Claude a refusé la demande (${reponse.status}${type ? ` : ${String(type).slice(0, 60)}` : ''}).` };
  }
  if (json.stop_reason === 'refusal') return { ok: false, erreur: 'Le modèle a refusé cette demande.' };
  if (json.stop_reason === 'max_tokens') return { ok: false, erreur: 'Réponse coupée (trop longue) : essayez avec moins de tâches.' };
  const texte = (Array.isArray(json.content) ? json.content : [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('');
  try {
    return { ok: true, json: JSON.parse(texte) };
  } catch {
    return { ok: false, erreur: 'Réponse de l’IA illisible.' };
  }
}

const MOTIF_JETON = /^(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;
/** Chemins permis : un dépôt, ses PR, les vérifications d'un commit (lecture seule). Même liste que src/taches/github.ts. */
export const CHEMIN_GITHUB = /^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/pulls(?:\/\d+)?|\/commits\/[0-9a-f]{7,40}\/check-runs)?(?:\?[A-Za-z0-9=&:%._/-]*)?$/;

/**
 * @param {{ chemin: string; jeton: string }} r
 * @param {typeof fetch} [f]
 * @returns {Promise<{ statut: number; json?: unknown; erreur?: string }>}
 */
export async function lireGithub(r, f = fetch) {
  if (!r || typeof r.chemin !== 'string' || !CHEMIN_GITHUB.test(r.chemin) || r.chemin.length > 400) return { statut: 0, erreur: 'Adresse GitHub refusée.' };
  if (typeof r.jeton !== 'string' || !MOTIF_JETON.test(r.jeton)) return { statut: 0, erreur: 'Jeton GitHub invalide.' };
  try {
    const reponse = await f(`https://api.github.com${r.chemin}`, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${r.jeton}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'AppDashboard-Taches' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    const texte = await reponse.text();
    if (texte.length > 2_000_000) return { statut: reponse.status, erreur: 'Réponse GitHub trop grande.' };
    let json;
    try {
      json = texte ? JSON.parse(texte) : undefined;
    } catch {
      json = undefined;
    }
    return { statut: reponse.status, json };
  } catch {
    return { statut: 0, erreur: 'GitHub injoignable (réseau).' };
  }
}
