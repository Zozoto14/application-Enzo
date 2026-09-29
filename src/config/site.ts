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
