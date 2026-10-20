/**
 * Import UNIQUE des données Esport de Cloudflare (D1 + fichiers R2) dans PostgreSQL et sur le disque,
 * lancé depuis le terminal cPanel. Méthode : le serveur o2switch TIRE lui-même les données du Worker
 * Cloudflare par ses routes d'administration (export JSON `GET /admin/export`, puis chaque fichier par
 * `GET /admin/fichier?cle=…`), avec une session du Fondateur ouverte par le jeton maître. Rien ne passe
 * par GitHub, aucun fichier d'export ne traîne.
 *
 *   ESPORT_SOURCE=https://applibourse-esport.<vous>.workers.dev node esport/serveur/importer.mjs
 *
 * Le jeton maître est lu dans ~/.appdashboard/relais.env (JETON) — jamais en argument. Étapes :
 *  1. migrations PostgreSQL (idempotentes) ;
 *  2. export de la base du Worker, import dans une base VIDE (refus sinon : l'import ne fusionne jamais) ;
 *  3. vérification : nombre de lignes de chaque table, export contre PostgreSQL ;
 *  4. copie des fichiers (PDF, miniatures) dans FICHIERS_DIR ; un fichier déjà copié est sauté.
 * `--fichiers-seulement` : refait seulement l'étape 4 (reprise après coupure).
 * Variante hors ligne : `--entree esport-export.json` (export fait par esport/outils/transfert.mjs).
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basePostgres, optionsDepuisEnv } from '../adaptateurs/postgres.mjs';
import { stockageDisque } from '../adaptateurs/stockage.mjs';
import { TABLES, baseVide, importerBase } from '../noyau/transfert.mjs';
import { chargerConfigRelais } from '../../relais/serveur/app.mjs';
import { chargerConfigEsport } from './config.mjs';
import { migrer } from './migrer.mjs';

async function ouvrirSession(source, jeton, requete) {
  const r = await requete(`${source}/session`, { method: 'POST', headers: { Authorization: `Bearer ${jeton}` } });
  const corps = await r.json().catch(() => ({}));
  if (!r.ok || !corps.superAdmin) throw new Error(`Session refusée par ${source} (HTTP ${r.status}) : ${corps.erreur ?? 'jeton maître attendu'}`);
  return corps.session;
}

/** Compare les lignes de l'export à celles de PostgreSQL ; rend les écarts. */
export async function verifierComptes(base, donnees) {
  const ecarts = [];
  const lignes = {};
  for (const [table] of TABLES) {
    const attendu = Array.isArray(donnees.tables[table]) ? donnees.tables[table].length : 0;
    const trouve = Number((await base.premier(`SELECT COUNT(*) AS n FROM ${table}`, [])).n);
    lignes[table] = trouve;
    // types_reunion : les types globaux posés par la migration sont remplacés par ceux de l'export (s'il en a).
    if (trouve !== attendu && !(table === 'types_reunion' && attendu === 0)) ecarts.push(`${table} : ${attendu} exportées, ${trouve} en base`);
  }
  return { ecarts, lignes };
}

/** Copie les fichiers référencés par la table `fichiers` ; rend { copies, deja, absents }. */
export async function copierFichiers(base, stockage, lireDistant) {
  const bilan = { copies: 0, deja: 0, absents: [] };
  for (const f of await base.tous('SELECT cle_stockage, type_mime FROM fichiers ORDER BY cree_le', [])) {
    if (await stockage.lire(f.cle_stockage)) {
      bilan.deja++;
      continue;
    }
    const objet = await lireDistant(f.cle_stockage);
    if (!objet) {
      bilan.absents.push(f.cle_stockage);
      continue;
    }
    await stockage.deposer(f.cle_stockage, objet.octets, { type: objet.type || f.type_mime });
    bilan.copies++;
  }
  return bilan;
}

export async function principal(args, env = process.env, { fetch: requete = globalThis.fetch, journal = console } = {}) {
  const option = nom => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = chargerConfigEsport(env);
  const jeton = chargerConfigRelais(env).JETON;
  const source = (env.ESPORT_SOURCE || option('--source') || '').replace(/\/+$/, '');
  const entree = option('--entree');
  const fichiersSeulement = args.includes('--fichiers-seulement');
  if (!entree && !source) throw new Error('ESPORT_SOURCE absente : adresse de l’ancien serveur Esport (https://applibourse-esport.<vous>.workers.dev).');
  if (source && !jeton) throw new Error('JETON absent de ~/.appdashboard/relais.env (jeton maître : il ouvre la session du Fondateur sur l’ancien serveur).');

  const base = await basePostgres({ ...optionsDepuisEnv(env), max: 2 });
  try {
    const appliquees = await migrer(base);
    if (appliquees.length) journal.log(`Migrations appliquées : ${appliquees.join(', ')}`);
    const session = source ? await ouvrirSession(source, jeton, requete) : undefined;
    let donnees;
    if (!fichiersSeulement) {
      if (!(await baseVide(base))) throw new Error('La base PostgreSQL contient déjà des données Esport : import refusé (il ne fusionne jamais). Pour reprendre seulement les fichiers : --fichiers-seulement.');
      if (entree) donnees = JSON.parse(readFileSync(entree, 'utf8'));
      else {
        const r = await requete(`${source}/admin/export`, { headers: { Authorization: `Bearer ${session}` } });
        donnees = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Export refusé (HTTP ${r.status}) : ${donnees.erreur ?? ''}`);
      }
      const bilan = await importerBase(base, donnees);
      journal.log(`Import : ${Object.entries(bilan).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ') || 'base vide'}`);
      const { ecarts } = await verifierComptes(base, donnees);
      if (ecarts.length) throw new Error(`Comptes de lignes différents : ${ecarts.join(' ; ')}`);
      journal.log(`Vérification : ${TABLES.length} tables, mêmes nombres de lignes que l’export.`);
    }
    if (!session) {
      journal.log('Fichiers : pas de serveur source (--entree) ; copiez le dossier des fichiers à la main si besoin.');
      return { ok: true };
    }
    const stockage = await stockageDisque(config.dossierFichiers);
    const lireDistant = async cle => {
      const r = await requete(`${source}/admin/fichier?cle=${encodeURIComponent(cle)}`, { headers: { Authorization: `Bearer ${session}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Fichier ${cle} : HTTP ${r.status} (Worker Esport à redéployer ? route /admin/fichier)`);
      return { octets: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('X-Type-Fichier') ?? undefined };
    };
    const f = await copierFichiers(base, stockage, lireDistant);
    journal.log(`Fichiers : ${f.copies} copiés, ${f.deja} déjà présents, ${f.absents.length} introuvables sur Cloudflare${f.absents.length ? ` (${f.absents.slice(0, 5).join(', ')})` : ''} → ${config.dossierFichiers}`);
    return { ok: true, fichiers: f };
  } finally {
    await base.fermer();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal(process.argv.slice(2)).catch(e => {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  });
}
