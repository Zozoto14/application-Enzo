/**
 * Import AUTOMATIQUE des agents de Valorant (portraits, icônes des capacités) : sans clic du Fondateur, au premier
 * affichage du profil par l'éditeur de strats (`GET /teams/:id/jeu`, en tâche de fond, la réponse n'attend pas,
 * un seul import pour des requêtes simultanées) et par le cron Esport (au plus un essai par jour et par profil,
 * réimport après 7 jours, erreur consignée et réessayée le lendemain). Un portrait déposé à la main est gardé.
 * Réponse réelle abrégée de valorant-api.com (esport/test/donnees/valorant-api-agents.json) ; faux web, aucun réseau.
 */
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { URL_AGENTS_VALORANT } from '../noyau/jeux/import.mjs';
import { IMPORT_AGENTS_ESSAI_CRON_MS, servicesJeux } from '../noyau/jeux/service.mjs';
import { executerCron } from '../serveur/cron.mjs';

const AGENTS = JSON.parse(readFileSync(new URL('./donnees/valorant-api-agents.json', import.meta.url), 'utf8')).data;
const JOUR = 86_400_000;

function png(l = 128, h = 128, graine = 0) {
  const o = new Uint8Array(64);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(o.buffer).setUint32(16, l);
  new DataView(o.buffer).setUint32(20, h);
  o[40] = graine % 251;
  return o;
}

/** Faux web : liste des agents (peut être retenue par `retenir`), une image PNG distincte par adresse du CDN. */
function fauxWeb({ panne = false } = {}) {
  const demandes = [];
  let liberer;
  const etat = { retenue: null };
  const fetchImport = async url => {
    demandes.push(url);
    if (panne) throw new TypeError('réseau coupé');
    if (url === URL_AGENTS_VALORANT) {
      if (etat.retenue) await etat.retenue;
      return new Response(JSON.stringify({ status: 200, data: AGENTS }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://media.valorant-api.com/')) return new Response(png(128, 128, url.length + url.charCodeAt(url.length - 15)), { headers: { 'content-type': 'image/png' } });
    return new Response('introuvable', { status: 404 });
  };
  return {
    fetchImport,
    demandes,
    listes: () => demandes.filter(u => u === URL_AGENTS_VALORANT).length,
    retenir() {
      etat.retenue = new Promise(ok => (liberer = ok));
    },
    liberer: () => liberer?.(),
    couper: v => (panne = v),
  };
}

const jeuxDu = (b, web, extra = {}) => servicesJeux({ base: b.base, stockage: b.stockage, cleSession: CLE, fetchImport: web.fetchImport, maintenant: () => b.horloge.t, socle: {}, journal: { warn: () => undefined, error: () => undefined }, ...extra });
const profil = async b => JSON.parse((await b.base.premier("SELECT donnees FROM jeux WHERE cle = 'valorant'", [])).donnees);
const etat = async b => b.base.premier("SELECT valeur, maj_le FROM ia_reglages WHERE cle = 'agents-auto:valorant'", []);

async function attendre(condition, essais = 400) {
  for (let i = 0; i < essais; i++) {
    if (await condition()) return;
    await new Promise(ok => setTimeout(ok, 10));
  }
  throw new Error('délai dépassé');
}

test('premier affichage par l’éditeur : import en tâche de fond (réponse immédiate), un seul pour des requêtes simultanées', async () => {
  const web = fauxWeb();
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const team = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  web.retenir();
  // La liste des agents est retenue : si la réponse attendait l'import, ces requêtes ne reviendraient pas.
  const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 })));
  for (const r of [r1, r2, r3]) assert.equal(r.statut, 200);
  assert.equal(r1.corps.importAgents, 'en-cours', 'le client sait qu’un import est en cours');
  assert.ok(r1.corps.donnees.personnages.every(p => !p.source), 'rien d’importé encore');
  await attendre(() => web.listes() === 1);
  web.liberer();
  await attendre(async () => JSON.parse((await etat(b))?.valeur ?? '{}').reussi);
  assert.equal(web.listes(), 1, 'single-flight : une seule liste téléchargée');
  const d = await profil(b);
  const viper = d.personnages.find(p => p.cle === 'viper');
  assert.ok(viper.fichier && viper.source?.url.startsWith('https://media.valorant-api.com/'), 'portrait importé, adresse du CDN gardée');
  // Version écrite sans auteur (automatique).
  const v = await b.base.premier("SELECT motif, auteur_id FROM jeu_versions WHERE jeu_cle = 'valorant' ORDER BY version DESC LIMIT 1", []);
  assert.deepEqual({ motif: v.motif, auteur: v.auteur_id }, { motif: 'import-agents-auto', auteur: null });
  // Ensuite : portraits servis par lien signé, plus aucun import déclenché à l'affichage.
  const apres = await b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 });
  assert.equal(apres.corps.importAgents, undefined);
  assert.equal((await b.brut(apres.corps.images[viper.fichier].url)).status, 200);
  assert.equal(web.listes(), 1);
});

