/**
 * Transcription d'une réunion : segments horodatés (validation), pré-résumé automatique très simple
 * (phrases les plus représentatives, SANS IA externe) et point d'extension serveur FACULTATIF vers une
 * API de transcription externe (désactivé par défaut).
 *
 * Format stocké : `[[début, fin, texte], …]` (secondes, au dixième), triés par début.
 */

import { echec } from '../outils.mjs';
import { lireTaille } from './tailles.mjs';

export const SEGMENTS_MAX = 20000;
export const TEXTE_SEGMENT_MAX = 2000;
export const TEXTE_TOTAL_MAX = 1_500_000;
export const DUREE_MAX_S = 24 * 3600;
export const LANGUES_TRANSCRIPTION = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'auto'];

/** 83.4 → « 00:01:23 » (toujours avec les heures : une réunion dure souvent plus d'une heure). */
export function timecode(secondes) {
  const s = Math.max(0, Math.floor(Number(secondes) || 0));
  const deux = n => String(n).padStart(2, '0');
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

/** Durée lisible : 3725 → « 1 h 02 min », 95 → « 1 min 35 s ». */
export function dureeLisible(secondes, langue = 'fr') {
  const s = Math.max(0, Math.round(Number(secondes) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return langue === 'en' ? `${s} s` : `${s} s`;
}

const nettoyerTexte = t =>
  String(t ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXTE_SEGMENT_MAX);

const seconde = v => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > DUREE_MAX_S) return null;
  return Math.round(n * 10) / 10;
};

/**
 * Valide les segments envoyés par l'app (`[{ debut, fin, texte }]` ou `[[d, f, t]]`) ; rend la forme
 * stockée. Segments vides retirés ; 400 si la liste est invalide ou trop longue.
 */
export function validerSegments(brut) {
  if (!Array.isArray(brut)) throw echec(400, 'segments', 'Transcription illisible (liste de segments attendue).');
  if (brut.length > SEGMENTS_MAX) throw echec(413, 'transcription-trop-longue', 'Transcription trop longue.');
  const sortie = [];
  let total = 0;
  for (const s of brut) {
    const [d, f, t] = Array.isArray(s) ? s : [s?.debut, s?.fin, s?.texte];
    const debut = seconde(d);
    let fin = seconde(f);
    if (debut === null) throw echec(400, 'segments', 'Segment invalide : début en secondes attendu.');
    if (fin === null || fin < debut) fin = debut;
    const texte = nettoyerTexte(t);
    if (!texte) continue;
    total += texte.length;
    if (total > TEXTE_TOTAL_MAX) throw echec(413, 'transcription-trop-longue', 'Transcription trop longue.');
    sortie.push([debut, fin, texte]);
  }
  sortie.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return sortie;
}

// ------------------------------------------------------------------ Pré-résumé

const MOTS_VIDES = new Set(
  (
    'a ai aie ainsi alors après au aucun aussi autre aux avait avec avoir bah bon bien c ca ça car ce cela celle celui ces cet cette ceux chaque ci comme comment d dans de des deux dire dit do donc du elle elles en encore est et étaient était été être eu euh fait faire faut hein ici il ils j je juste l la le les leur lui m ma mais me même mes moi mon n ne ni non nos notre nous o oh on ou où ouais oui par parce pas peu peut plus pour pourquoi qu quand que quel quelle qui quoi s sa sans se ses si sinon son sont sur t ta te tes toi ton tous tout toute très tu un une va vais voilà vos votre vous vu y ' +
    'about after all also am an and any are as at be because been but by can could did do does for from get got had has have he her here him his how i if in into is it its just know like me my no not now of on one or our out really right she so some than that the their them then there these they this to too um uh up us very was we well were what when where which who will with would yeah yes you your'
  ).split(/\s+/),
);

const mots = phrase =>
  phrase
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(m => m.length > 2 && !MOTS_VIDES.has(m));

/**
 * Pré-résumé automatique très simple (extractif) : les `n` phrases les plus représentatives (mots
 * fréquents de la réunion), dans l'ordre de la réunion, avec leur instant. Aucune IA, aucun appel
 * externe. Rend `[{ debut, texte }]`.
 */
export function preResume(segments, { n = 5 } = {}) {
  const phrases = [];
  for (const [debut, , texte] of segments) {
    for (const p of texte.split(/(?<=[.!?…])\s+/)) {
      const propre = p.trim();
      if (propre.length >= 25 && propre.length <= 400) phrases.push({ debut, texte: propre, mots: mots(propre) });
    }
  }
  if (phrases.length === 0) return [];
  const frequences = new Map();
  for (const p of phrases) for (const m of new Set(p.mots)) frequences.set(m, (frequences.get(m) ?? 0) + 1);
  const score = p => (p.mots.length ? p.mots.reduce((s, m) => s + (frequences.get(m) ?? 0), 0) / Math.sqrt(p.mots.length) : 0);
  const choisies = phrases
    .map((p, i) => ({ ...p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i);
  return choisies.map(p => ({ debut: p.debut, texte: p.texte }));
}

// ------------------------------------------------------------------ API externe (facultative)

/**
 * Point d'extension serveur : transcription par une API externe (OpenAI Whisper API ou compatible),
 * DÉSACTIVÉ par défaut. Variables de ~/.appdashboard/esport.env :
 *
 *   TRANSCRIPTION_API=openai            active le point d'extension
 *   TRANSCRIPTION_API_CLE=sk-…          clé secrète (jamais dans le dépôt)
 *   TRANSCRIPTION_API_URL=https://api.openai.com/v1/audio/transcriptions   (défaut)
 *   TRANSCRIPTION_API_MODELE=whisper-1  (défaut)
 *   TRANSCRIPTION_API_MAX=25M           taille d'envoi acceptée par l'API (25 Mo chez OpenAI)
 *
 * Le fichier de l'enregistrement est envoyé tel quel (pas de conversion sur le serveur) : au-delà de
 * la taille acceptée par l'API, la transcription se fait dans le navigateur.
 */
export function configTranscriptionExterne(env = {}) {
  const actif = String(env.TRANSCRIPTION_API ?? '').trim().toLowerCase() === 'openai' && Boolean(env.TRANSCRIPTION_API_CLE);
  const max = lireTaille(env.TRANSCRIPTION_API_MAX, 25 * 1024 * 1024);
  return {
    actif,
    url: env.TRANSCRIPTION_API_URL || 'https://api.openai.com/v1/audio/transcriptions',
    cle: env.TRANSCRIPTION_API_CLE || '',
    modele: env.TRANSCRIPTION_API_MODELE || 'whisper-1',
    tailleMax: max,
  };
}

/**
 * Envoie un enregistrement à l'API externe ; rend les segments (`[[début, fin, texte]]`). `fetch`
 * injectable (tests). Lève une erreur au message simple en cas d'échec (jamais la clé).
 */
export async function transcrireParApi({ octets, nom, type, langue, config, fetch: envoyer = globalThis.fetch }) {
  if (!config?.actif) throw new Error('Transcription externe désactivée.');
  if (octets.length > config.tailleMax) throw new Error('Enregistrement trop gros pour l’API de transcription.');
  const formulaire = new FormData();
  formulaire.append('file', new Blob([octets], { type: type || 'application/octet-stream' }), nom || 'enregistrement');
  formulaire.append('model', config.modele);
  formulaire.append('response_format', 'verbose_json');
  formulaire.append('timestamp_granularities[]', 'segment');
  if (langue && langue !== 'auto') formulaire.append('language', langue);
  let r;
  try {
    r = await envoyer(config.url, { method: 'POST', headers: { Authorization: `Bearer ${config.cle}` }, body: formulaire });
  } catch {
    throw new Error('API de transcription injoignable.');
  }
  if (!r.ok) throw new Error(`API de transcription : refus (HTTP ${r.status}).`);
  const json = await r.json().catch(() => null);
  const segments = Array.isArray(json?.segments) ? json.segments.map(s => [s.start, s.end, s.text]) : json?.text ? [[0, Number(json.duration) || 0, json.text]] : [];
  return { segments: validerSegments(segments), duree: Number(json?.duration) || null };
}
