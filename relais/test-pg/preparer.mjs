/**
 * Fait passer TOUTE la suite du relais (relais/*.test.mjs) par le serveur Node (relais/serveur/app.mjs,
 * pont HTTP réel sur un port local) et la boîte PostgreSQL (relais_kv), sans réécrire les tests :
 * chargé par `node --import` (voir lancer.mjs, `npm run relais:tester:pg`).
 *
 * Chaque appel `relais.traiter(requete, env)` d'un test devient une vraie requête HTTP vers le serveur
 * Node ; l'environnement du test (JETON, webhook Discord, origines…) lui est passé en mémoire (même
 * processus) et sa boîte est remplacée par la boîte PostgreSQL. Les tests qui inspectent leur boîte
 * en mémoire (`env.BOITE.donnees`) continuent de marcher : son contenu est recopié dans PostgreSQL avant
 * chaque requête et relu après (miroir).
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { after } from 'node:test';
import { relais } from '../relais.mjs';
import { basePostgres } from '../../esport/adaptateurs/postgres.mjs';
import { demarrer } from '../serveur/app.mjs';
import { creerTableKv, kvPostgres, TABLE_KV } from '../serveur/kv-postgres.mjs';
import { coffresPostgres, creerTablesCoffres } from '../serveur/coffres-postgres.mjs';

const URL_PG = process.env.RELAIS_TEST_PG || process.env.ESPORT_TEST_PG;
if (!URL_PG) throw new Error('RELAIS_TEST_PG (ou ESPORT_TEST_PG) attendu : adresse postgres://… d’une base de test.');

const schema = `t_${randomBytes(8).toString('hex')}`;
const admin = await basePostgres({ connexion: URL_PG, max: 1 });
await admin.script(`CREATE SCHEMA ${schema}`);
await admin.fermer();
const base = await basePostgres({ connexion: URL_PG, schema, max: 4 });
await creerTableKv(base);
await creerTablesCoffres(base);
const kvPg = kvPostgres(base);
const kvPgSansListe = { get: kvPg.get, put: kvPg.put, delete: kvPg.delete, getWithMetadata: kvPg.getWithMetadata };

const environnements = new Map();
// Coffre serveur (version 9) : chaque magasin mémoire d'un test devient un magasin PostgreSQL à lui.
const coffresPg = new WeakMap();
const coffresDe = memoire => {
  if (!coffresPg.has(memoire)) coffresPg.set(memoire, coffresPostgres(base, { espace: randomBytes(6).toString('hex') }));
  return coffresPg.get(memoire);
};
// Le vrai serveur de l'app (relais/serveur/app.mjs : préparation, pont HTTP, en-têtes), sur un port local.
const s = await demarrer({ port: 0, hote: '127.0.0.1', base, envPour: requete => environnements.get(requete.headers.get('x-test-env')) });
s.serveur.unref();
const adresse = s.url;

const metas = new WeakMap();
let file = Promise.resolve();
const exclusif = tache => {
  const suite = file.then(tache, tache);
  file = suite.catch(() => {});
  return suite;
};

async function versPg(boite) {
  await base.executer(`DELETE FROM ${TABLE_KV}`, []);
  // Métadonnées : celles que le double expose (`metas`), sinon celles relues de PostgreSQL au tour précédent.
  const m = boite.metas instanceof Map ? boite.metas : (metas.get(boite) ?? new Map());
  for (const [cle, valeur] of boite.donnees) await kvPg.put(cle, valeur, m.has(cle) ? { metadata: m.get(cle) } : {});
}
async function depuisPg(boite) {
  const m = new Map();
  boite.donnees.clear();
  for (const l of await base.tous(`SELECT cle, valeur, meta FROM ${TABLE_KV} WHERE expire_le IS NULL OR expire_le > ?`, [Date.now()])) {
    // Par le `put` du double quand il range des métadonnées à part (sa propre liste les rend alors) ; sinon directement.
    if (l.meta && typeof boite.put === 'function') await boite.put(l.cle, l.valeur, { metadata: JSON.parse(l.meta) });
    else boite.donnees.set(l.cle, l.valeur);
    if (l.meta) m.set(l.cle, JSON.parse(l.meta));
  }
  metas.set(boite, m);
}

/** Requête HTTP réelle (node:http : les tests remplacent parfois globalThis.fetch). */
function envoyer(requete, corps, id) {
  const u = new URL(requete.url);
  const cible = new URL(adresse);
  const entetes = {};
  requete.headers.forEach((v, k) => {
    entetes[k] = v;
  });
  // L'IP du test (X-Adresse-Client) devient la dernière entrée de X-Forwarded-For, comme derrière le proxy d'o2switch.
  const ip = requete.headers.get('X-Adresse-Client');
  delete entetes['x-adresse-client'];
  const xff = [requete.headers.get('X-Forwarded-For'), ip].filter(Boolean).join(', ');
  if (xff) entetes['x-forwarded-for'] = xff;
  entetes['x-test-env'] = id;
  if (corps) entetes['content-length'] = String(corps.length);
  return new Promise((ok, ko) => {
    const r = http.request({ host: cible.hostname, port: cible.port, method: requete.method, path: `${u.pathname}${u.search}`, headers: entetes }, res => {
      const morceaux = [];
      res.on('data', m => morceaux.push(m));
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        const vide = [101, 204, 205, 304].includes(res.statusCode) || requete.method === 'HEAD';
        ok(new Response(vide ? null : Buffer.concat(morceaux), { status: res.statusCode, statusText: res.statusMessage, headers: h }));
      });
      res.on('error', ko);
    });
    r.on('error', ko);
    r.end(corps);
  });
}

relais.traiter = (requete, env, _ctx) =>
  exclusif(async () => {
    const id = randomBytes(6).toString('hex');
    const boite = env?.BOITE;
    const miroir = boite && boite.donnees instanceof Map;
    if (miroir) await versPg(boite);
    let envServeur = miroir ? { ...env, BOITE: typeof boite.list === 'function' ? kvPg : kvPgSansListe } : env;
    if (env?.COFFRES?.memoire) envServeur = { ...envServeur, COFFRES: coffresDe(env.COFFRES) };
    environnements.set(id, envServeur);
    try {
      const corps = ['GET', 'HEAD'].includes(requete.method) ? undefined : Buffer.from(await requete.arrayBuffer());
      return await envoyer(requete, corps, id);
    } finally {
      environnements.delete(id);
      if (miroir) await depuisPg(boite);
    }
  });

after(async () => {
  await s.fermer();
  await base.fermer();
});