test('premier affichage : échec réseau consigné, pas de nouvel essai avant une heure ; jamais pour un profil d’un autre modèle', async () => {
  const web = fauxWeb({ panne: true });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const team = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  assert.equal((await b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 })).statut, 200);
  await attendre(async () => JSON.parse((await etat(b))?.valeur ?? '{}').erreur);
  assert.equal(JSON.parse((await etat(b)).valeur).erreur, 'import-reseau');
  const n = web.demandes.length;
  await b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 });
  b.horloge.t += 30 * 60_000;
  await b.appel(`/teams/${team.teamId}/jeu`, { jeton: team.sessions.lea12345 });
  await new Promise(ok => setTimeout(ok, 30));
  assert.equal(web.demandes.length, n, 'moins d’une heure après : pas de nouvel essai');
  web.couper(false);
  b.horloge.t += 31 * 60_000;
  // Sessions d'une heure : une nouvelle.
  assert.equal((await b.appel(`/teams/${team.teamId}/jeu`, { jeton: await b.session('lea12345') })).statut, 200);
  await attendre(async () => JSON.parse((await etat(b))?.valeur ?? '{}').reussi);
  // Team d'un autre jeu (modèle générique) : aucun import.
  const autre = await teamAvecMembres(b, { nom: 'Team Bravo', jeu: 'autre', preset: undefined });
  const listes = web.listes();
  await b.appel(`/teams/${autre.teamId}/jeu`, { jeton: autre.sessions.fondateur });
  await new Promise(ok => setTimeout(ok, 30));
  assert.equal(web.listes(), listes);
});

test('cron : profil sans portrait importé → import ; au plus un essai par jour ; réimport après 7 jours ; portrait déposé à la main gardé', async () => {
  const web = fauxWeb();
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const f = await b.session('principal', 'Fondateur');
  // Portrait de Viper déposé à la main (sans source) : jamais remplacé par l'import automatique.
  const depot = await b.appel('/jeux/valorant/images', { methode: 'POST', jeton: f, corps: { type: 'image/png', donnees: Buffer.from(png(256, 256, 7)).toString('base64'), nom: 'viper-maison.png' } });
  assert.equal(depot.statut, 200, JSON.stringify(depot.corps));
  const avant = (await b.appel('/jeux/valorant', { jeton: f })).corps;
  const d0 = structuredClone(avant.donnees);
  d0.personnages.find(p => p.cle === 'viper').fichier = depot.corps.id;
  assert.equal((await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: avant.version, donnees: d0 } })).statut, 200);

  const jeux = jeuxDu(b, web);
  let r = await jeux.importsAgentsAuto();
  assert.deepEqual(r.profils, [{ jeu: 'valorant', statut: 'importe' }]);
  let d = await profil(b);
  const viper = d.personnages.find(p => p.cle === 'viper');
  assert.equal(viper.fichier, depot.corps.id, 'portrait déposé à la main gardé');
  assert.equal(viper.source, undefined);
  assert.ok(viper.officielles?.length === 4, 'icônes des capacités importées quand même');
  assert.ok(d.personnages.find(p => p.cle === 'neon').source, 'les autres portraits importés');
  const listes = web.listes();
  // Même jour, puis le lendemain (import frais de moins de 7 jours) : rien.
  assert.deepEqual((await jeux.importsAgentsAuto()).profils, []);
  b.horloge.t += JOUR + 1;
  assert.deepEqual((await jeux.importsAgentsAuto()).profils, []);
  assert.equal(web.listes(), listes);
  // Après 7 jours : réimport (nouveaux agents), toujours sans toucher au portrait déposé à la main.
  b.horloge.t += 7 * JOUR;
  r = await jeux.importsAgentsAuto();
  assert.deepEqual(r.profils, [{ jeu: 'valorant', statut: 'importe' }]);
  assert.equal(web.listes(), listes + 1);
  d = await profil(b);
  assert.equal(d.personnages.find(p => p.cle === 'viper').fichier, depot.corps.id);
  // Le bouton manuel reste : il marche toujours, et compte comme dernier import.
  const manuel = await b.appel('/jeux/valorant/importer-agents', { methode: 'POST', jeton: await b.session('principal'), corps: {} });
  assert.equal(manuel.statut, 200, JSON.stringify(manuel.corps));
  assert.equal(manuel.corps.jeu.donnees.personnages.find(p => p.cle === 'viper').fichier, depot.corps.id, 'règle du bouton : portrait à la main gardé');
});

