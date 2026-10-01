/**
 * Documents légaux : modèle par défaut (véridique par rapport à l'application) et
 * textes modifiables par le rang Fondateur.
 *
 * Format d'un texte : paragraphes séparés par une ligne vide ; une ligne qui commence
 * par « ## » est un intertitre ; une ligne qui commence par « - » est une puce.
 *
 * Le texte modifié est stocké dans l'annuaire des comptes (entrée `juridique`) et se
 * synchronise comme lui ; sans modification, chacun voit le modèle ci-dessous.
 * `VERSION_MODELE` monte quand CE MODÈLE change : tout le monde doit alors accepter de nouveau.
 * Chaque modification d'un Fondateur monte aussi la révision.
 */

export type IdDocument = 'conditions' | 'confidentialite' | 'cookies' | 'mentions';

export const VERSION_MODELE = 1;

export const AVERTISSEMENT_JURIDIQUE = 'Modèle informatif à faire relire par un professionnel du droit ; ne constitue pas un conseil juridique.';

export interface InfoDocument {
  id: IdDocument;
  titre: string;
  resume: string;
  /** Libellé court (pied de page du téléphone). */
  titreCourt?: string;
}

export const DOCUMENTS: readonly InfoDocument[] = [
  { id: 'conditions', titre: 'Conditions d’utilisation', titreCourt: 'Conditions', resume: 'Ce que vous pouvez faire de l’application, et vos responsabilités.' },
  { id: 'confidentialite', titre: 'Politique de confidentialité', titreCourt: 'Confidentialité', resume: 'Quelles données, où elles sont gardées, qui est contacté.' },
  { id: 'cookies', titre: 'Cookies et stockage local', titreCourt: 'Cookies', resume: 'Aucun cookie de suivi ; ce qui est gardé sur votre appareil.' },
  { id: 'mentions', titre: 'Mentions légales', titreCourt: 'Mentions légales', resume: 'Éditeur, hébergement, contact.' },
];

export const TAILLE_MAX_DOCUMENT = 30_000;

const CONDITIONS = `## 1. Objet
AppDashboard est un tableau de bord personnel qui réunit plusieurs applications : le Portefeuille (suivi de placements), Tsuzuku (catalogue et bibliothèque d’animés et de films) et l’Administration des comptes. Ces conditions décrivent les règles d’usage de l’application, du site de secours et de l’application de bureau.

## 2. Comptes et accès
L’accès se fait avec un compte protégé par un mot de passe et un code d’authentification. Vous êtes responsable de la confidentialité de vos identifiants. Les rangs (Fondateur, Administrateur, Gestionnaire, Ami) déterminent ce que chacun peut faire ; l’administration des comptes est journalisée.

## 3. Portefeuille : pas de conseil financier
Le Portefeuille affiche et calcule des informations à partir des données que vous saisissez et de cours fournis par des tiers. Elles sont données à titre indicatif : elles peuvent être inexactes, différées ou incomplètes, et ne constituent ni un conseil en investissement, ni une recommandation, ni une offre. Vous décidez seul de vos placements.

## 4. Tsuzuku : aucun contenu hébergé
Tsuzuku ne héberge, ne stocke et ne distribue aucun film, épisode ni flux vidéo. Il affiche des informations de catalogue (titres, résumés, affiches) fournies par des services tiers, et permet de retrouver et d’ouvrir des liens que vous choisissez vous-même ou que l’administrateur de l’application a configurés. Aucune source n’est préconfigurée.

## 5. Vos responsabilités
- Vous êtes seul responsable des liens et des sources que vous ajoutez ou utilisez, et du respect du droit d’auteur et des droits voisins applicables là où vous vous trouvez.
- Vous vous engagez à ne pas utiliser l’application pour porter atteinte aux droits d’autrui, contourner des protections, ou accéder aux comptes d’autres personnes.
- Vous vous engagez à ne pas perturber le service (relais de synchronisation, support) par des envois abusifs.

## 6. Disponibilité et sauvegardes
L’application est fournie telle quelle, sans garantie de disponibilité continue. Les données du compte sont chiffrées sur votre appareil : sans mot de passe, sans code d’authentification ni code de récupération, elles ne peuvent pas être retrouvées. Pensez à créer des sauvegardes (Paramètres › Sécurité).

## 7. Support
Pour signaler un problème ou poser une question, utilisez la section Support de l’application.

## 8. Modification des conditions
Ces conditions peuvent évoluer. Quand elles changent, l’application vous demande de les accepter de nouveau à la connexion suivante ; la date et la version acceptées sont conservées dans votre compte.`;

