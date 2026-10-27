/**
 * Routes HTTP de la page « Réseaux » de l'espace CM (branchées par api.mjs AVANT les routes de la section CM).
 * Droits contrôlés dans le service (commun.mjs).
 *
 *   GET               /cm/reseaux                                   page : comptes, salons, teams, réglages
 *   POST              /cm/reseaux/comptes ; PATCH|DELETE /cm/reseaux/comptes/:id                 (gerer)
 *   PUT               /cm/reseaux/comptes/:id/annonce ; POST …/test ; POST /cm/reseaux/apercu    (gerer)
 *   GET|POST          /cm/reseaux/comptes/:id/releves ; DELETE /cm/reseaux/releves-comptes/:id   (voir ; editer)
 *   POST              /cm/reseaux/salons ; PATCH|DELETE /cm/reseaux/salons/:id ; POST …/test     (gerer)
 *   GET               /cm/reseaux/annonces                                                        (gerer)
 *   GET|POST          /cm/reseaux/publications ; GET|PATCH|DELETE /cm/reseaux/publications/:id   (voir ; editer)
 *   POST              /cm/reseaux/publications/:id/releves ; DELETE /cm/reseaux/releves-posts/:id (editer)
 *   GET               /cm/reseaux/tableau-de-bord?du&au&reseau&team&type                          (voir)
 *   POST              /cm/reseaux/import/apercu ; /cm/reseaux/import                              (editer)
 *   GET               /cm/reseaux/export/(posts|comptes).csv  (?format=json : enveloppe)          (voir)
 *   PUT               /cm/reseaux/reglages                                                        (gerer)
 */

import { reponseFichier } from '../entetes.mjs';
import { echec } from '../outils.mjs';

const segment = s => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export async function routesReseaux({ rs, acteur, chemin, methode: m, url, lireCorps, limite }) {
  if (chemin !== '/cm/reseaux' && !chemin.startsWith('/cm/reseaux/')) return undefined;
  const p = chemin.split('/').slice(3).map(segment);
  const n = p.length;
  const q = url.searchParams;
  const [a, b, c] = p;
  const filtres = () => Object.fromEntries(['du', 'au', 'reseau', 'team', 'type', 'compte', 'q'].map(k => [k, q.get(k) || undefined]));

  if (n === 0 && m === 'GET') return rs.etat(acteur);
  if (a === 'comptes') {
    if (n === 1 && m === 'POST') return rs.creerCompte(acteur, await lireCorps());
    if (n === 2 && m === 'PATCH') return rs.modifierCompte(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return rs.supprimerCompte(acteur, b);
    if (n === 3 && c === 'annonce' && m === 'PUT') return rs.reglerAnnonce(acteur, b, await lireCorps());
    if (n === 3 && c === 'test' && m === 'POST') {
      await limite('rs_test', acteur.compte);
      return rs.tester(acteur, b);
    }
    if (n === 3 && c === 'releves' && m === 'GET') return rs.relevesCompte(acteur, b);
    if (n === 3 && c === 'releves' && m === 'POST') return rs.releverCompte(acteur, b, await lireCorps());
  }
  if (a === 'apercu' && n === 1 && m === 'POST') return rs.apercu(acteur, await lireCorps());
  if (a === 'releves-comptes' && n === 2 && m === 'DELETE') return rs.supprimerReleveCompte(acteur, b);
  if (a === 'releves-posts' && n === 2 && m === 'DELETE') return rs.supprimerRelevePost(acteur, b);
  if (a === 'salons') {
    if (n === 1 && m === 'POST') return rs.ajouterSalon(acteur, await lireCorps());
    if (n === 2 && m === 'PATCH') return rs.modifierSalon(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return rs.supprimerSalon(acteur, b);
    if (n === 3 && c === 'test' && m === 'POST') {
      await limite('rs_test', acteur.compte);
      return rs.testerSalon(acteur, b);
    }
  }
  if (a === 'annonces' && n === 1 && m === 'GET') return rs.annonces(acteur);
  if (a === 'publications') {
    if (n === 1 && m === 'GET') return rs.publications(acteur, filtres());
    if (n === 1 && m === 'POST') return rs.creerPublication(acteur, await lireCorps());
    if (n === 2 && m === 'GET') return rs.publication(acteur, b);
    if (n === 2 && m === 'PATCH') return rs.modifierPublication(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return rs.supprimerPublication(acteur, b);
    if (n === 3 && c === 'releves' && m === 'POST') return rs.releverPost(acteur, b, await lireCorps());
  }
  if (a === 'tableau-de-bord' && n === 1 && m === 'GET') return rs.tableauDeBord(acteur, filtres());
  if (a === 'import' && m === 'POST' && (n === 1 || (n === 2 && b === 'apercu'))) {
    await rs.droits(acteur);
    const corps = await lireCorps(1024 * 1024 + 64 * 1024);
    await limite('rs_import', acteur.compte);
    return n === 2 ? rs.apercuImport(acteur, corps) : rs.importer(acteur, corps);
  }
  if (a === 'export' && n === 2 && m === 'GET' && (b === 'posts.csv' || b === 'comptes.csv')) {
    await rs.droits(acteur);
    await limite('export', acteur.compte);
    return reponseFichier(await rs.exporter(acteur, b === 'posts.csv' ? 'posts' : 'comptes'), url);
  }
  if (a === 'reglages' && n === 1 && m === 'PUT') return rs.changerReglages(acteur, await lireCorps());
  throw echec(404, 'route', 'Adresse inconnue.');
}
