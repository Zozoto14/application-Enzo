/**
 * Section CM : clips proposés par les joueurs (permission de team `cm.clips.proposer`, donnée aux joueurs
 * par défaut). Un clip est un fichier déposé (envoi par morceaux) ou un lien https (YouTube, Twitch…), avec
 * son contexte : match ou résultat lié (publiable), instant (timecode), titre, description.
 *
 * Le CM (cm.editer sur la team) trie : proposé → retenu, refusé (motif) ou utilisé ; il transforme un clip en
 * carte (post brouillon dans « Idées ») ou le joint à une carte existante. Le proposeur est prévenu de chaque
 * décision ; le CM est prévenu d'un nouveau clip. Le proposeur voit ses clips ; cm.voir voit ceux de la team.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { lienSur } from '../review/markdown.mjs';
import { cheminSigne } from '../fichiers.mjs';
import { extraireYoutube } from '../review/youtube.mjs';
import { activite, contexteCm, exiger, exigerUuid, peut, porteesDe, versionTableau } from './commun.mjs';
import { DUREE_LIEN_CM_MS, assurerTableauDefaut, instructionsCarte, listeDeCle, positionFin } from './tableaux.mjs';
import { lireReglagesCm } from './droits.mjs';

export const STATUTS_CLIP = Object.freeze(['propose', 'retenu', 'refuse', 'utilise']);
const MAX_CLIPS_EN_ATTENTE = 30;

/** Instant saisi : secondes, ou « m:ss » / « h:mm:ss » ; null si vide. */
export function lireInstantClip(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 86_400) return v;
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (m && Number(m[3]) < 60 && (!m[1] || Number(m[2]) < 60)) return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (/^\d{1,5}$/.test(String(v).trim()) && Number(v) <= 86_400) return Number(v);
  throw echec(400, 'instant', 'Instant invalide (ex. 12:34).');
}

