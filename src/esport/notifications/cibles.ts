/**
 * Liens directs des notifications (docs/esport/notifications.md « Liens directs ») : la cible d'une notification
 * (format stable et versionné du serveur, esport/noyau/notifications/cibles.mjs : `{ v: 1, g: <genre>, ...ids }`)
 * traduite en écran de l'app (team, sous-onglet, élément à ouvrir, élément à mettre en avant), et les adresses
 * partageables de l'app Esport (`#/app/esport/c/<genre>?…` pour un élément, `#/app/esport/v/…` pour un écran) : un
 * rechargement de la page garde l'endroit. Logique pure, testée sans écran.
 */

export const VERSION_CIBLE = 1;

/** Genres de cibles (version 1) : la même liste que le serveur (vérifié par esport/test/notifications-cibles.test.mjs). */
export const GENRES_CIBLES = ['ticket', 'carte_cm', 'clip_cm', 'lien_cm', 'drive', 'reunion_cm', 'evenement', 'tache', 'objectif', 'reunion', 'strat', 'playbook', 'review', 'ressource', 'adversaire', 'tournoi', 'resultat', 'membre', 'demande_compte', 'sponsor', 'jeu', 'devblog', 'avis_ticket', 'salon_match', 'alerte_discord'] as const;
export type GenreCible = (typeof GENRES_CIBLES)[number];

/** Identifiants permis par genre (mêmes listes que le serveur). */
export const CHAMPS_CIBLES: Record<GenreCible, readonly string[]> = {
  ticket: ['ticket', 'message'],
  carte_cm: ['carte', 'commentaire', 'tableau'],
  clip_cm: ['clip'],
  lien_cm: ['lien'],
  drive: ['fichier', 'dossier', 'portee'],
  reunion_cm: ['reunion', 'debut'],
  evenement: ['evenement', 'occurrence', 'team'],
  tache: ['tache', 'team'],
  objectif: ['objectif', 'team'],
  reunion: ['reunion', 'team'],
  strat: ['strat', 'team'],
  playbook: ['entree', 'team'],
  review: ['review', 'repere', 'team'],
  ressource: ['ressource', 'team'],
  adversaire: ['adversaire', 'team'],
  tournoi: ['tournoi', 'team'],
  resultat: ['resultat', 'team'],
  membre: ['compte', 'team'],
  demande_compte: ['demande'],
  sponsor: ['prospect', 'partenaire'],
  jeu: ['jeu'],
  devblog: ['entree', 'brouillon'],
  avis_ticket: ['ticket'],
  salon_match: ['evenement', 'match'],
  alerte_discord: ['zone', 'evenement', 'team'],
};

/** Cible d'une notification : genre et identifiants (chaînes). */
export interface CibleNotification {
  v: 1;
  g: GenreCible;
  [champ: string]: string | number | undefined;
}

const MOTIF_ID = /^[A-Za-z0-9:._@-]{1,200}$/;

/** Cible propre (genre connu, identifiants lisibles), sinon `null`. */
export function normaliserCible(brute: unknown): CibleNotification | null {
  if (!brute || typeof brute !== 'object' || Array.isArray(brute)) return null;
  const c = brute as Record<string, unknown>;
  if (Number(c.v) !== VERSION_CIBLE || !GENRES_CIBLES.includes(c.g as GenreCible)) return null;
  const g = c.g as GenreCible;
  const sortie: CibleNotification = { v: 1, g };
  for (const k of CHAMPS_CIBLES[g]) {
    const v = c[k];
    if (typeof v === 'string' && MOTIF_ID.test(v)) sortie[k] = v;
  }
  return Object.keys(sortie).length > 2 ? sortie : null;
}

/**
 * Écran d'arrivée d'une cible. `vue` : l'écran (mêmes formes que la navigation de RacineEsport) ; `surligne` : clé de
 * l'élément à mettre en avant (défilé jusqu'à lui, cadre accentué quelques secondes).
 */
export type EcranCible =
  | { v: 'team'; id: string; section: string }
  | { v: 'cm'; onglet: string }
  | { v: 'tickets' }
  | { v: 'membres'; sous: 'trombi' | 'tous' }
  | { v: 'administration'; sous: 'jeux' | 'devblog' | 'bot' | 'evenements' }
  | { v: 'devblog' };

