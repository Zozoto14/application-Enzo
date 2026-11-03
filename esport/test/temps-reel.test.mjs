/**
 * Temps réel (docs/esport/temps-reel.md) :
 *  - diffusion FILTRÉE par permission (aucune fuite entre rôles, entre teams, hors section CM) ;
 *  - latence de bout en bout (écriture → message reçu par un autre compte) < 1 s ;
 *  - « le premier qui enregistre a la main » : X-Version-Lue périmée → 409 (rien d'écrasé), détails seulement
 *    pour qui voit l'objet ; version rendue si l'écriture échoue ;
 *  - présence « en train de modifier » ; notifications du compte ;
 *  - reprise par curseur (`depuis`), curseur trop ancien → reinitialiser ; attente longue ; sondage ;
 *  - sobriété : limites par compte et adresse, même appareil = remplacement, modes du serveur (repli) ;
 *  - plusieurs processus sur la même base (PostgreSQL : LISTEN/NOTIFY ; SQLite : bus en mémoire).
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres, CLE } from './aide.mjs';
import { creerApi } from '../noyau/api.mjs';
import { lireModeTempsReel } from '../noyau/temps-reel/service.mjs';
import { objetDe, publicationsDe, sujetsEvenement } from '../noyau/temps-reel/regles.mjs';
import { configTempsReel } from '../serveur/config.mjs';

const UUID = '0b6c1f2e-1111-4222-8333-444455556666';

// ------------------------------------------------------------------ Règles pures

test('règles : sujets et objets des écritures ; envois, liens et exports jamais diffusés', () => {
  assert.deepEqual(publicationsDe('GET', `/teams/${UUID}/planning`), []);
  assert.deepEqual(publicationsDe('PATCH', `/cm/cartes/${UUID}`, { compte: 'a' })[0], { sujet: 'cm', cle: `cm-carte:${UUID}`, sonde: `/cm/cartes/${UUID}`, objetPublic: false, exact: true, action: 'modifie', bump: true });
  assert.equal(publicationsDe('POST', `/cm/cartes/${UUID}/deplacer`)[0].bump, false);
  assert.equal(publicationsDe('POST', `/cm/cartes/${UUID}/deplacer`)[0].cle, `cm-carte:${UUID}`);
  assert.deepEqual(publicationsDe('PUT', `/teams/${UUID}/planning/${UUID}/occurrences/x/rsvp`).map(p => p.sujet), [`team:${UUID}:planning`, `team:${UUID}:attendance`]);
  assert.equal(publicationsDe('PATCH', `/teams/${UUID}/membres/m1`)[0].invalider, true);
  assert.deepEqual(publicationsDe('POST', `/teams/${UUID}/review/envois`), []);
  assert.deepEqual(publicationsDe('PUT', `/teams/${UUID}/review/envois/e1/morceaux/3`), []);
  assert.equal(publicationsDe('POST', `/teams/${UUID}/review/envois/e1/fin`)[0].sujet, `team:${UUID}:video_review`);
  assert.deepEqual(publicationsDe('POST', `/cm/cartes/${UUID}/pieces/lien`), []);
  assert.deepEqual(publicationsDe('POST', '/usage'), []);
  assert.deepEqual(publicationsDe('POST', '/temps-reel/presence'), []);
  assert.deepEqual(publicationsDe('POST', '/notifications/lues', { compte: 'lea12345' }), [{ sujet: 'compte:lea12345' }]);
  assert.equal(publicationsDe('POST', '/cm/drive/dossiers')[0].sujet, 'cm:drive');
  assert.equal(publicationsDe('PATCH', `/sponsors/prospects/${UUID}`)[0].sonde, `/sponsors/prospects/${UUID}`);
  assert.equal(objetDe(`/teams/${UUID}/planning/reglages`), null);
  assert.equal(objetDe(`/teams/${UUID}/scouting/adversaires/${UUID}/joueurs/x`).exact, false);
  assert.equal(objetDe(`/teams/${UUID}/taches/${UUID}`).objetPublic, true);
  assert.equal(objetDe('/cm/cartes/..%2F..%2Fadmin'), null, 'identifiant hostile refusé');
  assert.deepEqual(sujetsEvenement({ type: 'attendance.rsvp', team_id: UUID }).map(s => s.sujet), [`team:${UUID}:attendance`, `team:${UUID}:planning`]);
  assert.equal(sujetsEvenement({ type: 'member.role_changed', team_id: UUID })[0].invalider, true);
  assert.equal(lireModeTempsReel(''), 'sse');
  assert.equal(lireModeTempsReel('SONDAGE'), 'sondage');
  assert.equal(lireModeTempsReel('ws'), 'sse');
  assert.deepEqual(configTempsReel({ TEMPS_REEL: 'attente', TEMPS_REEL_MAX: '12' }), { mode: 'attente', maxTotal: 12 });
});

// ------------------------------------------------------------------ Banc

/** Flux SSE lu comme le fait l'app (fetch + lecteur). */
async function ouvrirFlux(traiter, jeton, { depuis, appareil, ip = '203.0.113.7' } = {}) {
  const q = new URLSearchParams({ ...(depuis ? { depuis: String(depuis) } : {}), ...(appareil ? { appareil } : {}) });
  const r = await traiter(new Request(`https://esport.test/temps-reel/flux?${q}`, { headers: { Authorization: `Bearer ${jeton}`, 'X-Adresse-Client': ip, Accept: 'text/event-stream' } }));
  if (r.status !== 200) return { statut: r.status, corps: await r.json(), entetes: r.headers };
  assert.match(r.headers.get('Content-Type'), /text\/event-stream/);
  assert.equal(r.headers.get('X-Accel-Buffering'), 'no');
  const lecteur = r.body.getReader();
  const dec = new TextDecoder();
  const evenements = [];
  const guetteurs = new Set();
  let tampon = '';
  let premierOctets = 0;
  let ferme = false;
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        if (!premierOctets) premierOctets = value.length;
        tampon += dec.decode(value, { stream: true });
        let i;
        while ((i = tampon.indexOf('\n\n')) >= 0) {
          const bloc = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          const type = /^event: (.*)$/m.exec(bloc)?.[1];
          const data = /^data: (.*)$/m.exec(bloc)?.[1];
          if (!type || data === undefined) continue;
          const ev = { type, data: JSON.parse(data), recuLe: Date.now() };
          evenements.push(ev);
          for (const g of [...guetteurs]) g();
        }
      }
    } catch {
      // Fermé.
    } finally {
      ferme = true;
      for (const g of [...guetteurs]) g();
    }
  })();
  const attendre = (predicat, ms = 2000) =>
    new Promise((ok, ko) => {
      const verifier = () => {
        const e = evenements.find(predicat);
        if (e) {
          guetteurs.delete(verifier);
          clearTimeout(minuterie);
          ok(e);
        } else if (ferme) {
          guetteurs.delete(verifier);
          clearTimeout(minuterie);
          ko(new Error('flux fermé'));
        }
      };
      const minuterie = setTimeout(() => {
        guetteurs.delete(verifier);
        ko(new Error(`rien reçu en ${ms} ms ; reçu : ${JSON.stringify(evenements.map(e => e.data))}`));
      }, ms);
      guetteurs.add(verifier);
      verifier();
    });
  const bonjour = (await attendre(e => e.type === 'bonjour')).data;
  return {
    statut: 200,
    bonjour,
    evenements,
    attendre,
    get premierOctets() {
      return premierOctets;
    },
    get ferme() {
      return ferme;
    },
    /** Messages « maj » reçus (hors bonjour). */
    majs: () => evenements.filter(e => e.type === 'maj').map(e => e.data),
    fermer: () => lecteur.cancel().catch(() => undefined),
  };
}

