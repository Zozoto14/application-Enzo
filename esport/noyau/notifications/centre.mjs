/**
 * Centre de notifications de l'Esport (migration 0038, docs/esport/notifications.md).
 *
 * Deux sources, UNIFIÉES dans une seule liste triée par date :
 *  - le FIL (`notifs_centre`) : une ligne par événement du bus (même identifiant : idempotent), avec sa catégorie
 *    et sa clé d'accès (regles.mjs). Il n'est livré qu'aux comptes qui ont le droit de voir l'élément, vérifié à
 *    CHAQUE lecture avec les rôles du moment (droits.mjs) ; le Fondateur (CEO) voit tout ;
 *  - les notifications PERSONNELLES (`notifications`, une ligne par destinataire, écrites par chaque module :
 *    « on vous a assigné une tâche »…). Quand les deux existent pour un même événement, seule la personnelle
 *    s'affiche (pas de doublon). Elles restent soumises à l'appartenance actuelle à la team, et aux Sponsors / CM.
 *
 * Lu / non lu : lecture par élément (`notifs_lectures`), « Tout marquer comme lu » (`lu_jusqua` des préférences),
 * colonne `lue_le` pour les personnelles. Les actions du lecteur lui-même ne sont jamais « non lues ».
 * Préférences par compte (`notifs_preferences`) : catégories masquées, catégories silencieuses (pas de compteur ni
 * d'annonce en direct), teams suivies. Rétention : 90 jours (purge par le cron).
 *
 * Temps réel : `surNouvelleNotification(fn)` reçoit `{ compte, id, source, categorie, teamId }` pour chaque compte
 * concerné dès qu'une notification est créée (voir la doc pour le branchement).
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { pseudosDe } from '../requetes.mjs';
import { CATEGORIES, categoriePerso, chargePublique, lienDeCategorie, regleDe, regleEffective } from './regles.mjs';
import { aCm, droitsLecteur, teamsDuLecteur, voit } from './droits.mjs';

export const RETENTION_NOTIFICATIONS_JOURS = 90;
const JOUR_MS = 86_400_000;
const LIMITE_DEFAUT = 30;
const LIMITE_MAX = 100;
/** Éléments dont la visibilité peut se resserrer (privée / staff) : voir `abonneCentre`. */
const ENTITES_RESSERRABLES = ['strat', 'ressource', 'resultat'];
/** Personnelles visibles même hors de la team (l'intéressé vient d'en être retiré). */
const PERSO_HORS_TEAM = ['retire'];

// ------------------------------------------------------------------ Temps réel

const ecouteurs = new Set();

/**
 * Abonnement aux notifications créées (temps réel) : `fn({ compte, id, source, categorie, teamId })`, une fois par
 * compte concerné (droits ET préférences « me notifier » respectés). Rend la fonction de désabonnement.
 */
export function surNouvelleNotification(fn) {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}

function annoncer(message) {
  for (const fn of ecouteurs) {
    try {
      fn(message);
    } catch (e) {
      console.error('[esport] notification en direct', e);
    }
  }
}

// ------------------------------------------------------------------ Préférences

const listeDe = (v, permis) => [...new Set((Array.isArray(jsonOu(v, [])) ? jsonOu(v, []) : []).filter(x => typeof x === 'string' && (!permis || permis.includes(x))))];

export async function lirePreferences(base, compte) {
  const l = await base.premier('SELECT * FROM notifs_preferences WHERE compte_id = ?', [compte]);
  let luJusqua = l?.lu_jusqua ?? null;
  if (!luJusqua) {
    // Sans « tout lu » : rien d'avant la création du compte n'est « non lu » (pas d'historique d'une team rejointe).
    // (Strictement avant : ce qui arrive dans la même milliseconde que la création du compte reste à lire.)
    const c = await base.premier('SELECT cree_le FROM comptes WHERE id = ?', [compte]);
    const ms = Date.parse(c?.cree_le ?? '');
    luJusqua = Number.isFinite(ms) ? iso(ms - 1) : '';
  }
  return {
    masquees: listeDe(l?.masquees, CATEGORIES),
    silencieuses: listeDe(l?.silencieuses, CATEGORIES),
    teams: listeDe(l?.teams),
    luJusqua,
  };
}

