/**
 * Page « Statistiques » de l'Esport (premier niveau), réservée au FONDATEUR (super admin) : tout autre compte,
 * Propriétaire compris, reçoit 404 (on ne dit pas que la route existe).
 *
 *  - `GET /statistiques?du&au&team&role&appareil&absents` : tout l'écran en une réponse (vue d'ensemble et
 *    tendance, utilisateurs, pages les plus et les moins utilisées, pages jamais ouvertes, modules activés
 *    mais pas utilisés, carte de chaleur, courbe quotidienne, appareils, langues, teams, fonctionnalités,
 *    erreurs JS).
 *  - `GET /statistiques/membres/:compte?du&au` : fiche d'un membre (chronologie de son activité).
 *  - `GET|PUT /statistiques/reglages` : couper ou rétablir la collecte.
 *
 * Données : agrégats journaliers (`usage_jour_*`) pour les jours déjà agrégés par le cron, détail brut
 * agrégé à la volée pour les jours récents (aujourd'hui). Avant le premier jour mesuré, une partie de
 * l'historique est RECONSTITUÉE depuis le journal d'activité (actions des membres) et les premières
 * connexions (comptes), et signalée comme telle.
 */

import { echec, iso } from '../outils.mjs';
import { lignesParIds } from '../requetes.mjs';
import { partiesLocales } from '../planning/temps.mjs';
import {
  APPAREILS,
  CATALOGUE_USAGE,
  FONCTION_ACTION,
  FUSEAU_USAGE,
  PAGES,
  TABLES_JOUR,
  agreger,
  collecteActive,
  debutDuJour,
  evenementsBruts,
  instructionReglage,
  jourDe,
  jourValide,
  joursEntre,
  lireReglage,
  plusJours,
} from './collecte.mjs';

const MAX_PERIODE_JOURS = 731;
const MAX_JOURNAL = 50_000;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = ['proprietaire', 'manager', 'coach', 'analyste', 'joueur', 'remplacant'];

/** Actions du journal → action clé des statistiques (reconstitution de l'historique). */
export const ACTION_DU_JOURNAL = {
  'event.created': 'evenement.cree',
  'attendance.rsvp': 'rsvp',
  'attendance.marked': 'presence.marquee',
  'availability.updated': 'disponibilite',
  'meeting.submitted': 'resume.depose',
  'meeting.summary_published': 'resume.publie',
  'review.created': 'review.creee',
  'review.marker_added': 'repere.ajoute',
  'review.comment_added': 'review.commentaire',
  'strat.created': 'strat.creee',
  'strat.updated': 'strat.modifiee',
  'playbook.created': 'playbook.ajout',
  'resource.created': 'ressource.publiee',
  'task.created': 'tache.creee',
  'goal.created': 'objectif.cree',
  'opponent.created': 'scouting.fiche',
};

const n = v => Number(v ?? 0);
const somme = (liste, f) => liste.reduce((s, x) => s + f(x), 0);
const dansJours = (jour, du, au) => jour >= du && jour <= au;

/** 404 « Adresse inconnue » pour tout autre compte que le Fondateur. */
export function exigerFondateur(acteur) {
  if (!acteur?.superAdmin) throw echec(404, 'route', 'Adresse inconnue.');
}

