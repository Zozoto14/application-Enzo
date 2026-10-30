/**
 * Correcteur des transcriptions (post-correction), pour le processus de fond de la transcription. Il passe
 * TOUJOURS par le connecteur IA (esport/noyau/ia/connecteur.mjs), jamais par un appel direct au moteur :
 * répartiteur `creerIaDepuisEnv(env, { local, externeAutorise }).discuterPour('correction', …)`.
 *
 * CONFIDENTIALITÉ (décision du Fondateur, noyau/ia/confidentialite.mjs) : la relecture est une tâche
 * CONFIDENTIELLE : le texte des réunions ne va QU'À l'IA LOCALE, quel que soit IA_ORDRE_LEGER ou l'ordre de
 * l'Administration IA. Sans IA locale utilisable, PAS de relecture (`preparerCorrecteur` rend `correcteur: null`
 * et le message MESSAGE_RELECTURE_DESACTIVEE) : la transcription garde son nettoyage sans IA (boucles, génériques).
 * Seule exception : le Fondateur a autorisé l'envoi de cette tâche à un service externe (Administration IA).
 *
 * L'IA LOCALE (llama.cpp du serveur, docs/esport/ia-locale.md) y est branchée avec le même gestionnaire « un seul
 * moteur pour tout le compte » que l'app et le processus de fond de l'IA (verrou etat/serveur.json : file d'attente
 * commune), rôle « transcription » : démarrée au premier lot, arrêtée 1 minute après le dernier ; si elle est tenue
 * par une autre tâche, on attend son tour (10 min au plus). Si elle ne répond plus, la relecture s'arrête et le
 * reste de la transcription est gardé brut (rien n'échoue pour autant).
 */

import * as connecteurIa from '../../noyau/ia/connecteur.mjs';
import { creerGestionnaireIaLocale } from '../ia-locale/gestionnaire.mjs';
import { MODELES_IA_LOCALE } from '../ia-locale/installation.mjs';
import { fetchLocal } from '../ia-locale/transport.mjs';
import { MESSAGE_RELECTURE_DESACTIVEE } from '../../noyau/ia/confidentialite.mjs';

/** Tâche de la post-correction pour le répartiteur IA (alias de la catégorie « légère »). */
export const TACHE_CORRECTION = 'correction';

const NOMS_MOTEURS = { api: 'API principale', api2: 'API secondaire', local: 'IA locale' };

/** Connecteur de l'IA locale pour la transcription (rôle « transcription »), ou null si elle n'est pas installée. */
export function connecteurIaLocaleTranscription(reglages, { fetch = fetchLocal, journal = console } = {}) {
  const inst = reglages?.installation;
  if (!inst?.installe) return null;
  const g = creerGestionnaireIaLocale({
    dossier: reglages.dossier,
    binaire: inst.binaire,
    fichierModele: inst.fichierModele,
    threads: reglages.threads,
    contexte: Math.min(reglages.contexte ?? 8192, 8192),
    inactiviteMs: 60_000,
    demarrageMs: reglages.demarrageMs,
    delaiMs: 10 * 60_000,
    fileMax: 2,
    nice: reglages.nice,
    tuesMax: reglages.tuesMax,
    attenteVerrouMs: 10 * 60_000,
    log: journal,
    role: 'transcription',
  });
  return Object.assign(connecteurIa.creerConnecteurLocal(g, { modele: reglages.modele, jetonsMax: Math.min(reglages.jetonsMax ?? 4096, 4096), delai: 10 * 60_000, fetch }), {
    arreter: () => g.arreter('fin de la relecture des transcriptions'),
    nomModele: MODELES_IA_LOCALE[reglages.modele]?.nom ?? reglages.modele,
  });
}

/**
 * Correcteur `{ appeler(messages, options), modele, arreter() }` par le répartiteur IA. `repartiteur` injectable
 * (tests) ; sinon construit depuis l'environnement avec l'IA locale si elle est installée. Rend null si aucun
 * moteur n'est configuré (ni clé d'API, ni IA locale). `externeAutorise(tache)` : réglage du Fondateur (par défaut
 * rien n'est autorisé : le répartiteur n'enverra le texte qu'à l'IA locale).
 */
export function creerCorrecteur(reglagesIaLocale, { env = process.env, repartiteur = null, local = undefined, externeAutorise = null } = {}) {
  const l = local === undefined ? connecteurIaLocaleTranscription(reglagesIaLocale) : local;
  const r = repartiteur ?? (typeof connecteurIa.creerIaDepuisEnv === 'function' ? connecteurIa.creerIaDepuisEnv(env, { local: l, externeAutorise }) : null);
  if (!r) return l ? { modele: l.nomModele ?? 'IA locale', appeler: (m, o) => l.discuter(m, o), arreter: () => l.arreter?.() } : null;
  let dernier = null;
  return {
    get modele() {
      return dernier === 'local' && l?.nomModele ? `IA locale, ${l.nomModele}` : (NOMS_MOTEURS[dernier] ?? 'IA');
    },
    async appeler(messages, options) {
      const reponse = await r.discuterPour(TACHE_CORRECTION, messages, options);
      dernier = reponse?.moteur ?? dernier;
      return reponse;
    },
    arreter: () => l?.arreter?.(),
  };
}

/**
 * Correcteur du processus de fond, en respectant la confidentialité : `{ correcteur, raison }`.
 *  - IA locale utilisable → correcteur (le texte ne quitte pas le serveur) ;
 *  - sinon, le Fondateur a autorisé l'envoi de la relecture à un service externe ET une API est configurée →
 *    correcteur par le répartiteur (les API ne servent que dans ce cas) ;
 *  - sinon → `correcteur: null`, `raison` : MESSAGE_RELECTURE_DESACTIVEE (pas de relecture, rien n'est envoyé).
 * `externeAutorise(tache)` : async, réglage du Fondateur (absent = refus).
 */
export async function preparerCorrecteur(reglagesIaLocale, { env = process.env, local = undefined, externeAutorise = null, repartiteur = null } = {}) {
  const l = local === undefined ? connecteurIaLocaleTranscription(reglagesIaLocale) : local;
  let localPret = false;
  try {
    localPret = Boolean(l) && (l.disponible ? Boolean(l.disponible()) : true) && !l.indisponible?.();
  } catch {
    localPret = false;
  }
  let externe = false;
  if (!localPret && externeAutorise) {
    try {
      externe = (await externeAutorise(TACHE_CORRECTION)) === true;
    } catch {
      externe = false;
    }
  }
  if (!localPret && !externe) {
    await l?.arreter?.()?.catch?.(() => undefined);
    return { correcteur: null, raison: MESSAGE_RELECTURE_DESACTIVEE };
  }
  const correcteur = creerCorrecteur(reglagesIaLocale, { env, local: l, repartiteur, externeAutorise });
  return correcteur ? { correcteur, raison: null } : { correcteur: null, raison: MESSAGE_RELECTURE_DESACTIVEE };
}
