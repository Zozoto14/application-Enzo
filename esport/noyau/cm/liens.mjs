/**
 * Liens utiles de l'équipe CM (migration 0044, onglet DATA › Ressources de l'espace CM ; docs/esport/cm.md, partie
 * « Ressources »). Portée : le club, avec un rattachement facultatif à une team. Le module « Ressources » des teams
 * (esport/noyau/ressources/) est lié à une team, à ses rôles et à sa file de validation : on n'en réutilise que la
 * validation d'adresse protégée (apercu.mjs : adresses publiques seulement), pas ses tables.
 *
 * Liaisons (plusieurs-à-plusieurs, `cm_lien_liaisons`) : un lien se lie à des cartes des tableaux CM et à des dossiers du
 * Drive CM. On ne voit (et on ne compte) que les cibles accessibles ; lier ou délier demande `cm.editer` du club et le droit
 * d'écrire sur la cible (`cm.editer` de la portée du tableau ; envoyer ou gérer dans le Drive).
 *
 * Droits (aucune nouvelle permission) :
 *  - lire : `cm.voir` (club ou d'une team) ; un lien rattaché à une team n'est visible que de qui a `cm.voir` du
 *    club ou de cette team ; un lien du club l'est de tout lecteur ;
 *  - ajouter, modifier, épingler, ordonner : `cm.editer` du club ;
 *  - supprimer : `cm.gerer` du club.
 * Une adresse est toujours en https, sans identifiants, vers un hôte public ; elle est enregistrée normalisée.
 * Aucun aperçu n'est récupéré (pas de requête sortante) : le domaine s'affiche, l'icône est locale.
 */

import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { evenement } from '../evenements.mjs';
import { verifierAdresse } from '../ressources/apercu.mjs';
import { lignesParIds } from '../requetes.mjs';
import { lecteurTableaux, permissionsAuNiveau } from './acces.mjs';
import { PORTEE_CLUB, contexteCm, exiger, exigerUuid, permissionsSur, porteesDe } from './commun.mjs';

export const LIENS_MAX = 500;
export const TITRE_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const CATEGORIE_MAX = 40;
export const URL_MAX = 2048;
export const GENRES_LIAISON = Object.freeze(['carte', 'dossier']);

