/**
 * Adresse du site de secours : une seule source, lue partout (liens de
 * liaison, script de déploiement, workflow, docs).
 *
 * Le fichier `site.json` est partagé avec `scripts/deployer-relais.mjs`, qui
 * ne peut pas importer de TypeScript.
 */

import config from './site.json';

/** Nom du projet Cloudflare Pages. */
export const PROJET_PAGES: string = config.projetPages;

/** Adresse actuelle du site de secours (sans « / » final). */
export const SITE_PRINCIPAL: string = config.site;

/**
 * Vrai seulement si le projet Pages de `site` a été vu dans le compte
 * Cloudflare de l'utilisateur (écrit par `npm run relais:site`). Les noms
 * *.pages.dev sont uniques mondialement : une adresse jamais vérifiée peut
 * appartenir à un tiers, et un lien de liaison porte le code d'accès au relais.
 */
export const SITE_VERIFIE: boolean = config.verifie === true;

/**
 * Anciennes adresses : les codes de liaison déjà émis (AB1.…) les portent
 * encore. Le relais accepte toutes les origines (CORS ouvert, l'accès se
 * fait par le jeton) : les deux sites parlent donc au même relais pendant la
 * transition.
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
