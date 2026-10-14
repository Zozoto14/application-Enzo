/**
 * Assemblage du moteur pour un profil : réseau de la plateforme, stockage de
 * la base du profil, catalogue, bibliothèque, sources.
 *
 * Une instance par profil ouvert (jamais partagée) : le cache du catalogue et
 * la bibliothèque appartiennent au profil. Les DROITS sur les sources et les
 * réglages techniques sont revérifiés ici (`gestion.ts`) : un écran oublié ne
 * donne jamais un droit.
 */

import type { Rang } from '../../hub/admin/roles';
import { DepotBibliotheque, type Stockage } from '../moteur/bibliotheque';
import { creerCatalogue, type Catalogue, type OptionsCatalogue } from '../moteur/catalogue';
import { creerClient, type ClientSur } from '../moteur/reseau';
import type { ContexteResolution } from '../moteur/resolution';
import type { DefinitionSource } from '../moteur/sources';
import type { ChoixReseau } from '../plateforme/reseau';
import { CLES } from '../plateforme/stockage';
import { PARAMETRES } from '../../db/depots';
import { empreinte } from '../../sync/relais/entites';
import { etatPastilleTsuzuku, type EtatPastille } from '../../sync/relais/entitesTsuzuku';
import {
  ecrireAvances,
  ecrirePartages,
  ecrireTests,
  exigerGestionSources,
  lireAvances,
  lireChoix,
  lireListeSources,
  lirePartages,
  lireRecues,
  lireTests,
  nettoyerPartages,
  peutGererSources,
  sourcesUtilisables,
  vueSourcesPartagees,
  type Partages,
  type ReglagesAvances,
  type ResultatTestSource,
  type TestsSources,
  type VueSourcePartagee,
} from './gestion';
import { ecrireReglages, lireReglages, type ReglagesTsuzuku } from './reglages';
import { creerCache, empreinteTexte, type CacheTsuzuku } from './cache';

export interface ServicesTsuzuku {
  plateforme: ChoixReseau['plateforme'];
  /**
   * Faux sur le site (CORS), sauf pour le compte Fondateur relié au relais : les
   * pages passent alors par la route `/tsuzuku/requete` du relais.
   */
  readonly lectureSources: boolean;
  /** Site : lecture des sources par le relais (diagnostic « via le relais »). */
  readonly viaRelais: boolean;
  /** Rang du profil (Fondateur, Administrateur, Gestionnaire, Ami). */
  rang: Rang;
  /** Rang habilité à gérer les sources, les clés d'API et les options avancées (Fondateur). */
  estAdmin: boolean;
  stockage: Stockage;
  /** Cache du profil (catalogue, recherches sur les sources, lecteurs) : mémoire + base chiffrée de l'appareil. */
  cache: CacheTsuzuku;
  client: ClientSur;
  ctx: ContexteResolution;
  catalogue: Catalogue;
  depot: DepotBibliotheque;
  reglages(): Promise<ReglagesTsuzuku>;
  enregistrerReglages(r: ReglagesTsuzuku): Promise<void>;
  /** Sources utilisables par le moteur : les siennes (Fondateur) puis celles partagées avec lui, selon SES choix. */
  sources(): Promise<DefinitionSource[]>;
  /** Les sources du Fondateur (vide pour les autres rangs). */
  sourcesPropres(): Promise<DefinitionSource[]>;
  /** Réservé aux rangs habilités : la règle est ici, pas seulement dans l'écran. */
  enregistrerSources(liste: readonly DefinitionSource[]): Promise<void>;
  /** Partage de chaque source (rangs habilités ; vide pour les autres). */
  partages(): Promise<Partages>;
  enregistrerPartages(p: Partages): Promise<void>;
  /** Sources partagées avec ce profil : nom, type, état (activée pour lui ou non). */
  sourcesPartagees(): Promise<VueSourcePartagee[]>;
  /** Active ou désactive une source partagée pour ce profil SEULEMENT. */
  choisirSourcePartagee(id: string, actif: boolean): Promise<void>;
  /** Dernier test de chaque source (rangs habilités ; vide pour les autres). */
  derniersTests(): Promise<TestsSources>;
  enregistrerTest(id: string, r: ResultatTestSource): Promise<void>;
  /** Clés d'API et options avancées (rangs habilités). */
  reglagesAvances(): Promise<ReglagesAvances>;
  enregistrerReglagesAvances(a: ReglagesAvances): Promise<void>;
  /** Prévient le processus principal (Electron) qu'un lecteur va être affiché en iframe. */
  declarerLecteur(url: string): Promise<boolean>;
  /** Pastille de la page Sources : sources synchronisées entre appareils, ou en attente d'envoi. */
  etatSynchroSources(): { etat: EtatPastille; depuis?: string };
}

