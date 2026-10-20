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
  /** Compte créé depuis l'Esport, pas encore connecté. */
  invite?: boolean;
  rejointLe: string;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  moi: boolean;
}

// ------------------------------------------------------------------ Premier niveau : Membres et Dashboard

export interface AppartenanceCompte {
  teamId: string;
  membreId: string;
  role: { id: string; nom: string; couleur: string; cle: string | null };
  posteJeu: string | null;
  statut: 'actif' | 'suspendu';
  rejointLe: string;
  /** Rôle sous celui de l'acteur (anti-escalade) : il peut agir sur ce membre. */
  gerable: boolean;
}
export interface CompteEsport {
  compte: string;
  pseudo: string;
  riotId: string | null;
  discord: string | null;
  /** « invite » : créé depuis l'Esport, jamais connecté. */
  statut: 'invite' | 'actif';
  inviteLe: string | null;
  activeLe: string | null;
  moi: boolean;
  appartenances: AppartenanceCompte[];
}
export interface RoleAnnuaire {
  id: string;
  nom: string;
  couleur: string;
  cle: string | null;
  position: number;
  systeme: boolean;
  /** L'acteur peut attribuer ce rôle (anti-escalade). */
  attribuable: boolean;
}
export interface TeamAnnuaire {
  id: string;
  nom: string;
  slug: string;
  jeu: string;
  archivee: boolean;
  droits: { ajouter: boolean; roles: boolean; retirer: boolean };
  roles: RoleAnnuaire[];
}
export interface Annuaire {
  superAdmin: boolean;
  peutCreerCompte: boolean;
  teams: TeamAnnuaire[];
  comptes: CompteEsport[];
}
export interface Affectation {
  teamId: string;
  roleId: string;
  posteJeu?: string;
}
export interface OccurrenceTableau {
  teamId: string;
  teamNom?: string;
  evenementId: string;
  cle: string;
  type: string;
  titre: string;
  debut: string;
  fin: string;
  lieu: string;
}
export interface CarteTeam {
  team: Team;
  role: { nom: string; couleur: string; cle: string | null } | null;
  effectif: { actifs: number; invites: number; suspendus: number };
  /** `null` : module désactivé ou pas la permission de le voir. */
  prochains: OccurrenceTableau[] | null;
  presence: { jours: number; marques: number; presents: number; taux: number | null } | null;
  resumes: { aResumer: number; enCours: number; plusAncien: string | null; redacteur: boolean } | null;
  taches: { enRetard: number } | null;
  /** Date de la dernière activité ; le détail seulement avec le Journal. */
  derniereActivite: { date: string; action?: string; acteur?: string | null; pseudo?: string | null; meta?: Record<string, unknown> } | null;
}
export interface AlerteTableau {
  genre: 'taches' | 'resumes' | 'presence' | 'invites';
  teamId: string;
  teamNom: string;
  nombre: number;
  texte: string;
}
export interface Tableau {
  genereLe: string;
  teams: CarteTeam[];
  global: { resumesARediger: number; evenementsSemaine: OccurrenceTableau[]; alertes: AlerteTableau[] };
}
export interface EntreeJournal {
  id: string;
  action: string;
  /** Module de l'action (« coeur » : team, membres, rôles, invitations). */
  module?: string;
  acteur: string | null;
  entiteType: string | null;
  entiteId: string | null;
  meta: Record<string, unknown>;
  date: string;
}
export interface PageJournal {
  entrees: EntreeJournal[];
  noms: Record<string, string | null>;
  /** Curseur de la page suivante (opaque), ou null. */
  suite: string | null;
  /** Membres de la team (filtre « membre »). */
  membres?: Array<{ compte: string; pseudo: string | null }>;
  /** Durée de conservation du journal (jours ; 0 = illimitée). */
  retentionJours?: number;
}
export interface FiltresJournal {
  avant?: string;
  action?: string;
  module?: string;
  acteur?: string;
  /** Période (AAAA-MM-JJ, incluses, fuseau de la team). */
  du?: string;
  au?: string;
  limite?: number;
}
export interface ReglagesJournal {
  retentionJours: number;
  choix: number[];
  modifiable: boolean;
}
/** Fichier rendu par le serveur pour que l'app l'enregistre (CSV…). */
export interface FichierServeur {
  nom: string;
  type: string;
  contenu: string;
}
/** Statistiques d'une team sur une période (blocs `null` : module désactivé ou droit absent). */
export interface StatsTeam {
  periode: { du: string; au: string; fuseau: string };
  membres: { actifs: number; suspendus: number };
  presence: {
    seances: number;
    taux: number | null;
    reel: Record<'present' | 'retard' | 'absent' | 'excuse' | 'inconnu', number>;
    rsvp: Record<'oui' | 'non' | 'peut_etre' | 'sans_reponse', number>;
    joueurs: Array<{ compte: string; pseudo: string | null; marques: number; taux: number | null }>;
  } | null;
  taches: { creees: number; terminees: number; ouvertes: number; enRetard: number; aFaire: number; enCours: number; objectifs: Record<'actif' | 'atteint' | 'abandonne', number> } | null;
  resumes: { deposes: number; termines: number; enAttente: number } | null;
  activite: { actions: number; membresActifs: number; parModule: Record<string, number>; parJour: Array<{ jour: string; n: number }> } | null;
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

// ------------------------------------------------------------------ Phase 3 : résumés de réunions

export type StatutDepot = 'a_resumer' | 'en_cours' | 'termine';
export interface TypeReunion {
  id: string;
  nom: string;
  couleur: string;
  visibilite: 'team' | 'staff';
  global: boolean;
  position: number;
}
export interface Personne {
  compte: string;
  pseudo: string | null;
}
export interface Depot {
  id: string;
  team: { id: string; nom: string | null };
  titre: string;
  lien: string;
  type: TypeReunion | null;
  dateReunion: string;
  note: string;
  statut: StatutDepot;
  deposePar: Personne;
  creeLe: string;
  majLe: string;
  resume: { fichierId: string; le: string | null; par: Personne | null } | null;
  nouveau: boolean;
  vu: { le: string; par: string } | null;
  moi: { deposant: boolean; redacteur: boolean };
}
export interface FichierDepot {
  id: string;
  nom: string;
  taille: number;
  type: string;
  deposePar: Personne;
  le: string;
  actuel: boolean;
  remplaceLe: string | null;
}
export interface DetailDepot extends Depot {
  fichiers: FichierDepot[];
}
export interface FiltresBoite {
  statut?: StatutDepot;
  team?: string;
  type?: string;
  du?: string;
  au?: string;
  deposePar?: string;
  nouveaux?: boolean;
  tri?: 'recent' | 'ancien' | 'date' | 'statut';
}
export interface Boite {
  depots: Depot[];
  teams: Array<{ id: string; nom: string; redacteur: boolean }>;
  types: TypeReunion[];
  deposants: Personne[];
  attente: number;
  nouveaux: number;
  total: number;
}

// ------------------------------------------------------------------ Phase 3 : objectifs et tâches

export type StatutTache = 'a_faire' | 'en_cours' | 'fait';
export type Priorite = 'basse' | 'normale' | 'haute' | 'urgente';
export interface Objectif {
  id: string;
  titre: string;
  description: string;
  proprietaire: Personne | null;
  dateCible: string | null;
  statut: 'actif' | 'atteint' | 'abandonne';
  progression: { total: number; faites: number; pourcentage: number };
  creePar: Personne | null;
  creeLe: string;
}
export interface Tache {
  id: string;
  titre: string;
  description: string;
  objectif: { id: string; titre: string | null } | null;
  assigne: Personne | null;
  echeance: string | null;
  priorite: Priorite;
  statut: StatutTache;
  enRetard: boolean;
  creePar: Personne | null;
  creeLe: string;
  majLe: string;
  termineLe: string | null;
}
export interface FiltresTaches {
  filtre?: 'miennes' | 'retard';
  statut?: StatutTache;
  objectif?: string;
  assigne?: string;
  priorite?: Priorite;
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
  'Les données Esport sont stockées en clair sur le serveur Esport (Cloudflare, chiffrées au repos) : elles ne sont pas chiffrées de bout en bout comme le reste de l’app. Le serveur garde : votre pseudo (obligatoire), votre Riot ID et votre nom Discord (facultatifs), jamais d’adresse e-mail (celle d’un invité reste chiffrée dans l’Administration du Fondateur) ; vos teams, rôles et poste ; vos disponibilités, réponses et présences ; les réunions que vous déposez et leurs résumés PDF ; les tâches, objectifs, repères et commentaires de review, strats et fiches de scouting de la team ; le journal d’activité (conservé selon la durée choisie par la team, 1 an par défaut). Ces données servent uniquement au fonctionnement de la team, ne sont ni vendues ni transmises, sauf les messages que la team choisit d’envoyer sur son Discord. Vous pouvez à tout moment exporter vos données (JSON) ou supprimer votre compte Esport ci-dessous ; le Fondateur peut aussi le faire à votre demande. Membre mineur : l’accord d’un représentant légal est nécessaire.';

// ------------------------------------------------------------------ Adresse du Worker

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer | Uint8Array; signal?: unknown }) => Promise<{
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
  journal(id: string, filtres?: FiltresJournal): Promise<PageJournal>;
  exporterJournal(id: string, filtres?: Omit<FiltresJournal, 'avant' | 'limite'>): Promise<FichierServeur>;
  reglagesJournal(id: string): Promise<ReglagesJournal>;
  changerRetentionJournal(id: string, retentionJours: number): Promise<ReglagesJournal>;
  stats(id: string, periode?: { du?: string; au?: string }): Promise<StatsTeam>;
  /** Fondateur : données Esport d'un membre (RGPD). */
  exporterCompte(compte: string): Promise<unknown>;
  /** Fondateur : suppression (anonymisation) du compte Esport d'un membre. */
  supprimerCompte(compte: string): Promise<void>;
  /** Ajoute un compte existant (déjà visible) à une team, avec un rôle. */
  ajouterMembre(id: string, m: { compte: string; roleId: string; posteJeu?: string }): Promise<CompteEsport | null>;
  // Premier niveau (toutes teams)
  /** Page Membres : comptes de toutes les teams où l'on voit les membres. */
  annuaire(): Promise<Annuaire>;
  /** Dashboard : résumé de toutes ses teams (une seule requête). */
  tableau(): Promise<Tableau>;
  /** Fondateur : contrôle une invitation directe AVANT de créer le compte du hub (rien n'est écrit). */
  verifierPreinscription(c: { pseudo: string; affectations: Affectation[] }): Promise<void>;
  /** Fondateur : pré-enregistre le compte du hub tout juste créé, avec ses teams. */
  preinscrire(c: { compte: string; pseudo: string; affectations: Affectation[] }): Promise<CompteEsport | null>;
  /** Fondateur : compte supprimé dans l'Administration → retiré de l'Esport. */
  retirerCompte(compte: string): Promise<{ ok: boolean; retire: boolean; teams: number }>;
  notifications(): Promise<Notifications>;
  marquerLues(tout: boolean, ids?: string[]): Promise<Notifications>;
  // Résumés de réunions (phase 3)
  typesReunion(id: string): Promise<TypeReunion[]>;
  creerTypeReunion(id: string, t: { nom: string; couleur?: string; visibilite: 'team' | 'staff'; global?: boolean }): Promise<TypeReunion>;
  modifierTypeReunion(id: string, typeId: string, t: Partial<{ nom: string; couleur: string; visibilite: 'team' | 'staff' }>): Promise<TypeReunion>;
  supprimerTypeReunion(id: string, typeId: string): Promise<void>;
  deposerReunion(id: string, d: { lien: string; typeId: string; dateReunion: string; titre: string; note?: string }): Promise<Depot>;
  mesDepots(id: string): Promise<Depot[]>;
  resumesTeam(id: string, limite?: number): Promise<Depot[]>;
  depot(id: string, depotId: string): Promise<DetailDepot>;
  supprimerDepot(id: string, depotId: string): Promise<void>;
  boiteResumes(filtres?: FiltresBoite): Promise<Boite>;
  marquerVu(id: string, depotId: string): Promise<DetailDepot>;
  changerStatutDepot(id: string, depotId: string, statut: StatutDepot): Promise<DetailDepot>;
  envoyerPdf(id: string, depotId: string, octets: ArrayBuffer | Uint8Array, nom: string): Promise<DetailDepot>;
  lienPdf(id: string, depotId: string, options?: { fichierId?: string; telecharger?: boolean }): Promise<{ url: string; expire: string }>;
  // Objectifs et tâches (phase 3)
  objectifs(id: string): Promise<Objectif[]>;
  creerObjectif(id: string, o: { titre: string; description?: string; proprietaire?: string | null; dateCible?: string | null }): Promise<Objectif>;
  modifierObjectif(id: string, objectifId: string, o: Partial<{ titre: string; description: string; proprietaire: string | null; dateCible: string | null; statut: Objectif['statut'] }>): Promise<Objectif>;
  supprimerObjectif(id: string, objectifId: string): Promise<void>;
  taches(id: string, filtres?: FiltresTaches): Promise<{ jour: string; taches: Tache[] }>;
  creerTache(id: string, t: { titre: string; description?: string; assigne?: string | null; echeance?: string | null; priorite?: Priorite; statut?: StatutTache; objectifId?: string | null }): Promise<Tache>;
  modifierTache(id: string, tacheId: string, t: Partial<{ titre: string; description: string; assigne: string | null; echeance: string | null; priorite: Priorite; statut: StatutTache; objectifId: string | null }>): Promise<Tache>;
  supprimerTache(id: string, tacheId: string): Promise<void>;
  exporterTaches(id: string, filtres?: FiltresTaches): Promise<FichierServeur>;
  exporterObjectifs(id: string): Promise<FichierServeur>;
  /** Appel générique avec la session (modules : planning, etc. ; voir src/esport/planning/api.ts). */
  requete<T>(chemin: string, methode?: string, corps?: unknown): Promise<T>;
}

