/**
 * Export des notes d'une review en Markdown (lisible tel quel, et converti en
 * PDF par l'impression côté app). Fonction PURE : reçoit des données déjà
 * lues et autorisées ; chaque texte libre repasse par `ligneSure` /
 * `nettoyerNote` (aucune balise HTML ne sort d'ici).
 */

import { resumeDessin } from './dessin.mjs';
import { ligneSure, nettoyerNote } from './markdown.mjs';
import { lienYoutubeA } from './youtube.mjs';

export const CATEGORIES = ['erreur', 'bonne_action', 'utilitaires', 'placement', 'comms'];
export const LIBELLES_CATEGORIES = { erreur: 'Erreur', bonne_action: 'Bonne action', utilitaires: 'Utilitaires', placement: 'Placement', comms: 'Comms' };

/** 83.4 → « 01:23 » ; 3725 → « 1:02:05 ». */
export function formatTemps(secondes) {
  const s = Math.max(0, Math.floor(Number(secondes) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const deux = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${deux(m)}:${deux(s % 60)}` : `${deux(m)}:${deux(s % 60)}`;
}

const jour = iso => String(iso ?? '').slice(0, 10);

/**
 * `reperes` : `[{ debut, fin, categorie, titre, note, cible, auteur, creeLe, reactions?: { like, dislike },
 * dessin?: { v, objets } | null, commentaires: [{ auteur, texte, creeLe }] }]` (`cible` et `auteur` :
 * pseudos ou null), déjà triés par instant. Le dessin est mentionné (il se voit sur le site ou l'app PC).
 */
export function exporterMarkdown({ review, reperes, equipe, exporteLe }) {
  const l = [];
  l.push(`# ${ligneSure(review.titre, 120)}`, '');
  l.push(`- Équipe : ${ligneSure(equipe ?? '', 80) || '—'}`);
  const fichier = review.source === 'fichier';
  l.push(fichier ? `- Vidéo : fichier déposé sur le site${review.nomFichier ? ` (${ligneSure(review.nomFichier, 120)})` : ''}` : `- Vidéo : ${review.url}`);
  if (review.reference) l.push(`- Référence : ${ligneSure(review.reference, 120)}`);
  l.push(`- Repères : ${reperes.length}`, `- Exporté le ${jour(exporteLe)}`, '');
  if (reperes.length === 0) l.push('_Aucun repère pour l’instant._', '');
  for (const r of reperes) {
    const intervalle = r.fin != null ? `${formatTemps(r.debut)} → ${formatTemps(r.fin)}` : formatTemps(r.debut);
    l.push(`### [${intervalle}] ${ligneSure(r.titre, 120)}`, '');
    const meta = [LIBELLES_CATEGORIES[r.categorie] ?? r.categorie];
    if (r.cible) meta.push(`Joueur : ${ligneSure(r.cible, 60)}`);
    if (r.auteur) meta.push(`Auteur : ${ligneSure(r.auteur, 60)}`);
    l.push(`**${meta.join('** · **')}**`, '');
    if (!fichier) l.push(`[Ouvrir à ${formatTemps(r.debut)}](${lienYoutubeA(review.videoId, r.debut)})`, '');
    const like = Number(r.reactions?.like) || 0;
    const dislike = Number(r.reactions?.dislike) || 0;
    if (like || dislike) l.push(`Réactions : 👍 ${like} · 👎 ${dislike}`, '');
    if (r.dessin?.objets?.length) l.push(`✏️ Dessin sur la vidéo : ${resumeDessin(r.dessin)}, visible sur le site ou l’app PC.`, '');
    if (r.note) l.push(nettoyerNote(r.note), '');
    if (r.commentaires?.length) {
      l.push('Commentaires :', '');
      for (const c of r.commentaires) l.push(`- ${ligneSure(c.auteur ?? 'Un compte supprimé', 60)} (${jour(c.creeLe)}) : ${ligneSure(c.texte, 1000)}`);
      l.push('');
    }
  }
  return `${l.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Nom de fichier sûr : « Review - Faucons vs Nova.md ». */
export function nomFichierExport(titre) {
  const base = String(titre ?? 'review')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `Review - ${base || 'sans titre'}.md`;
}