export interface OptionsServices {
  choix: Pick<ChoixReseau, 'plateforme' | 'reseau' | 'lectureSources' | 'pont' | 'viaRelais'>;
  stockage: Stockage;
  /** Rang du profil ouvert. */
  rang?: Rang;
  /** Ancienne option : vrai = Fondateur, faux = Ami (si `rang` est absent). */
  estAdmin?: boolean;
  journal?: (message: string) => void;
  /** Réglages fins du catalogue (horloge, attente) : tests. */
  catalogue?: Partial<OptionsCatalogue>;
  /** Lecture brute de la base du profil (état de la synchro, hors préfixe `tsuzuku.`) : pastille de la page Sources. */
  lireBase?: (cle: string) => string | undefined | null;
  /** Options avancées déjà lues (le client réseau est créé avec) ; sinon les défauts du moteur. */
  avances?: Pick<ReglagesAvances, 'delaiS' | 'tailleMaxMo'>;
  /** Cache du profil déjà ouvert (gardé d'une ouverture de l'app à l'autre) ; sinon un cache sur `stockage`. */
  cache?: CacheTsuzuku;
}

/** Catalogue : réponse fraîche pendant 30 min, puis servie aussitôt et rafraîchie en arrière-plan pendant 7 jours. */
export const CATALOGUE_FRAIS_MS = 30 * 60_000;
export const CATALOGUE_PERIME_MAX_MS = 7 * 24 * 3_600_000;

