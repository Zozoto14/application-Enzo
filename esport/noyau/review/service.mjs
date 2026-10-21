/**
 * Review vidéo (phase 5) : reviews à partir d'une adresse YouTube, repères
 * horodatés (catégorie, note en Markdown limité, joueur concerné, durée),
 * fil de commentaires par repère, export Markdown.
 *
 * Contrôles de chaque route, dans l'ordre : session (api.mjs) → appartenance
 * à la team (`contexteTeam`, 404 sinon) → module `video_review` activé (404)
 * → permission (403). Toute requête SQL filtre sur `team_id` : une review, un
 * repère ou un commentaire d'une autre team est introuvable (404).
 *
 * Droits (plan, section 4) :
 *   video_review.view      voir les reviews, repères et commentaires, exporter
 *   video_review.create    créer / renommer une review ; modifier n'importe quel repère
 *   video_review.annotate  ajouter des repères et des commentaires ; modifier et
 *                          supprimer SES repères et SES commentaires
 *   video_review.delete    supprimer une review, n'importe quel repère ou commentaire
 *   video_review.react     réagir (👍 / 👎) à un repère ou à un commentaire
 * Le Joueur (view + annotate + react) commente, dessine et réagit, mais ne
 * supprime ni une review ni le travail d'un autre.
 *
 * Réactions (v2) : une par membre et par cible (repère ou commentaire), qu'il
 * change ou retire ; compteurs et noms visibles par tous les lecteurs. Un
 * changement publie `review.reaction_changed` (journal seulement : ni
 * notification, ni Discord).
 *
 * Dessin (v2) : `dessin` d'un repère, JSON validé par review/dessin.mjs
 * (coordonnées relatives, taille bornée), écrit avec la permission annotate.
 *
 * Chaque écriture ajoute son événement de domaine à l'outbox dans le même lot
 * atomique ; `review.created` est celui auquel Discord s'abonnera (phase 4).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { fichierPublic } from '../medias/service.mjs';
import { CATEGORIES, exporterMarkdown, nomFichierExport } from './export.mjs';
import { lireDessin, validerDessin } from './dessin.mjs';
import { nettoyerNote } from './markdown.mjs';
import { adresseYoutube, extraireYoutube } from './youtube.mjs';

export const MODULE_REVIEW = 'video_review';
export { CATEGORIES };
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const DUREE_VIDEO_MAX_S = 12 * 3600;
const DUREE_REPERE_MAX_S = 3600;
const REPERES_MAX = 500;
const COMMENTAIRES_MAX = 200;
const REVIEWS_MAX = 500;

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Secondes saisies : nombre fini, arrondi au dixième. */
function lireSecondes(valeur, quoi) {
  const n = typeof valeur === 'string' && valeur.trim() !== '' ? Number(valeur) : valeur;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > DUREE_VIDEO_MAX_S) throw echec(400, quoi, 'Instant invalide (en secondes, 12 heures au plus).');
  return Math.round(n * 10) / 10;
}

