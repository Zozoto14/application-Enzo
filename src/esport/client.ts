/**
 * Client de l'API Esport (Worker `applibourse-esport`, voir esport/).
 *
 * Authentification : le jeton du relais déjà gardé par l'app (`relaisActif()` :
 * jeton de profil d'un ami, ou jeton maître du Fondateur) est présenté UNE fois
 * à `POST /session` ; le Worker le fait valider par le relais et rend une
 * session courte (`es1.…`, une heure), seule envoyée ensuite.
 *
 * Adresse du Worker, dans l'ordre :
 *  1. `esport.json` publié avec le site (`{ "esport": "https://…" }`, variable
 *     GitHub ESPORT_URL du workflow du site) ;
 *  2. déduite de l'adresse du relais : `applibourse-relais.<vous>.workers.dev`
 *     → `applibourse-esport.<vous>.workers.dev` (même compte Cloudflare).
 * Sans réponse du Worker : « Esport pas encore activé », rien d'autre ne casse.
 */

import catalogueBrut from '../../esport/noyau/catalogue.json';

// ------------------------------------------------------------------ Types (miroir de l'API)

export interface ModuleCatalogue {
  cle: string;
  nom: string;
  phase: number;
  description: string;
}
export interface PermissionCatalogue {
  cle: string;
  action: 'voir' | 'creer' | 'modifier' | 'supprimer' | 'special';
  libelle: string;
}
export interface GroupeCatalogue {
  cle: string;
  nom: string;
  module: string | null;
  permissions: PermissionCatalogue[];
}
export interface Catalogue {
  version: number;
  modules: ModuleCatalogue[];
  groupes: GroupeCatalogue[];
  rolesSysteme: Array<{ cle: string; nom: string; couleur: string; description: string; permissions: string[] | '*' }>;
  presets: Array<{ cle: string; nom: string; description: string; modules: string[] | null }>;
  jeux: Array<{ cle: string; nom: string; postes: string[] }>;
}

export const CATALOGUE = catalogueBrut as unknown as Catalogue;

export interface ProfilEsport {
  pseudo: string;
  riotId: string | null;
  discord: string | null;
}
export interface Moi {
  compte: string;
  superAdmin: boolean;
  profil: ProfilEsport | null;
  peutCreerTeam: boolean;
}
export interface Team {
  id: string;
  nom: string;
  slug: string;
  jeu: string;
  description: string;
  logoUrl: string | null;
  fuseau: string;
  creeLe: string;
  archivee: boolean;
}
export interface TeamListee extends Team {
  membres: number;
  modules: string[];
  role: { nom: string; couleur: string } | null;
  suspendu: boolean;
}
export interface DetailTeam {
  team: Team;
  modules: Array<{ cle: string; active: boolean }>;
  membres: number;
  moi: {
    membreId: string | null;
    role: { id: string; nom: string; couleur: string; cle: string | null } | null;
    permissions: string[];
    superAdmin: boolean;
  };
}
export interface Role {
  id: string;
  nom: string;
  couleur: string;
  systeme: boolean;
  cle: string | null;
  position: number;
  permissions: string[];
  membres: number;
}
export interface Membre {
  id: string;
  compte: string;
  pseudo: string;
  riotId: string | null;
  discord: string | null;
  posteJeu: string | null;
  statut: 'actif' | 'suspendu';
  rejointLe: string;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  moi: boolean;
}
export interface Invitation {
  id: string;
  libelle: string;
  role: { id: string; nom: string | null };
  expireLe: string;
  utilisationsMax: number;
  utilisations: number;
  creeLe: string;
  etat: 'active' | 'expiree' | 'revoquee' | 'epuisee';
}
export interface EntreeJournal {
  id: string;
  action: string;
  acteur: string | null;
  entiteType: string | null;
  entiteId: string | null;
  meta: Record<string, unknown>;
  date: string;
}
export interface PageJournal {
  entrees: EntreeJournal[];
  noms: Record<string, string | null>;
  suite: string | null;
}
export interface Notification {
  id: string;
  type: string;
  team: { id: string; nom: string | null } | null;
  charge: Record<string, unknown>;
  lue: boolean;
  date: string;
}
export interface Notifications {
  nonLues: number;
  noms: Record<string, string | null>;
  liste: Notification[];
}

// ------------------------------------------------------------------ Erreurs

