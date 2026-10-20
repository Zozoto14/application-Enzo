/**
 * Import de la boîte du relais Cloudflare (KV `BOITE`) dans PostgreSQL (table relais_kv), lancé depuis
 * le terminal cPanel. Le serveur o2switch TIRE lui-même les données du Worker par la route protégée
 * `GET /admin/boite` (relais version 8, jeton maître) : rien ne transite par GitHub ni par un fichier.
 *
 *   RELAIS_SOURCE=https://applibourse-relais.<vous>.workers.dev node relais/serveur/importer.mjs
 *
 * Le jeton maître est lu dans ~/.appdashboard/relais.env (JETON), jamais en argument. Rejouable sans
 * danger : chaque clé est écrite ou remplacée (dernière version), rien n'est effacé. Vérifie à la fin
 * que chaque clé exportée est bien présente dans PostgreSQL.
 * Variante hors ligne : `--entree boite.json` (fichier { cles: [...] }), `--sortie boite.json` pour garder
 * une copie (à effacer ensuite : les enveloppes sont chiffrées, mais l'index et les invitations aussi sensibles).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basePostgres } from '../../esport/adaptateurs/postgres.mjs';
import { chargerConfigRelais } from './app.mjs';
import { creerTableKv, kvPostgres, TABLE_KV } from './kv-postgres.mjs';

export async function lireBoiteDistante(source, jeton, { fetch: requete = globalThis.fetch } = {}) {
  const cles = [];
  let suite = null;
  do {
    const url = `${source.replace(/\/+$/, '')}/admin/boite${suite ? `?curseur=${encodeURIComponent(suite)}` : ''}`;
    const r = await requete(url, { headers: { Authorization: `Bearer ${jeton}` } });
    const corps = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Export refusé par ${source} (HTTP ${r.status}) : ${corps.erreur ?? 'relais en version 8 attendu (workflow « Relais »)'}`);
    cles.push(...(corps.cles ?? []));
    suite = corps.suite ?? null;
  } while (suite);
  return cles;
}

/** Écrit les clés dans la boîte PostgreSQL ; rend { ecrites, expirees, manquantes }. */
export async function importerBoite(base, cles, { maintenant = Date.now() } = {}) {
  await creerTableKv(base);
  const kv = kvPostgres(base, { maintenant: () => maintenant });
  let ecrites = 0;
  let expirees = 0;
  for (const c of cles) {
    if (typeof c?.nom !== 'string' || typeof c.valeur !== 'string') throw new Error('Export illisible (clé sans nom ou sans valeur).');
    if (c.expiration && c.expiration * 1000 <= maintenant) {
      expirees++;
      continue;
    }
    await kv.put(c.nom, c.valeur, { ...(c.metadata ? { metadata: c.metadata } : {}), ...(c.expiration ? { expiration: c.expiration } : {}) });
    ecrites++;
  }
  // Vérification : chaque clé écrite est relue, à l'identique.
  const manquantes = [];
  for (const c of cles) {
    if (c.expiration && c.expiration * 1000 <= maintenant) continue;
    const l = await base.premier(`SELECT valeur FROM ${TABLE_KV} WHERE cle = ?`, [c.nom]);
    if (!l || l.valeur !== c.valeur) manquantes.push(c.nom);
  }
  return { ecrites, expirees, manquantes };
}

export async function principal(args, env = process.env) {
  const option = nom => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const config = chargerConfigRelais(env);
  let cles;
  const entree = option('--entree');
  if (entree) {
    cles = JSON.parse(readFileSync(entree, 'utf8')).cles;
  } else {
    const source = env.RELAIS_SOURCE || option('--source');
    if (!source) throw new Error('RELAIS_SOURCE absente : adresse de l’ancien relais Cloudflare (https://applibourse-relais.<vous>.workers.dev).');
    if (!config.JETON) throw new Error('JETON absent de ~/.appdashboard/relais.env (le jeton maître du relais).');
    cles = await lireBoiteDistante(source, config.JETON);
  }
  const sortie = option('--sortie');
  if (sortie) writeFileSync(sortie, JSON.stringify({ cles }), { mode: 0o600 });
  const base = await basePostgres({ max: 2 });
  try {
    const bilan = await importerBoite(base, cles);
    const total = Number((await base.premier(`SELECT COUNT(*) AS n FROM ${TABLE_KV}`, [])).n);
    console.log(`Boîte du relais : ${cles.length} clés exportées, ${bilan.ecrites} écrites, ${bilan.expirees} déjà expirées (ignorées) ; ${total} clés dans PostgreSQL.`);
    if (bilan.manquantes.length) throw new Error(`${bilan.manquantes.length} clé(s) mal relue(s) : ${bilan.manquantes.slice(0, 5).join(', ')}…`);
    console.log('Vérification : toutes les clés sont relues à l’identique.');
    return bilan;
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
