/**
 * Journal d'activité (plan, 7.11) : lecture paginée et filtrée, export CSV,
 * politique de rétention et purge par le cron.
 *
 *  - Lecture : `activity_log.view` (par défaut Propriétaire et Manager), module
 *    `activity_log` activé. Filtres : membre (acteur), module, action (ou
 *    famille d'actions), période (du … au, dates de la team) ; pagination par
 *    curseur (`avant` = date de la dernière entrée lue).
 *  - Append-only : l'application n'offre AUCUNE route de modification ni de
 *    suppression. Seule la purge de rétention (cron) efface des lignes
 *    anciennes, selon la durée choisie par la team.
 *  - Rétention : `team_modules.config` du module `activity_log`
 *    (`{ "retentionJours": 365 }`), réglée par `team.manage` ; 0 = illimitée.
 *    Lignes sans team (export ou suppression de compte) : RETENTION_GLOBALE_JOURS.
 */

import { evenement } from './evenements.mjs';
import { exigerPeriode } from './periode.mjs';
import { LANGUE_DEFAUT, lireLangue, listeTextes, texte as T } from './langues.mjs';
import { csv } from './planning/presence.mjs';
import { pseudosDe } from './requetes.mjs';
import { echec, iso, jsonOu } from './outils.mjs';

export const MODULE_JOURNAL = 'activity_log';
export const RETENTIONS_JOURS = [0, 30, 90, 180, 365, 730];
export const RETENTION_DEFAUT_JOURS = 365;
export const RETENTION_GLOBALE_JOURS = 365;
/** Événements du bus déjà distribués : gardés 30 jours (diagnostic), puis effacés. */
export const RETENTION_EVENEMENTS_JOURS = 30;
const JOUR_MS = 86_400_000;
const MAX_EXPORT = 20_000;

/** Familles d'actions (préfixes) par module ; « coeur » : team, membres, rôles, invitations, comptes. */
export const ACTIONS_PAR_MODULE = {
  coeur: ['team', 'modules', 'role', 'member', 'invitation', 'account'],
  planning: ['event', 'ical'],
  availability: ['availability'],
  attendance: ['attendance'],
  meeting_summaries: ['meeting', 'meeting_type'],
  goals_tasks: ['goal', 'task'],
  discord: ['discord'],
  video_review: ['review'],
  scouting: ['opponent'],
  strat_editor: ['strat'],
  playbook: ['playbook'],
};

/** Module d'une action (« event.created » → « planning »), ou « coeur ». */
export function moduleDAction(action) {
  const prefixe = String(action ?? '').split('.')[0];
  for (const [module, prefixes] of Object.entries(ACTIONS_PAR_MODULE)) if (prefixes.includes(prefixe)) return module;
  return 'coeur';
}

const MOTIF_ACTION = /^[a-z_]+(\.[a-z_0-9]+)?$/;
const MOTIF_COMPTE = /^(principal|[a-z0-9]{6,16})$/;

/** Conditions SQL des filtres (paramétrées), communes à la liste et à l'export. */
function conditionsFiltres(teamId, filtres, fuseau) {
  const conditions = ['team_id = ?'];
  const params = [teamId];
  if (filtres.action) {
    if (!MOTIF_ACTION.test(filtres.action)) throw echec(400, 'action', 'Action inconnue.');
    if (filtres.action.includes('.')) {
      conditions.push('action = ?');
      params.push(filtres.action);
    } else {
      conditions.push('action LIKE ?');
      params.push(`${filtres.action}.%`);
    }
  }
  if (filtres.module) {
    const prefixes = ACTIONS_PAR_MODULE[filtres.module];
    if (!prefixes) throw echec(400, 'module', 'Module inconnu.');
    conditions.push(`(${prefixes.map(() => 'action LIKE ?').join(' OR ')})`);
    params.push(...prefixes.map(p => `${p}.%`));
  }
  if (filtres.acteur) {
    if (!MOTIF_COMPTE.test(filtres.acteur)) throw echec(400, 'acteur', 'Membre inconnu.');
    conditions.push('acteur_id = ?');
    params.push(filtres.acteur);
  }
  if (filtres.du || filtres.au) {
    const { du, au } = exigerPeriode(filtres, fuseau, { maxJours: 3660, ouverte: true });
    if (du !== undefined) {
      conditions.push('cree_le >= ?');
      params.push(iso(du));
    }
    if (au !== undefined) {
      conditions.push('cree_le < ?');
      params.push(iso(au));
    }
  }
  return { conditions, params };
}

