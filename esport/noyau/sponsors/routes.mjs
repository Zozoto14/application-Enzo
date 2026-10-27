/**
 * Routes HTTP de la rubrique Sponsors (branchées par api.mjs, après l'authentification). Les droits sont
 * contrôlés dans le service (commun.mjs : 404 sans sponsors.voir, 403 sans sponsors.gerer pour écrire).
 *
 *   GET               /sponsors/moi ; /sponsors/comptes ; /sponsors/mentionnables (aussi cm.editer)
 *   GET|POST          /sponsors/etapes ; PATCH /sponsors/etapes/:id
 *   GET               /sponsors/pipeline?q&responsable&priorite&team
 *   POST              /sponsors/prospects ; GET|PATCH|DELETE /sponsors/prospects/:id
 *   POST              /sponsors/prospects/:id/(deplacer|convertir)
 *   POST              /sponsors/contacts ; PATCH|DELETE /sponsors/contacts/:id
 *   POST              /sponsors/echanges ; DELETE /sponsors/echanges/:id
 *   POST              /sponsors/pieces ; DELETE /sponsors/pieces/:id ; POST /sponsors/pieces/:id/lien
 *   GET|POST          /sponsors/partenaires ; GET|PATCH|DELETE /sponsors/partenaires/:id
 *   POST              /sponsors/partenaires/:id/(contrats|obligations)
 *   PATCH|DELETE      /sponsors/contrats/:id ; /sponsors/obligations/:id ; PUT /sponsors/obligations/:id/suivi
 *   GET               /sponsors/tableau-de-bord?annee
 *   POST              /sponsors/import/apercu ; /sponsors/import
 *   GET               /sponsors/export/(prospects|partenaires).csv   (?format=json : enveloppe)
 *   POST              /sponsors/rgpd/(export|effacer) { email }
 *   GET               /sponsors/journal?avant
 *
 * Fichiers : envoi par morceaux de la section CM, portée « sponsors » (`/cm/portees/sponsors/envois…`), puis
 * `POST /sponsors/pieces { genre: 'fichier', envoi }` ; lecture par lien signé (`/cm/fichiers/:id`).
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

const prefixeDe = url => `${url.origin}${url.pathname.startsWith('/api/esport') ? '/api/esport' : ''}`;

export async function routesSponsors({ sp, acteur, chemin, methode: m, url, lireCorps, limite }) {
  if (chemin !== '/sponsors' && !chemin.startsWith('/sponsors/')) return undefined;
  const p = chemin.split('/').slice(2).map(segment);
  const n = p.length;
  const q = url.searchParams;
  const [a, b, c] = p;

  if (n === 1 && a === 'moi' && m === 'GET') return sp.moi(acteur);
  if (n === 1 && a === 'comptes' && m === 'GET') return sp.comptes(acteur);
  if (n === 1 && a === 'mentionnables' && m === 'GET') return sp.mentionnables(acteur);
  if (n === 1 && a === 'pipeline' && m === 'GET') return sp.pipeline(acteur, { q: q.get('q') || undefined, responsable: q.get('responsable') || undefined, priorite: q.get('priorite') || undefined, team: q.get('team') || undefined });
  if (n === 1 && a === 'tableau-de-bord' && m === 'GET') return sp.tableauDeBord(acteur, { annee: q.get('annee') || undefined });
  if (n === 1 && a === 'journal' && m === 'GET') return sp.journal(acteur, { avant: q.get('avant') || undefined });

  if (a === 'etapes') {
    if (n === 1 && m === 'GET') return sp.etapes(acteur);
    if (n === 1 && m === 'POST') return sp.creerEtape(acteur, await lireCorps());
    if (n === 2 && m === 'PATCH') return sp.modifierEtape(acteur, b, await lireCorps());
  }
  if (a === 'prospects') {
    if (n === 1 && m === 'POST') return sp.creerProspect(acteur, await lireCorps());
    if (n === 2 && m === 'GET') return sp.prospect(acteur, b);
    if (n === 2 && m === 'PATCH') return sp.modifierProspect(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerProspect(acteur, b);
    if (n === 3 && c === 'deplacer' && m === 'POST') return sp.deplacerProspect(acteur, b, await lireCorps());
    if (n === 3 && c === 'convertir' && m === 'POST') return sp.convertir(acteur, b, await lireCorps());
  }
  if (a === 'contacts') {
    if (n === 1 && m === 'POST') return sp.ajouterContact(acteur, await lireCorps());
    if (n === 2 && m === 'PATCH') return sp.modifierContact(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerContact(acteur, b);
  }
  if (a === 'echanges') {
    if (n === 1 && m === 'POST') return sp.ajouterEchange(acteur, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerEchange(acteur, b);
  }
  if (a === 'pieces') {
    if (n === 1 && m === 'POST') return sp.ajouterPiece(acteur, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerPiece(acteur, b);
    if (n === 3 && c === 'lien' && m === 'POST') {
      const { chemin: lien, expire } = await sp.lienPiece(acteur, b, await lireCorps());
      return { url: `${prefixeDe(url)}${lien}`, expire: new Date(expire).toISOString() };
    }
  }
  if (a === 'partenaires') {
    if (n === 1 && m === 'GET') return sp.partenaires(acteur, { statut: q.get('statut') || undefined });
    if (n === 1 && m === 'POST') return sp.creerPartenaire(acteur, await lireCorps());
    if (n === 2 && m === 'GET') return sp.partenaire(acteur, b);
    if (n === 2 && m === 'PATCH') return sp.modifierPartenaire(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerPartenaire(acteur, b);
    if (n === 3 && c === 'contrats' && m === 'POST') return sp.creerContrat(acteur, b, await lireCorps());
    if (n === 3 && c === 'obligations' && m === 'POST') return sp.creerObligation(acteur, b, await lireCorps());
  }
  if (a === 'contrats' && n === 2) {
    if (m === 'PATCH') return sp.modifierContrat(acteur, b, await lireCorps());
    if (m === 'DELETE') return sp.supprimerContrat(acteur, b);
  }
  if (a === 'obligations') {
    if (n === 2 && m === 'PATCH') return sp.modifierObligation(acteur, b, await lireCorps());
    if (n === 2 && m === 'DELETE') return sp.supprimerObligation(acteur, b);
    if (n === 3 && c === 'suivi' && m === 'PUT') return sp.suivre(acteur, b, await lireCorps());
  }
  if (a === 'import' && m === 'POST' && (n === 1 || (n === 2 && b === 'apercu'))) {
    await sp.exigerGerer(acteur);
    const corps = await lireCorps(1024 * 1024 + 64 * 1024);
    await limite('sp_import', acteur.compte);
    return n === 2 ? sp.apercuImport(acteur, corps) : sp.importer(acteur, corps);
  }
  if (a === 'export' && n === 2 && m === 'GET' && (b === 'prospects.csv' || b === 'partenaires.csv')) {
    await sp.exigerGerer(acteur);
    await limite('export', acteur.compte);
    return reponseFichier(b === 'prospects.csv' ? await sp.exporterProspects(acteur) : await sp.exporterPartenaires(acteur), url);
  }
  if (a === 'rgpd' && n === 2 && m === 'POST' && (b === 'export' || b === 'effacer')) {
    await sp.exigerGerer(acteur);
    const corps = await lireCorps();
    await limite('export', acteur.compte);
    return b === 'export' ? sp.rgpdExport(acteur, corps) : sp.rgpdEffacer(acteur, corps);
  }
  throw echec(404, 'route', 'Adresse inconnue.');
}