export function creerServices({ choix, stockage, rang: rangDonne, estAdmin: ancien, journal, catalogue, avances, lireBase, cache: cacheDonne }: OptionsServices): ServicesTsuzuku {
  const rang: Rang = rangDonne ?? (ancien === false ? 'ami' : 'fondateur');
  const habilite = peutGererSources(rang);
  const client = creerClient(choix.reseau, avances ? { delaiMs: avances.delaiS * 1000, tailleMax: avances.tailleMaxMo * 1024 * 1024 } : {});
  const reglages = async () => lireReglages(await stockage.lire(CLES.reglages));
  const lireAvancesStockees = async () => lireAvances(await stockage.lire(CLES.avance), (await reglages()).cleTmdb);
  const propres = async () => (habilite ? lireListeSources(await stockage.lire(CLES.sources)) : []);
  const recues = async () => lireRecues(await stockage.lire(CLES.sourcesRecues));
  const choixPerso = async () => lireChoix(await stockage.lire(CLES.choixSources));
  // Site : le relais ne sert que le jeton maître (Fondateur historique) ; un autre rang garde le message du site.
  const lecture = () => (choix.plateforme === 'site' ? Boolean(choix.lectureSources) && rang === 'fondateur' : choix.lectureSources);
  const cache = cacheDonne ?? creerCache(stockage);
  // Réponses brutes des catalogues (jamais la clé TMDB : elle n'entre pas dans les clés), clé hachée.
  const persistant = {
    lire: async (cle: string) => {
      const e = await cache.lire(`cat|${empreinteTexte(cle)}`);
      return e ? { a: e.a, donnees: e.valeur } : undefined;
    },
    ecrire: (cle: string, donnees: unknown, a: number) => cache.ecrire(`cat|${empreinteTexte(cle)}`, donnees, { a }),
  };
  return {
    plateforme: choix.plateforme,
    get lectureSources() {
      return lecture();
    },
    get viaRelais() {
      return choix.plateforme === 'site' && lecture();
    },
    rang,
    estAdmin: habilite,
    stockage,
    cache,
    client,
    ctx: { client, journal },
    // La clé TMDB est celle de la base du profil : jamais celle d'un autre compte.
    catalogue: creerCatalogue({ client, cleTmdb: async () => (await lireAvancesStockees()).cleTmdb || null, journal, cacheMs: CATALOGUE_FRAIS_MS, perimeMaxMs: CATALOGUE_PERIME_MAX_MS, persistant, ...catalogue }),
    depot: new DepotBibliotheque(stockage, CLES.bibliotheque),
    reglages,
    enregistrerReglages: async r => {
      // La clé TMDB ne s'écrit plus par les réglages de confort : on garde celle déjà rangée.
      const actuels = await reglages();
      await stockage.ecrire(CLES.reglages, ecrireReglages({ ...r, cleTmdb: actuels.cleTmdb }));
    },
    async sources() {
      return sourcesUtilisables(await propres(), await recues(), await choixPerso());
    },
    sourcesPropres: propres,
    async enregistrerSources(liste) {
      exigerGestionSources(rang);
      await stockage.ecrire(CLES.sources, JSON.stringify(liste));
      // Une source supprimée n'est plus partagée.
      const p = lirePartages(await stockage.lire(CLES.partages));
      const nettoyes = nettoyerPartages(p, liste);
      if (Object.keys(nettoyes).length !== Object.keys(p).length) {
        await stockage.ecrire(CLES.partages, ecrirePartages(nettoyes));
      }
    },
    async partages() {
      return habilite ? lirePartages(await stockage.lire(CLES.partages)) : {};
    },
    async enregistrerPartages(p) {
      exigerGestionSources(rang, 'Le partage des sources');
      await stockage.ecrire(CLES.partages, ecrirePartages(nettoyerPartages(p, await propres())));
    },
    async sourcesPartagees() {
      return vueSourcesPartagees(await recues(), await choixPerso());
    },
    async choisirSourcePartagee(id, actif) {
      const r = await recues();
      if (!r.sources.some(s => s.id === id)) return;
      await stockage.ecrire(CLES.choixSources, JSON.stringify({ ...(await choixPerso()), [id]: actif }));
    },
    async derniersTests() {
      return habilite ? lireTests(await stockage.lire(CLES.testsSources)) : {};
    },
    async enregistrerTest(id, r) {
      exigerGestionSources(rang, 'Les tests de sources');
      const ids = new Set((await propres()).map(x => x.id));
      const tests = Object.fromEntries(Object.entries(lireTests(await stockage.lire(CLES.testsSources))).filter(([cle]) => ids.has(cle)));
      await stockage.ecrire(CLES.testsSources, ecrireTests({ ...tests, [id]: r }));
    },
    async reglagesAvances() {
      exigerGestionSources(rang, 'Les réglages techniques');
      return lireAvancesStockees();
    },
    async enregistrerReglagesAvances(a) {
      exigerGestionSources(rang, 'Les réglages techniques');
      await stockage.ecrire(CLES.avance, ecrireAvances(a));
      // L'ancienne place de la clé (réglages de confort) est vidée : une seule clé, ici.
      const r = await reglages();
      if (r.cleTmdb) await stockage.ecrire(CLES.reglages, ecrireReglages({ ...r, cleTmdb: '' }));
    },
    etatSynchroSources() {
      if (!lireBase) return { etat: 'non-configuree' };
      try {
        return etatPastilleTsuzuku(lireBase, { relais: PARAMETRES.relaisSynchro, etat: PARAMETRES.etatSynchro }, empreinte);
      } catch {
        return { etat: 'non-configuree' };
      }
    },
    async declarerLecteur(url) {
      try {
        return (await choix.pont?.lecteur?.(url)) ?? true;
      } catch {
        return false;
      }
    },
  };
}
