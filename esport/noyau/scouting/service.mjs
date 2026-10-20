/**
 * Scouting adverse (phase 5) : fiche adversaire (nom, logo par adresse,
 * notes), joueurs adverses, tendances par map et par side (compositions,
 * taux de victoire facultatif), VODs (avec « Ouvrir en review vidéo ») et
 * historique des confrontations, lu dans les événements du planning qui
 * portent cet adversaire (`adversaire_id`).
 *
 * Donnée sensible : visible UNIQUEMENT avec `scouting.view`, modifiable avec
 * `scouting.manage`. Contrôles de chaque route : session → appartenance à la
 * team (404) → module `scouting` activé (404) → permission (403). Toute
 * requête SQL filtre sur `team_id` : l'adversaire d'une autre team est
 * introuvable. Le Joueur (sans scouting.view) reçoit 403, même en appel direct.
 *
 * Logo : adresse https uniquement (pas de fichier R2 : voir docs/esport/scouting.md).
 */

import { evenement } from '../evenements.mjs';
import { autorise } from '../permissions.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { lienSur } from '../review/markdown.mjs';
import { extraireYoutube } from '../review/youtube.mjs';

export const MODULE_SCOUTING = 'scouting';
export const SIDES = ['attaque', 'defense', 'les_deux'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX = { adversaires: 200, joueurs: 15, tendances: 60, vods: 100, confrontations: 100 };

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

/** Adresse https saisie (logo, VOD) ; `null` si vide. */
function lireAdresse(valeur, quoi, { obligatoire = false } = {}) {
  const t = String(valeur ?? '').trim();
  if (!t) {
    if (obligatoire) throw echec(400, quoi, 'Adresse requise (https://…).');
    return null;
  }
  if (t.length > 500 || !/^https:\/\//i.test(t) || !lienSur(t)) throw echec(400, quoi, 'Adresse invalide : https://… sans espace (500 caractères au plus).');
  return t;
}

function lireAgents(valeur) {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur) || valeur.length > 12) throw echec(400, 'agents', 'Agents : 12 au plus.');
  return [...new Set(valeur.map(a => texteNettoye(a, 24)).filter(Boolean))];
}

function lireCompos(valeur) {
  if (valeur === undefined || valeur === null) return [];
  if (!Array.isArray(valeur) || valeur.length > 8) throw echec(400, 'compos', 'Compositions : 8 au plus.');
  return valeur
    .map(c => {
      if (!Array.isArray(c) || c.length > 5) throw echec(400, 'compos', 'Une composition compte 5 agents au plus.');
      return [...new Set(c.map(a => texteNettoye(a, 24)).filter(Boolean))];
    })
    .filter(c => c.length > 0);
}

