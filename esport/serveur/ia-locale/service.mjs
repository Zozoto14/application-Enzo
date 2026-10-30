/**
 * IA locale branchée sur l'Esport : réglages (IA_LOCALE_*), état de l'installation, gestionnaire du
 * serveur d'inférence et connecteur, sous la forme attendue par `servicesJeux({ ia: { local } })`.
 *
 *  - dans l'app Passenger (`role: 'app'`) : sert le TEST DE CONNEXION (Administration IA) et l'état ; les
 *    travaux longs (brouillon, vérification) sont confiés au processus de fond (`lancerTravailleur`),
 *    car Passenger peut arrêter l'app à tout moment. Le moteur s'y arrête après 1 minute sans requête
 *    (au plus `inactiviteMs`) pour laisser la place au processus de fond ;
 *  - dans le processus de fond (`role: 'travailleur'`, travailleur.mjs) : exécute les travaux, attend
 *    plus longtemps que le moteur se libère ;
 *  - dans le cron (`role: 'cron'`) : état seulement (aucun moteur n'y est démarré) ; le cron lance le
 *    processus de fond si des travaux attendent, et nettoie un moteur orphelin.
 */

import { configIaLocale, creerConnecteurLocal } from '../../noyau/ia/connecteur.mjs';
import { creerGestionnaireIaLocale } from './gestionnaire.mjs';
import { MODELES_IA_LOCALE, dossierIaLocaleParDefaut, etatInstallationIaLocale } from './installation.mjs';
import { lancerTravailleurIaLocale } from './lanceur.mjs';
import { lireHebergement } from './hebergement.mjs';
import { fetchLocal } from './transport.mjs';

/** Réglages + état de l'installation (rapide : quelques lectures de fichiers, aucun lancement). */
export function chargerIaLocale(env = process.env) {
  const c = configIaLocale(env);
  const dossier = c.dossier || dossierIaLocaleParDefaut();
  const installation = etatInstallationIaLocale({ dossier, modele: c.modele });
  return { ...c, dossier, installation };
}

/**
 * Objet `local` de servicesJeux, ou null si l'IA locale n'est ni installée ni demandée (rien à afficher
 * de plus que « non installée »). Options injectables (tests) : `gestionnaire`, `lancer`, `fetch`.
 */
export function creerIaLocale(reglages, { role = 'app', gestionnaire, lancer = lancerTravailleurIaLocale, fetch, journal = console } = {}) {
  if (!reglages) return null;
  const inst = reglages.installation ?? { installe: false, raison: 'non-installee' };
  const def = MODELES_IA_LOCALE[reglages.modele];
  let g = gestionnaire ?? null;
  if (!g && inst.installe && role !== 'cron') {
    g = creerGestionnaireIaLocale({
      dossier: reglages.dossier,
      binaire: inst.binaire,
      fichierModele: inst.fichierModele,
      threads: reglages.threads,
      contexte: reglages.contexte,
      inactiviteMs: role === 'app' ? Math.min(reglages.inactiviteMs, 60_000) : reglages.inactiviteMs,
      demarrageMs: reglages.demarrageMs,
      delaiMs: reglages.delaiMs,
      fileMax: reglages.fileMax,
      nice: reglages.nice,
      tuesMax: reglages.tuesMax,
      // Processus de fond : il attend que l'app libère le moteur (test de connexion récent).
      attenteVerrouMs: role === 'travailleur' ? reglages.inactiviteMs + 2 * 60_000 : 10_000,
      log: journal,
      role,
    });
  }
  // Transport node:http (pas le fetch global : undici coupe à 300 s sans en-têtes, voir transport.mjs).
  const connecteur = g ? creerConnecteurLocal(g, { modele: reglages.modele, jetonsMax: reglages.jetonsMax, delai: reglages.delaiMs, fetch: fetch ?? fetchLocal }) : null;
  // Le cron ne démarre pas de moteur mais doit savoir que l'IA locale est installée (pour lancer le processus de fond).
  const pret = Boolean(inst.installe && (connecteur || role === 'cron'));
  // Arrêtée de force par l'hébergeur trop souvent (hebergement.mjs) : installée, mais sautée partout.
  const hebergement = () => (g ? g.etat?.().hebergement : null) ?? lireHebergement(reglages.dossier, { max: reglages.tuesMax });
  const indisponible = () => Boolean(inst.installe && hebergement()?.indisponible);
  return {
    role,
    gestionnaire: g,
    connecteur: connecteur ?? (role === 'cron' && inst.installe ? { local: true, disponible: () => !indisponible(), indisponible, discuter: async () => { throw new Error('IA locale : pas de moteur dans le cron'); } } : null),
    disponible: () => pret && !indisponible(),
    indisponible,
    hebergement,
    get raison() {
      return !inst.installe ? (inst.raison ?? 'non-installee') : indisponible() ? 'indisponible-hebergement' : null;
    },
    info: {
      modele: reglages.modele,
      nomModele: def?.nom ?? reglages.modele,
      moteur: inst.moteur ?? null,
      threads: reglages.threads,
      contexte: reglages.contexte,
      delaiMs: reglages.delaiMs,
      benchmark: inst.benchmark ?? null,
    },
    etat: () => (g ? g.etat() : {}),
    lancerTravailleur: () => (role === 'travailleur' ? { lance: false, raison: 'déjà dans le processus de fond' } : indisponible() ? { lance: false, raison: 'indisponible sur cet hébergement' } : lancer({ reglages, role })),
    arreter: () => g?.arreter() ?? false,
  };
}
