/**
 * Contenu d'un « post » (carte de contenu) : lecture et validation des saisies, empreinte du contenu
 * validé. PUR (aucune base).
 *
 * Circuit de validation : brouillon → (soumettre) à valider → (cm.valider) validé ou refusé (motif) →
 * (cm.editer, une fois validé seulement) publié, avec l'adresse du post par réseau. Toute modification du
 * CONTENU après la validation (titre, réseaux, textes, médias, date prévue, liens) repasse le post « à
 * valider » : le serveur compare l'empreinte du contenu à celle enregistrée au moment de la validation.
 */

import { echec, sha256Hex, texteLong, texteNettoye } from '../outils.mjs';
import { CLES_RESEAUX, LANGUES_POST, TEXTE_POST_MAX, analyserTexte, urlPostValide } from './reseaux.mjs';
import { MOTIF_COMPTE, MOTIF_UUID } from './commun.mjs';

export const STATUTS_POST = Object.freeze(['brouillon', 'a_valider', 'valide', 'refuse', 'publie']);
/** Liste du tableau par défaut où le circuit range un post selon son statut. */
export const LISTE_DU_STATUT = Object.freeze({ a_valider: 'a_valider', valide: 'valide', publie: 'publie', refuse: 'preparation' });

/** Réseaux ciblés saisis : sous-ensemble de CLES_RESEAUX, dans l'ordre de la liste. */
export function lireReseaux(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > CLES_RESEAUX.length * 2) throw echec(400, 'reseaux', 'Réseaux illisibles.');
  for (const r of v) if (!CLES_RESEAUX.includes(r)) throw echec(400, 'reseaux', 'Réseau inconnu.');
  return CLES_RESEAUX.filter(r => v.includes(r));
}

/** Textes saisis `{ x: { fr, en } }` : réseaux connus, deux langues, textes multilignes bornés. */
export function lireTextes(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'textes', 'Textes illisibles.');
  const sortie = {};
  for (const [reseau, parLangue] of Object.entries(v)) {
    if (!CLES_RESEAUX.includes(reseau)) throw echec(400, 'reseaux', 'Réseau inconnu.');
    if (!parLangue || typeof parLangue !== 'object' || Array.isArray(parLangue)) throw echec(400, 'textes', 'Textes illisibles.');
    const t = {};
    for (const langue of LANGUES_POST) {
      const brut = parLangue[langue];
      if (brut !== undefined && brut !== null && typeof brut !== 'string') throw echec(400, 'textes', 'Textes illisibles.');
      const propre = texteLong(brut ?? '', TEXTE_POST_MAX + 1);
      if (propre.length > TEXTE_POST_MAX) throw echec(400, 'texte-trop-long', `Texte trop long (${TEXTE_POST_MAX} caractères au plus).`);
      t[langue] = propre;
    }
    sortie[reseau] = t;
  }
  return sortie;
}

/**
 * Liens d'une carte : `{ resultatId, tournoiId, matchId, teamId, clips: [id], membres: [compte], sponsors: [id] }`
 * (identifiants seulement ; l'existence est vérifiée par l'appelant quand il le faut). `sponsors` : partenaires
 * mentionnés par le post (« mention sponsor », migration 0024) ; un post publié compte pour leurs contreparties.
 */
export function lireLiens(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'liens', 'Liens illisibles.');
  const sortie = {};
  for (const cle of ['resultatId', 'tournoiId', 'matchId', 'teamId']) {
    if (v[cle] === undefined || v[cle] === null || v[cle] === '') continue;
    if (typeof v[cle] !== 'string' || !MOTIF_UUID.test(v[cle])) throw echec(400, 'liens', 'Lien illisible.');
    sortie[cle] = v[cle];
  }
  if (v.clips !== undefined && v.clips !== null) {
    if (!Array.isArray(v.clips) || v.clips.length > 20 || v.clips.some(c => typeof c !== 'string' || !MOTIF_UUID.test(c))) throw echec(400, 'liens', 'Clips illisibles.');
    if (v.clips.length) sortie.clips = [...new Set(v.clips)];
  }
  if (v.membres !== undefined && v.membres !== null) {
    if (!Array.isArray(v.membres) || v.membres.length > 30 || v.membres.some(c => typeof c !== 'string' || !MOTIF_COMPTE.test(c))) throw echec(400, 'liens', 'Membres illisibles.');
    if (v.membres.length) sortie.membres = [...new Set(v.membres)];
  }
  if (v.sponsors !== undefined && v.sponsors !== null) {
    if (!Array.isArray(v.sponsors) || v.sponsors.length > 10 || v.sponsors.some(c => typeof c !== 'string' || !MOTIF_UUID.test(c))) throw echec(400, 'liens', 'Sponsors illisibles.');
    if (v.sponsors.length) sortie.sponsors = [...new Set(v.sponsors)];
  }
  return sortie;
}

/** Adresses des posts publiés `{ x: "https://x.com/…" }` (réseaux ciblés seulement). */
export function lirePublications(v, reseaux) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'publications', 'Adresses illisibles.');
  const sortie = {};
  for (const [reseau, brut] of Object.entries(v)) {
    if (brut === null || brut === '') continue;
    if (!reseaux.includes(reseau)) throw echec(400, 'publications', 'Ce réseau n’est pas ciblé par le post.');
    const url = String(brut).trim();
    if (!urlPostValide(url, reseau)) throw echec(400, 'url-post', 'Adresse du post invalide : https:// sur le domaine du réseau.');
    sortie[reseau] = url;
  }
  return sortie;
}

/** Titre de carte (1 à 200 caractères). */
export function lireTitre(v) {
  const titre = texteNettoye(v, 200);
  if (titre.length < 1) throw echec(400, 'titre', 'Titre obligatoire.');
  return titre;
}

/**
 * Problèmes qui empêchent de SOUMETTRE un post : aucun réseau, texte manquant (au moins une langue par
 * réseau), texte trop long pour le réseau, trop de hashtags. Rend `[{ reseau, langue, code }]`.
 */
export function problemesPost({ reseaux, textes }) {
  const problemes = [];
  if (!reseaux.length) problemes.push({ reseau: null, langue: null, code: 'aucun-reseau' });
  for (const r of reseaux) {
    const t = textes[r] ?? {};
    if (!LANGUES_POST.some(l => (t[l] ?? '').trim())) problemes.push({ reseau: r, langue: null, code: 'texte-manquant' });
    for (const l of LANGUES_POST) {
      if (!(t[l] ?? '').trim()) continue;
      for (const code of analyserTexte(t[l], r).problemes) problemes.push({ reseau: r, langue: l, code });
    }
  }
  return problemes;
}

/** Empreinte stable (SHA-256) du contenu d'un post, comparée à celle enregistrée à la validation. */
export async function empreinteContenu({ titre, reseaux, textes, datePublication, liens, pieces }) {
  const ordonne = o =>
    Array.isArray(o) ? o.map(ordonne) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map(k => [k, ordonne(o[k])])) : o;
  return sha256Hex(JSON.stringify(ordonne({ titre, reseaux, textes, datePublication: datePublication ?? null, liens, pieces: [...(pieces ?? [])].sort() })));
}
