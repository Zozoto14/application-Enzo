/**
 * Module « Ressources » : catalogue et permissions, aperçu des liens protégé contre la SSRF (pur, et
 * téléchargeur simulé), canal (catégories, publication, fil, filtres, favoris, réactions, commentaires,
 * compteur « nouveau »), file de validation des propositions, visibilité « staff seulement »,
 * isolation entre teams (tests négatifs), fichier déposé par morceaux, « Ouvrir en review vidéo »,
 * publication multi-teams, Discord (salon de la team, salon dédié, jamais le staff), RGPD.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { envoyer, sha } from './medias-aide.mjs';
import { modulesDuPreset, permissionsRoleSysteme } from '../noyau/permissions.mjs';
import { extraireMeta, ipInterdite, recupererApercu, verifierAdresse } from '../noyau/ressources/apercu.mjs';
import { filtrerRessources, trierRessources } from '../noyau/ressources/service.mjs';
import { embedRessource } from '../noyau/discord/embeds.mjs';

// ------------------------------------------------------------------ Catalogue

test('catalogue : module resources dans le preset complet ; view pour tous, post et manage pour le staff', () => {
  assert.ok(modulesDuPreset('valorant_complet').includes('resources'));
  assert.ok(!modulesDuPreset('minimal').includes('resources'));
  for (const role of ['manager', 'coach', 'analyste']) {
    for (const p of ['resources.view', 'resources.post', 'resources.manage']) assert.ok(permissionsRoleSysteme(role).includes(p), `${role} : ${p}`);
  }
  for (const role of ['joueur', 'remplacant']) {
    assert.ok(permissionsRoleSysteme(role).includes('resources.view'), role);
    assert.ok(!permissionsRoleSysteme(role).includes('resources.post') && !permissionsRoleSysteme(role).includes('resources.manage'), role);
  }
});

// ------------------------------------------------------------------ Aperçu : SSRF (pur)

test('SSRF : IP privées, locales, réservées et formes détournées refusées ; IP publiques acceptées', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'ff02::1', '2001:db8::1']) {
    assert.equal(ipInterdite(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(ipInterdite(ip), false, ip);
  for (const adresse of [
    'http://127.0.0.1/',
    'http://localhost/admin',
    'http://foo.localhost/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://017700000001/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://intranet/',
    'http://imprimante.local/',
    'http://service.internal/',
    'ftp://exemple.fr/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'gopher://exemple.fr/',
    'http://user:mdp@exemple.fr/',
    'http://exemple.fr:22/',
    'http://exemple.fr:6379/',
  ]) {
    assert.throws(() => verifierAdresse(adresse), e => e.code === 'apercu-adresse', adresse);
  }
  assert.equal(verifierAdresse('https://blitz.gg/valorant/guide').hostname, 'blitz.gg');
  assert.equal(verifierAdresse('http://exemple.fr:80/page').hostname, 'exemple.fr');
});

test('aperçu : méta Open Graph, Twitter, <title>, entités ; image https publique seulement', () => {
  const html = `<html><head><title>Titre &amp; repli</title>
    <meta property="og:title" content="Lineups Viper &#8211; Ascent">
    <meta name="description" content="Toutes les lineups &quot;B site&quot;">
    <meta property="og:image" content="/img/vignette.png">
    <meta property="og:site_name" content="Blitz"></head></html>`;
  assert.deepEqual(extraireMeta(html, 'https://blitz.gg/guides/viper'), { titre: 'Lineups Viper – Ascent', description: 'Toutes les lineups "B site"', image: 'https://blitz.gg/img/vignette.png', site: 'Blitz' });
  const sansOg = extraireMeta('<title>Simple</title><meta property="og:image" content="http://127.0.0.1/x.png">', 'https://www.exemple.fr/a');
  assert.deepEqual(sansOg, { titre: 'Simple', description: null, image: null, site: 'exemple.fr' });
  assert.equal(extraireMeta('<meta property="og:image" content="javascript:alert(1)">', 'https://a.fr/').image, null);
});

test('aperçu (téléchargeur simulé) : redirection vers une IP privée refusée, DNS privé refusé, délai, taille, non-HTML', async () => {
  const appels = [];
  const pages = {
    'https://guide.exemple/': { statut: 200, type: 'text/html; charset=utf-8', corps: '<meta property="og:title" content="Guide">' },
    'https://court.exemple/r': { statut: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    'https://court.exemple/ok': { statut: 301, location: '/arrivee' },
    'https://court.exemple/arrivee': { statut: 200, type: 'text/html', corps: '<title>Arrivée</title>' },
    'https://boucle.exemple/': { statut: 302, location: 'https://boucle.exemple/' },
    'https://fichier.exemple/x.pdf': { statut: 200, type: 'application/pdf', corps: '' },
    'https://erreur.exemple/': { statut: 500, type: 'text/html', corps: '' },
  };
  const telecharger = async (url, { delai, max }) => {
    appels.push(url);
    assert.ok(delai > 0 && delai <= 4000 && max === 512 * 1024);
    const p = pages[url];
    if (!p) throw new Error('inconnue');
    return { statut: p.statut, type: p.type ?? '', location: p.location ?? null, corps: p.corps ?? '' };
  };
  assert.equal((await recupererApercu('https://guide.exemple/', { telecharger })).titre, 'Guide');
  await assert.rejects(recupererApercu('https://court.exemple/r', { telecharger }), e => e.code === 'apercu-adresse');
  assert.ok(!appels.some(u => u.includes('169.254')), 'la redirection vers l’IP privée n’est jamais suivie');
  assert.equal((await recupererApercu('https://court.exemple/ok', { telecharger })).titre, 'Arrivée');
  await assert.rejects(recupererApercu('https://boucle.exemple/', { telecharger }), e => e.code === 'apercu-redirections');
  assert.deepEqual(await recupererApercu('https://fichier.exemple/x.pdf', { telecharger }), { url: 'https://fichier.exemple/x.pdf', titre: null, description: null, image: null, site: 'fichier.exemple' });
  await assert.rejects(recupererApercu('https://erreur.exemple/', { telecharger }), e => e.code === 'apercu-injoignable');
  // Nom public qui pointe vers une adresse privée (DNS) : refusé avant toute requête.
  const n = appels.length;
  await assert.rejects(recupererApercu('https://guide.exemple/', { telecharger, resoudre: async () => ['93.184.216.34', '10.0.0.7'] }), e => e.code === 'apercu-adresse');
  assert.equal(appels.length, n, 'aucune requête quand le DNS donne une adresse privée');
  assert.equal((await recupererApercu('https://guide.exemple/', { telecharger, resoudre: async () => ['93.184.216.34'] })).titre, 'Guide');
  // Délai dépassé : le téléchargeur abandonne (AbortSignal) → 504.
  const lent = async () => {
    const e = new Error('lent');
    e.name = 'TimeoutError';
    throw e;
  };
  await assert.rejects(recupererApercu('https://guide.exemple/', { telecharger: lent }), e => e.code === 'apercu-delai');
  // Téléchargeur réel (fetch simulé) : lecture coupée à la taille maximale, aucune redirection suivie.
  const { telechargeurFetch } = await import('../noyau/ressources/apercu.mjs');
  let options;
  const enorme = `<title>Gros</title>${'x'.repeat(2_000_000)}`;
  const fetchSimule = async (url, init) => {
    options = init;
    return new Response(enorme, { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
  const r = await telechargeurFetch(fetchSimule)('https://gros.exemple/', { delai: 1000, max: 1024 });
  assert.equal(options.redirect, 'manual');
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(r.corps.length <= 1024 && r.corps.startsWith('<title>Gros'));
});

test('filtres et tri purs : catégorie, tag, carte, genre, auteur, favoris, texte sans accents ; épinglées d’abord', () => {
  const r = (id, champs) => ({ id, titre: id, description: '', tags: [], carte: null, agent: null, genre: 'lien', niveau: null, categorie: null, auteur: null, favori: false, epingle: false, apercu: null, fichier: null, creeLe: '2026-10-01', publieLe: '2026-10-01', ...champs });
  const liste = [
    r('a', { tags: ['Viper'], carte: { cle: 'ascent', nom: 'Ascent' }, categorie: { id: 'c1' }, publieLe: '2026-10-03' }),
    r('b', { genre: 'youtube', titre: 'Écran de fumée', auteur: { compte: 'lea' }, favori: true, publieLe: '2026-10-05' }),
    r('c', { epingle: true, publieLe: '2026-09-01' }),
  ];
  assert.deepEqual(filtrerRessources(liste, { categorie: 'c1' }).map(x => x.id), ['a']);
  assert.deepEqual(filtrerRessources(liste, { categorie: 'sans' }).map(x => x.id), ['b', 'c']);
  assert.deepEqual(filtrerRessources(liste, { tag: 'viper' }).map(x => x.id), ['a']);
  assert.deepEqual(filtrerRessources(liste, { carte: 'ascent' }).map(x => x.id), ['a']);
  assert.deepEqual(filtrerRessources(liste, { genre: 'youtube' }).map(x => x.id), ['b']);
  assert.deepEqual(filtrerRessources(liste, { auteur: 'lea' }).map(x => x.id), ['b']);
  assert.deepEqual(filtrerRessources(liste, { favoris: true }).map(x => x.id), ['b']);
  assert.deepEqual(filtrerRessources(liste, { q: 'ECRAN de fumee' }).map(x => x.id), ['b']);
  assert.deepEqual(trierRessources(liste).map(x => x.id), ['c', 'b', 'a']);
});

test('embed Discord : titre, catégorie, type, aperçu, lien de la ressource, aucune mention', () => {
  const e = embedRessource({
    ressource: { titre: 'Lineups @everyone', genre: 'lien', url: 'https://blitz.gg/x', niveau: 'avance', carte: 'Ascent', agent: 'Viper', apercu: { description: 'Guide <@123456789>', image: 'https://blitz.gg/i.png', site: 'Blitz' } },
    categorie: 'Lineups',
    auteur: 'Coach',
    texte: '**Nouvelle ressource** : Lineups',
    team: { nom: 'Faucons' },
    lien: 'https://app.exemple',
    maintenant: Date.parse('2026-10-22T10:00:00Z'),
  });
  assert.match(e.title, /🔗 Lineups @​everyone/);
  assert.equal(e.url, 'https://blitz.gg/x');
  assert.deepEqual(e.fields.map(f => f.name), ['🗂️ Catégorie', '🔗 Type', '📈 Niveau', '🗺️ Map', '🎭 Agent', '✍️ Par']);
  assert.equal(e.image.url, 'https://blitz.gg/i.png');
  assert.ok(!/<@1/.test(e.description));
  const en = embedRessource({ ressource: { titre: 'Note', genre: 'note' }, categorie: '', langue: 'en' });
  assert.deepEqual(en.fields.map(f => f.value), ['No category', 'Note']);
});

// ------------------------------------------------------------------ API

async function preparer(options = {}) {
  const b = await banc(options);
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'coach' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const r = `/teams/${A.teamId}/ressources`;
  return { b, A, B, s, api, r };
}

test('catégories par défaut, création, renommage, ordre et suppression (staff) ; joueur : 403', async () => {
  const { s, api, r } = await preparer();
  const liste = (await api(r, s.lea12345)).corps;
  assert.deepEqual(liste.categories.map(c => c.cleDefaut), ['guides', 'videos_pros', 'lineups', 'aim', 'outils', 'mental', 'divers']);
  assert.deepEqual(liste.moi, { poster: false, gerer: false, staff: false, proposer: false, discord: false, propositionsOuvertes: false });
  // Deux ouvertures simultanées : jamais de doublon.
  await Promise.all([api(r, s.coach123), api(r, s.kai12345)]);
  assert.equal((await api(r, s.coach123)).corps.categories.length, 7);
  assert.equal((await api(`${r}/categories`, s.lea12345, { methode: 'POST', corps: { nom: 'Pépites' } })).statut, 403);
  const cree = await api(`${r}/categories`, s.coach123, { methode: 'POST', corps: { nom: 'Pépites' } });
  assert.equal(cree.statut, 200);
  assert.equal((await api(`${r}/categories`, s.coach123, { methode: 'POST', corps: { nom: 'pepites' } })).corps.code, 'categorie-existe');
  const lineups = liste.categories.find(c => c.cleDefaut === 'lineups');
  const renommee = await api(`${r}/categories/${lineups.id}`, s.coach123, { methode: 'PATCH', corps: { nom: 'Lineups Viper' } });
  assert.deepEqual([renommee.corps.nom, renommee.corps.cleDefaut], ['Lineups Viper', null]);
  const ids = (await api(r, s.coach123)).corps.categories.map(c => c.id);
  const inverse = [...ids].reverse();
  assert.equal((await api(`${r}/categories/ordre`, s.lea12345, { methode: 'PUT', corps: { ids: inverse } })).statut, 403);
  assert.equal((await api(`${r}/categories/ordre`, s.coach123, { methode: 'PUT', corps: { ids: inverse.slice(1) } })).corps.code, 'ordre');
  assert.deepEqual((await api(`${r}/categories/ordre`, s.coach123, { methode: 'PUT', corps: { ids: inverse } })).corps.categories.map(c => c.id), inverse);
  // Supprimer : ses ressources restent, « sans catégorie ».
  const res = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Routine', description: 'Échauffement', categorieId: cree.corps.id } })).corps;
  assert.equal(res.categorie.id, cree.corps.id);
  assert.equal((await api(`${r}/categories/${cree.corps.id}`, s.coach123, { methode: 'DELETE' })).statut, 200);
  const apres = (await api(`${r}/${res.id}`, s.lea12345)).corps;
  assert.equal(apres.categorie, null);
  assert.equal((await api(r, s.lea12345)).corps.sansCategorie, 1);
});

test('publier : lien (aperçu par le serveur), YouTube, note ; joueur sans droit : 403 ; fil, filtres, favoris, réactions, commentaires, « nouveau »', async () => {
  const pages = { 'https://blitz.gg/viper': '<meta property="og:title" content="Viper : lineups B"><meta property="og:description" content="Les lineups"><meta property="og:image" content="https://blitz.gg/v.png">' };
  const { b, A, s, api, r } = await preparer({ apercuLiens: { telecharger: async url => ({ statut: 200, type: 'text/html', location: null, corps: pages[url] ?? '' }) } });
  const cats = (await api(r, s.coach123)).corps.categories;
  const lineups = cats.find(c => c.cleDefaut === 'lineups').id;
  assert.equal((await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'X', description: 'y' } })).statut, 403);
  // Aperçu demandé par le formulaire.
  const ap = await api(`${r}/apercu`, s.coach123, { methode: 'POST', corps: { url: 'https://blitz.gg/viper' } });
  assert.deepEqual([ap.statut, ap.corps.titre, ap.corps.image], [200, 'Viper : lineups B', 'https://blitz.gg/v.png']);
  assert.equal((await api(`${r}/apercu`, s.coach123, { methode: 'POST', corps: { url: 'http://192.168.1.1/' } })).corps.code, 'apercu-adresse');
  assert.equal((await api(`${r}/apercu`, s.lea12345, { methode: 'POST', corps: { url: 'https://blitz.gg/viper' } })).statut, 403);
  // Lien sans titre : celui de l'aperçu.
  const lien = await api(r, s.coach123, { methode: 'POST', corps: { genre: 'lien', url: 'https://blitz.gg/viper', categorieId: lineups, tags: ['Viper', 'B site'], carte: { cle: 'ascent', nom: 'Ascent' }, agent: { cle: 'viper', nom: 'Viper' }, niveau: 'intermediaire', description: 'À **connaître** <script>x</script>' } });
  assert.equal(lien.statut, 200, JSON.stringify(lien.corps));
  assert.deepEqual([lien.corps.titre, lien.corps.apercu.site, lien.corps.statut, lien.corps.auteur.pseudo], ['Viper : lineups B', 'blitz.gg', 'publiee', 'Zed']);
  assert.ok(!lien.corps.description.includes('<script>'), 'description nettoyée (Markdown limité)');
  // Lien vers une IP privée : refusé (pas seulement « sans aperçu »).
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { genre: 'lien', url: 'http://127.0.0.1:80/admin', titre: 'Admin' } })).corps.code, 'apercu-adresse');
  b.horloge.t += 1000;
  // Une adresse YouTube devient une vidéo.
  const video = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'lien', url: 'https://youtu.be/dQw4w9WgXcQ?t=42', titre: 'VOD pro', categorieId: cats.find(c => c.cleDefaut === 'videos_pros').id } })).corps;
  assert.deepEqual([video.genre, video.videoId, video.url], ['youtube', 'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { genre: 'youtube', url: 'https://exemple.fr/v', titre: 'Pas YT' } })).corps.code, 'url-youtube');
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Vide', description: '  ' } })).corps.code, 'note-vide');
  b.horloge.t += 60_000;
  const note = (await api(r, s.fondateur, { methode: 'POST', corps: { genre: 'note', titre: 'Mental avant match', description: '- respirer\n- **focus**', categorieId: cats.find(c => c.cleDefaut === 'mental').id, epingle: true } })).corps;
  assert.equal(note.epingle, true);
  // Fil : épinglée d'abord ; « nouveau » pour Léa (jamais venue : rien de nouveau tant qu'elle n'a pas ouvert le canal une fois).
  let fil = (await api(r, s.lea12345)).corps;
  assert.deepEqual(fil.ressources.map(x => x.titre), ['Mental avant match', 'VOD pro', 'Viper : lineups B']);
  assert.equal(fil.nouveaux, 0);
  assert.equal((await api(`${r}/vu`, s.lea12345, { methode: 'POST' })).statut, 200);
  b.horloge.t += 60_000;
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Aim : routine', description: 'Aimlab 20 min' } });
  fil = (await api(r, s.lea12345)).corps;
  assert.equal(fil.nouveaux, 1);
  assert.deepEqual(fil.ressources.filter(x => x.nouveau).map(x => x.titre), ['Aim : routine']);
  assert.equal((await api(r, s.coach123)).corps.ressources.find(x => x.titre === 'Aim : routine').nouveau, false, 'jamais « nouveau » pour son auteur');
  // Filtres.
  const q = async params => (await b.appel(`${r}?${params}`, { jeton: s.lea12345 })).corps.ressources.map(x => x.titre);
  assert.deepEqual(await q(`categorie=${lineups}`), ['Viper : lineups B']);
  assert.deepEqual(await q('tag=viper'), ['Viper : lineups B']);
  assert.deepEqual(await q('carte=ascent'), ['Viper : lineups B']);
  assert.deepEqual(await q('genre=youtube'), ['VOD pro']);
  assert.deepEqual(await q('auteur=principal'), ['Mental avant match']);
  assert.deepEqual(await q('q=ROUTINE'), ['Aim : routine']);
  assert.deepEqual(await q('niveau=intermediaire'), ['Viper : lineups B']);
  assert.equal((await b.appel(`${r}?genre=inconnu`, { jeton: s.lea12345 })).statut, 400);
  // Favoris personnels.
  assert.equal((await api(`${r}/${video.id}/favori`, s.lea12345, { methode: 'PUT' })).statut, 200);
  assert.deepEqual(await q('favoris=1'), ['VOD pro']);
  assert.equal((await b.appel(`${r}?favoris=1`, { jeton: s.kai12345 })).corps.ressources.length, 0, 'les favoris sont personnels');
  // Réactions et commentaires.
  assert.equal((await api(`${r}/${video.id}/reactions`, s.lea12345, { methode: 'PUT', corps: { emoji: '💩' } })).corps.code, 'emoji');
  await api(`${r}/${video.id}/reactions`, s.lea12345, { methode: 'PUT', corps: { emoji: '👍' } });
  await api(`${r}/${video.id}/reactions`, s.lea12345, { methode: 'PUT', corps: { emoji: '👍' } });
  const reac = (await api(`${r}/${video.id}/reactions`, s.kai12345, { methode: 'PUT', corps: { emoji: '👍' } })).corps.reactions;
  assert.deepEqual(reac, [{ emoji: '👍', n: 2, moi: true }]);
  assert.deepEqual((await api(`${r}/${video.id}/reactions`, s.kai12345, { methode: 'PUT', corps: { emoji: '👍', actif: false } })).corps.reactions, [{ emoji: '👍', n: 1, moi: false }]);
  const com = await api(`${r}/${video.id}/commentaires`, s.lea12345, { methode: 'POST', corps: { texte: 'Top, le **retake** à 3:12' } });
  assert.equal(com.corps.listeCommentaires.length, 1);
  assert.equal(com.corps.commentaires, 1);
  const cid = com.corps.listeCommentaires[0].id;
  assert.equal((await api(`${r}/${video.id}/commentaires/${cid}`, s.kai12345, { methode: 'DELETE' })).statut, 403, 'un autre joueur ne supprime pas le commentaire');
  // L'auteur de la vidéo (Zed) est prévenu du commentaire.
  const notifs = (await api('/notifications', s.coach123)).corps.liste;
  assert.ok(notifs.some(n => n.type === 'ressource-commentaire' && n.charge.titre === 'VOD pro'));
  // Droits de modification : le joueur ne modifie ni ne supprime la ressource du coach.
  assert.equal((await api(`${r}/${video.id}`, s.lea12345, { methode: 'PATCH', corps: { titre: 'Pirate' } })).statut, 403);
  assert.equal((await api(`${r}/${video.id}`, s.lea12345, { methode: 'DELETE' })).statut, 403);
  assert.equal((await api(`${r}/${video.id}`, s.lea12345, { methode: 'PATCH', corps: { epingle: true } })).statut, 403);
  assert.equal((await api(`${r}/${video.id}`, s.coach123, { methode: 'PATCH', corps: { titre: 'VOD pro (TenZ)' } })).corps.titre, 'VOD pro (TenZ)');
  // Journal : tout passe par le bus.
  const journal = await b.base.tous("SELECT action FROM journal WHERE team_id = ? AND action LIKE 'resource%'", [A.teamId]);
  for (const a of ['resource.created', 'resource.commented', 'resource.reaction_changed', 'resource.updated']) assert.ok(journal.some(j => j.action === a), a);
});

test('visibilité « staff seulement » : invisible pour le joueur (liste, détail, réaction, commentaire : 404) ; un joueur ne peut pas en créer', async () => {
  const { s, api, r } = await preparer();
  const staff = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Plan anti-Nova (staff)', description: 'Secret', visibilite: 'staff' } })).corps;
  assert.equal(staff.visibilite, 'staff');
  assert.ok(!(await api(r, s.lea12345)).corps.ressources.some(x => x.id === staff.id));
  assert.ok((await api(r, s.fondateur)).corps.ressources.some(x => x.id === staff.id));
  for (const [chemin, methode, corps] of [
    [`${r}/${staff.id}`, 'GET'],
    [`${r}/${staff.id}/reactions`, 'PUT', { emoji: '👍' }],
    [`${r}/${staff.id}/commentaires`, 'POST', { texte: 'vu' }],
    [`${r}/${staff.id}/favori`, 'PUT'],
  ]) assert.equal((await api(chemin, s.lea12345, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  // Propositions ouvertes : le joueur propose, mais jamais « staff seulement ».
  await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { propositions: true } });
  assert.equal((await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Astuce', description: 'x', visibilite: 'staff' } })).statut, 403);
});

test('file de validation : « les joueurs peuvent proposer », proposition invisible des autres, validation, refus, correction', async () => {
  const { b, s, api, r } = await preparer();
  assert.equal((await api(`${r}/reglages`, s.lea12345, { methode: 'PATCH', corps: { propositions: true } })).statut, 403);
  assert.deepEqual((await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { propositions: true } })).corps.propositions, true);
  assert.equal((await api(r, s.lea12345)).corps.moi.proposer, true);
  const prop = (await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Crosshair de TenZ', description: '0;P;c;5', epingle: true } }));
  assert.equal(prop.statut, 403, 'un joueur n’épingle pas');
  const p1 = (await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Crosshair de TenZ', description: '0;P;c;5' } })).corps;
  assert.deepEqual([p1.statut, p1.moi.valider], ['proposee', false]);
  assert.ok(!(await api(r, s.kai12345)).corps.ressources.some(x => x.id === p1.id), 'Kai ne voit pas la proposition');
  assert.equal((await api(`${r}/${p1.id}`, s.kai12345)).statut, 404);
  assert.equal((await api(`${r}/${p1.id}/reactions`, s.lea12345, { methode: 'PUT', corps: { emoji: '👍' } })).corps.code, 'pas-publiee');
  const mesProps = (await b.appel(`${r}?miennes=1`, { jeton: s.lea12345 })).corps;
  assert.deepEqual(mesProps.ressources.map(x => x.titre), ['Crosshair de TenZ']);
  // Le staff la voit dans la file, et en est prévenu.
  const file = (await b.appel(`${r}?file=1`, { jeton: s.coach123 })).corps;
  assert.deepEqual([file.file, file.ressources.map(x => x.id)], [1, [p1.id]]);
  assert.deepEqual((await b.appel(`${r}?file=1`, { jeton: s.kai12345 })).corps.ressources, []);
  assert.ok((await api('/notifications', s.coach123)).corps.liste.some(n => n.type === 'ressource-proposee'));
  assert.equal((await api(`${r}/${p1.id}/valider`, s.kai12345, { methode: 'POST' })).statut, 404, 'invisible pour Kai');
  assert.equal((await api(`${r}/${p1.id}/valider`, s.lea12345, { methode: 'POST' })).statut, 403);
  const outils = (await api(r, s.coach123)).corps.categories.find(c => c.cleDefaut === 'outils').id;
  const v = (await api(`${r}/${p1.id}/valider`, s.coach123, { methode: 'POST', corps: { categorieId: outils } })).corps;
  assert.deepEqual([v.statut, v.categorie.id, v.validePar.pseudo, v.auteur.pseudo], ['publiee', outils, 'Zed', 'Léa']);
  assert.ok((await api(r, s.kai12345)).corps.ressources.some(x => x.id === p1.id), 'publiée : Kai la voit');
  assert.ok((await api('/notifications', s.lea12345)).corps.liste.some(n => n.type === 'ressource-validee'));
  assert.equal((await api(`${r}/${p1.id}/valider`, s.coach123, { methode: 'POST' })).corps.code, 'pas-proposee');
  // Publiée : son auteur (joueur) ne la modifie plus, mais peut la retirer.
  assert.equal((await api(`${r}/${p1.id}`, s.lea12345, { methode: 'PATCH', corps: { titre: 'Autre' } })).statut, 403);
  // Refus, puis correction : elle repart dans la file.
  const p2 = (await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'lien', url: 'https://exemple.fr/guide', titre: 'Guide douteux' } })).corps;
  const refus = (await api(`${r}/${p2.id}/refuser`, s.coach123, { methode: 'POST', corps: { motif: 'Source peu fiable' } })).corps;
  assert.deepEqual([refus.statut, refus.motifRefus], ['refusee', 'Source peu fiable']);
  assert.ok((await api('/notifications', s.lea12345)).corps.liste.some(n => n.type === 'ressource-refusee' && n.charge.motif === 'Source peu fiable'));
  const corrigee = (await api(`${r}/${p2.id}`, s.lea12345, { methode: 'PATCH', corps: { titre: 'Guide officiel' } })).corps;
  assert.deepEqual([corrigee.statut, corrigee.motifRefus], ['proposee', null]);
  assert.equal((await api(`${r}/${p1.id}`, s.lea12345, { methode: 'DELETE' })).statut, 200);
  // Propositions fermées : retour au 403.
  await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { propositions: false } });
  assert.equal((await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Encore', description: 'x' } })).statut, 403);
});

test('isolation entre teams (tests négatifs) : un membre de B ne voit ni ne touche rien de A ; module désactivé : 404', async () => {
  const { A, B, s, api, r } = await preparer();
  const res = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Secret A', description: 'x' } })).corps;
  const cat = (await api(r, s.coach123)).corps.categories[0];
  for (const [chemin, methode, corps] of [
    [r, 'GET'],
    [r, 'POST', { genre: 'note', titre: 'Intrus', description: 'x' }],
    [`${r}/${res.id}`, 'GET'],
    [`${r}/${res.id}`, 'PATCH', { titre: 'x' }],
    [`${r}/${res.id}`, 'DELETE'],
    [`${r}/${res.id}/reactions`, 'PUT', { emoji: '👍' }],
    [`${r}/${res.id}/commentaires`, 'POST', { texte: 'x' }],
    [`${r}/${res.id}/favori`, 'PUT'],
    [`${r}/categories`, 'POST', { nom: 'Intrus' }],
    [`${r}/categories/${cat.id}`, 'DELETE'],
    [`${r}/reglages`, 'PATCH', { propositions: true }],
    [`${r}/envois`, 'POST', { nom: 'a.pdf', taille: 100 }],
  ]) assert.equal((await api(chemin, s.nox12345, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  // Une ressource de A appelée par la route de B : introuvable aussi.
  assert.equal((await api(`/teams/${B.teamId}/ressources/${res.id}`, s.nox12345)).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/ressources/categories/${cat.id}`, s.nox12345, { methode: 'PATCH', corps: { nom: 'Volée' } })).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/ressources/${res.id}/valider`, s.nox12345, { methode: 'POST' })).statut, 404);
  assert.equal((await api(`${r}/${res.id}`, s.coach123)).corps.titre, 'Secret A');
  // Module désactivé : 404, données gardées.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { resources: false } } });
  assert.equal((await api(r, s.coach123)).corps.code, 'module-desactive');
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { resources: true } } });
  assert.equal((await api(`${r}/${res.id}`, s.lea12345)).corps.titre, 'Secret A');
});

test('fichier déposé par morceaux (PDF), stockage privé, lien signé ; format refusé ; suppression efface les octets', async () => {
  const { b, s, api, r, A } = await preparer();
  const pdf = new TextEncoder().encode(`%PDF-1.4\n${'contenu du guide '.repeat(200)}\n%%EOF`);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const refuse = await envoyer(b, s.coach123, A.teamId, svg, { section: 'ressources', nom: 'x.svg' });
  assert.equal(refuse.morceaux[0].corps.code, 'format-fichier');
  assert.equal((await envoyer(b, s.lea12345, A.teamId, pdf, { section: 'ressources', nom: 'guide.pdf' })).debut.statut, 403, 'un joueur sans droit ne dépose pas');
  const envoi = await envoyer(b, s.coach123, A.teamId, pdf, { section: 'ressources', nom: 'Guide Viper.pdf' });
  assert.equal(envoi.fin.statut, 200);
  const res = await api(r, s.coach123, { methode: 'POST', corps: { genre: 'fichier', envoi: envoi.id, titre: '' } });
  assert.equal(res.statut, 200, JSON.stringify(res.corps));
  assert.deepEqual([res.corps.titre, res.corps.fichier.type, res.corps.fichier.taille], ['Guide Viper.pdf', 'application/pdf', pdf.length]);
  assert.equal((await api(r, s.coach123, { methode: 'POST', corps: { genre: 'fichier', envoi: envoi.id, titre: 'Encore' } })).corps.code, 'envoi-rattache');
  // Lecture par lien signé (le joueur peut lire) ; le fichier est privé : jamais sans lien.
  const lien = await api(`${r}/${res.corps.id}/fichier/lien`, s.lea12345, { methode: 'POST' });
  assert.equal(lien.statut, 200);
  const lu = await b.brut(lien.corps.url);
  assert.equal(lu.status, 200);
  assert.equal(lu.headers.get('Content-Type'), 'application/pdf');
  assert.equal(sha(new Uint8Array(await lu.arrayBuffer())), sha(pdf));
  assert.equal((await b.brut(lien.corps.url.replace(/sig=[^&]+/, 'sig=faux'))).status, 403);
  // Espace utilisé : le fichier y figure ; supprimer la ressource libère l'espace.
  const espace = (await api(`/teams/${A.teamId}/espace`, s.fondateur)).corps;
  assert.ok(espace.fichiers.some(f => f.nature === 'ressource' && f.cible.titre === 'Guide Viper.pdf'));
  assert.equal((await api(`${r}/${res.corps.id}`, s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.brut(lien.corps.url)).status, 404);
  const f = await b.base.premier('SELECT supprime_le FROM fichiers WHERE entite_id = ?', [res.corps.id]);
  assert.ok(f.supprime_le, 'octets effacés');
});

test('« Ouvrir en review vidéo » : crée la review YouTube une fois, puis la rouvre ; pas pour un lien', async () => {
  const { s, api, r, A } = await preparer();
  const video = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titre: 'Retake B' } })).corps;
  const o = (await api(`${r}/${video.id}/review`, s.coach123, { methode: 'POST' })).corps;
  assert.equal(o.cree, true);
  const review = (await api(`/teams/${A.teamId}/review/${o.reviewId}`, s.lea12345)).corps;
  assert.equal(review.review.titre, 'Retake B');
  assert.deepEqual((await api(`${r}/${video.id}/review`, s.lea12345, { methode: 'POST' })).corps, { reviewId: o.reviewId, cree: false }, 'le joueur rouvre la review existante');
  const lien = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'lien', url: 'https://exemple.fr/a', titre: 'Page' } })).corps;
  assert.equal((await api(`${r}/${lien.id}/review`, s.coach123, { methode: 'POST' })).corps.code, 'pas-youtube');
  const autre = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'youtube', url: 'https://youtu.be/aaaaaaaaaaa', titre: 'Autre' } })).corps;
  assert.equal((await api(`${r}/${autre.id}/review`, s.lea12345, { methode: 'POST' })).statut, 403, 'un joueur ne crée pas de review');
});

test('publication multi-teams (Fondateur) : tout ou rien, catégorie retrouvée ou créée ; un coach ne publie pas chez les autres', async () => {
  const { b, A, B, s, api } = await preparer();
  const teams = (await api('/ressources/teams', s.fondateur)).corps.teams;
  // + la Team CM (migration 0068 : module Ressources activé).
  assert.deepEqual(teams.map(t => t.id).sort(), [A.teamId, B.teamId, '00000000-0000-4000-8000-00000000c0de'].sort());
  assert.deepEqual((await api('/ressources/teams', s.coach123)).corps.teams.map(t => t.id), [A.teamId]);
  assert.deepEqual((await api('/ressources/teams', s.lea12345)).corps.teams, []);
  const multi = await api('/ressources/multi', s.fondateur, { methode: 'POST', corps: { teams: [A.teamId, B.teamId], genre: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', titre: 'Masterclass Sova', categorie: { cleDefaut: 'videos_pros' }, tags: ['sova'] } });
  assert.equal(multi.statut, 200, JSON.stringify(multi.corps));
  assert.equal(multi.corps.ressources.length, 2);
  for (const { teamId, id } of multi.corps.ressources) {
    const det = (await api(`/teams/${teamId}/ressources/${id}`, s.fondateur)).corps;
    assert.deepEqual([det.titre, det.categorie.cleDefaut, det.multiTeams], ['Masterclass Sova', 'videos_pros', true]);
  }
  assert.equal((await api(`/teams/${B.teamId}/ressources`, s.nox12345)).corps.total, 1);
  // Catégorie par nom : créée là où elle manque.
  const parNom = await api('/ressources/multi', s.fondateur, { methode: 'POST', corps: { teams: [A.teamId, B.teamId], genre: 'note', titre: 'Code de conduite', description: 'Respect', categorie: { nom: 'Règles' } } });
  assert.equal(parNom.statut, 200);
  assert.ok((await api(`/teams/${B.teamId}/ressources`, s.nox12345)).corps.categories.some(c => c.nom === 'Règles'));
  // Un coach de A seulement : 404 pour B, et RIEN n'est écrit dans A (tout ou rien).
  const avant = (await b.base.premier('SELECT COUNT(*) AS n FROM ressources', [])).n;
  assert.equal((await api('/ressources/multi', s.coach123, { methode: 'POST', corps: { teams: [A.teamId, B.teamId], genre: 'note', titre: 'Intrusion', description: 'x' } })).statut, 404);
  assert.equal((await api('/ressources/multi', s.lea12345, { methode: 'POST', corps: { teams: [A.teamId], genre: 'note', titre: 'Joueur', description: 'x' } })).statut, 403);
  assert.equal((await api('/ressources/multi', s.fondateur, { methode: 'POST', corps: { teams: [A.teamId], genre: 'fichier', titre: 'F' } })).statut, 400);
  assert.equal((await api('/ressources/multi', s.fondateur, { methode: 'POST', corps: { teams: [], genre: 'note', titre: 'F', description: 'x' } })).statut, 400);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM ressources', [])).n), Number(avant));
});

test('Discord : « Nouvelle ressource » désactivé par défaut ; activé : embed dans le salon de la team, jamais pour le staff ; salon dédié (webhook ou bot)', async () => {
  const envois = [];
  const fetchDiscord = async (url, init) => {
    envois.push({ url, corps: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: '99999999999' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { b, A, s, api, r } = await preparer({ fetchDiscord, lienApp: 'https://app.exemple', cleDiscord: 'cle-discord-de-test-0123456789abcdef0123' });
  assert.equal((await api(`/teams/${A.teamId}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: URL_TEST } })).statut, 200);
  const param = (await api(`/teams/${A.teamId}/discord`, s.fondateur)).corps.parametres.find(x => x.cle === 'resource_created');
  assert.deepEqual([param.actif, param.disponible], [false, true]);
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Sans Discord', description: 'x' } });
  assert.equal(envois.length, 0, 'désactivé par défaut');
  await api(`/teams/${A.teamId}/discord/parametres/resource_created`, s.fondateur, { methode: 'PUT', corps: { actif: true } });
  const lineups = (await api(r, s.coach123)).corps.categories.find(c => c.cleDefaut === 'lineups').id;
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', titre: 'Lineups Viper Ascent', categorieId: lineups, niveau: 'avance' } });
  assert.equal(envois.length, 1);
  assert.equal(envois[0].url, URL_TEST);
  const embed = envois[0].corps.embeds[0];
  assert.match(embed.title, /Lineups Viper Ascent/);
  assert.equal(embed.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(embed.fields.slice(0, 3).map(f => f.value), ['Lineups', 'Vidéo YouTube', 'Avancé']);
  assert.equal(embed.image.url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.match(embed.description, /Nouvelle ressource/);
  assert.deepEqual(envois[0].corps.components[0].components.map(c => c.url), ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://app.exemple']);
  assert.deepEqual(envois[0].corps.allowed_mentions, { parse: [] });
  // Staff seulement : jamais sur Discord.
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Plan staff', description: 'x', visibilite: 'staff' } });
  assert.equal(envois.length, 1);
  // Proposition : rien à la proposition, l'embed part à la validation.
  await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { propositions: true } });
  const prop = (await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Astuce de Léa', description: 'x' } })).corps;
  assert.equal(envois.length, 1);
  await api(`${r}/${prop.id}/valider`, s.coach123, { methode: 'POST' });
  assert.equal(envois.length, 2);
  assert.ok(envois[1].corps.embeds[0].fields.some(f => f.value === 'Léa'));
  // Salon dédié par webhook : réservé à discord.manage ; adresse chiffrée, jamais renvoyée.
  const DEDIE = 'https://discord.com/api/webhooks/987654321098765432/ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_wxyz';
  assert.equal((await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { discord: { webhook: DEDIE } } })).statut, 403, 'le coach n’a pas discord.manage');
  const reg = (await api(`${r}/reglages`, s.fondateur, { methode: 'PATCH', corps: { discord: { webhook: DEDIE } } })).corps;
  assert.deepEqual(reg.discord.webhook, { configure: true, masque: '…/wxyz' });
  assert.ok(!JSON.stringify(reg).includes('ZyXwVu'));
  const stocke = await b.base.premier('SELECT discord_webhook FROM ressource_reglages WHERE team_id = ?', [A.teamId]);
  assert.ok(!stocke.discord_webhook.includes('ZyXwVu'), 'webhook chiffré au repos');
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Dans le salon dédié', description: 'x' } });
  assert.equal(envois.length, 3);
  assert.equal(envois[2].url, DEDIE);
  // Bot lié + salon dédié du bot : le message part dans ce salon.
  const t = new Date(b.horloge.t).toISOString();
  await b.base.executer('INSERT INTO discord_serveurs (team_id, guild_id, salon_id, lie_par_discord, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', [A.teamId, '111111111111', '222222222222', '333333333333', t, t]);
  await api(`${r}/reglages`, s.fondateur, { methode: 'PATCH', corps: { discord: { salonId: '444444444444' } } });
  assert.equal((await api(`${r}/reglages`, s.fondateur, { methode: 'PATCH', corps: { discord: { salonId: '#general' } } })).corps.code, 'salon');
  b.horloge.t += 60_000;
  await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Par le bot', description: 'x' } });
  const ligne = await b.base.premier("SELECT canal, salon_id FROM discord_file WHERE cle = 'resource_created' ORDER BY cree_le DESC, id DESC LIMIT 1", []);
  assert.deepEqual([ligne.canal, ligne.salon_id], ['bot', '444444444444']);
  // Journal : réglages changés, jamais l'adresse.
  const j = await b.base.tous("SELECT meta FROM journal WHERE action = 'resources.settings_changed'", []);
  assert.ok(j.length >= 2 && j.every(x => !x.meta.includes('discord.com')));
});

test('RGPD : export (ressources, commentaires, réactions, favoris) ; suppression du compte : ressource anonyme qui reste, favoris et réactions effacés', async () => {
  const { b, s, api, r } = await preparer();
  await api(`${r}/reglages`, s.coach123, { methode: 'PATCH', corps: { propositions: true } });
  const res = (await api(r, s.coach123, { methode: 'POST', corps: { genre: 'note', titre: 'Guide commun', description: 'x' } })).corps;
  const deLea = (await api(r, s.lea12345, { methode: 'POST', corps: { genre: 'note', titre: 'Astuce de Léa', description: 'y' } })).corps;
  await api(`${r}/${deLea.id}/valider`, s.coach123, { methode: 'POST' });
  await api(`${r}/${res.id}/reactions`, s.lea12345, { methode: 'PUT', corps: { emoji: '🔥' } });
  await api(`${r}/${res.id}/favori`, s.lea12345, { methode: 'PUT' });
  await api(`${r}/${res.id}/commentaires`, s.lea12345, { methode: 'POST', corps: { texte: 'Merci !' } });
  const exp = (await api('/moi/export', s.lea12345)).corps;
  assert.deepEqual(exp.ressources.map(x => x.titre), ['Astuce de Léa']);
  assert.deepEqual(exp.ressourcesCommentaires.map(x => x.texte), ['Merci !']);
  assert.deepEqual(exp.ressourcesReactions.map(x => x.reaction), ['🔥']);
  assert.deepEqual(exp.ressourcesFavoris.map(x => x.ressource), ['Guide commun']);
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  const reste = (await api(`${r}/${deLea.id}`, s.coach123)).corps;
  assert.deepEqual([reste.titre, reste.auteur], ['Astuce de Léa', null], 'la ressource reste, anonyme');
  const guide = (await api(`${r}/${res.id}`, s.coach123)).corps;
  assert.deepEqual(guide.reactions, []);
  assert.deepEqual(guide.listeCommentaires.map(c => [c.texte, c.auteur]), [['Merci !', null]]);
  for (const table of ['ressource_favoris', 'ressource_reactions', 'ressource_visites']) {
    assert.equal(Number((await b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE compte_id = ?`, ['lea12345'])).n), 0, table);
  }
});

test('téléchargeur Node : l’adresse est vérifiée AU MOMENT DE LA CONNEXION (un nom qui pointe vers 127.0.0.1 est refusé)', async () => {
  const http = await import('node:http');
  const { telechargeurNode } = await import('../adaptateurs/apercuNode.mjs');
  let atteint = false;
  const serveur = http.createServer((req, res) => {
    atteint = true;
    res.end('<title>interne</title>');
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const port = serveur.address().port;
  try {
    await assert.rejects(telechargeurNode()(`http://localhost:${port}/`, { delai: 2000, max: 1024 }), e => e.code === 'apercu-adresse');
    assert.equal(atteint, false, 'le serveur interne n’a jamais été joint');
    const { lookupPublic } = await import('../adaptateurs/apercuNode.mjs');
    const erreur = await new Promise(ok => lookupPublic('localhost', {}, err => ok(err)));
    assert.equal(erreur?.code, 'apercu-adresse');
  } finally {
    serveur.close();
  }
});