const CONFIDENTIALITE = `## 1. Principe
Vos données sont gardées sur vos appareils, chiffrées, et il n’existe aucun serveur qui en conserve une copie lisible. Cette politique dit précisément ce qui est gardé, où, et quels services tiers sont contactés.

## 2. Données gardées dans l’application
- Votre compte : prénom (scellé), mot de passe (jamais conservé : seule une clé dérivée sert à ouvrir le coffre), code d’authentification, codes de récupération.
- Vos données de Portefeuille : comptes, titres, opérations, réglages.
- Vos données de Tsuzuku : bibliothèque, progression, réglages, liens et sources.
- Vos préférences : thème, disposition, verrouillage automatique, historique de vos tickets de support.
Tout cela est chiffré localement (dérivation de clé Argon2id, chiffrement XChaCha20-Poly1305) avant d’être écrit sur l’appareil ou déposé sur le relais.

## 3. Synchronisation et relais Cloudflare
Pour relier vos appareils, l’application peut déposer des données chiffrées sur un relais hébergé chez Cloudflare (Workers et KV). Le relais ne voit que du contenu chiffré qu’il ne peut pas lire : ni montants, ni noms. Il voit en revanche des métadonnées techniques (adresse réseau de l’appareil, taille et date des dépôts). Le site de secours est également servi par Cloudflare.

## 4. Services tiers contactés
Selon les fonctions que vous utilisez, l’application contacte :
- des fournisseurs de cours de bourse (Yahoo Finance, Financial Modeling Prep, Finnhub, Alpha Vantage selon votre réglage) : les symboles des valeurs demandées leur sont envoyés, avec votre clé d’API si vous en avez saisi une ;
- des catalogues de films et d’animés (Jikan/MyAnimeList, AniList, TMDB) : les recherches et les identifiants de titres consultés leur sont envoyés ;
- des sites de flux ou de lecteurs que vous choisissez vous-même dans Tsuzuku : ils reçoivent votre adresse réseau, comme pour toute visite ;
- Discord, uniquement quand vous envoyez un ticket de support : le message, la catégorie, la capture jointe et, si vous le cochez, les informations techniques (version, plateforme, rang, début de l’identifiant de compte) sont relayés vers un salon de l’équipe. Ne mettez jamais de mot de passe ni de clé dans un ticket.
Chacun de ces services applique sa propre politique de confidentialité.

## 5. Ce que l’application ne fait pas
- Aucun outil de mesure d’audience ni d’analyse tiers.
- Aucune publicité, aucun profilage, aucune revente de données.
- Aucun cookie de suivi (voir « Cookies et stockage local »).

## 6. Conservation
Les données restent sur vos appareils et sur le relais tant que vous ne les supprimez pas. Les tickets envoyés sur Discord sont conservés par le salon qui les reçoit, selon les règles de l’équipe.

## 7. Vos droits
Vous pouvez à tout moment accéder à vos données (elles sont dans votre compte, exportables par les sauvegardes et l’export Excel), les corriger, et en demander la suppression. Selon la réglementation qui vous est applicable (par exemple le RGPD), vous disposez aussi de droits d’opposition, de limitation et de portabilité. Pour exercer un droit ou poser une question, contactez l’équipe par la section Support.

## 8. Modification
Cette politique peut évoluer ; l’application vous demande alors de l’accepter de nouveau.`;

