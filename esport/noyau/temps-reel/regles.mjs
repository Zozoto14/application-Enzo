/**
 * Temps réel : quelles écritures diffuser, sous quel « sujet », et comment contrôler l'accès
 * (docs/esport/temps-reel.md).
 *
 * Le canal ne transporte AUCUNE donnée métier : seulement « dans le sujet S, l'objet K (version V) a changé,
 * par X ». L'app relit ensuite la donnée par les routes habituelles, qui appliquent tous les contrôles. Deux
 * niveaux d'accès, vérifiés pour CHAQUE destinataire et CHAQUE message :
 *
 *  - le SUJET (`team:<id>:<module>`, `team:<id>`, `cm`, `cm:drive`, `cm:reseaux`, `sponsors`, `trombi`,
 *    `club`, `compte:<id>`) : le destinataire doit pouvoir lire ce module ou cette rubrique (mêmes règles
 *    que les routes : appartenance, module activé, permission de lecture ; voir `controleSujet`) ;
 *  - l'OBJET : la clé, la version, l'auteur et son pseudo ne partent que si le destinataire peut lire CET
 *    objet : la route GET de l'objet (`sonde`) est rejouée en son nom (mêmes contrôles, jamais de copie des
 *    règles). Sans cela, il ne reçoit que « quelque chose a changé dans ce sujet » (il relit sa liste, que le
 *    serveur filtre). `objetPublic` : la lecture du sujet suffit (objectifs et tâches : même permission).
 *
 * Écritures diffusées : toute requête PATCH, PUT, DELETE ou POST réussie (2xx) sur une route décrite ici,
 * sauf les envois de fichiers par morceaux, les liens signés, les aperçus et les exports (aucun changement).
 * Les écritures faites hors HTTP (bot Discord, cron) passent par le bus d'événements (bus.mjs).
 */

/** Modules d'une team → permission de lecture (catalogue.json : première permission « voir » du groupe). */
export const LECTURE_MODULE = Object.freeze({
  planning: 'planning.view',
  availability: 'availability.view_all',
  attendance: 'attendance.view_all',
  meeting_summaries: 'meeting_summaries.view_all',
  goals_tasks: 'goals_tasks.view',
  video_review: 'video_review.view',
  scouting: 'scouting.view',
  strat_editor: 'strats.view',
  playbook: 'playbook.view',
  player_notes: 'player_notes.view',
  resources: 'resources.view',
  tournois: 'tournois.voir',
  resultats: 'resultats.voir',
  activity_log: 'activity_log.view',
});

/**
 * Lecture « pour soi » : un joueur sans la permission de tout voir voit quand même sa propre présence, ses
 * disponibilités et ses réunions déposées. Le sujet lui est ouvert (il ne reçoit que « ça a changé », sans
 * objet, et relit SES données) : mêmes pages que les routes « moi ».
 */
export const LECTURE_PERSONNELLE = Object.freeze({
  availability: ['availability.edit_own'],
  attendance: ['attendance.rsvp_own', 'attendance.mark'],
  meeting_summaries: ['meeting_summaries.submit', 'meeting_summaries.view_summary', 'meeting_summaries.write_summary'],
});

/** Contrôle d'accès d'un sujet du club : route GET rejouée au nom du destinataire (`ok` : lecture du résultat). */
export const SONDES_SUJETS = Object.freeze({
  'cm:drive': { chemin: '/cm/drive/portees' },
  'cm:reseaux': { chemin: '/cm/reseaux' },
  // Réunions de l'équipe CM : équipe CM (voir) ou invité à une réunion à venir.
  'cm:reunions': { chemin: '/cm/reunions/moi', ok: r => r?.droits?.voir === true || r?.invite === true },
  sponsors: { chemin: '/sponsors/moi', ok: r => r?.voir === true },
  trombi: { chemin: '/trombi' },
});

/** Sujets connus de l'app (forme), pour refuser tout le reste. */
export const MOTIF_SUJET = /^(?:team:[0-9a-f-]{36}(?::[a-z_]{2,30})?|cm|cm:drive|cm:reseaux|cm:reunions|sponsors|trombi|club|compte:[A-Za-z0-9_-]{1,64})$/;