/** L'élément compte-t-il pour ce compte (préférences « suivies », teams, et « me notifier » si `annonce`) ? */
function selonPreferences(prefs, categorie, teamId, { annonce = false } = {}) {
  if (prefs.masquees.includes(categorie)) return false;
  if (annonce && prefs.silencieuses.includes(categorie)) return false;
  if (teamId && prefs.teams.length && !prefs.teams.includes(teamId)) return false;
  return true;
}

// ------------------------------------------------------------------ Abonné du bus

/** Catégorie et événement d'origine des notifications personnelles d'un compte qui n'en ont pas encore. */
async function classerPersonnelles(base, compte) {
  const lignes = await base.tous('SELECT id, type FROM notifications WHERE compte_id = ? AND categorie IS NULL LIMIT 1000', [compte]);
  for (const l of lignes) {
    const suffixe = `:${compte}`;
    const evenementId = l.id.endsWith(suffixe) ? l.id.slice(0, -suffixe.length) : null;
    await base.executer('UPDATE notifications SET categorie = ?, evenement_id = ? WHERE id = ?', [categoriePerso(l.type), evenementId, l.id]);
  }
}

/**
 * Abonné du bus (le DERNIER de la liste : les notifications personnelles de l'événement sont déjà écrites) :
 * une ligne du fil par événement (identifiant = celui de l'événement, `ON CONFLICT DO NOTHING` : idempotent).
 */
