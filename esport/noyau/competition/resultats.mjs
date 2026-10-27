/**
 * Module « Résultats » (migration 0022) : saisie à la main du résultat d'un match (de tournoi, officiel
 * ou scrim), structurée selon le PROFIL DE JEU de la team (score.mjs) ; historique filtrable, bilans
 * (bilans.mjs), vue par adversaire reliée au scouting, accueil « Compétition ».
 *
 * Contrôles de chaque route : session → appartenance (404) → module `resultats` activé (404) →
 * permission (`resultats.voir` / `resultats.saisir`, 403). Un résultat « staff » n'est visible qu'avec
 * `resultats.saisir` (un appel direct sans elle : 404). Toute requête filtre sur `team_id`.
 *
 * Liens facultatifs : match d'un tournoi (module Tournois), événement du planning (planning.view), review
 * vidéo (video_review.view) ; tous de la même team.
 */

import { evenement } from '../evenements.mjs';
import { echec, iso, jsonOu, nouvelId, texteLong, texteNettoye } from '../outils.mjs';
import { lignesParIds, pseudosDe } from '../requetes.mjs';
import { libelleFormat } from '../jeux/schema.mjs';
import { ajouterJours, dateLocale, instantMural, lireDate } from '../planning/temps.mjs';
import {
  MODULE_RESULTATS,
  MODULE_TOURNOIS,
  MOTIF_UUID,
  adversaireRapide,
  adversairesAffiches,
  adversairesParId,
  booleen,
  entierOuNull,
  exigerModule,
  exigerUuid,
  lireAdversaires,
  lireInstant,
  membresTeam,
  peut,
  profilDuJeu,
} from './commun.mjs';
import { ScoreInvalide, calculerScore, erreurScore, regleDuProfil, scoreCourt } from './score.mjs';
import { bilan } from './bilans.mjs';

export const GENRES_RESULTAT = ['tournoi', 'officiel', 'scrim'];
export const VISIBILITES = ['team', 'staff'];
const MAX = { liste: 200, calcul: 2000, joueursStats: 15, personnages: 5 };
const MOTIF_CLE_STAT = /^[\p{L}\p{N} _.%/+-]{1,24}$/u;

