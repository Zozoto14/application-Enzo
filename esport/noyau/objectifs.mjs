/**
 * Module « Objectifs et tâches » (phase 3) : données propres à l'Esport,
 * séparées de l'app Tâches du hub.
 *
 *  - Objectif d'équipe (`proprietaire_id` NULL) ou d'un joueur ; sa
 *    progression est CALCULÉE à partir de ses tâches (faites / total).
 *  - Tâche : titre, description, assigné, échéance, priorité, statut
 *    (à faire, en cours, fait) ; listes filtrées (« mes tâches », « en
 *    retard »…) et vue kanban côté app.
 *  - Notifications : à l'assignation (événement `task.assigned`), et à
 *    l'approche de l'échéance (`task.due_soon`, posé par le cron :
 *    `rappelsEcheances`).
 *
 * Droits : `goals_tasks.view|create|update|delete|assign`. L'assigné d'une
 * tâche peut toujours en changer le statut (il la fait avancer), même avec la
 * seule lecture. Assigner quelqu'un d'autre que soi demande `assign`.
 */

import { evenement } from './evenements.mjs';
import { autorise } from './permissions.mjs';
import { echec, iso, nouvelId, texteLong, texteNettoye } from './outils.mjs';
import { csv } from './planning/presence.mjs';
import { pseudosDe } from './requetes.mjs';
import { dateValide } from './resumes.mjs';

export const MODULE_OBJECTIFS = 'goals_tasks';
export const STATUTS_TACHE = ['a_faire', 'en_cours', 'fait'];
export const PRIORITES = ['basse', 'normale', 'haute', 'urgente'];
export const STATUTS_OBJECTIF = ['actif', 'atteint', 'abandonne'];
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;
const JOUR_MS = 86_400_000;

/** Date du jour (AAAA-MM-JJ) dans le fuseau de la team. */
export function dateDuJour(ms, fuseau = 'Europe/Paris') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Progression d'un objectif à partir de ses tâches. */
export function progression(taches) {
  const total = taches.length;
  const faites = taches.filter(t => t.statut === 'fait').length;
  return { total, faites, pourcentage: total === 0 ? 0 : Math.round((faites / total) * 100) };
}

const exigerUuid = (valeur, quoi) => {
  if (typeof valeur !== 'string' || !MOTIF_UUID.test(valeur)) throw echec(404, `${quoi}-introuvable`, 'Introuvable.');
  return valeur;
};