const ID = '([^/]+)';
const dec = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};
const enc = s => encodeURIComponent(s);
/** Identifiant d'objet acceptable dans une clé (uuid, compte) : rien d'autre ne part. */
const idValide = s => /^[A-Za-z0-9_-]{1,64}$/.test(s);

/** Chemins jamais diffusés (aucun changement visible par d'autres, ou trop fréquents). */
const IGNORES = [
  /\/envois(?:\/[^/]+(?:\/morceaux\/[^/]+)?)?$/, // envoi par morceaux (seule la fin, « …/fin », crée quelque chose)
  /\/lien$/,
  /\/apercu$/,
  /\/export(?:\.[a-z]+)?$/,
  /\/test$/,
  /^\/(?:session|sante|usage|catalogue|statistiques(?:\/.*)?|discord\/interactions|admin\/(?:export|import|fichier|secrets))$/,
  /^\/moi(?:\/.*)?$/,
  /^\/temps-reel(?:\/.*)?$/,
  /^\/sponsors\/(?:import\/apercu|rgpd\/export)$/,
  /^\/cm\/import\/trello\/apercu$/,
  /^\/cm\/reseaux\/import\/apercu$/,
];

/** Sous-chemins d'une collection qui ne sont pas des objets (`/teams/:t/planning/reglages`…). */
const RESERVES = new Set(['accueil', 'reglages', 'export.ics', 'export.csv', 'ical', 'types', 'miens', 'envois', 'vu', 'apercu', 'categories', 'corbeille', 'supprimer', 'formulaire', 'adversaires', 'matchs', 'moi', 'boite', 'reglages-transcription', 'ordre', 'images', 'donnees', 'fichiers', 'import', 'etat', 'a-valider', 'calendrier', 'recherche', 'stats', 'historique', 'a-marquer', 'joueurs', 'carte', 'multi', 'teams', 'creneaux', 'equipe', 'comptes', 'statut', 'dispos', 'rdv', 'export.ics', 'taches']);

/**
 * Objet d'une route de team : `[module, prefixe de clé, sous-chemin de l'objet]` (objet = premier segment
 * après la collection ; `sonde` = GET de l'objet).
 */
const COLLECTIONS_TEAM = {
  planning: { module: 'planning', cle: 'planning', sonde: true },
  dispos: { module: 'availability' },
  presence: { module: 'attendance' },
  objectifs: { module: 'goals_tasks', cle: 'objectif', objetPublic: true },
  taches: { module: 'goals_tasks', cle: 'tache', objetPublic: true },
  resumes: { module: 'meeting_summaries', cle: 'resume', sonde: true },
  strats: { module: 'strat_editor', cle: 'strat', sonde: true },
  playbook: { module: 'playbook', cle: 'playbook' },
  review: { module: 'video_review', cle: 'review', sonde: true },
  scouting: { module: 'scouting', cle: 'adversaire', sonde: true, sous: 'adversaires' },
  suivi: { module: 'player_notes', cle: 'suivi', sonde: true },
  ressources: { module: 'resources', cle: 'ressource', sonde: true },
  tournois: { module: 'tournois', cle: 'tournoi', sonde: true },
  resultats: { module: 'resultats', cle: 'resultat', sonde: true },
  journal: { module: 'activity_log' },
};
/** Sections de team qui touchent aux droits : les autorisations en cache sont oubliées partout. */
const SECTIONS_DROITS = new Set(['modules', 'roles', 'membres', 'invitations']);