const pause = ms => new Promise(ok => setTimeout(ok, ms));

async function preparer(options = {}) {
  const b = await banc(options);
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'joueur' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps, entetes: o.entetes, ip: o.ip });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const tableau = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
  const nouvelleCarte = async titre => (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: tableau.listes[0].id, titre } })).carte;
  return { b, A, B, s, api, ok, club, tableau, nouvelleCarte };
}

// ------------------------------------------------------------------ Diffusion filtrée

test('diffusion filtrée : notes du staff (joueur concerné et autres teams : rien), CM (hors section : rien), latence < 1 s', async () => {
  const { b, A, s, ok, nouvelleCarte } = await preparer();
  const t = `/teams/${A.teamId}`;
  const flux = {};
  for (const qui of ['coach123', 'lea12345', 'kai12345', 'nox12345', 'cm123456', 'fondateur']) flux[qui] = await ouvrirFlux(b.traiter, s[qui], { ip: `203.0.113.${Object.keys(flux).length + 10}` });
  for (const f of Object.values(flux)) {
    assert.ok(f.premierOctets >= 2048, 'bourrage de 2 Kio (tampons des mandataires)');
    assert.equal(f.bonjour.mode, 'sse');
    assert.equal(typeof f.bonjour.dernierId, 'number');
  }

  // Note du staff sur Léa : le Fondateur la voit (objet compris) ; ni Léa, ni Kai (joueurs), ni Nox (autre team).
  const debut = Date.now();
  const note = await ok(`${t}/suivi/lea12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Bon entry.', categorie: 'performance' } });
  assert.ok(note.id);
  const vu = await flux.fondateur.attendre(e => e.type === 'maj' && e.data.sujet === `team:${A.teamId}:player_notes`, 1000);
  const latence = vu.recuLe - debut;
  assert.ok(latence < 1000, `latence ${latence} ms`);
  assert.equal(vu.data.cle, 'suivi:lea12345');
  assert.equal(vu.data.pseudo, 'Zed');
  assert.ok(!('contenu' in vu.data) && !JSON.stringify(vu.data).includes('entry'), 'aucune donnée métier dans le message');

  // Carte CM : la Responsable CM la voit (avec l'auteur), le Fondateur aussi ; les joueurs sans CM rien.
  const carte = await nouvelleCarte('Annonce');
  await ok(`/cm/cartes/${carte.id}`, s.cm123456, { methode: 'PATCH', corps: { titre: 'Annonce v2' } });
  const vuCm = await flux.fondateur.attendre(e => e.type === 'maj' && e.data.cle === `cm-carte:${carte.id}` && e.data.version === 1);
  assert.equal(vuCm.data.acteur, 'cm123456');
  // La Responsable CM ne reçoit pas ses propres écritures en double ; elle reçoit bien celles des autres.
  await ok(`/cm/cartes/${carte.id}`, s.fondateur, { methode: 'PATCH', corps: { titre: 'Annonce v3' } });
  await flux.cm123456.attendre(e => e.type === 'maj' && e.data.cle === `cm-carte:${carte.id}` && e.data.acteur === 'principal');

  await pause(150);
  for (const qui of ['lea12345', 'kai12345', 'nox12345']) {
    const recus = flux[qui].majs();
    assert.ok(!recus.some(m => m.sujet === `team:${A.teamId}:player_notes`), `${qui} : notes du staff`);
    assert.ok(!recus.some(m => m.sujet === 'cm' || String(m.cle ?? '').startsWith('cm-')), `${qui} : section CM`);
    assert.ok(!recus.some(m => m.cle === 'suivi:lea12345' || m.acteur === 'coach123'), `${qui} : objet ou auteur`);
  }
  assert.ok(!flux.nox12345.majs().some(m => String(m.sujet).includes(A.teamId)), 'autre team : rien du tout');
  for (const f of Object.values(flux)) await f.fermer();
});

test('diffusion filtrée : retrait d’un membre ou changement de rôle → plus rien pour lui (cache d’accès oublié)', async () => {
  const { b, A, s, ok } = await preparer();
  const t = `/teams/${A.teamId}`;
  const lea = await ouvrirFlux(b.traiter, s.lea12345);
  const tache = await ok(`${t}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Revoir les VOD' } });
  const m1 = await lea.attendre(e => e.type === 'maj' && e.data.sujet === `team:${A.teamId}:goals_tasks`);
  assert.ok(m1.data.id);
  // Léa retirée de la team : plus aucun message de cette team.
  await ok(`${t}/membres/${A.membres.lea12345.id}`, s.fondateur, { methode: 'DELETE' });
  await pause(50);
  const avant = lea.majs().length;
  await ok(`${t}/taches/${tache.id}`, s.coach123, { methode: 'PATCH', corps: { titre: 'Revoir les VOD (Ascent)' } });
  await pause(150);
  const apres = lea.majs().slice(avant);
  assert.ok(!apres.some(m => m.sujet === `team:${A.teamId}:goals_tasks`), JSON.stringify(apres));
  await lea.fermer();
});

test('notifications : le compteur du compte notifié bouge (sujet « compte »), jamais celui d’un autre', async () => {
  const { b, A, s, ok } = await preparer();
  const lea = await ouvrirFlux(b.traiter, s.lea12345);
  // Nox (autre team) : ni notification personnelle, ni élément du fil du centre de notifications de cette team.
  const kai = await ouvrirFlux(b.traiter, s.nox12345);
  await ok(`/teams/${A.teamId}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Aim 20 min', assigne: 'lea12345' } });
  const n = await lea.attendre(e => e.type === 'maj' && e.data.sujet === 'compte');
  assert.equal(n.data.sujet, 'compte', 'jamais l’identifiant d’un compte dans le sujet');
  await pause(100);
  assert.ok(!kai.majs().some(m => m.sujet === 'compte'));
  // Notifications lues dans un onglet : les autres appareils du compte suivent.
  await ok('/notifications/lues', s.lea12345, { methode: 'POST', corps: { tout: true } });
  await lea.attendre(e => e.type === 'maj' && e.data.sujet === 'compte' && e.data.id > n.data.id);
  await lea.fermer();
  await kai.fermer();
});

// ------------------------------------------------------------------ Le premier qui enregistre a la main

test('verrou optimiste : le premier qui enregistre a la main (409 sans rien écraser), détails seulement pour qui voit', async () => {
  const { s, api, ok, nouvelleCarte } = await preparer();
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-responsable', portee: 'club' } });
  const carte = await nouvelleCarte('Planning de la semaine');
  const chemin = `/cm/cartes/${carte.id}`;
  const v0 = await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.cm123456);
  assert.equal(v0.version, 0);
  assert.equal((await api(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.lea12345)).statut, 404, 'pas de version pour qui ne voit pas la carte');
  // Clara et Kai ouvrent la carte (version 0) ; Clara enregistre la première.
  const r1 = await api(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: 'Planning (Clara)' }, entetes: { 'X-Version-Lue': '0' } });
  assert.equal(r1.statut, 200);
  assert.equal(r1.entetes.get('X-Version-Objet'), '1');
  const r2 = await api(chemin, s.kai12345, { methode: 'PATCH', corps: { titre: 'Planning (Kai)' }, entetes: { 'X-Version-Lue': '0' } });
  assert.equal(r2.statut, 409);
  assert.equal(r2.corps.code, 'conflit-version');
  assert.equal(r2.corps.details.version, 1);
  assert.equal(r2.corps.details.par.pseudo, 'Clara');
  assert.ok(r2.corps.details.le);
  assert.equal((await ok(chemin, s.cm123456)).carte.titre, 'Planning (Clara)', 'le travail de Clara n’est pas écrasé');
  // Kai recharge (version 1) puis enregistre : ça passe.
  const r3 = await api(chemin, s.kai12345, { methode: 'PATCH', corps: { titre: 'Planning (Kai)' }, entetes: { 'X-Version-Lue': '1' } });
  assert.equal(r3.statut, 200);
  assert.equal(r3.entetes.get('X-Version-Objet'), '2');
  // Un compte qui ne voit pas la carte, avec une version périmée : 404 habituel, jamais le nom de l'auteur.
  const r4 = await api(chemin, s.lea12345, { methode: 'PATCH', corps: { titre: 'x' }, entetes: { 'X-Version-Lue': '0' } });
  assert.notEqual(r4.statut, 409);
  assert.ok(!JSON.stringify(r4.corps).includes('Kai'));
  // Écriture refusée par la route (validation) : la version est rendue, pas de faux conflit ensuite.
  const r5 = await api(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: '' }, entetes: { 'X-Version-Lue': '2' } });
  assert.equal(r5.statut, 400);
  assert.equal((await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.cm123456)).version, 2);
  // Sans en-tête (ancienne app) : enregistre, et la version avance quand même (les autres le sauront).
  const r6 = await api(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: 'Planning final' } });
  assert.equal(r6.statut, 200);
  const v = await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.kai12345);
  assert.equal(v.version, 3);
  assert.equal(v.par.pseudo, 'Clara');
  assert.equal((await api(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: 'y' }, entetes: { 'X-Version-Lue': 'abc' } })).statut, 400);
  // Surcharge de méthode (frontal mutualisé) : même verrou.
  const r7 = await api(chemin, s.kai12345, { methode: 'POST', corps: { titre: 'z' }, entetes: { 'X-Methode': 'PATCH', 'X-Version-Lue': '1' } });
  assert.equal(r7.statut, 409);
});

test('verrou optimiste : deux enregistrements simultanés sur la même version → un seul passe', async () => {
  const { s, api, ok, nouvelleCarte } = await preparer();
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'kai12345', roleId: 'cm-role-responsable', portee: 'club' } });
  const carte = await nouvelleCarte('Course');
  const chemin = `/cm/cartes/${carte.id}`;
  const [a, k] = await Promise.all([
    api(chemin, s.cm123456, { methode: 'PATCH', corps: { titre: 'A' }, entetes: { 'X-Version-Lue': '0' } }),
    api(chemin, s.kai12345, { methode: 'PATCH', corps: { titre: 'K' }, entetes: { 'X-Version-Lue': '0' } }),
  ]);
  assert.deepEqual([a.statut, k.statut].sort(), [200, 409]);
  const gagnant = a.statut === 200 ? 'A' : 'K';
  assert.equal((await ok(chemin, s.cm123456)).carte.titre, gagnant);
});

test('présence : « X est en train de modifier » pour qui voit la carte seulement ; fin de présence', async () => {
  const { b, s, api, ok, nouvelleCarte } = await preparer();
  const carte = await nouvelleCarte('Visuel du match');
  const chemin = `/cm/cartes/${carte.id}`;
  const fondateur = await ouvrirFlux(b.traiter, s.fondateur);
  const lea = await ouvrirFlux(b.traiter, s.lea12345);
  const p = await ok('/temps-reel/presence', s.cm123456, { methode: 'POST', corps: { chemin, etat: 'edition' } });
  assert.ok(p.jusqua);
  const vu = await fondateur.attendre(e => e.type === 'presence' && e.data.cle === `cm-carte:${carte.id}`);
  assert.equal(vu.data.pseudo, 'Clara');
  assert.equal(vu.data.etat, 'edition');
  const v = await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.fondateur);
  assert.deepEqual(v.presences.map(x => x.pseudo), ['Clara']);
  assert.deepEqual((await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.cm123456)).presences, [], 'jamais soi-même');
  assert.equal((await api('/temps-reel/presence', s.lea12345, { methode: 'POST', corps: { chemin, etat: 'edition' } })).statut, 404);
  assert.equal((await api('/temps-reel/presence', s.cm123456, { methode: 'POST', corps: { chemin: '/teams/x/../../admin', etat: 'edition' } })).statut, 404);
  await ok('/temps-reel/presence', s.cm123456, { methode: 'POST', corps: { chemin, etat: 'fin' } });
  await fondateur.attendre(e => e.type === 'presence' && e.data.etat === 'fin');
  await pause(100);
  assert.ok(!lea.evenements.some(e => e.type === 'presence'), 'aucune présence pour qui ne voit pas');
  await fondateur.fermer();
  await lea.fermer();
});

// ------------------------------------------------------------------ Reprise, attente longue, sondage

test('reprise par curseur : ce qui a été écrit pendant la coupure arrive à la reconnexion ; curseur trop ancien → reinitialiser', async () => {
  const { b, A, s, ok } = await preparer();
  const f1 = await ouvrirFlux(b.traiter, s.lea12345);
  const curseur = f1.bonjour.dernierId;
  await f1.fermer();
  await ok(`/teams/${A.teamId}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Pendant la coupure' } });
  const f2 = await ouvrirFlux(b.traiter, s.lea12345, { depuis: curseur });
  assert.equal(f2.bonjour.reinitialiser, false);
  const m = await f2.attendre(e => e.type === 'maj' && e.data.sujet === `team:${A.teamId}:goals_tasks`);
  assert.ok(m.data.id > curseur);
  assert.ok(f2.bonjour.dernierId >= m.data.id);
  await f2.fermer();
  // Curseur venu d'ailleurs (plus grand que le journal) : l'app recharge tout.
  const f3 = await ouvrirFlux(b.traiter, s.lea12345, { depuis: 10_000_000 });
  assert.equal(f3.bonjour.reinitialiser, true);
  await f3.fermer();
  // Journal purgé au-delà de deux heures : curseur trop ancien.
  await b.base.executer('UPDATE temps_reel_flux SET cree_le = ? WHERE id < ?', ['2020-01-01T00:00:00.000Z', f2.bonjour.dernierId]);
  const { purger } = await import('../noyau/temps-reel/diffusion.mjs');
  await purger(b.base, Date.parse('2026-10-20T10:00:00.000Z'));
  const f4 = await ouvrirFlux(b.traiter, s.lea12345, { depuis: 1 });
  assert.equal(f4.bonjour.reinitialiser, true);
  assert.ok(f4.bonjour.dernierId >= f2.bonjour.dernierId, 'le curseur ne repart jamais à 1');
  await f4.fermer();
});

test('attente longue et sondage : mêmes messages filtrés ; l’attente répond dès qu’un message arrive', async () => {
  const { b, A, s, ok } = await preparer();
  const appel = (chemin, jeton) => b.traiter(new Request(`https://esport.test${chemin}`, { headers: { Authorization: `Bearer ${jeton}`, 'X-Adresse-Client': '203.0.113.50' } }));
  const premier = await (await appel('/temps-reel/evenements', s.lea12345)).json();
  assert.deepEqual(premier.evenements, []);
  assert.equal(typeof premier.dernierId, 'number');
  const attente = appel(`/temps-reel/attendre?depuis=${premier.dernierId}&delai=5`, s.lea12345);
  const r = await attente;
  assert.equal(r.status, 200);
  const debut = Date.now();
  const lecture = r.text();
  await pause(30);
  await ok(`/teams/${A.teamId}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Attente' } });
  const corps = JSON.parse(await lecture);
  assert.ok(Date.now() - debut < 1000, 'réponse dès le message');
  assert.equal(corps.evenements[0].sujet, `team:${A.teamId}:goals_tasks`);
  // Sondage : ce qui est arrivé depuis le curseur, filtré (une note du staff n'apparaît pas pour Léa).
  await ok(`/teams/${A.teamId}/suivi/lea12345/notes`, s.coach123, { methode: 'POST', corps: { contenu: 'Privé', categorie: 'performance' } });
  const s2 = await (await appel(`/temps-reel/evenements?depuis=${corps.dernierId}`, s.lea12345)).json();
  assert.ok(!s2.evenements.some(e => e.sujet.endsWith(':player_notes')));
  assert.ok(s2.dernierId > corps.dernierId, 'le curseur avance même sans message visible');
});

test('sobriété : 2 connexions par compte et adresse, même appareil = remplacement, 429 « sondage » sans rien garder ouvert', async () => {
  const { b, s } = await preparer();
  const ip = '203.0.113.99';
  const a = await ouvrirFlux(b.traiter, s.lea12345, { ip, appareil: 'appareil-AAAA' });
  const c = await ouvrirFlux(b.traiter, s.lea12345, { ip, appareil: 'appareil-BBBB' });
  const refus = await ouvrirFlux(b.traiter, s.lea12345, { ip, appareil: 'appareil-CCCC' });
  assert.equal(refus.statut, 429);
  assert.equal(refus.corps.mode, 'sondage');
  assert.ok(Number(refus.entetes.get('Retry-After')) > 0);
  assert.equal(b.traiter.tempsReel.nombre(), 2);
  // Le même appareil revient (onglet masqué puis revenu) : l'ancienne connexion est fermée et remplacée.
  const a2 = await ouvrirFlux(b.traiter, s.lea12345, { ip, appareil: 'appareil-AAAA' });
  assert.equal(a2.statut, 200);
  await pause(20);
  assert.ok(a.ferme, 'ancienne connexion du même appareil fermée');
  assert.equal(b.traiter.tempsReel.nombre(), 2);
  // Le navigateur s'en va : la place est rendue tout de suite.
  await c.fermer();
  await a2.fermer();
  await pause(20);
  assert.equal(b.traiter.tempsReel.nombre(), 0);
  const etat = b.traiter.tempsReel.etat();
  assert.equal(etat.connexions, 0);
  assert.ok(etat.refus >= 1);
});

test('modes du serveur : TEMPS_REEL=sondage → flux et attente refusés tout de suite (429), sondage seulement ; /sante l’annonce', async () => {
  const b = await banc();
  const traiter = creerApi({ base: b.base, cleSession: CLE, verifierJeton: async () => ({}), maintenant: () => b.horloge.t, tempsReel: { mode: 'sondage' } });
  const jeton = await b.session('principal', 'Fondateur');
  const appel = chemin => traiter(new Request(`https://esport.test${chemin}`, { headers: { Authorization: `Bearer ${jeton}`, 'X-Adresse-Client': '203.0.113.60' } }));
  const sante = await (await appel('/sante')).json();
  assert.equal(sante.tempsReel, 'sondage');
  assert.ok(sante.fonctions.includes('temps-reel'));
  const f = await appel('/temps-reel/flux');
  assert.equal(f.status, 429);
  assert.equal((await f.json()).code, 'mode-sondage');
  assert.equal((await appel('/temps-reel/attendre?depuis=1')).status, 429);
  assert.equal((await appel('/temps-reel/evenements')).status, 200);
  assert.equal(traiter.tempsReel.nombre(), 0);
  const attente = creerApi({ base: b.base, cleSession: CLE, verifierJeton: async () => ({}), maintenant: () => b.horloge.t, tempsReel: { mode: 'attente' } });
  const r = await attente(new Request('https://esport.test/temps-reel/flux', { headers: { Authorization: `Bearer ${jeton}` } }));
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'mode-attente');
});

test('plusieurs processus sur la même base : une écriture reçue par l’autre processus (PostgreSQL : LISTEN/NOTIFY)', async () => {
  const { b, A, s, ok } = await preparer();
  // Second « processus » : une autre API sur la même base (le pool Passenger lance plusieurs Node).
  const autre = creerApi({ base: b.base, cleSession: CLE, verifierJeton: async () => ({}), maintenant: () => b.horloge.t });
  const flux = await ouvrirFlux(autre, s.lea12345);
  // Laisse l'écoute s'établir (PostgreSQL : connexion LISTEN ouverte à la première connexion du processus).
  await pause(200);
  const debut = Date.now();
  await ok(`/teams/${A.teamId}/taches`, s.coach123, { methode: 'POST', corps: { titre: 'Autre processus' } });
  const m = await flux.attendre(e => e.type === 'maj' && e.data.sujet === `team:${A.teamId}:goals_tasks`, 2000);
  assert.ok(m.recuLe - debut < 1000, `latence ${m.recuLe - debut} ms`);
  await flux.fermer();
  await pause(50);
  assert.equal(autre.tempsReel.nombre(), 0);
  await autre.tempsReel.fermer();
});