export function servicesObjectifs({ base, maintenant = () => Date.now(), socle }) {
  const { contexteTeam } = socle;
  const peut = (ctx, p) => autorise(ctx.permissions, ctx.modules, p);

  function exiger(ctx, permission) {
    if (!ctx.modules.has(MODULE_OBJECTIFS)) throw echec(404, 'module-desactive', 'Ce module n’est pas activé pour cette team.');
    if (permission && !peut(ctx, permission)) throw echec(403, 'permission', 'Vous n’avez pas la permission de faire cela.');
  }

  async function membreActif(teamId, compte) {
    if (typeof compte !== 'string' || !MOTIF_COMPTE.test(compte)) return false;
    return Boolean(await base.premier("SELECT id FROM membres WHERE team_id = ? AND compte_id = ? AND statut = 'actif'", [teamId, compte]));
  }

  const noms = ids => pseudosDe(base, ids);

  const personne = (id, pseudos) => (id ? { compte: id, pseudo: pseudos[id] ?? null } : null);

  function tachePublique(t, pseudos, jour, objectifs) {
    return {
      id: t.id,
      titre: t.titre,
      description: t.description,
      objectif: t.objectif_id ? { id: t.objectif_id, titre: objectifs.get(t.objectif_id)?.titre ?? null } : null,
      assigne: personne(t.assigne_id, pseudos),
      echeance: t.echeance ?? null,
      priorite: t.priorite,
      statut: t.statut,
      enRetard: Boolean(t.echeance) && t.statut !== 'fait' && t.echeance < jour,
      creePar: personne(t.cree_par, pseudos),
      creeLe: t.cree_le,
      majLe: t.maj_le,
      termineLe: t.termine_le ?? null,
    };
  }

  // -------------------------------------------------------------- Objectifs

  async function lignesObjectifs(teamId) {
    return base.tous('SELECT * FROM objectifs WHERE team_id = ? AND supprime_le IS NULL ORDER BY statut, date_cible, cree_le', [teamId]);
  }

  async function objectifsPublics(teamId, lignes) {
    const taches = await base.tous('SELECT objectif_id, statut FROM taches WHERE team_id = ? AND supprime_le IS NULL AND objectif_id IS NOT NULL', [teamId]);
    const pseudos = await noms(lignes.flatMap(o => [o.proprietaire_id, o.cree_par]));
    return lignes.map(o => ({
      id: o.id,
      titre: o.titre,
      description: o.description,
      proprietaire: personne(o.proprietaire_id, pseudos),
      dateCible: o.date_cible ?? null,
      statut: o.statut,
      progression: progression(taches.filter(t => t.objectif_id === o.id)),
      creePar: personne(o.cree_par, pseudos),
      creeLe: o.cree_le,
    }));
  }

  async function objectifs(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.view');
    return objectifsPublics(teamId, await lignesObjectifs(teamId));
  }

  async function objectifDeTeam(teamId, id) {
    exigerUuid(id, 'objectif');
    const o = await base.premier('SELECT * FROM objectifs WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!o) throw echec(404, 'objectif-introuvable', 'Objectif introuvable.');
    return o;
  }

  async function lireObjectif(teamId, corps, partiel) {
    const s = {};
    if (!partiel || corps?.titre !== undefined) {
      s.titre = texteNettoye(corps?.titre, 120);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (!partiel || corps?.description !== undefined) s.description = texteLong(corps?.description, 2000);
    if (!partiel || corps?.proprietaire !== undefined) {
      const p = corps?.proprietaire ?? null;
      if (p !== null && !(await membreActif(teamId, p))) throw echec(400, 'proprietaire', 'Ce joueur n’est pas membre actif de la team.');
      s.proprietaire_id = p;
    }
    if (!partiel || corps?.dateCible !== undefined) {
      const d = corps?.dateCible ?? null;
      if (d !== null && !dateValide(d)) throw echec(400, 'date', 'Date cible : AAAA-MM-JJ.');
      s.date_cible = d;
    }
    if (corps?.statut !== undefined) {
      if (!STATUTS_OBJECTIF.includes(corps.statut)) throw echec(400, 'statut', 'Statut d’objectif inconnu.');
      s.statut = corps.statut;
    }
    return s;
  }

  async function creerObjectif(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.create');
    const s = await lireObjectif(teamId, corps, false);
    const t = maintenant();
    const id = nouvelId();
    await base.lot([
      {
        sql: 'INSERT INTO objectifs (id, team_id, titre, description, proprietaire_id, date_cible, statut, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [id, teamId, s.titre, s.description, s.proprietaire_id, s.date_cible, s.statut ?? 'actif', acteur.compte, iso(t), iso(t)],
      },
      evenement('goal.created', { teamId, acteur: acteur.compte, entiteType: 'objectif', entiteId: id, charge: { titre: s.titre, joueur: s.proprietaire_id }, maintenant: t }),
    ]);
    return (await objectifsPublics(teamId, [await objectifDeTeam(teamId, id)]))[0];
  }

  async function modifierObjectif(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.update');
    const o = await objectifDeTeam(teamId, id);
    const s = await lireObjectif(teamId, corps, true);
    const champs = Object.keys(s);
    if (champs.length > 0) {
      const t = maintenant();
      await base.lot([
        { sql: `UPDATE objectifs SET ${champs.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...champs.map(c => s[c]), iso(t), id] },
        evenement('goal.updated', { teamId, acteur: acteur.compte, entiteType: 'objectif', entiteId: id, charge: { titre: s.titre ?? o.titre, champs }, maintenant: t }),
      ]);
    }
    return (await objectifsPublics(teamId, [await objectifDeTeam(teamId, id)]))[0];
  }

  async function supprimerObjectif(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.delete');
    const o = await objectifDeTeam(teamId, id);
    const t = maintenant();
    // Les tâches restent (détachées de l'objectif) : rien de fait ne se perd.
    await base.lot([
      { sql: 'UPDATE objectifs SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), id] },
      { sql: 'UPDATE taches SET objectif_id = NULL, maj_le = ? WHERE objectif_id = ?', params: [iso(t), id] },
      evenement('goal.deleted', { teamId, acteur: acteur.compte, entiteType: 'objectif', entiteId: id, charge: { titre: o.titre }, maintenant: t }),
    ]);
    return { ok: true };
  }

  // -------------------------------------------------------------- Tâches

  /**
   * Tâches de la team. Filtres : `filtre` (« miennes », « retard »), `statut`,
   * `objectif`, `assigne`, `priorite`. Tri : échéance (sans échéance à la fin),
   * puis priorité.
   */
  async function taches(acteur, teamId, filtres = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.view');
    const jour = dateDuJour(maintenant(), ctx.team.fuseau);
    const conditions = ['team_id = ?', 'supprime_le IS NULL'];
    const params = [teamId];
    if (filtres.filtre === 'miennes') {
      conditions.push('assigne_id = ?');
      params.push(acteur.compte);
    } else if (filtres.filtre === 'retard') {
      conditions.push("echeance IS NOT NULL AND echeance < ? AND statut <> 'fait'");
      params.push(jour);
    } else if (filtres.filtre) throw echec(400, 'filtre', 'Filtre inconnu (miennes, retard).');
    if (filtres.statut) {
      if (!STATUTS_TACHE.includes(filtres.statut)) throw echec(400, 'statut', 'Statut inconnu.');
      conditions.push('statut = ?');
      params.push(filtres.statut);
    }
    if (filtres.priorite) {
      if (!PRIORITES.includes(filtres.priorite)) throw echec(400, 'priorite', 'Priorité inconnue.');
      conditions.push('priorite = ?');
      params.push(filtres.priorite);
    }
    if (filtres.objectif) {
      exigerUuid(filtres.objectif, 'objectif');
      conditions.push('objectif_id = ?');
      params.push(filtres.objectif);
    }
    if (filtres.assigne) {
      if (!MOTIF_COMPTE.test(filtres.assigne)) throw echec(400, 'assigne', 'Assigné inconnu.');
      conditions.push('assigne_id = ?');
      params.push(filtres.assigne);
    }
    // Pagination : `limite` (500 par défaut et au plus), `decalage` ; `suite` = décalage de la page suivante.
    const limite = Math.min(500, Math.max(1, Number(filtres.limite) || 500));
    const decalage = Math.max(0, Math.floor(Number(filtres.decalage) || 0));
    const lignes = await base.tous(
      `SELECT * FROM taches WHERE ${conditions.join(' AND ')}
        ORDER BY CASE WHEN echeance IS NULL THEN 1 ELSE 0 END, echeance,
                 CASE priorite WHEN 'urgente' THEN 0 WHEN 'haute' THEN 1 WHEN 'normale' THEN 2 ELSE 3 END, cree_le
        LIMIT ? OFFSET ?`,
      [...params, limite + 1, decalage],
    );
    const page = lignes.slice(0, limite);
    const objectifsTeam = new Map((await base.tous('SELECT id, titre FROM objectifs WHERE team_id = ?', [teamId])).map(o => [o.id, o]));
    const pseudos = await noms(page.flatMap(t => [t.assigne_id, t.cree_par]));
    return { jour, taches: page.map(t => tachePublique(t, pseudos, jour, objectifsTeam)), suite: lignes.length > limite ? decalage + limite : null };
  }

  /** Export CSV des tâches (mêmes filtres que la liste, sans pagination : 5 000 au plus). */
  async function exporterTaches(acteur, teamId, filtres = {}) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.view');
    const toutes = [];
    for (let decalage = 0; toutes.length < 5000; ) {
      const p = await taches(acteur, teamId, { ...filtres, limite: 500, decalage });
      toutes.push(...p.taches);
      if (p.suite === null) break;
      decalage = p.suite;
    }
    const S = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' };
    const P = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };
    const contenu = csv(
      ['Titre', 'Description', 'Objectif', 'Assigné', 'Échéance', 'Priorité', 'Statut', 'En retard', 'Créée par', 'Créée le', 'Terminée le'],
      toutes.map(t => [t.titre, t.description, t.objectif?.titre ?? '', t.assigne?.pseudo ?? (t.assigne ? 'Compte supprimé' : ''), t.echeance ?? '', P[t.priorite] ?? t.priorite, S[t.statut] ?? t.statut, t.enRetard ? 'Oui' : 'Non', t.creePar?.pseudo ?? '', t.creeLe, t.termineLe ?? '']),
    );
    return { nom: `taches-${ctx.team.slug}-${dateDuJour(maintenant(), ctx.team.fuseau)}.csv`, type: 'text/csv; charset=utf-8', contenu };
  }

  /** Export CSV des objectifs, avec leur progression. */
  async function exporterObjectifs(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.view');
    const liste = await objectifsPublics(teamId, await lignesObjectifs(teamId));
    const S = { actif: 'En cours', atteint: 'Atteint', abandonne: 'Abandonné' };
    const contenu = csv(
      ['Titre', 'Description', 'Pour', 'Date cible', 'Statut', 'Tâches faites', 'Tâches', 'Progression (%)', 'Créé par', 'Créé le'],
      liste.map(o => [o.titre, o.description, o.proprietaire ? (o.proprietaire.pseudo ?? 'Compte supprimé') : 'Équipe', o.dateCible ?? '', S[o.statut] ?? o.statut, o.progression.faites, o.progression.total, o.progression.pourcentage, o.creePar?.pseudo ?? '', o.creeLe]),
    );
    return { nom: `objectifs-${ctx.team.slug}-${dateDuJour(maintenant(), ctx.team.fuseau)}.csv`, type: 'text/csv; charset=utf-8', contenu };
  }

  async function tacheDeTeam(teamId, id) {
    exigerUuid(id, 'tache');
    const t = await base.premier('SELECT * FROM taches WHERE id = ? AND team_id = ? AND supprime_le IS NULL', [id, teamId]);
    if (!t) throw echec(404, 'tache-introuvable', 'Tâche introuvable.');
    return t;
  }

  async function tachePubliee(ctx, id) {
    const t = await tacheDeTeam(ctx.team.id, id);
    const jour = dateDuJour(maintenant(), ctx.team.fuseau);
    const objectifsTeam = new Map((await base.tous('SELECT id, titre FROM objectifs WHERE team_id = ?', [ctx.team.id])).map(o => [o.id, o]));
    return tachePublique(t, await noms([t.assigne_id, t.cree_par]), jour, objectifsTeam);
  }

  async function lireTache(ctx, corps, partiel) {
    const teamId = ctx.team.id;
    const s = {};
    if (!partiel || corps?.titre !== undefined) {
      s.titre = texteNettoye(corps?.titre, 120);
      if (s.titre.length < 2) throw echec(400, 'titre', 'Titre : 2 caractères au moins.');
    }
    if (!partiel || corps?.description !== undefined) s.description = texteLong(corps?.description, 2000);
    if (!partiel || corps?.echeance !== undefined) {
      const d = corps?.echeance ?? null;
      if (d !== null && !dateValide(d)) throw echec(400, 'date', 'Échéance : AAAA-MM-JJ.');
      s.echeance = d;
    }
    if (!partiel || corps?.priorite !== undefined) {
      const p = corps?.priorite ?? 'normale';
      if (!PRIORITES.includes(p)) throw echec(400, 'priorite', 'Priorité inconnue.');
      s.priorite = p;
    }
    if (!partiel || corps?.statut !== undefined) {
      const st = corps?.statut ?? 'a_faire';
      if (!STATUTS_TACHE.includes(st)) throw echec(400, 'statut', 'Statut inconnu.');
      s.statut = st;
    }
    if (!partiel || corps?.objectifId !== undefined) {
      const o = corps?.objectifId ?? null;
      if (o !== null) await objectifDeTeam(teamId, o).catch(() => Promise.reject(echec(400, 'objectif', 'Objectif inconnu.')));
      s.objectif_id = o;
    }
    if (!partiel || corps?.assigne !== undefined) {
      const a = corps?.assigne ?? null;
      if (a !== null && !(await membreActif(teamId, a))) throw echec(400, 'assigne', 'Ce compte n’est pas membre actif de la team.');
      s.assigne_id = a;
    }
    return s;
  }

  async function creerTache(acteur, teamId, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.create');
    const s = await lireTache(ctx, corps, false);
    if (s.assigne_id && s.assigne_id !== acteur.compte) exiger(ctx, 'goals_tasks.assign');
    const t = maintenant();
    const id = nouvelId();
    const lot = [
      {
        sql: `INSERT INTO taches (id, team_id, objectif_id, titre, description, assigne_id, echeance, priorite, statut, cree_par, cree_le, maj_le, termine_le)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, teamId, s.objectif_id, s.titre, s.description, s.assigne_id, s.echeance, s.priorite, s.statut, acteur.compte, iso(t), iso(t), s.statut === 'fait' ? iso(t) : null],
      },
      evenement('task.created', { teamId, acteur: acteur.compte, entiteType: 'tache', entiteId: id, charge: { titre: s.titre, objectif: s.objectif_id }, maintenant: t }),
    ];
    if (s.assigne_id) lot.push(evenement('task.assigned', { teamId, acteur: acteur.compte, entiteType: 'tache', entiteId: id, charge: { titre: s.titre, assigne: s.assigne_id, echeance: s.echeance }, maintenant: t }));
    await base.lot(lot);
    return tachePubliee(ctx, id);
  }

  async function modifierTache(acteur, teamId, id, corps) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.view');
    const avant = await tacheDeTeam(teamId, id);
    const s = await lireTache(ctx, corps, true);
    const champs = Object.keys(s).filter(c => s[c] !== avant[c]);
    if (champs.length === 0) return tachePubliee(ctx, id);
    // L'assigné fait avancer SA tâche (statut) avec la seule lecture ; le reste demande « modifier ».
    const seulStatutParAssigne = champs.every(c => c === 'statut') && avant.assigne_id === acteur.compte;
    if (!seulStatutParAssigne) {
      const autres = champs.filter(c => c !== 'assigne_id');
      if (autres.length > 0) exiger(ctx, 'goals_tasks.update');
      if (champs.includes('assigne_id') && !(s.assigne_id === acteur.compte && peut(ctx, 'goals_tasks.update'))) exiger(ctx, 'goals_tasks.assign');
    }
    const t = maintenant();
    const valeurs = { ...s };
    const colonnes = [...champs];
    if (champs.includes('statut')) {
      colonnes.push('termine_le');
      valeurs.termine_le = s.statut === 'fait' ? iso(t) : null;
    }
    // Nouvelle échéance ou nouvel assigné : le rappel d'échéance repart.
    if (champs.includes('echeance') || champs.includes('assigne_id')) {
      colonnes.push('rappel_le');
      valeurs.rappel_le = null;
    }
    const titre = s.titre ?? avant.titre;
    const lot = [
      { sql: `UPDATE taches SET ${colonnes.map(c => `${c} = ?`).join(', ')}, maj_le = ? WHERE id = ?`, params: [...colonnes.map(c => valeurs[c]), iso(t), id] },
      evenement('task.updated', {
        teamId,
        acteur: acteur.compte,
        entiteType: 'tache',
        entiteId: id,
        charge: { titre, champs, ...(champs.includes('statut') ? { de: avant.statut, vers: s.statut } : {}) },
        maintenant: t,
      }),
    ];
    if (champs.includes('assigne_id') && s.assigne_id) {
      lot.push(evenement('task.assigned', { teamId, acteur: acteur.compte, entiteType: 'tache', entiteId: id, charge: { titre, assigne: s.assigne_id, echeance: s.echeance ?? avant.echeance }, maintenant: t }));
    }
    await base.lot(lot);
    return tachePubliee(ctx, id);
  }

  async function supprimerTache(acteur, teamId, id) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'goals_tasks.delete');
    const tache = await tacheDeTeam(teamId, id);
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE taches SET supprime_le = ?, maj_le = ? WHERE id = ?', params: [iso(t), iso(t), id] },
      evenement('task.deleted', { teamId, acteur: acteur.compte, entiteType: 'tache', entiteId: id, charge: { titre: tache.titre }, maintenant: t }),
    ]);
    return { ok: true };
  }

  return { objectifs, creerObjectif, modifierObjectif, supprimerObjectif, taches, creerTache, modifierTache, supprimerTache, exporterTaches, exporterObjectifs };
}