const entreePublique = l => ({ id: l.id, action: l.action, module: moduleDAction(l.action), acteur: l.acteur_id, entiteType: l.entite_type, entiteId: l.entite_id, meta: jsonOu(l.meta, {}), date: l.cree_le });

/** Comptes cités par une entrée (acteur, membre visé, assigné d'une tâche, déposant d'une réunion). */
function comptesCites(entrees) {
  const ids = [];
  for (const e of entrees) {
    if (e.acteur) ids.push(e.acteur);
    for (const cle of ['compte', 'assigne', 'deposePar']) if (typeof e.meta[cle] === 'string') ids.push(e.meta[cle]);
  }
  return ids;
}

export function servicesJournal({ base, maintenant = () => Date.now(), socle }) {
  const { contexteTeam, exiger } = socle;

  async function contexte(acteur, teamId) {
    const ctx = await contexteTeam(acteur, teamId);
    exiger(ctx, 'activity_log.view');
    const l = await base.premier('SELECT config FROM team_modules WHERE team_id = ? AND module = ?', [teamId, MODULE_JOURNAL]);
    return { ...ctx, configJournal: jsonOu(l?.config, {}) ?? {} };
  }

  /** Liste paginée (50 par défaut, 100 au plus), du plus récent au plus ancien. */
  async function liste(acteur, teamId, filtres = {}) {
    const ctx = await contexte(acteur, teamId);
    const limite = Math.min(100, Math.max(1, Number(filtres.limite) || 50));
    const { conditions, params } = conditionsFiltres(teamId, filtres, ctx.team.fuseau);
    if (filtres.avant) {
      // Curseur « date|id » de la dernière entrée lue : les entrées de même date (un même lot) ne sont ni sautées ni répétées.
      const [date, id] = String(filtres.avant).split('|');
      const avant = Date.parse(date);
      if (Number.isNaN(avant) || (id !== undefined && !/^[0-9a-f-]{36}$/.test(id))) throw echec(400, 'avant', 'Curseur de pagination illisible.');
      if (id) {
        conditions.push('(cree_le < ? OR (cree_le = ? AND id < ?))');
        params.push(iso(avant), iso(avant), id);
      } else {
        conditions.push('cree_le < ?');
        params.push(iso(avant));
      }
    }
    const lignes = await base.tous(`SELECT * FROM journal WHERE ${conditions.join(' AND ')} ORDER BY cree_le DESC, id DESC LIMIT ?`, [...params, limite + 1]);
    const entrees = lignes.slice(0, limite).map(entreePublique);
    // Membres de la team (filtre « membre ») : une seule requête.
    const membres = await base.tous('SELECT m.compte_id AS compte, c.pseudo FROM membres m LEFT JOIN comptes c ON c.id = m.compte_id WHERE m.team_id = ? ORDER BY c.pseudo_cle', [teamId]);
    const noms = await pseudosDe(base, comptesCites(entrees));
    return {
      entrees,
      noms,
      suite: lignes.length > limite ? `${entrees[entrees.length - 1].date}|${entrees[entrees.length - 1].id}` : null,
      membres: membres.map(m => ({ compte: m.compte, pseudo: m.pseudo ?? null })),
      retentionJours: retentionDe(ctx),
    };
  }

  /** Export CSV des entrées filtrées (20 000 au plus), avec les pseudos. */
  async function exporter(acteur, teamId, filtres = {}) {
    const ctx = await contexte(acteur, teamId);
    const { conditions, params } = conditionsFiltres(teamId, filtres, ctx.team.fuseau);
    const lignes = await base.tous(`SELECT * FROM journal WHERE ${conditions.join(' AND ')} ORDER BY cree_le DESC, id DESC LIMIT ?`, [...params, MAX_EXPORT]);
    const entrees = lignes.map(entreePublique);
    const noms = await pseudosDe(base, comptesCites(entrees));
    const L = lireLangue(acteur.langue) ?? LANGUE_DEFAUT;
    const qui = id => (id ? (noms[id] ?? T(L, id === 'principal' ? 'csv.journal.fondateur' : 'csv.compte_supprime')) : T(L, 'csv.journal.systeme'));
    const contenu = csv(
      listeTextes(L, 'csv.journal.entetes'),
      entrees.map(e => [e.date, qui(e.acteur), e.module, e.action, e.entiteType ?? '', e.entiteId ?? '', JSON.stringify(e.meta)]),
    );
    const jour = new Date(maintenant()).toISOString().slice(0, 10);
    return { nom: `journal-${ctx.team.slug}-${jour}.csv`, type: 'text/csv; charset=utf-8', contenu, lignes: entrees.length };
  }

  function retentionDe(ctx) {
    const jours = Number(ctx.configJournal?.retentionJours);
    return RETENTIONS_JOURS.includes(jours) ? jours : RETENTION_DEFAUT_JOURS;
  }

  async function lireReglages(acteur, teamId) {
    const ctx = await contexte(acteur, teamId);
    return { retentionJours: retentionDe(ctx), choix: RETENTIONS_JOURS, modifiable: ctx.permissions.has('team.manage') || acteur.superAdmin };
  }

  /** Durée de conservation (`team.manage`) : 0 (illimitée), 30, 90, 180, 365 ou 730 jours. */
  async function changerReglages(acteur, teamId, corps) {
    const ctx = await contexte(acteur, teamId);
    exiger(ctx, 'team.manage');
    const jours = Number(corps?.retentionJours);
    if (!RETENTIONS_JOURS.includes(jours)) throw echec(400, 'retention', `Durée de conservation : ${RETENTIONS_JOURS.join(', ')} jours (0 = illimitée).`);
    const config = { ...(ctx.configJournal ?? {}), retentionJours: jours };
    const t = maintenant();
    await base.lot([
      { sql: 'UPDATE team_modules SET config = ?, maj_le = ? WHERE team_id = ? AND module = ?', params: [JSON.stringify(config), iso(t), teamId, MODULE_JOURNAL] },
      evenement('team.updated', { teamId, acteur: acteur.compte, entiteType: 'team', entiteId: teamId, charge: { champs: ['retention_journal'], retentionJours: jours }, maintenant: t }),
    ]);
    return { retentionJours: jours, choix: RETENTIONS_JOURS, modifiable: true };
  }

  return { liste, exporter, lireReglages, changerReglages };
}