export function servicesResultats({ base, maintenant = () => Date.now(), socle }) {
  const { contexteTeam } = socle;

  async function contexte(acteur, teamId, permission) {
    const ctx = await contexteTeam(acteur, teamId);
    exigerModule(ctx, MODULE_RESULTATS, permission);
    return ctx;
  }

  const staff = ctx => peut(ctx, 'resultats.saisir');

  async function resultatDeTeam(ctx, id) {
    exigerUuid(id, 'resultat');
    const r = await base.premier('SELECT * FROM resultats WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, ctx.team.id]);
    if (!r || (r.visibilite === 'staff' && !staff(ctx))) throw echec(404, 'resultat-introuvable', 'Résultat introuvable.');
    return r;
  }

  const droits = ctx => ({
    saisir: staff(ctx),
    tournois: peut(ctx, 'tournois.voir'),
    planning: peut(ctx, 'planning.view'),
    scouting: peut(ctx, 'scouting.view'),
    review: peut(ctx, 'video_review.view'),
    adversaireRapide: peut(ctx, 'resultats.saisir') || peut(ctx, 'tournois.gerer'),
  });

  // -------------------------------------------------------------- Lecture

  /** Résultats publics (avec manches, joueurs, adversaires) pour des lignes `resultats`. */
  async function publics(ctx, lignes) {
    if (lignes.length === 0) return [];
    const ids = lignes.map(r => r.id);
    const manches = await lignesParIds(base, 'SELECT * FROM resultat_manches WHERE team_id = ? AND resultat_id', ids, { paramsAvant: [ctx.team.id], apres: 'ORDER BY numero' });
    const joueurs = await lignesParIds(base, 'SELECT * FROM resultat_joueurs WHERE team_id = ? AND resultat_id', ids, { paramsAvant: [ctx.team.id], apres: 'ORDER BY position' });
    const pseudos = await pseudosDe(base, [...joueurs.map(j => j.compte_id), ...lignes.map(r => r.mvp_id)].filter(Boolean));
    const fiches = await adversairesParId(base, ctx.team.id, lignes.flatMap(r => jsonOu(r.adversaires, []).map(a => a.id)).filter(Boolean));
    const tournois = new Map((await lignesParIds(base, 'SELECT id, nom FROM tournois WHERE team_id = ? AND id', lignes.map(r => r.tournoi_id).filter(Boolean), { paramsAvant: [ctx.team.id] })).map(t => [t.id, t]));
    const matchs = new Map((await lignesParIds(base, 'SELECT id, tour FROM tournoi_matchs WHERE team_id = ? AND id', lignes.map(r => r.tournoi_match_id).filter(Boolean), { paramsAvant: [ctx.team.id] })).map(m => [m.id, m]));
    const profils = new Map();
    for (const jeu of new Set(lignes.map(r => r.jeu))) profils.set(jeu, await profilDuJeu(base, jeu));
    const voitTournois = peut(ctx, 'tournois.voir');
    return lignes.map(r => {
      const profil = profils.get(r.jeu);
      const persos = new Map(profil.donnees.personnages.map(p => [p.cle, p.nom]));
      const score = jsonOu(r.score, {});
      const detailManches = Array.isArray(score.manches) ? score.manches : [];
      const lesManches = manches
        .filter(m => m.resultat_id === r.id)
        .map(m => {
          const d = detailManches.find(x => x.numero === Number(m.numero)) ?? {};
          return {
            numero: Number(m.numero),
            carte: m.carte_cle || m.carte_nom ? { cle: m.carte_cle ?? null, nom: m.carte_nom } : null,
            mode: m.mode_cle || m.mode_nom ? { cle: m.mode_cle ?? null, nom: m.mode_nom } : null,
            issue: m.issue ?? null,
            nous: m.score_nous === null ? null : Number(m.score_nous),
            eux: m.score_eux === null ? null : Number(m.score_eux),
            place: m.place === null ? null : Number(m.place),
            points: m.points === null ? null : Number(m.points),
            miTemps: d.detail?.miTemps ?? null,
            prolongations: d.detail?.prolongations ?? null,
            enProlongations: Boolean(d.detail?.enProlongations),
            classement: d.classement ?? [],
          };
        });
      const format = profil.donnees.formats.find(f => f.cle === r.format_cle);
      const base_ = {
        id: r.id,
        genre: r.genre,
        tournoi: r.tournoi_id && voitTournois && tournois.get(r.tournoi_id) ? { id: r.tournoi_id, nom: tournois.get(r.tournoi_id).nom } : null,
        tournoiMatchId: r.tournoi_match_id ?? null,
        tour: r.tournoi_match_id && voitTournois ? (matchs.get(r.tournoi_match_id)?.tour ?? null) : null,
        evenementId: peut(ctx, 'planning.view') ? (r.evenement_id ?? null) : null,
        occurrence: r.occurrence ?? null,
        date: r.date_match,
        jeu: { cle: r.jeu, nom: profil.nom, couleur: profil.couleur },
        format: format ? { cle: format.cle, nom: format.nom, libelle: libelleFormat(format) } : null,
        systeme: r.systeme,
        bo: r.bo === null ? null : Number(r.bo),
        adversaires: adversairesAffiches(jsonOu(r.adversaires, []), fiches),
        manches: lesManches,
        issue: r.issue ?? null,
        forfait: r.forfait ?? null,
        manchesNous: r.manches_nous === null ? null : Number(r.manches_nous),
        manchesEux: r.manches_eux === null ? null : Number(r.manches_eux),
        place: r.place === null ? null : Number(r.place),
        points: r.points === null ? null : Number(r.points),
        participants: r.participants === null ? null : Number(r.participants),
        joueurs: joueurs
          .filter(j => j.resultat_id === r.id)
          .map(j => ({
            compte: j.compte_id ?? null,
            pseudo: j.compte_id ? (pseudos[j.compte_id] ?? null) : null,
            personnages: jsonOu(j.personnages, []).map(p => ({ cle: persos.has(p) ? p : null, nom: persos.get(p) ?? p })),
            stats: jsonOu(j.stats, {}),
            mvp: Boolean(j.compte_id && j.compte_id === r.mvp_id),
          })),
        mvp: r.mvp_id ? { compte: r.mvp_id, pseudo: pseudos[r.mvp_id] ?? null } : null,
        reviewId: peut(ctx, 'video_review.view') ? (r.review_id ?? null) : null,
        visibilite: r.visibilite,
        publiable: Number(r.publiable) === 1,
        notes: r.notes,
        saisiPar: r.saisi_par ?? null,
        creeLe: r.cree_le,
        majLe: r.maj_le,
      };
      return { ...base_, score: scoreCourt(base_) };
    });
  }

  /** Bornes d'une période (dates AAAA-MM-JJ, fuseau de la team) → instants ISO [du, au[. */
  function periode(ctx, du, au) {
    const lire = (v, code) => {
      if (v === undefined || v === null || v === '') return null;
      const d = lireDate(v);
      if (!d) throw echec(400, code, 'Date invalide (AAAA-MM-JJ).');
      return d;
    };
    const d = lire(du, 'du');
    const a = lire(au, 'au');
    return { du: d ? iso(instantMural(ctx.team.fuseau, d, 0)) : null, au: a ? iso(instantMural(ctx.team.fuseau, ajouterJours(a, 1), 0)) : null };
  }

  /** Lignes visibles, filtrées en SQL (jeu, tournoi, genre, période) puis en JS (adversaire, carte, issue). */
  async function lignesFiltrees(ctx, f = {}) {
    const conditions = ['team_id = ?', 'supprime_le IS NULL'];
    const params = [ctx.team.id];
    if (!staff(ctx)) conditions.push("visibilite = 'team'");
    if (f.jeu) {
      conditions.push('jeu = ?');
      params.push(String(f.jeu).slice(0, 40));
    }
    if (f.tournoi) {
      if (!MOTIF_UUID.test(f.tournoi)) throw echec(400, 'tournoi', 'Tournoi inconnu.');
      conditions.push('tournoi_id = ?');
      params.push(f.tournoi);
    }
    if (f.genre) {
      if (!GENRES_RESULTAT.includes(f.genre)) throw echec(400, 'genre', 'Type de match inconnu.');
      conditions.push('genre = ?');
      params.push(f.genre);
    }
    const p = periode(ctx, f.du, f.au);
    if (p.du) {
      conditions.push('date_match >= ?');
      params.push(p.du);
    }
    if (p.au) {
      conditions.push('date_match < ?');
      params.push(p.au);
    }
    const lignes = await base.tous(`SELECT * FROM resultats WHERE ${conditions.join(' AND ')} ORDER BY date_match DESC, cree_le DESC LIMIT ?`, [...params, MAX.calcul]);
    let liste = await publics(ctx, lignes);
    if (f.adversaire) liste = liste.filter(r => r.adversaires.some(a => a.id === f.adversaire || (!a.id && a.nom.toLowerCase() === String(f.adversaire).toLowerCase())));
    if (f.carte) liste = liste.filter(r => r.manches.some(m => m.carte && (m.carte.cle === f.carte || m.carte.nom.toLowerCase() === String(f.carte).toLowerCase())));
    if (f.issue) liste = liste.filter(r => r.issue === f.issue);
    return liste;
  }

  async function liste(acteur, teamId, f = {}) {
    const ctx = await contexte(acteur, teamId, 'resultats.voir');
    const tous = await lignesFiltrees(ctx, f);
    // Options des filtres : tirées de TOUS les résultats visibles (pas seulement ceux filtrés).
    const options = f.jeu || f.tournoi || f.genre || f.du || f.au || f.adversaire || f.carte || f.issue ? await lignesFiltrees(ctx, {}) : tous;
    const adversaires = new Map();
    const cartes = new Map();
    for (const r of options) {
      for (const a of r.adversaires) adversaires.set(a.id ?? `nom:${a.nom.toLowerCase()}`, { id: a.id ?? a.nom, nom: a.nom, fiche: Boolean(a.id) });
      for (const m of r.manches) if (m.carte) cartes.set(m.carte.cle ?? m.carte.nom, { cle: m.carte.cle ?? m.carte.nom, nom: m.carte.nom });
    }
    const tournois = peut(ctx, 'tournois.voir') ? new Map(options.filter(r => r.tournoi).map(r => [r.tournoi.id, r.tournoi])) : new Map();
    const jeux = new Map(options.map(r => [r.jeu.cle, r.jeu]));
    return {
      resultats: tous.slice(0, MAX.liste),
      total: tous.length,
      bilan: bilan(tous),
      filtres: {
        adversaires: [...adversaires.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
        cartes: [...cartes.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
        tournois: [...tournois.values()].sort((a, b) => a.nom.localeCompare(b.nom)),
        jeux: [...jeux.values()],
      },
      droits: droits(ctx),
    };
  }

  async function detail(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId, 'resultats.voir');
    const r = await resultatDeTeam(ctx, id);
    const [pub] = await publics(ctx, [r]);
    return { resultat: pub, droits: droits(ctx) };
  }

  /** Vue par adversaire : bilan face à lui, résultats, prochains matchs, lien vers sa fiche de scouting. */
  async function vueAdversaire(acteur, teamId, adversaireId) {
    const ctx = await contexte(acteur, teamId, 'resultats.voir');
    exigerUuid(adversaireId, 'adversaire');
    const fiche = (await adversairesParId(base, teamId, [adversaireId])).get(adversaireId);
    if (!fiche) throw echec(404, 'adversaire-introuvable', 'Adversaire introuvable.');
    const resultats = await lignesFiltrees(ctx, { adversaire: adversaireId });
    const t = maintenant();
    const prochains = [];
    if (peut(ctx, 'tournois.voir')) {
      const ms = await base.tous(
        `SELECT m.id, m.tour, m.debut, m.adversaires, t.id AS tournoi_id, t.nom FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id
          WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND m.statut = 'a_jouer' AND m.debut >= ? ORDER BY m.debut LIMIT 50`,
        [teamId, iso(t - 3 * 3_600_000)],
      );
      for (const m of ms) if (jsonOu(m.adversaires, []).some(a => a.id === adversaireId)) prochains.push({ genre: 'tournoi', id: m.id, tournoi: { id: m.tournoi_id, nom: m.nom }, tour: m.tour, debut: m.debut });
    }
    if (peut(ctx, 'planning.view')) {
      const evs = await base.tous("SELECT id, titre, type, debut FROM planning_evenements WHERE team_id = ? AND adversaire_id = ? AND supprime_le IS NULL AND recurrence IS NULL AND debut >= ? ORDER BY debut LIMIT 20", [teamId, adversaireId, iso(t - 3 * 3_600_000)]);
      for (const e of evs) if (!prochains.some(p => p.debut === e.debut)) prochains.push({ genre: 'planning', id: e.id, titre: e.titre, type: e.type, debut: e.debut });
    }
    return {
      adversaire: { id: fiche.id, nom: fiche.nom, logoUrl: fiche.logoUrl, supprime: fiche.supprime },
      bilan: bilan(resultats),
      resultats: resultats.slice(0, MAX.liste),
      prochains: prochains.sort((a, b) => a.debut.localeCompare(b.debut)).slice(0, 10),
      // Fiche de scouting : seulement pour qui la voit (donnée sensible), et si elle existe encore.
      scouting: peut(ctx, 'scouting.view') && !fiche.supprime ? { id: fiche.id } : null,
      droits: droits(ctx),
    };
  }

  // -------------------------------------------------------------- Formulaire

  /** Ce que propose le formulaire : règles du jeu, maps, modes, personnages, membres, matchs à saisir. */
  async function formulaire(acteur, teamId) {
    const ctx = await contexte(acteur, teamId, 'resultats.saisir');
    const profil = await profilDuJeu(base, ctx.team.jeu);
    const d = profil.donnees;
    const t = maintenant();
    let matchsTournoi = [];
    if (ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.voir')) {
      const ms = await base.tous(
        `SELECT m.id, m.tour, m.debut, m.bo, m.adversaires, m.evenement_id, t.id AS tournoi_id, t.nom, t.format_cle FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id
          WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND m.resultat_id IS NULL AND m.statut <> 'annule' AND (m.debut IS NULL OR m.debut <= ?)
          ORDER BY m.debut DESC LIMIT 40`,
        [teamId, iso(t + 86_400_000)],
      );
      matchsTournoi = ms.map(m => ({ id: m.id, tournoi: { id: m.tournoi_id, nom: m.nom }, tour: m.tour, debut: m.debut ?? null, bo: m.bo === null ? null : Number(m.bo), formatCle: m.format_cle ?? null, adversaires: jsonOu(m.adversaires, []) }));
    }
    let evenements = [];
    if (peut(ctx, 'planning.view')) {
      const lies = new Set((await base.tous('SELECT evenement_id FROM resultats WHERE team_id = ? AND evenement_id IS NOT NULL AND supprime_le IS NULL', [teamId])).map(l => l.evenement_id));
      const evs = await base.tous(
        "SELECT id, titre, type, debut, adversaire_id FROM planning_evenements WHERE team_id = ? AND supprime_le IS NULL AND recurrence IS NULL AND type IN ('scrim', 'match', 'tournament') AND debut >= ? AND debut <= ? ORDER BY debut DESC LIMIT 40",
        [teamId, iso(t - 60 * 86_400_000), iso(t + 86_400_000)],
      );
      evenements = evs.filter(e => !lies.has(e.id)).map(e => ({ id: e.id, titre: e.titre, type: e.type, debut: e.debut, adversaireId: e.adversaire_id ?? null }));
    }
    const reviews = peut(ctx, 'video_review.view') ? (await base.tous('SELECT id, titre, cree_le FROM reviews WHERE team_id = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT 60', [teamId])).map(r => ({ id: r.id, titre: r.titre })) : [];
    const adversaires = (await base.tous('SELECT id, nom, logo_url FROM adversaires WHERE team_id = ? AND supprime_le IS NULL ORDER BY LOWER(nom) LIMIT 200', [teamId])).map(a => ({ id: a.id, nom: a.nom, logoUrl: a.logo_url ?? null }));
    const r = (() => {
      try {
        return regleDuProfil(d, undefined, undefined);
      } catch {
        return null;
      }
    })();
    return {
      jeu: {
        cle: profil.cle,
        nom: profil.nom,
        couleur: profil.couleur,
        formats: d.formats.map(f => ({ cle: f.cle, nom: f.nom, libelle: libelleFormat(f), equipes: f.equipes, joueursParEquipe: f.joueursParEquipe, bo: f.bo })),
        score: d.score,
        systeme: r?.systeme ?? 'serie',
        cartes: d.cartes.map(c => ({ cle: c.cle, nom: c.nom, actif: c.actif, modes: c.modes })),
        modes: d.modes.map(m => ({ cle: m.cle, nom: m.nom, formats: m.formats, actif: m.actif })),
        personnages: d.personnages.map(p => ({ cle: p.cle, nom: p.nom, actif: p.actif })),
        roster: d.roster,
        libelles: d.libelles,
      },
      membres: (await membresTeam(base, teamId)).map(m => ({ compte: m.compte, pseudo: m.pseudo })),
      matchsTournoi,
      evenements,
      reviews,
      adversaires,
      droits: droits(ctx),
    };
  }

  // -------------------------------------------------------------- Écriture

  function lireStats(v, chemin) {
    if (v === undefined || v === null) return {};
    if (typeof v !== 'object' || Array.isArray(v)) throw echec(400, 'stats', 'Statistiques illisibles.');
    const entrees = Object.entries(v);
    if (entrees.length > MAX.joueursStats) throw echec(400, 'stats', 'Statistiques : 15 au plus par joueur.');
    const sortie = {};
    for (const [k, x] of entrees) {
      const cle = texteNettoye(k, 24);
      if (!MOTIF_CLE_STAT.test(cle)) throw echec(400, 'stats', `Statistique illisible (${chemin}).`);
      if (typeof x === 'number') {
        if (!Number.isFinite(x) || Math.abs(x) > 10_000_000) throw echec(400, 'stats', `Statistique illisible (${chemin}).`);
        sortie[cle] = x;
      } else if (typeof x === 'string') {
        const t = texteNettoye(x, 40);
        if (t) sortie[cle] = /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : t;
      } else if (x !== null && x !== undefined) throw echec(400, 'stats', `Statistique illisible (${chemin}).`);
    }
    return sortie;
  }

  /** Saisie d'un résultat → colonnes, manches, joueurs (tout contrôlé contre le profil du jeu). */
  async function lireSaisie(ctx, corps, existant) {
    const teamId = ctx.team.id;
    const s = {};
    const prendre = (nom, repli) => (corps?.[nom] !== undefined ? corps[nom] : repli);
    // Liens : match de tournoi, tournoi, événement du planning.
    let match = null;
    let tournoi = null;
    const matchId = prendre('tournoiMatchId', existant?.tournoi_match_id ?? null);
    // Un lien déjà en place (même match, même tournoi) reste valable même si le module Tournois a été coupé depuis.
    const memeTournoi = id => Boolean(existant && id === existant.tournoi_id && matchId === (existant.tournoi_match_id ?? null));
    if (matchId) {
      if ((!ctx.modules.has(MODULE_TOURNOIS) || !peut(ctx, 'tournois.voir')) && !memeTournoi(existant?.tournoi_id)) throw echec(400, 'tournoi', 'Tournoi inconnu.');
      exigerUuid(matchId, 'match');
      match = await base.premier('SELECT * FROM tournoi_matchs WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [matchId, teamId]);
      if (!match) throw echec(400, 'tournoi', 'Tournoi inconnu.');
      if (match.resultat_id && match.resultat_id !== existant?.id) {
        const autre = await base.premier('SELECT id FROM resultats WHERE id = ? AND supprime_le IS NULL', [match.resultat_id]);
        if (autre) throw echec(409, 'match-deja-saisi', 'Ce match a déjà un résultat.');
      }
    }
    const tournoiId = match ? match.tournoi_id : prendre('tournoiId', existant?.tournoi_id ?? null);
    if (tournoiId) {
      if (((!ctx.modules.has(MODULE_TOURNOIS) || !peut(ctx, 'tournois.voir')) && !memeTournoi(tournoiId)) || !MOTIF_UUID.test(tournoiId)) throw echec(400, 'tournoi', 'Tournoi inconnu.');
      tournoi = await base.premier('SELECT * FROM tournois WHERE id = ? AND team_id = ?', [tournoiId, teamId]);
      if (!tournoi || (tournoi.supprime_le && !memeTournoi(tournoiId))) throw echec(400, 'tournoi', 'Tournoi inconnu.');
    }
    s.tournoi_match_id = match?.id ?? null;
    s.tournoi_id = tournoi?.id ?? null;
    s.genre = tournoi ? 'tournoi' : prendre('genre', existant?.genre ?? 'officiel');
    if (!GENRES_RESULTAT.includes(s.genre) || (s.genre === 'tournoi' && !tournoi)) throw echec(400, 'genre', 'Type de match inconnu.');
    let ev = null;
    const evId = prendre('evenementId', existant?.evenement_id ?? null);
    if (evId && evId === existant?.evenement_id) {
      // Lien déjà en place : gardé tel quel (l'événement a pu être supprimé ou le planning coupé depuis).
      ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ?', [evId, teamId]);
    } else if (evId) {
      if (!peut(ctx, 'planning.view') || !MOTIF_UUID.test(evId)) throw echec(400, 'evenement', 'Événement inconnu.');
      ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [evId, teamId]);
      if (!ev) throw echec(400, 'evenement', 'Événement inconnu.');
    }
    if (!ev && match?.evenement_id) ev = await base.premier('SELECT * FROM planning_evenements WHERE id = ? AND team_id = ?', [match.evenement_id, teamId]);
    s.evenement_id = ev?.id ?? null;
    const occurrence = prendre('occurrence', existant?.occurrence ?? null);
    s.occurrence = ev && occurrence ? lireInstant(occurrence, ctx.team.fuseau, 'occurrence') : null;
    // Date du match : saisie, sinon celle du match du tournoi ou de l'événement.
    const date = prendre('date', existant?.date_match ?? null);
    s.date_match = date ? lireInstant(date, ctx.team.fuseau) : (match?.debut ?? s.occurrence ?? ev?.debut ?? null);
    if (!s.date_match) throw echec(400, 'date', 'Date du match requise.');
    // Jeu : celui du tournoi, sinon celui gardé, sinon celui de la team.
    s.jeu = tournoi?.jeu ?? existant?.jeu ?? ctx.team.jeu;
    const profil = await profilDuJeu(base, s.jeu);
    const d = profil.donnees;
    let regle;
    try {
      const formatCle = prendre('formatCle', existant?.format_cle ?? tournoi?.format_cle ?? undefined);
      regle = regleDuProfil(d, formatCle ?? undefined, prendre('systeme', existant?.systeme));
    } catch (e) {
      if (e instanceof ScoreInvalide) throw erreurScore(e);
      throw e;
    }
    s.format_cle = regle.format?.cle ?? null;
    s.systeme = regle.systeme;
    // Adversaires : saisis, sinon ceux du match du tournoi, sinon celui de l'événement.
    const saisieAdv = prendre('adversaires', existant ? jsonOu(existant.adversaires, []) : match ? jsonOu(match.adversaires, []) : ev?.adversaire_id ? [{ id: ev.adversaire_id }] : []);
    const adversaires = await lireAdversaires(base, teamId, (saisieAdv ?? []).map(a => (a && typeof a === 'object' ? { id: a.id ?? undefined, nom: a.nom } : a)), { max: regle.systeme === 'classement' ? Math.max(1, (regle.equipes ?? 64) - 1) : 1, garder: existant ? jsonOu(existant.adversaires, []) : match ? jsonOu(match.adversaires, []) : [] });
    // Score : règles du jeu (série BO de maps / manches, ou classement à plusieurs équipes).
    const brutes = prendre('manches', existant ? jsonOu(existant.score, {}).saisie?.manches ?? [] : []);
    let score;
    try {
      score = calculerScore(regle, {
        bo: prendre('bo', existant?.bo ?? match?.bo ?? tournoi?.bo ?? undefined),
        manches: brutes,
        forfait: prendre('forfait', existant?.forfait ?? null),
        placeFinale: prendre('placeFinale', existant && existant.systeme === 'classement' ? jsonOu(existant.score, {}).saisie?.placeFinale : undefined),
        participants: prendre('participants', existant?.participants ?? undefined),
      });
    } catch (e) {
      if (e instanceof ScoreInvalide) throw erreurScore(e);
      throw e;
    }
    // Maps et modes de chaque manche : ceux du profil (libres s'il n'en a pas).
    const cartes = new Map(d.cartes.map(c => [c.cle, c]));
    const modes = new Map(d.modes.map(m => [m.cle, m]));
    const references = (Array.isArray(brutes) ? brutes : []).map((m, i) => {
      const r = { carte: null, mode: null };
      const cleCarte = m?.carteCle ?? null;
      if (cleCarte) {
        if (!cartes.has(cleCarte)) throw erreurScore(new ScoreInvalide(`manches.${i}.carteCle`, 'carte'));
        r.carte = { cle: cleCarte, nom: cartes.get(cleCarte).nom };
      } else if (m?.carteNom && d.cartes.length === 0) r.carte = { cle: null, nom: texteNettoye(m.carteNom, 40) };
      const cleMode = m?.modeCle ?? null;
      if (cleMode) {
        if (!modes.has(cleMode)) throw erreurScore(new ScoreInvalide(`manches.${i}.modeCle`, 'mode'));
        r.mode = { cle: cleMode, nom: modes.get(cleMode).nom };
      } else if (m?.modeNom && d.modes.length === 0) r.mode = { cle: null, nom: texteNettoye(m.modeNom, 40) };
      return r;
    });
    // Classement : les autres équipes de chaque manche deviennent aussi des adversaires (fiches connues).
    if (regle.systeme === 'classement') {
      const ids = new Set(adversaires.map(a => a.id).filter(Boolean));
      const autres = score.manches.flatMap(m => m.classement).filter(x => x.id && !ids.has(x.id));
      if (autres.length) {
        const fiches = await adversairesParId(base, teamId, autres.map(x => x.id));
        for (const x of autres) {
          const f = fiches.get(x.id);
          if (!f || f.supprime) throw echec(400, 'adversaire', 'Adversaire inconnu.');
          x.nom = f.nom;
        }
      }
    }
    s.adversaires = JSON.stringify(adversaires);
    s.adversaire_id = adversaires.find(a => a.id)?.id ?? null;
    s.bo = score.bo;
    s.issue = score.issue;
    s.forfait = score.forfait;
    s.manches_nous = score.manchesNous;
    s.manches_eux = score.manchesEux;
    s.place = score.place;
    s.points = score.points;
    s.participants = score.participants;
    // Saisie NORMALISÉE (validée) gardée avec le score : reprise quand on ne modifie qu'un champ.
    const saisieManches = score.manches.map((m, i) => {
      const ref = { ...(references[i]?.carte?.cle ? { carteCle: references[i].carte.cle } : references[i]?.carte ? { carteNom: references[i].carte.nom } : {}), ...(references[i]?.mode?.cle ? { modeCle: references[i].mode.cle } : references[i]?.mode ? { modeNom: references[i].mode.nom } : {}) };
      if (regle.systeme === 'classement') return { ...ref, place: m.place, points: m.points, classement: m.classement };
      return { ...ref, ...(m.nous !== null ? { nous: m.nous, eux: m.eux } : { issue: m.issue }), ...(m.detail?.miTemps ? { miTemps: m.detail.miTemps } : {}), ...(m.detail?.prolongations ? { prolongations: m.detail.prolongations } : {}) };
    });
    const placeSaisie = regle.systeme === 'classement' ? prendre('placeFinale', existant ? jsonOu(existant.score, {}).saisie?.placeFinale : undefined) : undefined;
    s.score = JSON.stringify({
      manches: score.manches.map((m, i) => ({ numero: i + 1, ...m })),
      saisie: { manches: saisieManches, ...(placeSaisie !== undefined && placeSaisie !== null && placeSaisie !== '' ? { placeFinale: score.place } : {}) },
    });
    const lignesManches = score.manches.map((m, i) => ({
      numero: i + 1,
      carte_cle: references[i]?.carte?.cle ?? null,
      carte_nom: references[i]?.carte?.nom ?? '',
      mode_cle: references[i]?.mode?.cle ?? null,
      mode_nom: references[i]?.mode?.nom ?? '',
      issue: m.issue ?? null,
      score_nous: m.nous ?? null,
      score_eux: m.eux ?? null,
      place: m.place ?? null,
      points: m.points ?? null,
    }));
    // Joueurs alignés (membres de la team), personnages du profil, stats libres, MVP.
    const saisieJoueurs = prendre('joueurs', undefined);
    let joueurs = null;
    if (saisieJoueurs !== undefined || !existant) {
      const brutsJ = saisieJoueurs ?? [];
      if (!Array.isArray(brutsJ) || brutsJ.length > regle.joueursMax) throw echec(400, 'joueurs', `${regle.joueursMax} joueurs au plus pour ce format.`);
      const membres = new Set((await membresTeam(base, teamId, { tous: true })).map(m => m.compte));
      const persos = new Set(d.personnages.map(p => p.cle));
      const vus = new Set();
      joueurs = brutsJ.map((j, i) => {
        const compte = typeof j?.compte === 'string' ? j.compte : '';
        if (!membres.has(compte)) throw echec(400, 'joueurs', 'Un joueur aligné ne fait pas partie de la team.');
        if (vus.has(compte)) throw echec(400, 'joueurs', 'Un joueur est aligné deux fois.');
        vus.add(compte);
        const ps = j.personnages ?? [];
        if (!Array.isArray(ps) || ps.length > MAX.personnages) throw echec(400, 'personnages', 'Personnages : 5 au plus par joueur.');
        const personnages = [
          ...new Set(
            ps.map(p => {
              if (persos.size === 0) return texteNettoye(p, 24);
              if (!persos.has(p)) throw echec(400, 'personnages', 'Personnage inconnu pour ce jeu.');
              return p;
            }),
          ),
        ].filter(Boolean);
        return { compte, position: i, personnages, stats: lireStats(j.stats, `joueurs.${i}`) };
      });
    }
    const comptesAlignes = joueurs ? joueurs.map(j => j.compte) : (await base.tous('SELECT compte_id FROM resultat_joueurs WHERE resultat_id = ?', [existant.id])).map(l => l.compte_id).filter(Boolean);
    const mvp = prendre('mvp', existant?.mvp_id ?? null);
    if (mvp && !comptesAlignes.includes(mvp)) throw echec(400, 'mvp', 'Le MVP doit être un joueur aligné.');
    s.mvp_id = mvp || null;
    const reviewId = prendre('reviewId', existant?.review_id ?? null);
    if (reviewId && reviewId !== existant?.review_id) {
      const ok = peut(ctx, 'video_review.view') && MOTIF_UUID.test(reviewId) && (await base.premier('SELECT id FROM reviews WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [reviewId, teamId]));
      if (!ok) throw echec(400, 'review', 'Review inconnue.');
    }
    s.review_id = reviewId || null;
    const visibilite = prendre('visibilite', existant?.visibilite ?? 'team');
    if (!VISIBILITES.includes(visibilite)) throw echec(400, 'visibilite', 'Visibilité inconnue.');
    s.visibilite = visibilite;
    // Publiable (Discord, future section CM) : par défaut oui, sauf un scrim ; jamais un résultat staff.
    const publiable = booleen(prendre('publiable', existant ? Number(existant.publiable) === 1 : s.genre !== 'scrim'), s.genre !== 'scrim');
    s.publiable = publiable && visibilite === 'team' ? 1 : 0;
    s.notes = texteLong(prendre('notes', existant?.notes ?? ''), 4000);
    return { s, lignesManches, joueurs, match, tournoi };
  }

  function lotEnfants(id, teamId, lignesManches, joueurs) {
    const lot = [{ sql: 'DELETE FROM resultat_manches WHERE resultat_id = ? AND team_id = ?', params: [id, teamId] }];
    for (const m of lignesManches) {
      lot.push({
        sql: 'INSERT INTO resultat_manches (id, resultat_id, team_id, numero, carte_cle, carte_nom, mode_cle, mode_nom, issue, score_nous, score_eux, place, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [nouvelId(), id, teamId, m.numero, m.carte_cle, m.carte_nom, m.mode_cle, m.mode_nom, m.issue, m.score_nous, m.score_eux, m.place, m.points],
      });
    }
    if (joueurs) {
      lot.push({ sql: 'DELETE FROM resultat_joueurs WHERE resultat_id = ? AND team_id = ?', params: [id, teamId] });
      for (const j of joueurs) {
        lot.push({ sql: 'INSERT INTO resultat_joueurs (id, resultat_id, team_id, compte_id, position, personnages, stats) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [nouvelId(), id, teamId, j.compte, j.position, JSON.stringify(j.personnages), JSON.stringify(j.stats)] });
      }
    }
    return lot;
  }

  /** Charge des événements du bus : de quoi écrire le journal et les notifications sans relire. */
  function chargeResultat(s) {
    const adv = jsonOu(s.adversaires, []).map(a => a.nom);
    const manches = jsonOu(s.score, {}).manches ?? [];
    return {
      genre: s.genre,
      issue: s.issue,
      place: s.place,
      score: scoreCourt({ systeme: s.systeme, bo: s.bo, forfait: s.forfait, manches, manchesNous: s.manches_nous, manchesEux: s.manches_eux, place: s.place }),
      adversaire: adv.slice(0, 3).join(', ') || null,
      tournoiId: s.tournoi_id,
      visibilite: s.visibilite,
      publiable: s.publiable === 1,
    };
  }

  async function creer(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId, 'resultats.saisir');
    const { s, lignesManches, joueurs, match } = await lireSaisie(ctx, corps);
    const t = maintenant();
    const id = nouvelId();
    const ligne = { id, team_id: teamId, saisi_par: acteur.compte, cree_le: iso(t), maj_le: iso(t), ...s };
    const colonnes = Object.keys(ligne);
    const lot = [{ sql: `INSERT INTO resultats (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`, params: colonnes.map(c => ligne[c]) }, ...lotEnfants(id, teamId, lignesManches, joueurs)];
    if (match) lot.push({ sql: "UPDATE tournoi_matchs SET resultat_id = ?, statut = 'joue', maj_le = ? WHERE id = ? AND team_id = ?", params: [id, iso(t), match.id, teamId] });
    lot.push(evenement('match.resultat_saisi', { teamId, acteur: acteur.compte, entiteType: 'resultat', entiteId: id, charge: chargeResultat(s), maintenant: t }));
    await base.lot(lot);
    return detail(acteur, teamId, id);
  }

  async function modifier(acteur, teamId, id, corps) {
    const ctx = await contexte(acteur, teamId, 'resultats.saisir');
    const ancien = await resultatDeTeam(ctx, id);
    const { s, lignesManches, joueurs, match } = await lireSaisie(ctx, corps, ancien);
    const t = maintenant();
    const champs = Object.keys(s);
    const lot = [{ sql: `UPDATE resultats SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ? AND team_id = ?`, params: [...champs.map(c => s[c]), iso(t), id, teamId] }, ...lotEnfants(id, teamId, lignesManches, joueurs)];
    if (ancien.tournoi_match_id && ancien.tournoi_match_id !== s.tournoi_match_id) lot.push({ sql: 'UPDATE tournoi_matchs SET resultat_id = NULL, maj_le = ? WHERE id = ? AND team_id = ? AND resultat_id = ?', params: [iso(t), ancien.tournoi_match_id, teamId, id] });
    if (match) lot.push({ sql: "UPDATE tournoi_matchs SET resultat_id = ?, statut = 'joue', maj_le = ? WHERE id = ? AND team_id = ?", params: [id, iso(t), match.id, teamId] });
    lot.push(evenement('match.resultat_modifie', { teamId, acteur: acteur.compte, entiteType: 'resultat', entiteId: id, charge: chargeResultat(s), maintenant: t }));
    await base.lot(lot);
    return detail(acteur, teamId, id);
  }

  async function supprimer(acteur, teamId, id) {
    const ctx = await contexte(acteur, teamId, 'resultats.saisir');
    const r = await resultatDeTeam(ctx, id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE resultats SET supprime_le = ?, maj_le = ? WHERE id = ? AND team_id = ?', params: [iso(t), iso(t), id, teamId] },
      { sql: 'UPDATE tournoi_matchs SET resultat_id = NULL, maj_le = ? WHERE resultat_id = ? AND team_id = ?', params: [iso(t), id, teamId] },
      evenement('match.resultat_supprime', { teamId, acteur: acteur.compte, entiteType: 'resultat', entiteId: id, charge: chargeResultat(r), maintenant: t }),
    ]);
    return { ok: true };
  }

  /** Création rapide d'un adversaire (fiche du scouting réduite au nom) : `resultats.saisir` ou `tournois.gerer`. */
  async function creerAdversaire(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    const tournois = ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.gerer');
    const resultats = ctx.modules.has(MODULE_RESULTATS) && peut(ctx, 'resultats.saisir');
    if (!ctx.modules.has(MODULE_TOURNOIS) && !ctx.modules.has(MODULE_RESULTATS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!tournois && !resultats) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const r = await adversaireRapide(base, { acteur, teamId, nom: corps?.nom, logoUrl: corps?.logoUrl, t: maintenant() });
    if (r.lot.length) await base.lot(r.lot);
    return { adversaire: r.adversaire, existait: r.existait };
  }

  /** Noms des adversaires (sélecteurs des formulaires) : tout membre qui voit tournois ou résultats. */
  async function adversaires(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    const voit = (ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.voir')) || (ctx.modules.has(MODULE_RESULTATS) && peut(ctx, 'resultats.voir'));
    if (!ctx.modules.has(MODULE_TOURNOIS) && !ctx.modules.has(MODULE_RESULTATS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (!voit) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
    const lignes = await base.tous('SELECT id, nom, logo_url FROM adversaires WHERE team_id = ? AND supprime_le IS NULL ORDER BY LOWER(nom) LIMIT 200', [teamId]);
    return { adversaires: lignes.map(a => ({ id: a.id, nom: a.nom, logoUrl: a.logo_url ?? null })), droits: { creer: (ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.gerer')) || (ctx.modules.has(MODULE_RESULTATS) && peut(ctx, 'resultats.saisir')), scouting: peut(ctx, 'scouting.view') } };
  }

  /**
   * Accueil « Compétition » (accueil de la team) : prochains matchs de tournoi et tournois à venir
   * (`tournois.voir`), derniers résultats et forme (`resultats.voir`). Chaque bloc vaut null sans son
   * module ou sa permission.
   */
  async function accueil(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    const voitT = ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.voir');
    const voitR = ctx.modules.has(MODULE_RESULTATS) && peut(ctx, 'resultats.voir');
    if (!ctx.modules.has(MODULE_TOURNOIS) && !ctx.modules.has(MODULE_RESULTATS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    const t = maintenant();
    let prochains = null;
    let tournois = null;
    if (voitT) {
      const ms = await base.tous(
        `SELECT m.id, m.tour, m.debut, m.adversaires, t.id AS tournoi_id, t.nom FROM tournoi_matchs m JOIN tournois t ON t.id = m.tournoi_id
          WHERE m.team_id = ? AND m.supprime_le IS NULL AND t.supprime_le IS NULL AND m.statut = 'a_jouer' AND m.fin >= ? ORDER BY m.debut LIMIT 5`,
        [teamId, iso(t)],
      );
      const fiches = await adversairesParId(base, teamId, ms.flatMap(m => jsonOu(m.adversaires, []).map(a => a.id)).filter(Boolean));
      prochains = ms.map(m => ({ id: m.id, tournoi: { id: m.tournoi_id, nom: m.nom }, tour: m.tour, debut: m.debut, adversaires: adversairesAffiches(jsonOu(m.adversaires, []), fiches) }));
      const jour = dateLocale(ctx.team.fuseau, t);
      const aujourdhui = `${jour.annee}-${String(jour.mois).padStart(2, '0')}-${String(jour.jour).padStart(2, '0')}`;
      tournois = (
        await base.tous(
          "SELECT id, nom, debut, fin, statut, inscription_limite, checkin_limite FROM tournois WHERE team_id = ? AND supprime_le IS NULL AND statut IN ('a_venir', 'inscrit', 'en_cours') AND (fin IS NULL OR fin >= ?) ORDER BY COALESCE(debut, '9999') LIMIT 5",
          [teamId, aujourdhui],
        )
      ).map(x => ({ id: x.id, nom: x.nom, debut: x.debut ?? null, fin: x.fin ?? null, statut: x.statut, inscriptionLimite: x.inscription_limite ?? null, checkinLimite: x.checkin_limite ?? null }));
    }
    let derniers = null;
    let forme = null;
    if (voitR) {
      const conditions = ['team_id = ?', 'supprime_le IS NULL', ...(staff(ctx) ? [] : ["visibilite = 'team'"])];
      const lignes = await base.tous(`SELECT * FROM resultats WHERE ${conditions.join(' AND ')} ORDER BY date_match DESC LIMIT 20`, [teamId]);
      const liste_ = await publics(ctx, lignes);
      derniers = liste_.slice(0, 5).map(r => ({ id: r.id, genre: r.genre, date: r.date, tournoi: r.tournoi, adversaires: r.adversaires, systeme: r.systeme, issue: r.issue, place: r.place, score: r.score }));
      forme = bilan(liste_).forme;
    }
    return { prochains, tournois, derniers, forme, droits: { tournois: voitT, resultats: voitR, gerer: ctx.modules.has(MODULE_TOURNOIS) && peut(ctx, 'tournois.gerer'), saisir: ctx.modules.has(MODULE_RESULTATS) && peut(ctx, 'resultats.saisir') } };
  }

  return { liste, detail, formulaire, creer, modifier, supprimer, vueAdversaire, creerAdversaire, adversaires, accueil, resultatDeTeam, contexte };
}