const COOKIES = `## 1. Aucun cookie de suivi
AppDashboard n’utilise aucun cookie de suivi, de mesure d’audience ou de publicité, et n’embarque aucun outil d’analyse tiers. Comme l’application ne dépose que du stockage local strictement nécessaire à son fonctionnement, elle n’a pas de bandeau de consentement aux cookies à afficher.

## 2. Stockage local fonctionnel
Sur le site et sur l’application de bureau, l’application écrit dans le stockage de votre navigateur (localStorage et IndexedDB). Uniquement pour :
- votre session et votre coffre chiffré (IndexedDB) ;
- le thème et la disposition choisis, pour éviter un flash à l’ouverture ;
- le code de liaison avec le relais de synchronisation et l’état de la synchronisation ;
- la voix choisie pour le podcast et le délai de verrouillage automatique de cet appareil ;
- les caches de fonctionnement (par exemple les catalogues déjà consultés).
Ces données restent sur votre appareil. Elles ne sont pas lues par des tiers.

## 3. Sur iPhone et iPad
L’application native utilise une base locale chiffrée et quelques réglages locaux, pour les mêmes usages.

## 4. Les supprimer
Vous pouvez effacer ces données à tout moment dans les réglages de votre navigateur (données de site) ou en désinstallant l’application. Vous devrez alors vous reconnecter ; vos données synchronisées, chiffrées, restent sur le relais.

## 5. Contenus de tiers
Quand vous ouvrez un lecteur ou un site choisi dans Tsuzuku, ce site tiers peut utiliser ses propres cookies dans son cadre. L’application les isole autant que possible (cadre cloisonné) mais ne les contrôle pas.`;

const MENTIONS = `## Éditeur
AppDashboard est édité à titre personnel par : [à compléter par le Fondateur : nom ou pseudonyme, et adresse de contact].

## Directeur de la publication
[à compléter par le Fondateur]

## Contact
Pour toute question ou demande, utilisez la section Support de l’application. [À compléter : adresse de contact, si vous en souhaitez une en plus.]

## Hébergement
Le site de secours et le relais de synchronisation sont hébergés par Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis. Les tickets de support sont reçus sur Discord (Discord Inc., États-Unis).

## Propriété intellectuelle
Le code et la conception de l’application appartiennent à son éditeur. Les titres, résumés et visuels affichés par Tsuzuku appartiennent à leurs ayants droit et proviennent de services de catalogue tiers ; Tsuzuku ne les héberge pas. Les marques citées appartiennent à leurs propriétaires.

## Responsabilité
L’éditeur ne garantit pas l’exactitude des cours et informations affichés, qui proviennent de tiers, et n’est pas responsable des contenus accessibles par les liens que les utilisateurs configurent. Les utilisateurs sont responsables de leurs usages et du respect du droit d’auteur.`;

export const MODELES: Readonly<Record<IdDocument, string>> = {
  conditions: CONDITIONS,
  confidentialite: CONFIDENTIALITE,
  cookies: COOKIES,
  mentions: MENTIONS,
};

/** Textes modifiés par un Fondateur, tels qu'ils sont stockés et synchronisés. */
export interface DocsJuridiques {
  /** Monte à chaque modification : avec `VERSION_MODELE`, c'est la version à accepter. */
  revision: number;
  modifieLe: string;
  /** Nom du Fondateur qui a modifié en dernier (affiché, jamais un identifiant). */
  par?: string;
  documents: Partial<Record<IdDocument, string>>;
}

const IDS: readonly IdDocument[] = ['conditions', 'confidentialite', 'cookies', 'mentions'];

/** Relit des textes stockés ou reçus ; tout ce qui est invalide est écarté (rien ne lève). */
export function lireDocsJuridiques(brut: unknown): DocsJuridiques | undefined {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return undefined;
  const o = brut as Record<string, unknown>;
  const revision = Number.isInteger(o.revision) && (o.revision as number) >= 1 && (o.revision as number) < 1_000_000 ? (o.revision as number) : undefined;
  if (revision === undefined) return undefined;
  const documents: Partial<Record<IdDocument, string>> = {};
  const docs = o.documents && typeof o.documents === 'object' && !Array.isArray(o.documents) ? (o.documents as Record<string, unknown>) : {};
  for (const id of IDS) {
    const texte = docs[id];
    if (typeof texte === 'string' && texte.trim()) documents[id] = texte.slice(0, TAILLE_MAX_DOCUMENT);
  }
  return {
    revision,
    modifieLe: typeof o.modifieLe === 'string' ? o.modifieLe.slice(0, 40) : '',
    ...(typeof o.par === 'string' && o.par ? { par: o.par.slice(0, 60) } : {}),
    documents,
  };
}