/**
 * Cron : rappel d'échéance (une fois par tâche et par échéance) aux assignés
 * des tâches non faites dont l'échéance est demain, aujourd'hui ou passée
 * (dans le fuseau de la team). Rend le nombre de rappels posés.
 */
export async function rappelsEcheances(base, { maintenant = Date.now(), limite = 500 } = {}) {
  // Filtre large en SQL (le surlendemain en UTC couvre tous les fuseaux), précis ensuite.
  const borne = new Date(maintenant + 2 * JOUR_MS).toISOString().slice(0, 10);
  const lignes = await base.tous(
    `SELECT t.id, t.team_id, t.titre, t.assigne_id, t.echeance, te.fuseau FROM taches t
       JOIN teams te ON te.id = t.team_id
       JOIN team_modules tm ON tm.team_id = t.team_id AND tm.module = ? AND tm.active = 1
      WHERE t.supprime_le IS NULL AND t.statut <> 'fait' AND t.assigne_id IS NOT NULL AND t.rappel_le IS NULL
        AND t.echeance IS NOT NULL AND t.echeance <= ? AND te.supprimee_le IS NULL
      ORDER BY t.echeance LIMIT ?`,
    [MODULE_OBJECTIFS, borne, limite],
  );
  let poses = 0;
  for (const l of lignes) {
    const jour = dateDuJour(maintenant, l.fuseau);
    const demain = dateDuJour(maintenant + JOUR_MS, l.fuseau);
    if (l.echeance > demain) continue;
    const r = await base.executer('UPDATE taches SET rappel_le = ? WHERE id = ? AND rappel_le IS NULL', [iso(maintenant), l.id]);
    if (r.changements !== 1) continue;
    await base.lot([
      evenement('task.due_soon', {
        teamId: l.team_id,
        acteur: null,
        entiteType: 'tache',
        entiteId: l.id,
        charge: { titre: l.titre, assigne: l.assigne_id, echeance: l.echeance, retard: l.echeance < jour },
        maintenant,
      }),
    ]);
    poses++;
  }
  return poses;
}
