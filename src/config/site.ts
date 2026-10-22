/**
 * Adresse du site (https://appdashboard.fr, hébergé chez o2switch) : une seule
 * source, lue partout (liens de liaison, tests, docs). Le fichier `site.json`
 * est aussi lu par les tests du relais (relais/tsuzuku.test.mjs).
 */

import config from './site.json';

/** Adresse actuelle du site (sans « / » final). */
export const SITE_PRINCIPAL: string = config.site;

/**
 * Vrai seulement si `site` appartient bien au Fondateur (domaine
 * appdashboard.fr) : un lien de liaison porte le code d'accès au relais, il ne
 * doit jamais pointer vers une adresse qui pourrait appartenir à un tiers.
 */
export const SITE_VERIFIE: boolean = config.verifie === true;

/**
 * Anciennes adresses du site encore reconnues (codes de liaison AB1.… déjà
 * émis qui les portent) : aucune aujourd'hui. À remplir le temps d'un futur
 * changement d'adresse.
 */
export const ANCIENS_SITES: readonly string[] = config.anciensSites;

/** Vrai pour l'adresse actuelle comme pour une ancienne. */
export function estSiteConnu(adresse: string): boolean {
  const propre = adresse.trim().replace(/\/+$/, '');
  return propre === SITE_PRINCIPAL || ANCIENS_SITES.includes(propre);
}

interface ConfigSite {
  principal: string;
  verifie: boolean;
  anciens: readonly string[];
}

/**
 * Adresse à mettre dans un lien de liaison, ou `undefined` s'il ne faut pas en
 * faire (adresse non vérifiée : on ne donne alors que le code seul).
 * L'adresse portée par un code n'est reprise que si elle est connue.
 */
export function choisirSite(
  adresse: string | undefined,
  config: ConfigSite = { principal: SITE_PRINCIPAL, verifie: SITE_VERIFIE, anciens: ANCIENS_SITES },
): string | undefined {
  if (!config.verifie) {
    return undefined;
  }
  const propre = adresse?.trim().replace(/\/+$/, '');
  if (propre && (propre === config.principal || config.anciens.includes(propre))) {
    return propre;
  }
  return config.principal;
}