/** Objets de la section CM et des rubriques du club : `[motif, sujet, prefixe de clé, sonde ?]`. */
const OBJETS_CLUB = [
  [/^\/cm\/reunions\/([^/]+)/, 'cm:reunions', 'cm-reunion', true],
  [/^\/cm\/cartes\/([^/]+)/, 'cm', 'cm-carte', true],
  [/^\/cm\/tableaux\/([^/]+)/, 'cm', 'cm-tableau', false],
  [/^\/cm\/listes\/([^/]+)/, 'cm', 'cm-liste', false],
  [/^\/cm\/modeles\/([^/]+)/, 'cm', 'cm-modele', true],
  [/^\/cm\/visuels\/([^/]+)/, 'cm', 'cm-visuel', true],
  [/^\/cm\/clips\/([^/]+)/, 'cm', 'cm-clip', false],
  [/^\/sponsors\/prospects\/([^/]+)/, 'sponsors', 'sp-prospect', true],
  [/^\/sponsors\/partenaires\/([^/]+)/, 'sponsors', 'sp-partenaire', true],
  [/^\/trombi\/fiches\/([^/]+)/, 'trombi', 'trombi-fiche', true],
];

/** Sujet d'une route du club (sans objet). */
function sujetClub(chemin) {
  if (chemin.startsWith('/cm/drive')) return { sujet: 'cm:drive' };
  if (chemin.startsWith('/cm/reseaux')) return { sujet: 'cm:reseaux' };
  if (chemin.startsWith('/cm/reunions')) return { sujet: 'cm:reunions' };
  if (/^\/cm\/(?:roles|affectations|reglages)(?:\/|$)/.test(chemin)) return { sujet: 'cm', invalider: true };
  if (chemin === '/cm' || chemin.startsWith('/cm/')) return { sujet: 'cm' };
  if (chemin.startsWith('/sponsors/')) return { sujet: 'sponsors' };
  if (chemin === '/trombi' || chemin.startsWith('/trombi/')) return { sujet: 'trombi' };
  if (/^\/(?:roles|comptes|admin\/comptes)(?:\/|$)/.test(chemin)) return { sujet: 'club', invalider: true };
  return null;
}

/**
 * Objet désigné par une route (pour le verrou optimiste, la présence et la diffusion) :
 * `{ sujet, cle, sonde?, objetPublic?, exact }` ou null. `exact` : la route EST l'objet (pas une sous-ressource).
 */
export function objetDe(chemin) {
  const t = /^\/teams\/([^/]+)\/([a-z]+)\/([^/]+)(?:\/([^/]+))?(\/.*)?$/.exec(chemin);
  if (t) {
    const [, teamId, section, a, b, reste] = t;
    const c = COLLECTIONS_TEAM[section];
    if (!c?.cle) return null;
    const team = dec(teamId);
    let id;
    let exact;
    if (c.sous) {
      if (a !== c.sous || !b) return null;
      id = dec(b);
      exact = !reste;
    } else {
      if (RESERVES.has(a)) return null;
      id = dec(a);
      exact = b === undefined;
    }
    if (!idValide(id) || !idValide(team)) return null;
    const base = `/teams/${enc(team)}/${section}${c.sous ? `/${c.sous}` : ''}/${enc(id)}`;
    return { sujet: `team:${team}:${c.module}`, cle: `${c.cle}:${id}`, sonde: c.sonde ? base : undefined, objetPublic: Boolean(c.objetPublic), exact };
  }
  for (const [motif, sujet, prefixe, sonde] of OBJETS_CLUB) {
    const m = motif.exec(chemin);
    if (!m) continue;
    const id = dec(m[1]);
    if (!idValide(id) || RESERVES.has(id)) return null;
    const base = m[0].replace(/[^/]+$/, enc(id));
    return { sujet, cle: `${prefixe}:${id}`, sonde: sonde ? base : undefined, objetPublic: false, exact: chemin === m[0] };
  }
  return null;
}

/**
 * Publications d'une écriture réussie : `[{ sujet, cle?, sonde?, objetPublic?, invalider?, bump }]`.
 * `bump` : la version de l'objet augmente (PATCH, PUT ou DELETE de l'objet lui-même).
 */
