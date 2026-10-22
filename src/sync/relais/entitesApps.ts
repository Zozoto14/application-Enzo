/**
 * Données des apps du hub dans la synchronisation (version 9 : le serveur est la référence).
 *
 * Avant, seules les données du portefeuille, le thème, les tuiles et les sources Tsuzuku
 * voyageaient (limite d'écritures de l'ancien relais) : le journal, les notes de Claude Office,
 * le carnet d'un gestionnaire… restaient sur l'appareil où ils avaient été écrits. Ici :
 *
 *  - `kv:<clé>` : un réglage ou une donnée d'app rangée telle quelle dans la base du profil
 *    (liste FERMÉE ci-dessous : ce qui est propre à l'appareil — identifiant d'appareil, état de
 *    la synchro, caches, secrets « jamais synchronisés » — n'y est pas) ; dernier gagnant par clé ;
 *  - `journal:page:<jour>` : une page du journal automatique (dernier gagnant PAR JOUR, au lieu
 *    d'un mois entier) ; l'index et le résumé du journal se recalculent à l'écriture ;
 *  - `journal:boite:<mois>` : les événements déposés par les apps pour le journal, fusionnés par
 *    UNION (identifiant d'événement) : deux appareils n'effacent jamais ceux de l'autre.
 *
 * Les données qui ont déjà leur propre canal, avec une fusion plus fine (données d'administration,
 * tâches du Fondateur, copie des tâches partagées), restent sur ce canal.
 */

import { DepotParametres, PARAMETRES } from '../../db/depots';
import { lireAcceptations, type Acceptation } from '../../juridique/modele';
import { fusionnerBibliothequeRecue } from './entitesTsuzukuDonnees';
import type { PiloteSqlite } from '../../db/pilote';
import { CLES_JOURNAL, ecrirePage, lireIndex, lireMois, pageValide } from '../../journal/modele';
import { MAX_PAR_MOIS, PREFIXE_BOITE, evenementValide } from '../../hub/journal/boite';
import type { EvenementJournal } from '../../hub/journal/contrat';

/** Clés synchronisées telles quelles (`kv:<clé>`). */
export const CLES_KV_SYNCHRONISEES: readonly string[] = [
  // Journal (réglages ; les pages et la boîte ont leurs propres entités).
  CLES_JOURNAL.reglages,
  // Claude Office : notes et réglages des alertes, préférences du bureau.
  'claude-office.notes',
  'claude-office.alertes.reglages',
  'claude-office.bureau',
  // Tâches : espace perso et pilote de la semaine (les données partagées ont leur canal).
  'taches.perso',
  'taches.pilote',
  // Claude Office : personnalisation des agents (écran « Équipe ») : restait sur l'appareil.
  'claude-office.equipe',
  // Compte : gestionnaire (carnet de ses amis), suivi. (Les tickets de support restent sur l'appareil : leur
  // liste fait foi sur le serveur du support, qui la renvoie à chaque appareil.)
  'gestion.comptes',
  'compte.connexions',
  'compte.accesAdmin',
  'compte.appareils',
  // Identifiant de connexion du Fondateur (version 9) : connu de tous ses appareils.
  'compte.identifiant',
  // Documents légaux acceptés (version et date) : valent pour TOUS les appareils du compte (fusion par union).
  PARAMETRES.acceptationsJuridiques,
  // Portefeuille : notifications, recherches, cours (le mode discret reste propre à l'appareil).
  'notifications.planning',
  'notifications.seuils',
  'notifications.seuil_variation',
  'notifications.evenements_actifs',
  'performance.reference',
  'performance.indice',
  'recherche.historique',
  'podcast.heure_auto',
  'cours.fournisseur',
  'cours.cle_api',
  'cours.intervalle_s',
  'visite.version_vue',
  // Hub et apps : rappels déjà vus, bibliothèque et réglages de Tsuzuku.
  'hub.abonnement.rappelVu',
  'admin.abonnements.notifVue',
  // (La bibliothèque Tsuzuku voyage titre par titre : voir entitesTsuzukuDonnees.ts.)
  'tsuzuku.reglages',
  'tsuzuku.mode',
  'tsuzuku.recherche.titres',
  'tsuzuku.reception',
];

/** Clés `kv` FUSIONNÉES à la réception (union) au lieu d'être remplacées. */
export const CLES_KV_FUSIONNEES: readonly string[] = [PARAMETRES.acceptationsJuridiques];

/** Ancienne bibliothèque Tsuzuku d'un seul bloc : lue (fusionnée titre par titre), plus émise. */
export const CLE_KV_BIBLIOTHEQUE_HERITEE = 'tsuzuku.bibliotheque';

/** Acceptations réunies : une par version (la première date), triées ; forme canonique. */
export function unionAcceptations(a: readonly Acceptation[], b: readonly Acceptation[]): Acceptation[] {
  const parVersion = new Map<string, string>();
  for (const x of [...a, ...b]) {
    const deja = parVersion.get(x.version);
    if (deja === undefined || x.date < deja) parVersion.set(x.version, x.date);
  }
  return [...parVersion.entries()]
    .map(([version, date]) => ({ version, date }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.version < y.version ? -1 : 1))
    .slice(-50);
}