test('cron : échec consigné, réessayé le lendemain (pas avant) ; sans stockage : rien ; deux processus : un seul import', async () => {
  const web = fauxWeb({ panne: true });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const jeux = jeuxDu(b, web);
  let r = await jeux.importsAgentsAuto();
  assert.deepEqual(r.profils, [{ jeu: 'valorant', statut: 'echec', erreur: 'import-reseau' }]);
  assert.equal(r.echecs, 1);
  const n = web.demandes.length;
  b.horloge.t += IMPORT_AGENTS_ESSAI_CRON_MS - 60_000;
  assert.deepEqual((await jeux.importsAgentsAuto()).profils, [], 'moins d’un jour après : pas de nouvel essai');
  assert.equal(web.demandes.length, n);
  web.couper(false);
  b.horloge.t += 120_000;
  assert.deepEqual((await jeux.importsAgentsAuto()).profils, [{ jeu: 'valorant', statut: 'importe' }]);
  assert.deepEqual(await jeuxDu(b, web, { stockage: undefined }).importsAgentsAuto(), { n: 0, echecs: 0, raison: 'stockage-absent', profils: [] });

  // Deux processus (app et cron) sur la même base : l'essai est réservé par une écriture conditionnelle.
  const b2 = await banc({ fetchImportJeux: web.fetchImport });
  web.retenir();
  const avant = web.listes();
  const lot = Promise.all([jeuxDu(b2, web).importsAgentsAuto(), jeuxDu(b2, web).importsAgentsAuto()]);
  await attendre(() => web.listes() === avant + 1);
  await new Promise(ok => setTimeout(ok, 30));
  web.liberer();
  const statuts = (await lot).flatMap(x => x.profils.map(p => p.statut)).sort();
  assert.ok(['deja-essaye,importe', 'importe'].includes(statuts.join()), statuts.join());
  assert.equal(web.listes(), avant + 1, 'un seul import');
});

test('cron du serveur : tâche « portraits des agents » dans le rapport, une erreur ne bloque pas les autres tâches', async () => {
  const web = fauxWeb({ panne: true });
  const b = await banc({ fetchImportJeux: web.fetchImport });
  const rapport = await executerCron(b.base, { cleSession: CLE, lienApp: '', discordBot: {} }, { maintenant: () => b.horloge.t, stockage: b.stockage, fetchImportJeux: web.fetchImport, lancer: async () => ({ n: 0 }) });
  const tache = rapport.find(x => x.tache === 'portraits des agents');
  assert.equal(tache.ok, true);
  assert.match(tache.etat, /valorant \(import-reseau\)/);
  assert.ok(rapport.some(x => x.tache === 'devblog automatique'), 'les tâches suivantes passent');
});

test('page publique : pion et capacité posés sans icône reprennent l’adresse du CDN gardée dans le profil (jamais un lien signé)', async () => {
  const { completerIcones, svgEtape } = await import('../noyau/strats/svg.mjs');
  const { documentVide, validerDocument } = await import('../noyau/strats/document.mjs');
  const doc = documentVide({ carte: { cle: 'ascent', nom: 'Ascent', image: null }, modele: 'valorant' });
  doc.etapes[0].objets.push(
    { id: 'a1', type: 'agent', x: 100, y: 100, agent: 'viper', nom: 'Viper', icone: null, joueur: 0, couleur: '#22c55e' },
    { id: 'a2', type: 'agent', x: 200, y: 100, agent: 'neon', nom: 'Neon', icone: null, joueur: 1, couleur: '#3b82f6' },
    { id: 'c1', type: 'capacite', x: 300, y: 300, agent: 'viper', capacite: 'Ability2', nom: 'Toxic Screen', icone: null, joueur: 0, couleur: '#22c55e' },
  );
  const v = validerDocument(doc);
  const cdn = 'https://media.valorant-api.com/agents/v/displayicon.png';
  const donnees = {
    personnages: [
      { cle: 'viper', fichier: 'f1', source: { url: cdn }, officielles: [{ touche: 'E', slot: 'Ability2', nom: 'Toxic Screen', fichier: 'f2', url: 'https://media.valorant-api.com/agents/v/abilities/ability2/displayicon.png' }] },
      { cle: 'neon', fichier: 'f3', source: { url: 'https://esport.test/jeux/images/f3?sig=x' } },
    ],
  };
  const c = completerIcones(v, donnees);
  assert.deepEqual(c.etapes[0].objets.map(o => o.icone), [cdn, null, 'https://media.valorant-api.com/agents/v/abilities/ability2/displayicon.png']);
  assert.equal(v.etapes[0].objets[0].icone, null, 'document d’origine intact');
  assert.match(svgEtape(c, 0), /<image href="https:\/\/media\.valorant-api\.com\/agents\/v\/displayicon\.png"/);
  assert.equal(completerIcones(v, null), v);
});
