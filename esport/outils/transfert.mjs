/**
 * Export et import JSON de toute la base Esport, en ligne de commande.
 *
 *  Exporter (serveur en ligne, jeton maître du Fondateur dans la variable ESPORT_JETON) :
 *    node esport/outils/transfert.mjs exporter --url https://esport.appdashboard.fr --sortie esport-export.json
 *  Exporter une base SQLite locale :
 *    node esport/outils/transfert.mjs exporter --sqlite esport/esport-local.db --sortie esport-export.json
 *  Importer dans une base SQLite neuve (vrai serveur) :
 *    node esport/outils/transfert.mjs importer --sqlite /srv/esport/esport.db --entree esport-export.json
 *  Importer dans un serveur en ligne (base vide) :
 *    node esport/outils/transfert.mjs importer --url https://… --entree esport-export.json
 *
 * Le jeton n'est jamais passé en argument (il resterait dans l'historique du
 * terminal) : variable d'environnement ESPORT_JETON seulement.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { baseSqliteMigree } from '../adaptateurs/sqlite.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';

async function session(url) {
  const jeton = process.env.ESPORT_JETON;
  if (!jeton) throw new Error('Variable ESPORT_JETON absente (jeton maître du relais, celui du Fondateur).');
  const r = await fetch(`${url}/session`, { method: 'POST', headers: { Authorization: `Bearer ${jeton}` } });
  const corps = await r.json().catch(() => ({}));
  if (!r.ok || !corps.superAdmin) throw new Error(`Session refusée (${r.status}) : ${corps.erreur ?? 'jeton maître attendu'}`);
  return corps.session;
}

export async function principal(args) {
  const [action] = args;
  const option = nom => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = option('--url')?.replace(/\/+$/, '');
  const sqlite = option('--sqlite');
  if (action === 'exporter') {
    const sortie = option('--sortie') ?? 'esport-export.json';
    let donnees;
    if (url) {
      const r = await fetch(`${url}/admin/export`, { headers: { Authorization: `Bearer ${await session(url)}` } });
      donnees = await r.json();
      if (!r.ok) throw new Error(donnees.erreur ?? `HTTP ${r.status}`);
    } else if (sqlite) {
      donnees = await exporterBase(await baseSqliteMigree(sqlite));
    } else throw new Error('--url ou --sqlite attendu.');
    writeFileSync(sortie, `${JSON.stringify(donnees, null, 1)}\n`);
    console.log(`Export écrit : ${sortie} (${Object.entries(donnees.tables).map(([t, l]) => `${t} ${l.length}`).join(', ')})`);
    return;
  }
  if (action === 'importer') {
    const entree = option('--entree') ?? 'esport-export.json';
    const donnees = JSON.parse(readFileSync(entree, 'utf8'));
    let bilan;
    if (url) {
      const r = await fetch(`${url}/admin/import`, { method: 'POST', headers: { Authorization: `Bearer ${await session(url)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(donnees) });
      const corps = await r.json();
      if (!r.ok) throw new Error(corps.erreur ?? `HTTP ${r.status}`);
      bilan = corps.lignes;
    } else if (sqlite) {
      bilan = await importerBase(await baseSqliteMigree(sqlite), donnees);
    } else throw new Error('--url ou --sqlite attendu.');
    console.log(`Import terminé : ${Object.entries(bilan).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    return;
  }
  throw new Error('Action attendue : exporter ou importer (voir l’en-tête de esport/outils/transfert.mjs).');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal(process.argv.slice(2)).catch(e => {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  });
}
