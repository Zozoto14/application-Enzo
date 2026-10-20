/**
 * Phrases lisibles du journal d'activité et des notifications de l'Esport
 * (« Max a changé le rôle de Léa de Joueur à Coach »). Pur, testé.
 */

import { nomModule, type EntreeJournal, type Notification, type Priorite, type StatutDepot, type StatutTache } from './client';

/** Statuts d'un dépôt de réunion. */
export const LIBELLES_STATUT_DEPOT: Record<StatutDepot, string> = { a_resumer: 'À résumer', en_cours: 'En cours', termine: 'Terminé' };
export const LIBELLES_STATUT_TACHE: Record<StatutTache, string> = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait' };
export const LIBELLES_PRIORITE: Record<Priorite, string> = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };

/** Date du jour (AAAA-MM-JJ, heure locale de l'appareil). */
export function aujourdhui(ms: number = Date.now()): string {
  const d = new Date(ms);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** « 2026-10-19 » → « 19/10/2026 » ; saisie « 19/10/2026 » → « 2026-10-19 » (ou undefined). */
export function dateJour(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '');
}
export function lireDateSaisie(texte: string): string | undefined {
  const t = texte.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** Taille lisible (« 1,2 Mo »). */
export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}
import { LIBELLES_DISCORD } from './discord/api';
import { phraseJournalPlanning, phraseNotificationPlanning } from './planning/libelles';
import { phraseJournalReview, phraseNotificationReview } from './review/libelles';

const nom = (noms: Record<string, string | null>, id: unknown): string =>
  typeof id === 'string' ? (noms[id] ?? (id === 'principal' ? 'Le Fondateur' : 'Un compte supprimé')) : 'Quelqu’un';

const nombre = (v: unknown): string => (typeof v === 'number' ? String(v) : '?');
const libelleDiscord = (cle: unknown): string => (typeof cle === 'string' ? (LIBELLES_DISCORD[cle] ?? cle) : '?');

const liste = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function phraseJournal(e: EntreeJournal, noms: Record<string, string | null>): string {
  const qui = nom(noms, e.acteur);
  const m = e.meta;
  const texte = (v: unknown) => (typeof v === 'string' ? v : '?');
  switch (e.action) {
    case 'team.created':
      return `${qui} a créé la team`;
    case 'team.updated':
      return `${qui} a modifié la team (${liste(m.champs).join(', ') || 'réglages'})`;
    case 'team.deleted':
      return `${qui} a supprimé la team`;
    case 'modules.changed': {
      const parts = [];
      if (liste(m.actives).length) parts.push(`activé ${liste(m.actives).map(nomModule).join(', ')}`);
      if (liste(m.desactives).length) parts.push(`désactivé ${liste(m.desactives).map(nomModule).join(', ')}`);
      return `${qui} a ${parts.join(' et ') || 'changé les modules'}`;
    }
    case 'role.created':
      return `${qui} a créé le rôle ${texte(m.nom)}`;
    case 'role.updated':
      return `${qui} a modifié le rôle ${texte(m.nom)}`;
    case 'role.deleted':
      return `${qui} a supprimé le rôle ${texte(m.nom)}`;
    case 'member.joined':
      return `${qui} a rejoint la team${typeof m.role === 'string' ? ` (${m.role})` : ''}`;
    case 'member.role_changed':
      return `${qui} a changé le rôle de ${nom(noms, m.compte)} de ${texte(m.de)} à ${texte(m.vers)}`;
    case 'member.status_changed':
      return `${qui} a ${m.statut === 'suspendu' ? 'suspendu' : 'réactivé'} ${nom(noms, m.compte)}`;
    case 'member.removed':
      return `${qui} a retiré ${nom(noms, m.compte)} de la team`;
    case 'member.left':
      return m.suppression ? `${qui} a quitté la team (données supprimées)` : `${qui} a quitté la team`;
    case 'invitation.created':
      return `${qui} a créé une invitation${typeof m.role === 'string' ? ` (${m.role})` : ''}`;
    case 'invitation.revoked':
      return `${qui} a annulé une invitation`;
    case 'meeting.submitted':
      return `${qui} a déposé la réunion « ${texte(m.titre)} »`;
    case 'meeting.status_changed':
      return `${qui} a passé « ${texte(m.titre)} » en ${LIBELLES_STATUT_DEPOT[m.vers as StatutDepot] ?? texte(m.vers)}${m.automatique ? ' (PDF déposé)' : ''}`;
    case 'meeting.summary_published':
      return `${qui} a ${m.remplacement ? 'remplacé le PDF du résumé' : 'publié le résumé'} « ${texte(m.titre)} »`;
    case 'meeting.deleted':
      return `${qui} a supprimé le dépôt « ${texte(m.titre)} »`;
    case 'meeting_type.created':
      return `${qui} a créé le type de réunion ${texte(m.nom)}${m.visibilite === 'staff' ? ' (staff)' : ''}`;
    case 'meeting_type.updated':
      return `${qui} a modifié le type de réunion ${texte(m.nom)}`;
    case 'meeting_type.deleted':
      return `${qui} a supprimé le type de réunion ${texte(m.nom)}`;
    case 'goal.created':
      return `${qui} a créé l’objectif « ${texte(m.titre)} »`;
    case 'goal.updated':
      return `${qui} a modifié l’objectif « ${texte(m.titre)} »`;
    case 'goal.deleted':
      return `${qui} a supprimé l’objectif « ${texte(m.titre)} »`;
    case 'task.created':
      return `${qui} a créé la tâche « ${texte(m.titre)} »`;
    case 'task.updated':
      return m.vers ? `${qui} a passé « ${texte(m.titre)} » en ${LIBELLES_STATUT_TACHE[m.vers as StatutTache] ?? texte(m.vers)}` : `${qui} a modifié la tâche « ${texte(m.titre)} »`;
    case 'task.assigned':
      return `${qui} a assigné « ${texte(m.titre)} » à ${nom(noms, m.assigne)}`;
    case 'task.deleted':
      return `${qui} a supprimé la tâche « ${texte(m.titre)} »`;
    case 'task.due_soon':
      return `Rappel d’échéance envoyé à ${nom(noms, m.assigne)} pour « ${texte(m.titre)} »`;
    case 'discord.webhook_set':
      return `${qui} a ${m.remplace ? 'remplacé' : 'enregistré'} le webhook Discord`;
    case 'discord.webhook_removed':
      return `${qui} a supprimé le webhook Discord`;
    case 'discord.settings_changed':
      return `${qui} a modifié la notification Discord « ${libelleDiscord(m.notification)} »`;
    case 'discord.test_sent':
      return `${qui} a envoyé un message de test sur Discord`;
    case 'discord.delivery_failed':
      return `Envoi Discord « ${libelleDiscord(m.cle)} » échoué (essai ${nombre(m.essai)}/${nombre(m.sur)}) : ${texte(m.motif)}`;
    case 'discord.delivery_abandoned':
      return `Envoi Discord « ${libelleDiscord(m.cle)} » abandonné : ${texte(m.motif)}`;
    case 'event.reminder_d1':
    case 'event.reminder_h1':
      return `Rappel ${e.action === 'event.reminder_d1' ? 'J-1' : 'H-1'} préparé pour « ${texte(m.titre)} »`;
    default:
      return phraseJournalPlanning(e.action, qui, m, id => nom(noms, id)) ?? phraseJournalReview(e.action, qui, m) ?? `${qui} : ${e.action}`;
  }
}