export class ErreurEsport extends Error {
  constructor(
    message: string,
    readonly statut: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Le Worker ne répond pas (pas déployé, pas encore relié) : l'app affiche « Esport pas encore activé ». */
export const CODES_INACTIF = ['injoignable', 'non-configure', 'relais-ancien', 'relais-absent', 'relais-injoignable'];

export const estInactif = (e: unknown): boolean => e instanceof ErreurEsport && CODES_INACTIF.includes(e.code);

/** Documentation d'activation (pour le Fondateur). */
export const DOC_ACTIVATION = 'https://github.com/Zozoto14/application-Enzo/blob/main/docs/esport/deploiement.md';

/** Mention affichée dans l'app (données en clair côté serveur). */
export const MENTION_DONNEES =
  'Les données Esport (teams, membres, rôles, journal) sont stockées en clair sur le serveur Esport, chiffrées au repos par Cloudflare : elles ne sont pas chiffrées de bout en bout comme le reste de l’app. Seuls un pseudo (obligatoire), un Riot ID et un nom Discord (facultatifs) sont enregistrés, jamais d’adresse e-mail. Vous pouvez exporter ou supprimer vos données Esport dans Paramètres.';

// ------------------------------------------------------------------ Adresse du Worker

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Adresse acceptée : https, ou http sur la machine locale (développement). */
export function adresseValide(adresse: unknown): adresse is string {
  return typeof adresse === 'string' && (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(adresse) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(adresse));
}

/** `https://applibourse-relais.x.workers.dev` → `https://applibourse-esport.x.workers.dev`. */
export function adresseDepuisRelais(relais: string | undefined): string | undefined {
  const trouve = /^https:\/\/applibourse-relais\.([a-z0-9-]+)\.workers\.dev\/?$/i.exec(relais?.trim() ?? '');
  return trouve ? `https://applibourse-esport.${trouve[1].toLowerCase()}.workers.dev` : undefined;
}

/** Adresse publiée avec le site (`esport.json`), si elle existe et est valide. */
export async function adressePubliee(requete: Fetch | undefined): Promise<string | undefined> {
  const est = (globalThis as { location?: { protocol?: string } }).location?.protocol;
  if (!requete || (est !== 'http:' && est !== 'https:')) return undefined;
  try {
    const r = await auPlus(requete('esport.json', { headers: { Accept: 'application/json' } }), 4000);
    if (!r.ok) return undefined;
    const lu = (await r.json()) as { esport?: unknown };
    const adresse = typeof lu?.esport === 'string' ? lu.esport.trim().replace(/\/+$/, '') : undefined;
    return adresseValide(adresse) ? adresse : undefined;
  } catch {
    return undefined;
  }
}

function auPlus<T>(promesse: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, ko) => {
    const minuterie = setTimeout(() => ko(new ErreurEsport('Le serveur Esport ne répond pas.', 0, 'injoignable')), ms);
    promesse.then(
      v => {
        clearTimeout(minuterie);
        ok(v);
      },
      e => {
        clearTimeout(minuterie);
        ko(e);
      },
    );
  });
}

// ------------------------------------------------------------------ Client

export interface ConfigEsport {
  adresse: string;
  /** Jeton du relais (jeton de profil, ou jeton maître du Fondateur). */
  jetonRelais: string;
}

/** Sessions déjà obtenues, par adresse et jeton du relais (rien n'est écrit sur le disque). */
const sessions = new Map<string, { session: string; expire: number }>();

export function oublierSessions(): void {
  sessions.clear();
}