export async function abonneCentre(base, ev) {
  const regle = await regleEffective(base, ev);
  const r = await base.executer(
    `INSERT INTO notifs_centre (id, type, categorie, acces, portee_cle, team_id, acteur_id, entite_type, entite_id, lien, charge, cree_le)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    [ev.id, ev.type, regle.categorie, regle.acces, `${regle.acces}@${ev.team_id ?? ''}`, ev.team_id ?? null, ev.acteur_id ?? null, ev.entite_type ?? null, ev.entite_id ?? null, regle.lien ? JSON.stringify(regle.lien) : null, chargePublique(jsonOu(ev.charge, {})), ev.cree_le],
  );
  // Visibilité resserrée APRÈS coup : une strat devenue privée, une ressource ou un résultat passés « staff » (tous
  // les éléments du fil de cet élément prennent l'accès restreint), un type de réunion devenu « staff ».
  if (ev.entite_id && ev.team_id && ENTITES_RESSERRABLES.includes(ev.entite_type) && regle.acces !== regleDe(ev.type).acces) {
    await base.executer('UPDATE notifs_centre SET acces = ?, portee_cle = ? WHERE entite_type = ? AND entite_id = ? AND team_id = ?', [regle.acces, `${regle.acces}@${ev.team_id}`, ev.entite_type, ev.entite_id, ev.team_id]);
  }
  if (ev.type === 'meeting_type.updated' && jsonOu(ev.charge, {}).visibilite === 'staff' && ev.entite_id) {
    const acces = regleDe('meeting.summary_published').acces;
    await base.executer(
      "UPDATE notifs_centre SET acces = ?, portee_cle = ? || '@' || COALESCE(team_id, '') WHERE type = 'meeting.summary_published' AND entite_id IN (SELECT id FROM reunions WHERE type_id = ?)",
      [acces, acces, ev.entite_id],
    );
  }
  if (Number(r?.changements ?? 0) === 1 && ecouteurs.size > 0) await annoncerEvenement(base, ev, regle);
}

/** Annonce en direct : comptes qui voient le nouvel élément (ou en ont reçu une notification personnelle). */
async function annoncerEvenement(base, ev, regle) {
  const deja = new Set();
  const perso = await base.tous('SELECT id, compte_id, type, team_id FROM notifications WHERE id >= ? AND id < ?', [`${ev.id}:`, `${ev.id};`]);
  for (const p of perso) {
    const categorie = categoriePerso(p.type);
    deja.add(p.compte_id);
    if (selonPreferences(await lirePreferences(base, p.compte_id), categorie, p.team_id, { annonce: true })) annoncer({ compte: p.compte_id, id: p.id, source: 'perso', categorie, teamId: p.team_id ?? null });
  }
  if (regle.acces === 'aucun') return;
  const comptes = await base.tous('SELECT id FROM comptes', []);
  for (const { id: compte } of comptes) {
    if (deja.has(compte) || compte === ev.acteur_id) continue;
    const droits = await droitsLecteur(base, { compte, superAdmin: compte === 'principal' });
    if (!voit(droits, regle.acces, ev.team_id)) continue;
    if (selonPreferences(await lirePreferences(base, compte), regle.categorie, ev.team_id, { annonce: true })) annoncer({ compte, id: ev.id, source: 'fil', categorie: regle.categorie, teamId: ev.team_id ?? null });
  }
}

// ------------------------------------------------------------------ Rétention

/** Purge (cron) : fil, lectures et notifications personnelles de plus de 90 jours. */
export async function purgerNotifications(base, { maintenant = Date.now(), jours = RETENTION_NOTIFICATIONS_JOURS } = {}) {
  const limite = iso(maintenant - jours * JOUR_MS);
  const fil = await base.executer('DELETE FROM notifs_centre WHERE cree_le < ?', [limite]);
  const lectures = await base.executer('DELETE FROM notifs_lectures WHERE lue_le < ?', [limite]);
  const perso = await base.executer('DELETE FROM notifications WHERE cree_le < ?', [limite]);
  return { fil: Number(fil?.changements ?? 0), lectures: Number(lectures?.changements ?? 0), personnelles: Number(perso?.changements ?? 0) };
}

// ------------------------------------------------------------------ Lecture

const MOTIF_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const MOTIF_ID = /^[A-Za-z0-9:_-]{1,200}$/;

function lireFiltres(q = {}) {
  const liste = v => (typeof v === 'string' && v ? v.split(',') : Array.isArray(v) ? v : []).filter(x => typeof x === 'string');
  const categories = liste(q.categories).filter(c => CATEGORIES.includes(c));
  const jour = (v, quoi) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || !MOTIF_JOUR.test(v)) throw echec(400, quoi, 'Date : AAAA-MM-JJ.');
    return v;
  };
  const id = (v, quoi) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || !MOTIF_ID.test(v)) throw echec(400, quoi, 'Identifiant illisible.');
    return v;
  };
  let curseur;
  if (q.suite) {
    const [date, ident] = String(q.suite).split('|');
    if (!date || !ident || date.length > 40 || !MOTIF_ID.test(ident)) throw echec(400, 'suite', 'Curseur illisible.');
    curseur = { date, id: ident };
  }
  const limite = Math.min(LIMITE_MAX, Math.max(1, Number.parseInt(q.limite ?? LIMITE_DEFAUT, 10) || LIMITE_DEFAUT));
  return {
    categories,
    team: id(q.team, 'team'),
    auteur: id(q.auteur, 'auteur'),
    du: jour(q.du, 'du'),
    au: jour(q.au, 'au'),
    nonLues: q.nonLues === true || q.nonLues === '1' || q.nonLues === 'true',
    ordre: q.ordre === 'asc' ? 'asc' : 'desc',
    curseur,
    limite,
  };
}

export function servicesCentre({ base, maintenant = () => Date.now() }) {
  /**
   * Clés d'accès (et team) du fil que le lecteur voit, aujourd'hui : condition sur l'alias `c` (le fil) et sur
   * l'alias `e` (événement d'origine d'une personnelle : son auteur n'est montré que si l'élément est visible).
   */
  async function filtreFil(droits) {
    if (droits.tout) return { c: "c.acces <> 'aucun'", e: "e.acces <> 'aucun'", params: [] };
    const cles = await base.tous('SELECT DISTINCT portee_cle, acces, team_id FROM notifs_centre', []);
    const visibles = [...new Set(cles.filter(c => voit(droits, c.acces, c.team_id)).map(c => c.portee_cle))];
    if (!visibles.length) return { c: '1 = 0', e: '1 = 0', params: [] };
    const marques = visibles.map(() => '?').join(', ');
    return { c: `c.portee_cle IN (${marques})`, e: `e.portee_cle IN (${marques})`, params: visibles };
  }

  /** Personnelles : toujours à leur destinataire, mais seulement tant qu'il a accès à leur domaine. */
  function filtrePerso(droits) {
    // Pas encore classée (écrite à l'instant) : au prochain passage, une fois sa catégorie connue.
    if (droits.tout) return { sql: 'p.categorie IS NOT NULL', params: [] };
    const conditions = ['p.categorie IS NOT NULL'];
    const params = [];
    const teams = [...teamsDuLecteur(droits)];
    conditions.push(`(p.team_id IS NULL OR p.type IN (${PERSO_HORS_TEAM.map(() => '?').join(', ')})${teams.length ? ` OR p.team_id IN (${teams.map(() => '?').join(', ')})` : ''})`);
    params.push(...PERSO_HORS_TEAM, ...teams);
    if (!droits.club.has('sponsors.voir')) conditions.push("COALESCE(p.categorie, '') <> 'sponsors'");
    if (!aCm(droits)) conditions.push("COALESCE(p.categorie, '') NOT IN ('cm', 'drive')");
    return { sql: conditions.join(' AND '), params };
  }

  /** Requête unifiée (fil + personnelles) d'un lecteur, avant filtres. */
  async function union(acteur, droits, prefs) {
    const fil = await filtreFil(droits);
    const perso = filtrePerso(droits);
    const sql = `
      SELECT c.id AS id, 'fil' AS source, c.type AS type, c.categorie AS categorie, c.team_id AS team_id, c.acteur_id AS acteur_id,
             c.entite_type AS entite_type, c.entite_id AS entite_id, c.lien AS lien, c.charge AS charge, c.cree_le AS cree_le, c.type AS evenement,
             CASE WHEN l.notif_id IS NOT NULL OR c.cree_le <= ? OR c.acteur_id = ? THEN 1 ELSE 0 END AS lue
        FROM notifs_centre c LEFT JOIN notifs_lectures l ON l.compte_id = ? AND l.notif_id = c.id
       WHERE ${fil.c} AND NOT EXISTS (SELECT 1 FROM notifications d WHERE d.id = c.id || CAST(? AS TEXT))
      UNION ALL
      SELECT p.id AS id, 'perso' AS source, p.type AS type, p.categorie AS categorie, p.team_id AS team_id,
             CASE WHEN ${fil.e} THEN e.acteur_id ELSE NULL END AS acteur_id,
             CASE WHEN ${fil.e} THEN e.entite_type ELSE NULL END AS entite_type,
             CASE WHEN ${fil.e} THEN e.entite_id ELSE NULL END AS entite_id,
             e.lien AS lien, p.charge AS charge, p.cree_le AS cree_le, e.type AS evenement,
             CASE WHEN p.lue_le IS NULL THEN 0 ELSE 1 END AS lue
        FROM notifications p LEFT JOIN notifs_centre e ON e.id = p.evenement_id
       WHERE p.compte_id = ? AND ${perso.sql}`;
    // Auteur et élément d'une personnelle : seulement si le lecteur voit l'élément (note partagée « auteur masqué »).
    return {
      sql,
      params: [prefs.luJusqua, acteur.compte, acteur.compte, ...fil.params, `:${acteur.compte}`, ...fil.params, ...fil.params, ...fil.params, acteur.compte, ...perso.params],
    };
  }

  /** Conditions des filtres et des préférences sur l'union (`x`). `compteur` : catégories silencieuses exclues. */
  function conditions(f, prefs, { compteur = false } = {}) {
    const w = [];
    const p = [];
    let categories = f.categories.length ? f.categories : CATEGORIES.filter(c => !prefs.masquees.includes(c));
    if (compteur) categories = categories.filter(c => !prefs.silencieuses.includes(c));
    if (!categories.length) return { sql: '1 = 0', params: [] };
    w.push(`x.categorie IN (${categories.map(() => '?').join(', ')})`);
    p.push(...categories);
    if (f.team) {
      w.push('x.team_id = ?');
      p.push(f.team);
    } else if (prefs.teams.length) {
      w.push(`(x.team_id IS NULL OR x.team_id IN (${prefs.teams.map(() => '?').join(', ')}))`);
      p.push(...prefs.teams);
    }
    if (f.auteur) {
      w.push('x.acteur_id = ?');
      p.push(f.auteur);
    }
    if (f.du) {
      w.push('x.cree_le >= ?');
      p.push(`${f.du}T00:00:00.000Z`);
    }
    if (f.au) {
      w.push('x.cree_le <= ?');
      p.push(`${f.au}T23:59:59.999Z`);
    }
    if (f.nonLues || compteur) w.push('x.lue = 0');
    if (f.curseur) {
      const signe = f.ordre === 'asc' ? '>' : '<';
      w.push(`(x.cree_le ${signe} ? OR (x.cree_le = ? AND x.id ${signe} ?))`);
      p.push(f.curseur.date, f.curseur.date, f.curseur.id);
    }
    return { sql: w.join(' AND '), params: p };
  }

  async function contexte(acteur) {
    await classerPersonnelles(base, acteur.compte);
    const [droits, prefs] = await Promise.all([droitsLecteur(base, acteur), lirePreferences(base, acteur.compte)]);
    return { droits, prefs };
  }

  async function compter(acteur, droits, prefs) {
    const { sql, params } = await union(acteur, droits, prefs);
    const c = conditions(lireFiltres({}), prefs, { compteur: true });
    const extra = c.sql;
    const l = await base.premier(`SELECT COUNT(*) AS n FROM (${sql}) x WHERE ${extra}`, [...params, ...c.params]);
    return Number(l?.n ?? 0);
  }

  /** `GET /notifications/compteur` : non lues qui comptent (droits et préférences). */
  async function compteur(acteur) {
    const { droits, prefs } = await contexte(acteur);
    return { nonLues: await compter(acteur, droits, prefs) };
  }

  /**
   * `GET /notifications/centre` : page de la liste unifiée. Filtres : `categories` (liste séparée par des virgules),
   * `team`, `auteur`, `du` / `au` (AAAA-MM-JJ), `nonLues`, `ordre` (desc par défaut, ou asc), `suite` (curseur), `limite`.
   */
  async function liste(acteur, q = {}) {
    const f = lireFiltres(q);
    const { droits, prefs } = await contexte(acteur);
    const { sql, params } = await union(acteur, droits, prefs);
    const c = conditions(f, prefs);
    const extra = c.sql;
    // Ordre : un des deux mots fixes (jamais une valeur reçue).
    const ordre = f.ordre === 'asc' ? 'x.cree_le ASC, x.id ASC' : 'x.cree_le DESC, x.id DESC';
    const lignes = await base.tous(`SELECT * FROM (${sql}) x WHERE ${extra} ORDER BY ${ordre} LIMIT ?`, [...params, ...c.params, f.limite + 1]);
    const page = lignes.slice(0, f.limite);
    const suite = lignes.length > f.limite ? `${page[page.length - 1].cree_le}|${page[page.length - 1].id}` : null;
    const idsTeams = [...new Set(page.map(l => l.team_id).filter(Boolean))];
    const teams = idsTeams.length ? new Map((await base.tous(`SELECT id, nom, slug FROM teams WHERE id IN (${idsTeams.map(() => '?').join(', ')})`, idsTeams)).map(t => [t.id, t])) : new Map();
    const charges = page.map(l => jsonOu(l.charge, {}));
    const noms = await pseudosDe(base, [...page.map(l => l.acteur_id), ...charges.flatMap(ch => [ch.membre, ch.compte, ch.assigne, ch.demandeur])].filter(x => typeof x === 'string'));
    return {
      liste: page.map((l, i) => ({
        id: l.id,
        source: l.source,
        type: l.type,
        evenement: l.evenement ?? null,
        categorie: l.categorie,
        team: l.team_id ? { id: l.team_id, nom: teams.get(l.team_id)?.nom ?? null } : null,
        acteur: l.acteur_id ?? null,
        entite: l.entite_type ? { type: l.entite_type, id: l.entite_id ?? null } : null,
        lien: jsonOu(l.lien, null) ?? lienDeCategorie(l.categorie, l.team_id),
        charge: charges[i],
        lue: Number(l.lue) === 1,
        date: l.cree_le,
      })),
      noms,
      suite,
      nonLues: await compter(acteur, droits, prefs),
      // Filtres proposés : teams visibles (Fondateur : toutes) et catégories.
      categories: CATEGORIES,
      teams: await teamsFiltrables(droits),
    };
  }

  async function teamsFiltrables(droits) {
    const lignes = await base.tous('SELECT id, nom FROM teams WHERE supprimee_le IS NULL ORDER BY nom', []);
    const miennes = teamsDuLecteur(droits);
    return lignes.filter(t => !miennes || miennes.has(t.id)).map(t => ({ id: t.id, nom: t.nom }));
  }

  /**
   * `POST /notifications/centre/lues` `{ ids?: [...] }` ou `{ tout: true }`. Une notification que le compte ne voit
   * pas n'est jamais touchée (personnelle : la sienne seulement ; fil : lecture enregistrée sans rien révéler).
   */
  async function marquerLues(acteur, corps) {
    const t = iso(maintenant());
    if (corps?.tout === true) {
      await base.lot([
        {
          sql: `INSERT INTO notifs_preferences (compte_id, masquees, silencieuses, teams, lu_jusqua, maj_le) VALUES (?, '[]', '[]', '[]', ?, ?)
                ON CONFLICT (compte_id) DO UPDATE SET lu_jusqua = excluded.lu_jusqua, maj_le = excluded.maj_le`,
          params: [acteur.compte, t, t],
        },
        { sql: 'UPDATE notifications SET lue_le = ? WHERE compte_id = ? AND lue_le IS NULL', params: [t, acteur.compte] },
        { sql: 'DELETE FROM notifs_lectures WHERE compte_id = ?', params: [acteur.compte] },
      ]);
    } else {
      if (!Array.isArray(corps?.ids) || corps.ids.length > 200) throw echec(400, 'ids', 'Liste d’identifiants attendue (200 au plus).');
      for (const id of corps.ids) {
        if (typeof id !== 'string' || !MOTIF_ID.test(id)) continue;
        if (id.includes(':')) {
          await base.executer('UPDATE notifications SET lue_le = ? WHERE id = ? AND compte_id = ? AND lue_le IS NULL', [t, id, acteur.compte]);
        } else {
          await base.executer('INSERT INTO notifs_lectures (compte_id, notif_id, lue_le) SELECT ?, id, ? FROM notifs_centre WHERE id = ? ON CONFLICT (compte_id, notif_id) DO NOTHING', [acteur.compte, t, id]);
        }
      }
    }
    return compteur(acteur);
  }

  /** `GET /notifications/preferences`. */
  async function preferences(acteur) {
    const p = await lirePreferences(base, acteur.compte);
    return { masquees: p.masquees, silencieuses: p.silencieuses, teams: p.teams, categories: CATEGORIES };
  }

  /** `PUT /notifications/preferences` `{ masquees?, silencieuses?, teams? }` : listes complètes (remplacent). */
  async function changerPreferences(acteur, corps) {
    const actuelles = await lirePreferences(base, acteur.compte);
    const lire = (v, permis, quoi) => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.length > 100 || v.some(x => typeof x !== 'string' || (permis ? !permis.includes(x) : !MOTIF_ID.test(x)))) throw echec(400, quoi, 'Liste illisible.');
      return [...new Set(v)];
    };
    const masquees = lire(corps?.masquees, CATEGORIES, 'masquees') ?? actuelles.masquees;
    const silencieuses = lire(corps?.silencieuses, CATEGORIES, 'silencieuses') ?? actuelles.silencieuses;
    const teams = lire(corps?.teams, null, 'teams') ?? actuelles.teams;
    const t = iso(maintenant());
    await base.executer(
      `INSERT INTO notifs_preferences (compte_id, masquees, silencieuses, teams, lu_jusqua, maj_le) VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT (compte_id) DO UPDATE SET masquees = excluded.masquees, silencieuses = excluded.silencieuses, teams = excluded.teams, maj_le = excluded.maj_le`,
      [acteur.compte, JSON.stringify(masquees), JSON.stringify(silencieuses), JSON.stringify(teams), t],
    );
    return preferences(acteur);
  }

  return { liste, compteur, marquerLues, preferences, changerPreferences };
}

/** Données du centre d'un compte (RGPD : export) : préférences et lectures. Le fil n'est pas « à lui ». */
export async function exportCentre(base, compte) {
  const p = await base.premier('SELECT masquees, silencieuses, teams, lu_jusqua, maj_le FROM notifs_preferences WHERE compte_id = ?', [compte]);
  const lectures = await base.tous('SELECT notif_id, lue_le FROM notifs_lectures WHERE compte_id = ? ORDER BY lue_le', [compte]);
  return {
    preferences: p ? { masquees: jsonOu(p.masquees, []), silencieuses: jsonOu(p.silencieuses, []), teams: jsonOu(p.teams, []), luJusqua: p.lu_jusqua ?? null, majLe: p.maj_le } : null,
    lectures: lectures.map(l => ({ notification: l.notif_id, lueLe: l.lue_le })),
  };
}

/** Instructions RGPD (suppression d'un compte) : ses préférences et lectures. */
export const effacementCentre = compte => [
  { sql: 'DELETE FROM notifs_preferences WHERE compte_id = ?', params: [compte] },
  { sql: 'DELETE FROM notifs_lectures WHERE compte_id = ?', params: [compte] },
];
