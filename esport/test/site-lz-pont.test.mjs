/**
 * Pont événement du club → tournoi du site LigneZero (site-lz/, migration 0070 ; l'app fait foi) : lien, équipes
 * envoyées au site, anciennes équipes du site reprises (TAG attribué), modifications et retraits faits dans l'app
 * répercutés, différences du site écrasées, équipe disparue du site recréée, rapprochement au premier lien, un seul événement par tournoi, cron,
 * clé du site lue sur l'hébergement. Faux site et faux Discord : jamais de réseau réel.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc } from './aide.mjs';
import { bancTickets } from './tickets-aide.mjs';
import { createHash, createHmac } from 'node:crypto';
import { adresseSure, clientSite, configSite, entetesSignes } from '../noyau/site-lz/client.mjs';
import { empreinte, joueursSite, membresApp, tagLibre } from '../noyau/site-lz/pont.mjs';
import { tachesPlanifiees } from '../noyau/cron.mjs';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '11111111-1111-4111-8111-111111111112';
const J1 = '810000000000000101';
const J2 = '810000000000000102';
const COACH = '810000000000000104';

function fauxSite() {
  const tables = {
    tournaments: [
      { id: T1, name: 'The Nuke End', status: 'registration', created_at: '2026-11-02' },
      { id: T2, name: 'Autre', status: 'draft', created_at: '2026-11-01' },
    ],
    tournament_teams: [{ id: '22222222-2222-4222-8222-000000000001', tournament_id: T1, name: 'Site Team', tag: null }],
    tournament_players: [
      { id: 'p1', team_id: '22222222-2222-4222-8222-000000000001', pseudo: 'Nova', role: null, discord_id: J2, embark_id: 'Nova#1234', sort_order: 0 },
      { id: 'p2', team_id: '22222222-2222-4222-8222-000000000001', pseudo: 'Kai', role: 'Coach', discord_id: 'pas-un-id', embark_id: null, sort_order: 1 },
    ],
  };
  let n = 0;
  const filtre = filters => r => filters.every(f => (f.op === 'in' ? f.val.includes(r[f.col]) : r[f.col] === f.val));
  return {
    tables,
    configure: true,
    lister: async (t, filters = []) => structuredClone(tables[t].filter(filtre(filters))),
    inserer: async (t, rows) => rows.map(r => (tables[t].push({ id: `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`, ...r }), structuredClone(tables[t].at(-1)))),
    modifier: async (t, id, v) => [Object.assign(tables[t].find(x => x.id === id), v)],
    supprimer: async (t, id) => {
      tables[t] = tables[t].filter(x => x.id !== id);
      if (t === 'tournament_teams') tables.tournament_players = tables.tournament_players.filter(p => p.team_id !== id);
    },
    supprimerOu: async (t, col, val) => {
      tables[t] = tables[t].filter(x => x[col] !== val);
    },
  };
}

async function monter(site = fauxSite()) {
  const k = await bancTickets({ banc, siteLz: site });
  await k.api('/tickets/config/general', undefined, { methode: 'PUT', corps: { guildId: k.GUILD, guildNom: 'Club' } });
  const e = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'The Nuke End', debut: '2026-11-21', fin: '2026-11-22' } });
  assert.equal(e.statut, 200, JSON.stringify(e.corps));
  const id = e.corps.evenement.id;
  return { ...k, site, id, chemin: `/evenements/${id}` };
}
const equipesApp = async k => (await k.api(k.chemin)).corps.equipes;
const equipesSite = k => k.site.tables.tournament_teams.filter(e => e.tournament_id === T1);
const joueursDe = (k, teamId) => k.site.tables.tournament_players.filter(p => p.team_id === teamId).sort((a, b) => a.sort_order - b.sort_order);

test('conversions app ↔ site et TAG attribué', () => {
  const membres = [
    { poste: 'coach', discordId: COACH, nom: 'Coach', embarkId: '' },
    { poste: 'joueur', discordId: J1, nom: '', embarkId: 'Nova#1234' },
    { poste: 'remplacant', discordId: null, nom: 'Sub', embarkId: '' },
  ];
  const j = joueursSite('t', membres);
  assert.deepEqual(j.map(x => [x.pseudo, x.role, x.is_captain]), [['Coach', 'Coach', false], ['Nova', null, true], ['Sub', 'Remplaçant', false]]);
  assert.deepEqual(membresApp(j.map(x => ({ ...x, pseudo: x.pseudo }))).map(m => m.poste), ['coach', 'joueur', 'remplacant']);
  assert.equal(tagLibre(null, 'Les Bombes', new Set()), 'LB');
  assert.equal(tagLibre('LB', 'x', new Set(['LB'])), 'LB2');
  assert.equal(tagLibre('Équipe-1', 'x', new Set()), 'EQUIPE');
  assert.equal(empreinte({ nom: ' A ', tag: 'a', membres: [] }), empreinte({ nom: 'A', tag: 'A', membres: [] }));
});

test('pont : lien, équipes dans les deux sens, modifications, retraits', async () => {
  const k = await monter();
  // Liste des tournois du site, puis lien.
  const v = await k.api(`${k.chemin}/site`);
  assert.equal(v.statut, 200, JSON.stringify(v.corps));
  assert.deepEqual(v.corps.tournois.map(t => t.nom), ['The Nuke End', 'Autre']);
  const lie = await k.api(`${k.chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  assert.equal(lie.statut, 200, JSON.stringify(lie.corps));
  assert.equal(lie.corps.tournoiId, T1);
  assert.equal(lie.corps.etat.recues, 1);
  // L'équipe du site est dans l'événement, avec un TAG attribué (renvoyé au site) et ses membres (Discord ID invalide écarté).
  let app = await equipesApp(k);
  assert.equal(app.length, 1);
  assert.equal(app[0].nom, 'Site Team');
  assert.equal(app[0].tag, 'ST');
  assert.deepEqual(app[0].membres.map(m => [m.poste, m.discordId, m.nom]), [['joueur', J2, 'Nova'], ['coach', null, 'Kai']]);
  assert.equal(equipesSite(k)[0].tag, 'ST');
  // La fiche de l'événement indique le lien.
  assert.equal((await k.api(k.chemin)).corps.evenement.siteTournoiId, T1);

  // Équipe ajoutée dans l'app : créée tout de suite sur le site, avec ses joueurs.
  const ajout = await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'Alpha', tag: 'ALP', membres: [{ poste: 'coach', discordId: COACH, nom: 'Coach' }, { poste: 'joueur', discordId: J1, nom: 'Un', embarkId: 'Un#0001' }] }] } });
  assert.equal(ajout.statut, 200, JSON.stringify(ajout.corps));
  const alpha = equipesSite(k).find(e => e.name === 'Alpha');
  assert.ok(alpha, 'créée sur le site');
  assert.equal(alpha.tag, 'ALP');
  assert.deepEqual(joueursDe(k, alpha.id).map(p => [p.pseudo, p.role, p.is_captain, p.discord_id, p.embark_id]), [['Coach', 'Coach', false, COACH, null], ['Un', null, true, J1, 'Un#0001']]);

  // Modifiée sur le site (ancienne modification) : l'app fait foi, la version de l'app est remise.
  alpha.name = 'Alpha Prime';
  k.site.tables.tournament_players.push({ id: 'p9', team_id: alpha.id, pseudo: 'Intrus', role: null, discord_id: J2, embark_id: null, sort_order: 5 });
  const s1 = await k.api(`${k.chemin}/site/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s1.corps.etat.majSite, 1, JSON.stringify(s1.corps.etat));
  assert.equal(equipesSite(k).find(e => e.id === alpha.id).name, 'Alpha');
  assert.equal(joueursDe(k, alpha.id).length, 2);
  app = await equipesApp(k);
  const alphaApp = app.find(e => e.tag === 'ALP');
  assert.equal(alphaApp.nom, 'Alpha');

  // Modifiée dans l'app → modifiée sur le site tout de suite ; rien à faire ensuite.
  await k.api(`${k.chemin}/equipes/${alphaApp.id}`, undefined, { methode: 'PATCH', corps: { nom: 'Alpha Omega', membres: [...alphaApp.membres, { poste: 'remplacant', discordId: J2, nom: 'Deux' }] } });
  assert.equal(equipesSite(k).find(e => e.id === alpha.id).name, 'Alpha Omega');
  assert.deepEqual(joueursDe(k, alpha.id).map(p => p.role), ['Coach', null, 'Remplaçant']);
  const s2 = await k.api(`${k.chemin}/site/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.deepEqual([s2.corps.etat.majSite, s2.corps.etat.envoyees, s2.corps.etat.recues], [0, 0, 0]);

  // Disparue du site : recréée (l'app fait foi), rien n'est retiré de l'événement.
  const siteTeam = equipesSite(k).find(e => e.name === 'Site Team');
  await k.site.supprimer('tournament_teams', siteTeam.id);
  const s3 = await k.api(`${k.chemin}/site/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s3.corps.etat.envoyees, 1);
  assert.ok(equipesSite(k).some(e => e.name === 'Site Team'));
  app = await equipesApp(k);
  assert.equal(app.length, 2);

  // Retirée dans l'app → retirée du site.
  await k.api(`${k.chemin}/equipes/${alphaApp.id}`, undefined, { methode: 'DELETE' });
  assert.ok(!equipesSite(k).some(e => e.id === alpha.id));
  assert.equal(k.site.tables.tournament_players.filter(p => p.team_id === alpha.id).length, 0);

  // Un seul événement par tournoi du site ; délier ne supprime rien.
  const autre = await k.api('/evenements', undefined, { methode: 'POST', corps: { nom: 'Autre' } });
  const refus = await k.api(`/evenements/${autre.corps.evenement.id}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  assert.equal(refus.statut, 409);
  const delie = await k.api(`${k.chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: null } });
  assert.equal(delie.corps.tournoiId, null);

  // Droits : sans evenements.gerer, refusé.
  const voir = await k.compteAvec('voir1234', 'Voir', ['tickets.voir']);
  assert.equal((await k.api(`${k.chemin}/site`, voir.jeton)).statut, 403);
});

test('premier lien : équipes déjà présentes des deux côtés rapprochées (pas de doublon) ; cron', async () => {
  const k = await monter();
  await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'site team', tag: 'STM', membres: [{ poste: 'joueur', discordId: J1, nom: 'Un' }] }] } });
  await k.api(`${k.chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  assert.equal(equipesSite(k).length, 1, 'pas de doublon');
  assert.equal((await equipesApp(k)).length, 1);
  // La version de l'app est envoyée au site.
  assert.equal(equipesSite(k)[0].tag, 'STM');
  assert.deepEqual(joueursDe(k, equipesSite(k)[0].id).map(p => p.discord_id), [J1]);
  // Cron : une ancienne équipe du site (sans équipe dans l'app) est reprise dans l'événement.
  k.site.tables.tournament_teams.push({ id: '22222222-2222-4222-8222-000000000009', tournament_id: T1, name: 'Nouvelle', tag: 'NEW' });
  await tachesPlanifiees(k.b.base, { maintenant: () => k.b.horloge.t, siteLz: k.site, journal: { error() {}, warn() {}, log() {} } });
  assert.ok((await equipesApp(k)).some(e => e.tag === 'NEW'));
});

test('clé du site lue dans ~/.lignezero/api.env (même hébergement), variables prioritaires', () => {
  const PONT = 'p'.repeat(40);
  // Site à jour : la clé du pont ; l'ancienne clé (celle du bot) n'est plus lue.
  const lire = () => `URL_SITE=https://lz.example\nCLE_SERVICE="cle-secrete"\nCLE_PONT='${PONT}'\n`;
  assert.deepEqual(configSite({}, lire), { url: 'https://lz.example/api', clePont: PONT, cle: '', clesPont: [PONT] });
  // Site pas encore à jour : ancien accès (compatibilité de déploiement).
  const ancien = () => 'URL_SITE=https://lz.example\nCLE_SERVICE="cle-secrete"\n';
  assert.deepEqual(configSite({}, ancien), { url: 'https://lz.example/api', clePont: '', cle: 'cle-secrete', clesPont: [] });
  assert.deepEqual(configSite({ LZ_CLE: 'x', LZ_API_URL: 'https://autre/api/' }, ancien), { url: 'https://autre/api', clePont: '', cle: 'x', clesPont: [] });
  // Clé du pont trop courte : ignorée.
  assert.equal(configSite({}, () => 'CLE_PONT=courte\n').clePont, '');
  assert.equal(configSite({}, () => { throw new Error('absent'); }).cle, '');
});

test('pont signé : la clé ne voyage jamais, signature HMAC vérifiable, nonce unique, HTTPS obligatoire', async () => {
  const PONT = 'k'.repeat(48);
  const vues = [];
  const faux = async (url, init) => {
    vues.push({ url, init });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  const site = clientSite({ url: 'https://lz.example/api', clePont: PONT }, faux);
  assert.equal(site.signe, true);
  await site.lister('tournament_teams', [{ col: 'tournament_id', op: 'eq', val: T1 }]);
  await site.supprimer('tournament_teams', T1);
  const [a, b] = vues;
  assert.equal(a.url, 'https://lz.example/api/rest');
  assert.equal(a.init.redirect, 'error');
  assert.ok(!('authorization' in a.init.headers), 'pas de Bearer');
  assert.ok(!JSON.stringify(a.init).includes(PONT), 'la clé n’apparaît nulle part dans la requête');
  assert.equal(JSON.parse(a.init.body).columns, 'id,tournament_id,name,tag');
  // Signature recalculée comme le site (api/serveur/cles.mjs) : LZ1, méthode, chemin, horodatage, nonce, sha256(corps).
  const h = a.init.headers;
  const attendu = createHmac('sha256', PONT)
    .update(`LZ1\nPOST\n/rest\n${h['x-lz-horodatage']}\n${h['x-lz-nonce']}\n${createHash('sha256').update(a.init.body).digest('hex')}`)
    .digest('base64url');
  assert.equal(h['x-lz-signature'], attendu);
  assert.ok(Math.abs(Number(h['x-lz-horodatage']) - Date.now()) < 5000);
  assert.match(h['x-lz-nonce'], /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(h['x-lz-nonce'], b.init.headers['x-lz-nonce']);
  // Vecteur fixe (le même figure dans les tests du site).
  assert.equal(entetesSignes('c'.repeat(32), { corps: '{}', maintenant: 1700000000000, nonce: 'n'.repeat(22) })['x-lz-signature'], createHmac('sha256', 'c'.repeat(32)).update(`LZ1\nPOST\n/rest\n1700000000000\n${'n'.repeat(22)}\n${createHash('sha256').update('{}').digest('hex')}`).digest('base64url'));
  // HTTP en clair : refusé avant tout envoi ; localhost permis pour les essais.
  await assert.rejects(clientSite({ url: 'http://lz.example/api', clePont: PONT }, faux).lister('tournaments'), e => e.code === 'site-non-https');
  assert.equal(adresseSure('http://localhost:3100/api'), true);
  assert.equal(vues.length, 2);
  // Message d'erreur du site borné.
  const refus = clientSite({ url: 'https://lz.example/api', clePont: PONT }, async () => new Response(JSON.stringify({ error: { message: 'x'.repeat(5000) } }), { status: 403 }));
  await assert.rejects(refus.lister('tournaments'), e => e.message.length < 300);
});

test('clé du pont relue sans redémarrage (déploiement du site, rotation) : au plus une fois par minute', async () => {
  let t = 0;
  let fichier = 'URL_SITE=https://lz.example\nCLE_SERVICE=ancienne-cle-du-bot\n';
  const vues = [];
  const site = clientSite(() => configSite({}, () => fichier), async (url, init) => {
    vues.push(init.headers);
    return new Response('{"data":[]}', { status: 200 });
  }, { maintenant: () => t });
  assert.equal(site.signe, false);
  await site.lister('tournaments');
  assert.equal(vues[0].authorization, 'Bearer ancienne-cle-du-bot');
  // Le site crée CLE_PONT : prise dans la minute, plus jamais de Bearer.
  fichier += `CLE_PONT=${'n'.repeat(40)}\n`;
  t = 61_000;
  await site.lister('tournaments');
  assert.equal(vues[1].authorization, undefined);
  assert.ok(vues[1]['x-lz-signature']);
  assert.equal(site.signe, true);
});

test('capitaine coché dans l’app : un seul, transmis au site (is_captain) ; sinon le premier joueur', async () => {
  const k = await monter();
  await k.api(`${k.chemin}/site`, undefined, { methode: 'PUT', corps: { tournoiId: T1 } });
  const r = await k.api(`${k.chemin}/equipes`, undefined, { methode: 'POST', corps: { equipes: [{ nom: 'Bêta', tag: 'BET', membres: [
    { poste: 'joueur', discordId: J1, nom: 'Un' },
    { poste: 'joueur', discordId: J2, nom: 'Deux', capitaine: true },
    { poste: 'coach', discordId: COACH, nom: 'Coach', capitaine: true },
  ] }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const app = r.corps.equipes.find(e => e.tag === 'BET');
  assert.deepEqual(app.membres.map(m => m.capitaine), [false, true, false], 'un seul capitaine (le premier coché)');
  const site = equipesSite(k).find(e => e.name === 'Bêta');
  assert.deepEqual(joueursDe(k, site.id).map(p => [p.pseudo, p.is_captain]), [['Un', false], ['Deux', true], ['Coach', false]]);
  // Synchronisation suivante : rien à renvoyer (empreintes identiques).
  const s = await k.api(`${k.chemin}/site/synchro`, undefined, { methode: 'POST', corps: {} });
  assert.equal(s.corps.etat.majSite, 0);
  // Capitaine changé dans l'app → changé sur le site.
  await k.api(`${k.chemin}/equipes/${app.id}`, undefined, { methode: 'PATCH', corps: { membres: app.membres.map((m, i) => ({ ...m, capitaine: i === 0 })) } });
  assert.deepEqual(joueursDe(k, site.id).map(p => p.is_captain), [true, false, false]);
});
