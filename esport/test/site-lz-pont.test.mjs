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
import { configSite } from '../noyau/site-lz/client.mjs';
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
  const lire = () => 'URL_SITE=https://lz.example\nCLE_SERVICE="cle-secrete"\n';
  assert.deepEqual(configSite({}, lire), { url: 'https://lz.example/api', cle: 'cle-secrete' });
  assert.deepEqual(configSite({ LZ_CLE: 'x', LZ_API_URL: 'https://autre/api/' }, lire), { url: 'https://autre/api', cle: 'x' });
  assert.equal(configSite({}, () => { throw new Error('absent'); }).cle, '');
});