export function servicesReview({ base, maintenant = () => Date.now(), socle, medias }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_REVIEW)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  const pseudos = ids => pseudosDe(base, ids);
  const personne = (id, noms) => (id ? { compte: id, pseudo: noms[id] ?? null } : null);

  async function membreActif(teamId, compte) {
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) return false;
    return Boolean(await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [teamId, compte]));
  }

  async function reviewDeTeam(teamId, id) {
    exigerUuid(id, 'review');
    const r = await base.premier('SELECT * FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!r) throw echec(404, 'review-introuvable', 'Review introuvable.');
    return r;
  }

  async function repereDeReview(teamId, reviewId, id) {
    exigerUuid(id, 'repere');
    const r = await base.premier('SELECT * FROM review_reperes WHERE id = ? AND review_id = ? AND team_id = ? AND supprime_le IS NULL', [id, reviewId, teamId]);
    if (!r) throw echec(404, 'repere-introuvable', 'Repère introuvable.');
    return r;
  }

  const reviewPublique = (r, noms, nbReperes, videos = new Map()) => ({
    id: r.id,
    titre: r.titre,
    // Source : YouTube (url, videoId) OU fichier déposé (video : nom, taille, format, avertissement iPhone).
    source: r.source === 'fichier' ? 'fichier' : 'youtube',
    url: r.url,
    videoId: r.video_id,
    ...(r.source === 'fichier' ? { video: fichierPublic(videos.get(r.fichier_id)) } : {}),
    reference: r.reference,
    creePar: personne(r.cree_par, noms),
    creeLe: r.cree_le,
    majLe: r.maj_le,
    ...(nbReperes === undefined ? {} : { reperes: nbReperes }),
  });

  /** Repères d'une review, avec leurs commentaires et réactions, triés par instant. */
  async function reperesDe(ctx, review) {
    const teamId = ctx.team.id;
    const lignes = await base.tous('SELECT * FROM review_reperes WHERE review_id = ? AND team_id = ? AND supprime_le IS NULL ORDER BY debut_s, cree_le LIMIT ?', [review.id, teamId, REPERES_MAX]);
    const coms = await base.tous('SELECT * FROM review_commentaires WHERE review_id = ? AND team_id = ? AND supprime_le IS NULL ORDER BY cree_le LIMIT 5000', [review.id, teamId]);
    const reacts = await base.tous('SELECT cible_type, cible_id, compte_id, valeur FROM review_reactions WHERE review_id = ? AND team_id = ? ORDER BY cree_le LIMIT 50000', [review.id, teamId]);
    const noms = await pseudos([...lignes.flatMap(r => [r.auteur_id, r.cible_id]), ...coms.map(c => c.auteur_id), ...reacts.map(x => x.compte_id)]);
    const moi = ctx.acteur.compte;
    const parCible = new Map();
    for (const x of reacts) {
      const cle = `${x.cible_type}:${x.cible_id}`;
      if (!parCible.has(cle)) parCible.set(cle, []);
      parCible.get(cle).push(x);
    }
    const reactions = (type, id) => {
      const liste = parCible.get(`${type}:${id}`) ?? [];
      const de = v => liste.filter(x => Number(x.valeur) === v).map(x => personne(x.compte_id, noms));
      const mienne = liste.find(x => x.compte_id === moi);
      const like = de(1);
      const dislike = de(-1);
      return { like: like.length, dislike: dislike.length, moi: mienne ? (Number(mienne.valeur) === 1 ? 'like' : 'dislike') : null, qui: { like, dislike } };
    };
    const annote = peut(ctx, 'video_review.annotate');
    const supprime = peut(ctx, 'video_review.delete');
    const modifieTout = peut(ctx, 'video_review.create');
    return lignes.map(r => ({
      id: r.id,
      debut: r.debut_s,
      fin: r.fin_s ?? null,
      categorie: r.categorie,
      titre: r.titre,
      note: r.note,
      dessin: lireDessin(r.dessin),
      cible: personne(r.cible_id, noms),
      auteur: personne(r.auteur_id, noms),
      creeLe: r.cree_le,
      majLe: r.maj_le,
      peutModifier: modifieTout || (annote && r.auteur_id === moi),
      peutSupprimer: supprime || (annote && r.auteur_id === moi),
      reactions: reactions('repere', r.id),
      commentaires: coms
        .filter(c => c.repere_id === r.id)
        .map(c => ({ id: c.id, texte: c.texte, auteur: personne(c.auteur_id, noms), creeLe: c.cree_le, peutSupprimer: supprime || (annote && c.auteur_id === moi), reactions: reactions('commentaire', c.id) })),
    }));
  }

  const droitsDe = ctx => ({
    creer: peut(ctx, 'video_review.create'),
    annoter: peut(ctx, 'video_review.annotate'),
    supprimer: peut(ctx, 'video_review.delete'),
    reagir: peut(ctx, 'video_review.react'),
  });

  // -------------------------------------------------------------- Lectures

  async function videosDe(lignes) {
    return new Map((await lignesParIds(base, 'SELECT * FROM fichiers WHERE id', lignes.filter(r => r.source === 'fichier').map(r => r.fichier_id))).map(f => [f.id, f]));
  }

  async function liste(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const lignes = await base.tous('SELECT * FROM reviews WHERE team_id = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT ?', [teamId, REVIEWS_MAX]);
    const compteurs = await base.tous('SELECT review_id, COUNT(*) AS n FROM review_reperes WHERE team_id = ? AND supprime_le IS NULL GROUP BY review_id', [teamId]);
    const parReview = new Map(compteurs.map(c => [c.review_id, Number(c.n)]));
    const noms = await pseudos(lignes.map(r => r.cree_par));
    const videos = await videosDe(lignes);
    return { reviews: lignes.map(r => reviewPublique(r, noms, parReview.get(r.id) ?? 0, videos)), droits: droitsDe(ctx) };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const review = await reviewDeTeam(teamId, id);
    const membres = await base.tous(
      "SELECT m.compte_id AS compte, c.pseudo FROM membres m JOIN comptes c ON c.id = m.compte_id WHERE m.team_id = ? AND m.statut = 'actif' ORDER BY c.pseudo",
      [teamId],
    );
    return {
      review: reviewPublique(review, await pseudos([review.cree_par]), undefined, await videosDe([review])),
      reperes: await reperesDe(ctx, review),
      membres,
      droits: droitsDe(ctx),
      moi: acteur.compte,
      equipe: ctx.team.nom,
    };
  }

  // -------------------------------------------------------------- Reviews

  /** Titre et adresse validés d'une nouvelle review. */
  function lireNouvelle(corps) {
    if (corps?.envoi) {
      // Vidéo déposée sur le site : l'envoi (déjà terminé) est rattaché dans le même lot.
      const titre = texteNettoye(corps?.titre, 120);
      if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
      return { titre, videoId: '', url: '', reference: texteNettoye(corps?.reference, 120), envoi: corps.envoi };
    }
    const youtube = extraireYoutube(corps?.url);
    if (!youtube) throw echec(400, 'url-youtube', 'Adresse YouTube invalide (watch, youtu.be, shorts, embed ou live).');
    const titre = texteNettoye(corps?.titre, 120);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    return { titre, videoId: youtube.id, url: adresseYoutube(youtube.id), reference: texteNettoye(corps?.reference, 120) };
  }

  /**
   * Instructions SQL (à mettre dans un lot) qui créent une review, et la review
   * elle-même. Sert à `creer` et au scouting (« Ouvrir en review vidéo »), qui
   * y ajoute la liaison de la VOD dans le même lot atomique.
   * Le contexte doit déjà avoir passé `exiger(ctx, 'video_review.create')`.
   */
  async function preparerCreation(ctx, acteur, corps, supplementCharge = {}) {
    const teamId = ctx.team.id;
    const n = await base.premier('SELECT COUNT(*) AS n FROM reviews WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
    if (Number(n?.n ?? 0) >= REVIEWS_MAX) throw echec(409, 'trop-de-reviews', `Une team garde ${REVIEWS_MAX} reviews au plus.`);
    const s = lireNouvelle(corps);
    const t = maintenant();
    const id = nouvelId();
    let rattachement = null;
    if (s.envoi) {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      rattachement = await medias.preparerRattachement(ctx, s.envoi, 'review', { entiteType: 'review_video', entiteId: id });
    }
    const instructions = [
      ...(rattachement?.instructions ?? []),
      {
        sql: 'INSERT INTO reviews (id, team_id, titre, url, video_id, reference, source, fichier_id, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, teamId, s.titre, s.url, s.videoId, s.reference, rattachement ? 'fichier' : 'youtube', rattachement?.fichierId ?? null, acteur.compte, iso(t), iso(t)],
      },
      evenement('review.created', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'review',
        entiteId: id,
        charge: rattachement
          ? { titre: s.titre, source: 'fichier', reference: s.reference, ...supplementCharge }
          : { titre: s.titre, videoId: s.videoId, url: s.url, reference: s.reference, ...supplementCharge },
        maintenant: t,
      }),
    ];
    return { id, instructions, depart: rattachement ? null : (extraireYoutube(corps?.url)?.debut ?? null) };
  }

  async function creer(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.create');
    const { id, instructions, depart } = await preparerCreation(ctx, acteur, corps);
    await base.lot(instructions);
    const r = await reviewDeTeam(teamId, id);
    return { ...reviewPublique(r, await pseudos([r.cree_par]), 0, await videosDe([r])), depart };
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.create');
    const r = await reviewDeTeam(teamId, id);
    const s = {};
    if (corps?.titre !== undefined) {
      s.titre = texteNettoye(corps.titre, 120);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (corps?.reference !== undefined) s.reference = texteNettoye(corps.reference, 120);
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE reviews SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), id, teamId] },
        evenement('review.updated', { teamId, acteur: acteur.compte, entiteType: 'review', entiteId: id, charge: { titre: s.titre ?? r.titre, champs }, maintenant: t }),
      ]);
    }
    const apres = await reviewDeTeam(teamId, id);
    return reviewPublique(apres, await pseudos([apres.cree_par]), undefined, await videosDe([apres]));
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.delete');
    const r = await reviewDeTeam(teamId, id);
    const t = maintenant();
    // Suppression logique : repères et commentaires restent en base (journal cohérent), mais plus lisibles.
    await base.lot([
      { sql: 'UPDATE reviews SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'UPDATE planning_evenements SET review_id = NULL WHERE review_id = ? AND team_id = ?', params: [id, teamId] },
      evenement('review.deleted', { teamId, acteur: acteur.compte, entiteType: 'review', entiteId: id, charge: { titre: r.titre }, maintenant: t }),
    ]);
    // Vidéo déposée : plus lisible avec la review, ses octets sont effacés (espace libéré).
    if (r.source === 'fichier' && r.fichier_id) await medias?.effacerOctets(r.fichier_id);
    return { ok: true };
  }

  /** Lien signé (2 h) vers la vidéo déposée d'une review (lecture en streaming, requêtes Range). */
  async function lienVideo(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const r = await reviewDeTeam(teamId, id);
    if (r.source !== 'fichier' || !r.fichier_id || !medias) throw echec(404, 'pas-de-video', 'Cette review n’a pas de vidéo déposée.');
    return medias.lienMedia(acteur, await medias.fichier(r.fichier_id));
  }

  // -------------------------------------------------------------- Repères

  async function lireRepere(ctx, corps, existant) {
    const s = {};
    const champ = nom => corps?.[nom] !== undefined;
    if (!existant || champ('debut')) s.debut_s = lireSecondes(corps?.debut, 'debut');
    const debut = s.debut_s ?? existant?.debut_s;
    // Fin : `fin` (instant) ou `duree` (secondes) ; null efface. Si seul le départ bouge, la durée est gardée.
    let fin;
    if (champ('duree')) fin = corps.duree === null || corps.duree === '' || Number(corps.duree) === 0 ? null : debut + lireSecondes(corps.duree, 'duree');
    else if (champ('fin')) fin = corps.fin === null || corps.fin === '' ? null : lireSecondes(corps.fin, 'fin');
    else if (existant && champ('debut') && existant.fin_s != null) fin = debut + (existant.fin_s - existant.debut_s);
    if (fin !== undefined) {
      if (fin !== null && (fin <= debut || fin - debut > DUREE_REPERE_MAX_S)) throw echec(400, 'fin', 'La fin doit suivre le repère, et la durée ne dépasse pas une heure.');
      s.fin_s = fin === null ? null : Math.round(fin * 10) / 10;
    }
    if (!existant || champ('categorie')) {
      if (!CATEGORIES.includes(corps?.categorie)) throw echec(400, 'categorie', 'Catégorie inconnue (erreur, bonne_action, utilitaires, placement, comms).');
      s.categorie = corps.categorie;
    }
    if (!existant || champ('titre')) {
      s.titre = texteNettoye(corps?.titre, 120);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (champ('note')) s.note = nettoyerNote(corps.note);
    else if (!existant) s.note = '';
    if (champ('cible')) {
      const c = corps.cible ?? null;
      if (c !== null && !(await membreActif(ctx.team.id, c))) throw echec(400, 'cible', 'Ce joueur n’est pas membre actif de la team.');
      s.cible_id = c;
    }
    if (champ('dessin')) {
      const d = validerDessin(corps.dessin);
      s.dessin = d ? JSON.stringify(d) : null;
    }
    return s;
  }

  async function ajouterRepere(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.annotate');
    const review = await reviewDeTeam(teamId, id);
    const n = await base.premier('SELECT COUNT(*) AS n FROM review_reperes WHERE review_id = ? AND supprime_le IS NULL', [id]);
    if (Number(n?.n ?? 0) >= REPERES_MAX) throw echec(409, 'trop-de-reperes', `Une review garde ${REPERES_MAX} repères au plus.`);
    const s = await lireRepere(ctx, corps, undefined);
    const t = maintenant();
    const rid = nouvelId();
    await base.lot([
      {
        sql: 'INSERT INTO review_reperes (id, review_id, team_id, debut_s, fin_s, categorie, titre, note, cible_id, auteur_id, dessin, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [rid, id, teamId, s.debut_s, s.fin_s ?? null, s.categorie, s.titre, s.note, s.cible_id ?? null, acteur.compte, s.dessin ?? null, iso(t), iso(t)],
      },
      evenement('review.marker_added', { teamId, acteur: acteur.compte, entiteType: 'repere', entiteId: rid, charge: { reviewId: id, review: review.titre, titre: s.titre, categorie: s.categorie, debut: s.debut_s, cible: s.cible_id ?? null, ...(s.dessin ? { dessin: true } : {}) }, maintenant: t }),
    ]);
    return (await reperesDe(ctx, review)).find(r => r.id === rid);
  }

  async function modifierRepere(acteur, teamId, id, repereId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.annotate');
    const review = await reviewDeTeam(teamId, id);
    const r = await repereDeReview(teamId, id, repereId);
    if (r.auteur_id !== acteur.compte && !peut(ctx, 'video_review.create')) throw echec(403, 'permission', 'Vous ne pouvez modifier que vos propres repères.');
    const s = await lireRepere(ctx, corps, r);
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE review_reperes SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), repereId, teamId] },
        evenement('review.marker_updated', { teamId, acteur: acteur.compte, entiteType: 'repere', entiteId: repereId, charge: { reviewId: id, review: review.titre, titre: s.titre ?? r.titre, champs }, maintenant: t }),
      ]);
    }
    return (await reperesDe(ctx, review)).find(x => x.id === repereId);
  }

  async function supprimerRepere(acteur, teamId, id, repereId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const review = await reviewDeTeam(teamId, id);
    const r = await repereDeReview(teamId, id, repereId);
    const sien = r.auteur_id === acteur.compte && peut(ctx, 'video_review.annotate');
    if (!sien && !peut(ctx, 'video_review.delete')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE review_reperes SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), repereId, teamId] },
      evenement('review.marker_deleted', { teamId, acteur: acteur.compte, entiteType: 'repere', entiteId: repereId, charge: { reviewId: id, review: review.titre, titre: r.titre }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Commentaires

  async function commenter(acteur, teamId, id, repereId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.annotate');
    const review = await reviewDeTeam(teamId, id);
    const r = await repereDeReview(teamId, id, repereId);
    const texte = nettoyerNote(corps?.texte, 1000);
    if (texte.length < 1) throw echec(400, 'texte', 'Écrivez un commentaire.');
    const n = await base.premier('SELECT COUNT(*) AS n FROM review_commentaires WHERE repere_id = ? AND supprime_le IS NULL', [repereId]);
    if (Number(n?.n ?? 0) >= COMMENTAIRES_MAX) throw echec(409, 'trop-de-commentaires', `Un repère garde ${COMMENTAIRES_MAX} commentaires au plus.`);
    const t = maintenant();
    const cid = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO review_commentaires (id, repere_id, review_id, team_id, auteur_id, texte, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [cid, repereId, id, teamId, acteur.compte, texte, iso(t)] },
      evenement('review.comment_added', { teamId, acteur: acteur.compte, entiteType: 'commentaire', entiteId: cid, charge: { reviewId: id, titre: review.titre, repereId, repereTitre: r.titre, auteurRepere: r.auteur_id }, maintenant: t }),
    ]);
    return (await reperesDe(ctx, review)).find(x => x.id === repereId);
  }

  async function supprimerCommentaire(acteur, teamId, id, repereId, commentaireId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const review = await reviewDeTeam(teamId, id);
    await repereDeReview(teamId, id, repereId);
    exigerUuid(commentaireId, 'commentaire');
    const c = await base.premier('SELECT * FROM review_commentaires WHERE id = ? AND repere_id = ? AND team_id = ? AND supprime_le IS NULL', [commentaireId, repereId, teamId]);
    if (!c) throw echec(404, 'commentaire-introuvable', 'Commentaire introuvable.');
    const sien = c.auteur_id === acteur.compte && peut(ctx, 'video_review.annotate');
    if (!sien && !peut(ctx, 'video_review.delete')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE review_commentaires SET supprime_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), commentaireId, teamId] },
      evenement('review.comment_deleted', { teamId, acteur: acteur.compte, entiteType: 'commentaire', entiteId: commentaireId, charge: { reviewId: id, titre: review.titre }, maintenant: t }),
    ]);
    return (await reperesDe(ctx, review)).find(x => x.id === repereId);
  }

  // -------------------------------------------------------------- Réactions

  const VALEURS_REACTION = { like: 1, dislike: -1 };

  /**
   * Réaction de l'acteur à un repère (`commentaireId` absent) ou à un
   * commentaire : `{ valeur: 'like' | 'dislike' | null }` (null retire).
   * Une seule réaction par membre et par cible ; rend le repère à jour.
   */
  async function reagir(acteur, teamId, id, repereId, commentaireId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.react');
    const review = await reviewDeTeam(teamId, id);
    const r = await repereDeReview(teamId, id, repereId);
    let cibleType = 'repere';
    let cibleId = repereId;
    if (commentaireId !== undefined) {
      exigerUuid(commentaireId, 'commentaire');
      const c = await base.premier('SELECT id FROM review_commentaires WHERE id = ? AND repere_id = ? AND team_id = ? AND supprime_le IS NULL', [commentaireId, repereId, teamId]);
      if (!c) throw echec(404, 'commentaire-introuvable', 'Commentaire introuvable.');
      cibleType = 'commentaire';
      cibleId = commentaireId;
    }
    const brute = corps?.valeur ?? null;
    if (brute !== null && !(brute in VALEURS_REACTION)) throw echec(400, 'valeur', 'Réaction inconnue (like, dislike ou null).');
    const valeur = brute === null ? null : VALEURS_REACTION[brute];
    const avant = await base.premier('SELECT id, valeur FROM review_reactions WHERE cible_type = ? AND cible_id = ? AND compte_id = ? AND team_id = ?', [cibleType, cibleId, acteur.compte, teamId]);
    const ancienne = avant ? (Number(avant.valeur) === 1 ? 'like' : 'dislike') : null;
    if (ancienne !== brute) {
      const t = maintenant();
      const sql =
        valeur === null
          ? { sql: 'DELETE FROM review_reactions WHERE cible_type = ? AND cible_id = ? AND compte_id = ? AND team_id = ?', params: [cibleType, cibleId, acteur.compte, teamId] }
          : {
              sql: 'INSERT INTO review_reactions (id, team_id, review_id, repere_id, cible_type, cible_id, compte_id, valeur, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (cible_type, cible_id, compte_id) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le',
              params: [nouvelId(), teamId, id, repereId, cibleType, cibleId, acteur.compte, valeur, iso(t), iso(t)],
            };
      await base.lot([
        sql,
        evenement('review.reaction_changed', {
          teamId,
          acteur: acteur.compte,
          entiteType: cibleType === 'repere' ? 'repere' : 'commentaire',
          entiteId: cibleId,
          charge: { reviewId: id, review: review.titre, repereId, repereTitre: r.titre, cible: cibleType, valeur: brute, avant: ancienne },
          maintenant: t,
        }),
      ]);
    }
    return (await reperesDe(ctx, review)).find(x => x.id === repereId);
  }

  // -------------------------------------------------------------- Export

  async function exporter(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'video_review.view');
    const review = await reviewDeTeam(teamId, id);
    const reperes = await reperesDe(ctx, review);
    const contenu = exporterMarkdown({
      review: { titre: review.titre, url: review.url, videoId: review.video_id, reference: review.reference, source: review.source, nomFichier: review.source === 'fichier' ? (await medias?.fichier(review.fichier_id))?.nom_original : undefined },
      reperes: reperes.map(r => ({
        debut: r.debut,
        fin: r.fin,
        categorie: r.categorie,
        titre: r.titre,
        note: r.note,
        cible: r.cible?.pseudo ?? null,
        auteur: r.auteur?.pseudo ?? null,
        reactions: { like: r.reactions.like, dislike: r.reactions.dislike },
        dessin: r.dessin,
        commentaires: r.commentaires.map(c => ({ auteur: c.auteur?.pseudo ?? null, texte: c.texte, creeLe: c.creeLe })),
      })),
      equipe: ctx.team.nom,
      exporteLe: iso(maintenant()),
    });
    return { nom: nomFichierExport(review.titre), type: 'text/markdown; charset=utf-8', contenu };
  }

  return { liste, detail, creer, modifier, supprimer, lienVideo, ajouterRepere, modifierRepere, supprimerRepere, commenter, supprimerCommentaire, reagir, exporter, preparerCreation, reviewDeTeam, exiger };
}