/** Texte à montrer : celui du Fondateur, sinon le modèle. */
export function texteDuDocument(id: IdDocument, docs: DocsJuridiques | undefined): string {
  return docs?.documents[id] ?? MODELES[id];
}

export function estModifie(id: IdDocument, docs: DocsJuridiques | undefined): boolean {
  return docs?.documents[id] !== undefined;
}

/** Version à accepter : `modèle.révision` (0 tant qu'aucun Fondateur n'a modifié). */
export function versionJuridique(docs: DocsJuridiques | undefined): string {
  return `${VERSION_MODELE}.${docs?.revision ?? 0}`;
}

/** Nouvelle version des textes après la modification d'un Fondateur (un texte identique au modèle n'est pas stocké). */
export function modifierDocument(docs: DocsJuridiques | undefined, id: IdDocument, texte: string, par: string | undefined, maintenant: string): DocsJuridiques {
  const propre = texte.replace(/\r\n?/g, '\n').trim().slice(0, TAILLE_MAX_DOCUMENT);
  const documents = { ...(docs?.documents ?? {}) };
  if (!propre || propre === MODELES[id].trim()) delete documents[id];
  else documents[id] = propre;
  return { revision: (docs?.revision ?? 0) + 1, modifieLe: maintenant, ...(par ? { par } : {}), documents };
}

/** Retire un texte modifié : retour au modèle. */
export function retablirModele(docs: DocsJuridiques | undefined, id: IdDocument, par: string | undefined, maintenant: string): DocsJuridiques {
  return modifierDocument(docs, id, MODELES[id], par, maintenant);
}

// ------------------------------------------------------------ Mise en forme

export type Bloc = { genre: 'titre'; texte: string } | { genre: 'paragraphe'; texte: string } | { genre: 'puces'; elements: string[] };

/** Découpe un texte en blocs (intertitres, paragraphes, listes à puces). */
export function blocsDuTexte(texte: string): Bloc[] {
  const blocs: Bloc[] = [];
  for (const brut of texte.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lignes = brut.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    let puces: string[] = [];
    let paragraphe: string[] = [];
    const viderParagraphe = () => {
      if (paragraphe.length) blocs.push({ genre: 'paragraphe', texte: paragraphe.join(' ') });
      paragraphe = [];
    };
    const viderPuces = () => {
      if (puces.length) blocs.push({ genre: 'puces', elements: puces });
      puces = [];
    };
    for (const ligne of lignes) {
      if (ligne.startsWith('## ')) {
        viderParagraphe();
        viderPuces();
        blocs.push({ genre: 'titre', texte: ligne.slice(3).trim() });
      } else if (/^[-•]\s+/.test(ligne)) {
        viderParagraphe();
        puces.push(ligne.replace(/^[-•]\s+/, ''));
      } else {
        viderPuces();
        paragraphe.push(ligne.trim());
      }
    }
    viderParagraphe();
    viderPuces();
  }
  return blocs;
}

// ------------------------------------------------------------ Acceptation

export interface Acceptation {
  version: string;
  date: string;
}

export function lireAcceptations(brut: string | undefined | null): Acceptation[] {
  if (!brut) return [];
  try {
    const lu = JSON.parse(brut) as unknown;
    if (!Array.isArray(lu)) return [];
    return lu
      .filter((e): e is Acceptation => !!e && typeof e === 'object' && typeof (e as Acceptation).version === 'string' && typeof (e as Acceptation).date === 'string')
      .map(e => ({ version: e.version.slice(0, 20), date: e.date.slice(0, 40) }))
      .slice(-50);
  } catch {
    return [];
  }
}

/** Faut-il (re)demander l'acceptation ? Oui tant que la version courante n'a pas été acceptée. */
export function doitAccepter(acceptations: readonly Acceptation[], version: string): boolean {
  return !acceptations.some(a => a.version === version);
}

export function accepter(acceptations: readonly Acceptation[], version: string, date: string): Acceptation[] {
  return [...acceptations.filter(a => a.version !== version), { version, date }].slice(-50);
}

export function derniereAcceptation(acceptations: readonly Acceptation[]): Acceptation | undefined {
  return acceptations[acceptations.length - 1];
}
