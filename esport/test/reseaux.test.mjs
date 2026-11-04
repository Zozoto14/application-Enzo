/**
 * Page « Réseaux » de l'espace CM (migration 0026) :
 *  - règles pures : adresses de profil par réseau, compte d'un post, type de contenu, nombres saisis, engagement,
 *    évolutions, correspondance des colonnes CSV ;
 *  - migration sur une base existante ;
 *  - comptes : validation des adresses (https, domaine attendu), identifiant cohérent, doublons, PERMISSIONS
 *    (cm.gerer pour configurer, cm.voir pour consulter, une team ne voit que ses comptes, 404 sans cm.voir) ;
 *  - bot d'annonce Discord sur `cm.post_publie` : anglais + fil français, rôle mentionné, visuel ; IDEMPOTENCE
 *    (republier, dépublier / republier, modifier la carte : rien de plus), plusieurs réseaux, adresse changée
 *    (message réédité, pas doublé), compte désactivé, annonce désactivée, salon du club chiffré, test, aperçu ;
 *  - statistiques : publications suivies, relevés datés, engagement, évolution, tableau de bord, rappels J+1 / J+7 ;
 *  - import CSV (correspondance, lignes malformées, adresse inconnue, création, réimport idempotent) et export CSV
 *    (formules neutralisées) ; adaptateur d'API ; RGPD ; export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { TYPES_IMPORTANTS } from '../noyau/recap.mjs';
import { rappelsReseaux } from '../noyau/reseaux/rappels.mjs';
import { traiterAnnoncesReseaux, validerModeleAnnonce } from '../noyau/reseaux/annonces.mjs';
import { releverAutomatiquement, registreAdaptateurs } from '../noyau/reseaux/adaptateurs.mjs';
import {
  CHAMPS_IMPORT_POSTS,
  compteDuPost,
  correspondanceProposee,
  evolutionAbonnes,
  evolutionPost,
  identifiantDansUrlPost,
  lireDecimal,
  lireEntier,
  lireJour,
  tauxEngagement,
  tauxEngagementGlobal,
  typeContenuDeCarte,
  validerUrlProfil,
  validerUrlPublication,
} from '../noyau/reseaux/regles.mjs';

const JETON_BOT = 'jeton-bot-de-test-jamais-reel';
const ROLE_FANS = '930000000000000001';
const URL_SALON_CLUB = 'https://discord.com/api/webhooks/555555555555555555/ClubWebhookJetonDeTest0123456789abcdefWXYZ';

// ------------------------------------------------------------------ Règles pures

test('règles : adresses de profil par réseau (https, domaine attendu, page du compte), identifiant lu dans un post', () => {
  assert.deepEqual(validerUrlProfil('https://x.com/Club_GG', 'x'), { url: 'https://x.com/Club_GG', identifiant: 'Club_GG' });
  assert.equal(validerUrlProfil('https://twitter.com/club_gg/', 'x').identifiant, 'club_gg');
  assert.equal(validerUrlProfil('https://www.instagram.com/club.gg/', 'instagram').identifiant, 'club.gg');
  assert.equal(validerUrlProfil('https://www.tiktok.com/@club.gg', 'tiktok').identifiant, 'club.gg');
  assert.equal(validerUrlProfil('https://www.youtube.com/@ClubGG', 'youtube').identifiant, 'ClubGG');
  assert.equal(validerUrlProfil('https://www.twitch.tv/clubgg', 'twitch').identifiant, 'clubgg');
  for (const [url, reseau] of [
    ['http://x.com/club', 'x'],
    ['https://x.com.site-exemple.fr/club', 'x'],
    ['https://instagram.com/club', 'x'],
    ['https://x.com/club/status/1', 'x'],
    ['https://x.com/home', 'x'],
    ['https://www.instagram.com/p/abc/', 'instagram'],
    ['https://www.tiktok.com/club', 'tiktok'],
    ['https://user:mdp@x.com/club', 'x'],
    ['https://x.com:8443/club', 'x'],
    ['javascript:alert(1)', 'x'],
    ['https://x.com/club', 'mastodon'],
  ]) assert.deepEqual(validerUrlProfil(url, reseau), { erreur: 'url' }, `${reseau} ${url}`);
  assert.equal(identifiantDansUrlPost('https://x.com/Club_GG/status/1234', 'x'), 'Club_GG');
  assert.equal(identifiantDansUrlPost('https://x.com/i/web/status/1234', 'x'), null);
  assert.equal(identifiantDansUrlPost('https://www.tiktok.com/@club.gg/video/42', 'tiktok'), 'club.gg');
  assert.equal(identifiantDansUrlPost('https://www.instagram.com/p/abc/', 'instagram'), null);
  assert.equal(validerUrlPublication('https://youtu.be/abc123', 'youtube'), 'https://youtu.be/abc123');
  assert.equal(validerUrlPublication('https://site-exemple.fr/abc', 'youtube'), null);
});

test('règles : compte d’un post (identifiant de l’adresse, team, club), type de contenu, nombres, engagement, évolutions, CSV', () => {
  const comptes = [
    { id: 'c1', reseau: 'x', identifiant: 'Club_GG', team_id: null, actif: 1, position: 1 },
    { id: 'c2', reseau: 'x', identifiant: 'AlphaGG', team_id: 'tA', actif: 1, position: 2 },
    { id: 'c3', reseau: 'instagram', identifiant: 'club.gg', team_id: null, actif: 1, position: 3 },
    { id: 'c4', reseau: 'tiktok', identifiant: 'club.gg', team_id: null, actif: 0, position: 4 },
  ];
  assert.equal(compteDuPost({ url: 'https://x.com/alphagg/status/1', reseau: 'x' }, comptes).id, 'c2', 'identifiant lu dans l’adresse');
  assert.equal(compteDuPost({ url: 'https://x.com/inconnu/status/1', reseau: 'x', teamId: 'tA' }, comptes), null, 'autre compte : aucune annonce à son nom');
  assert.equal(compteDuPost({ url: 'https://x.com/i/web/status/1', reseau: 'x', teamId: 'tA' }, comptes).id, 'c2', 'team de la carte');
  assert.equal(compteDuPost({ url: 'https://x.com/i/web/status/1', reseau: 'x' }, comptes).id, 'c1', 'club');
  assert.equal(compteDuPost({ url: 'https://www.instagram.com/p/abc/', reseau: 'instagram', teamId: 'tA' }, comptes).id, 'c3');
  assert.equal(compteDuPost({ url: 'https://www.tiktok.com/@club.gg/video/1', reseau: 'tiktok' }, comptes), null, 'compte inactif');
  assert.equal(typeContenuDeCarte({ origine: 'suggestion', origine_cle: 'resultat:x' }), 'resultat');
  assert.equal(typeContenuDeCarte({ origine: 'suggestion', origine_cle: 'jourj:x' }), 'match');
  assert.equal(typeContenuDeCarte({ origine: 'suggestion', origine_cle: 'tournoi:x' }), 'annonce');
  assert.equal(typeContenuDeCarte({ origine: 'manuel', liens: { clips: ['a'] } }), 'clip');
  assert.equal(typeContenuDeCarte({ origine: 'manuel', liens: { sponsors: ['a'] } }), 'sponsor');
  assert.equal(typeContenuDeCarte({ origine: 'manuel' }), 'autre');
  assert.equal(lireEntier('1 234'), 1234);
  assert.equal(lireEntier('1,234'), 1234);
  assert.equal(lireEntier('12,5 k'), 12500);
  assert.equal(lireEntier('1.2M'), 1_200_000);
  assert.equal(lireEntier(''), null);
  for (const x of ['-3', '1,5', 'abc', '1e3', {}]) assert.equal(lireEntier(x), undefined, String(x));
  assert.equal(lireDecimal('12,5'), 12.5);
  assert.equal(lireDecimal('62 %'), 62);
  assert.equal(lireDecimal('1:05'), 65);
  assert.equal(lireDecimal('x'), undefined);
  assert.equal(lireJour('03/11/2026'), '2026-11-03');
  assert.equal(lireJour('2026-02-30'), null);
  // Engagement : (likes + commentaires + partages + enregistrements) / impressions (sinon portée, sinon vues).
  assert.equal(tauxEngagement({ vues: 1000, likes: 80, commentaires: 10, partages: 5, enregistrements: 5 }), 10);
  assert.equal(tauxEngagement({ impressions: 2000, vues: 1000, likes: 80, commentaires: 10, partages: 5, enregistrements: 5 }), 5);
  assert.equal(tauxEngagement({ portee: 400, likes: 3 }), 0.75);
  assert.equal(tauxEngagement({ likes: 3 }), null, 'sans base');
  assert.equal(tauxEngagement({ vues: 0, likes: 3 }), null, 'base nulle');
  assert.equal(tauxEngagement({ vues: 100 }), null, 'sans interaction relevée');
  assert.equal(tauxEngagementGlobal([{ vues: 100, likes: 10 }, { vues: 300, likes: 10 }, { likes: 99 }]), 5);
  const ev = evolutionPost([{ jour: '2026-10-28', vues: 900, likes: 50 }, { jour: '2026-10-22', vues: 300, likes: 20 }], '2026-10-21');
  assert.deepEqual(ev.map(e => [e.jour, e.jPlus, e.ecartVues, e.ecartInteractions]), [['2026-10-22', 1, null, null], ['2026-10-28', 7, 600, 30]]);
  const ab = evolutionAbonnes([{ jour: '2026-09-25', abonnes: 1000 }, { jour: '2026-10-10', abonnes: 1100 }, { jour: '2026-10-20', abonnes: 1250 }, { jour: '2026-11-02', abonnes: 1300 }], '2026-10-01', '2026-10-31');
  assert.deepEqual([ab.debut, ab.fin, ab.variation, ab.variationPct, ab.serie.length], [1000, 1250, 250, 25, 3]);
  assert.deepEqual(correspondanceProposee(['Post URL', 'Date', 'Views', 'Likes', 'Comments', 'Shares', 'Saves', 'Reach', 'Average watch time', 'Inconnue'], CHAMPS_IMPORT_POSTS), {
    0: 'url', 1: 'jour', 2: 'vues', 3: 'likes', 4: 'commentaires', 5: 'partages', 6: 'enregistrements', 7: 'portee', 8: 'duree_moyenne',
  });
  // Modèle d'annonce : variables permises seulement.
  assert.equal(validerModeleAnnonce('  '), null);
  assert.equal(validerModeleAnnonce('{reseau} · {compte} · {url} · {titre} · {team}'), '{reseau} · {compte} · {url} · {titre} · {team}');
  assert.throws(() => validerModeleAnnonce('Hello {pseudo}'), e => e.code === 'variable-inconnue');
});

// ------------------------------------------------------------------ Migration

test('migration 0026 sur une base existante : tables créées, rien d’autre touché ; export, récapitulatif', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0026'));
  const avant = await base.tous("SELECT COUNT(*) AS n FROM cm_role_permissions", []);
  assert.deepEqual(await appliquerMigrations(base, migrations.filter(m => m.nom < '0027')), ['0026_cm_reseaux.sql']);
  assert.deepEqual(await base.tous("SELECT COUNT(*) AS n FROM cm_role_permissions", []), avant);
  for (const t of ['cm_rs_salons', 'cm_rs_comptes', 'cm_rs_cibles', 'cm_rs_publications', 'cm_rs_releves_posts', 'cm_rs_releves_comptes', 'cm_rs_annonces']) {
    assert.equal((await base.tous(`SELECT * FROM ${t}`, [])).length, 0, t);
    assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
  }
  assert.ok(TYPES_IMPORTANTS.includes('cm-releve'));
});

// ------------------------------------------------------------------ Banc

/** Faux Discord : webhooks (?wait=true, thread_id), API du bot (messages, fils, éditions). Corps JSON ou multipart. */
function fauxDiscord() {
  const appels = [];
  let n = 0;
  const nouvelId = () => `9${String(++n).padStart(17, '0')}`;
  const repondre = (statut, corps) => new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init) => {
    const u = new URL(String(url));
    let corps = null;
    let fichiers = [];
    if (init.body instanceof FormData) {
      corps = JSON.parse(init.body.get('payload_json'));
      fichiers = [...init.body.keys()].filter(k => k.startsWith('files['));
    } else if (init.body) corps = JSON.parse(init.body);
    appels.push({ url: String(url), chemin: u.pathname, params: Object.fromEntries(u.searchParams), methode: init.method, corps, fichiers, auth: init.headers?.Authorization ?? null });
    const image = corps?.embeds?.[0]?.image?.url?.startsWith('attachment://') ? { image: { url: 'https://cdn.discordapp.com/attachments/1/2/visuel.png' } } : null;
    const fil = /^\/api\/v10\/channels\/(\d+)\/messages\/(\d+)\/threads$/.exec(u.pathname);
    if (fil) return repondre(201, { id: fil[2], type: 11 });
    if (u.pathname.startsWith('/api/webhooks/')) {
      if (init.method === 'PATCH') return repondre(200, { id: u.pathname.split('/').pop() });
      if (u.searchParams.get('wait') !== 'true') return repondre(204);
      return repondre(200, { id: nouvelId(), channel_id: u.searchParams.get('thread_id') ?? '720000000000000001', ...(image ? { embeds: [image] } : {}) });
    }
    const msg = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(u.pathname);
    if (msg && init.method === 'POST') return repondre(200, { id: nouvelId(), channel_id: msg[1], ...(image ? { embeds: [image] } : {}) });
    return repondre(200, {});
  };
  return { appels, fetch, posts: () => appels.filter(a => a.methode === 'POST' && !a.chemin.endsWith('/threads')), editions: () => appels.filter(a => a.methode === 'PATCH') };
}

