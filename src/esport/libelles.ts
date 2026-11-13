/**
 * Phrases lisibles du journal d'activité et des notifications de l'Esport
 * (« Max a changé le rôle de Léa de Joueur à Coach »). Pur, testé.
 */

import { trDv } from './i18n/devblog';
import { trRt } from './i18n/rolesTemp';
import { nomModule, nomPermission, nomRole, type AlerteTableau, type EntreeJournal, type Notification, type Priorite, type StatutDepot, type StatutTache } from './client';

/** Statuts d'un dépôt de réunion. */
export const LIBELLES_STATUT_DEPOT: Record<StatutDepot, string> = { get a_resumer() {
      return tr('libelles.a_resumer');
    }, get en_cours() {
      return tr('libelles.en_cours');
    }, get termine() {
      return tr('creationCompte.termine');
    } };
export const LIBELLES_STATUT_TACHE: Record<StatutTache, string> = { get a_faire() {
      return tr('libelles.a_faire');
    }, get en_cours() {
      return tr('libelles.en_cours');
    }, get fait() {
      return tr('libelles.fait');
    } };
export const LIBELLES_PRIORITE: Record<Priorite, string> = { get basse() {
      return tr('libelles.basse');
    }, get normale() {
      return tr('libelles.normale');
    }, get haute() {
      return tr('libelles.haute');
    }, get urgente() {
      return tr('libelles.urgente');
    } };

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

