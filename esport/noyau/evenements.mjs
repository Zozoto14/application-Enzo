/**
 * Bus d'événements interne (table `evenements`, modèle « outbox »).
 *
 * Chaque écriture importante ajoute, DANS LE MÊME LOT atomique que
 * l'écriture elle-même, une ligne d'événement de domaine (`team.created`,
 * `member.role_changed`…). Les abonnés (journal d'activité, notifications
 * in-app, et plus tard Discord) lisent ces lignes ; aucun module ne les
 * appelle directement.
 *
 * Distribution : juste après la requête (Worker : `waitUntil`), et par le
 * cron (événements en échec : nouvel essai). Chaque abonné est idempotent
 * (identifiants dérivés de l'événement, `ON CONFLICT DO NOTHING`) : un
 * événement traité deux fois ne laisse qu'une trace. Pour une file de jobs
 * plus tard, il suffit de remplacer `distribuer`.
 */

import { iso, jsonOu, nouvelId } from './outils.mjs';
import { TYPES_DISCORD } from './discord/catalogue.mjs';
import { abonneDiscord } from './discord/file.mjs';
import { TYPES_PLANNING, abonnePlanning } from './planning/bus.mjs';
import { TYPES_REVIEW, abonneReview } from './review/bus.mjs';

export const TYPES_EVENEMENTS = [
  'team.created',
  'team.updated',
  'team.deleted',
  'modules.changed',
  'role.created',
  'role.updated',
  'role.deleted',
  'member.joined',
  'member.role_changed',
  'member.status_changed',
  'member.removed',
  'member.left',
  'invitation.created',
  'invitation.revoked',
  'invitation.refused',
  'account.exported',
  'account.deleted',
  // Phase 3 : résumés de réunions, objectifs et tâches.
  'meeting.submitted',
  'meeting.status_changed',
  'meeting.summary_published',
  'meeting.deleted',
  'meeting_type.created',
  'meeting_type.updated',
  'meeting_type.deleted',
  'goal.created',
  'goal.updated',
  'goal.deleted',
  'task.created',
  'task.updated',
  'task.assigned',
  'task.deleted',
  'task.due_soon',
  ...TYPES_PLANNING,
  // Phase 4 : Discord (rappels J-1 / H-1, configuration, échecs d'envoi).
  ...TYPES_DISCORD,
  ...TYPES_REVIEW,
];

const ESSAIS_MAX = 8;

/** Instruction SQL qui ajoute l'événement à l'outbox (à mettre dans le lot de l'écriture). */
export function evenement(type, { teamId = null, acteur = null, entiteType = null, entiteId = null, charge = {}, maintenant }) {
  if (!TYPES_EVENEMENTS.includes(type)) throw new Error(`Événement inconnu : ${type}`);
  return {
    sql: 'INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
    params: [nouvelId(), type, teamId, acteur, entiteType, entiteId, JSON.stringify(charge), iso(maintenant)],
  };
}

// ------------------------------------------------------------------ Abonnés

/** Journal d'activité : une ligne par événement (même identifiant), jamais modifiée ni supprimée. */
export async function abonneJournal(base, ev) {
  await base.executer(
    'INSERT INTO journal (id, team_id, acteur_id, action, entite_type, entite_id, meta, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [ev.id, ev.team_id, ev.acteur_id, ev.type, ev.entite_type, ev.entite_id, ev.charge ?? '{}', ev.cree_le],
  );
}

/** Comptes d'une team qui ont une permission (Propriétaires compris). */
async function comptesAvecPermission(base, teamId, permission) {
  const lignes = await base.tous(
    `SELECT DISTINCT m.compte_id AS compte FROM membres m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission = ?
     WHERE m.team_id = ? AND m.statut = 'actif' AND (r.cle_systeme = 'proprietaire' OR rp.permission IS NOT NULL)`,
    [permission, teamId],
  );
  return lignes.map(l => l.compte);
}

async function notifier(base, ev, compte, type, charge) {
  // Identifiant stable par (événement, destinataire) : idempotent.
  await base.executer(
    'INSERT INTO notifications (id, compte_id, team_id, type, charge, cree_le) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${ev.id}:${compte}`, compte, ev.team_id, type, JSON.stringify(charge), ev.cree_le],
  );
}