async function preparer() {
  const discord = fauxDiscord();
  const b = await banc({ fetchDiscord: discord.fetch, cleDiscord: CLE, lienApp: 'https://app.exemple/esport', discordBot: { applicationId: '424242424242424242', publicKey: '00'.repeat(32), jetonBot: JETON_BOT } });
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', filFr: true, membres: { man12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'manager' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.red12345 = await b.session('red12345', 'Remi');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  // Rédacteur du club : voir et éditer (saisir des statistiques), pas gérer (configurer).
  const redacteur = await ok('/cm/roles', s.fondateur, { methode: 'POST', corps: { nom: 'Rédacteur', couleur: '#123456', permissions: ['cm.voir', 'cm.editer'] } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'red12345', roleId: redacteur.id, portee: 'club' } });
  for (const t of [A.teamId, B.teamId]) await ok(`/teams/${t}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true, discord: true } } });
  // Max (Manager d'Alpha) est aussi Correspondant CM de sa team : l'équipe CM, limitée à Alpha. Nox (Manager de Bravo,
  // sans affectation) n'a que son rôle de team : l'espace « CM du club », donc Réseaux, lui reste fermé.
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'man12345', roleId: 'cm-role-correspondant', portee: A.teamId } });
  // Salon Discord de la Team Alpha : son webhook (fil français activé pour elle).
  await ok(`/teams/${A.teamId}/discord/webhook`, s.man12345, { methode: 'PUT', corps: { url: URL_TEST } });
  const publierPost = async ({ reseaux = ['x', 'instagram', 'tiktok'], titre = 'Victoire 2-0', publications, piece } = {}) => {
    const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus' && !t.team);
    const tb = await ok(`/cm/tableaux/${club.id}`, s.cm123456);
    const textes = Object.fromEntries(reseaux.map(r => [r, { fr: 'Victoire !', en: 'We won!' }]));
    let p = await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: tb.listes.find(l => l.cle === 'idees').id, titre, post: true, reseaux } });
    const id = p.carte.id;
    await ok(`/cm/cartes/${id}`, s.cm123456, { methode: 'PATCH', corps: { textes, liens: { teamId: A.teamId } } });
    if (piece) await ok(`/cm/cartes/${id}/pieces`, s.cm123456, { methode: 'POST', corps: { genre: 'lien', url: piece, nom: 'Visuel' } });
    p = await ok(`/cm/cartes/${id}/soumettre`, s.cm123456, { methode: 'POST' });
    p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version } });
    if (publications) p = await ok(`/cm/cartes/${id}/publier`, s.cm123456, { methode: 'POST', corps: { publications } });
    return { id, carte: p.carte };
  };
  const annonces = carteId => b.base.tous('SELECT * FROM cm_rs_annonces WHERE carte_id = ? ORDER BY reseau, cible', [carteId]);
  return { b, A, B, s, api, ok, discord, publierPost, annonces };
}

// ------------------------------------------------------------------ Comptes et permissions

test('comptes : validation des adresses, identifiant cohérent, doublons ; permissions (gérer, voir, team, 404)', async () => {
  const { A, s, api, ok } = await preparer();
  for (const [corps, code] of [
    [{ reseau: 'x', url: 'http://x.com/club_gg' }, 'url-profil'],
    [{ reseau: 'x', url: 'https://instagram.com/club_gg' }, 'url-profil'],
    [{ reseau: 'x', url: 'https://x.com/club_gg/status/1' }, 'url-profil'],
    [{ reseau: 'instagram', url: 'https://www.instagram.com/club.gg/', identifiant: '@autre' }, 'identifiant'],
    [{ reseau: 'mastodon', url: 'https://x.com/club_gg' }, 'reseau'],
    [{ reseau: 'x', url: 'https://x.com/club_gg', teamId: '00000000-0000-4000-8000-000000000000' }, 'team'],
  ]) assert.equal((await api('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps })).corps.code, code, JSON.stringify(corps));
  const x = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://twitter.com/Club_GG', nom: 'Compte principal' } })).compte;
  assert.deepEqual([x.identifiant, x.url, x.teamId, x.actif, x.annonce.active], ['Club_GG', 'https://twitter.com/Club_GG', null, true, false]);
  assert.equal((await api('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/club_gg' } })).corps.code, 'compte-existe', 'même compte, autre casse');
  const ig = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'instagram', url: 'https://www.instagram.com/alpha.gg/', identifiant: '@alpha.gg', teamId: A.teamId } })).compte;
  assert.equal(ig.teamId, A.teamId);
  await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'youtube', url: 'https://www.youtube.com/@ClubGG' } });
  // Configurer : cm.gerer du club seulement.
  assert.equal((await api('/cm/reseaux/comptes', s.red12345, { methode: 'POST', corps: { reseau: 'tiktok', url: 'https://www.tiktok.com/@club' } })).statut, 403);
  assert.equal((await api(`/cm/reseaux/comptes/${x.id}/annonce`, s.red12345, { methode: 'PUT', corps: { active: true } })).statut, 403);
  assert.equal((await api('/cm/reseaux/salons', s.red12345, { methode: 'POST', corps: { nom: 'annonces', url: URL_SALON_CLUB } })).statut, 403);
  // Consulter : le rédacteur voit tout, sans la configuration des annonces ; le correspondant de la team ne voit que ses comptes.
  const vu = await ok('/cm/reseaux', s.red12345);
  assert.equal(vu.comptes.length, 3);
  assert.equal(vu.comptes[0].annonce, undefined, 'pas de réglage d’annonce sans cm.gerer');
  assert.equal(vu.salons, undefined);
  const team = await ok('/cm/reseaux', s.man12345);
  assert.deepEqual(team.comptes.map(c => c.id), [ig.id]);
  assert.equal((await api(`/cm/reseaux/comptes/${x.id}/releves`, s.man12345)).statut, 404, 'compte du club : invisible pour la team');
  assert.equal((await api(`/cm/reseaux/comptes/${ig.id}/releves`, s.man12345, { methode: 'POST', corps: { abonnes: 10 } })).statut, 403, 'voir sans éditer');
  // Sans cm.voir de l'équipe CM : la page n'existe pas (le Manager de Bravo n'a qu'un rôle de team : espace fermé).
  for (const qui of ['lea12345', 'nox12345']) {
    for (const chemin of ['/cm/reseaux', '/cm/reseaux/publications', '/cm/reseaux/tableau-de-bord', '/cm/reseaux/export/posts.csv']) {
      assert.equal((await api(chemin, s[qui])).statut, 404, `${qui} ${chemin}`);
    }
  }
  // Modifier, désactiver, supprimer.
  let m = (await ok(`/cm/reseaux/comptes/${x.id}`, s.cm123456, { methode: 'PATCH', corps: { url: 'https://x.com/Club_GG', actif: false } })).compte;
  assert.deepEqual([m.url, m.actif], ['https://x.com/Club_GG', false]);
  assert.equal((await api(`/cm/reseaux/comptes/${x.id}`, s.cm123456, { methode: 'PATCH', corps: { identifiant: 'autre' } })).corps.code, 'identifiant');
  m = (await ok(`/cm/reseaux/comptes/${x.id}`, s.cm123456, { methode: 'PATCH', corps: { actif: true } })).compte;
  await ok(`/cm/reseaux/comptes/${ig.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await ok('/cm/reseaux', s.cm123456)).comptes.length, 2);
  assert.ok((await ok('/cm/journal', s.cm123456)).entrees.some(e => e.action === 'cm.reseau_compte_cree'));
});