export interface ClientEsport {
  config: ConfigEsport;
  sante(): Promise<{ ok: boolean; version: number }>;
  ouvrir(): Promise<Moi>;
  moi(): Promise<Moi>;
  majProfil(p: { pseudo: string; riotId?: string; discord?: string }): Promise<Moi>;
  exporterMesDonnees(): Promise<unknown>;
  supprimerMesDonnees(): Promise<void>;
  teams(): Promise<TeamListee[]>;
  creerTeam(t: { nom: string; jeu: string; description?: string; preset: string; modules?: string[] }): Promise<DetailTeam>;
  team(id: string): Promise<DetailTeam>;
  modifierTeam(id: string, champs: Partial<{ nom: string; description: string; jeu: string; archivee: boolean }>): Promise<DetailTeam>;
  supprimerTeam(id: string): Promise<void>;
  changerModules(id: string, modules: Record<string, boolean>): Promise<DetailTeam>;
  roles(id: string): Promise<Role[]>;
  creerRole(id: string, r: { nom: string; couleur: string; permissions: string[] }): Promise<Role>;
  modifierRole(id: string, roleId: string, r: Partial<{ nom: string; couleur: string; permissions: string[] }>): Promise<Role>;
  supprimerRole(id: string, roleId: string): Promise<void>;
  membres(id: string): Promise<Membre[]>;
  modifierMembre(id: string, membreId: string, m: Partial<{ roleId: string; posteJeu: string | null; statut: 'actif' | 'suspendu' }>): Promise<Membre>;
  retirerMembre(id: string, membreId: string): Promise<void>;
  invitations(id: string): Promise<Invitation[]>;
  creerInvitation(id: string, i: { roleId: string; joursValidite: number; utilisationsMax: number; libelle?: string }): Promise<{ code: string; invitation: Invitation }>;
  revoquerInvitation(id: string, invitationId: string): Promise<void>;
  accepterInvitation(code: string): Promise<{ team: Team; role: { id: string; nom: string; couleur: string } | null }>;
  journal(id: string, filtres?: { avant?: string; action?: string; limite?: number }): Promise<PageJournal>;
  notifications(): Promise<Notifications>;
  marquerLues(tout: boolean, ids?: string[]): Promise<Notifications>;
  /** Appel générique avec la session (modules : planning, etc. ; voir src/esport/planning/api.ts). */
  requete<T>(chemin: string, methode?: string, corps?: unknown): Promise<T>;
}

export function clientEsport(config: ConfigEsport, requete: Fetch = globalThis.fetch as unknown as Fetch, maintenant: () => number = Date.now): ClientEsport {
  const cle = `${config.adresse}|${config.jetonRelais}`;

  async function brut<T>(chemin: string, methode = 'GET', corps?: unknown, jeton?: string): Promise<T> {
    let r: Awaited<ReturnType<Fetch>>;
    try {
      r = await auPlus(
        requete(`${config.adresse}${chemin}`, {
          method: methode,
          headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
          body: corps === undefined ? undefined : JSON.stringify(corps),
        }),
        15_000,
      );
    } catch (e) {
      if (e instanceof ErreurEsport) throw e;
      throw new ErreurEsport('Le serveur Esport est injoignable.', 0, 'injoignable');
    }
    let lu: unknown;
    try {
      lu = await r.json();
    } catch {
      lu = undefined;
    }
    if (!r.ok) {
      const o = (lu ?? {}) as { erreur?: string; code?: string; details?: Record<string, unknown> };
      // Pas de JSON de l'API (page d'erreur Cloudflare d'un Worker absent) : pas encore activé.
      if (!o.code) throw new ErreurEsport('Le serveur Esport ne répond pas comme prévu.', r.status, 'injoignable');
      throw new ErreurEsport(o.erreur ?? `Erreur ${r.status}`, r.status, o.code, o.details);
    }
    return lu as T;
  }

  async function session(forcer = false): Promise<string> {
    const connue = sessions.get(cle);
    if (!forcer && connue && connue.expire - 60_000 > maintenant()) return connue.session;
    const r = await brut<Moi & { session: string; expire: string }>('/session', 'POST', {}, config.jetonRelais);
    sessions.set(cle, { session: r.session, expire: Date.parse(r.expire) });
    return r.session;
  }

  async function appel<T>(chemin: string, methode = 'GET', corps?: unknown): Promise<T> {
    try {
      return await brut<T>(chemin, methode, corps, await session());
    } catch (e) {
      // Session expirée (ou Worker redéployé avec une nouvelle clé) : une nouvelle, une fois.
      if (e instanceof ErreurEsport && e.code === 'session') return brut<T>(chemin, methode, corps, await session(true));
      throw e;
    }
  }

  const t = (id: string) => `/teams/${encodeURIComponent(id)}`;
  return {
    config,
    sante: () => brut('/sante'),
    ouvrir: async () => {
      await session();
      return appel<Moi>('/moi');
    },
    moi: () => appel('/moi'),
    majProfil: p => appel('/moi', 'PUT', p),
    exporterMesDonnees: () => appel('/moi/export'),
    supprimerMesDonnees: async () => {
      await appel('/moi', 'DELETE');
    },
    teams: async () => (await appel<{ teams: TeamListee[] }>('/teams')).teams,
    creerTeam: corps => appel('/teams', 'POST', corps),
    team: id => appel(t(id)),
    modifierTeam: (id, champs) => appel(t(id), 'PATCH', champs),
    supprimerTeam: async id => {
      await appel(t(id), 'DELETE');
    },
    changerModules: (id, modules) => appel(`${t(id)}/modules`, 'PUT', { modules }),
    roles: async id => (await appel<{ roles: Role[] }>(`${t(id)}/roles`)).roles,
    creerRole: (id, r) => appel(`${t(id)}/roles`, 'POST', r),
    modifierRole: (id, roleId, r) => appel(`${t(id)}/roles/${encodeURIComponent(roleId)}`, 'PATCH', r),
    supprimerRole: async (id, roleId) => {
      await appel(`${t(id)}/roles/${encodeURIComponent(roleId)}`, 'DELETE');
    },
    membres: async id => (await appel<{ membres: Membre[] }>(`${t(id)}/membres`)).membres,
    modifierMembre: (id, membreId, m) => appel(`${t(id)}/membres/${encodeURIComponent(membreId)}`, 'PATCH', m),
    retirerMembre: async (id, membreId) => {
      await appel(`${t(id)}/membres/${encodeURIComponent(membreId)}`, 'DELETE');
    },
    invitations: async id => (await appel<{ invitations: Invitation[] }>(`${t(id)}/invitations`)).invitations,
    creerInvitation: (id, i) => appel(`${t(id)}/invitations`, 'POST', i),
    revoquerInvitation: async (id, invitationId) => {
      await appel(`${t(id)}/invitations/${encodeURIComponent(invitationId)}`, 'DELETE');
    },
    accepterInvitation: code => appel('/invitations/accepter', 'POST', { code: code.trim() }),
    journal: (id, f = {}) => {
      const p = [f.avant ? `avant=${encodeURIComponent(f.avant)}` : '', f.action ? `action=${encodeURIComponent(f.action)}` : '', f.limite ? `limite=${f.limite}` : ''].filter(Boolean).join('&');
      return appel(`${t(id)}/journal${p ? `?${p}` : ''}`);
    },
    notifications: () => appel('/notifications'),
    marquerLues: (tout, ids) => appel('/notifications/lues', 'POST', tout ? { tout: true } : { ids: ids ?? [] }),
    requete: (chemin, methode, corps) => appel(chemin, methode, corps),
  };
}

