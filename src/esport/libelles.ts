/**
 * Phrases lisibles du journal d'activité et des notifications de l'Esport
 * (« Max a changé le rôle de Léa de Joueur à Coach »). Pur, testé.
 */

import { nomModule, type EntreeJournal, type Notification } from './client';
import { phraseJournalPlanning, phraseNotificationPlanning } from './planning/libelles';

const nom = (noms: Record<string, string | null>, id: unknown): string =>
  typeof id === 'string' ? (noms[id] ?? (id === 'principal' ? 'Le Fondateur' : 'Un compte supprimé')) : 'Quelqu’un';

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
    default:
      return phraseJournalPlanning(e.action, qui, m, id => nom(noms, id)) ?? `${qui} : ${e.action}`;
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
  ['event', 'Planning'],
  ['attendance', 'Présence'],
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
    default:
      return phraseNotificationPlanning(n.type, team, c) ?? `${team} : ${n.type}`;
  }
}

/** Date courte en français (« 20/10 à 14:05 »). */
export function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}
