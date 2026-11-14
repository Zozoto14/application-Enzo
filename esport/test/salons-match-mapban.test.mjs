/**
 * Map ban dans le salon de match Discord (evenements-club/salons-match.mjs, migration 0084) : un message au lancement
 * (envoyé au capitaine, lien PUBLIC de suivi sans jeton, équipe qui commence), un message à la fin (la ou les maps
 * jouées, dans l'ordre), chacun une seule fois, rien de tactique, aucune mention. Faux site et faux Discord.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapbanDe } from '../noyau/evenements-club/salons-match.mjs';
import { clientSite } from '../noyau/site-lz/client.mjs';
import { T1, EA, EB, M1, L1, monter, messagesDe, lignes, synchro, activer } from './salons-match-aide.mjs';

const POOL = [{ id: 'a', nom: 'Monaco', image: null }, { id: 'b', nom: 'Seoul', image: null }, { id: 'c', nom: 'Kyoto', image: null }, { id: 'd', nom: 'Bernal', image: null }, { id: 'e', nom: 'Las Vegas', image: null }];
const ligneMapban = (extra = {}) => ({ mapban_id: 'abCDefGH12', tournament_id: T1, match_id: M1, lobby_id: null, format: 3, pool: POOL, sequence: [], actions: [], termine_le: null, created_at: '2026-10-20T10:00:00Z', premier_team_id: EB, ...extra });
const FIN3 = [
  { map: 'a', equipe: 1, type: 'ban' }, { map: 'b', equipe: 0, type: 'ban' },
  { map: 'c', equipe: 1, type: 'pick' }, { map: 'd', equipe: 0, type: 'pick' },
];

test('lecture : lien public sans jeton, maps jouées dans l’ordre (picks puis map restante), rien avant la fin', () => {
  const l = ligneMapban({ jeton: 'SECRET', equipes: [{ jeton: 'SECRET' }] });
  const m = mapbanDe([l], 'match_id', M1, 'https://lz.appdashboard.fr/').mapban;
  assert.equal(m.lien, 'https://lz.appdashboard.fr/mapban/abCDefGH12');
  assert.ok(!JSON.stringify(m).includes('SECRET'));
  assert.deepEqual(m.maps, []);
  assert.equal(m.termine, false);
  const fini = mapbanDe([ligneMapban({ actions: FIN3, termine_le: '2026-10-20T10:05:00Z' })], 'match_id', M1).mapban;
  assert.deepEqual(fini.maps, ['Kyoto', 'Bernal', 'Las Vegas']);
  // BO1 : la seule map restante.
  const bo1 = mapbanDe([ligneMapban({ format: 1, actions: [{ map: 'a' }, { map: 'b' }, { map: 'c' }, { map: 'd' }].map(x => ({ ...x, equipe: 0, type: 'ban' })), termine_le: 'x' })], 'match_id', M1).mapban;
  assert.deepEqual(bo1.maps, ['Las Vegas']);
  // Colonnes en texte JSON (autre pilote) ; identifiant douteux ou autre match : ignoré.
  assert.deepEqual(mapbanDe([ligneMapban({ pool: JSON.stringify(POOL), actions: JSON.stringify(FIN3), termine_le: 'x' })], 'match_id', M1).mapban.maps, ['Kyoto', 'Bernal', 'Las Vegas']);
  assert.deepEqual(mapbanDe([ligneMapban({ mapban_id: 'a b/../' })], 'match_id', M1), {});
  assert.deepEqual(mapbanDe([ligneMapban()], 'lobby_id', L1), {});
  assert.deepEqual(mapbanDe([], 'match_id', M1), {});
  // Adresse du site douteuse : repli sur le site officiel.
  assert.match(mapbanDe([ligneMapban()], 'match_id', M1, 'javascript:x').mapban.lien, /^https:\/\/lz\.appdashboard\.fr\/mapban\//);
});

test('client : adresse publique du site déduite de l’API, colonnes de la vue sans jeton', async () => {
  const c = clientSite({ url: 'https://lz.appdashboard.fr/api', clePont: 'x'.repeat(40) });
  assert.equal(c.urlSite, 'https://lz.appdashboard.fr');
  let corps;
  const c2 = clientSite({ url: 'https://lz.appdashboard.fr/api', clePont: 'x'.repeat(40) }, async (_u, o) => ((corps = JSON.parse(o.body)), { ok: true, json: async () => ({ data: [] }) }));
  await c2.lister('tournament_match_mapban', [{ col: 'tournament_id', op: 'eq', val: T1 }]);
  assert.equal(corps.table, 'tournament_match_mapban');
  assert.ok(!corps.columns.includes('equipes') && corps.columns.includes('premier_team_id'));
});

test('salon de match : lancement annoncé une fois (lien public, équipe qui commence), fin annoncée une fois (maps jouées)', async () => {
  const k = await monter();
  await activer(k);
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  const msgs = () => messagesDe(k, lm.salon_id);
  const avant = msgs().length;
  await synchro(k);
  assert.equal(msgs().length, avant, 'pas de map ban : aucun message');

  // Le staff lance le map ban : tirage au sort → Bravo commence.
  k.site.tables.tournament_match_mapban.push(ligneMapban({ equipes: [{ nom: 'Alpha', jeton: 'JETON-SECRET-A' }] }));
  await synchro(k);
  const lancement = msgs().slice(avant);
  assert.equal(lancement.length, 1, JSON.stringify(lancement));
  assert.match(lancement[0].content, /Le map ban a été envoyé au capitaine/);
  assert.match(lancement[0].content, /<https:\/\/lz\.appdashboard\.fr\/mapban\/abCDefGH12>/);
  assert.match(lancement[0].content, /Bravo commence le map ban \(tirage au sort\)/);
  assert.ok(!JSON.stringify(lancement).includes('JETON-SECRET'), 'aucun jeton dans le salon');
  assert.ok(!/\?c=/.test(lancement[0].content), 'lien sans jeton de capitaine');
  assert.deepEqual(lancement[0].allowed_mentions, { parse: [] });
  assert.doesNotMatch(lancement[0].content, /<@/);

  // Rien de plus aux passages suivants ni après un choix en cours (pas de spam).
  await synchro(k);
  k.site.tables.tournament_match_mapban[0].actions = FIN3.slice(0, 2);
  await synchro(k);
  assert.equal(msgs().slice(avant).length, 1);

  // Fin du map ban : un seul message avec les maps jouées dans l'ordre.
  Object.assign(k.site.tables.tournament_match_mapban[0], { actions: FIN3, termine_le: '2026-10-20T10:05:00Z' });
  await synchro(k);
  await synchro(k);
  const apres = msgs().slice(avant);
  assert.equal(apres.length, 2, JSON.stringify(apres.map(x => x.content)));
  assert.match(apres[1].content, /Map ban terminé\. Maps jouées, dans l’ordre : 1\. Kyoto, 2\. Bernal, 3\. Las Vegas\./);
  assert.deepEqual(apres[1].allowed_mentions, { parse: [] });
  // Une ligne par match : état gardé (migration 0084).
  const l = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  assert.equal(l.mapban_annonce, 'abCDefGH12');
  assert.equal(l.mapban_fin, 'abCDefGH12');

  // Map ban relancé par le staff (nouvel identifiant) : annoncé de nouveau, une fois.
  k.site.tables.tournament_match_mapban = [ligneMapban({ mapban_id: 'zzNEWveto9', premier_team_id: EA })];
  await synchro(k);
  await synchro(k);
  const relance = msgs().slice(avant + 2);
  assert.equal(relance.length, 1);
  assert.match(relance[0].content, /mapban\/zzNEWveto9/);
  assert.match(relance[0].content, /Alpha commence/);
});

test('salon de match : map ban vu déjà terminé (une seule map, BO1) → seul le message de fin, une map jouée', async () => {
  const k = await monter();
  await activer(k);
  const lm = (await lignes(k)).find(x => x.site_match_id === `m:${M1}`);
  const avant = messagesDe(k, lm.salon_id).length;
  k.site.tables.tournament_match_mapban.push(ligneMapban({ format: 1, actions: ['a', 'b', 'c', 'd'].map((map, i) => ({ map, equipe: i % 2, type: 'ban' })), termine_le: '2026-10-20T10:05:00Z' }));
  await synchro(k);
  await synchro(k);
  const nouveaux = messagesDe(k, lm.salon_id).slice(avant);
  assert.equal(nouveaux.length, 1);
  assert.match(nouveaux[0].content, /Map ban terminé\. Map jouée : Las Vegas\./);
});

test('salon de match : map ban d’un lobby, anglais, site ancien (vue absente) sans effet', async () => {
  const k = await monter();
  await k.api(k.sm, undefined, { methode: 'PUT', corps: { langue: 'en' } });
  await activer(k);
  const ll = (await lignes(k)).find(x => x.site_match_id === `l:${L1}`);
  const avant = messagesDe(k, ll.salon_id).length;
  k.site.tables.tournament_match_mapban.push(ligneMapban({ match_id: null, lobby_id: L1, premier_team_id: EA }));
  await synchro(k);
  const [msg] = messagesDe(k, ll.salon_id).slice(avant);
  assert.match(msg.content, /The map ban was sent to each team captain/);
  assert.match(msg.content, /Alpha starts the map ban \(coin toss\)/);
  // Site pas à jour : la vue n'existe pas → lecture refusée, la synchro continue sans erreur.
  const lister = k.site.lister.bind(k.site);
  k.site.lister = async (t, ...r) => {
    if (t === 'tournament_match_mapban') throw new Error('absente');
    return lister(t, ...r);
  };
  const bilan = await synchro(k);
  assert.ok(!bilan.erreur, JSON.stringify(bilan));
});