export function servicesScouting({ base, maintenant = () => Date.now(), socle, review }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_SCOUTING)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  async function adversaireDeTeam(teamId, id) {
    exigerUuid(id, 'adversaire');
    const a = await base.premier('SELECT * FROM adversaires WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!a) throw echec(404, 'adversaire-introuvable', 'Adversaire introuvable.');
    return a;
  }

  const fiche = a => ({ id: a.id, nom: a.nom, logoUrl: a.logo_url ?? null, notes: a.notes, creeLe: a.cree_le, majLe: a.maj_le });

  const joueurPublic = j => ({ id: j.id, pseudo: j.pseudo, riotId: j.riot_id, role: j.role, agents: jsonOu(j.agents, []), notes: j.notes });
  const tendancePublique = x => ({ id: x.id, map: x.map, side: x.side, notes: x.notes, tauxVictoire: x.taux_victoire ?? null, compos: jsonOu(x.compos, []) });

  /** Confrontations (événements du planning liés), seulement si l'acteur voit le planning. */
  async function confrontations(ctx, adversaireIds) {
    if (!peut(ctx, 'planning.view') || adversaireIds.length === 0) return null;
    const voitReview = peut(ctx, 'video_review.view');
    const sortie = new Map(adversaireIds.map(id => [id, []]));
    // Une requête par paquet d'adversaires (et non une par adversaire), puis les plus récentes de chacun.
    const lignes = await lignesParIds(
      base,
      'SELECT id, titre, type, debut, fin, fuseau, recurrence, review_id, adversaire_id FROM planning_evenements WHERE team_id = ? AND supprime_le IS NULL AND adversaire_id',
      adversaireIds,
      { paramsAvant: [ctx.team.id], apres: 'ORDER BY debut DESC' },
    );
    for (const e of lignes) {
      const liste = sortie.get(e.adversaire_id);
      if (!liste || liste.length >= MAX.confrontations) continue;
      liste.push({ id: e.id, titre: e.titre, type: e.type, debut: e.debut, fin: e.fin, fuseau: e.fuseau, recurrent: Boolean(e.recurrence), reviewId: voitReview ? (e.review_id ?? null) : null });
    }
    return sortie;
  }

  // -------------------------------------------------------------- Lectures

  async function liste(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.view');
    const lignes = await base.tous('SELECT * FROM adversaires WHERE team_id = ? AND supprime_le IS NULL ORDER BY LOWER(nom), cree_le LIMIT ?', [teamId, MAX.adversaires]);
    const joueurs = await base.tous('SELECT adversaire_id, COUNT(*) AS n FROM adversaire_joueurs WHERE team_id = ? GROUP BY adversaire_id', [teamId]);
    const vods = await base.tous('SELECT adversaire_id, COUNT(*) AS n FROM adversaire_vods WHERE team_id = ? GROUP BY adversaire_id', [teamId]);
    const conf = await confrontations(ctx, lignes.map(a => a.id));
    const n = (liste_, id) => Number(liste_.find(x => x.adversaire_id === id)?.n ?? 0);
    return {
      adversaires: lignes.map(a => ({
        ...fiche(a),
        joueurs: n(joueurs, a.id),
        vods: n(vods, a.id),
        confrontations: conf ? conf.get(a.id).length : null,
        derniere: conf ? (conf.get(a.id)[0]?.debut ?? null) : null,
      })),
      droits: { gerer: peut(ctx, 'scouting.manage') },
    };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.view');
    const a = await adversaireDeTeam(teamId, id);
    const joueurs = await base.tous('SELECT * FROM adversaire_joueurs WHERE adversaire_id = ? AND team_id = ? ORDER BY cree_le', [id, teamId]);
    const tendances = await base.tous('SELECT * FROM adversaire_tendances WHERE adversaire_id = ? AND team_id = ? ORDER BY LOWER(map), side, cree_le', [id, teamId]);
    const vods = await base.tous('SELECT * FROM adversaire_vods WHERE adversaire_id = ? AND team_id = ? ORDER BY cree_le DESC', [id, teamId]);
    const reviewsVivantes = new Set(
      (await base.tous('SELECT id FROM reviews WHERE team_id = ? AND supprime_le IS NULL', [teamId])).map(r => r.id),
    );
    const voitReview = peut(ctx, 'video_review.view');
    const conf = await confrontations(ctx, [id]);
    return {
      adversaire: fiche(a),
      joueurs: joueurs.map(joueurPublic),
      tendances: tendances.map(tendancePublique),
      vods: vods.map(v => ({
        id: v.id,
        url: v.url,
        titre: v.titre,
        youtube: extraireYoutube(v.url) !== null,
        reviewId: voitReview && v.review_id && reviewsVivantes.has(v.review_id) ? v.review_id : null,
      })),
      confrontations: conf ? conf.get(id) : null,
      droits: { gerer: peut(ctx, 'scouting.manage'), creerReview: peut(ctx, 'video_review.create'), voirReview: voitReview },
    };
  }

  // -------------------------------------------------------------- Fiche

  function lireFiche(corps, partiel) {
    const s = {};
    if (!partiel || corps?.nom !== undefined) {
      s.nom = texteNettoye(corps?.nom, 60);
      if (s.nom.length < 2) throw echec(400, 'nom', 'Nom : 2 caractères au moins.');
    }
    if (!partiel || corps?.logoUrl !== undefined) s.logo_url = lireAdresse(corps?.logoUrl, 'logo');
    if (!partiel || corps?.notes !== undefined) s.notes = texteLong(corps?.notes, 4000);
    return s;
  }

  async function creer(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const s = lireFiche(corps, false);
    const n = await base.premier('SELECT COUNT(*) AS n FROM adversaires WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
    if (Number(n?.n ?? 0) >= MAX.adversaires) throw echec(409, 'trop-d-adversaires', `Une team garde ${MAX.adversaires} adversaires au plus.`);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      { sql: 'INSERT INTO adversaires (id, team_id, nom, logo_url, notes, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [id, teamId, s.nom, s.logo_url, s.notes, acteur.compte, iso(t), iso(t)] },
      evenement('opponent.created', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: id, charge: { nom: s.nom }, maintenant: t }),
    ]);
    return fiche(await adversaireDeTeam(teamId, id));
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, id);
    const s = lireFiche(corps, true);
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE adversaires SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), id, teamId] },
        evenement('opponent.updated', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: id, charge: { nom: s.nom ?? a.nom, champs }, maintenant: t }),
      ]);
    }
    return fiche(await adversaireDeTeam(teamId, id));
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, id);
    const t = maintenant();
    // Suppression logique ; les événements du planning ne pointent plus vers lui.
    await base.lot([
      { sql: 'UPDATE adversaires SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'UPDATE planning_evenements SET adversaire_id = NULL WHERE adversaire_id = ? AND team_id = ?', params: [id, teamId] },
      evenement('opponent.deleted', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: id, charge: { nom: a.nom }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Joueurs, tendances, VODs

  function lireJoueur(corps, partiel) {
    const s = {};
    if (!partiel || corps?.pseudo !== undefined) {
      s.pseudo = texteNettoye(corps?.pseudo, 40);
      if (s.pseudo.length < 1) throw echec(400, 'pseudo', 'Pseudo requis.');
    }
    if (!partiel || corps?.riotId !== undefined) s.riot_id = texteNettoye(corps?.riotId, 40);
    if (!partiel || corps?.role !== undefined) s.role = texteNettoye(corps?.role, 30);
    if (!partiel || corps?.agents !== undefined) s.agents = JSON.stringify(lireAgents(corps?.agents));
    if (!partiel || corps?.notes !== undefined) s.notes = texteLong(corps?.notes, 1000);
    return s;
  }

  function lireTendance(corps, partiel) {
    const s = {};
    if (!partiel || corps?.map !== undefined) {
      s.map = texteNettoye(corps?.map, 30);
      if (s.map.length < 2) throw echec(400, 'map', 'Map : 2 caractères au moins.');
    }
    if (!partiel || corps?.side !== undefined) {
      if (!SIDES.includes(corps?.side)) throw echec(400, 'side', 'Side inconnu (attaque, defense, les_deux).');
      s.side = corps.side;
    }
    if (!partiel || corps?.notes !== undefined) s.notes = texteLong(corps?.notes, 2000);
    if (!partiel || corps?.tauxVictoire !== undefined) {
      const v = corps?.tauxVictoire ?? null;
      if (v !== null && v !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 100)) throw echec(400, 'taux', 'Taux de victoire : un entier de 0 à 100.');
      s.taux_victoire = v === null || v === '' ? null : Number(v);
    }
    if (!partiel || corps?.compos !== undefined) s.compos = JSON.stringify(lireCompos(corps?.compos));
    return s;
  }

  function lireVod(corps, partiel) {
    const s = {};
    if (!partiel || corps?.url !== undefined) s.url = lireAdresse(corps?.url, 'url', { obligatoire: true });
    if (!partiel || corps?.titre !== undefined) {
      s.titre = texteNettoye(corps?.titre, 120);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    return s;
  }

  const SOUS = {
    joueurs: { table: 'adversaire_joueurs', lire: lireJoueur, max: MAX.joueurs, partie: 'joueur', nom: s => s.pseudo, colonnes: ['pseudo', 'riot_id', 'role', 'agents', 'notes'], defauts: { riot_id: '', role: '', agents: '[]', notes: '' } },
    tendances: { table: 'adversaire_tendances', lire: lireTendance, max: MAX.tendances, partie: 'tendance', nom: s => s.map, colonnes: ['map', 'side', 'notes', 'taux_victoire', 'compos'], defauts: { notes: '', taux_victoire: null, compos: '[]' } },
    vods: { table: 'adversaire_vods', lire: lireVod, max: MAX.vods, partie: 'vod', nom: s => s.titre, colonnes: ['url', 'titre'], defauts: {} },
  };

  async function ajouterSous(type, acteur, teamId, adversaireId, corps) {
    const def = SOUS[type];
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, adversaireId);
    const n = await base.premier(`SELECT COUNT(*) AS n FROM ${def.table} WHERE adversaire_id = ?`, [adversaireId]);
    if (Number(n?.n ?? 0) >= def.max) throw echec(409, 'trop-d-elements', `Limite atteinte (${def.max}).`);
    const s = { ...def.defauts, ...def.lire(corps, false) };
    const t = maintenant();
    const id = nouvelId();
    const colonnes = [...def.colonnes];
    const valeurs = colonnes.map(c => s[c] ?? null);
    if (type === 'vods') {
      colonnes.push('cree_par');
      valeurs.push(acteur.compte);
    }
    await base.lot([
      {
        sql: `INSERT INTO ${def.table} (id, adversaire_id, team_id, ${colonnes.join(', ')}, cree_le, maj_le) VALUES (?, ?, ?, ${colonnes.map(() => '?').join(', ')}, ?, ?)`,
        params: [id, adversaireId, teamId, ...valeurs, iso(t), iso(t)],
      },
      evenement('opponent.detail_changed', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: adversaireId, charge: { adversaire: a.nom, partie: def.partie, action: 'ajout', nom: def.nom(s) }, maintenant: t }),
    ]);
    return { id };
  }

  async function modifierSous(type, acteur, teamId, adversaireId, id, corps) {
    const def = SOUS[type];
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, adversaireId);
    exigerUuid(id, 'element');
    const existant = await base.premier(`SELECT * FROM ${def.table} WHERE id = ? AND adversaire_id = ? AND team_id = ?`, [id, adversaireId, teamId]);
    if (!existant) throw echec(404, 'element-introuvable', 'Élément introuvable.');
    const s = def.lire(corps, true);
    // Une autre adresse : la review liée ne correspond plus.
    if (type === 'vods' && s.url !== undefined && s.url !== existant.url) s.review_id = null;
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE ${def.table} SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), id, teamId] },
        evenement('opponent.detail_changed', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: adversaireId, charge: { adversaire: a.nom, partie: def.partie, action: 'modification', nom: def.nom({ ...existant, ...s }) }, maintenant: t }),
      ]);
    }
    return { id };
  }

  async function supprimerSous(type, acteur, teamId, adversaireId, id) {
    const def = SOUS[type];
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, adversaireId);
    exigerUuid(id, 'element');
    const existant = await base.premier(`SELECT * FROM ${def.table} WHERE id = ? AND adversaire_id = ? AND team_id = ?`, [id, adversaireId, teamId]);
    if (!existant) throw echec(404, 'element-introuvable', 'Élément introuvable.');
    const t = maintenant();
    await base.lot([
      { sql: `DELETE FROM ${def.table} WHERE id = ? AND team_id = ?`, params: [id, teamId] },
      evenement('opponent.detail_changed', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: adversaireId, charge: { adversaire: a.nom, partie: def.partie, action: 'suppression', nom: def.nom(existant) }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- VOD → review

  /**
   * « Ouvrir en review vidéo » : crée la review de cette VOD (YouTube) et la
   * lie, ou rend la review déjà liée. Avec `reviewId` dans le corps : lie une
   * review existante de la team. Rend `{ reviewId, cree }`.
   */
  async function ouvrirVodEnReview(acteur, teamId, adversaireId, vodId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'scouting.manage');
    const a = await adversaireDeTeam(teamId, adversaireId);
    exigerUuid(vodId, 'vod');
    const vod = await base.premier('SELECT * FROM adversaire_vods WHERE id = ? AND adversaire_id = ? AND team_id = ?', [vodId, adversaireId, teamId]);
    if (!vod) throw echec(404, 'vod-introuvable', 'VOD introuvable.');
    review.exiger(ctx, 'video_review.view');
    const t = maintenant();

    if (corps?.reviewId !== undefined && corps.reviewId !== null) {
      const r = await review.reviewDeTeam(teamId, corps.reviewId);
      await base.lot([
        { sql: 'UPDATE adversaire_vods SET review_id = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [r.id, iso(t), vodId, teamId] },
        evenement('opponent.detail_changed', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: adversaireId, charge: { adversaire: a.nom, partie: 'vod', action: 'liaison', nom: vod.titre, reviewId: r.id }, maintenant: t }),
      ]);
      return { reviewId: r.id, cree: false };
    }

    if (vod.review_id) {
      const existante = await base.premier('SELECT id FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [vod.review_id, teamId]);
      if (existante) return { reviewId: existante.id, cree: false };
    }

    review.exiger(ctx, 'video_review.create');
    if (!extraireYoutube(vod.url)) throw echec(400, 'pas-youtube', 'Seules les vidéos YouTube s’ouvrent en review : cette VOD n’est pas une adresse YouTube.');
    const titre = texteNettoye(`${a.nom} · ${vod.titre}`, 120);
    const { id, instructions } = await review.preparerCreation(ctx, acteur, { titre, url: vod.url, reference: texteNettoye(`Scouting : ${a.nom}`, 120) }, { adversaireId, vodId, depuisVod: true });
    await base.lot([
      ...instructions,
      { sql: 'UPDATE adversaire_vods SET review_id = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [id, iso(t), vodId, teamId] },
      evenement('opponent.detail_changed', { teamId, acteur: acteur.compte, entiteType: 'adversaire', entiteId: adversaireId, charge: { adversaire: a.nom, partie: 'vod', action: 'review', nom: vod.titre, reviewId: id }, maintenant: t }),
    ]);
    return { reviewId: id, cree: true };
  }

  return {
    liste,
    detail,
    creer,
    modifier,
    supprimer,
    ajouterJoueur: (...a) => ajouterSous('joueurs', ...a),
    modifierJoueur: (...a) => modifierSous('joueurs', ...a),
    supprimerJoueur: (...a) => supprimerSous('joueurs', ...a),
    ajouterTendance: (...a) => ajouterSous('tendances', ...a),
    modifierTendance: (...a) => modifierSous('tendances', ...a),
    supprimerTendance: (...a) => supprimerSous('tendances', ...a),
    ajouterVod: (...a) => ajouterSous('vods', ...a),
    modifierVod: (...a) => modifierSous('vods', ...a),
    supprimerVod: (...a) => supprimerSous('vods', ...a),
    ouvrirVodEnReview,
  };
}