/** Taille lisible (« 1,2 Mo » / « 1.2 MB »). */
export function tailleLisible(octets: number): string {
  if (octets < 1024) return tr('fmt.octets', { n: octets });
  if (octets < 1024 * 1024) return tr('fmt.ko', { n: Math.round(octets / 1024) });
  return tr('fmt.mo', { n: formaterNombre(octets / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}
import { LIBELLES_DISCORD, MOTIFS_TEST_MP } from './discord/api';
import { formaterDate, formaterNombre, tr, trn } from './i18n';
import { phraseJournalPlanning, phraseNotificationPlanning } from './planning/libelles';
import { phraseJournalReview, phraseNotificationReview } from './review/libelles';
import { phraseJournalStrats, phraseNotificationStrats } from './strats/libelles';
import { phraseJournalLineups, phraseNotificationLineups } from './lineups/libelles';
import { phraseJournalRessources, phraseNotificationRessources } from './ressources/libelles';
import { phraseJournalCompetition, phraseNotificationCompetition } from './competition/libelles';
import { phraseJournalCm, phraseNotificationCm } from './cm/libelles';
import { phraseNotificationSponsors } from './sponsors/libelles';
import { phraseNotificationTickets } from './tickets/libelles';
import { phraseAlerte, phraseJournalAlerte } from './notifications/alertes';

const nom = (noms: Record<string, string | null>, id: unknown): string =>
  typeof id === 'string' ? (noms[id] ?? (id === 'principal' ? tr('jr.fondateur') : tr('jr.compte_supprime'))) : tr('jr.quelquun');

const nombre = (v: unknown): string => (typeof v === 'number' ? String(v) : '?');
const libelleDiscord = (cle: unknown): string => (cle === 'relances_mp' ? tr('discord.mp.titre') : typeof cle === 'string' ? (LIBELLES_DISCORD[cle] ?? cle) : '?');

const liste = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** « (Joueur) » après un nom de team ou de compte, quand le rôle est connu. */
const avecRole = (v: unknown): string => (typeof v === 'string' ? tr('jr.role_entre_parentheses', { role: nomRole(v) }) : '');

export function phraseJournal(e: EntreeJournal, noms: Record<string, string | null>): string {
  const qui = nom(noms, e.acteur);
  const m = e.meta;
  const texte = (v: unknown) => (typeof v === 'string' ? v : '?');
  // Alertes techniques (migration 0077) : le journal montre la cause, comme la notification.
  const alerte = phraseJournalAlerte(e.action, m);
  if (alerte) return alerte;
  switch (e.action) {
    case 'team.created':
      return tr('jr.team_created', { qui });
    case 'team.updated':
      return tr('jr.team_updated', { qui, champs: liste(m.champs).join(', ') || tr('jr.reglages') });
    case 'team.deleted':
      return tr('jr.team_deleted', { qui });
    case 'modules.changed': {
      const parts = [];
      if (liste(m.actives).length) parts.push(tr('jr.modules_actives', { modules: liste(m.actives).map(nomModule).join(', ') }));
      if (liste(m.desactives).length) parts.push(tr('jr.modules_desactives', { modules: liste(m.desactives).map(nomModule).join(', ') }));
      return tr('jr.modules_changed', { qui, actions: parts.join(tr('jr.et')) || tr('jr.modules_changes') });
    }
    case 'role.created':
      return tr('jr.role_created', { qui, nom: texte(m.nom) });
    case 'role.updated': {
      const ajouts = liste(m.ajoutees);
      const retraits = liste(m.retirees);
      if (!ajouts.length && !retraits.length) return tr('jr.role_updated', { qui, nom: nomRole(texte(m.nom)) });
      const parts = [];
      if (ajouts.length) parts.push(tr('jr.role_ajouts', { liste: ajouts.map(nomPermission).join(', ') }));
      if (retraits.length) parts.push(tr('jr.role_retraits', { liste: retraits.map(nomPermission).join(', ') }));
      return tr(m.retabli ? 'jr.role_permissions_retablies' : 'jr.role_permissions_updated', { qui, nom: nomRole(texte(m.nom)), details: parts.join(' ; ') });
    }
    case 'role.deleted':
      return tr('jr.role_deleted', { qui, nom: texte(m.nom) });
    case 'member.joined':
      return tr('jr.member_joined', { qui, role: avecRole(m.role) });
    case 'member.role_changed':
      return tr('jr.member_role_changed', { qui, compte: nom(noms, m.compte), de: nomRole(texte(m.de)), vers: nomRole(texte(m.vers)) });
    case 'member.status_changed':
      return tr(m.statut === 'suspendu' ? 'jr.member_suspended' : 'jr.member_reactivated', { qui, compte: nom(noms, m.compte) });
    case 'member.added':
      return tr('jr.member_added', { qui, compte: nom(noms, m.compte), role: avecRole(m.role), invite: m.invite ? tr('jr.invitation_envoyee') : '' });
    case 'member.account_requested':
      return tr('jr.account_requested', { qui, pseudo: texte(m.pseudo), role: avecRole(m.role) });
    case 'member.account_request_validated':
      return tr('jr.account_request_validated', { qui, pseudo: texte(m.pseudo) });
    case 'member.account_request_refused':
      return tr('jr.account_request_refused', { qui, pseudo: texte(m.pseudo) });
    case 'member.removed':
      return m.suppression === 'administration'
        ? tr('jr.member_removed_admin', { pseudo: typeof m.pseudo === 'string' ? m.pseudo : nom(noms, m.compte) })
        : tr('jr.member_removed', { qui, compte: nom(noms, m.compte) });
    case 'member.left':
      return tr(m.suppression ? 'jr.member_left_deleted' : 'jr.member_left', { qui });
    case 'invitation.created':
      return tr('jr.invitation_created', { qui, role: avecRole(m.role) });
    case 'invitation.revoked':
      return tr('jr.invitation_revoked', { qui });
    case 'meeting.submitted':
      return tr('jr.meeting_submitted', { qui, titre: texte(m.titre) });
    case 'meeting.status_changed':
      return tr('jr.meeting_status_changed', {
        qui,
        titre: texte(m.titre),
        statut: LIBELLES_STATUT_DEPOT[m.vers as StatutDepot] ?? texte(m.vers),
        auto: m.automatique ? tr('jr.pdf_depose') : '',
      });
    case 'meeting.summary_published':
      return tr(m.remplacement ? 'jr.summary_replaced' : 'jr.summary_published', { qui, titre: texte(m.titre) });
    case 'meeting.deleted':
      return tr('jr.meeting_deleted', { qui, titre: texte(m.titre) });
    case 'meeting.transcription_ready':
      // Faite par le serveur (migration 0016) : pas d'acteur.
      return e.acteur ? tr('jr.transcription_ready', { qui, titre: texte(m.titre) }) : tr('jr.transcription_ready_serveur', { titre: texte(m.titre) });
    case 'meeting.transcription_failed':
      return tr('jr.transcription_failed', { titre: texte(m.titre) });
    case 'meeting.transcription_updated':
      return tr('jr.transcription_updated', { qui, titre: texte(m.titre) });
    case 'media.deleted':
      return tr('jr.media_deleted', { qui, nom: texte(m.nom) });
    case 'meeting_type.created':
      return tr('jr.meeting_type_created', { qui, nom: texte(m.nom), staff: m.visibilite === 'staff' ? tr('jr.staff_entre_parentheses') : '' });
    case 'meeting_type.updated':
      return tr('jr.meeting_type_updated', { qui, nom: texte(m.nom) });
    case 'meeting_type.deleted':
      return tr('jr.meeting_type_deleted', { qui, nom: texte(m.nom) });
    case 'goal.created':
      return tr('jr.goal_created', { qui, titre: texte(m.titre) });
    case 'goal.updated':
      return tr('jr.goal_updated', { qui, titre: texte(m.titre) });
    case 'goal.deleted':
      return tr('jr.goal_deleted', { qui, titre: texte(m.titre) });
    case 'task.created':
      return tr('jr.task_created', { qui, titre: texte(m.titre) });
    case 'task.updated':
      return m.vers
        ? tr('jr.task_status_changed', { qui, titre: texte(m.titre), statut: LIBELLES_STATUT_TACHE[m.vers as StatutTache] ?? texte(m.vers) })
        : tr('jr.task_updated', { qui, titre: texte(m.titre) });
    case 'task.assigned':
      return tr('jr.task_assigned', { qui, titre: texte(m.titre), assigne: nom(noms, m.assigne) });
    case 'task.deleted':
      return tr('jr.task_deleted', { qui, titre: texte(m.titre) });
    case 'task.due_soon':
      return tr('jr.task_due_soon', { assigne: nom(noms, m.assigne), titre: texte(m.titre) });
    case 'discord.webhook_set':
      return tr(m.remplace ? 'jr.webhook_replaced' : 'jr.webhook_saved', { qui });
    case 'discord.webhook_removed':
      return tr('jr.webhook_removed', { qui });
    case 'discord.settings_changed':
      return tr('jr.discord_settings_changed', { qui, notification: libelleDiscord(m.notification) });
    case 'discord.test_sent':
      return tr('jr.discord_test_sent', { qui });
    case 'discord.delivery_failed':
      return tr('jr.discord_delivery_failed', { notification: libelleDiscord(m.cle), essai: nombre(m.essai), sur: nombre(m.sur), motif: texte(m.motif) });
    case 'discord.dm_failed':
      return tr('jr.discord_dm_failed', { membre: nom(noms, m.compte), motif: tr(`discord.mp.motif.${['mp_fermes', 'introuvable'].includes(String(m.motif)) ? String(m.motif) : 'refuse'}` as 'discord.mp.motif.refuse') });
    case 'discord.test_mp':
      return tr('jr.discord_test_mp', { qui, membre: nom(noms, m.compte), resultat: m.ok ? tr('discord.testmp.journal_ok') : tr(`discord.testmp.motif.${(MOTIFS_TEST_MP as readonly string[]).includes(String(m.motif)) ? String(m.motif) : 'refuse'}` as 'discord.testmp.motif.refuse') });
    case 'discord.delivery_abandoned':
      return tr('jr.discord_delivery_abandoned', { notification: libelleDiscord(m.cle), motif: texte(m.motif) });
    case 'discord.server_linked':
      return tr('jr.discord_server_linked', { qui, salon: typeof m.salon === 'string' && m.salon ? tr('jr.salon_entre_parentheses', { salon: m.salon }) : '' });
    case 'discord.server_unlinked':
      return tr('jr.discord_server_unlinked', { qui });
    case 'discord.pings_changed':
      return tr(m.ping ? 'jr.discord_ping_on' : 'jr.discord_ping_off', { qui, type: texte(m.type) });
    case 'discord.command_used':
      return tr('jr.discord_command_used', { qui, commande: texte(m.commande) });
    // Rôles temporaires : le nom du rôle et de la personne viennent de Discord, affichés tels quels.
    case 'discord.role_temp_given':
      return trRt(m.prolonge ? 'journal_phrase_prolonge' : 'journal_phrase_donne', { qui, role: texte(m.role), membre: texte(m.membre) });
    case 'discord.role_temp_removed':
      return m.expire ? trRt('journal_phrase_expire', { role: texte(m.role), membre: texte(m.membre) }) : trRt('journal_phrase_retire', { qui, role: texte(m.role), membre: texte(m.membre) });
    case 'discord.account_linked':
      return tr('jr.discord_account_linked', { qui });
    case 'discord.account_unlinked':
      return tr('jr.discord_account_unlinked', { qui });
    // Suivi des joueurs : jamais le contenu d'une note, seulement le joueur concerné.
    case 'player_note.created':
      return tr('jr.player_note_created', { qui, joueur: nom(noms, m.compte) });
    case 'player_note.updated':
      return tr('jr.player_note_updated', { qui, joueur: nom(noms, m.compte) });
    case 'player_note.deleted':
      return tr('jr.player_note_deleted', { qui, joueur: nom(noms, m.compte) });
    case 'player_note.shared':
      return tr(m.partagee ? 'jr.player_note_shared' : 'jr.player_note_unshared', { qui, joueur: nom(noms, m.compte) });
    case 'attendance.relance':
      return tr('jr.attendance_relance', { qui, titre: texte(m.titre) });
    case 'event.starting':
      return tr('jr.event_starting', { titre: texte(m.titre) });
    case 'event.reminder_d1':
    case 'event.reminder_h1':
      return tr('jr.event_reminder', { delai: e.action === 'event.reminder_d1' ? 'J-1' : 'H-1', titre: texte(m.titre) });
    default:
      return phraseJournalPlanning(e.action, qui, m, id => nom(noms, id)) ?? phraseJournalReview(e.action, qui, m) ?? phraseJournalStrats(e.action, qui, m) ?? phraseJournalLineups(e.action, qui, m) ?? phraseJournalRessources(e.action, qui, m) ?? phraseJournalCompetition(e.action, qui, m) ?? phraseJournalCm(e.action, qui, m) ?? `${qui} : ${e.action}`;
  }
}

/** Catégories de filtre du journal (préfixe d'action). */
export function filtresJournal(): ReadonlyArray<readonly [string, string]> {
  return [
    ['', tr('jr.filtre_tout')],
    ['member', tr('jr.filtre_membres')],
    ['role', tr('jr.filtre_roles')],
    ['invitation', tr('jr.filtre_invitations')],
    ['modules', tr('jr.filtre_modules')],
    ['team', tr('jr.filtre_team')],
    ['meeting', tr('jr.filtre_resumes')],
    ['task', tr('jr.filtre_taches')],
    ['goal', tr('jr.filtre_objectifs')],
    ['event', tr('jr.filtre_planning')],
    ['attendance', tr('jr.filtre_presence')],
    ['discord', 'Discord'],
    ['review', tr('review.review.review')],
    ['opponent', tr('cat.groupe.scouting')],
    ['strat', tr('cat.groupe.strat_editor')],
    ['playbook', tr('cat.groupe.playbook')],
    ['lineup', tr('cat.groupe.lineups')],
    ['player_note', tr('cat.groupe.player_notes')],
    ['resource', tr('cat.groupe.resources')],
    ['tournoi', tr('cat.groupe.tournois')],
    ['match', tr('cat.groupe.resultats')],
    ['cm', tr('cat.groupe.cm')],
  ];
}

export function phraseNotification(n: Notification, noms: Record<string, string | null>): string {
  const team = n.team?.nom ?? tr('jr.une_team');
  const c = n.charge;
  const str = (v: unknown, secours: string) => (typeof v === 'string' ? v : secours);
  switch (n.type) {
    case 'bienvenue':
      return tr('nt.bienvenue', { team, role: avecRole(c.role) });
    case 'membre-arrive':
      return tr('nt.membre_arrive', { membre: nom(noms, c.membre), team, role: avecRole(c.role) });
    case 'role-change':
      return tr('nt.role_change', { team, role: nomRole(str(c.vers, '?')) });
    case 'retire':
      return tr('nt.retire', { team });
    case 'trombi-modifiee':
      return tr(c.photo ? 'nt.trombi_photo' : 'nt.trombi_modifiee', { membre: nom(noms, c.membre) });
    case 'modules':
      return tr('nt.modules', { team });
    case 'resume-depose':
      return tr('nt.resume_depose', { membre: nom(noms, c.membre), team, titre: typeof c.titre === 'string' ? tr('nt.titre_apres_deux_points', { titre: c.titre }) : '' });
    case 'resume-publie':
      return tr(c.remplacement ? 'nt.resume_mis_a_jour' : 'nt.resume_pret', { titre: str(c.titre, tr('nt.votre_reunion')), team });
    case 'transcription-prete':
      return tr('nt.transcription_prete', { titre: str(c.titre, tr('nt.votre_reunion')), team });
    case 'transcription-echec':
      return tr('nt.transcription_echec', { titre: str(c.titre, tr('nt.votre_reunion')), team });
    case 'tache-assignee':
      return tr('nt.tache_assignee', {
        membre: nom(noms, c.membre),
        titre: str(c.titre, tr('nt.une_tache')),
        echeance: typeof c.echeance === 'string' ? tr('nt.pour_le', { date: dateJour(c.echeance) }) : '',
        team,
      });
    case 'demande-compte':
      return tr('nt.demande_compte', { membre: nom(noms, c.membre), pseudo: str(c.pseudo, tr('nt.un_nouveau_membre')), role: avecRole(c.role), team });
    case 'demande-compte-validee':
      return tr('nt.demande_compte_validee', { pseudo: str(c.pseudo, tr('nt.un_nouveau_membre')), team });
    case 'demande-compte-refusee':
      return tr('nt.demande_compte_refusee', {
        pseudo: str(c.pseudo, tr('nt.un_nouveau_membre')),
        motif: typeof c.motif === 'string' && c.motif ? tr('nt.titre_apres_deux_points', { titre: c.motif }) : '',
        team,
      });
    case 'note-partagee':
      return tr('nt.note_partagee', { team });
    // Profils de jeu (notifications globales, sans team).
    case 'jeu-brouillon-pret':
      return tr('nt.jeu_brouillon_pret', { nom: str(c.nom, '?') });
    case 'jeu-maj-proposee':
      return tr('nt.jeu_maj_proposee', { nom: str(c.nom, '?'), n: typeof c.n === 'number' ? c.n : '?' });
    // Devblog publié automatiquement, brouillon à valider, IA en échec, programmation annulée (sans team).
    case 'devblog-auto':
      return c.etat === 'publie'
        ? trDv('nt_publie', { titre: str(c.titre, 'DEVBLOG') })
        : c.etat === 'brouillon'
          ? trDv('nt_brouillon', { titre: str(c.titre, 'DEVBLOG') })
          : c.etat === 'programme-annule'
            ? trDv('nt_programme_annule', { titre: str(c.titre, 'DEVBLOG') })
            : trDv(c.motif === 'source' ? 'nt_echec_source' : 'nt_echec');
    case 'tache-echeance':
      return tr(c.retard ? 'nt.tache_en_retard' : 'nt.tache_echeance_proche', {
        titre: str(c.titre, tr('nt.une_tache')),
        echeance: typeof c.echeance === 'string' ? ` (${dateJour(c.echeance)})` : '',
      });
    default:
      return phraseNotificationPlanning(n.type, team, c) ?? phraseNotificationReview(n.type, team, c) ?? phraseNotificationStrats(n.type, team, c) ?? phraseNotificationLineups(n.type, team, c, id => nom(noms, id)) ?? phraseNotificationRessources(n.type, team, c) ?? phraseNotificationCompetition(n.type, team, c) ?? phraseNotificationCm(n.type, team, c, id => nom(noms, id)) ?? phraseNotificationSponsors(n.type, c, id => nom(noms, id)) ?? phraseNotificationTickets(n.type, c) ?? phraseAlerte(n.type, c) ?? `${team} : ${n.type}`;
  }
}

/** Date courte (« 20/10 à 14:05 » / « 20/10 at 14:05 »). */
export function dateCourte(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const jour = formaterDate(d, { day: '2-digit', month: '2-digit' });
  const heure = formaterDate(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return tr('fmt.date_heure', { jour, heure });
}

/**
 * Texte d'une alerte du Dashboard. Le serveur envoie un genre et un nombre (et un texte français de
 * secours) : le texte affiché est composé ici, dans la langue courante. Seuils du serveur (tableau.mjs) :
 * présence sur 14 jours, résumé en attente depuis plus de 7 jours.
 */
export function texteAlerte(a: AlerteTableau): string {
  switch (a.genre) {
    case 'presence':
      return tr('dashboard.alerte_presence', { n: a.nombre, jours: 14 });
    case 'resumes':
      return tr('dashboard.alerte_resumes', { jours: 7 });
    case 'taches':
      return trn('dashboard.alerte_taches', a.nombre);
    case 'invites':
      return trn('dashboard.invites_pas_connectes', a.nombre);
    default:
      return a.texte;
  }
}
