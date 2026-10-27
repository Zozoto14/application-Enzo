/**
 * Module « Tournois » (migration 0022) : fiche du tournoi, roster inscrit, inscription et check-in,
 * parcours (bracket simple saisi à la main), matchs reliés au planning, classement final et gains.
 *
 * Contrôles de chaque route : session → appartenance à la team (404) → module `tournois` activé (404)
 * → permission (`tournois.voir` / `tournois.gerer`, 403). Toute requête filtre sur `team_id`.
 *
 * Tout suit le PROFIL DE JEU de la team : formats proposés (taille et nombre d'équipes, BO), taille du
 * roster (titulaires et remplaçants), système de score (série ou classement) pour le résultat rapide.
 *
 * Planning : un match daté crée (et tient à jour) un événement « Tournoi » du planning, dont la
 * convocation est le roster du tournoi (les convocations, rappels, RSVP et la présence habituels
 * s'appliquent). Il faut le module Planning et la permission de créer / modifier / supprimer au
 * planning ; sinon le match est gardé sans événement et la réponse le dit (`planning.raison`).
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { libelleFormat } from '../jeux/schema.mjs';
import { CLE_PROPRIETAIRE } from '../permissions.mjs';
import {
  MODULE_RESULTATS,
  MODULE_TOURNOIS,
  adversairesAffiches,
  adversairesParId,
  booleen,
  entierOuNull,
  exigerModule,
  exigerUuid,
  lireAdversaires,
  lireDevise,
  lireInstant,
  lireJour,
  lireLien,
  lireMontant,
  membresTeam,
  peut,
  profilDuJeu,
} from './commun.mjs';
import { scoreCourt } from './score.mjs';

export const STATUTS_TOURNOI = ['a_venir', 'inscrit', 'en_cours', 'termine', 'annule'];
export const TYPES_PHASE = ['poules', 'simple', 'double', 'suisse', 'championnat', 'libre'];
export const STATUTS_MATCH = ['a_jouer', 'joue', 'annule'];
export const ISSUES_RAPIDES = ['victoire', 'defaite', 'nul', 'forfait_pour', 'forfait_contre'];
const MAX = { tournois: 300, matchs: 80, phases: 8 };
const DUREE_DEFAUT_MIN = 90;

export function servicesTournois({ base, maintenant = () => Date.now(), socle, planning }) {
  const { contexteTeam } = socle;

  async function contexte(acteur, teamId, permission) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx, MODULE_TOURNOIS, permission);
    return ctx;
  }

  async function tournoiDeTeam(teamId, id) {
    exigerUuid(id, 'tournoi');
    const t = await base.premier('SELECT * FROM tournois WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!t) throw echec(404, 'tournoi-introuvable', 'Tournoi introuvable.');
    return t;
  }

  async function matchDeTournoi(tournoi, id) {
    exigerUuid(id, 'match');
    const m = await base.premier('SELECT * FROM tournoi_matchs WHERE id = ? AND tournoi_id = ? AND team_id = ? AND supprime_le IS NULL', [id, tournoi.id, tournoi.team_id]);
    if (!m) throw echec(404, 'match-introuvable', 'Match introuvable.');
    return m;
  }

  const droits = ctx => ({
    gerer: peut(ctx, 'tournois.gerer'),
    planning: peut(ctx, 'planning.view'),
    planifier: peut(ctx, 'planning.create'),
    resultats: peut(ctx, 'resultats.voir'),
    saisirResultats: peut(ctx, 'resultats.saisir'),
    scouting: peut(ctx, 'scouting.view'),
  });

  /** Taille du roster permise par le profil du jeu : titulaires (au plus / au moins) et remplaçants. */
  function tailleRoster(donnees, formatCle) {
    const format = donnees.formats.find(f => f.cle === formatCle) ?? donnees.formats[0] ?? null;
    const titulairesMax = donnees.roster?.titulaires ?? format?.joueursParEquipe ?? 12;
    const titulairesMin = Math.min(titulairesMax, format?.joueursParEquipe ?? donnees.roster?.titulaires ?? 1);
    const remplacantsMax = donnees.roster ? donnees.roster.remplacants : 6;
    return { titulairesMin, titulairesMax, remplacantsMax };
  }

  const formatPublic = (donnees, cle) => {
    const f = donnees.formats.find(x => x.cle === cle);
    return f ? { cle: f.cle, nom: f.nom, libelle: libelleFormat(f), equipes: f.equipes, joueursParEquipe: f.joueursParEquipe, bo: f.bo } : null;
  };

  // -------------------------------------------------------------- Lecture

  async function rosterDe(ids) {
    const lignes = ids.length
      ? await base.tous(
          `SELECT r.tournoi_id, r.compte_id, r.role, r.position, c.pseudo FROM tournoi_roster r LEFT JOIN comptes c ON c.id = r.compte_id
            WHERE r.tournoi_id IN (${ids.map(() => '?').join(', ')}) ORDER BY r.role DESC, r.position`,
          ids,
        )
      : [];
    const parTournoi = new Map(ids.map(id => [id, []]));
    for (const l of lignes) parTournoi.get(l.tournoi_id)?.push({ compte: l.compte_id, pseudo: l.pseudo ?? null, role: l.role });
    return parTournoi;
  }

  function fiche(t, profil, roster) {
    return {
      id: t.id,
      nom: t.nom,
      organisateur: t.organisateur,
      lien: t.lien ?? null,
      jeu: t.jeu,
      format: formatPublic(profil.donnees, t.format_cle),
      formatCle: t.format_cle ?? null,
      bo: t.bo === null || t.bo === undefined ? null : Number(t.bo),
      debut: t.debut ?? null,
      fin: t.fin ?? null,
      enLigne: Number(t.en_ligne) === 1,
      lieu: t.lieu,
      phases: jsonOu(t.phases, []),
      fraisCentimes: t.frais_centimes === null || t.frais_centimes === undefined ? null : Number(t.frais_centimes),
      cashprizeCentimes: t.cashprize_centimes === null || t.cashprize_centimes === undefined ? null : Number(t.cashprize_centimes),
      devise: t.devise,
      cashprizeDetails: t.cashprize_details,
      statut: t.statut,
      inscription: { limite: t.inscription_limite ?? null, inscritLe: t.inscrit_le ?? null },
      checkin: { ouverture: t.checkin_ouverture ?? null, limite: t.checkin_limite ?? null, faitLe: t.checkin_le ?? null },
      classementFinal: t.classement_final === null || t.classement_final === undefined ? null : Number(t.classement_final),
      participants: t.participants === null || t.participants === undefined ? null : Number(t.participants),
      gainsCentimes: t.gains_centimes === null || t.gains_centimes === undefined ? null : Number(t.gains_centimes),
      gainsNotes: t.gains_notes,
      notes: t.notes,
      publiable: Number(t.publiable) === 1,
      roster,
      creeLe: t.cree_le,
      majLe: t.maj_le,
    };
  }

  /** Résultats détaillés visibles par l'acteur (module Résultats, visibilité) : `{ issue, score, place }` par id. */
  async function resultatsVisibles(ctx, ids) {
    if (!ids.length || !peut(ctx, 'resultats.voir')) return new Map();
    const staff = peut(ctx, 'resultats.saisir');
    const lignes = await base.tous(
      `SELECT id, systeme, bo, issue, forfait, manches_nous, manches_eux, place, points, score, visibilite FROM resultats
        WHERE team_id = ? AND supprime_le IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
      [ctx.team.id, ...ids],
    );
    const sortie = new Map();
    for (const r of lignes) {
      if (r.visibilite === 'staff' && !staff) continue;
      const score = jsonOu(r.score, {});
      sortie.set(r.id, {
        id: r.id,
        issue: r.issue ?? null,
        place: r.place === null ? null : Number(r.place),
        points: r.points === null ? null : Number(r.points),
        score: scoreCourt({ systeme: r.systeme, bo: Number(r.bo), forfait: r.forfait, manches: score.manches ?? [], manchesNous: r.manches_nous === null ? null : Number(r.manches_nous), manchesEux: r.manches_eux === null ? null : Number(r.manches_eux), place: r.place }),
      });
    }
    return sortie;
  }

  function matchPublic(m, fiches, resultats, ctx) {
    const resultat = m.resultat_id ? (resultats.get(m.resultat_id) ?? null) : null;
    return {
      id: m.id,
      phase: m.phase ?? null,
      tour: m.tour,
      ordre: Number(m.ordre),
      debut: m.debut ?? null,
      fin: m.fin ?? null,
      bo: m.bo === null || m.bo === undefined ? null : Number(m.bo),
      adversaires: adversairesAffiches(jsonOu(m.adversaires, []), fiches),
      statut: m.statut,
      issue: resultat?.issue ?? (m.issue === 'forfait_pour' ? 'victoire' : m.issue === 'forfait_contre' ? 'defaite' : (m.issue ?? null)),
      issueRapide: m.issue ?? null,
      scoreTexte: resultat?.score || m.score_texte,
      place: resultat?.place ?? (m.place === null || m.place === undefined ? null : Number(m.place)),
      resultatId: resultat ? resultat.id : null,
      aResultat: Boolean(m.resultat_id),
      evenementId: peut(ctx, 'planning.view') ? (m.evenement_id ?? null) : null,
      notes: m.notes,
    };
  }

  /** Bilan d'un tournoi : victoires, défaites, nuls (résultat détaillé ou rapide). */
  function bilanMatchs(matchs) {
    const b = { joues: 0, victoires: 0, defaites: 0, nuls: 0 };
    for (const m of matchs) {
      if (!m.issue) continue;
      b.joues++;
      if (m.issue === 'victoire') b.victoires++;
      else if (m.issue === 'defaite') b.defaites++;
      else b.nuls++;
    }
    return b;
  }

  async function liste(acteur, teamId, { statut } = {}) {
    const ctx = await contexte(acteur, teamId, 'tournois.voir');
    if (statut !== undefined && !STATUTS_TOURNOI.includes(statut)) throw echec(400, 'statut', 'Statut inconnu.');
    const lignes = await base.tous(
      `SELECT * FROM tournois WHERE team_id = ? AND supprime_le IS NULL ${statut ? 'AND statut = ?' : ''} ORDER BY COALESCE(debut, cree_le) DESC LIMIT ?`,
      statut ? [teamId, statut, MAX.tournois] : [teamId, MAX.tournois],
    );
    const ids = lignes.map(t => t.id);
    const rosters = await rosterDe(ids);
    const matchs = ids.length ? await base.tous(`SELECT * FROM tournoi_matchs WHERE team_id = ? AND supprime_le IS NULL AND tournoi_id IN (${ids.map(() => '?').join(', ')}) ORDER BY ordre, debut`, [teamId, ...ids]) : [];
    const fiches = await adversairesParId(base, teamId, matchs.flatMap(m => jsonOu(m.adversaires, []).map(a => a.id)).filter(Boolean));
    const resultats = await resultatsVisibles(ctx, matchs.map(m => m.resultat_id).filter(Boolean));
    const profils = new Map();
    const sortie = [];
    const t0 = maintenant();
    for (const t of lignes) {
      if (!profils.has(t.jeu)) profils.set(t.jeu, await profilDuJeu(base, t.jeu));
      const ms = matchs.filter(m => m.tournoi_id === t.id).map(m => matchPublic(m, fiches, resultats, ctx));
      const prochain = ms.filter(m => m.debut && m.statut === 'a_jouer' && Date.parse(m.fin ?? m.debut) >= t0).sort((a, b) => a.debut.localeCompare(b.debut))[0] ?? null;
      sortie.push({ ...fiche(t, profils.get(t.jeu), rosters.get(t.id) ?? []), matchs: ms.length, bilan: bilanMatchs(ms), prochainMatch: prochain });
    }
    return { tournois: sortie, droits: droits(ctx), jeu: await jeuPourFormulaire(ctx) };
  }

  /** Ce que le formulaire propose : formats et BO du profil, taille du roster, membres. */
  async function jeuPourFormulaire(ctx) {
    const profil = await profilDuJeu(base, ctx.team.jeu);
    const d = profil.donnees;
    return {
      cle: profil.cle,
      nom: profil.nom,
      couleur: profil.couleur,
      formats: d.formats.map(f => ({ cle: f.cle, nom: f.nom, libelle: libelleFormat(f), equipes: f.equipes, joueursParEquipe: f.joueursParEquipe, bo: f.bo })),
      score: d.score ? { type: d.score.type } : null,
      roster: tailleRoster(d, d.formats[0]?.cle),
      membres: peut(ctx, 'tournois.gerer') ? (await membresTeam(base, ctx.team.id)).map(m => ({ compte: m.compte, pseudo: m.pseudo })) : [],
    };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId, 'tournois.voir');
    const t = await tournoiDeTeam(teamId, id);
    const profil = await profilDuJeu(base, t.jeu);
    const roster = (await rosterDe([t.id])).get(t.id) ?? [];
    const lignes = await base.tous('SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL ORDER BY ordre, debut, cree_le', [t.id, teamId]);
    const fiches = await adversairesParId(base, teamId, lignes.flatMap(m => jsonOu(m.adversaires, []).map(a => a.id)).filter(Boolean));
    const resultats = await resultatsVisibles(ctx, lignes.map(m => m.resultat_id).filter(Boolean));
    const matchs = lignes.map(m => matchPublic(m, fiches, resultats, ctx));
    const taille = tailleRoster(profil.donnees, t.format_cle);
    return {
      tournoi: fiche(t, profil, roster),
      matchs,
      bilan: bilanMatchs(matchs),
      rosterTaille: taille,
      droits: droits(ctx),
      jeu: await jeuPourFormulaire(ctx),
      modules: { planning: ctx.modules.has('planning'), resultats: ctx.modules.has(MODULE_RESULTATS) },
    };
  }

  // -------------------------------------------------------------- Écriture : fiche

  async function lireFiche(ctx, corps, existant) {
    const s = {};
    const champ = nom => corps?.[nom] !== undefined;
    const profil = await profilDuJeu(base, existant?.jeu ?? ctx.team.jeu);
    if (!existant || champ('nom')) {
      s.nom = texteNettoye(corps?.nom, 80);
      if (s.nom.length < 2) throw echec(400, 'nom', 'Nom : 2 caractères au moins.');
    }
    if (champ('organisateur')) s.organisateur = texteNettoye(corps.organisateur, 80);
    if (champ('lien')) s.lien = lireLien(corps.lien);
    if (!existant || champ('formatCle')) {
      const cle = corps?.formatCle;
      if (cle === undefined || cle === null || cle === '') s.format_cle = existant ? null : (profil.donnees.formats[0]?.cle ?? null);
      else {
        if (!profil.donnees.formats.some(f => f.cle === cle)) throw echec(400, 'format', 'Format inconnu pour ce jeu.');
        s.format_cle = cle;
      }
    }
    if (champ('bo') || champ('formatCle')) {
      const bo = entierOuNull(corps?.bo, 'bo', 1, 20);
      const format = profil.donnees.formats.find(f => f.cle === (s.format_cle ?? existant?.format_cle));
      if (bo !== null && format && !format.bo.includes(bo)) throw echec(400, 'bo', 'BO non prévu par ce format.');
      s.bo = bo;
    }
    if (champ('debut')) s.debut = lireJour(corps.debut);
    if (champ('fin')) s.fin = lireJour(corps.fin);
    const debut = s.debut !== undefined ? s.debut : existant?.debut;
    const fin = s.fin !== undefined ? s.fin : existant?.fin;
    if (debut && fin && fin < debut) throw echec(400, 'fin', 'La fin doit suivre le début.');
    if (champ('enLigne')) s.en_ligne = booleen(corps.enLigne, true) ? 1 : 0;
    if (champ('lieu')) s.lieu = texteNettoye(corps.lieu, 200);
    if (champ('phases')) {
      if (!Array.isArray(corps.phases) || corps.phases.length > MAX.phases) throw echec(400, 'phases', 'Phases : 8 au plus.');
      const cles = new Set();
      s.phases = JSON.stringify(
        corps.phases.map((p, i) => {
          if (!TYPES_PHASE.includes(p?.type)) throw echec(400, 'phases', 'Type de phase inconnu.');
          let cle = typeof p.cle === 'string' && /^[a-z0-9-]{1,20}$/.test(p.cle) ? p.cle : `p${i + 1}`;
          while (cles.has(cle)) cle = `${cle}-${i + 1}`;
          cles.add(cle);
          return { cle, type: p.type, nom: texteNettoye(p.nom, 40) };
        }),
      );
    }
    if (champ('frais')) s.frais_centimes = lireMontant(corps.frais, 'frais');
    if (champ('cashprize')) s.cashprize_centimes = lireMontant(corps.cashprize, 'cashprize');
    if (champ('devise')) s.devise = lireDevise(corps.devise);
    if (champ('cashprizeDetails')) s.cashprize_details = texteNettoye(corps.cashprizeDetails, 300);
    if (champ('statut')) {
      if (!STATUTS_TOURNOI.includes(corps.statut)) throw echec(400, 'statut', 'Statut inconnu.');
      s.statut = corps.statut;
    }
    const fuseau = ctx.team.fuseau;
    if (champ('inscriptionLimite')) s.inscription_limite = lireInstant(corps.inscriptionLimite, fuseau, 'inscription');
    if (champ('checkinOuverture')) s.checkin_ouverture = lireInstant(corps.checkinOuverture, fuseau, 'checkin');
    if (champ('checkinLimite')) s.checkin_limite = lireInstant(corps.checkinLimite, fuseau, 'checkin');
    const ouverture = s.checkin_ouverture !== undefined ? s.checkin_ouverture : existant?.checkin_ouverture;
    const limite = s.checkin_limite !== undefined ? s.checkin_limite : existant?.checkin_limite;
    if (ouverture && limite && limite <= ouverture) throw echec(400, 'checkin', 'La fin du check-in doit suivre son ouverture.');
    if (champ('participants')) s.participants = entierOuNull(corps.participants, 'participants', 2, 100_000);
    if (champ('classementFinal')) s.classement_final = entierOuNull(corps.classementFinal, 'classement', 1, 100_000);
    const participants = s.participants !== undefined ? s.participants : existant?.participants;
    const classement = s.classement_final !== undefined ? s.classement_final : existant?.classement_final;
    if (participants && classement && Number(classement) > Number(participants)) throw echec(400, 'classement', 'La place finale dépasse le nombre de participants.');
    if (champ('gains')) s.gains_centimes = lireMontant(corps.gains, 'gains');
    if (champ('gainsNotes')) s.gains_notes = texteNettoye(corps.gainsNotes, 300);
    if (champ('notes')) s.notes = texteLong(corps.notes, 4000);
    if (champ('publiable')) s.publiable = booleen(corps.publiable, true) ? 1 : 0;
    return s;
  }

  async function creer(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const s = await lireFiche(ctx, corps);
    const n = await base.premier('SELECT COUNT(*) AS n FROM tournois WHERE team_id = ? AND supprime_le IS NULL', [teamId]);
    if (Number(n?.n ?? 0) >= MAX.tournois) throw echec(409, 'trop-de-tournois', `Une team garde ${MAX.tournois} tournois au plus.`);
    const t = maintenant();
    const id = nouvelId();
    const ligne = { id, team_id: teamId, jeu: ctx.team.jeu, statut: 'a_venir', cree_par: acteur.compte, cree_le: iso(t), maj_le: iso(t), ...s };
    const colonnes = Object.keys(ligne);
    await base.lot([
      { sql: `INSERT INTO tournois (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(c => ligne[c]) },
      evenement('tournoi.cree', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: s.nom, statut: ligne.statut, debut: s.debut ?? null }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const ancien = await tournoiDeTeam(teamId, id);
    const s = await lireFiche(ctx, corps, ancien);
    const champs = Object.keys(s).filter(c => s[c] !== ancien[c] && !(s[c] === null && ancien[c] === undefined));
    if (champs.length === 0) return detail(acteur, teamId, id);
    const t = maintenant();
    const lot = [{ sql: `UPDATE tournois SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), id, teamId] }];
    const nom = s.nom ?? ancien.nom;
    lot.push(evenement('tournoi.modifie', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom, champs }, maintenant: t }));
    if (champs.includes('statut')) {
      const charge = { nom, de: ancien.statut, vers: s.statut, classementFinal: s.classement_final ?? (ancien.classement_final === null ? null : Number(ancien.classement_final)), participants: s.participants ?? (ancien.participants === null ? null : Number(ancien.participants)) };
      const type = s.statut === 'termine' ? 'tournoi.termine' : s.statut === 'annule' ? 'tournoi.annule' : 'tournoi.statut_change';
      lot.push(evenement(type, { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge, maintenant: t }));
    }
    await base.lot(lot);
    const avertissements = [];
    // Tournoi annulé : les matchs à venir quittent le planning (s'il est permis de les supprimer).
    if (s.statut === 'annule') {
      const futurs = await base.tous("SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL AND statut = 'a_jouer' AND evenement_id IS NOT NULL", [id, teamId]);
      for (const m of futurs) {
        if (m.debut && Date.parse(m.debut) < t) continue;
        const r = await retirerDuPlanning(ctx, acteur, m);
        if (r) avertissements.push(r);
      }
    }
    return { ...(await detail(acteur, teamId, id)), ...(avertissements.length ? { avertissements } : {}) };
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const t = maintenant();
    const matchs = await base.tous('SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    await base.lot([
      { sql: 'UPDATE tournois SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'UPDATE tournoi_matchs SET supprime_le = ?, maj_le = ? WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL', params: [iso(t), iso(t), id, teamId] },
      // Les résultats détaillés restent (historique, bilans), sans lien vers le tournoi supprimé.
      { sql: 'UPDATE resultats SET tournoi_match_id = NULL WHERE tournoi_id = ? AND team_id = ?', params: [id, teamId] },
      evenement('tournoi.supprime', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: tournoi.nom }, maintenant: t }),
    ]);
    // Les matchs encore à jouer quittent le planning ; ceux qui ont eu lieu y restent (présence, historique).
    for (const m of matchs) if (m.evenement_id && m.statut === 'a_jouer' && (!m.debut || Date.parse(m.debut) >= t)) await retirerDuPlanning(ctx, acteur, m);
    return { ok: true };
  }

  // -------------------------------------------------------------- Roster, inscription, check-in

  async function changerRoster(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const profil = await profilDuJeu(base, tournoi.jeu);
    const taille = tailleRoster(profil.donnees, tournoi.format_cle);
    const lire = v => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || v.length > 60) throw echec(400, 'roster', 'Roster illisible.');
      return v.filter(x => typeof x === 'string');
    };
    const titulaires = [...new Set(lire(corps?.titulaires))];
    const remplacants = [...new Set(lire(corps?.remplacants))].filter(c => !titulaires.includes(c));
    if (titulaires.length > taille.titulairesMax) throw echec(400, 'roster-titulaires', `${taille.titulairesMax} titulaires au plus pour ce jeu.`);
    if (remplacants.length > taille.remplacantsMax) throw echec(400, 'roster-remplacants', `${taille.remplacantsMax} remplaçants au plus pour ce jeu.`);
    const membres = new Set((await membresTeam(base, teamId)).map(m => m.compte));
    const inconnus = [...titulaires, ...remplacants].filter(c => !membres.has(c));
    if (inconnus.length) {
      const e = echec(400, 'roster-membre', 'Un joueur du roster ne fait pas partie de la team.');
      e.details = { inconnus };
      throw e;
    }
    const t = maintenant();
    const lot = [{ sql: 'DELETE FROM tournoi_roster WHERE tournoi_id = ? AND team_id = ?', params: [id, teamId] }];
    titulaires.forEach((c, i) => lot.push({ sql: 'INSERT INTO tournoi_roster (tournoi_id, compte_id, team_id, role, position, cree_le) VALUES (?, ?, ?, ?, ?, ?)', params: [id, c, teamId, 'titulaire', i, iso(t)] }));
    remplacants.forEach((c, i) => lot.push({ sql: 'INSERT INTO tournoi_roster (tournoi_id, compte_id, team_id, role, position, cree_le) VALUES (?, ?, ?, ?, ?, ?)', params: [id, c, teamId, 'remplacant', i, iso(t)] }));
    lot.push({ sql: 'UPDATE tournois SET maj_le = ? WHERE id = ?', params: [iso(t), id] });
    lot.push(evenement('tournoi.roster_change', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: tournoi.nom, titulaires: titulaires.length, remplacants: remplacants.length }, maintenant: t }));
    await base.lot(lot);
    // Les convocations des matchs à venir suivent le roster.
    const avertissements = [];
    const futurs = await base.tous("SELECT * FROM tournoi_matchs WHERE tournoi_id = ? AND team_id = ? AND supprime_le IS NULL AND statut = 'a_jouer' AND evenement_id IS NOT NULL", [id, teamId]);
    for (const m of futurs) {
      if (m.debut && Date.parse(m.fin ?? m.debut) < t) continue;
      const r = await synchroniserPlanning(ctx, acteur, await tournoiDeTeam(teamId, id), m);
      if (r.raison) avertissements.push(r.raison);
    }
    return { ...(await detail(acteur, teamId, id)), ...(avertissements.length ? { avertissements: [...new Set(avertissements)] } : {}) };
  }

  async function inscrire(acteur, teamId, id, corps = {}) {
    await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const t = maintenant();
    if (corps?.annuler === true) {
      if (!tournoi.inscrit_le) return detail(acteur, teamId, id);
      await base.lot([
        { sql: "UPDATE tournois SET inscrit_le = NULL, inscrit_par = NULL, checkin_le = NULL, checkin_par = NULL, statut = CASE WHEN statut = 'inscrit' THEN 'a_venir' ELSE statut END, maj_le = ? WHERE id = ? AND team_id = ?", params: [iso(t), id, teamId] },
        evenement('tournoi.statut_change', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: tournoi.nom, de: tournoi.statut, vers: tournoi.statut === 'inscrit' ? 'a_venir' : tournoi.statut, desinscription: true }, maintenant: t }),
      ]);
      return detail(acteur, teamId, id);
    }
    if (tournoi.statut === 'termine' || tournoi.statut === 'annule') throw echec(409, 'tournoi-clos', 'Ce tournoi est terminé ou annulé.');
    if (tournoi.inscrit_le) return detail(acteur, teamId, id);
    if (tournoi.inscription_limite && Date.parse(tournoi.inscription_limite) < t) throw echec(409, 'inscription-close', 'La date limite d’inscription est passée.');
    const profil = await profilDuJeu(base, tournoi.jeu);
    const taille = tailleRoster(profil.donnees, tournoi.format_cle);
    const n = await base.premier("SELECT COUNT(*) AS n FROM tournoi_roster WHERE tournoi_id = ? AND team_id = ? AND role = 'titulaire'", [id, teamId]);
    if (Number(n?.n ?? 0) < taille.titulairesMin) {
      const e = echec(409, 'roster-incomplet', `Il faut au moins ${taille.titulairesMin} titulaires pour s’inscrire.`);
      e.details = { titulaires: Number(n?.n ?? 0), minimum: taille.titulairesMin };
      throw e;
    }
    await base.lot([
      { sql: "UPDATE tournois SET inscrit_le = ?, inscrit_par = ?, statut = CASE WHEN statut = 'a_venir' THEN 'inscrit' ELSE statut END, maj_le = ? WHERE id = ? AND team_id = ?", params: [iso(t), acteur.compte, iso(t), id, teamId] },
      evenement('tournoi.inscrit', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: tournoi.nom, debut: tournoi.debut ?? null }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  async function checkin(acteur, teamId, id) {
    await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const t = maintenant();
    if (!tournoi.inscrit_le) throw echec(409, 'non-inscrit', 'Inscrivez d’abord la team.');
    if (tournoi.statut === 'termine' || tournoi.statut === 'annule') throw echec(409, 'tournoi-clos', 'Ce tournoi est terminé ou annulé.');
    if (tournoi.checkin_le) return detail(acteur, teamId, id);
    if (tournoi.checkin_ouverture && Date.parse(tournoi.checkin_ouverture) > t) throw echec(409, 'checkin-pas-ouvert', 'Le check-in n’est pas encore ouvert.');
    if (tournoi.checkin_limite && Date.parse(tournoi.checkin_limite) < t) throw echec(409, 'checkin-ferme', 'Le check-in est fermé.');
    await base.lot([
      { sql: 'UPDATE tournois SET checkin_le = ?, checkin_par = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), acteur.compte, iso(t), id, teamId] },
      evenement('tournoi.checkin', { teamId, acteur: acteur.compte, entiteType: 'tournoi', entiteId: id, charge: { nom: tournoi.nom }, maintenant: t }),
    ]);
    return detail(acteur, teamId, id);
  }

  // -------------------------------------------------------------- Planning

  /** Titre de l'événement du planning d'un match (80 caractères au plus). */
  function titreMatch(tournoi, m) {
    const adv = jsonOu(m.adversaires, []).map(a => a.nom).filter(Boolean);
    const morceaux = [tournoi.nom, m.tour || null].filter(Boolean).join(' · ');
    const vs = adv.length ? ` vs ${adv.slice(0, 3).join(', ')}${adv.length > 3 ? '…' : ''}` : '';
    const titre = `${morceaux}${vs}`;
    return titre.length > 80 ? `${titre.slice(0, 79)}…` : titre;
  }

  /** Convocation du roster (actifs) ; sans roster : null (défaut du planning : les joueurs). */
  async function convocationRoster(tournoi) {
    const actifs = new Map((await membresTeam(base, tournoi.team_id)).map(m => [m.compte, m]));
    const roster = (await base.tous('SELECT compte_id FROM tournoi_roster WHERE tournoi_id = ?', [tournoi.id])).map(l => l.compte_id).filter(c => actifs.has(c));
    if (roster.length === 0) return null;
    const proprietaires = roster.filter(c => actifs.get(c).cle === CLE_PROPRIETAIRE || c === 'principal');
    return { groupes: [], membres: roster.filter(c => !proprietaires.includes(c)), exclus: [], proprietaires };
  }

  /**
   * Crée ou met à jour l'événement du planning d'un match daté. Rend `{ evenementId, raison? }` ; une
   * raison (`module`, `permission`) dit pourquoi il n'y a pas d'événement.
   */
  async function synchroniserPlanning(ctx, acteur, tournoi, m) {
    if (!planning || !m.debut || m.statut === 'annule') return { evenementId: m.evenement_id ?? null };
    if (!ctx.modules.has('planning')) return { evenementId: m.evenement_id ?? null, raison: 'module' };
    const adversaire = jsonOu(m.adversaires, []).find(a => a.id)?.id ?? null;
    const convocation = await convocationRoster(tournoi);
    const lieu = Number(tournoi.en_ligne) === 1 ? (tournoi.lien ?? '') : tournoi.lieu;
    const corps = {
      type: 'tournament',
      titre: titreMatch(tournoi, m),
      debut: m.debut,
      fin: m.fin ?? new Date(Date.parse(m.debut) + DUREE_DEFAUT_MIN * 60_000).toISOString(),
      lieu: String(lieu ?? '').slice(0, 200),
      description: m.notes ?? '',
      adversaireId: adversaire,
      ...(convocation ? { convocation } : {}),
    };
    const interne = { adversaireLibre: true, charge: { tournoiMatchId: m.id, tournoiId: tournoi.id } };
    if (m.evenement_id) {
      const vivant = await base.premier('SELECT id FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [m.evenement_id, tournoi.team_id]);
      if (vivant) {
        if (!peut(ctx, 'planning.update')) return { evenementId: m.evenement_id, raison: 'permission' };
        // Sans roster, la convocation de l'événement (choisie au planning) reste telle quelle.
        await planning.modifier(acteur, tournoi.team_id, m.evenement_id, corps, interne);
        return { evenementId: m.evenement_id };
      }
    }
    if (!peut(ctx, 'planning.create')) return { evenementId: null, raison: 'permission' };
    const cree = await planning.creer(acteur, tournoi.team_id, corps, interne);
    await base.executer('UPDATE tournoi_matchs SET evenement_id = ? WHERE id = ? AND team_id = ?', [cree.id, m.id, tournoi.team_id]);
    return { evenementId: cree.id };
  }

  /** Retire l'événement du planning d'un match (annulé, supprimé, plus de date). Rend une raison si impossible. */
  async function retirerDuPlanning(ctx, acteur, m) {
    if (!planning || !m.evenement_id) return null;
    const vivant = await base.premier('SELECT id FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [m.evenement_id, m.team_id]);
    if (vivant) {
      if (!ctx.modules.has('planning')) return 'module';
      if (!peut(ctx, 'planning.delete')) return 'permission';
      await planning.supprimer(acteur, m.team_id, m.evenement_id);
    }
    await base.executer('UPDATE tournoi_matchs SET evenement_id = NULL WHERE id = ? AND team_id = ?', [m.id, m.team_id]);
    return null;
  }

  // -------------------------------------------------------------- Matchs (parcours)

  async function lireMatch(ctx, tournoi, corps, existant) {
    const s = {};
    const champ = nom => corps?.[nom] !== undefined;
    const phases = jsonOu(tournoi.phases, []);
    if (champ('phase')) {
      const p = corps.phase === null || corps.phase === '' ? null : corps.phase;
      if (p !== null && !phases.some(x => x.cle === p)) throw echec(400, 'phase', 'Phase inconnue.');
      s.phase = p;
    }
    if (!existant || champ('tour')) s.tour = texteNettoye(corps?.tour, 60);
    if (champ('ordre')) s.ordre = entierOuNull(corps.ordre, 'ordre', 0, 10_000) ?? 0;
    const horaire = ['debut', 'date', 'heure', 'dureeMin'].some(champ);
    if (horaire) {
      const debut = corps.debut !== undefined ? lireInstant(corps.debut, ctx.team.fuseau) : corps.date ? lireInstant(`${corps.date} ${corps.heure ?? '20:00'}`, ctx.team.fuseau) : corps.date === null || corps.date === '' ? null : (existant?.debut ?? null);
      const duree = entierOuNull(corps.dureeMin, 'duree', 15, 24 * 60) ?? (existant?.debut && existant?.fin ? Math.round((Date.parse(existant.fin) - Date.parse(existant.debut)) / 60_000) : DUREE_DEFAUT_MIN);
      s.debut = debut;
      s.fin = debut ? new Date(Date.parse(debut) + duree * 60_000).toISOString() : null;
    }
    if (champ('bo')) s.bo = entierOuNull(corps.bo, 'bo', 1, 20);
    if (!existant || champ('adversaires')) {
      const profil = await profilDuJeu(base, tournoi.jeu);
      const format = profil.donnees.formats.find(f => f.cle === tournoi.format_cle);
      s.adversaires = JSON.stringify(await lireAdversaires(base, tournoi.team_id, corps?.adversaires ?? [], { max: format && format.equipes > 2 ? format.equipes - 1 : 63 }));
    }
    if (champ('statut')) {
      if (!STATUTS_MATCH.includes(corps.statut)) throw echec(400, 'statut', 'Statut inconnu.');
      s.statut = corps.statut;
    }
    if (champ('issue')) {
      if (corps.issue !== null && corps.issue !== '' && !ISSUES_RAPIDES.includes(corps.issue)) throw echec(400, 'issue', 'Résultat inconnu.');
      s.issue = corps.issue || null;
      if (s.issue && s.statut === undefined && (existant?.statut ?? 'a_jouer') === 'a_jouer') s.statut = 'joue';
    }
    if (champ('scoreTexte')) s.score_texte = texteNettoye(corps.scoreTexte, 20);
    if (champ('place')) {
      s.place = entierOuNull(corps.place, 'place', 1, 100_000);
      if (s.place !== null && s.statut === undefined && (existant?.statut ?? 'a_jouer') === 'a_jouer') s.statut = 'joue';
    }
    if (champ('notes')) s.notes = texteLong(corps.notes, 2000);
    return s;
  }

  async function ajouterMatch(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const n = await base.premier('SELECT COUNT(*) AS n, MAX(ordre) AS dernier FROM tournoi_matchs WHERE tournoi_id = ? AND supprime_le IS NULL', [id]);
    if (Number(n?.n ?? 0) >= MAX.matchs) throw echec(409, 'trop-de-matchs', `Un tournoi garde ${MAX.matchs} matchs au plus.`);
    const s = await lireMatch(ctx, tournoi, corps);
    const t = maintenant();
    const matchId = nouvelId();
    const ligne = { id: matchId, team_id: teamId, tournoi_id: id, ordre: s.ordre ?? (n?.dernier === null || n?.dernier === undefined ? 0 : Number(n.dernier) + 1), statut: 'a_jouer', cree_par: acteur.compte, cree_le: iso(t), maj_le: iso(t), ...s };
    const colonnes = Object.keys(ligne);
    const charge = { nom: tournoi.nom, tour: ligne.tour ?? '', debut: ligne.debut ?? null, adversaires: jsonOu(ligne.adversaires, []).map(a => a.nom) };
    const lot = [
      { sql: `INSERT INTO tournoi_matchs (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(c => ligne[c]) },
      evenement('tournoi.match_ajoute', { teamId, acteur: acteur.compte, entiteType: 'tournoi_match', entiteId: matchId, charge: { ...charge, tournoiId: id }, maintenant: t }),
    ];
    if (ligne.debut && ligne.statut === 'a_jouer') lot.push(evenement('tournoi.match_planifie', { teamId, acteur: acteur.compte, entiteType: 'tournoi_match', entiteId: matchId, charge: { ...charge, tournoiId: id }, maintenant: t }));
    await base.lot(lot);
    const m = await matchDeTournoi(tournoi, matchId);
    const p = await synchroniserPlanning(ctx, acteur, tournoi, m);
    return { ...(await detail(acteur, teamId, id)), match: matchId, planning: p };
  }

  async function modifierMatch(acteur, teamId, id, matchId, corps) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const ancien = await matchDeTournoi(tournoi, matchId);
    const s = await lireMatch(ctx, tournoi, corps, ancien);
    const champs = Object.keys(s).filter(c => s[c] !== ancien[c] && !(s[c] === null && ancien[c] === undefined));
    if (champs.length === 0) return { ...(await detail(acteur, teamId, id)), match: matchId, planning: { evenementId: ancien.evenement_id ?? null } };
    const t = maintenant();
    const apres = { ...ancien, ...s };
    const charge = { nom: tournoi.nom, tour: apres.tour, debut: apres.debut ?? null, adversaires: jsonOu(apres.adversaires, []).map(a => a.nom), champs, tournoiId: id };
    const lot = [
      { sql: `UPDATE tournoi_matchs SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), matchId, teamId] },
      evenement('tournoi.match_modifie', { teamId, acteur: acteur.compte, entiteType: 'tournoi_match', entiteId: matchId, charge, maintenant: t }),
    ];
    if (champs.includes('debut') && apres.debut && apres.statut === 'a_jouer') lot.push(evenement('tournoi.match_planifie', { teamId, acteur: acteur.compte, entiteType: 'tournoi_match', entiteId: matchId, charge, maintenant: t }));
    await base.lot(lot);
    const m = await matchDeTournoi(tournoi, matchId);
    let p = { evenementId: m.evenement_id ?? null };
    // Planning : annulé ou sans date → l'événement part ; sinon il suit l'horaire, le titre, l'adversaire.
    if (m.statut === 'annule' || (!m.debut && m.evenement_id)) {
      const raison = await retirerDuPlanning(ctx, acteur, m);
      p = raison ? { evenementId: m.evenement_id, raison } : { evenementId: null };
    } else if (['debut', 'fin', 'tour', 'adversaires', 'notes', 'statut'].some(c => champs.includes(c)) && m.statut === 'a_jouer') {
      p = await synchroniserPlanning(ctx, acteur, tournoi, m);
    }
    return { ...(await detail(acteur, teamId, id)), match: matchId, planning: p };
  }

  async function supprimerMatch(acteur, teamId, id, matchId) {
    const ctx = await contexte(acteur, teamId, 'tournois.gerer');
    const tournoi = await tournoiDeTeam(teamId, id);
    const m = await matchDeTournoi(tournoi, matchId);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE tournoi_matchs SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), matchId, teamId] },
      { sql: 'UPDATE resultats SET tournoi_match_id = NULL WHERE tournoi_match_id = ? AND team_id = ?', params: [matchId, teamId] },
      evenement('tournoi.match_supprime', { teamId, acteur: acteur.compte, entiteType: 'tournoi_match', entiteId: matchId, charge: { nom: tournoi.nom, tour: m.tour, tournoiId: id }, maintenant: t }),
    ]);
    const raison = m.statut === 'a_jouer' ? await retirerDuPlanning(ctx, acteur, m) : null;
    return { ...(await detail(acteur, teamId, id)), ...(raison ? { planning: { evenementId: m.evenement_id, raison } } : {}) };
  }

  return { liste, detail, creer, modifier, supprimer, changerRoster, inscrire, checkin, ajouterMatch, modifierMatch, supprimerMatch, tournoiDeTeam, matchDeTournoi, tailleRoster };
}