/** Adresse saisie → `{ url, hote }` (https, hôte public, sans identifiants) ou erreur 400 `url`. */
export function validerLien(brut) {
  const refus = () => echec(400, 'url', 'Adresse invalide : un lien https vers un site public est attendu.');
  const texte = String(brut ?? '').trim();
  if (!texte || texte.length > URL_MAX) throw refus();
  let url;
  try {
    url = verifierAdresse(texte);
  } catch {
    throw refus();
  }
  if (url.protocol !== 'https:') throw refus();
  url.hash = url.hash === '#' ? '' : url.hash;
  return { url: url.href, hote: url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') };
}

const publier = (l, teams) => ({
  id: l.id,
  titre: l.titre,
  url: l.url,
  hote: l.hote,
  description: l.description ?? '',
  categorie: l.categorie ?? null,
  epingle: Number(l.epingle) === 1,
  position: Number(l.position),
  team: l.team_id ? (teams.get(l.team_id) ?? null) : null,
  creeLe: l.cree_le,
  majLe: l.maj_le,
});

/** `drive` : service du Drive (dossiers que le compte voit). */
export function servicesLiensCm({ base, maintenant = () => Date.now(), drive }) {
  /** Lecture : `cm.voir` du club ou d'une team ; rend ce que le compte voit. */
  async function lecture(acteur) {
    const x = await porteesDe(base, acteur);
    const equipes = new Set([...x.teams].filter(([, s]) => s.has('cm.voir')).map(([id]) => id));
    const club = x.club.has('cm.voir');
    if (!club && !equipes.size) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return { club, equipes, editer: x.club.has('cm.editer'), gerer: x.club.has('cm.gerer'), noms: x.noms, portees: x };
  }

  const visible = (c, l) => c.club || !l.team_id || c.equipes.has(l.team_id);

  async function ecriture(acteur, permission) {
    const ctx = await contexteCm(base, acteur, PORTEE_CLUB);
    exiger(ctx, permission);
    return ctx;
  }

  /** Team de rattachement : une team existante (non supprimée) dont le module CM est actif, ou null. */
  async function teamValide(v) {
    if (v === null || v === undefined || v === '') return null;
    exigerUuid(v, 'team');
    const t = await base.premier("SELECT t.id FROM teams t JOIN team_modules m ON m.team_id = t.id AND m.module = 'cm' AND m.active = 1 WHERE t.id = ? AND t.supprimee_le IS NULL", [v]);
    if (!t) throw echec(404, 'team-introuvable', 'Team introuvable.');
    return t.id;
  }

  const titreDe = v => {
    const titre = texteNettoye(v, TITRE_MAX);
    if (!titre) throw echec(400, 'titre', 'Titre : obligatoire.');
    return titre;
  };
  const descriptionDe = v => String(v ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, DESCRIPTION_MAX);
  const categorieDe = v => texteNettoye(v, CATEGORIE_MAX) || null;

  /** `GET /cm/liens` : les liens visibles (épinglés d'abord, puis ordre manuel), les étiquettes en usage, les teams proposables. */
  async function lister(acteur) {
    const c = await lecture(acteur);
    const lignes = (await base.tous('SELECT * FROM cm_liens ORDER BY epingle DESC, position, cree_le, id LIMIT ?', [LIENS_MAX])).filter(l => visible(c, l));
    const teams = new Map([...c.noms].map(([id, t]) => [id, { id, nom: t.nom }]));
    const categories = [...new Set(lignes.map(l => l.categorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const liaisons = await liaisonsVisibles(acteur, c, lignes.map(l => l.id));
    return {
      liens: lignes.map(l => ({ ...publier(l, teams), liaisons: (liaisons.get(l.id) ?? { cartes: [], dossiers: [] }).cartes.length + (liaisons.get(l.id) ?? { dossiers: [] }).dossiers.length })),
      categories,
      teams: c.editer ? [...teams.values()] : [],
      droits: { editer: c.editer, gerer: c.gerer },
      max: LIENS_MAX,
    };
  }

  async function relire(id) {
    const l = await base.premier('SELECT * FROM cm_liens WHERE id = ?', [id]);
    const teams = new Map((await base.tous('SELECT id, nom FROM teams', [])).map(t => [t.id, { id: t.id, nom: t.nom }]));
    return publier(l, teams);
  }

  const evt = (type, acteur, l, t, extra = {}) => evenement(type, { teamId: l.team_id ?? null, acteur: acteur.compte, entiteType: 'cm_lien', entiteId: l.id, charge: { titre: l.titre, hote: l.hote, portee: PORTEE_CLUB, ...extra }, maintenant: t });

  /** `POST /cm/liens { titre, url, description?, categorie?, teamId?, epingle? }` (cm.editer). */
  async function creer(acteur, corps) {
    await ecriture(acteur, 'cm.editer');
    const titre = titreDe(corps?.titre);
    const { url, hote } = validerLien(corps?.url);
    const teamId = await teamValide(corps?.teamId);
    const { n, haut } = (await base.premier('SELECT COUNT(*) AS n, MAX(position) AS haut FROM cm_liens', [])) ?? {};
    if (Number(n ?? 0) >= LIENS_MAX) throw echec(409, 'trop-de-liens', `${LIENS_MAX} liens au plus.`);
    const ligne = { id: nouvelId(), team_id: teamId, titre, url, hote };
    const tt = maintenant();
    const t = iso(tt);
    await base.lot([
      {
        sql: 'INSERT INTO cm_liens (id, team_id, titre, url, hote, description, categorie, epingle, position, cree_par, cree_le, maj_par, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [ligne.id, teamId, titre, url, hote, descriptionDe(corps?.description) || null, categorieDe(corps?.categorie), corps?.epingle === true ? 1 : 0, Number(haut ?? 0) + 1024, acteur.compte, t, acteur.compte, t],
      },
      evt('cm.lien_cree', acteur, ligne, tt),
    ]);
    return { lien: await relire(ligne.id) };
  }

  async function existant(id) {
    exigerUuid(id, 'lien');
    const l = await base.premier('SELECT * FROM cm_liens WHERE id = ?', [id]);
    if (!l) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    return l;
  }

  /** `PATCH /cm/liens/:id { titre?, url?, description?, categorie?, teamId?, epingle? }` (cm.editer). */
  async function modifier(acteur, id, corps) {
    await ecriture(acteur, 'cm.editer');
    const l = await existant(id);
    const champs = {};
    if (corps?.titre !== undefined) champs.titre = titreDe(corps.titre);
    if (corps?.url !== undefined) Object.assign(champs, validerLien(corps.url));
    if (corps?.description !== undefined) champs.description = descriptionDe(corps.description) || null;
    if (corps?.categorie !== undefined) champs.categorie = categorieDe(corps.categorie);
    if (corps?.teamId !== undefined) champs.team_id = await teamValide(corps.teamId);
    if (corps?.epingle !== undefined) champs.epingle = corps.epingle === true ? 1 : 0;
    const cles = Object.keys(champs);
    if (cles.length) {
      const tt = maintenant();
      const apres = { ...l, ...champs };
      await base.lot([
        { sql: `UPDATE cm_liens SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(tt), l.id] },
        evt('cm.lien_modifie', acteur, apres, tt, champs.epingle !== undefined && Number(l.epingle) !== champs.epingle ? { epingle: champs.epingle === 1 } : {}),
      ]);
    }
    return { lien: await relire(l.id) };
  }

  /** `PUT /cm/liens/ordre { ids }` (cm.editer) : nouvel ordre manuel (les liens non cités gardent leur rang, après). */
  async function ordonner(acteur, corps) {
    await ecriture(acteur, 'cm.editer');
    const ids = Array.isArray(corps?.ids) ? corps.ids : null;
    if (!ids || ids.length > LIENS_MAX || new Set(ids).size !== ids.length) throw echec(400, 'ordre', 'Liste d’identifiants invalide.');
    for (const i of ids) exigerUuid(i, 'lien');
    const connus = new Set((await base.tous('SELECT id FROM cm_liens', [])).map(l => l.id));
    if (ids.some(i => !connus.has(i))) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    const tt = maintenant();
    await base.lot([
      ...ids.map((i, k) => ({ sql: 'UPDATE cm_liens SET position = ?, maj_par = ?, maj_le = ? WHERE id = ?', params: [(k + 1) * 1024, acteur.compte, iso(tt), i] })),
    ]);
    return lister(acteur);
  }


  // ---------------------------------------------------------------- Liaisons (cartes et dossiers du Drive)

  /**
   * Cartes (hors carte supprimée ou tableau supprimé) dont le compte voit le tableau (`cm.voir` de sa portée) parmi
   * `ids` : `Map(id → { id, titre, tableauId, tableau, portee, modifier })`. Tableau RESTREINT (migration 0046) :
   * seulement s'il en est (« peut voir » : sans droit de lier).
   */
  async function cartesAccessibles(acteur, c, ids) {
    const sortie = new Map();
    const lecteur = lecteurTableaux(base, acteur);
    const lignes = await lignesParIds(base, 'SELECT c.id, c.titre, c.tableau_id, t.nom, t.cle_defaut, t.portee, t.team_id, t.acces FROM cm_cartes c JOIN cm_tableaux t ON t.id = c.tableau_id WHERE c.supprime_le IS NULL AND t.supprime_le IS NULL AND c.id', ids);
    for (const l of lignes) {
      const niveau = await lecteur.niveau({ id: l.tableau_id, portee: l.portee, team_id: l.team_id, acces: l.acces });
      if (!niveau) continue;
      const p = permissionsAuNiveau(permissionsSur(c.portees, l.portee), niveau);
      if (!p.has('cm.voir')) continue;
      sortie.set(l.id, { id: l.id, titre: l.titre, tableauId: l.tableau_id, tableau: l.nom ?? l.cle_defaut ?? null, portee: l.portee, modifier: p.has('cm.editer') });
    }
    return sortie;
  }

  /** Liaisons visibles de chaque lien : `Map(lienId → { cartes: [...], dossiers: [...] })` (cibles que le compte voit). */
  async function liaisonsVisibles(acteur, c, lienIds) {
    const sortie = new Map();
    if (!lienIds.length) return sortie;
    const lignes = await lignesParIds(base, 'SELECT lien_id, genre, cible_id FROM cm_lien_liaisons WHERE lien_id', lienIds);
    const cartes = await cartesAccessibles(acteur, c, lignes.filter(l => l.genre === 'carte').map(l => l.cible_id));
    const dossiers = drive ? await drive.dossiersAccessibles(acteur, lignes.filter(l => l.genre === 'dossier').map(l => l.cible_id)) : new Map();
    for (const l of lignes) {
      const cible = l.genre === 'carte' ? cartes.get(l.cible_id) : dossiers.get(l.cible_id);
      if (!cible) continue;
      if (!sortie.has(l.lien_id)) sortie.set(l.lien_id, { cartes: [], dossiers: [] });
      sortie.get(l.lien_id)[l.genre === 'carte' ? 'cartes' : 'dossiers'].push(cible);
    }
    return sortie;
  }

  /** Lien visible du compte (404 sinon) : `{ c, l }`. */
  async function lienVisible(acteur, id) {
    const c = await lecture(acteur);
    exigerUuid(id, 'lien');
    const l = await base.premier('SELECT * FROM cm_liens WHERE id = ?', [id]);
    if (!l || !visible(c, l)) throw echec(404, 'lien-introuvable', 'Lien introuvable.');
    return { c, l };
  }

  /** `GET /cm/liens/:id/liaisons` : où le lien est lié (cartes et dossiers que le compte voit). */
  async function liaisons(acteur, id) {
    const { c, l } = await lienVisible(acteur, id);
    const v = (await liaisonsVisibles(acteur, c, [l.id])).get(l.id) ?? { cartes: [], dossiers: [] };
    return { cartes: v.cartes, dossiers: v.dossiers, droits: { editer: c.editer } };
  }

  /** Cible visible : `{ cible, modifier }` ou 404 ; `modifier` : le compte a le droit d'y lier ou délier un lien. */
  async function cibleVisible(acteur, c, genre, cibleId) {
    if (!GENRES_LIAISON.includes(genre)) throw echec(400, 'genre', 'Genre de liaison inconnu : carte ou dossier.');
    exigerUuid(cibleId, genre);
    const cible = (genre === 'carte' ? await cartesAccessibles(acteur, c, [cibleId]) : drive ? await drive.dossiersAccessibles(acteur, [cibleId]) : new Map()).get(cibleId);
    if (!cible) throw echec(404, `${genre}-introuvable`, genre === 'carte' ? 'Carte introuvable.' : 'Dossier introuvable.');
    return cible;
  }

  /** `POST /cm/liens/:id/liaisons { genre, cibleId }` : lie le lien à une carte ou un dossier (cm.editer du club ET droit d'écriture sur la cible). */
  async function lier(acteur, id, corps) {
    await ecriture(acteur, 'cm.editer');
    const { c, l } = await lienVisible(acteur, id);
    const cible = await cibleVisible(acteur, c, corps?.genre, corps?.cibleId);
    if (!cible.modifier) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const tt = maintenant();
    await base.lot([
      { sql: 'INSERT INTO cm_lien_liaisons (lien_id, genre, cible_id, cree_par, cree_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', params: [l.id, corps.genre, cible.id, acteur.compte, iso(tt)] },
      evt('cm.lien_lie', acteur, l, tt, { genre: corps.genre }),
    ]);
    return liaisons(acteur, l.id);
  }

  /** `DELETE /cm/liens/:id/liaisons/:genre/:cibleId` : délie (mêmes droits que `lier`). */
  async function delier(acteur, id, genre, cibleId) {
    await ecriture(acteur, 'cm.editer');
    const { c, l } = await lienVisible(acteur, id);
    const cible = await cibleVisible(acteur, c, genre, cibleId);
    if (!cible.modifier) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const tt = maintenant();
    await base.lot([{ sql: 'DELETE FROM cm_lien_liaisons WHERE lien_id = ? AND genre = ? AND cible_id = ?', params: [l.id, genre, cible.id] }, evt('cm.lien_delie', acteur, l, tt, { genre })]);
    return liaisons(acteur, l.id);
  }

  /** `GET /cm/liens/cible/:genre/:id` : liens liés à une carte ou à un dossier que le compte voit (et peut-il en lier). */
  async function liensDe(acteur, genre, cibleId) {
    const c = await lecture(acteur);
    const cible = await cibleVisible(acteur, c, genre, cibleId);
    const lignes = (await base.tous('SELECT l.* FROM cm_liens l JOIN cm_lien_liaisons x ON x.lien_id = l.id WHERE x.genre = ? AND x.cible_id = ? ORDER BY l.epingle DESC, l.position, l.cree_le, l.id', [genre, cible.id])).filter(l => visible(c, l));
    const teams = new Map([...c.noms].map(([i, t]) => [i, { id: i, nom: t.nom }]));
    return { liens: lignes.map(l => publier(l, teams)), droits: { lier: c.editer && cible.modifier, creer: c.editer } };
  }

  /** `DELETE /cm/liens/:id` (cm.gerer) : le lien est délié partout. */
  async function supprimer(acteur, id) {
    await ecriture(acteur, 'cm.gerer');
    const l = await existant(id);
    await base.lot([{ sql: 'DELETE FROM cm_lien_liaisons WHERE lien_id = ?', params: [l.id] }, { sql: 'DELETE FROM cm_liens WHERE id = ?', params: [l.id] }, evt('cm.lien_supprime', acteur, l, maintenant())]);
    return { ok: true };
  }

  return { lister, creer, modifier, ordonner, supprimer, liaisons, lier, delier, liensDe };
}