/**
 * Cron : purge de rétention. Pour chaque team, efface les lignes du journal
 * plus anciennes que sa durée de conservation (0 = rien) ; lignes sans team :
 * durée globale ; événements du bus déjà distribués : 30 jours. Rend le bilan.
 */
export async function purgerJournal(base, { maintenant = Date.now() } = {}) {
  const bilan = { journal: 0, evenements: 0 };
  const configs = await base.tous('SELECT t.id, tm.config FROM teams t LEFT JOIN team_modules tm ON tm.team_id = t.id AND tm.module = ?', [MODULE_JOURNAL]);
  for (const c of configs) {
    const jours = Number(jsonOu(c.config, {})?.retentionJours ?? RETENTION_DEFAUT_JOURS);
    if (!Number.isFinite(jours) || jours <= 0) continue;
    const r = await base.executer('DELETE FROM journal WHERE team_id = ? AND cree_le < ?', [c.id, iso(maintenant - jours * JOUR_MS)]);
    bilan.journal += Number(r?.changements ?? 0);
  }
  const g = await base.executer('DELETE FROM journal WHERE team_id IS NULL AND cree_le < ?', [iso(maintenant - RETENTION_GLOBALE_JOURS * JOUR_MS)]);
  bilan.journal += Number(g?.changements ?? 0);
  const e = await base.executer('DELETE FROM evenements WHERE traite_le IS NOT NULL AND cree_le < ?', [iso(maintenant - RETENTION_EVENEMENTS_JOURS * JOUR_MS)]);
  bilan.evenements = Number(e?.changements ?? 0);
  return bilan;
}
