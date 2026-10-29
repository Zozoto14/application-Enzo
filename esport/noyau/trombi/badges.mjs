/**
 * Badges du trombinoscope (migration 0032) : rôles personnalisés affichés sous le pseudo (« Capitaine », « IGL »,
 * « Streamer »…), sur les cartes et en haut de la fiche.
 *
 *  - CATALOGUE du club (nom unique, couleur, icône / emoji facultative, ordre) : le Fondateur et les comptes
 *    affectés « pour le club » à un rôle CM qui porte `membres.badges.gerer` (par défaut le Responsable CM).
 *  - ATTRIBUTION (globale au club, ou rattachée à une team : « Capitaine · Team ») : les mêmes pour tout le club ;
 *    un rôle de team qui porte la permission (par défaut le Manager ; le Propriétaire) ou une affectation CM de
 *    team, pour les membres de CETTE team. Personne ne s'attribue (ni ne se retire) un badge, sauf le Fondateur.
 *  - Badges AUTOMATIQUES (colonne `auto`) : « CEO » pour le compte Fondateur, « Second CEO » pour les titulaires du
 *    rôle du club « Second CEO » (migration 0033, portée club), « Responsable CM » /
 *    « Correspondant CM » pour les affectations aux rôles CM système (pour le club, ou pour une team : badge
 *    rattaché à la team). Calculés à la lecture : ils suivent le rôle. Ni attribués ni retirés à la main ;
 *    `auto_actif` = 0 les éteint (le badge reste au catalogue, attribuable à personne).
 *  - Badges RÉSERVÉS AU FONDATEUR (colonne `reserve`, par défaut « Second CEO », automatique depuis la migration 0033) : seul le Fondateur les
 *    attribue, les retire, les modifie, les supprime ou change cette option ; les autres gestionnaires ne les
 *    voient que (ils restent intacts quand un Manager remet la liste des badges d'un membre).
 *
 * Journal (bus, SANS team comme le reste du trombinoscope) : création, modification, suppression d'un badge,
 * attribution et retrait (compte concerné, badge, portée).
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { CLE_PROPRIETAIRE } from '../permissions.mjs';
import { PERMISSION_BADGES } from './permissions.mjs';

export { PERMISSION_BADGES };
export const AUTOS_BADGES = Object.freeze(['fondateur', 'second-ceo', 'cm-responsable', 'cm-correspondant']);
export const PORTEE_CLUB = 'club';
export const MAX_BADGES = Object.freeze({ catalogue: 80, parMembre: 20, lot: 200, nom: 32, icone: 16 });

const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;
const MOTIF_ID = /^[a-z0-9-]{1,64}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const COMPTE_FONDATEUR = 'principal';
const AUTO_CM = Object.freeze({ responsable: 'cm-responsable', correspondant: 'cm-correspondant' });

const interdit = () => echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
const reserveFondateur = () => echec(403, 'badge-reserve', 'Badge réservé au Fondateur.');
const cleNom = nom => nom.toLocaleLowerCase('fr');

/** Champs d'un badge (création : nom et couleur obligatoires ; modification : ceux fournis). */
export function lireBadge(corps, { partiel = false } = {}) {
  if (!corps || typeof corps !== 'object') throw echec(400, 'corps', 'Requête illisible.');
  const sortie = {};
  if (!partiel || corps.nom !== undefined) {
    const nom = texteNettoye(corps.nom, MAX_BADGES.nom);
    if (!nom) throw echec(400, 'badge-nom', 'Donnez un nom au badge.');
    sortie.nom = nom;
  }
  if (!partiel || corps.couleur !== undefined) {
    if (typeof corps.couleur !== 'string' || !MOTIF_COULEUR.test(corps.couleur)) throw echec(400, 'badge-couleur', 'Couleur invalide (#rrggbb).');
    sortie.couleur = corps.couleur.toLowerCase();
  }
  if (corps.icone !== undefined) {
    const icone = texteNettoye(corps.icone, 64);
    // Un emoji ou un symbole court (pas une phrase) : quelques caractères, sans espace.
    if ([...icone].length > 4 || icone.length > MAX_BADGES.icone || /\s/.test(icone)) throw echec(400, 'badge-icone', 'Icône trop longue : un emoji ou un symbole.');
    sortie.icone = icone;
  }
  if (corps.reserve !== undefined) {
    if (typeof corps.reserve !== 'boolean') throw echec(400, 'badge-reserve', 'Valeur illisible.');
    sortie.reserve = corps.reserve;
  }
  if (corps.autoActif !== undefined) {
    if (typeof corps.autoActif !== 'boolean') throw echec(400, 'badge-auto', 'Valeur illisible.');
    sortie.autoActif = corps.autoActif;
  }
  return sortie;
}