// ------------------------------------------------------------------ Annonces Discord

test('annonce Discord : anglais + fil français, rôle mentionné, visuel ; idempotente ; adresse changée rééditée ; plusieurs réseaux ; désactivations', async () => {
  const { b, A, s, api, ok, discord, publierPost, annonces } = await preparer();
  const clubX = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } })).compte;
  const igAlpha = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'instagram', url: 'https://www.instagram.com/alpha.gg/', teamId: A.teamId } })).compte;
  const tiktok = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'tiktok', url: 'https://www.tiktok.com/@club.gg' } })).compte;
  // Salon du club : webhook chiffré, jamais renvoyé.
  assert.equal((await api('/cm/reseaux/salons', s.cm123456, { methode: 'POST', corps: { nom: 'annonces', url: 'https://site-exemple.fr/api/webhooks/1/abc' } })).corps.code, 'webhook-url');
  const salon = (await ok('/cm/reseaux/salons', s.cm123456, { methode: 'POST', corps: { nom: 'annonces-fans', url: URL_SALON_CLUB } })).salon;
  assert.equal(salon.masque, '…/WXYZ');
  const brut = await b.base.premier('SELECT url_chiffree FROM cm_rs_salons WHERE id = ?', [salon.id]);
  assert.ok(brut.url_chiffree.startsWith('dw1.') && !brut.url_chiffree.includes('ClubWebhook'));
  assert.equal(JSON.stringify(await ok('/cm/reseaux', s.cm123456)).includes('ClubWebhook'), false);
  // Réglages d'annonce : modèle inconnu refusé, rôle numérique seulement ; cibles : salon du club + salon de la team.
  assert.equal((await api(`/cm/reseaux/comptes/${clubX.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { modeleEn: 'Hi {pseudo}' } })).corps.code, 'variable-inconnue');
  assert.equal((await api(`/cm/reseaux/comptes/${clubX.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { roleMention: '@everyone' } })).corps.code, 'role-mention');
  assert.equal((await api(`/cm/reseaux/comptes/${clubX.id}/test`, s.cm123456, { methode: 'POST' })).corps.code, 'cibles', 'test sans salon');
  await ok(`/cm/reseaux/comptes/${clubX.id}/annonce`, s.cm123456, {
    methode: 'PUT',
    corps: { active: true, modeleEn: 'New {reseau} post by {compte}: {titre} {url} @everyone', modeleFr: 'Nouveau post {reseau} de {compte} ({team}) : {titre}', roleMention: ROLE_FANS, cibles: [{ genre: 'salon', id: salon.id }, { genre: 'team', id: A.teamId }] },
  });
  await ok(`/cm/reseaux/comptes/${igAlpha.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { active: true, cibles: [{ genre: 'team', id: A.teamId }] } });
  await ok(`/cm/reseaux/comptes/${tiktok.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { active: true, cibles: [{ genre: 'salon', id: salon.id }] } });
  // Aperçu : messages anglais et français, valeurs d'exemple ; la mention ne vaut que pour l'anglais.
  const ap = await ok('/cm/reseaux/apercu', s.cm123456, { methode: 'POST', corps: { reseau: 'x', identifiant: 'Club_GG', modeleEn: '{compte} on {reseau}: {titre}', modeleFr: '{compte} sur {reseau} : {titre}', roleMention: ROLE_FANS } });
  assert.match(ap.en.embed.description, /^@Club_GG on X: 2-0 win against the Falcons$/);
  assert.match(ap.fr.embed.description, /^@Club_GG sur X : Victoire 2-0 contre les Faucons$/);
  assert.deepEqual([ap.en.mention, ap.fr.mention], [`<@&${ROLE_FANS}>`, null]);
  assert.equal((await api('/cm/reseaux/apercu', s.red12345, { methode: 'POST', corps: { reseau: 'x' } })).statut, 403);
  // Message de test : un message par salon cible, tout de suite.
  const avantTest = discord.posts().length;
  const test1 = await ok(`/cm/reseaux/comptes/${clubX.id}/test`, s.cm123456, { methode: 'POST' });
  assert.deepEqual(test1.resultats.map(r => r.ok), [true, true]);
  assert.equal(discord.posts().length, avantTest + 2);
  assert.equal((await api(`/cm/reseaux/comptes/${clubX.id}/test`, s.cm123456, { methode: 'POST' })).corps.code, 'trop-vite');

  // ---- Publication sur X (et Instagram) : une annonce par réseau et par salon, envoyée juste après la requête.
  const visuel = 'https://site-exemple.fr/visuels/victoire.png';
  const { id } = await publierPost({ publications: { x: 'https://x.com/Club_GG/status/111', instagram: 'https://www.instagram.com/p/AbC/' }, piece: visuel });
  let lignes = await annonces(id);
  assert.deepEqual(lignes.map(l => [l.reseau, l.cible.split(':')[0], l.statut]), [['instagram', 'team', 'envoye'], ['x', 'salon', 'envoye'], ['x', 'team', 'envoye']]);
  const principaux = discord.posts().filter(a => a.params.wait === 'true' && !a.params.thread_id);
  assert.equal(principaux.length, 3);
  const surSalonClub = principaux.find(a => a.chemin.includes('555555555555555555'));
  // Anglais d'abord : modèle rendu, @everyone neutralisé, seule la mention du rôle, visuel, lien du post.
  assert.equal(surSalonClub.corps.content, `<@&${ROLE_FANS}>`);
  assert.deepEqual(surSalonClub.corps.allowed_mentions, { parse: [], roles: [ROLE_FANS] });
  const embed = surSalonClub.corps.embeds[0];
  assert.match(embed.description, /^New X post by @Club_GG: Victoire 2-0 https:\/\/x\.com\/Club_GG\/status\/111 @​everyone$/);
  assert.equal(embed.url, 'https://x.com/Club_GG/status/111');
  assert.equal(embed.image.url, visuel);
  assert.ok(embed.fields.some(f => f.value === '[@Club_GG](https://x.com/Club_GG)'));
  assert.equal(surSalonClub.corps.components[0].components[0].url, 'https://x.com/Club_GG/status/111');
  // Fil créé par le bot, version française dans le fil (sans mention).
  const fils = discord.appels.filter(a => a.chemin.endsWith('/threads'));
  assert.equal(fils.length, 3);
  assert.equal(fils[0].auth, `Bot ${JETON_BOT}`);
  const francais = discord.posts().filter(a => a.params.thread_id);
  assert.equal(francais.length, 3);
  const frClub = francais.find(a => a.chemin.includes('555555555555555555'));
  assert.equal(frClub.corps.content, undefined);
  assert.deepEqual(frClub.corps.allowed_mentions, { parse: [] });
  assert.match(frClub.corps.embeds[0].description, /^Nouveau post X de @Club_GG \(Team Alpha\) : Victoire 2-0$/);
  // Compte Instagram de la team (adresse sans identifiant : team de la carte) → salon de la team seulement.
  const igMsg = principaux.find(a => a.corps.embeds[0].url === 'https://www.instagram.com/p/AbC/');
  assert.ok(igMsg.chemin.startsWith('/api/webhooks/'), 'webhook de la team');
  assert.equal(igMsg.corps.content, undefined, 'pas de rôle réglé pour ce compte');
  const total = discord.appels.length;

  // ---- Idempotence : republier la même adresse, rejouer les événements, retraiter la file : rien.
  await ok(`/cm/cartes/${id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { x: 'https://x.com/Club_GG/status/111' } } });
  await b.base.executer('UPDATE evenements SET traite_le = NULL WHERE entite_id = ?', [id]);
  await distribuer(b.base, { maintenant: b.horloge.t });
  await traiterAnnoncesReseaux(b.base, { cle: CLE, fetch: discord.fetch, maintenant: b.horloge.t, jetonBot: JETON_BOT });
  assert.equal(discord.appels.length, total);
  // Dépublier, modifier la carte (elle repasse à valider), revalider, republier les mêmes adresses : rien non plus.
  await ok(`/cm/cartes/${id}/depublier`, s.cm123456, { methode: 'POST' });
  let p = await ok(`/cm/cartes/${id}`, s.cm123456, { methode: 'PATCH', corps: { titre: 'Victoire 2-0 (bis)' } });
  p = await ok(`/cm/cartes/${id}/valider`, s.cm123456, { methode: 'POST', corps: { versionAttendue: p.carte.version } });
  await ok(`/cm/cartes/${id}/publier`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal(discord.appels.length, total);
  assert.equal((await annonces(id)).length, 3);

  // ---- Adresse changée : le message déjà posté est RÉÉDITÉ (anglais et français), jamais doublé.
  await ok(`/cm/cartes/${id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { x: 'https://x.com/Club_GG/status/222' } } });
  assert.ok(await b.base.premier("SELECT id FROM evenements WHERE type = 'cm.post_adresses' AND entite_id = ?", [id]));
  const editions = discord.editions();
  assert.equal(editions.length, 4, 'X : salon du club et salon de la team, anglais et français');
  assert.ok(editions.every(e => e.corps.embeds[0].url === 'https://x.com/Club_GG/status/222' && e.corps.allowed_mentions.parse.length === 0 && !e.corps.content));
  assert.ok(editions.some(e => e.params.thread_id), 'la version française du fil aussi');
  assert.equal(discord.posts().length, principaux.length + francais.length + 2, 'aucun nouveau message (les 2 de plus sont les tests)');
  lignes = await annonces(id);
  assert.ok(lignes.filter(l => l.reseau === 'x').every(l => l.statut === 'envoye' && l.url_annoncee === 'https://x.com/Club_GG/status/222'));

  // ---- Autre réseau publié ensuite : un message pour lui seul. Compte désactivé : rien.
  await ok(`/cm/reseaux/comptes/${tiktok.id}`, s.cm123456, { methode: 'PATCH', corps: { actif: false } });
  await ok(`/cm/cartes/${id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { tiktok: 'https://www.tiktok.com/@club.gg/video/7' } } });
  assert.equal((await annonces(id)).filter(l => l.reseau === 'tiktok').length, 0, 'compte inactif : pas d’annonce');
  const post2 = await publierPost({ reseaux: ['x', 'tiktok'], titre: 'Nouveau joueur' });
  await ok(`/cm/reseaux/comptes/${tiktok.id}`, s.cm123456, { methode: 'PATCH', corps: { actif: true } });
  await ok(`/cm/cartes/${post2.id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { tiktok: 'https://www.tiktok.com/@club.gg/video/8' } } });
  assert.deepEqual((await annonces(post2.id)).map(l => [l.reseau, l.statut]), [['tiktok', 'envoye']]);
  // Annonce désactivée pour X : l'adresse X ajoutée ne part pas.
  await ok(`/cm/reseaux/comptes/${clubX.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { active: false } });
  await ok(`/cm/cartes/${post2.id}/publier`, s.cm123456, { methode: 'POST', corps: { publications: { x: 'https://x.com/Club_GG/status/333' } } });
  assert.deepEqual((await annonces(post2.id)).map(l => l.reseau), ['tiktok']);
  // Adresse d'un AUTRE compte X (identifiant lu dans l'adresse) : aucune annonce à notre nom.
  await ok(`/cm/reseaux/comptes/${clubX.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { active: true } });
  const post3 = await publierPost({ reseaux: ['x'], titre: 'Repost', publications: { x: 'https://x.com/AutreClub/status/9' } });
  assert.deepEqual(await annonces(post3.id), []);
  // Les annonces sont listées pour le gestionnaire (statut, salon), jamais pour un rédacteur.
  const liste = await ok('/cm/reseaux/annonces', s.cm123456);
  assert.ok(liste.annonces.some(a => a.cible.genre === 'salon' && a.cible.nom === 'annonces-fans'));
  assert.equal((await api('/cm/reseaux/annonces', s.red12345)).statut, 403);
  assert.equal(JSON.stringify(liste).includes('ClubWebhook'), false);
  assert.equal(JSON.stringify(await b.base.tous("SELECT meta FROM journal WHERE action LIKE 'cm.reseau%' OR action LIKE 'cm.annonce%'", [])).includes('ClubWebhook'), false);
});