/**
 * Configuration de l'Esport sur cet appareil : relais relié (jeton) et
 * adresse du Worker. `undefined` + raison si l'Esport ne peut pas s'ouvrir.
 */
export async function trouverConfig(
  relais: { relais: string; jeton: string } | undefined,
  requete: Fetch | undefined = globalThis.fetch as unknown as Fetch,
): Promise<{ config?: ConfigEsport; raison?: 'sans-relais' | 'sans-adresse' }> {
  if (!relais?.jeton) return { raison: 'sans-relais' };
  const adresse = (await adressePubliee(requete)) ?? adresseDepuisRelais(relais.relais);
  if (!adresse) return { raison: 'sans-adresse' };
  return { config: { adresse, jetonRelais: relais.jeton } };
}

// ------------------------------------------------------------------ Aides pures

const ACTIONS_COLONNES: ReadonlyArray<PermissionCatalogue['action']> = ['voir', 'creer', 'modifier', 'supprimer', 'special'];
export const LIBELLES_COLONNES: Record<PermissionCatalogue['action'], string> = { voir: 'Voir', creer: 'Créer', modifier: 'Modifier', supprimer: 'Supprimer', special: 'Spécial' };

/** Lignes de la matrice des permissions (seulement les groupes du cœur et des modules activés). */
export function lignesMatrice(modulesActifs: readonly string[]): Array<GroupeCatalogue & { colonnes: Record<PermissionCatalogue['action'], PermissionCatalogue[]> }> {
  return CATALOGUE.groupes
    .filter(g => g.module === null || modulesActifs.includes(g.module))
    .map(g => ({
      ...g,
      colonnes: Object.fromEntries(ACTIONS_COLONNES.map(a => [a, g.permissions.filter(p => p.action === a)])) as Record<PermissionCatalogue['action'], PermissionCatalogue[]>,
    }));
}

export const nomModule = (cle: string): string => CATALOGUE.modules.find(m => m.cle === cle)?.nom ?? cle;