/** Catégories de filtre du journal (préfixe d'action). */
export const FILTRES_JOURNAL: ReadonlyArray<readonly [string, string]> = [
  ['', 'Tout'],
  ['member', 'Membres'],
  ['role', 'Rôles'],
  ['invitation', 'Invitations'],
  ['modules', 'Modules'],
  ['team', 'Team'],
  ['meeting', 'Résumés'],
  ['task', 'Tâches'],
  ['goal', 'Objectifs'],
  ['event', 'Planning'],
  ['attendance', 'Présence'],
  ['discord', 'Discord'],
  ['review', 'Review'],
  ['opponent', 'Scouting'],
];

export function phraseNotification(n: Notification, noms: Record<string, string | null>): string {
  const team = n.team?.nom ?? 'une team';
  const c = n.charge;
  switch (n.type) {
    case 'bienvenue':
      return `Bienvenue dans ${team}${typeof c.role === 'string' ? ` (${c.role})` : ''} !`;
    case 'membre-arrive':
      return `${nom(noms, c.membre)} a rejoint ${team}${typeof c.role === 'string' ? ` (${c.role})` : ''}`;
    case 'role-change':
      return `Votre rôle dans ${team} est maintenant ${typeof c.vers === 'string' ? c.vers : '?'}`;
    case 'retire':
      return `Vous avez été retiré de ${team}`;
    case 'modules':
      return `Les modules de ${team} ont changé`;
    case 'resume-depose':
      return `${nom(noms, c.membre)} a déposé une réunion à résumer dans ${team}${typeof c.titre === 'string' ? ` : « ${c.titre} »` : ''}`;
    case 'resume-publie':
      return `Le résumé de « ${typeof c.titre === 'string' ? c.titre : 'votre réunion'} » est ${c.remplacement ? 'mis à jour' : 'prêt'} (${team})`;
    case 'tache-assignee':
      return `${nom(noms, c.membre)} vous a assigné « ${typeof c.titre === 'string' ? c.titre : 'une tâche'} »${typeof c.echeance === 'string' ? ` pour le ${dateJour(c.echeance)}` : ''} (${team})`;
    case 'tache-echeance':
      return `${c.retard ? 'En retard' : 'Échéance proche'} : « ${typeof c.titre === 'string' ? c.titre : 'une tâche'} »${typeof c.echeance === 'string' ? ` (${dateJour(c.echeance)})` : ''}`;
    default:
      return phraseNotificationPlanning(n.type, team, c) ?? phraseNotificationReview(n.type, team, c) ?? `${team} : ${n.type}`;
  }
}

/** Date courte en français (« 20/10 à 14:05 »). */
export function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}