/** Notifications in-app de base. */
export async function abonneNotifications(base, ev) {
  const charge = jsonOu(ev.charge, {});
  switch (ev.type) {
    case 'member.joined': {
      const gestion = await comptesAvecPermission(base, ev.team_id, 'members.invite');
      for (const compte of gestion) {
        if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'membre-arrive', { membre: ev.acteur_id, role: charge.role ?? null });
      }
      if (ev.acteur_id) await notifier(base, ev, ev.acteur_id, 'bienvenue', { role: charge.role ?? null });
      return;
    }
    case 'member.role_changed':
      if (charge.compte && charge.compte !== ev.acteur_id) {
        await notifier(base, ev, charge.compte, 'role-change', { de: charge.de ?? null, vers: charge.vers ?? null });
      }
      return;
    case 'member.removed':
      if (charge.compte && charge.compte !== ev.acteur_id) await notifier(base, ev, charge.compte, 'retire', {});
      return;
    case 'meeting.submitted': {
      // Rédacteurs de la team, et le Fondateur (rédacteur partout) s'il a un profil Esport.
      const redacteurs = new Set(await comptesAvecPermission(base, ev.team_id, 'meeting_summaries.write_summary'));
      if (await base.premier("SELECT id FROM comptes WHERE id = 'principal'", [])) redacteurs.add('principal');
      for (const compte of redacteurs) {
        if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'resume-depose', { membre: ev.acteur_id, titre: charge.titre ?? null, reunion: ev.entite_id });
      }
      return;
    }
    case 'meeting.summary_published':
      if (charge.deposePar && charge.deposePar !== ev.acteur_id) {
        await notifier(base, ev, charge.deposePar, 'resume-publie', { titre: charge.titre ?? null, reunion: ev.entite_id, remplacement: Boolean(charge.remplacement) });
      }
      return;
    case 'task.assigned':
      if (charge.assigne && charge.assigne !== ev.acteur_id) {
        await notifier(base, ev, charge.assigne, 'tache-assignee', { membre: ev.acteur_id, titre: charge.titre ?? null, tache: ev.entite_id, echeance: charge.echeance ?? null });
      }
      return;
    case 'task.due_soon':
      if (charge.assigne) await notifier(base, ev, charge.assigne, 'tache-echeance', { titre: charge.titre ?? null, tache: ev.entite_id, echeance: charge.echeance ?? null, retard: Boolean(charge.retard) });
      return;
    case 'modules.changed': {
      const membres = await base.tous("SELECT compte_id AS compte FROM membres WHERE team_id = ? AND statut = 'actif'", [ev.team_id]);
      for (const { compte } of membres) {
        if (compte !== ev.acteur_id) await notifier(base, ev, compte, 'modules', { actives: charge.actives ?? [], desactives: charge.desactives ?? [] });
      }
      return;
    }
    default:
      return;
  }
}

export const ABONNES_PAR_DEFAUT = [abonneJournal, abonneNotifications, abonnePlanning, abonneDiscord];
export const ABONNES_PAR_DEFAUT = [abonneJournal, abonneNotifications, abonnePlanning, abonneReview];

/**
 * Distribue les événements en attente aux abonnés. Un événement dont un
 * abonné échoue reste en attente (essais + 1) et repasse au prochain tour,
 * jusqu'à `ESSAIS_MAX`. Rend le nombre d'événements traités.
 */
export async function distribuer(base, { abonnes = ABONNES_PAR_DEFAUT, maintenant = Date.now(), limite = 100 } = {}) {
  const enAttente = await base.tous(
    'SELECT * FROM evenements WHERE traite_le IS NULL AND essais < ? ORDER BY cree_le, id LIMIT ?',
    [ESSAIS_MAX, limite],
  );
  let traites = 0;
  for (const ev of enAttente) {
    try {
      for (const abonne of abonnes) await abonne(base, ev);
      await base.executer('UPDATE evenements SET traite_le = ?, derniere_erreur = NULL WHERE id = ?', [iso(maintenant), ev.id]);
      traites++;
    } catch (e) {
      await base.executer('UPDATE evenements SET essais = essais + 1, derniere_erreur = ? WHERE id = ?', [String(e?.message ?? e).slice(0, 300), ev.id]);
    }
  }
  return traites;
}