/** Une valeur plus grande n'est pas envoyée (le serveur accepte 8 Mio chiffrés). */
export const TAILLE_MAX_KV = 6 * 1024 * 1024;

const lireBoite = (parametres: DepotParametres, mois: string): EvenementJournal[] => {
  try {
    const liste = JSON.parse(parametres.lire(PREFIXE_BOITE + mois) ?? '[]') as unknown;
    return Array.isArray(liste) ? liste.flatMap(e => evenementValide(e) ?? []) : [];
  } catch {
    return [];
  }
};

/** Entités des apps, lues dans la base du profil. */
export function entitesApps(pilote: PiloteSqlite): Record<string, unknown> {
  const parametres = new DepotParametres(pilote);
  const sortie: Record<string, unknown> = {};
  for (const cle of CLES_KV_SYNCHRONISEES) {
    let valeur = parametres.lire(cle);
    if (valeur !== undefined && cle === PARAMETRES.acceptationsJuridiques) {
      const liste = unionAcceptations(lireAcceptations(valeur), []);
      valeur = liste.length ? JSON.stringify(liste) : undefined;
    }
    if (valeur !== undefined && valeur.length <= TAILLE_MAX_KV) sortie[`kv:${cle}`] = valeur;
  }
  const base = { lire: (c: string) => parametres.lire(c) };
  for (const mois of lireIndex(base)) {
    for (const [jour, page] of Object.entries(lireMois(base, mois))) {
      sortie[`journal:page:${jour}`] = JSON.parse(JSON.stringify(page));
    }
  }
  const boites = pilote.lire<{ cle: string }>("SELECT cle FROM parametres WHERE substr(cle, 1, ?) = ?", [PREFIXE_BOITE.length, PREFIXE_BOITE]);
  for (const { cle } of boites) {
    const mois = cle.slice(PREFIXE_BOITE.length);
    const liste = lireBoite(parametres, mois);
    if (liste.length > 0) sortie[`journal:boite:${mois}`] = JSON.parse(JSON.stringify([...liste].sort((a, b) => (`${a.source}|${a.id}` < `${b.source}|${b.id}` ? -1 : 1))));
  }
  return sortie;
}

/** Écrit une entité `kv` ou `journal` reçue ; faux si elle est inconnue ou invalide. */
export function ecrireEntiteApp(pilote: PiloteSqlite, genre: 'kv' | 'journal', id: string, valeur: unknown): boolean {
  const parametres = new DepotParametres(pilote);
  if (genre === 'kv') {
    if (id === CLE_KV_BIBLIOTHEQUE_HERITEE) {
      // Appareil pas encore à jour (ou bloc déjà sur le serveur) : fusionné titre par titre.
      return fusionnerBibliothequeRecue({ lire: c => parametres.lire(c), ecrire: (c, v) => parametres.ecrire(c, v) }, valeur);
    }
    if (!CLES_KV_SYNCHRONISEES.includes(id) || typeof valeur !== 'string' || valeur.length > TAILLE_MAX_KV) return false;
    if (id === PARAMETRES.acceptationsJuridiques) {
      const recues = lireAcceptations(valeur);
      if (recues.length === 0) return false;
      parametres.ecrire(id, JSON.stringify(unionAcceptations(lireAcceptations(parametres.lire(id)), recues)));
      return true;
    }
    parametres.ecrire(id, valeur);
    return true;
  }
  const base = { lire: (c: string) => parametres.lire(c), ecrire: (c: string, v: string) => parametres.ecrire(c, v) };
  if (id.startsWith('page:')) {
    const page = pageValide(valeur);
    if (!page || page.jour !== id.slice('page:'.length)) return false;
    ecrirePage(base, page);
    return true;
  }
  if (id.startsWith('boite:')) {
    const mois = id.slice('boite:'.length);
    if (!/^\d{4}-\d{2}$/.test(mois) || !Array.isArray(valeur)) return false;
    // Union par identifiant : les événements d'ici et ceux reçus.
    const parId = new Map<string, EvenementJournal>();
    for (const e of [...lireBoite(parametres, mois), ...valeur.flatMap(v => evenementValide(v) ?? [])]) parId.set(`${e.source}|${e.id}`, e);
    parametres.ecrire(PREFIXE_BOITE + mois, JSON.stringify([...parId.values()].slice(-MAX_PAR_MOIS)));
    return true;
  }
  return false;
}

/** Retire une entité `kv` supprimée ailleurs (une page de journal ne se supprime pas, une acceptation non plus). */
export function supprimerEntiteApp(pilote: PiloteSqlite, genre: 'kv' | 'journal', id: string): void {
  if (genre === 'kv' && CLES_KV_SYNCHRONISEES.includes(id) && !CLES_KV_FUSIONNEES.includes(id)) new DepotParametres(pilote).supprimer(id);
}

/** Clés de paramètres dont l'écriture doit déclencher un tour de synchronisation. */
export const PARAMETRES_APPS_A_SYNCHRONISER: readonly string[] = [...CLES_KV_SYNCHRONISEES, CLES_JOURNAL.index];
export const PREFIXES_APPS_A_SYNCHRONISER: readonly string[] = [CLES_JOURNAL.mois, PREFIXE_BOITE];