export interface DestinationCible {
  vue: EcranCible;
  surligne?: string;
}

/** Section d'une team, par genre d'élément de team. */
const SECTIONS_TEAM: Partial<Record<GenreCible, string>> = {
  evenement: 'module:planning',
  tache: 'module:goals_tasks',
  objectif: 'module:goals_tasks',
  reunion: 'module:meeting_summaries',
  strat: 'module:strat_editor',
  playbook: 'module:playbook',
  review: 'module:video_review',
  ressource: 'module:resources',
  adversaire: 'module:scouting',
  tournoi: 'module:tournois',
  resultat: 'module:resultats',
};

/** Clé de l'élément principal d'une cible (`<genre>:<id>`), pour la mise en avant. */
export function cleElement(c: CibleNotification): string | undefined {
  const champ = CHAMPS_CIBLES[c.g][0];
  return typeof c[champ] === 'string' ? `${c.g}:${c[champ]}` : undefined;
}

/**
 * Écran d'une cible (déjà vérifiée et complétée par le serveur : team, tableau, dossier…). `espaceCm` : le compte a
 * l'espace CM du club (une carte ou un fichier d'une team s'ouvre là ; sinon dans l'onglet CM de la team).
 * `null` : rien à ouvrir (cible incomplète).
 */
export function destinationCible(c: CibleNotification, { espaceCm = true }: { espaceCm?: boolean } = {}): DestinationCible | null {
  const s = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  const section = SECTIONS_TEAM[c.g];
  if (section) {
    const team = s('team');
    return team ? { vue: { v: 'team', id: team, section }, surligne: cleElement(c) } : null;
  }
  switch (c.g) {
    case 'ticket':
      return { vue: { v: 'tickets' }, surligne: s('message') ? `tk-msg:${s('message')}` : undefined };
    case 'carte_cm':
      if (!espaceCm && s('team')) return { vue: { v: 'team', id: s('team')!, section: 'module:cm' }, surligne: s('commentaire') ? `cm-commentaire:${s('commentaire')}` : undefined };
      return { vue: { v: 'cm', onglet: 'tableaux' }, surligne: s('commentaire') ? `cm-commentaire:${s('commentaire')}` : undefined };
    case 'clip_cm':
      return { vue: { v: 'cm', onglet: 'clips' }, surligne: cleElement(c) };
    case 'lien_cm':
      return { vue: { v: 'cm', onglet: 'ressources' }, surligne: cleElement(c) };
    case 'drive': {
      const portee = s('portee');
      if (!espaceCm && portee && portee !== 'club') return { vue: { v: 'team', id: portee, section: 'module:cm' }, surligne: s('fichier') ? `drive:${s('fichier')}` : undefined };
      return { vue: { v: 'cm', onglet: 'drive' }, surligne: s('fichier') ? `drive:${s('fichier')}` : undefined };
    }
    case 'reunion_cm':
      return { vue: { v: 'cm', onglet: 'reunions' } };
    case 'membre':
      return { vue: { v: 'membres', sous: 'trombi' }, surligne: cleElement(c) };
    case 'demande_compte':
      return { vue: { v: 'membres', sous: 'tous' }, surligne: cleElement(c) };
    case 'sponsor':
      return { vue: { v: 'cm', onglet: 'sponsors' } };
    case 'jeu':
      return { vue: { v: 'administration', sous: 'jeux' }, surligne: cleElement(c) };
    // Avis et alertes (migration 0077) : Tickets › Avis ; Administration › Événements › fiche (Salons de match, rôles) ;
    // Administration › Bot Esport HQ › Salons vocaux ; page Discord de la team › Rôles temporaires.
    case 'avis_ticket':
      return { vue: { v: 'tickets' }, surligne: s('ticket') ? `tk-avis:${s('ticket')}` : undefined };
    case 'salon_match':
      return { vue: { v: 'administration', sous: 'evenements' }, surligne: s('match') ? `salon-match:${s('match')}` : s('evenement') ? `salons-match:${s('evenement')}` : undefined };
    case 'alerte_discord':
      if (s('zone') === 'vocaux') return { vue: { v: 'administration', sous: 'bot' }, surligne: 'bot-fn:vocaux' };
      if (s('zone') === 'evenement') return { vue: { v: 'administration', sous: 'evenements' }, surligne: s('evenement') ? `evenement-discord:${s('evenement')}` : undefined };
      return s('team') ? { vue: { v: 'team', id: s('team')!, section: 'module:discord' }, surligne: `roles-temp:${s('team')}` } : null;
    case 'devblog':
      return s('brouillon') ? { vue: { v: 'administration', sous: 'devblog' } } : { vue: { v: 'devblog' }, surligne: s('entree') ? `devblog:${s('entree')}` : undefined };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Adresses partageables

const PREFIXE = '#/app/esport';

/** Fragment d'une cible : `#/app/esport/c/<genre>?<champ>=<valeur>&…` (même format que le serveur). */
export function fragmentCible(c: CibleNotification): string {
  const params = CHAMPS_CIBLES[c.g].filter(k => typeof c[k] === 'string' && c[k]).map(k => `${k}=${encodeURIComponent(String(c[k]))}`);
  return `${PREFIXE}/c/${c.g}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Écran simple de l'app (sans élément) : `v` et ses précisions. */
export interface EcranRoute {
  v: string;
  /** Team (écran `team`). */
  id?: string;
  /** Section de team, onglet CM, sous-onglet (Membres, Administration), section de configuration des tickets. */
  sous?: string;
}

/** Fragment d'un écran : `#/app/esport/v/<v>[/<id>][/<sous>]`. */
export function fragmentEcran(e: EcranRoute): string {
  const morceaux = [e.v, ...(e.v === 'team' ? [e.id ?? ''] : []), ...(e.sous ? [e.sous] : [])].map(encodeURIComponent);
  return `${PREFIXE}/v/${morceaux.join('/')}`;
}

/** Lit un fragment de l'app Esport : un élément (`cible`), un écran (`ecran`), ou rien. */
export function lireFragment(fragment: string | undefined | null): { cible: CibleNotification } | { ecran: EcranRoute } | null {
  if (!fragment || !fragment.startsWith(`${PREFIXE}/`)) return null;
  const reste = fragment.slice(PREFIXE.length + 1);
  const decoder = (x: string) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return '';
    }
  };
  if (reste.startsWith('c/')) {
    const [genre, requete = ''] = reste.slice(2).split('?');
    const brute: Record<string, unknown> = { v: VERSION_CIBLE, g: genre };
    for (const paire of requete.split('&')) {
      const [k, v = ''] = paire.split('=');
      if (k) brute[decoder(k)] = decoder(v);
    }
    const cible = normaliserCible(brute);
    return cible ? { cible } : null;
  }
  if (reste.startsWith('v/')) {
    const morceaux = reste.slice(2).split('/').map(decoder);
    const v = morceaux[0];
    if (!v || !/^[a-z]{2,20}$/.test(v)) return null;
    if (v === 'team') return morceaux[1] && MOTIF_ID.test(morceaux[1]) ? { ecran: { v, id: morceaux[1], sous: morceaux[2] || undefined } } : null;
    const sous = morceaux[1];
    return { ecran: { v, sous: sous && /^[A-Za-z0-9:_-]{1,60}$/.test(sous) ? sous : undefined } };
  }
  return null;
}

/** Fragment courant de la page (web), sinon `undefined`. */
export function fragmentPage(): string | undefined {
  return (globalThis as { location?: { hash?: string } }).location?.hash;
}

/** Remplace le fragment de l'adresse (web) sans recharger ni ajouter d'entrée d'historique. */
export function remplacerFragment(fragment: string | null): void {
  const g = globalThis as { location?: { hash?: string; href?: string }; history?: { replaceState?(etat: unknown, titre: string, url: string): void } };
  if (!g.location?.href || !g.history?.replaceState) return;
  const actuel = g.location.hash ?? '';
  if ((fragment ?? '') === actuel) return;
  // Seulement les adresses de l'app Esport (jamais celles du hub ou du code de liaison).
  if (actuel && !actuel.startsWith(PREFIXE)) return;
  try {
    g.history.replaceState(null, '', `${g.location.href.split('#')[0]}${fragment ?? ''}`);
  } catch {
    // Adresse non modifiable (fichier local, bac à sable) : sans conséquence.
  }
}