export function servicesStatistiques({ base, maintenant = () => Date.now() }) {
  /** Période demandée (jours de Paris), 30 derniers jours par défaut ; période précédente de même longueur. */
  function lirePeriode(params) {
    const auj = jourDe(maintenant());
    const au = jourValide(params.au) ?? auj;
    const du = jourValide(params.du) ?? plusJours(au, -29);
    if ((params.du && !jourValide(params.du)) || (params.au && !jourValide(params.au))) throw echec(400, 'periode', 'Dates : AAAA-MM-JJ.');
    const jours = joursEntre(du, au).length;
    if (du > au || jours < 1 || jours > MAX_PERIODE_JOURS) throw echec(400, 'periode', `Période de 1 jour à ${MAX_PERIODE_JOURS} jours, la fin après le début.`);
    return { du, au, jours, precedente: { du: plusJours(du, -jours), au: plusJours(du, -1) } };
  }

  /** Lignes journalières de `du` à `au` (inclus) : agrégats, puis détail brut des jours pas encore agrégés. */
  async function lignes(du, au, { compte } = {}) {
    const agrege = await lireReglage(base, 'agrege_jusqua');
    const sortie = { pages: [], membres: [], actions: [], heures: [], erreurs: [] };
    const cles = { usage_jour_pages: 'pages', usage_jour_membres: 'membres', usage_jour_actions: 'actions', usage_jour_heures: 'heures', usage_jour_erreurs: 'erreurs' };
    if (agrege && du < agrege) {
      const fin = au < agrege ? au : plusJours(agrege, -1);
      for (const table of TABLES_JOUR) {
        const l = await base.tous(`SELECT * FROM ${table} WHERE jour >= ? AND jour <= ?${compte ? ' AND compte_id = ?' : ''}`, [du, fin, ...(compte ? [compte] : [])]);
        sortie[cles[table]].push(...l);
      }
    }
    const debutBrut = agrege && agrege > du ? agrege : du;
    if (debutBrut <= au) {
      const calcule = agreger(await evenementsBruts(base, debutBrut, plusJours(au, 1), { compte }));
      for (const k of Object.keys(sortie)) sortie[k].push(...calcule[k].filter(l => dansJours(l.jour, debutBrut, au)));
    }
    for (const k of Object.keys(sortie)) {
      for (const l of sortie[k]) {
        for (const c of ['vues', 'duree_ms', 'sessions', 'actions', 'erreurs', 'n', 'heure']) if (c in l) l[c] = n(l[c]);
        if ('team_id' in l) l.team_id = l.team_id || '';
      }
    }
    return sortie;
  }

  /** Comptes, appartenances, teams et modules actifs : le contexte des filtres et des listes. */
  async function contexte() {
    const comptes = await base.tous('SELECT id, pseudo, cree_le, invite_le, active_le FROM comptes ORDER BY pseudo_cle', []);
    const appartenances = await base.tous(
      `SELECT m.compte_id, m.team_id, m.statut, r.cle_systeme, r.nom AS role_nom FROM membres m
         JOIN roles r ON r.id = m.role_id JOIN teams t ON t.id = m.team_id WHERE t.supprimee_le IS NULL`,
      [],
    );
    const teams = await base.tous('SELECT id, nom, slug FROM teams WHERE supprimee_le IS NULL ORDER BY nom', []);
    const modules = await base.tous('SELECT tm.team_id, tm.module FROM team_modules tm JOIN teams t ON t.id = tm.team_id WHERE tm.active = 1 AND t.supprimee_le IS NULL', []);
    return { comptes, appartenances, teams, modules };
  }

  /** Comptes retenus par les filtres team et rôle (`null` : pas de filtre de compte). */
  function comptesFiltres(ctx, { team, role }) {
    if (!team && !role) return null;
    return new Set(ctx.appartenances.filter(a => (!team || a.team_id === team) && (!role || a.cle_systeme === role)).map(a => a.compte_id));
  }

  function filtrer(l, { team, appareil }, retenus) {
    const garde = x => (!appareil || x.appareil === appareil) && (!retenus || retenus.has(x.compte_id)) && (!team || !('team_id' in x) || x.team_id === team);
    // Lignes « membres » (sans team) : le filtre team passe par les comptes membres de la team.
    return {
      pages: l.pages.filter(garde),
      actions: l.actions.filter(garde),
      heures: l.heures.filter(garde),
      erreurs: l.erreurs.filter(garde),
      membres: l.membres.filter(garde),
    };
  }

  /** Historique reconstitué (avant le premier jour mesuré) : actions du journal, premières connexions. */
  async function reconstitution(du, au, debutCollecte, ctx, retenus, team) {
    const fin = debutCollecte && debutCollecte <= au ? plusJours(debutCollecte, -1) : au;
    if (debutCollecte && debutCollecte <= du) return null;
    if (fin < du) return null;
    const entrees = await base.tous(
      'SELECT acteur_id, team_id, action, cree_le FROM journal WHERE acteur_id IS NOT NULL AND cree_le >= ? AND cree_le < ? ORDER BY cree_le LIMIT ?',
      [iso(debutDuJour(du)), iso(debutDuJour(plusJours(fin, 1))), MAX_JOURNAL],
    );
    const garde = e => (!retenus || retenus.has(e.acteur_id)) && (!team || e.team_id === team);
    const parJour = new Map();
    const actions = [];
    const toucher = (jour, compte) => {
      const j = parJour.get(jour) ?? { actifs: new Set(), actions: 0 };
      j.actifs.add(compte);
      parJour.set(jour, j);
      return j;
    };
    for (const e of entrees.filter(garde)) {
      const jour = jourDe(Date.parse(e.cree_le));
      toucher(jour, e.acteur_id).actions++;
      const cle = ACTION_DU_JOURNAL[e.action];
      if (cle) actions.push({ jour, compte_id: e.acteur_id, team_id: e.team_id ?? '', action: cle, n: 1 });
    }
    // Premières connexions (sessions) : `active_le` des comptes.
    for (const c of ctx.comptes) {
      if (!c.active_le || (retenus && !retenus.has(c.id))) continue;
      const jour = jourDe(Date.parse(c.active_le));
      if (!dansJours(jour, du, fin)) continue;
      toucher(jour, c.id);
      actions.push({ jour, compte_id: c.id, team_id: '', action: 'connexion', n: 1 });
    }
    return { du, au: fin, parJour, actions, tronque: entrees.length >= MAX_JOURNAL };
  }

  // ---------------------------------------------------------------- Calculs

  function apercu(l, ctx, periode, retenus) {
    const actifs = (du, au) => new Set(l.membres.filter(m => dansJours(m.jour, du, au)).map(m => m.compte_id)).size;
    const bloc = (du, au) => {
      const m = l.membres.filter(x => dansJours(x.jour, du, au));
      const sessions = somme(m, x => x.sessions);
      const duree = somme(m, x => x.duree_ms);
      const debut = debutDuJour(du);
      const fin = debutDuJour(plusJours(au, 1));
      const dedans = d => d && Date.parse(d) >= debut && Date.parse(d) < fin;
      const comptes = ctx.comptes.filter(c => !retenus || retenus.has(c.id));
      return {
        actifs: actifs(du, au),
        sessions,
        vues: somme(m, x => x.vues),
        dureeMs: duree,
        dureeMoyenneMs: sessions > 0 ? Math.round(duree / sessions) : 0,
        actions: somme(m, x => x.actions),
        inscriptions: comptes.filter(c => dedans(c.cree_le)).length,
        invitationsAcceptees: comptes.filter(c => c.invite_le && dedans(c.active_le)).length,
      };
    };
    const { du, au, precedente } = periode;
    return {
      actifsJour: actifs(au, au),
      actifsSemaine: actifs(plusJours(au, -6), au),
      actifsMois: actifs(plusJours(au, -29), au),
      periode: bloc(du, au),
      precedente: bloc(precedente.du, precedente.au),
    };
  }

  async function utilisateurs(l, ctx, retenus, absents) {
    const t = maintenant();
    // Dernière activité, toutes périodes confondues : mesurée (agrégats et détail), sinon le journal.
    const mesure = new Map();
    for (const r of await base.tous('SELECT compte_id, MAX(derniere) AS d FROM usage_jour_membres GROUP BY compte_id', [])) mesure.set(r.compte_id, r.d);
    for (const r of await base.tous('SELECT compte_id, MAX(cree_le) AS d FROM usage_evenements GROUP BY compte_id', [])) if (!mesure.get(r.compte_id) || r.d > mesure.get(r.compte_id)) mesure.set(r.compte_id, r.d);
    const journal = new Map((await base.tous('SELECT acteur_id, MAX(cree_le) AS d FROM journal WHERE acteur_id IS NOT NULL GROUP BY acteur_id', [])).map(r => [r.acteur_id, r.d]));
    const teamsDe = new Map();
    const nomsTeams = new Map(ctx.teams.map(x => [x.id, x.nom]));
    for (const a of ctx.appartenances) {
      const liste = teamsDe.get(a.compte_id) ?? [];
      liste.push({ id: a.team_id, nom: nomsTeams.get(a.team_id) ?? null, role: a.role_nom, cle: a.cle_systeme ?? null, statut: a.statut });
      teamsDe.set(a.compte_id, liste);
    }
    const parCompte = new Map();
    const fiche = id => {
      let f = parCompte.get(id);
      if (!f) {
        f = { sessions: 0, dureeMs: 0, vues: 0, actions: 0, appareils: new Map(), pages: new Map() };
        parCompte.set(id, f);
      }
      return f;
    };
    for (const m of l.membres) {
      const f = fiche(m.compte_id);
      f.sessions += m.sessions;
      f.dureeMs += m.duree_ms;
      f.vues += m.vues;
      f.actions += m.actions;
      f.appareils.set(m.appareil, (f.appareils.get(m.appareil) ?? 0) + m.vues + m.actions + m.sessions);
    }
    for (const p of l.pages) {
      const f = fiche(p.compte_id);
      f.pages.set(p.page, (f.pages.get(p.page) ?? 0) + p.vues);
    }
    return ctx.comptes
      .filter(c => !retenus || retenus.has(c.id))
      .map(c => {
        const f = parCompte.get(c.id);
        const dm = mesure.get(c.id) ?? null;
        const dj = journal.get(c.id) ?? null;
        const derniere = dm && (!dj || dm >= dj) ? dm : dj ?? (c.active_le || null);
        const source = derniere ? (derniere === dm ? 'mesure' : 'journal') : null;
        const invite = Boolean(c.invite_le && !c.active_le);
        const inactifJours = derniere ? Math.floor((t - Date.parse(derniere)) / 86_400_000) : null;
        return {
          compte: c.id,
          pseudo: c.pseudo,
          teams: teamsDe.get(c.id) ?? [],
          statut: invite ? 'invite' : 'actif',
          inscritLe: c.cree_le,
          derniereActivite: derniere,
          source,
          jamaisConnecte: invite || !derniere,
          inactif: invite || !derniere || inactifJours >= absents,
          inactifJours,
          sessions: f?.sessions ?? 0,
          dureeMs: f?.dureeMs ?? 0,
          vues: f?.vues ?? 0,
          actions: f?.actions ?? 0,
          appareil: f ? ([...f.appareils.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null,
          pagesPreferees: f ? [...f.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([page, vues]) => ({ page, vues })) : [],
        };
      });
  }

  function pages(l, ctx, team) {
    const parPage = new Map();
    for (const p of l.pages) {
      const x = parPage.get(p.page) ?? { page: p.page, vues: 0, dureeMs: 0, visiteurs: new Set() };
      x.vues += p.vues;
      x.dureeMs += p.duree_ms;
      x.visiteurs.add(p.compte_id);
      parPage.set(p.page, x);
    }
    const module = id => PAGES.find(p => p.id === id)?.module ?? null;
    const classement = [...parPage.values()]
      .map(x => ({ page: x.page, module: module(x.page), vues: x.vues, visiteurs: x.visiteurs.size, dureeMs: x.dureeMs, dureeMoyenneMs: x.vues ? Math.round(x.dureeMs / x.vues) : 0 }))
      .sort((a, b) => b.vues - a.vues || b.visiteurs - a.visiteurs || a.page.localeCompare(b.page));
    const vues = new Set(classement.map(x => x.page));
    const jamais = PAGES.map(p => p.id).filter(id => !vues.has(id));
    // Modules activés mais jamais ouverts sur la période, par team.
    const ouverts = new Set(l.pages.filter(p => p.team_id).map(p => `${p.team_id}|${module(p.page)}`));
    const modulesAvecPage = new Set(PAGES.map(p => p.module).filter(Boolean));
    const nonUtilises = ctx.teams
      .filter(x => !team || x.id === team)
      .map(x => ({
        team: { id: x.id, nom: x.nom, slug: x.slug },
        modules: ctx.modules.filter(m => m.team_id === x.id && modulesAvecPage.has(m.module) && !ouverts.has(`${x.id}|${m.module}`)).map(m => m.module).sort(),
      }))
      .filter(x => x.modules.length > 0);
    return { classement, jamais, nonUtilises };
  }

  function activite(l, periode, histo) {
    const chaleur = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of l.heures) {
      // Jour de la semaine (1 = lundi) du jour civil : midi de ce jour à Paris.
      const js = partiesLocales(FUSEAU_USAGE, debutDuJour(h.jour) + 12 * 3_600_000).jourSemaine;
      chaleur[js - 1][h.heure] += h.n;
    }
    const quotidien = joursEntre(periode.du, periode.au).map(jour => {
      const m = l.membres.filter(x => x.jour === jour);
      const r = histo?.parJour.get(jour);
      const mesure = m.length > 0;
      return {
        jour,
        actifs: mesure ? new Set(m.map(x => x.compte_id)).size : (r?.actifs.size ?? 0),
        vues: somme(m, x => x.vues),
        sessions: somme(m, x => x.sessions),
        actions: mesure ? somme(m, x => x.actions) : (r?.actions ?? 0),
        reconstitue: !mesure && Boolean(r),
      };
    });
    const parAppareil = new Map();
    const parLangue = new Map();
    for (const m of l.membres) {
      const a = parAppareil.get(m.appareil) ?? { appareil: m.appareil, visiteurs: new Set(), sessions: 0, vues: 0, dureeMs: 0 };
      a.visiteurs.add(m.compte_id);
      a.sessions += m.sessions;
      a.vues += m.vues;
      a.dureeMs += m.duree_ms;
      parAppareil.set(m.appareil, a);
      const g = parLangue.get(m.langue) ?? { langue: m.langue, visiteurs: new Set(), sessions: 0 };
      g.visiteurs.add(m.compte_id);
      g.sessions += m.sessions;
      parLangue.set(m.langue, g);
    }
    return {
      chaleur,
      quotidien,
      appareils: APPAREILS.map(a => parAppareil.get(a)).filter(Boolean).map(a => ({ ...a, visiteurs: a.visiteurs.size })),
      langues: [...parLangue.values()].map(g => ({ ...g, visiteurs: g.visiteurs.size })).sort((a, b) => b.visiteurs - a.visiteurs),
    };
  }

  function teams(l, ctx, team, histo) {
    return ctx.teams
      .filter(x => !team || x.id === team)
      .map(x => {
        const membres = ctx.appartenances.filter(a => a.team_id === x.id && a.statut === 'actif').map(a => a.compte_id);
        const p = l.pages.filter(r => r.team_id === x.id);
        const a = l.actions.filter(r => r.team_id === x.id);
        const visiteurs = new Set([...p, ...a].map(r => r.compte_id));
        const reconstituees = histo ? somme(histo.actions.filter(r => r.team_id === x.id), r => r.n) : 0;
        return {
          id: x.id,
          nom: x.nom,
          slug: x.slug,
          membres: membres.length,
          visiteurs: visiteurs.size,
          adoption: membres.length ? Math.round((new Set(membres.filter(c => visiteurs.has(c))).size / membres.length) * 100) : 0,
          vues: somme(p, r => r.vues),
          dureeMs: somme(p, r => r.duree_ms),
          actions: somme(a, r => r.n),
          actionsReconstituees: reconstituees,
        };
      })
      .sort((a, b) => b.vues - a.vues || b.actions - a.actions || a.nom.localeCompare(b.nom));
  }

  function fonctions(l, histo) {
    const sortie = new Map(CATALOGUE_USAGE.fonctions.map(f => [f, { fonction: f, n: 0, utilisateurs: new Set(), reconstitue: 0, actions: new Map() }]));
    for (const a of l.actions) {
      const f = sortie.get(FONCTION_ACTION[a.action]);
      if (!f) continue;
      f.n += a.n;
      f.utilisateurs.add(a.compte_id);
      f.actions.set(a.action, (f.actions.get(a.action) ?? 0) + a.n);
    }
    for (const a of histo?.actions ?? []) {
      const f = sortie.get(FONCTION_ACTION[a.action]);
      if (!f) continue;
      f.reconstitue += a.n;
      f.utilisateurs.add(a.compte_id);
    }
    return [...sortie.values()].map(f => ({ fonction: f.fonction, n: f.n, reconstitue: f.reconstitue, utilisateurs: f.utilisateurs.size, actions: Object.fromEntries(f.actions) })).sort((a, b) => b.n + b.reconstitue - (a.n + a.reconstitue));
  }

  function erreurs(l) {
    const parErreur = new Map();
    for (const e of l.erreurs) {
      const cle = `${e.empreinte}|${e.page}`;
      const x = parErreur.get(cle) ?? { empreinte: e.empreinte, message: e.message, page: e.page || null, n: 0, utilisateurs: new Set(), appareils: new Set(), derniere: e.jour };
      x.n += e.n;
      x.utilisateurs.add(e.compte_id);
      x.appareils.add(e.appareil);
      if (e.jour > x.derniere) x.derniere = e.jour;
      parErreur.set(cle, x);
    }
    return [...parErreur.values()].map(x => ({ ...x, utilisateurs: x.utilisateurs.size, appareils: [...x.appareils] })).sort((a, b) => b.n - a.n || b.utilisateurs - a.utilisateurs).slice(0, 50);
  }

  // ---------------------------------------------------------------- Routes

  async function tableau(acteur, params = {}) {
    exigerFondateur(acteur);
    const periode = lirePeriode(params);
    const team = params.team ? (MOTIF_UUID.test(params.team) ? params.team : null) : undefined;
    if (team === null) throw echec(400, 'team', 'Team inconnue.');
    const role = params.role ? (ROLES.includes(params.role) ? params.role : null) : undefined;
    if (role === null) throw echec(400, 'role', 'Rôle inconnu.');
    const appareil = params.appareil ? (APPAREILS.includes(params.appareil) ? params.appareil : null) : undefined;
    if (appareil === null) throw echec(400, 'appareil', 'Appareil inconnu.');
    const absents = Math.min(365, Math.max(1, Number(params.absents) || 14));
    const filtres = { team, role, appareil };

    const ctx = await contexte();
    const retenus = comptesFiltres(ctx, filtres);
    const debutLecture = [periode.precedente.du, plusJours(periode.au, -29)].sort()[0];
    const brutes = await lignes(debutLecture, periode.au);
    const toutes = filtrer(brutes, filtres, retenus);
    const dans = (du, au) => Object.fromEntries(Object.entries(toutes).map(([k, v]) => [k, v.filter(x => dansJours(x.jour, du, au))]));
    const l = dans(periode.du, periode.au);
    const debutCollecte = await lireReglage(base, 'debut_collecte');
    const histo = appareil ? null : await reconstitution(periode.du, periode.au, debutCollecte, ctx, retenus, team);

    return {
      genereLe: iso(maintenant()),
      fuseau: FUSEAU_USAGE,
      periode: { du: periode.du, au: periode.au, jours: periode.jours, precedente: periode.precedente },
      filtres: { team: team ?? null, role: role ?? null, appareil: appareil ?? null, absents },
      collecte: { actif: await collecteActive(base), debut: debutCollecte, agregeJusqua: await lireReglage(base, 'agrege_jusqua') },
      historique: histo ? { reconstitue: true, du: histo.du, au: histo.au, tronque: histo.tronque } : { reconstitue: false },
      choix: {
        teams: ctx.teams.map(x => ({ id: x.id, nom: x.nom, slug: x.slug })),
        roles: ROLES,
        appareils: APPAREILS,
        pages: PAGES.map(p => p.id),
      },
      apercu: { ...apercu(dans(debutLecture, periode.au), ctx, periode, retenus) },
      utilisateurs: await utilisateurs(l, ctx, retenus, absents),
      pages: pages(l, ctx, team),
      activite: activite(l, periode, histo),
      teams: teams(l, ctx, team, histo),
      fonctions: fonctions(l, histo),
      erreurs: erreurs(l),
    };
  }

  async function ficheMembre(acteur, compte, params = {}) {
    exigerFondateur(acteur);
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    const c = await base.premier('SELECT id, pseudo, cree_le, invite_le, active_le FROM comptes WHERE id = ?', [compte]);
    const membreDe = await base.tous('SELECT m.team_id, t.nom, r.nom AS role_nom, m.statut FROM membres m JOIN teams t ON t.id = m.team_id JOIN roles r ON r.id = m.role_id WHERE m.compte_id = ?', [compte]);
    if (!c && membreDe.length === 0) throw echec(404, 'compte-introuvable', 'Compte introuvable.');
    const periode = lirePeriode(params);
    const l = await lignes(periode.du, periode.au, { compte });
    const parJour = joursEntre(periode.du, periode.au)
      .map(jour => {
        const m = l.membres.filter(x => x.jour === jour);
        return { jour, sessions: somme(m, x => x.sessions), vues: somme(m, x => x.vues), dureeMs: somme(m, x => x.duree_ms), actions: somme(m, x => x.actions) };
      })
      .filter(j => j.sessions || j.vues || j.actions);
    const parPage = new Map();
    for (const p of l.pages) {
      const x = parPage.get(p.page) ?? { page: p.page, vues: 0, dureeMs: 0 };
      x.vues += p.vues;
      x.dureeMs += p.duree_ms;
      parPage.set(p.page, x);
    }
    const debut = iso(debutDuJour(periode.du));
    const fin = iso(debutDuJour(plusJours(periode.au, 1)));
    const brut = await base.tous('SELECT genre, page, team_id, action, duree_ms, appareil, message, cree_le FROM usage_evenements WHERE compte_id = ? AND cree_le >= ? AND cree_le < ? ORDER BY cree_le DESC LIMIT 300', [compte, debut, fin]);
    const journal = await base.tous('SELECT team_id, action, cree_le FROM journal WHERE acteur_id = ? AND cree_le >= ? AND cree_le < ? ORDER BY cree_le DESC LIMIT 100', [compte, debut, fin]);
    const nomsTeams = new Map((await lignesParIds(base, 'SELECT id, nom FROM teams WHERE id', [...brut.map(e => e.team_id), ...journal.map(e => e.team_id)])).map(x => [x.id, x.nom]));
    const chronologie = [
      ...brut.map(e => ({ date: e.cree_le, source: 'mesure', genre: e.genre, page: e.page ?? null, team: e.team_id ? (nomsTeams.get(e.team_id) ?? null) : null, action: e.action ?? null, dureeMs: n(e.duree_ms), appareil: e.appareil, erreur: e.message ?? null })),
      ...journal.map(e => ({ date: e.cree_le, source: 'journal', genre: 'action', page: null, team: e.team_id ? (nomsTeams.get(e.team_id) ?? null) : null, action: e.action, dureeMs: 0, appareil: null, erreur: null })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const appareils = new Map();
    for (const m of l.membres) appareils.set(m.appareil, (appareils.get(m.appareil) ?? 0) + m.sessions + m.vues);
    return {
      compte,
      pseudo: c?.pseudo ?? null,
      inscritLe: c?.cree_le ?? null,
      premiereConnexion: c?.active_le ?? null,
      statut: c?.invite_le && !c?.active_le ? 'invite' : 'actif',
      teams: membreDe.map(m => ({ id: m.team_id, nom: m.nom, role: m.role_nom, statut: m.statut })),
      periode: { du: periode.du, au: periode.au },
      totaux: { sessions: somme(parJour, j => j.sessions), vues: somme(parJour, j => j.vues), dureeMs: somme(parJour, j => j.dureeMs), actions: somme(parJour, j => j.actions) },
      appareils: [...appareils.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a),
      parJour,
      pages: [...parPage.values()].sort((a, b) => b.vues - a.vues),
      chronologie,
    };
  }

  async function reglages(acteur) {
    exigerFondateur(acteur);
    return { collecte: await collecteActive(base), debut: await lireReglage(base, 'debut_collecte'), agregeJusqua: await lireReglage(base, 'agrege_jusqua') };
  }

  async function changerReglages(acteur, corps) {
    exigerFondateur(acteur);
    if (typeof corps?.collecte !== 'boolean') throw echec(400, 'collecte', 'Collecte : true ou false.');
    await base.lot([instructionReglage('collecte', corps.collecte ? '1' : '0', maintenant())]);
    return reglages(acteur);
  }

  return { tableau, ficheMembre, reglages, changerReglages };
}