test('annonce Discord : réessais (5xx, 429), fil impossible sans bot (alerte une fois), salon supprimé, team sans Discord', async () => {
  const { b, A, s, ok, publierPost, annonces } = await preparer();
  const x = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } })).compte;
  const salon = (await ok('/cm/reseaux/salons', s.cm123456, { methode: 'POST', corps: { nom: 'annonces', url: URL_SALON_CLUB } })).salon;
  await ok(`/cm/reseaux/comptes/${x.id}/annonce`, s.cm123456, { methode: 'PUT', corps: { active: true, cibles: [{ genre: 'salon', id: salon.id }, { genre: 'team', id: A.teamId }] } });
  // Discord en panne (503) puis limite de débit (429) : la ligne attend, sans doublon.
  const reponses = [];
  const appels = [];
  const fetch = async (url, init) => {
    const multipart = init.body instanceof FormData;
    appels.push({ url: String(url), methode: init.method, multipart, corps: multipart ? JSON.parse(init.body.get('payload_json')) : JSON.parse(init.body ?? 'null'), fichier: multipart ? init.body.get('files[0]') : null });
    const r = reponses.shift();
    if (r) return new Response(JSON.stringify(r.corps ?? {}), { status: r.statut, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ id: `9${String(appels.length).padStart(17, '0')}`, channel_id: '720000000000000001' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const { id } = await publierPost({ reseaux: ['x'] });
  // Visuel déposé (fichier image de la carte) : joint au message (multipart), cité par attachment://.
  const iso0 = new Date(b.horloge.t).toISOString();
  await b.stockage.deposer('cm/club/visuel-test.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), { type: 'image/png' });
  await b.base.executer("INSERT INTO cm_fichiers (id, portee, cle_stockage, type_mime, taille, nom_original, empreinte, cree_le) VALUES ('f-visuel', 'club', 'cm/club/visuel-test.png', 'image/png', 7, 'v.png', 'x', ?)", [iso0]);
  await b.base.executer("INSERT INTO cm_pieces (id, carte_id, genre, nom, fichier_id, cree_le) VALUES ('p-visuel', ?, 'fichier', 'v.png', 'f-visuel', ?)", [id, iso0]);
  await b.base.executer("UPDATE cm_cartes SET statut = 'publie', publications = ?, publie_le = ? WHERE id = ?", [JSON.stringify({ x: 'https://x.com/Club_GG/status/5' }), new Date(b.horloge.t).toISOString(), id]);
  await b.base.executer("INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) VALUES ('ev-test-1', 'cm.post_publie', NULL, 'cm123456', 'cm_carte', ?, '{}', ?, 0)", [id, new Date(b.horloge.t).toISOString()]);
  await distribuer(b.base, { maintenant: b.horloge.t });
  const traiter = (t = b.horloge.t, jetonBot) => traiterAnnoncesReseaux(b.base, { cle: CLE, fetch, maintenant: t, jetonBot, stockage: b.stockage });
  reponses.push({ statut: 503 }, { statut: 429, corps: { retry_after: 30 } });
  let bilan = await traiter();
  assert.deepEqual([bilan.envoyes, bilan.reportes], [0, 2]);
  let lignes = await annonces(id);
  // L'une a eu le 503 (un essai compté), l'autre le 429 (attente de Discord, sans essai compté).
  assert.deepEqual(lignes.map(l => Number(l.essais)).sort(), [0, 1]);
  assert.ok(lignes.some(l => l.derniere_erreur === 'Limite de débit de Discord'));
  // Plus tard : l'anglais part ; sans bot, pas de fil : l'anglais reste, alerte au Fondateur (une seule fois par salon et par 24 h).
  bilan = await traiter(b.horloge.t + 10 * 60_000);
  assert.equal(bilan.envoyes, 2);
  lignes = await annonces(id);
  assert.ok(lignes.every(l => l.statut === 'envoye' && l.message_id && /Fil français impossible/.test(l.derniere_erreur)));
  const alertes = appels.filter(a => a.methode === 'POST').length - 2 - 2; // 2 échecs (503, 429), 2 messages anglais
  const anglais = appels.filter(a => a.multipart);
  assert.equal(anglais.length, 4, 'visuel joint à chaque envoi du message principal (essais compris)');
  assert.equal(anglais[0].corps.embeds[0].image.url, 'attachment://visuel.png');
  assert.deepEqual(anglais[0].corps.attachments, [{ id: 0, filename: 'visuel.png' }]);
  assert.equal(anglais[0].fichier.type, 'image/png');
  assert.equal(alertes, 2, 'une alerte par salon (club et team)');
  assert.ok((await b.base.premier('SELECT alerte_fil_le FROM cm_rs_salons WHERE id = ?', [salon.id])).alerte_fil_le);
  assert.ok((await ok('/cm/journal', s.cm123456)).entrees.some(e => e.action === 'cm.annonce_fil_impossible'));
  // Salon du club supprimé : les annonces en attente vers lui s'arrêtent ; team sans module Discord : abandon motivé.
  const post2 = await publierPost({ reseaux: ['x'], titre: 'Deuxième' });
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { discord: false } } });
  await b.base.executer("UPDATE cm_cartes SET statut = 'publie', publications = ?, publie_le = ? WHERE id = ?", [JSON.stringify({ x: 'https://x.com/Club_GG/status/6' }), new Date(b.horloge.t).toISOString(), post2.id]);
  await b.base.executer("INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) VALUES ('ev-test-2', 'cm.post_publie', NULL, 'cm123456', 'cm_carte', ?, '{}', ?, 0)", [post2.id, new Date(b.horloge.t).toISOString()]);
  await distribuer(b.base, { maintenant: b.horloge.t });
  await ok(`/cm/reseaux/salons/${salon.id}`, s.cm123456, { methode: 'DELETE' });
  await traiter(b.horloge.t + 20 * 60_000);
  assert.deepEqual((await annonces(post2.id)).map(l => [l.cible.split(':')[0], l.statut, l.derniere_erreur]), [
    ['salon', 'abandonne', 'Salon du club supprimé'],
    ['team', 'abandonne', 'Module Discord désactivé'],
  ]);
  assert.equal((await b.base.tous('SELECT * FROM cm_rs_cibles WHERE compte_id = ?', [x.id])).length, 1, 'salon retiré des cibles');
  // Adresse changée alors que le salon de la team n'est plus joignable : l'édition est abandonnée (pas de boucle).
  await b.base.executer('UPDATE cm_cartes SET publications = ? WHERE id = ?', [JSON.stringify({ x: 'https://x.com/Club_GG/status/7' }), id]);
  await b.base.executer("INSERT INTO evenements (id, type, team_id, acteur_id, entite_type, entite_id, charge, cree_le, essais) VALUES ('ev-test-3', 'cm.post_adresses', NULL, 'cm123456', 'cm_carte', ?, '{}', ?, 0)", [id, new Date(b.horloge.t).toISOString()]);
  await distribuer(b.base, { maintenant: b.horloge.t });
  const team = async () => (await annonces(id)).find(l => l.cible.startsWith('team:'));
  assert.deepEqual([(await team()).operation, (await team()).statut], ['editer', 'attente']);
  await traiter(b.horloge.t + 30 * 60_000);
  assert.deepEqual([(await team()).statut, (await team()).derniere_erreur], ['abandonne', 'Module Discord désactivé']);
  assert.deepEqual(await traiter(b.horloge.t + 40 * 60_000), { envoyes: 0, abandonnes: 0, reportes: 0 });
});