export function publicationsDe(methode, chemin, acteur) {
  if (methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS') return [];
  if (IGNORES.some(m => m.test(chemin)) && !/\/envois\/[^/]+\/fin$/.test(chemin)) return [];
  // Notifications lues, préférences du centre : les autres appareils du compte suivent.
  if (chemin === '/notifications' || chemin.startsWith('/notifications/')) return acteur?.compte ? [{ sujet: `compte:${acteur.compte}` }] : [];
  const objet = objetDe(chemin);
  const bump = Boolean(objet?.exact && ['PATCH', 'PUT', 'DELETE'].includes(methode));
  const action = methode === 'DELETE' && objet?.exact ? 'supprime' : methode === 'POST' && !objet ? 'cree' : 'modifie';
  const t = /^\/teams\/([^/]+)(?:\/([a-z]+))?(\/.*)?$/.exec(chemin);
  if (t) {
    const team = dec(t[1]);
    if (!/^[0-9a-f-]{36}$/.test(team)) return [];
    const section = t[2];
    if (!section || SECTIONS_DROITS.has(section)) return [{ sujet: `team:${team}`, invalider: true, action }];
    const c = COLLECTIONS_TEAM[section];
    if (section === 'competition') return [{ sujet: `team:${team}:tournois`, action }, { sujet: `team:${team}:resultats`, action }];
    if (!c) return [{ sujet: `team:${team}`, action }];
    const sortie = [objet ? { ...objet, action, bump } : { sujet: `team:${team}:${c.module}`, action }];
    // Réponse à une convocation ou présence marquée : visible aussi dans le module Présence.
    if (section === 'planning' && /\/(?:rsvp|presence)$/.test(chemin)) sortie.push({ sujet: `team:${team}:attendance`, action });
    return sortie;
  }
  const club = sujetClub(chemin);
  if (!club) return [];
  if (objet) return [{ ...objet, action, bump }];
  return [{ ...club, action }];
}

/** Modules d'une team touchés par un type d'événement du bus (écritures hors HTTP : bot Discord, cron). */
const MODULES_EVENEMENTS = [
  [/^(?:event|ical)\./, ['planning']],
  [/^attendance\./, ['attendance', 'planning']],
  [/^availability\./, ['availability']],
  [/^(?:goal|task)\./, ['goals_tasks']],
  [/^(?:meeting|meeting_type|media)\./, ['meeting_summaries']],
  [/^review\./, ['video_review']],
  [/^opponent\./, ['scouting']],
  [/^strat\./, ['strat_editor']],
  [/^playbook\./, ['playbook']],
  [/^player_note\./, ['player_notes']],
  [/^(?:resource|resource_category|resources)\./, ['resources']],
  [/^tournoi\./, ['tournois']],
  [/^match\./, ['resultats', 'tournois']],
];

/** Sujets d'un événement du bus (sans objet : le bus ne dit pas quelle route relire). */
export function sujetsEvenement(ev) {
  const type = String(ev?.type ?? '');
  const droits = /^(?:team|modules|role|member|roles)\./.test(type) || /^cm\.(?:role_|affectation_)/.test(type);
  if (ev?.team_id) {
    if (/^(?:team|modules|role|member|invitation)\./.test(type)) return [{ sujet: `team:${ev.team_id}`, invalider: droits }];
    for (const [motif, modules] of MODULES_EVENEMENTS) if (motif.test(type)) return modules.map(m => ({ sujet: `team:${ev.team_id}:${m}`, invalider: false }));
    if (type.startsWith('cm.')) return [{ sujet: 'cm', invalider: droits }];
    return [];
  }
  if (type.startsWith('cm.drive_')) return [{ sujet: 'cm:drive' }];
  if (type.startsWith('cm.reseau')) return [{ sujet: 'cm:reseaux' }];
  if (type.startsWith('cm.reunion')) return [{ sujet: 'cm:reunions' }];
  if (type.startsWith('cm.')) return [{ sujet: 'cm', invalider: droits }];
  if (type.startsWith('sponsors.')) return [{ sujet: 'sponsors' }];
  if (type.startsWith('trombi.')) return [{ sujet: 'trombi' }];
  if (droits) return [{ sujet: 'club', invalider: true }];
  return [];
}