/** Paramètres d'URL (valeurs vides ignorées). */
export function requeteUrl(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : String(v))}`)
    .join('&');
  return p ? `?${p}` : '';
}

export function clientEsport(config: ConfigEsport, requete: Fetch = globalThis.fetch as unknown as Fetch, maintenant: () => number = Date.now): ClientEsport {
  const cle = `${config.adresse}|${config.jetonRelais}`;

  async function brut<T>(chemin: string, methode = 'GET', corps?: unknown, jeton?: string, binaire?: { octets: ArrayBuffer | Uint8Array; type: string; entetes: Record<string, string> }): Promise<T> {
    let r: Awaited<ReturnType<Fetch>>;
    try {
      r = await auPlus(
        requete(`${config.adresse}${chemin}`, {
          method: methode,
          headers: { 'Content-Type': binaire ? binaire.type : 'application/json', ...(binaire?.entetes ?? {}), ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
          body: binaire ? binaire.octets : corps === undefined ? undefined : JSON.stringify(corps),
        }),
        binaire ? 120_000 : 15_000,
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

  async function appel<T>(chemin: string, methode = 'GET', corps?: unknown, binaire?: Parameters<typeof brut>[4]): Promise<T> {
    try {
      return await brut<T>(chemin, methode, corps, await session(), binaire);
    } catch (e) {
      // Session expirée (ou Worker redéployé avec une nouvelle clé) : une nouvelle, une fois.
      if (e instanceof ErreurEsport && e.code === 'session') return brut<T>(chemin, methode, corps, await session(true), binaire);
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
    ajouterMembre: (id, m) => appel(`${t(id)}/membres`, 'POST', m),
    annuaire: () => appel('/membres'),
    tableau: () => appel('/dashboard'),
    verifierPreinscription: async c => {
      await appel('/comptes', 'POST', { ...c, verifier: true });
    },
    journal: (id, f = {}) => appel(`${t(id)}/journal${requeteUrl({ ...f })}`),
    exporterJournal: (id, f = {}) => appel(`${t(id)}/journal/export.csv${requeteUrl({ ...f, format: 'json' })}`),
    reglagesJournal: id => appel(`${t(id)}/journal/reglages`),
    changerRetentionJournal: (id, retentionJours) => appel(`${t(id)}/journal/reglages`, 'PUT', { retentionJours }),
    stats: (id, p = {}) => appel(`${t(id)}/stats${requeteUrl({ ...p })}`),
    exporterCompte: compte => appel(`/admin/comptes/${encodeURIComponent(compte)}/export`),
    supprimerCompte: async compte => {
      await appel(`/admin/comptes/${encodeURIComponent(compte)}`, 'DELETE');
    },
    preinscrire: c => appel('/comptes', 'POST', c),
    retirerCompte: compte => appel(`/admin/comptes/${encodeURIComponent(compte)}/hub`, 'DELETE'),
    notifications: () => appel('/notifications'),
    marquerLues: (tout, ids) => appel('/notifications/lues', 'POST', tout ? { tout: true } : { ids: ids ?? [] }),
    // ---- Résumés de réunions
    typesReunion: async id => (await appel<{ types: TypeReunion[] }>(`${t(id)}/resumes/types`)).types,
    creerTypeReunion: (id, ty) => appel(`${t(id)}/resumes/types`, 'POST', ty),
    modifierTypeReunion: (id, typeId, ty) => appel(`${t(id)}/resumes/types/${encodeURIComponent(typeId)}`, 'PATCH', ty),
    supprimerTypeReunion: async (id, typeId) => {
      await appel(`${t(id)}/resumes/types/${encodeURIComponent(typeId)}`, 'DELETE');
    },
    deposerReunion: (id, d) => appel(`${t(id)}/resumes`, 'POST', d),
    mesDepots: async id => (await appel<{ depots: Depot[] }>(`${t(id)}/resumes/miens`)).depots,
    resumesTeam: async (id, limite) => (await appel<{ resumes: Depot[] }>(`${t(id)}/resumes${requeteUrl({ limite })}`)).resumes,
    depot: (id, depotId) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`),
    supprimerDepot: async (id, depotId) => {
      await appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`, 'DELETE');
    },
    boiteResumes: (f = {}) => appel(`/resumes/boite${requeteUrl({ ...f })}`),
    marquerVu: (id, depotId) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/vu`, 'POST', {}),
    changerStatutDepot: (id, depotId, statut) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}`, 'PATCH', { statut }),
    envoyerPdf: (id, depotId, octets, nom) =>
      appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/pdf`, 'PUT', undefined, { octets, type: 'application/pdf', entetes: { 'X-Nom-Fichier': encodeURIComponent(nom) } }),
    lienPdf: (id, depotId, options = {}) => appel(`${t(id)}/resumes/${encodeURIComponent(depotId)}/lien`, 'POST', options),
    // ---- Objectifs et tâches
    objectifs: async id => (await appel<{ objectifs: Objectif[] }>(`${t(id)}/objectifs`)).objectifs,
    creerObjectif: (id, o) => appel(`${t(id)}/objectifs`, 'POST', o),
    modifierObjectif: (id, objectifId, o) => appel(`${t(id)}/objectifs/${encodeURIComponent(objectifId)}`, 'PATCH', o),
    supprimerObjectif: async (id, objectifId) => {
      await appel(`${t(id)}/objectifs/${encodeURIComponent(objectifId)}`, 'DELETE');
    },
    taches: (id, f = {}) => appel(`${t(id)}/taches${requeteUrl({ ...f })}`),
    creerTache: (id, ta) => appel(`${t(id)}/taches`, 'POST', ta),
    modifierTache: (id, tacheId, ta) => appel(`${t(id)}/taches/${encodeURIComponent(tacheId)}`, 'PATCH', ta),
    supprimerTache: async (id, tacheId) => {
      await appel(`${t(id)}/taches/${encodeURIComponent(tacheId)}`, 'DELETE');
    },
    exporterTaches: (id, f = {}) => appel(`${t(id)}/taches/export.csv${requeteUrl({ ...f, format: 'json' })}`),
    exporterObjectifs: id => appel(`${t(id)}/objectifs/export.csv?format=json`),
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