// ------------------------------------------------------------------ Statistiques

test('statistiques : publications suivies, relevés datés (J+1, J+7), engagement, évolution, tableau de bord, rappels', async () => {
  const { b, A, s, api, ok, publierPost } = await preparer();
  const x = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } })).compte;
  const ig = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'instagram', url: 'https://www.instagram.com/alpha.gg/', teamId: A.teamId } })).compte;
  const yt = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'youtube', url: 'https://www.youtube.com/@ClubGG' } })).compte;
  const { id } = await publierPost({ reseaux: ['x', 'instagram'], publications: { x: 'https://x.com/Club_GG/status/1', instagram: 'https://www.instagram.com/reel/Zz/' } });
  let liste = (await ok('/cm/reseaux/publications', s.red12345)).publications;
  assert.equal(liste.length, 2);
  const px = liste.find(p => p.reseau === 'x');
  const pig = liste.find(p => p.reseau === 'instagram');
  assert.deepEqual([px.carteId, px.compte.id, px.titre, px.type, px.teamId, px.video], [id, x.id, 'Victoire 2-0', 'autre', A.teamId, false]);
  assert.deepEqual([pig.compte.id, pig.video], [ig.id, true], 'Reel Instagram : vidéo');
  // Relevés : validation, J+1 puis J+7 (un par jour : la même date remplace).
  assert.equal((await api(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-20', vues: 'beaucoup' } })).corps.code, 'metrique-vues');
  assert.equal((await api(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-20' } })).corps.code, 'releve-vide');
  assert.equal((await api(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2030-01-01', vues: 1 } })).corps.code, 'jour');
  assert.equal((await api(`/cm/reseaux/publications/${px.id}/releves`, s.man12345, { methode: 'POST', corps: { vues: 1 } })).statut, 403, 'correspondant : voir sans éditer');
  await ok(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-20', vues: 500, likes: 10 } });
  b.horloge.t += 7 * 86_400_000;
  // Une semaine plus tard : nouvelles sessions (elles expirent).
  for (const qui of ['red12345', 'man12345']) s[qui] = await b.session(qui);
  await ok(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-21', vues: '1 000', likes: 80, commentaires: 10, partages: 5, enregistrements: 5, impressions: '2k' } });
  const detail = await ok(`/cm/reseaux/publications/${px.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-27', vues: '3,5k', likes: 200, commentaires: 30, partages: 20, enregistrements: 50, impressions: 5000, clics: 12 } });
  assert.deepEqual(detail.releves.map(r => [r.jour, r.vues, r.engagement]), [['2026-10-20', 500, 2], ['2026-10-21', 1000, 5], ['2026-10-27', 3500, 6]]);
  assert.deepEqual(detail.evolution.map(e => [e.jPlus, e.ecartVues]), [[0, null], [1, 500], [7, 2500]]);
  await ok(`/cm/reseaux/publications/${pig.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-25', vues: 8000, likes: 400, portee: 6000, dureeMoyenne: '0:12', tauxCompletion: '38 %' } });
  // Publication hors CM (vidéo YouTube), relevés de comptes.
  const video = await ok('/cm/reseaux/publications', s.red12345, { methode: 'POST', corps: { url: 'https://www.youtube.com/watch?v=abc', titre: 'Highlights', type: 'clip', publieLe: '2026-10-22' } });
  assert.deepEqual([video.publication.reseau, video.publication.compte.id, video.publication.video], ['youtube', yt.id, true]);
  assert.equal((await api('/cm/reseaux/publications', s.red12345, { methode: 'POST', corps: { url: 'https://youtube.com/watch?v=abc/' } })).corps.code, 'publication-existe');
  assert.equal((await api('/cm/reseaux/publications', s.red12345, { methode: 'POST', corps: { url: 'https://site-exemple.fr/v' } })).corps.code, 'reseau');
  await ok(`/cm/reseaux/publications/${video.publication.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-26', vues: 12000, likes: 600, commentaires: 40 } });
  assert.equal((await api(`/cm/reseaux/publications/${px.id}`, s.red12345, { methode: 'PATCH', corps: { url: 'https://x.com/Club_GG/status/2' } })).corps.code, 'publication-cm');
  await ok(`/cm/reseaux/publications/${px.id}`, s.red12345, { methode: 'PATCH', corps: { type: 'resultat' } });
  for (const [jour, abonnes] of [['2026-09-28', 1000], ['2026-10-10', 1100], ['2026-10-27', 1250]]) await ok(`/cm/reseaux/comptes/${x.id}/releves`, s.red12345, { methode: 'POST', corps: { jour, abonnes, publications: 300 } });
  // Tableau de bord du mois : totaux, top, comparaison réseaux, par type, par team, abonnés.
  const tdb = await ok('/cm/reseaux/tableau-de-bord?du=2026-10-01&au=2026-10-31', s.red12345);
  assert.deepEqual([tdb.totaux.publications, tdb.totaux.vues, tdb.totaux.abonnes, tdb.totaux.variationAbonnes], [3, 3500 + 8000 + 12000, 1250, 250], 'abonnés : depuis le dernier relevé d’avant la période');
  assert.deepEqual(tdb.topVues.map(p => p.titre), ['Highlights', 'Victoire 2-0', 'Victoire 2-0']);
  assert.equal(tdb.topEngagement[0].engagement, 6.67, 'Instagram : 400 / 6000 (portée)');
  assert.deepEqual(tdb.parReseau.map(g => g.cle).sort(), ['instagram', 'x', 'youtube']);
  assert.equal(tdb.parReseau.find(g => g.cle === 'x').engagement, 6);
  assert.deepEqual(tdb.parType.map(g => [g.cle, g.publications]).sort(), [['autre', 1], ['clip', 1], ['resultat', 1]]);
  assert.deepEqual(tdb.parTeam.map(g => [g.cle === 'club' ? 'club' : g.nom, g.publications]).sort(), [['Team Alpha', 2], ['club', 1]]);
  const cx = tdb.comptes.find(c => c.id === x.id);
  assert.deepEqual([cx.debut, cx.fin, cx.variation, cx.serie.length], [1000, 1250, 250, 3]);
  // Filtres : par réseau, par team ; période trop longue refusée.
  assert.equal((await ok('/cm/reseaux/tableau-de-bord?du=2026-10-01&au=2026-10-31&reseau=x', s.red12345)).totaux.publications, 1);
  assert.equal((await ok(`/cm/reseaux/tableau-de-bord?du=2026-10-01&au=2026-10-31&team=${A.teamId}`, s.red12345)).totaux.publications, 2);
  assert.equal((await api('/cm/reseaux/tableau-de-bord?du=2025-01-01&au=2026-10-31', s.red12345)).corps.code, 'periode');
  // Le Manager de la team ne voit que les publications de sa team.
  assert.equal((await ok('/cm/reseaux/tableau-de-bord?du=2026-10-01&au=2026-10-31', s.man12345)).totaux.publications, 2);
  assert.equal((await api(`/cm/reseaux/publications/${video.publication.id}`, s.man12345)).statut, 404);
});

test('rappels J+1 et J+7 : une notification par publication et par échéance, pas si le relevé est fait', async () => {
  const { b, s, ok, publierPost } = await preparer();
  await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } });
  await publierPost({ reseaux: ['x'], publications: { x: 'https://x.com/Club_GG/status/1' } });
  const pub = await b.base.premier('SELECT * FROM cm_rs_publications', []);
  const notifs = async () => (await ok('/notifications', s.cm123456)).liste.filter(n => n.type === 'cm-releve');
  assert.equal((await rappelsReseaux(b.base, { maintenant: b.horloge.t })).poses, 0, 'jour J : rien');
  const j1 = b.horloge.t + 26 * 3_600_000;
  assert.equal((await rappelsReseaux(b.base, { maintenant: j1 })).poses, 1);
  assert.equal((await rappelsReseaux(b.base, { maintenant: j1 + 3_600_000 })).poses, 0, 'une seule fois');
  await distribuer(b.base, { maintenant: j1 });
  const n1 = await notifs();
  assert.deepEqual(n1.map(n => [n.charge.j, n.charge.reseau, n.charge.publication]), [[1, 'x', pub.id]]);
  // J+7 : relevé déjà fait à cette date → pas de rappel (la marque est posée quand même).
  await b.base.executer("INSERT INTO cm_rs_releves_posts (id, publication_id, jour, vues, source, cree_le, maj_le) VALUES ('r7', ?, '2026-10-28', 10, 'manuel', ?, ?)", [pub.id, pub.cree_le, pub.cree_le]);
  assert.equal((await rappelsReseaux(b.base, { maintenant: b.horloge.t + 8 * 86_400_000 })).poses, 0);
  assert.ok((await b.base.premier('SELECT rappel_j7_le FROM cm_rs_publications WHERE id = ?', [pub.id])).rappel_j7_le);
  // Rappels désactivables par publication et par défaut (réglage de la page).
  const r = await ok('/cm/reseaux/reglages', s.cm123456, { methode: 'PUT', corps: { rappels: false } });
  assert.equal(r.rappels, false);
  const v = await ok('/cm/reseaux/publications', s.cm123456, { methode: 'POST', corps: { url: 'https://x.com/Club_GG/status/99', titre: 'Sans rappel' } });
  assert.equal(v.publication.rappels, false);
});

// ------------------------------------------------------------------ CSV

test('import CSV : correspondance, lignes malformées, adresse inconnue, création, réimport sans doublon ; comptes ; export sans formule', async () => {
  const { b, A, s, api, ok, publierPost } = await preparer();
  const x = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } })).compte;
  const ig = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'instagram', url: 'https://www.instagram.com/alpha.gg/', teamId: A.teamId } })).compte;
  await publierPost({ reseaux: ['x'], titre: '=HYPERLINK("https://site-exemple.fr")', publications: { x: 'https://x.com/Club_GG/status/1' } });
  const csv = [
    'Post URL;Date;Views;Likes;Comments;Shares;Reach;Ignorée',
    'https://x.com/Club_GG/status/1?s=20;19/10/2026;1 200;90;12;6;4000;x',
    'https://twitter.com/Club_GG/status/1/;20/10/2026;2,5k;150;20;10;6000;x',
    'https://www.tiktok.com/@club.gg/video/5;20/10/2026;500;10;;;;x',
    'https://site-exemple.fr/post;20/10/2026;5;1;;;;x',
    'https://x.com/Club_GG/status/1;31/02/2026;5;1;;;;x',
    'https://x.com/Club_GG/status/1;20/10/2026;beaucoup;1;;;;x',
    'https://x.com/Club_GG/status/1;20/10/2026;;;;;;x',
  ].join('\n');
  const apercu = await ok('/cm/reseaux/import/apercu', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv } });
  assert.deepEqual([apercu.separateur, apercu.lignes], [';', 7]);
  assert.deepEqual(apercu.correspondance, { 0: 'url', 1: 'jour', 2: 'vues', 3: 'likes', 4: 'commentaires', 5: 'partages', 6: 'portee' });
  assert.equal((await api('/cm/reseaux/import', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv, correspondance: { 1: 'jour' } } })).corps.code, 'correspondance');
  assert.equal((await api('/cm/reseaux/import', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv, correspondance: { 0: 'url', 1: 'url' } } })).corps.code, 'correspondance');
  assert.equal((await api('/cm/reseaux/import/apercu', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: 'a\n"jamais fermé' } })).corps.code, 'csv-invalide');
  assert.equal((await api('/cm/reseaux/import/apercu', s.man12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv } })).statut, 403, 'correspondant : pas de saisie');
  let bilan = await ok('/cm/reseaux/import', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv, correspondance: apercu.correspondance } });
  assert.deepEqual([bilan.releves, bilan.crees], [2, 0]);
  assert.deepEqual(bilan.invalides.map(i => [i.ligne, i.code]), [[4, 'publication-inconnue'], [5, 'reseau'], [6, 'jour'], [7, 'vues'], [8, 'releve-vide']]);
  // Réimport (avec création des adresses inconnues) : mêmes relevés remplacés, la vidéo TikTok devient suivie.
  bilan = await ok('/cm/reseaux/import', s.red12345, { methode: 'POST', corps: { genre: 'posts', contenu: csv, correspondance: apercu.correspondance, creer: true } });
  assert.deepEqual([bilan.releves, bilan.crees], [3, 1]);
  const releves = await b.base.tous('SELECT r.jour, r.vues, r.portee, r.source FROM cm_rs_releves_posts r JOIN cm_rs_publications p ON p.id = r.publication_id WHERE p.reseau = ? ORDER BY r.jour', ['x']);
  assert.deepEqual(releves.map(r => [r.jour, Number(r.vues), Number(r.portee), r.source]), [['2026-10-19', 1200, 4000, 'csv'], ['2026-10-20', 2500, 6000, 'csv']]);
  assert.equal((await b.base.tous('SELECT id FROM cm_rs_publications WHERE reseau = ?', ['tiktok'])).length, 1);
  // Relevés de comptes : par identifiant ou adresse du profil.
  const csvComptes = 'compte,reseau,date,followers\n@Club_GG,X,2026-10-19,1000\nhttps://www.instagram.com/alpha.gg/,,2026-10-19,"2 500"\n@inconnu,x,2026-10-19,4\n';
  const ac = await ok('/cm/reseaux/import/apercu', s.red12345, { methode: 'POST', corps: { genre: 'comptes', contenu: csvComptes } });
  assert.deepEqual(ac.correspondance, { 0: 'compte', 1: 'reseau', 2: 'jour', 3: 'abonnes' });
  bilan = await ok('/cm/reseaux/import', s.red12345, { methode: 'POST', corps: { genre: 'comptes', contenu: csvComptes, correspondance: ac.correspondance } });
  assert.deepEqual([bilan.releves, bilan.invalides.map(i => i.code)], [2, ['compte-inconnu']]);
  assert.equal((await ok(`/cm/reseaux/comptes/${ig.id}/releves`, s.red12345)).releves[0].abonnes, 2500);
  assert.equal((await ok(`/cm/reseaux/comptes/${x.id}/releves`, s.red12345)).releves[0].abonnes, 1000);
  // Export : formules neutralisées, réimportable (en-têtes = champs).
  const exp = await ok('/cm/reseaux/export/posts.csv?format=json', s.red12345);
  assert.match(exp.nom, /^reseaux-posts-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(exp.contenu.includes(`"'=HYPERLINK(""https://site-exemple.fr"")"`));
  assert.ok(exp.contenu.split('\r\n')[0].includes('"engagement_pct"'));
  const brut = await b.appel('/cm/reseaux/export/comptes.csv', { jeton: s.red12345 });
  assert.equal(brut.statut, 200);
  assert.match(brut.entetes.get('Content-Type'), /text\/csv/);
  assert.ok(String(brut.corps).includes('"alpha.gg","instagram"'), String(brut.corps));
  // Le Manager de la team exporte seulement ce qu'il voit.
  const expTeam = await ok('/cm/reseaux/export/comptes.csv?format=json', s.man12345);
  assert.equal(expTeam.contenu.includes('Club_GG'), false);
});

// ------------------------------------------------------------------ Adaptateurs, RGPD, export de la base

test('adaptateur d’API : relevés automatiques validés (source api:…), erreurs comptées ; registre vérifié', async () => {
  const { b, s, ok, publierPost } = await preparer();
  const x = (await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } })).compte;
  await publierPost({ reseaux: ['x'], publications: { x: 'https://x.com/Club_GG/status/1' } });
  assert.throws(() => registreAdaptateurs([{ nom: 'X API', reseaux: ['x'] }]), /Adaptateur/);
  assert.deepEqual(await releverAutomatiquement(b.base, { maintenant: b.horloge.t }), { comptes: 0, publications: 0, erreurs: 0 });
  const faux = { nom: 'x-api', reseaux: ['x'], releverCompte: async ({ compte }) => ({ abonnes: compte.identifiant === 'Club_GG' ? 4321 : 0 }), releverPost: async () => ({ vues: -5 }) };
  const bilan = await releverAutomatiquement(b.base, { adaptateurs: [faux], maintenant: b.horloge.t });
  assert.deepEqual(bilan, { comptes: 1, publications: 0, erreurs: 1 });
  const r = (await ok(`/cm/reseaux/comptes/${x.id}/releves`, s.cm123456)).releves;
  assert.deepEqual([r[0].abonnes, r[0].source], [4321, 'api:x-api']);
});

test('RGPD et export / import de la base : saisies gardées sans auteur, salons chiffrés transférés', async () => {
  const { b, s, ok, publierPost } = await preparer();
  await ok('/cm/reseaux/comptes', s.cm123456, { methode: 'POST', corps: { reseau: 'x', url: 'https://x.com/Club_GG' } });
  await ok('/cm/reseaux/salons', s.cm123456, { methode: 'POST', corps: { nom: 'annonces', url: URL_SALON_CLUB } });
  await publierPost({ reseaux: ['x'], publications: { x: 'https://x.com/Club_GG/status/1' } });
  const v = await ok('/cm/reseaux/publications', s.red12345, { methode: 'POST', corps: { url: 'https://x.com/Club_GG/status/2', titre: 'Ajoutée par Remi' } });
  await ok(`/cm/reseaux/publications/${v.publication.id}/releves`, s.red12345, { methode: 'POST', corps: { jour: '2026-10-20', vues: 10 } });
  const exportRgpd = await ok('/moi/export', s.red12345);
  assert.deepEqual(exportRgpd.reseauxPublicationsAjoutees.map(p => p.titre), ['Ajoutée par Remi']);
  assert.equal(exportRgpd.reseauxRelevesSaisis, 1);
  // Export de toute la base, import dans une base neuve : tout revient, webhook toujours chiffré et lisible.
  const dump = await exporterBase(b.base);
  assert.equal(dump.tables.cm_rs_salons.length, 1);
  assert.equal(JSON.stringify(dump).includes('ClubWebhook'), false);
  const autre = await banc();
  await importerBase(autre.base, dump);
  assert.equal((await autre.base.tous('SELECT * FROM cm_rs_publications', [])).length, 2);
  assert.equal((await autre.base.tous('SELECT * FROM cm_rs_releves_posts', [])).length, 1);
  // Suppression du compte du rédacteur : ses saisies restent, sans auteur.
  await ok('/moi', s.red12345, { methode: 'DELETE' });
  assert.equal((await b.base.premier('SELECT cree_par FROM cm_rs_publications WHERE id = ?', [v.publication.id])).cree_par, null);
  assert.equal((await b.base.premier('SELECT saisi_par FROM cm_rs_releves_posts', [])).saisi_par, null);
});