/** Ordre d'affichage : position du catalogue, puis nom. */
export const trierBadges = liste => [...liste].sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id));

const versBadge = l => ({ id: l.id, nom: l.nom, couleur: l.couleur, icone: l.icone ?? '', position: Number(l.position), auto: l.auto ?? null, autoActif: Number(l.auto_actif) === 1, reserve: Number(l.reserve) === 1 });

/**
 * Badges affichés d'une carte : attributions (manuelles et automatiques) en objets d'affichage, dans l'ordre du
 * catalogue. Un badge de team n'est montré que si la team est visible (`teams` : Map id → nom) ; un badge global
 * masque le même badge rattaché à une team.
 */
export function badgesAffiches(attributions, catalogue, teams) {
  const parId = new Map(catalogue.map(b => [b.id, b]));
  const globaux = new Set(attributions.filter(a => a.portee === PORTEE_CLUB).map(a => a.badge));
  const vus = new Set();
  const sortie = [];
  for (const a of attributions) {
    const b = parId.get(a.badge);
    if (!b) continue;
    if (a.portee !== PORTEE_CLUB && (globaux.has(a.badge) || !teams.has(a.portee))) continue;
    const cle = `${a.badge}|${a.portee}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    sortie.push({ id: b.id, nom: b.nom, couleur: b.couleur, icone: b.icone, auto: a.auto === true, teamId: a.portee === PORTEE_CLUB ? null : a.portee, teamNom: a.portee === PORTEE_CLUB ? null : teams.get(a.portee) });
  }
  const rang = new Map(trierBadges(catalogue).map((b, i) => [b.id, i]));
  return sortie.sort((x, y) => rang.get(x.id) - rang.get(y.id) || (x.teamNom ?? '').localeCompare(y.teamNom ?? '', 'fr'));
}

/** Libellé d'un badge pour un texte (« Capitaine · Team Alpha »). */
export const libelleBadge = b => `${b.icone ? `${b.icone} ` : ''}${b.nom}${b.teamNom ? ` · ${b.teamNom}` : ''}`;

export function servicesBadges({ base, maintenant = () => Date.now() }) {
  // ---------------------------------------------------------------- Droits

  /** `{ tout, club, teams: Set<teamId> }` : `club` gère le catalogue et attribue partout ; `teams` : membres de ces teams. */
  async function droits(acteur) {
    if (acteur.superAdmin) return { tout: true, club: true, teams: new Set() };
    const club = await base.premier(
      // Permissions du club (vue de la migration 0033) : affectation CM « club » ou rôle du club (Second CEO…).
      'SELECT compte_id FROM permissions_club WHERE compte_id = ? AND permission = ?',
      [acteur.compte, PERMISSION_BADGES],
    );
    const membres = await base.tous(
      `SELECT m.team_id, r.cle_systeme, rp.permission FROM membres m JOIN teams t ON t.id = m.team_id AND t.supprimee_le IS NULL JOIN roles r ON r.id = m.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = ?
        WHERE m.compte_id = ? AND m.statut = 'actif'`,
      [PERMISSION_BADGES, acteur.compte],
    );
    const membre = new Set(membres.map(m => m.team_id));
    const teams = new Set(membres.filter(m => m.cle_systeme === CLE_PROPRIETAIRE || m.permission).map(m => m.team_id));
    const aff = await base.tous(
      "SELECT a.portee FROM cm_affectations a JOIN cm_role_permissions rp ON rp.role_id = a.role_id WHERE a.compte_id = ? AND a.portee <> 'club' AND rp.permission = ?",
      [acteur.compte, PERMISSION_BADGES],
    );
    for (const a of aff) if (membre.has(a.portee)) teams.add(a.portee);
    return { tout: false, club: Boolean(club), teams };
  }

  /** Résumé pour l'app : `gerer` (catalogue), `attribuer` (au moins quelqu'un), `fondateur` (badges réservés). */
  const resume = d => ({ gerer: d.club, attribuer: d.club || d.teams.size > 0, fondateur: d.tout });

  /** Teams actives (non supprimées) d'un compte. */
  async function teamsDe(compte) {
    return (await base.tous("SELECT m.team_id FROM membres m JOIN teams t ON t.id = m.team_id AND t.supprimee_le IS NULL WHERE m.compte_id = ? AND m.statut = 'actif'", [compte])).map(l => l.team_id);
  }

  /** Portées où l'acteur peut attribuer / retirer un badge à `compte` (403 sinon, et toujours pour soi-même). */
  async function porteesPermises(acteur, d, compte) {
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte) || !(await base.premier('SELECT id FROM comptes WHERE id = ?', [compte]))) throw echec(404, 'fiche-introuvable', 'Fiche introuvable.');
    if (compte === acteur.compte && !d.tout) throw echec(403, 'badge-soi', 'On ne s’attribue pas de badge soi-même.');
    const teams = await teamsDe(compte);
    if (d.club) return new Set([PORTEE_CLUB, ...teams]);
    const communes = teams.filter(t => d.teams.has(t));
    if (!communes.length) throw interdit();
    return new Set([PORTEE_CLUB, ...communes]);
  }

  // ---------------------------------------------------------------- Lectures

  async function catalogue() {
    return trierBadges((await base.tous('SELECT * FROM trombi_badges', [])).map(versBadge));
  }

  /**
   * Attributions des comptes (`Map compte → [{ badge, portee, auto }]`) : manuelles, puis automatiques (badges
   * `auto` actifs : compte Fondateur, affectations aux rôles CM système).
   */
  async function attributions(comptes, cat) {
    const sortie = new Map(comptes.map(c => [c, []]));
    if (!comptes.length) return sortie;
    for (const l of await lignesParIds(base, 'SELECT badge_id, compte_id, portee FROM trombi_badges_membres WHERE compte_id', comptes)) sortie.get(l.compte_id)?.push({ badge: l.badge_id, portee: l.portee, auto: false });
    const autos = new Map(cat.filter(b => b.auto && b.autoActif).map(b => [b.auto, b.id]));
    if (autos.has('fondateur') && sortie.has(COMPTE_FONDATEUR)) sortie.get(COMPTE_FONDATEUR).push({ badge: autos.get('fondateur'), portee: PORTEE_CLUB, auto: true });
    // « Second CEO » (migration 0033) : les titulaires du rôle du club « Second CEO », pour tout le club.
    if (autos.has('second-ceo')) {
      const tit = await lignesParIds(base, "SELECT a.compte_id FROM roles_globaux_affectations a JOIN roles_globaux r ON r.id = a.role_id WHERE r.cle_systeme = 'second_ceo' AND a.compte_id", comptes);
      for (const a of tit) sortie.get(a.compte_id)?.push({ badge: autos.get('second-ceo'), portee: PORTEE_CLUB, auto: true });
    }
    if (autos.has('cm-responsable') || autos.has('cm-correspondant')) {
      const aff = await lignesParIds(base, "SELECT a.compte_id, a.portee, r.cle_systeme FROM cm_affectations a JOIN cm_roles r ON r.id = a.role_id WHERE r.cle_systeme IN ('responsable', 'correspondant') AND a.compte_id", comptes);
      for (const a of aff) {
        const id = autos.get(AUTO_CM[a.cle_systeme]);
        if (id) sortie.get(a.compte_id)?.push({ badge: id, portee: a.portee === 'club' ? PORTEE_CLUB : a.portee, auto: true });
      }
    }
    return sortie;
  }

  /** `GET /trombi/badges` : catalogue (avec le nombre de membres qui portent chaque badge à la main) et droits. */
  async function lister(acteur) {
    const d = await droits(acteur);
    const cat = await catalogue();
    const n = new Map((await base.tous('SELECT badge_id, COUNT(DISTINCT compte_id) AS n FROM trombi_badges_membres GROUP BY badge_id', [])).map(l => [l.badge_id, Number(l.n)]));
    return { droits: resume(d), badges: cat.map(b => ({ ...b, membres: n.get(b.id) ?? 0 })) };
  }

  // ---------------------------------------------------------------- Catalogue

  async function exigerClub(acteur) {
    const d = await droits(acteur);
    if (!d.club) throw interdit();
    return d;
  }

  async function badgeLigne(id) {
    if (typeof id !== 'string' || !MOTIF_ID.test(id)) throw echec(404, 'badge-introuvable', 'Badge introuvable.');
    const l = await base.premier('SELECT * FROM trombi_badges WHERE id = ?', [id]);
    if (!l) throw echec(404, 'badge-introuvable', 'Badge introuvable.');
    return versBadge(l);
  }

  async function nomLibre(nom, sauf = null) {
    const l = await base.premier('SELECT id FROM trombi_badges WHERE nom_cle = ?', [cleNom(nom)]);
    if (l && l.id !== sauf) throw echec(409, 'badge-doublon', 'Un badge porte déjà ce nom.');
  }

  async function creer(acteur, corps) {
    await exigerClub(acteur);
    const b = lireBadge(corps);
    if (b.reserve && !acteur.superAdmin) throw reserveFondateur();
    await nomLibre(b.nom);
    const n = await base.premier('SELECT COUNT(*) AS n, MAX(position) AS p FROM trombi_badges', []);
    if (Number(n.n) >= MAX_BADGES.catalogue) throw echec(400, 'badge-max', `${MAX_BADGES.catalogue} badges au plus.`);
    const id = nouvelId();
    const t = maintenant();
    await base.lot([
      { sql: 'INSERT INTO trombi_badges (id, nom, nom_cle, couleur, icone, position, auto, auto_actif, reserve, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)', params: [id, b.nom, cleNom(b.nom), b.couleur, b.icone ?? '', n.p === null || n.p === undefined ? 0 : Number(n.p) + 1, b.reserve ? 1 : 0, acteur.compte, iso(t), iso(t)] },
      evenement('trombi.badge_cree', { acteur: acteur.compte, entiteType: 'trombi_badge', entiteId: id, charge: { badge: id, nom: b.nom }, maintenant: t }),
    ]);
    return lister(acteur);
  }

  async function modifierBadge(acteur, id, corps) {
    await exigerClub(acteur);
    const actuel = await badgeLigne(id);
    const b = lireBadge(corps, { partiel: true });
    if ((actuel.reserve || b.reserve !== undefined) && !acteur.superAdmin) throw reserveFondateur();
    if (b.autoActif !== undefined && !actuel.auto) throw echec(400, 'badge-auto', 'Ce badge n’est pas automatique.');
    if (b.nom !== undefined) await nomLibre(b.nom, id);
    const n = { ...actuel, ...b };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE trombi_badges SET nom = ?, nom_cle = ?, couleur = ?, icone = ?, auto_actif = ?, reserve = ?, maj_le = ? WHERE id = ?', params: [n.nom, cleNom(n.nom), n.couleur, n.icone, n.autoActif ? 1 : 0, n.reserve ? 1 : 0, iso(t), id] },
      evenement('trombi.badge_modifie', { acteur: acteur.compte, entiteType: 'trombi_badge', entiteId: id, charge: { badge: id, nom: n.nom, champs: Object.keys(b) }, maintenant: t }),
    ]);
    return lister(acteur);
  }

  /** Suppression DÉFINITIVE : le badge est retiré de tous les membres. Rend `{ retires }` (membres concernés). */
  async function supprimerBadge(acteur, id) {
    await exigerClub(acteur);
    const b = await badgeLigne(id);
    if (b.reserve && !acteur.superAdmin) throw reserveFondateur();
    const n = Number((await base.premier('SELECT COUNT(DISTINCT compte_id) AS n FROM trombi_badges_membres WHERE badge_id = ?', [id])).n);
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM trombi_badges_membres WHERE badge_id = ?', params: [id] },
      { sql: 'DELETE FROM trombi_badges WHERE id = ?', params: [id] },
      evenement('trombi.badge_supprime', { acteur: acteur.compte, entiteType: 'trombi_badge', entiteId: id, charge: { badge: id, nom: b.nom, retires: n }, maintenant: t }),
    ]);
    return { ...(await lister(acteur)), retires: n };
  }

  /** `PUT /trombi/badges/ordre` `{ ids }` : tous les badges du catalogue, dans l'ordre voulu. */
  async function ordonner(acteur, corps) {
    await exigerClub(acteur);
    const ids = corps?.ids;
    const cat = await catalogue();
    if (!Array.isArray(ids) || ids.length !== cat.length || new Set(ids).size !== ids.length || ids.some(i => !cat.some(b => b.id === i))) throw echec(400, 'badge-ordre', 'Ordre illisible : donnez tous les badges, une fois chacun.');
    const t = iso(maintenant());
    await base.lot(ids.map((id, i) => ({ sql: 'UPDATE trombi_badges SET position = ?, maj_le = ? WHERE id = ?', params: [i, t, id] })));
    return lister(acteur);
  }

  // ---------------------------------------------------------------- Attributions

  function lireAttributions(v, cat) {
    if (!Array.isArray(v) || v.length > MAX_BADGES.parMembre) throw echec(400, 'badges', `Liste illisible (${MAX_BADGES.parMembre} badges au plus).`);
    const sortie = new Map();
    for (const x of v) {
      const id = typeof x === 'string' ? x : x?.id;
      const portee = typeof x === 'string' || x?.portee === undefined || x?.portee === null ? PORTEE_CLUB : x.portee;
      const b = cat.find(c => c.id === id);
      if (!b) throw echec(400, 'badge-inconnu', 'Badge inconnu.');
      if (b.auto) throw echec(400, 'badge-auto', 'Ce badge est automatique : il suit le rôle du club.');
      if (typeof portee !== 'string') throw echec(400, 'badge-portee', 'Portée illisible.');
      sortie.set(`${id}|${portee}`, { badge: id, portee });
    }
    return [...sortie.values()];
  }

  /** Instructions d'ajout / de retrait (et leurs événements). */
  function ecritures(acteur, compte, ajouts, retraits, cat, t) {
    const nom = id => cat.find(b => b.id === id)?.nom ?? '';
    return [
      ...retraits.flatMap(a => [
        { sql: 'DELETE FROM trombi_badges_membres WHERE badge_id = ? AND compte_id = ? AND portee = ?', params: [a.badge, compte, a.portee] },
        evenement('trombi.badge_retire', { acteur: acteur.compte, entiteType: 'trombi_badge', entiteId: a.badge, charge: { compte, badge: a.badge, nom: nom(a.badge), portee: a.portee }, maintenant: t }),
      ]),
      ...ajouts.flatMap(a => [
        { sql: 'INSERT INTO trombi_badges_membres (badge_id, compte_id, portee, attribue_par, attribue_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', params: [a.badge, compte, a.portee, acteur.compte, iso(t)] },
        evenement('trombi.badge_attribue', { acteur: acteur.compte, entiteType: 'trombi_badge', entiteId: a.badge, charge: { compte, badge: a.badge, nom: nom(a.badge), portee: a.portee }, maintenant: t }),
      ]),
    ];
  }

  /**
   * `PUT /trombi/fiches/:compte/badges` `{ badges: [{ id, portee? }] }` : les badges MANUELS du membre, dans les
   * portées de l'acteur (les autres attributions restent). Portée : 'club' (défaut) ou une team du membre.
   */
  async function attribuer(acteur, compte, corps) {
    const d = await droits(acteur);
    const permises = await porteesPermises(acteur, d, compte);
    const cat = await catalogue();
    const voulues = lireAttributions(corps?.badges, cat);
    // Badges réservés au Fondateur : hors du périmètre des autres (ni ajoutés, ni retirés).
    const reserves = new Set(d.tout ? [] : cat.filter(b => b.reserve).map(b => b.id));
    if (voulues.some(a => reserves.has(a.badge))) throw reserveFondateur();
    for (const a of voulues) if (!permises.has(a.portee)) throw echec(403, 'badge-portee', 'Cette team n’est pas dans votre périmètre, ou le membre n’en fait pas partie.');
    const actuelles = (await base.tous('SELECT badge_id, portee FROM trombi_badges_membres WHERE compte_id = ?', [compte])).map(l => ({ badge: l.badge_id, portee: l.portee }));
    const cle = a => `${a.badge}|${a.portee}`;
    const gerable = a => permises.has(a.portee) && !reserves.has(a.badge);
    const gardees = actuelles.filter(a => !gerable(a));
    if (gardees.length + voulues.length > MAX_BADGES.parMembre) throw echec(400, 'badges', `${MAX_BADGES.parMembre} badges au plus par membre.`);
    const retraits = actuelles.filter(a => gerable(a) && !voulues.some(v => cle(v) === cle(a)));
    const ajouts = voulues.filter(v => !actuelles.some(a => cle(a) === cle(v)));
    if (retraits.length || ajouts.length) await base.lot(ecritures(acteur, compte, ajouts, retraits, cat, maintenant()));
    return { ajoutes: ajouts.length, retires: retraits.length };
  }

  /**
   * `POST /trombi/badges/:id/membres` `{ comptes, portee?, retirer? }` : un badge à plusieurs membres d'un coup
   * (ou retiré). Tout ou rien : 403 si un seul membre est hors du périmètre (ou l'acteur lui-même).
   */
  async function attribuerLot(acteur, id, corps) {
    const d = await droits(acteur);
    const b = await badgeLigne(id);
    if (b.auto) throw echec(400, 'badge-auto', 'Ce badge est automatique : il suit le rôle du club.');
    if (b.reserve && !d.tout) throw reserveFondateur();
    const comptes = corps?.comptes;
    if (!Array.isArray(comptes) || !comptes.length || comptes.length > MAX_BADGES.lot || comptes.some(c => typeof c !== 'string')) throw echec(400, 'comptes', 'Liste de membres illisible.');
    const portee = corps.portee ?? PORTEE_CLUB;
    if (typeof portee !== 'string') throw echec(400, 'badge-portee', 'Portée illisible.');
    const retirer = corps.retirer === true;
    const cat = await catalogue();
    const lot = [];
    const t = maintenant();
    let n = 0;
    for (const compte of new Set(comptes)) {
      const permises = await porteesPermises(acteur, d, compte);
      if (!permises.has(portee)) throw echec(403, 'badge-portee', 'Cette team n’est pas dans votre périmètre, ou le membre n’en fait pas partie.');
      const a = { badge: id, portee };
      const existe = await base.premier('SELECT badge_id FROM trombi_badges_membres WHERE badge_id = ? AND compte_id = ? AND portee = ?', [id, compte, portee]);
      if (retirer ? !existe : existe) continue;
      if (!retirer && Number((await base.premier('SELECT COUNT(*) AS n FROM trombi_badges_membres WHERE compte_id = ?', [compte])).n) >= MAX_BADGES.parMembre) throw echec(400, 'badges', `${MAX_BADGES.parMembre} badges au plus par membre.`);
      lot.push(...ecritures(acteur, compte, retirer ? [] : [a], retirer ? [a] : [], cat, t));
      n++;
    }
    if (lot.length) await base.lot(lot);
    return { modifies: n };
  }

  return { droits, resume, catalogue, attributions, lister, creer, modifierBadge, supprimerBadge, ordonner, attribuer, attribuerLot };
}
