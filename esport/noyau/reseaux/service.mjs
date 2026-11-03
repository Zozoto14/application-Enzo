/**
 * Page « Réseaux » de l'espace CM (migration 0026 ; docs/esport/reseaux-stats.md).
 *
 *  - comptes du club et des teams (réseau, identifiant @, adresse du profil vérifiée, team, actif) ;
 *  - bot d'annonce Discord par compte : salons cibles (salon d'une team, salon du club), modèles anglais /
 *    français à variables, rôle à mentionner, aperçu, message de test (annonces.mjs pour l'envoi) ;
 *  - statistiques saisies à la main (V1) : relevés datés par publication et par compte, tableau de bord, import CSV
 *    (colonnes mappables) et export CSV (formules neutralisées) ; adaptateurs d'API plus tard (adaptateurs.mjs).
 *
 * Droits : commun.mjs (cm.voir pour consulter, cm.editer pour saisir, cm.gerer du club pour configurer).
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteNettoye } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { MOTIF_UUID } from '../cm/commun.mjs';
import { lecteurTableaux } from '../cm/acces.mjs';
import { chiffrerWebhook, finDeWebhook, masquerWebhook, validerUrlWebhook } from '../discord/chiffrement.mjs';
import { appelerDiscord, modulesActifs } from '../discord/file.mjs';
import { construireCharge, lireRoleMention, texteCharge } from '../discord/messages.mjs';
import { texte as T } from '../langues.mjs';
import { CsvInvalide, ecrireCsv, lireCsv } from '../sponsors/regles.mjs';
import { RESEAUX } from '../cm/reseaux.mjs';
import { VARIABLES_ANNONCE, chargeAnnonce, envoyerTest, lireReglagesReseaux, modeleDefaut, resoudreCible, validerModeleAnnonce, variablesAnnonce } from './annonces.mjs';
import { instructionReleve } from './adaptateurs.mjs';
import { droitsReseaux, exigerGerer, exigerSur, peutSur, teamsVisibles } from './commun.mjs';
import {
  CHAMPS_IMPORT_COMPTES,
  CHAMPS_IMPORT_POSTS,
  CLES_RESEAUX_COMPTES,
  METRIQUES_COMPTE,
  METRIQUES_POST,
  RESEAUX_COMPTES,
  TYPES_CONTENU,
  ajouterJours,
  baseEngagement,
  cleUrl,
  compteDuPost,
  correspondanceProposee,
  dernierReleve,
  ecartJours,
  estVideo,
  evolutionAbonnes,
  evolutionPost,
  interactions,
  jourDans,
  lireIdentifiant,
  lireJour,
  lireReseau,
  lireTypeContenu,
  memeIdentifiant,
  nomApi,
  normaliserMetriques,
  reseauDeUrl,
  tauxEngagement,
  tauxEngagementGlobal,
  validerUrlProfil,
  validerUrlPublication,
} from './regles.mjs';

const MAX_COMPTES = 100;
const MAX_SALONS = 20;
const MAX_CIBLES = 10;
const MAX_PUBLICATIONS_LISTE = 300;
const MAX_RELEVES = 400;
const MAX_IMPORT_OCTETS = 1024 * 1024;
const INTERVALLE_TEST_MS = 10_000;
const PERIODE_MAX_JOURS = 366;
const FUSEAU = 'Europe/Paris';

const exigerUuid = (v, quoi) => {
  if (typeof v !== 'string' || !MOTIF_UUID.test(v)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return v;
};
const booleen = (v, repli) => (v === undefined ? repli : v ? 1 : 0);

export function servicesReseaux({ base, maintenant = () => Date.now(), cle, fetch: fetchDiscord, jetonBot, lienApp = '' }) {
  const ev = (type, acteur, entiteType, entiteId, charge, t) => evenement(type, { teamId: null, acteur: acteur.compte, entiteType, entiteId, charge, maintenant: t });
  const aujourdhui = () => jourDans(maintenant(), FUSEAU);

  // ---------------------------------------------------------------- Lectures communes

  async function teamsConnues(ids) {
    return new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE supprimee_le IS NULL AND id', ids.filter(Boolean))).map(t => [t.id, t.nom]));
  }

  async function compteLigne(id) {
    exigerUuid(id, 'compte');
    const c = await base.premier('SELECT * FROM cm_rs_comptes WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!c) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    return c;
  }

  /** Compte visible par l'acteur (404 sinon : on ne dit pas qu'il existe). */
  async function compteVisible(d, id, permission = 'cm.voir') {
    const c = await compteLigne(id);
    if (!peutSur(d, 'cm.voir', c.team_id)) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    if (permission !== 'cm.voir') exigerSur(d, permission, c.team_id);
    return c;
  }

  async function publicationVisible(d, id, permission = 'cm.voir') {
    exigerUuid(id, 'publication');
    const p = await base.premier('SELECT * FROM cm_rs_publications WHERE id = ? AND supprime_le IS NULL', [id]);
    if (!p || !peutSur(d, 'cm.voir', p.team_id)) throw echec(404, 'publication-introuvable', 'Publication introuvable.');
    if (permission !== 'cm.voir') exigerSur(d, permission, p.team_id);
    return p;
  }

  async function team(teamId) {
    if (teamId === undefined || teamId === null || teamId === '') return null;
    exigerUuid(teamId, 'team');
    const t = await base.premier('SELECT id, nom FROM teams WHERE id = ? AND supprimee_le IS NULL', [teamId]);
    if (!t) throw echec(400, 'team', 'Team inconnue.');
    return t.id;
  }

  async function cibles(compteId) {
    return (await base.tous('SELECT * FROM cm_rs_cibles WHERE compte_id = ? ORDER BY cle', [compteId])).map(c => ({ cle: c.cle, genre: c.genre, teamId: c.team_id ?? null, salonId: c.salon_id ?? null }));
  }

  async function comptePublic(c, { gerer, releves }) {
    const dernier = releves?.get(c.id) ?? null;
    return {
      id: c.id,
      reseau: c.reseau,
      identifiant: c.identifiant,
      url: c.url,
      nom: c.nom,
      teamId: c.team_id ?? null,
      actif: Number(c.actif) === 1,
      dernierReleve: dernier ? { jour: dernier.jour, abonnes: dernier.abonnes ?? null } : null,
      ...(gerer
        ? {
            annonce: {
              active: Number(c.annonce_active) === 1,
              modeleEn: c.modele_en ?? null,
              modeleFr: c.modele_fr ?? null,
              roleMention: c.role_mention ?? null,
              cibles: await cibles(c.id),
              dernierTest: c.dernier_test_le ?? null,
            },
          }
        : {}),
    };
  }

  const salonPublic = s => ({
    id: s.id,
    nom: s.nom,
    masque: masquerWebhook(s.fin),
    filFr: Number(s.fil_fr) === 1,
    langue: s.langue,
    dernierSucces: s.dernier_succes_le ?? null,
    dernierEchec: s.dernier_echec_le ?? null,
    invalide: Boolean(s.invalide_le),
    dernierTest: s.dernier_test_le ?? null,
  });

  /** Comptes visibles (filtre : réseau, team) avec leur dernier relevé. */
  async function comptesVisibles(d, { reseau, teamId } = {}) {
    const visibles = teamsVisibles(d);
    const lignes = (await base.tous('SELECT * FROM cm_rs_comptes WHERE supprime_le IS NULL ORDER BY position, reseau, identifiant', [])).filter(
      c => (visibles === null || (c.team_id && visibles.includes(c.team_id))) && (!reseau || c.reseau === reseau) && (teamId === undefined || (teamId === 'club' ? !c.team_id : c.team_id === teamId)),
    );
    return lignes;
  }

  async function derniersRelevesComptes(ids) {
    const lignes = await lignesParIds(base, 'SELECT * FROM cm_rs_releves_comptes WHERE compte_id', ids, { apres: ' ORDER BY jour' });
    const m = new Map();
    for (const r of lignes) m.set(r.compte_id, r);
    return m;
  }

  // ---------------------------------------------------------------- Page

  /** `GET /cm/reseaux` : comptes, salons du club et teams cibles (gestionnaire), catalogue, réglages, droits. */
  async function etat(acteur) {
    const d = await droitsReseaux(base, acteur);
    const gerer = d.club.has('cm.gerer');
    const comptes = await comptesVisibles(d);
    const releves = await derniersRelevesComptes(comptes.map(c => c.id));
    const sortie = [];
    for (const c of comptes) sortie.push(await comptePublic(c, { gerer, releves }));
    // Teams proposées : celles que l'acteur voit (filtres), et pour le gestionnaire l'état Discord de chacune.
    const teams = [];
    const toutes = gerer ? await base.tous('SELECT id, nom FROM teams WHERE supprimee_le IS NULL AND archivee_le IS NULL ORDER BY nom', []) : [...d.noms.values()].filter(t => d.teams.get(t.id)?.has('cm.voir')).map(t => ({ id: t.id, nom: t.nom }));
    for (const t of toutes) {
      if (!gerer) {
        teams.push({ id: t.id, nom: t.nom });
        continue;
      }
      const discord = (await modulesActifs(base, t.id)).has('discord');
      const bot = discord ? await base.premier('SELECT salon_nom FROM discord_serveurs WHERE team_id = ?', [t.id]) : null;
      const webhook = discord && !bot ? await base.premier('SELECT invalide_le FROM discord_webhooks WHERE team_id = ?', [t.id]) : null;
      teams.push({ id: t.id, nom: t.nom, discord: bot ? 'bot' : webhook ? 'webhook' : discord ? 'sans' : 'module' });
    }
    return {
      droits: { voir: true, editer: d.club.has('cm.editer') || [...d.teams.values()].some(s => s.has('cm.editer')), gerer, club: d.club.has('cm.voir') },
      reseaux: CLES_RESEAUX_COMPTES.map(r => ({ cle: r, nom: RESEAUX_COMPTES[r].nom, couleur: RESEAUX_COMPTES[r].couleur, glyphe: RESEAUX_COMPTES[r].glyphe, posts: r in RESEAUX })),
      typesContenu: [...TYPES_CONTENU],
      variables: [...VARIABLES_ANNONCE],
      modelesDefaut: { en: modeleDefaut('en'), fr: modeleDefaut('fr') },
      comptes: sortie,
      teams,
      ...(gerer ? { salons: (await base.tous('SELECT * FROM cm_rs_salons ORDER BY nom', [])).map(salonPublic), reglages: await lireReglagesReseaux(base), bot: Boolean(jetonBot) } : {}),
    };
  }

  // ---------------------------------------------------------------- Comptes

  function lireReseauCompte(v) {
    if (!CLES_RESEAUX_COMPTES.includes(v)) throw echec(400, 'reseau', 'Réseau inconnu.');
    return v;
  }

  /** Adresse et identifiant cohérents : l'identifiant saisi doit être celui de l'adresse (quand elle en porte un). */
  function profil(reseau, url, identifiant) {
    const p = validerUrlProfil(url, reseau);
    if (p.erreur) throw echec(400, 'url-profil', `Adresse du profil invalide : https:// sur ${RESEAUX_COMPTES[reseau].hotes.join(' ou ')}, page du compte.`);
    if (identifiant === undefined || identifiant === null || identifiant === '') return { url: p.url, identifiant: p.identifiant };
    const id = lireIdentifiant(String(identifiant), reseau);
    if (!id) throw echec(400, 'identifiant', 'Identifiant invalide pour ce réseau.');
    if (p.identifiant && !memeIdentifiant(p.identifiant, id)) throw echec(400, 'identifiant', 'L’identifiant ne correspond pas à l’adresse du profil.');
    return { url: p.url, identifiant: id };
  }

  async function doublon(reseau, identifiant, sauf = null) {
    const memes = await base.tous('SELECT id, identifiant FROM cm_rs_comptes WHERE reseau = ? AND supprime_le IS NULL', [reseau]);
    if (memes.some(c => c.id !== sauf && memeIdentifiant(c.identifiant, identifiant))) throw echec(409, 'compte-existe', 'Ce compte est déjà enregistré.');
  }

  /** `POST /cm/reseaux/comptes` `{ reseau, url, identifiant?, nom?, teamId?, actif? }` (cm.gerer). */
  async function creerCompte(acteur, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const reseau = lireReseauCompte(corps?.reseau);
    const p = profil(reseau, corps?.url, corps?.identifiant);
    await doublon(reseau, p.identifiant);
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_rs_comptes WHERE supprime_le IS NULL', []);
    if (Number(n?.n ?? 0) >= MAX_COMPTES) throw echec(409, 'trop-de-comptes', `${MAX_COMPTES} comptes au plus.`);
    const teamId = await team(corps?.teamId);
    const pos = await base.premier('SELECT MAX(position) AS p FROM cm_rs_comptes', []);
    const id = nouvelId();
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO cm_rs_comptes (id, reseau, identifiant, url, nom, team_id, actif, annonce_active, position, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        params: [id, reseau, p.identifiant, p.url, texteNettoye(corps?.nom, 80), teamId, booleen(corps?.actif, 1), Number(pos?.p ?? 0) + 1024, acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      ev('cm.reseau_compte_cree', acteur, 'cm_rs_compte', id, { reseau, identifiant: p.identifiant, team: teamId }, t),
    ]);
    return { compte: await comptePublic(await compteLigne(id), { gerer: true }) };
  }

  /** `PATCH /cm/reseaux/comptes/:id` : adresse, identifiant, nom, team, actif (cm.gerer). */
  async function modifierCompte(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const c = await compteLigne(id);
    const champs = {};
    if (corps?.url !== undefined || corps?.identifiant !== undefined) {
      const p = profil(c.reseau, corps?.url ?? c.url, corps?.identifiant ?? (corps?.url !== undefined ? undefined : c.identifiant));
      await doublon(c.reseau, p.identifiant, c.id);
      champs.url = p.url;
      champs.identifiant = p.identifiant;
    }
    if (corps?.nom !== undefined) champs.nom = texteNettoye(corps.nom, 80);
    if (corps?.teamId !== undefined) champs.team_id = await team(corps.teamId);
    if (corps?.actif !== undefined) champs.actif = corps.actif ? 1 : 0;
    if (corps?.position !== undefined) {
      if (!Number.isFinite(Number(corps.position))) throw echec(400, 'position', 'Position invalide.');
      champs.position = Number(corps.position);
    }
    const cles = Object.keys(champs);
    if (cles.length === 0) return { compte: await comptePublic(c, { gerer: true }) };
    const t = maintenant();
    await base.lot([
      { sql: `UPDATE cm_rs_comptes SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(t), c.id] },
      ev('cm.reseau_compte_modifie', acteur, 'cm_rs_compte', c.id, { reseau: c.reseau, identifiant: champs.identifiant ?? c.identifiant, champs: cles }, t),
    ]);
    return { compte: await comptePublic(await compteLigne(c.id), { gerer: true }) };
  }

  /** `DELETE /cm/reseaux/comptes/:id` : le compte disparaît de la page ; ses relevés et publications restent. */
  async function supprimerCompte(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const c = await compteLigne(id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_rs_comptes SET supprime_le = ?, annonce_active = 0, maj_par = ?, maj_le = ? WHERE id = ?', params: [iso(t), acteur.compte, iso(t), c.id] },
      { sql: 'DELETE FROM cm_rs_cibles WHERE compte_id = ?', params: [c.id] },
      ev('cm.reseau_compte_supprime', acteur, 'cm_rs_compte', c.id, { reseau: c.reseau, identifiant: c.identifiant }, t),
    ]);
    return { ok: true };
  }

  /** Cibles saisies `[{ genre: 'team' | 'salon', id }]` vérifiées. */
  async function lireCibles(v) {
    if (!Array.isArray(v) || v.length > MAX_CIBLES) throw echec(400, 'cibles', `Salons cibles illisibles (${MAX_CIBLES} au plus).`);
    const sortie = new Map();
    for (const x of v) {
      if (!x || typeof x !== 'object' || !['team', 'salon'].includes(x.genre) || typeof x.id !== 'string' || !MOTIF_UUID.test(x.id)) throw echec(400, 'cibles', `Salons cibles illisibles (${MAX_CIBLES} au plus).`);
      if (x.genre === 'team') {
        const t = await base.premier('SELECT id FROM teams WHERE id = ? AND supprimee_le IS NULL', [x.id]);
        if (!t) throw echec(400, 'cibles', `Salons cibles illisibles (${MAX_CIBLES} au plus).`);
        sortie.set(`team:${x.id}`, { cle: `team:${x.id}`, genre: 'team', teamId: x.id, salonId: null });
      } else {
        const s = await base.premier('SELECT id FROM cm_rs_salons WHERE id = ?', [x.id]);
        if (!s) throw echec(400, 'cibles', `Salons cibles illisibles (${MAX_CIBLES} au plus).`);
        sortie.set(`salon:${x.id}`, { cle: `salon:${x.id}`, genre: 'salon', teamId: null, salonId: x.id });
      }
    }
    return [...sortie.values()];
  }

  /** `PUT /cm/reseaux/comptes/:id/annonce` `{ active, modeleEn, modeleFr, roleMention, cibles }` (cm.gerer). */
  async function reglerAnnonce(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const c = await compteLigne(id);
    const modeleEn = corps?.modeleEn !== undefined ? validerModeleAnnonce(corps.modeleEn) : (c.modele_en ?? null);
    const modeleFr = corps?.modeleFr !== undefined ? validerModeleAnnonce(corps.modeleFr) : (c.modele_fr ?? null);
    const role = corps?.roleMention !== undefined ? lireRoleMention(corps.roleMention) : (c.role_mention ?? null);
    const liste = corps?.cibles !== undefined ? await lireCibles(corps.cibles) : null;
    const active = corps?.active !== undefined ? (corps.active ? 1 : 0) : Number(c.annonce_active);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_rs_comptes SET annonce_active = ?, modele_en = ?, modele_fr = ?, role_mention = ?, maj_par = ?, maj_le = ? WHERE id = ?', params: [active, modeleEn, modeleFr, role, acteur.compte, iso(t), c.id] },
      ...(liste
        ? [
            { sql: 'DELETE FROM cm_rs_cibles WHERE compte_id = ?', params: [c.id] },
            ...liste.map(x => ({ sql: 'INSERT INTO cm_rs_cibles (compte_id, cle, genre, team_id, salon_id) VALUES (?, ?, ?, ?, ?)', params: [c.id, x.cle, x.genre, x.teamId, x.salonId] })),
          ]
        : []),
      ev('cm.reseau_annonce_modifiee', acteur, 'cm_rs_compte', c.id, { reseau: c.reseau, identifiant: c.identifiant, active: active === 1, cibles: liste ? liste.length : undefined }, t),
    ]);
    return { compte: await comptePublic(await compteLigne(c.id), { gerer: true }) };
  }

  /**
   * `POST /cm/reseaux/apercu` `{ reseau, identifiant?, url?, teamId?, modeleEn?, modeleFr?, roleMention? }` : messages
   * anglais et français tels qu'ils partiront (valeurs d'exemple pour le titre et l'adresse du post).
   */
  async function apercu(acteur, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const reseau = lireReseauCompte(corps?.reseau);
    const modeles = { en: validerModeleAnnonce(corps?.modeleEn) ?? modeleDefaut('en'), fr: validerModeleAnnonce(corps?.modeleFr) ?? modeleDefaut('fr') };
    const role = lireRoleMention(corps?.roleMention);
    const identifiant = lireIdentifiant(String(corps?.identifiant ?? ''), reseau) ?? 'club';
    const nomTeam = corps?.teamId ? (await base.premier('SELECT nom FROM teams WHERE id = ? AND supprimee_le IS NULL', [exigerUuid(corps.teamId, 'team')]))?.nom ?? '' : '';
    const profilUrl = validerUrlProfil(corps?.url, reseau).url ?? RESEAUX_COMPTES[reseau].postProfil(identifiant);
    const sortie = {};
    for (const l of ['en', 'fr']) {
      const variables = variablesAnnonce({ reseau, identifiant, url: `${profilUrl.replace(/\/$/, '')}`, titre: T(l, 'reseaux.exemple_titre'), team: nomTeam }, l);
      const charge = chargeAnnonce({ reseau, variables, modele: modeles[l], langue: l, roleId: l === 'en' ? role : null, urlProfil: profilUrl, lienApp, maintenant: maintenant() });
      sortie[l] = { texte: texteCharge(charge), embed: charge.embeds[0], mention: charge.content ?? null };
    }
    return sortie;
  }

  /** `POST /cm/reseaux/comptes/:id/test` : message de test vers chaque salon cible (cm.gerer ; un toutes les 10 s). */
  async function tester(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const c = await compteLigne(id);
    const t = maintenant();
    if (c.dernier_test_le && t - Date.parse(c.dernier_test_le) < INTERVALLE_TEST_MS) {
      const e = echec(429, 'trop-vite', 'Un test vient d’être envoyé : patientez quelques secondes.');
      e.attente = Math.ceil((INTERVALLE_TEST_MS - (t - Date.parse(c.dernier_test_le))) / 1000);
      throw e;
    }
    const lignes = await base.tous('SELECT * FROM cm_rs_cibles WHERE compte_id = ? ORDER BY cle', [c.id]);
    if (!lignes.length) throw echec(400, 'cibles', 'Choisissez au moins un salon Discord pour ce compte.');
    await base.executer('UPDATE cm_rs_comptes SET dernier_test_le = ? WHERE id = ?', [iso(t), c.id]);
    const nomTeam = c.team_id ? (await base.premier('SELECT nom FROM teams WHERE id = ?', [c.team_id]))?.nom ?? '' : '';
    const resultats = await envoyerTest(base, { ...c, team_nom: nomTeam }, lignes, { cle, fetch: fetchDiscord, jetonBot, lienApp, maintenant: t });
    return { resultats };
  }

  // ---------------------------------------------------------------- Salons du club

  async function salonLigne(id) {
    exigerUuid(id, 'salon');
    const s = await base.premier('SELECT * FROM cm_rs_salons WHERE id = ?', [id]);
    if (!s) throw echec(404, 'salon-introuvable', 'Salon introuvable.');
    return s;
  }

  const lireLangueSalon = v => {
    if (v === undefined) return undefined;
    if (v !== 'fr' && v !== 'en') throw echec(400, 'langue', 'Langue inconnue.');
    return v;
  };

  /** `POST /cm/reseaux/salons` `{ nom, url, filFr?, langue? }` : webhook d'un salon du club, chiffré (cm.gerer). */
  async function ajouterSalon(acteur, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const nom = texteNettoye(corps?.nom, 60);
    if (!nom) throw echec(400, 'nom', 'Nom obligatoire.');
    const url = validerUrlWebhook(corps?.url);
    const n = await base.premier('SELECT COUNT(*) AS n FROM cm_rs_salons', []);
    if (Number(n?.n ?? 0) >= MAX_SALONS) throw echec(409, 'trop-de-salons', `${MAX_SALONS} salons au plus.`);
    const id = nouvelId();
    const chiffre = await chiffrerWebhook(cle, `reseaux:${id}`, url);
    const t = maintenant();
    await base.lot([
      {
        sql: 'INSERT INTO cm_rs_salons (id, nom, url_chiffree, fin, fil_fr, langue, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, nom, chiffre, finDeWebhook(url), booleen(corps?.filFr, 1), lireLangueSalon(corps?.langue) ?? 'fr', acteur.compte, iso(t), iso(t)],
      },
      ev('cm.reseau_salon_ajoute', acteur, 'cm_rs_salon', id, { nom }, t),
    ]);
    return { salon: salonPublic(await salonLigne(id)) };
  }

  /** `PATCH /cm/reseaux/salons/:id` `{ nom?, url?, filFr?, langue? }` : une nouvelle adresse remplace l'ancienne. */
  async function modifierSalon(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const s = await salonLigne(id);
    const champs = {};
    if (corps?.nom !== undefined) {
      champs.nom = texteNettoye(corps.nom, 60);
      if (!champs.nom) throw echec(400, 'nom', 'Nom obligatoire.');
    }
    if (corps?.url !== undefined) {
      const url = validerUrlWebhook(corps.url);
      champs.url_chiffree = await chiffrerWebhook(cle, `reseaux:${s.id}`, url);
      champs.fin = finDeWebhook(url);
      champs.invalide_le = null;
      champs.bloque_jusqua = null;
    }
    if (corps?.filFr !== undefined) champs.fil_fr = corps.filFr ? 1 : 0;
    if (corps?.langue !== undefined) champs.langue = lireLangueSalon(corps.langue);
    const cles = Object.keys(champs);
    if (cles.length) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE cm_rs_salons SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...cles.map(k => champs[k]), iso(t), s.id] },
        ev('cm.reseau_salon_modifie', acteur, 'cm_rs_salon', s.id, { nom: champs.nom ?? s.nom, adresse: corps?.url !== undefined }, t),
      ]);
    }
    return { salon: salonPublic(await salonLigne(s.id)) };
  }

  /** `DELETE /cm/reseaux/salons/:id` : le salon disparaît des cibles des comptes ; ses annonces en attente s'arrêtent. */
  async function supprimerSalon(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const s = await salonLigne(id);
    const t = maintenant();
    await base.lot([
      { sql: 'DELETE FROM cm_rs_cibles WHERE salon_id = ?', params: [s.id] },
      { sql: "UPDATE cm_rs_annonces SET statut = 'abandonne', derniere_erreur = ?, maj_le = ? WHERE salon_id = ? AND statut = 'attente'", params: ['Salon du club supprimé', iso(t), s.id] },
      { sql: 'DELETE FROM cm_rs_salons WHERE id = ?', params: [s.id] },
      ev('cm.reseau_salon_supprime', acteur, 'cm_rs_salon', s.id, { nom: s.nom }, t),
    ]);
    return { ok: true };
  }

  /** `POST /cm/reseaux/salons/:id/test` : message de test dans le salon (un toutes les 10 s). */
  async function testerSalon(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const s = await salonLigne(id);
    const t = maintenant();
    if (s.dernier_test_le && t - Date.parse(s.dernier_test_le) < INTERVALLE_TEST_MS) {
      const e = echec(429, 'trop-vite', 'Un test vient d’être envoyé : patientez quelques secondes.');
      e.attente = Math.ceil((INTERVALLE_TEST_MS - (t - Date.parse(s.dernier_test_le))) / 1000);
      throw e;
    }
    await base.executer('UPDATE cm_rs_salons SET dernier_test_le = ? WHERE id = ?', [iso(t), s.id]);
    const c = await resoudreCible(base, { cible: `salon:${s.id}`, salonId: s.id }, { cle, jetonBot });
    if (c.abandon) return { ok: false, motif: c.abandon };
    const l = c.langue;
    const r = await appelerDiscord(fetchDiscord, c.url, construireCharge(T(l, 'reseaux.test_salon', { salon: s.nom }), { nomTeam: T(l, 'reseaux.club'), titre: T(l, 'test.titre'), cle: 'test', langue: l, maintenant: t }));
    await base.executer(r.ok ? 'UPDATE cm_rs_salons SET dernier_succes_le = ?, invalide_le = NULL WHERE id = ?' : 'UPDATE cm_rs_salons SET dernier_echec_le = ? WHERE id = ?', [iso(t), s.id]);
    return r.ok ? { ok: true } : { ok: false, motif: r.motif };
  }

  /** `GET /cm/reseaux/annonces` : 50 dernières annonces (statut, essais, motif d'échec) (cm.gerer). */
  async function annonces(acteur) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const lignes = await base.tous('SELECT a.*, c.titre, c.tableau_id FROM cm_rs_annonces a LEFT JOIN cm_cartes c ON c.id = a.carte_id ORDER BY a.maj_le DESC, a.id LIMIT 50', []);
    // Post d'un tableau CM restreint dont l'acteur n'est pas (migration 0046) : ni titre ni lien vers la carte.
    const interdits = new Set(await lecteurTableaux(base, acteur).interdits());
    const salons = new Map((await base.tous('SELECT id, nom FROM cm_rs_salons', [])).map(s => [s.id, s.nom]));
    const teams = await teamsConnues(lignes.map(l => l.team_id));
    return {
      annonces: lignes.map(l => ({
        id: l.id,
        carteId: interdits.has(l.tableau_id) ? null : l.carte_id,
        titre: interdits.has(l.tableau_id) ? '' : (l.titre ?? ''),
        reseau: l.reseau,
        cible: l.team_id ? { genre: 'team', nom: teams.get(l.team_id) ?? '' } : { genre: 'salon', nom: salons.get(l.salon_id) ?? '' },
        statut: l.statut,
        operation: l.operation,
        essais: Number(l.essais),
        erreur: l.derniere_erreur ?? null,
        url: l.url_post,
        envoyeLe: l.envoye_le ?? null,
        majLe: l.maj_le,
      })),
    };
  }

  // ---------------------------------------------------------------- Publications

  const RELEVE_PUBLIC = r => ({
    id: r.id,
    jour: r.jour,
    ...Object.fromEntries(METRIQUES_POST.map(m => [nomApi(m), r[m] === null || r[m] === undefined ? null : Number(r[m])])),
    source: r.source,
    engagement: tauxEngagement(r),
    interactions: interactions(r),
  });

  /**
   * Cartes (parmi `ids`) d'un tableau CM restreint dont l'acteur n'est pas (migration 0046) : la publication, déjà
   * publique sur le réseau, reste dans les statistiques, mais sans lien vers sa carte.
   */
  async function cartesFermees(acteur, ids) {
    const interdits = new Set(await lecteurTableaux(base, acteur).interdits());
    if (!interdits.size || !ids.length) return new Set();
    return new Set((await lignesParIds(base, 'SELECT id, tableau_id FROM cm_cartes WHERE id', ids)).filter(c => interdits.has(c.tableau_id)).map(c => c.id));
  }

  function publicationPublique(p, { releves = [], comptes, teams, fermees }) {
    const dernier = dernierReleve(releves);
    const compte = p.compte_id ? comptes?.get(p.compte_id) : null;
    return {
      id: p.id,
      carteId: p.carte_id && !fermees?.has(p.carte_id) ? p.carte_id : null,
      reseau: p.reseau,
      url: p.url,
      titre: p.titre,
      type: p.type_contenu,
      teamId: p.team_id ?? null,
      team: p.team_id ? (teams?.get(p.team_id) ?? null) : null,
      compte: compte ? { id: compte.id, identifiant: compte.identifiant } : null,
      publieLe: p.publie_le,
      video: Number(p.video) === 1,
      rappels: Number(p.rappels) === 1,
      releves: releves.length,
      dernier: dernier ? RELEVE_PUBLIC(dernier) : null,
    };
  }

  function lirePeriode(q, { defautJours = 30 } = {}) {
    const au = q?.au ? lireJour(q.au) : aujourdhui();
    const du = q?.du ? lireJour(q.du) : ajouterJours(au ?? aujourdhui(), -(defautJours - 1));
    if (!du || !au || du > au) throw echec(400, 'periode', 'Période invalide (du, au : AAAA-MM-JJ).');
    if (ecartJours(du, au) > PERIODE_MAX_JOURS) throw echec(400, 'periode', 'Période d’un an au plus.');
    return { du, au };
  }

  /** Publications visibles (filtres) ; `periode` : jour de publication (heure de Paris) dans [du, au]. */
  async function publicationsVisibles(d, { du, au, reseau, teamId, type, compteId, q } = {}) {
    const visibles = teamsVisibles(d);
    const conditions = ['supprime_le IS NULL'];
    const params = [];
    if (du) {
      conditions.push('publie_le >= ?');
      params.push(iso(Date.parse(`${ajouterJours(du, -1)}T00:00:00Z`)));
    }
    if (au) {
      conditions.push('publie_le < ?');
      params.push(iso(Date.parse(`${ajouterJours(au, 2)}T00:00:00Z`)));
    }
    if (reseau) {
      conditions.push('reseau = ?');
      params.push(reseau);
    }
    if (type) {
      conditions.push('type_contenu = ?');
      params.push(type);
    }
    if (compteId) {
      conditions.push('compte_id = ?');
      params.push(compteId);
    }
    const lignes = await base.tous(`SELECT * FROM cm_rs_publications WHERE ${conditions.join(' AND ')} ORDER BY publie_le DESC, id LIMIT 5000`, params);
    const texte = typeof q === 'string' ? q.trim().toLowerCase() : '';
    return lignes.filter(p => {
      if (visibles !== null && !(p.team_id && visibles.includes(p.team_id))) return false;
      if (teamId !== undefined && (teamId === 'club' ? p.team_id : p.team_id !== teamId)) return false;
      if (du || au) {
        const j = jourDans(Date.parse(p.publie_le), FUSEAU);
        if ((du && j < du) || (au && j > au)) return false;
      }
      return !texte || p.titre.toLowerCase().includes(texte) || p.url.toLowerCase().includes(texte);
    });
  }

  const filtreTeam = v => (v === undefined || v === null || v === '' ? undefined : v === 'club' ? 'club' : exigerUuid(v, 'team'));
  const filtreReseau = v => (v === undefined || v === null || v === '' ? undefined : lireReseauCompte(v));
  const filtreType = v => {
    if (v === undefined || v === null || v === '') return undefined;
    if (!TYPES_CONTENU.includes(v)) throw echec(400, 'type', 'Valeur inconnue.');
    return v;
  };

  async function relevesDe(ids) {
    const m = new Map(ids.map(id => [id, []]));
    for (const r of await lignesParIds(base, 'SELECT * FROM cm_rs_releves_posts WHERE publication_id', ids)) m.get(r.publication_id)?.push(r);
    return m;
  }

  /** `GET /cm/reseaux/publications?du&au&reseau&team&type&compte&q` : publications avec leur dernier relevé. */
  async function publications(acteur, q = {}) {
    const d = await droitsReseaux(base, acteur);
    const periode = q.du || q.au ? lirePeriode(q) : {};
    const lignes = (await publicationsVisibles(d, { ...periode, reseau: filtreReseau(q.reseau), teamId: filtreTeam(q.team), type: filtreType(q.type), compteId: q.compte ? exigerUuid(q.compte, 'compte') : undefined, q: q.q })).slice(0, MAX_PUBLICATIONS_LISTE);
    const releves = await relevesDe(lignes.map(p => p.id));
    const comptes = new Map((await lignesParIds(base, 'SELECT id, identifiant FROM cm_rs_comptes WHERE id', lignes.map(p => p.compte_id).filter(Boolean))).map(c => [c.id, c]));
    const teams = await teamsConnues(lignes.map(p => p.team_id));
    const fermees = await cartesFermees(acteur, lignes.map(p => p.carte_id).filter(Boolean));
    return { publications: lignes.map(p => publicationPublique(p, { releves: releves.get(p.id), comptes, teams, fermees })), editer: d.club.has('cm.editer') || [...d.teams.values()].some(s => s.has('cm.editer')) };
  }

  /** `GET /cm/reseaux/publications/:id` : relevés et évolution (J+n, écarts, engagement). */
  async function publication(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    const p = await publicationVisible(d, id);
    const releves = (await base.tous('SELECT * FROM cm_rs_releves_posts WHERE publication_id = ? ORDER BY jour', [p.id])).slice(-MAX_RELEVES);
    const comptes = new Map((await lignesParIds(base, 'SELECT id, identifiant FROM cm_rs_comptes WHERE id', [p.compte_id].filter(Boolean))).map(c => [c.id, c]));
    const teams = await teamsConnues([p.team_id]);
    return {
      publication: publicationPublique(p, { releves, comptes, teams, fermees: await cartesFermees(acteur, [p.carte_id].filter(Boolean)) }),
      releves: releves.map(RELEVE_PUBLIC),
      evolution: evolutionPost(releves, jourDans(Date.parse(p.publie_le), FUSEAU)),
      editer: peutSur(d, 'cm.editer', p.team_id),
    };
  }

  function lirePublieLe(v) {
    if (v === undefined || v === null || v === '') return iso(maintenant());
    const j = lireJour(String(v));
    if (j && String(v).trim().length <= 10) return `${j}T12:00:00.000Z`;
    const ms = Date.parse(String(v));
    if (!Number.isFinite(ms)) throw echec(400, 'publie-le', 'Date de publication invalide.');
    return iso(ms);
  }

  /**
   * `POST /cm/reseaux/publications` `{ url, reseau?, compteId?, titre, type?, teamId?, publieLe?, video?, rappels? }` :
   * publication hors section CM (vidéo YouTube, post repris…) à suivre (cm.editer sur la portée).
   */
  async function creerPublication(acteur, corps) {
    const d = await droitsReseaux(base, acteur);
    const reseau = corps?.reseau ? lireReseauCompte(corps.reseau) : reseauDeUrl(corps?.url);
    if (!reseau) throw echec(400, 'reseau', 'Réseau inconnu.');
    const url = validerUrlPublication(corps?.url, reseau);
    if (!url) throw echec(400, 'url-post', 'Adresse du post invalide : https:// sur le domaine du réseau.');
    const comptes = await base.tous('SELECT * FROM cm_rs_comptes WHERE supprime_le IS NULL', []);
    const compte = corps?.compteId ? comptes.find(c => c.id === corps.compteId && c.reseau === reseau) : compteDuPost({ url, reseau, teamId: corps?.teamId ?? null }, comptes);
    if (corps?.compteId && !compte) throw echec(400, 'compte', 'Compte inconnu pour ce réseau.');
    const teamId = corps?.teamId !== undefined ? await team(corps.teamId) : (compte?.team_id ?? null);
    exigerSur(d, 'cm.editer', teamId);
    const existantes = await base.tous('SELECT id, url FROM cm_rs_publications WHERE reseau = ? AND supprime_le IS NULL', [reseau]);
    if (existantes.some(p => cleUrl(p.url) === cleUrl(url))) throw echec(409, 'publication-existe', 'Cette publication est déjà suivie.');
    const type = corps?.type === undefined ? 'autre' : filtreType(corps.type) ?? 'autre';
    const id = nouvelId();
    const t = maintenant();
    const titre = texteNettoye(corps?.titre, 200);
    await base.lot([
      {
        sql: `INSERT INTO cm_rs_publications (id, carte_id, reseau, compte_id, url, titre, type_contenu, team_id, publie_le, video, rappels, cree_par, cree_le, maj_par, maj_le)
              VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, reseau, compte?.id ?? null, url, titre, type, teamId, lirePublieLe(corps?.publieLe), booleen(corps?.video, estVideo(reseau, { type, url }) ? 1 : 0), booleen(corps?.rappels, (await lireReglagesReseaux(base)).rappels ? 1 : 0), acteur.compte, iso(t), acteur.compte, iso(t)],
      },
      ev('cm.reseau_publication_ajoutee', acteur, 'cm_rs_publication', id, { reseau, titre }, t),
    ]);
    return publication(acteur, id);
  }

  /** `PATCH /cm/reseaux/publications/:id` : titre, type, vidéo, rappels, compte, team ; adresse (hors post CM). */
  async function modifierPublication(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    const p = await publicationVisible(d, id, 'cm.editer');
    const champs = {};
    if (corps?.titre !== undefined) champs.titre = texteNettoye(corps.titre, 200);
    if (corps?.type !== undefined) champs.type_contenu = filtreType(corps.type) ?? 'autre';
    if (corps?.video !== undefined) champs.video = corps.video ? 1 : 0;
    if (corps?.rappels !== undefined) champs.rappels = corps.rappels ? 1 : 0;
    if (corps?.compteId !== undefined) {
      if (corps.compteId === null) champs.compte_id = null;
      else {
        const c = await compteLigne(corps.compteId);
        if (c.reseau !== p.reseau) throw echec(400, 'compte', 'Compte inconnu pour ce réseau.');
        champs.compte_id = c.id;
      }
    }
    if (corps?.teamId !== undefined) {
      champs.team_id = await team(corps.teamId);
      exigerSur(d, 'cm.editer', champs.team_id);
    }
    if (corps?.url !== undefined || corps?.publieLe !== undefined) {
      if (p.carte_id) throw echec(409, 'publication-cm', 'L’adresse et la date d’un post de la section CM se modifient sur sa carte.');
      if (corps.url !== undefined) {
        const url = validerUrlPublication(corps.url, p.reseau);
        if (!url) throw echec(400, 'url-post', 'Adresse du post invalide : https:// sur le domaine du réseau.');
        champs.url = url;
      }
      if (corps.publieLe !== undefined) champs.publie_le = lirePublieLe(corps.publieLe);
    }
    const cles = Object.keys(champs);
    if (cles.length) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE cm_rs_publications SET ${cles.map(k => `${k} = ?`).join(', ')}, maj_par = ?, maj_le = ? WHERE id = ?`, params: [...cles.map(k => champs[k]), acteur.compte, iso(t), p.id] },
        ev('cm.reseau_publication_modifiee', acteur, 'cm_rs_publication', p.id, { reseau: p.reseau, titre: champs.titre ?? p.titre, champs: cles }, t),
      ]);
    }
    return publication(acteur, p.id);
  }

  /** `DELETE /cm/reseaux/publications/:id` : ne plus suivre (relevés gardés, la publication disparaît des statistiques). */
  async function supprimerPublication(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    const p = await publicationVisible(d, id, 'cm.editer');
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE cm_rs_publications SET supprime_le = ?, maj_par = ?, maj_le = ? WHERE id = ?', params: [iso(t), acteur.compte, iso(t), p.id] },
      ev('cm.reseau_publication_supprimee', acteur, 'cm_rs_publication', p.id, { reseau: p.reseau, titre: p.titre }, t),
    ]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- Relevés

  function lireJourReleve(v, { min } = {}) {
    const jour = v === undefined || v === null || v === '' ? aujourdhui() : lireJour(String(v));
    if (!jour || jour > aujourdhui() || (min && jour < min)) throw echec(400, 'jour', 'Date du relevé invalide (AAAA-MM-JJ, pas dans le futur).');
    return jour;
  }

  function metriques(corps, champs) {
    const v = normaliserMetriques(corps, champs);
    if (v.erreur) throw echec(400, `metrique-${v.erreur}`, 'Valeur illisible : un nombre positif est attendu.');
    if (champs.every(c => v[c] === null)) throw echec(400, 'releve-vide', 'Saisissez au moins une valeur.');
    return v;
  }

  /** `POST /cm/reseaux/publications/:id/releves` `{ jour?, vues?, likes?, … }` : relevé du jour (remplace celui du même jour). */
  async function releverPost(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    const p = await publicationVisible(d, id, 'cm.editer');
    const jour = lireJourReleve(corps?.jour, { min: ajouterJours(jourDans(Date.parse(p.publie_le), FUSEAU), -1) });
    const v = metriques(corps, METRIQUES_POST);
    const t = maintenant();
    await base.lot([instructionReleve('post', p.id, jour, v, { saisiPar: acteur.compte, t }), ev('cm.reseau_releve', acteur, 'cm_rs_publication', p.id, { genre: 'publication', reseau: p.reseau, titre: p.titre, jour }, t)]);
    return publication(acteur, p.id);
  }

  async function supprimerRelevePost(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerUuid(id, 'releve');
    const r = await base.premier('SELECT * FROM cm_rs_releves_posts WHERE id = ?', [id]);
    if (!r) throw echec(404, 'releve-introuvable', 'Relevé introuvable.');
    const p = await publicationVisible(d, r.publication_id, 'cm.editer');
    await base.executer('DELETE FROM cm_rs_releves_posts WHERE id = ?', [r.id]);
    return publication(acteur, p.id);
  }

  const RELEVE_COMPTE_PUBLIC = r => ({ id: r.id, jour: r.jour, ...Object.fromEntries(METRIQUES_COMPTE.map(m => [m, r[m] === null || r[m] === undefined ? null : Number(r[m])])), source: r.source });

  /** `GET /cm/reseaux/comptes/:id/releves` : relevés datés et évolution des abonnés. */
  async function relevesCompte(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    const c = await compteVisible(d, id);
    const releves = (await base.tous('SELECT * FROM cm_rs_releves_comptes WHERE compte_id = ? ORDER BY jour', [c.id])).slice(-MAX_RELEVES);
    const tous = evolutionAbonnes(releves, releves[0]?.jour ?? aujourdhui(), aujourdhui());
    return { compte: { id: c.id, reseau: c.reseau, identifiant: c.identifiant, teamId: c.team_id ?? null }, releves: releves.map(RELEVE_COMPTE_PUBLIC), evolution: tous, editer: peutSur(d, 'cm.editer', c.team_id) };
  }

  /** `POST /cm/reseaux/comptes/:id/releves` `{ jour?, abonnes?, publications?, vues?, impressions? }`. */
  async function releverCompte(acteur, id, corps) {
    const d = await droitsReseaux(base, acteur);
    const c = await compteVisible(d, id, 'cm.editer');
    const jour = lireJourReleve(corps?.jour);
    const v = metriques(corps, METRIQUES_COMPTE);
    const t = maintenant();
    await base.lot([instructionReleve('compte', c.id, jour, v, { saisiPar: acteur.compte, t }), ev('cm.reseau_releve', acteur, 'cm_rs_compte', c.id, { genre: 'compte', reseau: c.reseau, identifiant: c.identifiant, jour }, t)]);
    return relevesCompte(acteur, c.id);
  }

  async function supprimerReleveCompte(acteur, id) {
    const d = await droitsReseaux(base, acteur);
    exigerUuid(id, 'releve');
    const r = await base.premier('SELECT * FROM cm_rs_releves_comptes WHERE id = ?', [id]);
    if (!r) throw echec(404, 'releve-introuvable', 'Relevé introuvable.');
    const c = await compteVisible(d, r.compte_id, 'cm.editer');
    await base.executer('DELETE FROM cm_rs_releves_comptes WHERE id = ?', [r.id]);
    return relevesCompte(acteur, c.id);
  }

  // ---------------------------------------------------------------- Tableau de bord

  /**
   * `GET /cm/reseaux/tableau-de-bord?du&au&reseau&team&type` : totaux, évolution des abonnés par compte, top posts
   * (vues, engagement), comparaison par réseau, par type de contenu, par team. Les chiffres d'une publication sont
   * ceux de son DERNIER relevé fait au plus tard le dernier jour de la période.
   */
  async function tableauDeBord(acteur, q = {}) {
    const d = await droitsReseaux(base, acteur);
    const { du, au } = lirePeriode(q);
    const reseau = filtreReseau(q.reseau);
    const teamId = filtreTeam(q.team);
    const type = filtreType(q.type);
    const pubs = await publicationsVisibles(d, { du, au, reseau, teamId, type });
    const releves = await relevesDe(pubs.map(p => p.id));
    const comptesLignes = await comptesVisibles(d, { reseau, teamId });
    const relevesComptes = new Map(comptesLignes.map(c => [c.id, []]));
    for (const r of await lignesParIds(base, 'SELECT * FROM cm_rs_releves_comptes WHERE jour <= ? AND compte_id', comptesLignes.map(c => c.id), { paramsAvant: [au] })) relevesComptes.get(r.compte_id)?.push(r);
    const teams = await teamsConnues([...pubs.map(p => p.team_id), ...comptesLignes.map(c => c.team_id)]);
    const comptesParId = new Map(comptesLignes.map(c => [c.id, c]));
    const lignes = pubs.map(p => {
      const dernier = dernierReleve((releves.get(p.id) ?? []).filter(r => r.jour <= au));
      return { p, dernier };
    });
    const chiffres = ({ p, dernier }) => ({
      id: p.id,
      titre: p.titre,
      reseau: p.reseau,
      url: p.url,
      type: p.type_contenu,
      team: p.team_id ? (teams.get(p.team_id) ?? null) : null,
      compte: p.compte_id ? (comptesParId.get(p.compte_id)?.identifiant ?? null) : null,
      publieLe: p.publie_le,
      vues: dernier?.vues === null || dernier?.vues === undefined ? null : Number(dernier.vues),
      interactions: dernier ? interactions(dernier) : null,
      engagement: dernier ? tauxEngagement(dernier) : null,
      jour: dernier?.jour ?? null,
    });
    const somme = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);
    const groupe = cleDe => {
      const m = new Map();
      for (const l of lignes) {
        const k = cleDe(l.p);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(l);
      }
      return [...m].map(([k, ls]) => ({
        cle: k,
        publications: ls.length,
        relevees: ls.filter(l => l.dernier).length,
        vues: somme(ls, l => (l.dernier?.vues === null || l.dernier?.vues === undefined ? 0 : Number(l.dernier.vues))),
        interactions: somme(ls, l => (l.dernier ? interactions(l.dernier) : 0)),
        engagement: tauxEngagementGlobal(ls.map(l => l.dernier).filter(Boolean)),
      }));
    };
    const avecDernier = lignes.filter(l => l.dernier);
    const comptes = comptesLignes.map(c => {
      const rs = relevesComptes.get(c.id) ?? [];
      const e = evolutionAbonnes(rs, du, au);
      const dernier = dernierReleve(rs);
      return { id: c.id, reseau: c.reseau, identifiant: c.identifiant, teamId: c.team_id ?? null, team: c.team_id ? (teams.get(c.team_id) ?? null) : null, ...e, vues: dernier?.vues ?? null, impressions: dernier?.impressions ?? null, publications: dernier?.publications ?? null };
    });
    return {
      periode: { du, au },
      totaux: {
        publications: lignes.length,
        relevees: avecDernier.length,
        vues: somme(avecDernier, l => (l.dernier.vues === null ? 0 : Number(l.dernier.vues))),
        interactions: somme(avecDernier, l => interactions(l.dernier)),
        engagement: tauxEngagementGlobal(avecDernier.map(l => l.dernier)),
        abonnes: comptes.some(c => c.fin !== null) ? somme(comptes, c => c.fin) : null,
        variationAbonnes: comptes.some(c => c.variation !== null) ? somme(comptes, c => c.variation) : null,
      },
      comptes,
      topVues: avecDernier.filter(l => l.dernier.vues !== null).sort((a, b) => Number(b.dernier.vues) - Number(a.dernier.vues)).slice(0, 10).map(chiffres),
      topEngagement: avecDernier.filter(l => tauxEngagement(l.dernier) !== null && baseEngagement(l.dernier) !== null).sort((a, b) => tauxEngagement(b.dernier) - tauxEngagement(a.dernier)).slice(0, 10).map(chiffres),
      parReseau: groupe(p => p.reseau),
      parType: groupe(p => p.type_contenu),
      parTeam: groupe(p => p.team_id ?? 'club').map(g => ({ ...g, nom: g.cle === 'club' ? null : (teams.get(g.cle) ?? null) })),
    };
  }

  // ---------------------------------------------------------------- Import / export CSV

  function lireContenuCsv(corps) {
    const contenu = corps?.contenu;
    if (typeof contenu !== 'string' || !contenu.trim()) throw echec(400, 'csv-vide', 'Fichier CSV vide.');
    if (contenu.length > MAX_IMPORT_OCTETS) throw echec(413, 'trop-gros', 'Fichier trop volumineux (1 Mo au plus).');
    try {
      return lireCsv(contenu, { maxLignes: 5000 });
    } catch (e) {
      if (e instanceof CsvInvalide) {
        const err = echec(400, 'csv-invalide', 'Fichier CSV illisible.');
        err.details = { raison: e.code, ligne: e.ligne };
        throw err;
      }
      throw e;
    }
  }

  const genreImport = v => {
    if (v !== 'posts' && v !== 'comptes') throw echec(400, 'genre', 'Valeur inconnue.');
    return v;
  };
  const champsDe = genre => (genre === 'posts' ? CHAMPS_IMPORT_POSTS : CHAMPS_IMPORT_COMPTES);

  async function exigerEditerQuelquePart(acteur) {
    const d = await droitsReseaux(base, acteur);
    if (!d.club.has('cm.editer') && ![...d.teams.values()].some(s => s.has('cm.editer'))) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    return d;
  }

  /** `POST /cm/reseaux/import/apercu` `{ genre: 'posts' | 'comptes', contenu }` : en-têtes, exemples, correspondance. */
  async function apercuImport(acteur, corps) {
    await exigerEditerQuelquePart(acteur);
    const genre = genreImport(corps?.genre);
    const { lignes, separateur } = lireContenuCsv(corps);
    const [entetes = [], ...donnees] = lignes;
    return {
      genre,
      separateur,
      entetes: entetes.map(e => texteNettoye(e, 80)),
      exemples: donnees.slice(0, 5).map(l => entetes.map((_, i) => texteNettoye(l[i] ?? '', 120))),
      lignes: donnees.length,
      correspondance: correspondanceProposee(entetes, champsDe(genre)),
      champs: [...champsDe(genre)],
    };
  }

  /**
   * `POST /cm/reseaux/import` `{ genre, contenu, correspondance: { index: champ }, jour?, creer? }` : relevés datés
   * (un par jour et par publication ou compte : réimporter le même fichier ne crée rien de plus). Publications : par
   * leur adresse ; `creer` : une adresse inconnue devient une publication suivie. Comptes : par identifiant ou adresse
   * du profil. Ligne illisible ou hors de vos droits : écartée avec sa raison. Tout est écrit en un lot.
   */
  async function importer(acteur, corps) {
    const d = await exigerEditerQuelquePart(acteur);
    const genre = genreImport(corps?.genre);
    const champs = champsDe(genre);
    const { lignes, numeros } = lireContenuCsv(corps);
    const correspondance = corps?.correspondance;
    if (!correspondance || typeof correspondance !== 'object' || Array.isArray(correspondance)) throw echec(400, 'correspondance', 'Correspondance des colonnes illisible.');
    const colonnes = {};
    for (const [index, champ] of Object.entries(correspondance)) {
      if (champ === null || champ === '') continue;
      if (!/^\d{1,2}$/.test(index) || !champs.includes(champ)) throw echec(400, 'correspondance', 'Correspondance des colonnes illisible.');
      if (Object.values(colonnes).includes(champ)) throw echec(400, 'correspondance', 'Correspondance des colonnes illisible.');
      colonnes[Number(index)] = champ;
    }
    const requis = genre === 'posts' ? 'url' : 'compte';
    if (!Object.values(colonnes).includes(requis)) throw echec(400, 'correspondance', genre === 'posts' ? 'Indiquez la colonne de l’adresse du post.' : 'Indiquez la colonne du compte.');
    const jourDefaut = corps?.jour ? lireJourReleve(corps.jour) : aujourdhui();
    const creer = Boolean(corps?.creer) && genre === 'posts';
    const t = maintenant();
    const comptes = await base.tous('SELECT * FROM cm_rs_comptes WHERE supprime_le IS NULL', []);
    const bilan = { releves: 0, crees: 0, invalides: [] };
    const lot = [];
    const publiees = new Map();
    if (genre === 'posts') {
      for (const p of await base.tous('SELECT id, url, team_id, publie_le FROM cm_rs_publications WHERE supprime_le IS NULL ORDER BY cree_le LIMIT 20000', [])) publiees.set(cleUrl(p.url), p);
    }
    const parametres = (await lireReglagesReseaux(base)).rappels ? 1 : 0;
    for (let i = 1; i < lignes.length; i++) {
      const v = {};
      for (const [index, champ] of Object.entries(colonnes)) v[champ] = String(lignes[i][Number(index)] ?? '').trim();
      const numero = numeros[i];
      const ecarter = code => bilan.invalides.push({ ligne: numero, code });
      const jour = v.jour ? lireJour(v.jour) : jourDefaut;
      if (!jour || jour > aujourdhui()) {
        ecarter('jour');
        continue;
      }
      const valeurs = normaliserMetriques(v, genre === 'posts' ? METRIQUES_POST : METRIQUES_COMPTE);
      if (valeurs.erreur) {
        ecarter(valeurs.erreur);
        continue;
      }
      if (Object.values(valeurs).every(x => x === null)) {
        ecarter('releve-vide');
        continue;
      }
      if (genre === 'posts') {
        const reseau = v.reseau ? lireReseau(v.reseau) : reseauDeUrl(v.url);
        if (!reseau) {
          ecarter('reseau');
          continue;
        }
        const url = validerUrlPublication(v.url, reseau);
        if (!url) {
          ecarter('url');
          continue;
        }
        let p = publiees.get(cleUrl(url));
        if (!p) {
          if (!creer) {
            ecarter('publication-inconnue');
            continue;
          }
          const type = lireTypeContenu(v.type);
          const publieJour = v.publie_le ? lireJour(v.publie_le) : jour;
          if (!type || !publieJour) {
            ecarter(!type ? 'type' : 'publie_le');
            continue;
          }
          const compte = compteDuPost({ url, reseau }, comptes);
          const teamId = compte?.team_id ?? null;
          if (!peutSur(d, 'cm.editer', teamId)) {
            ecarter('permission');
            continue;
          }
          p = { id: nouvelId(), url, team_id: teamId, publie_le: `${publieJour}T12:00:00.000Z` };
          lot.push({
            sql: `INSERT INTO cm_rs_publications (id, carte_id, reseau, compte_id, url, titre, type_contenu, team_id, publie_le, video, rappels, cree_par, cree_le, maj_par, maj_le)
                  VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [p.id, reseau, compte?.id ?? null, url, texteNettoye(v.titre, 200), type, teamId, p.publie_le, estVideo(reseau, { type, url }) ? 1 : 0, parametres, acteur.compte, iso(t), acteur.compte, iso(t)],
          });
          publiees.set(cleUrl(url), p);
          bilan.crees++;
        } else if (!peutSur(d, 'cm.editer', p.team_id) || !peutSur(d, 'cm.voir', p.team_id)) {
          ecarter('permission');
          continue;
        }
        lot.push(instructionReleve('post', p.id, jour, valeurs, { source: 'csv', saisiPar: acteur.compte, t }));
        bilan.releves++;
      } else {
        const reseauSaisi = v.reseau ? lireReseau(v.reseau) : undefined;
        if (v.reseau && !reseauSaisi) {
          ecarter('reseau');
          continue;
        }
        const brut = v.compte;
        const reseauUrl = reseauDeUrl(brut);
        let compte = null;
        if (reseauUrl) {
          const p = validerUrlProfil(brut, reseauUrl);
          compte = p.identifiant ? comptes.find(c => c.reseau === reseauUrl && memeIdentifiant(c.identifiant, p.identifiant)) : null;
        } else {
          const candidats = comptes.filter(c => (!reseauSaisi || c.reseau === reseauSaisi) && memeIdentifiant(c.identifiant, brut));
          compte = candidats.length === 1 ? candidats[0] : null;
          if (candidats.length > 1) {
            ecarter('reseau');
            continue;
          }
        }
        if (!compte) {
          ecarter('compte-inconnu');
          continue;
        }
        if (!peutSur(d, 'cm.editer', compte.team_id) || !peutSur(d, 'cm.voir', compte.team_id)) {
          ecarter('permission');
          continue;
        }
        lot.push(instructionReleve('compte', compte.id, jour, valeurs, { source: 'csv', saisiPar: acteur.compte, t }));
        bilan.releves++;
      }
    }
    if (lot.length) {
      lot.push(ev('cm.reseau_import', acteur, 'cm_rs_import', null, { genre, releves: bilan.releves, crees: bilan.crees, invalides: bilan.invalides.length }, t));
      for (let i = 0; i < lot.length; i += 400) await base.lot(lot.slice(i, i + 400));
    }
    return { ...bilan, invalides: bilan.invalides.slice(0, 200), nInvalides: bilan.invalides.length };
  }

  /** `GET /cm/reseaux/export/(posts|comptes).csv` : un relevé par ligne (publications ou comptes visibles). */
  async function exporter(acteur, genre) {
    const d = await droitsReseaux(base, acteur);
    const t = maintenant();
    const nom = `reseaux-${genre}-${jourDans(t, FUSEAU)}.csv`;
    if (genre === 'posts') {
      const pubs = await publicationsVisibles(d, {});
      const releves = await relevesDe(pubs.map(p => p.id));
      const comptes = new Map((await lignesParIds(base, 'SELECT id, identifiant FROM cm_rs_comptes WHERE id', pubs.map(p => p.compte_id).filter(Boolean))).map(c => [c.id, c.identifiant]));
      const teams = await teamsConnues(pubs.map(p => p.team_id));
      const lignes = [];
      for (const p of pubs) {
        const jourPub = jourDans(Date.parse(p.publie_le), FUSEAU);
        const rs = [...(releves.get(p.id) ?? [])].sort((a, b) => a.jour.localeCompare(b.jour));
        for (const r of rs.length ? rs : [null]) {
          lignes.push([p.url, p.reseau, p.compte_id ? (comptes.get(p.compte_id) ?? '') : '', p.titre, p.type_contenu, p.team_id ? (teams.get(p.team_id) ?? '') : '', jourPub, r?.jour ?? '', r ? ecartJours(jourPub, r.jour) : '', ...METRIQUES_POST.map(m => (r?.[m] === null || r?.[m] === undefined ? '' : r[m])), r ? (tauxEngagement(r) ?? '') : '', r?.source ?? '']);
        }
      }
      await base.lot([ev('cm.reseau_export', acteur, 'cm_rs_export', null, { genre, n: lignes.length }, t)]);
      return { nom, type: 'text/csv; charset=utf-8', contenu: ecrireCsv(['url', 'reseau', 'compte', 'titre', 'type', 'team', 'publie_le', 'jour', 'j_plus', ...METRIQUES_POST, 'engagement_pct', 'source'], lignes) };
    }
    const comptes = await comptesVisibles(d);
    const teams = await teamsConnues(comptes.map(c => c.team_id));
    const releves = await lignesParIds(base, 'SELECT * FROM cm_rs_releves_comptes WHERE compte_id', comptes.map(c => c.id), { apres: ' ORDER BY jour' });
    const parCompte = new Map(comptes.map(c => [c.id, c]));
    const lignes = releves.map(r => {
      const c = parCompte.get(r.compte_id);
      return [c.identifiant, c.reseau, c.url, c.team_id ? (teams.get(c.team_id) ?? '') : '', r.jour, ...METRIQUES_COMPTE.map(m => (r[m] === null || r[m] === undefined ? '' : r[m])), r.source];
    });
    await base.lot([ev('cm.reseau_export', acteur, 'cm_rs_export', null, { genre, n: lignes.length }, t)]);
    return { nom, type: 'text/csv; charset=utf-8', contenu: ecrireCsv(['compte', 'reseau', 'url', 'team', 'jour', ...METRIQUES_COMPTE, 'source'], lignes) };
  }

  // ---------------------------------------------------------------- Réglages

  /** `PUT /cm/reseaux/reglages` `{ rappels }` : rappels J+1 / J+7 par défaut des nouvelles publications (cm.gerer). */
  async function changerReglages(acteur, corps) {
    const d = await droitsReseaux(base, acteur);
    exigerGerer(d);
    const actuel = await lireReglagesReseaux(base);
    const suivant = { rappels: corps?.rappels === undefined ? actuel.rappels : Boolean(corps.rappels) };
    const t = maintenant();
    await base.lot([
      {
        sql: `INSERT INTO cm_reglages (cle, valeur, maj_par, maj_le) VALUES ('reseaux', ?, ?, ?)
              ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur, maj_par = excluded.maj_par, maj_le = excluded.maj_le`,
        params: [JSON.stringify(suivant), acteur.compte, iso(t)],
      },
      ev('cm.reseau_reglages', acteur, 'cm_reglages', 'reseaux', suivant, t),
    ]);
    return suivant;
  }

  return {
    etat,
    creerCompte,
    modifierCompte,
    supprimerCompte,
    reglerAnnonce,
    apercu,
    tester,
    ajouterSalon,
    modifierSalon,
    supprimerSalon,
    testerSalon,
    annonces,
    publications,
    publication,
    creerPublication,
    modifierPublication,
    supprimerPublication,
    releverPost,
    supprimerRelevePost,
    relevesCompte,
    releverCompte,
    supprimerReleveCompte,
    tableauDeBord,
    apercuImport,
    importer,
    exporter,
    changerReglages,
    droits: acteur => droitsReseaux(base, acteur),
  };
}