export function servicesClipsCm({ base, maintenant = () => Date.now(), medias, cleSession, tableaux, drive }) {
  async function ctxTeam(acteur, teamId) {
    exigerUuid(teamId, 'team');
    return contexteCm(base, acteur, teamId);
  }

  async function clipLigne(id) {
    exigerUuid(id, 'clip');
    const c = await base.premier('SELECT * FROM cm_clips WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!c) throw echec(404, 'clip-introuvable', 'Clip introuvable.');
    return c;
  }

  /** Clip visible par l'acteur : son auteur, ou cm.voir sur la team (404 sinon). */
  async function clipVisible(acteur, id) {
    const clip = await clipLigne(id);
    let ctx;
    try {
      ctx = await ctxTeam(acteur, clip.team_id);
    } catch {
      throw echec(404, 'clip-introuvable', 'Clip introuvable.');
    }
    if (!peut(ctx, 'cm.voir') && clip.propose_par !== acteur.compte) throw echec(404, 'clip-introuvable', 'Clip introuvable.');
    return { clip, ctx };
  }

  async function publics(lignes, acteur, droitsParTeam) {
    const noms = await pseudosDe(base, lignes.flatMap(c => [c.propose_par, c.decide_par]).filter(Boolean));
    const fichiers = new Map((await lignesParIds(base, 'SELECT id, type_mime, taille, nom_original, supprime_le FROM cm_fichiers WHERE id', lignes.map(c => c.fichier_id))).map(f => [f.id, f]));
    const teams = new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE id', lignes.map(c => c.team_id))).map(t => [t.id, t.nom]));
    const resultats = new Map((await lignesParIds(base, "SELECT id, date_match, adversaires FROM resultats WHERE supprime_le IS NULL AND visibilite = 'team' AND id", lignes.map(c => c.resultat_id))).map(r => [r.id, r]));
    const matchs = new Map((await lignesParIds(base, 'SELECT m.id, m.tour, m.debut, m.adversaires, t.nom FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.supprime_le IS NULL AND m.id', lignes.map(c => c.tournoi_match_id))).map(r => [r.id, r]));
    return {
      clips: lignes.map(c => {
        const f = c.fichier_id ? fichiers.get(c.fichier_id) : null;
        const r = c.resultat_id ? resultats.get(c.resultat_id) : null;
        const m = c.tournoi_match_id ? matchs.get(c.tournoi_match_id) : null;
        const droits = droitsParTeam(c.team_id);
        return {
          id: c.id,
          team: { id: c.team_id, nom: teams.get(c.team_id) ?? null },
          proposePar: c.propose_par ?? null,
          genre: c.genre,
          url: c.genre === 'lien' ? c.url : null,
          youtube: c.genre === 'lien' ? (extraireYoutube(c.url ?? '')?.id ?? null) : null,
          fichier: f && !f.supprime_le ? { id: f.id, type: f.type_mime, taille: Number(f.taille), nom: f.nom_original } : null,
          resultat: r ? { id: r.id, date: r.date_match, adversaires: jsonOu(r.adversaires, []).map(a => a.nom) } : null,
          match: m ? { id: m.id, tournoi: m.nom, tour: m.tour || null, debut: m.debut ?? null, adversaires: jsonOu(m.adversaires, []).map(a => a.nom) } : null,
          instant: c.instant === null || c.instant === undefined ? null : Number(c.instant),
          titre: c.titre,
          description: c.description,
          statut: c.statut,
          decidePar: c.decide_par ?? null,
          decideLe: c.decide_le ?? null,
          motif: c.motif ?? null,
          carteId: c.carte_id ?? null,
          creeLe: c.cree_le,
          moi: c.propose_par === acteur.compte,
          droits: { trier: droits.has('cm.editer'), supprimer: droits.has('cm.editer') || (c.propose_par === acteur.compte && c.statut === 'propose') },
        };
      }),
      noms,
    };
  }

  /** `GET /cm/teams/:t/clips` : clips de la team (cm.voir) ou mes clips (proposeur). */
  async function listeTeam(acteur, teamId, { statut } = {}) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.voir', 'cm.clips.proposer');
    if (statut !== undefined && !STATUTS_CLIP.includes(statut)) throw echec(400, 'statut', 'Statut inconnu.');
    const tous = peut(ctx, 'cm.voir');
    const lignes = await base.tous(
      `SELECT * FROM cm_clips WHERE team_id = ? AND supprime_le IS NULL ${tous ? '' : 'AND propose_par = ?'} ${statut ? 'AND statut = ?' : ''} ORDER BY cree_le DESC LIMIT 200`,
      [teamId, ...(tous ? [] : [acteur.compte]), ...(statut ? [statut] : [])],
    );
    return { ...(await publics(lignes, acteur, () => ctx.permissions)), tous };
  }

  /** `GET /cm/clips?statut&team` : galerie des clips de toutes les teams où l'acteur voit la partie CM. */
  async function galerie(acteur, { statut, team } = {}) {
    if (statut !== undefined && !STATUTS_CLIP.includes(statut)) throw echec(400, 'statut', 'Statut inconnu.');
    const portees = await porteesDe(base, acteur);
    const ids = [...portees.teams].filter(([id, s]) => s.has('cm.voir') && (!team || team === id)).map(([id]) => id);
    const lignes = (await lignesParIds(base, `SELECT * FROM cm_clips WHERE supprime_le IS NULL ${statut ? 'AND statut = ?' : ''} AND team_id`, ids, { paramsAvant: statut ? [statut] : [] }))
      .sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)))
      .slice(0, 300);
    return publics(lignes, acteur, id => portees.teams.get(id) ?? new Set());
  }

  /** Match ou résultat lié : de la team, PUBLIABLE (jamais un résultat staff). */
  async function lienMatch(teamId, corps) {
    const sortie = { resultat: null, match: null };
    if (corps?.resultatId) {
      exigerUuid(corps.resultatId, 'resultat');
      const r = await base.premier("SELECT id FROM resultats WHERE id = ? AND team_id = ? AND supprime_le IS NULL AND visibilite = 'team' AND publiable = 1", [corps.resultatId, teamId]);
      if (!r) throw echec(400, 'resultat', 'Résultat inconnu.');
      sortie.resultat = r.id;
    }
    if (corps?.matchId) {
      exigerUuid(corps.matchId, 'match');
      const m = await base.premier('SELECT m.id FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id WHERE m.id = ? AND m.team_id = ? AND m.supprime_le IS NULL AND t.publiable = 1', [corps.matchId, teamId]);
      if (!m) throw echec(400, 'match', 'Match inconnu.');
      sortie.match = m.id;
    }
    return sortie;
  }

  /** `POST /cm/teams/:t/clips` `{ genre, url | envoi, resultatId?, matchId?, instant?, titre, description }`. */
  async function proposer(acteur, teamId, corps) {
    const ctx = await ctxTeam(acteur, teamId);
    exiger(ctx, 'cm.clips.proposer');
    const attente = await base.premier("SELECT COUNT(*) AS n FROM cm_clips WHERE team_id = ? AND propose_par = ? AND statut = 'propose' AND supprime_le IS NULL", [teamId, acteur.compte]);
    if (Number(attente?.n ?? 0) >= MAX_CLIPS_EN_ATTENTE) throw echec(429, 'trop-de-clips', `${MAX_CLIPS_EN_ATTENTE} clips en attente au plus : patientez le temps que le CM les trie.`);
    const titre = texteNettoye(corps?.titre, 120);
    if (titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    const description = texteLong(corps?.description, 1000);
    const instant = lireInstantClip(corps?.instant);
    const lien = await lienMatch(teamId, corps);
    const t = maintenant();
    const id = nouvelId();
    const lot = [];
    if (corps?.genre === 'lien') {
      const url = String(corps?.url ?? '').trim();
      if (url.length > 2000 || !/^https:\/\//i.test(url) || !lienSur(url)) throw echec(400, 'lien', 'Adresse invalide : https://… sans espace.');
      lot.push({ sql: "INSERT INTO cm_clips (id, team_id, propose_par, genre, url, resultat_id, tournoi_match_id, instant, titre, description, statut, cree_le, maj_le) VALUES (?, ?, ?, 'lien', ?, ?, ?, ?, ?, ?, 'propose', ?, ?)", params: [id, teamId, acteur.compte, url, lien.resultat, lien.match, instant, titre, description, iso(t), iso(t)] });
    } else if (corps?.genre === 'fichier') {
      if (!medias) throw echec(503, 'stockage-absent', 'Le stockage des fichiers n’est pas branché sur le serveur Esport.');
      const r = await medias.preparerRattachement({ acteur, team: { id: teamId }, portee: teamId }, corps?.envoi, 'cm', { entiteType: 'cm_clip', entiteId: id });
      lot.push(...r.instructions, { sql: "INSERT INTO cm_clips (id, team_id, propose_par, genre, fichier_id, resultat_id, tournoi_match_id, instant, titre, description, statut, cree_le, maj_le) VALUES (?, ?, ?, 'fichier', ?, ?, ?, ?, ?, ?, 'propose', ?, ?)", params: [id, teamId, acteur.compte, r.fichierId, lien.resultat, lien.match, instant, titre, description, iso(t), iso(t)] });
    } else throw echec(400, 'genre', 'Clip : lien ou fichier.');
    lot.push(evenement('cm.clip_propose', { teamId, acteur: acteur.compte, entiteType: 'cm_clip', entiteId: id, charge: { titre }, maintenant: t }));
    await base.lot(lot);
    return listeTeam(acteur, teamId);
  }

  /** `PATCH /cm/clips/:id` `{ statut, motif? }` : tri par le CM (cm.editer). */
  async function decider(acteur, id, corps) {
    const { clip, ctx } = await clipVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    const statut = corps?.statut;
    if (!STATUTS_CLIP.includes(statut)) throw echec(400, 'statut', 'Statut inconnu.');
    const motif = statut === 'refuse' ? texteLong(corps?.motif, 500) : null;
    if (statut === clip.statut && (motif ?? null) === (clip.motif ?? null)) return { ok: true };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_clips SET statut = ?, motif = ?, decide_par = ?, decide_le = ?, maj_le = ? WHERE id = ?', params: [statut, motif || null, acteur.compte, iso(t), iso(t), clip.id] },
      ...(statut !== 'propose' ? [evenement('cm.clip_decide', { teamId: clip.team_id, acteur: acteur.compte, entiteType: 'cm_clip', entiteId: clip.id, charge: { titre: clip.titre, statut, motif: motif || null, proposePar: clip.propose_par ?? null }, maintenant: t })] : []),
    ]);
    // Clip retenu (fichier déposé) : rangé dans le dossier « Clips » du Drive de la team (réglable, docs/esport/drive.md).
    if ((statut === 'retenu' || statut === 'utilise') && clip.genre === 'fichier' && clip.fichier_id && drive) {
      await drive.ranger({ origine: 'clip', origineId: clip.id, portee: clip.team_id, cleDossier: 'clips', fichierId: clip.fichier_id, nom: clip.titre || 'clip', acteur });
    }
    return { ok: true };
  }

  async function supprimer(acteur, id) {
    const { clip, ctx } = await clipVisible(acteur, id);
    if (!peut(ctx, 'cm.editer') && !(clip.propose_par === acteur.compte && clip.statut === 'propose')) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const t = maintenant();
    await base.executer('UPDATE cm_clips SET supprime_le = ?, maj_le = ? WHERE id = ?', [iso(t), iso(t), clip.id]);
    await tableaux.effacerFichierSiOrphelin(clip.fichier_id, t);
    return { ok: true };
  }

  /**
   * `POST /cm/clips/:id/carte` `{ carteId? }` : joint le clip à une carte existante, ou (sans carte) crée un post
   * brouillon dans « Idées » du tableau CM du club, lié au clip et à son match. Le clip passe « utilisé ».
   */
  async function versCarte(acteur, id, corps) {
    const { clip, ctx } = await clipVisible(acteur, id);
    exiger(ctx, 'cm.editer');
    const t = maintenant();
    const piece = clip.genre === 'fichier'
      ? { genre: 'fichier', fichier: clip.fichier_id, url: null }
      : { genre: 'lien', fichier: null, url: clip.url };
    let carteId;
    let tableauId;
    const lot = [];
    if (corps?.carteId) {
      const v = await tableaux.carteVisible(acteur, corps.carteId);
      exiger(v.ctx, 'cm.editer');
      if (v.carte.statut === 'publie') throw echec(409, 'post-publie', 'Ce post est publié : son contenu ne se modifie plus (dépubliez-le d’abord).');
      carteId = v.carte.id;
      tableauId = v.tableau.id;
      const liens = jsonOu(v.carte.liens, {});
      liens.clips = [...new Set([...(liens.clips ?? []), clip.id])].slice(0, 20);
      // Joindre un clip change le contenu d'un post validé : il repasse « à valider ».
      if (v.carte.statut === 'valide') {
        lot.push({ sql: "UPDATE cm_cartes SET statut = 'a_valider', valide_par = NULL, valide_le = NULL, empreinte_validee = NULL WHERE id = ?", params: [carteId] });
        lot.push(evenement('cm.post_invalide', { teamId: v.tableau.team_id, acteur: acteur.compte, entiteType: 'cm_carte', entiteId: carteId, charge: { titre: v.carte.titre, tableau: tableauId, portee: v.tableau.portee }, maintenant: t }));
        lot.push(activite(carteId, tableauId, acteur.compte, 'invalidee', {}, t));
      }
      lot.push({ sql: 'UPDATE cm_cartes SET liens = ?, version = version + 1, maj_par = ?, maj_le = ? WHERE id = ?', params: [JSON.stringify(liens), acteur.compte, iso(t), carteId] });
    } else {
      // Tableau du club si l'acteur y prépare les contenus, sinon celui de la team (un CM de team n'écrit pas au club).
      const club = await contexteCm(base, acteur, 'club');
      const tableau = await assurerTableauDefaut(base, peut(club, 'cm.editer') ? 'club' : clip.team_id, t);
      const liste = (await listeDeCle(base, tableau.id, 'idees')) ?? (await base.premier('SELECT * FROM cm_listes WHERE tableau_id = ? AND archive_le IS NULL ORDER BY position LIMIT 1', [tableau.id]));
      if (!liste) throw echec(409, 'liste-absente', 'Le tableau du club n’a plus de liste ouverte.');
      tableauId = tableau.id;
      const reglages = (await lireReglagesCm(base)).suggestions;
      const c = instructionsCarte({
        tableauId,
        listeId: liste.id,
        teamId: clip.team_id,
        titre: clip.titre,
        description: clip.description,
        position: await positionFin(base, liste.id),
        terminee: Number(liste.fin) === 1,
        post: true,
        reseaux: reglages.reseaux,
        liens: { teamId: clip.team_id, clips: [clip.id], ...(clip.resultat_id ? { resultatId: clip.resultat_id } : {}), ...(clip.tournoi_match_id ? { matchId: clip.tournoi_match_id } : {}), ...(clip.propose_par ? { membres: [clip.propose_par] } : {}) },
        origine: 'clip',
        acteur: acteur.compte,
        t,
      });
      carteId = c.id;
      lot.push(...c.instructions);
    }
    lot.push(
      { sql: 'INSERT INTO cm_pieces (id, carte_id, genre, nom, url, fichier_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), carteId, piece.genre, clip.titre || 'clip', piece.url, piece.fichier, acteur.compte, iso(t)] },
      { sql: "UPDATE cm_clips SET statut = 'utilise', carte_id = ?, decide_par = ?, decide_le = ?, maj_le = ? WHERE id = ?", params: [carteId, acteur.compte, iso(t), iso(t), clip.id] },
      activite(carteId, tableauId, acteur.compte, 'clip', { clip: clip.id, titre: clip.titre }, t),
      versionTableau(tableauId, t),
      evenement('cm.clip_decide', { teamId: clip.team_id, acteur: acteur.compte, entiteType: 'cm_clip', entiteId: clip.id, charge: { titre: clip.titre, statut: 'utilise', proposePar: clip.propose_par ?? null }, maintenant: t }),
    );
    await base.lot(lot);
    return { carteId, tableauId };
  }

  /** Lien signé (2 h) vers le fichier d'un clip (lecture ou téléchargement). */
  async function lienFichier(acteur, id, corps) {
    const { clip } = await clipVisible(acteur, id);
    if (clip.genre !== 'fichier' || !clip.fichier_id) throw echec(400, 'clip-lien', 'Ce clip est un lien.');
    const f = await base.premier('SELECT id FROM cm_fichiers WHERE id = ? AND supprime_le IS NULL', [clip.fichier_id]);
    if (!f) throw echec(404, 'fichier-introuvable', 'Fichier introuvable (supprimé ?).');
    return cheminSigne(cleSession, { fichierId: f.id, compte: acteur.compte, maintenant: maintenant(), duree: DUREE_LIEN_CM_MS, telecharger: corps?.telecharger === true, genre: 'cm' });
  }

  return { listeTeam, galerie, proposer, decider, supprimer, versCarte, lienFichier };
}
