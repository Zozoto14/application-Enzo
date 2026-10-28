/**
 * Trombinoscope (migration 0030, page Membres › Trombinoscope) :
 *  - règles pures : réseaux (https, domaine attendu, adresse de profil), dates, palmarès, anciennes structures,
 *    photo (format reconnu aux octets, carrée, bornée), palmarès calculé, texte d'annonce sans champ réservé ;
 *  - migration sur une base existante (staff des teams, rôles CM système) ;
 *  - PERMISSIONS : un joueur ne modifie que SA fiche et ne voit que les membres de ses teams, champs « membres »
 *    seulement ; le CM (club) et le staff voient ; l'éditeur ne touche ni aux champs privés ni à la visibilité ;
 *  - palmarès calculé depuis les tournois et résultats (jamais un résultat réservé au staff) ;
 *  - photo, texte d'annonce FR / EN, visuel « Recrue » prérempli ;
 *  - RGPD (export, suppression du compte : fiche et photo effacées), export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { donneesVisuel } from '../noyau/cm/visuels/champs.mjs';
import {
  champVisible,
  lireDatePartielle,
  lirePalmares,
  lireReseaux,
  lireStructures,
  palmaresCalcule,
  texteFiche,
  validerReseau,
  verifierPhoto,
} from '../noyau/trombi/regles.mjs';

/** En-tête PNG (signature + IHDR) d'une image `l` × `h` : le serveur ne lit que les dimensions. */
function png(l, h, taille = 64) {
  const o = new Uint8Array(Math.max(taille, 33));
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(o.buffer);
  v.setUint32(16, l);
  v.setUint32(20, h);
  return Buffer.from(o).toString('base64');
}
const photo = (cote = 512, mini = 128) => ({ type: 'image/png', donnees: png(cote, cote), miniature: png(mini, mini) });
let compteurId = 0;
const nouvelId = () => `id-${++compteurId}`;

// ------------------------------------------------------------------ Règles pures

test('réseaux : https, domaine attendu, adresse de PROFIL ; « autre » : site public nommé', () => {
  assert.deepEqual(validerReseau('x', 'https://x.com/Kai_GG'), { reseau: 'x', url: 'https://x.com/Kai_GG', identifiant: 'Kai_GG', libelle: '' });
  assert.equal(validerReseau('instagram', 'https://www.instagram.com/kai.gg/').identifiant, 'kai.gg');
  assert.equal(validerReseau('twitch', 'https://www.twitch.tv/kai_gg').identifiant, 'kai_gg');
  assert.equal(validerReseau('youtube', 'https://www.youtube.com/@kaigg').identifiant, 'kaigg');
  assert.equal(validerReseau('tiktok', 'https://www.tiktok.com/@kai.gg').identifiant, 'kai.gg');
  for (const [reseau, url] of [
    ['x', 'http://x.com/Kai_GG'],
    ['x', 'https://x.com.site-pirate.fr/Kai_GG'],
    ['x', 'https://x.com/Kai_GG/status/123'],
    ['instagram', 'https://x.com/kai'],
    ['instagram', 'https://www.instagram.com/p/abc123/'],
    ['twitch', 'https://user:mdp@twitch.tv/kai'],
    ['autre', 'https://192.168.1.10/profil'],
    ['autre', 'https://localhost/profil'],
    ['autre', 'javascript:alert(1)'],
  ]) assert.equal(validerReseau(reseau, url).erreur, 'url', `${reseau} ${url}`);
  assert.equal(validerReseau('autre', 'https://x.com/Kai', 'X').erreur, 'reseau-connu');
  assert.equal(validerReseau('autre', 'https://portfolio-exemple.fr/kai', '').erreur, 'libelle');
  assert.deepEqual(validerReseau('autre', 'https://portfolio-exemple.fr/kai', 'Portfolio'), { reseau: 'autre', url: 'https://portfolio-exemple.fr/kai', identifiant: '', libelle: 'Portfolio' });
  assert.equal(validerReseau('myspace', 'https://site.fr').erreur, 'reseau');
  assert.throws(() => lireReseaux([{ reseau: 'x', url: 'https://x.com/a' }, { reseau: 'x', url: 'https://x.com/a' }]), e => e.code === 'reseau-doublon');
  assert.throws(() => lireReseaux([{ reseau: 'x', url: 'https://instagram.com/a' }]), e => e.code === 'reseau-url' && e.details.index === 0);
});

test('palmarès et anciennes structures : dates partielles, placement, tri, période cohérente', () => {
  assert.equal(lireDatePartielle('2025'), '2025');
  assert.equal(lireDatePartielle('2025-02'), '2025-02');
  assert.equal(lireDatePartielle('2024-02-29'), '2024-02-29');
  for (const d of ['2025-02-30', '2025-13', '25-01-01', '1980', 'hier']) assert.throws(() => lireDatePartielle(d), e => e.code === 'date', d);
  const jeux = new Set(['valorant']);
  const p = lirePalmares(
    [
      { competition: 'Coupe Alpha', date: '2024-05', placement: 2, participants: 32, jeu: 'valorant', preuve: 'https://resultats-exemple.fr/coupe' },
      { competition: 'Ligue Beta', structure: 'Ancienne Team', date: '2025-03-01', placementTexte: 'Top 8', details: 'Phase finale\nen LAN' },
    ],
    { jeux, nouvelId },
  );
  assert.deepEqual(p.map(x => x.competition), ['Ligue Beta', 'Coupe Alpha'], 'du plus récent au plus ancien');
  assert.equal(p[0].details, 'Phase finale\nen LAN');
  assert.throws(() => lirePalmares([{ competition: 'X' }], { jeux, nouvelId }), e => e.code === 'palmares-competition');
  assert.throws(() => lirePalmares([{ competition: 'Coupe', placement: 0 }], { jeux, nouvelId }), e => e.code === 'palmares-placement');
  assert.throws(() => lirePalmares([{ competition: 'Coupe', jeu: 'inconnu' }], { jeux, nouvelId }), e => e.code === 'palmares-jeu');
  assert.throws(() => lirePalmares([{ competition: 'Coupe', preuve: 'http://site.fr' }], { jeux, nouvelId }), e => e.code === 'palmares-preuve');
  const s = lireStructures([{ structure: 'Ancienne Team', debut: '2022-01', fin: '2023-06', role: 'Capitaine' }, { structure: 'Académie', debut: '2023-07' }], { jeux, nouvelId });
  assert.deepEqual(s.map(x => x.structure), ['Académie', 'Ancienne Team']);
  assert.throws(() => lireStructures([{ structure: 'Ancienne Team', debut: '2023', fin: '2022-12' }], { jeux, nouvelId }), e => e.code === 'structures-periode');
});

test('photo : JPEG / PNG / WebP reconnus aux octets, carrée, côté et poids bornés', () => {
  const p = verifierPhoto(photo());
  assert.equal(p.cote, 512);
  assert.equal(p.type, 'image/png');
  assert.throws(() => verifierPhoto({ ...photo(), type: 'image/svg+xml' }), e => e.code === 'photo-format');
  assert.throws(() => verifierPhoto({ ...photo(), type: 'image/jpeg' }), e => e.code === 'photo-format', 'type annoncé différent du contenu');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"></svg>').toString('base64');
  assert.throws(() => verifierPhoto({ type: 'image/png', donnees: svg, miniature: png(128, 128) }), e => e.code === 'photo-format');
  assert.throws(() => verifierPhoto({ type: 'image/png', donnees: png(512, 400), miniature: png(128, 128) }), e => e.code === 'photo-carree');
  assert.throws(() => verifierPhoto({ type: 'image/png', donnees: png(4096, 4096), miniature: png(128, 128) }), e => e.code === 'photo-cote');
  assert.throws(() => verifierPhoto({ type: 'image/png', donnees: png(512, 512, 500 * 1024), miniature: png(128, 128) }), e => e.code === 'photo-poids');
  assert.throws(() => verifierPhoto({ type: 'image/png', donnees: 'pas du base64 !', miniature: png(128, 128) }), e => e.code === 'photo');
});

test('visibilité, palmarès calculé, texte d’annonce : jamais le nom réel ni un champ réservé', () => {
  assert.equal(champVisible('membre', 'membres'), true);
  assert.equal(champVisible('membre', 'staff'), false);
  assert.equal(champVisible('staff', 'staff'), true);
  assert.equal(champVisible('editeur', 'prive'), false);
  assert.equal(champVisible('moi', 'prive'), true);
  const c = palmaresCalcule({
    tournois: [
      { id: 't1', nom: 'Coupe Alpha', teamNom: 'Team Alpha', debut: '2026-09-01', fin: '2026-09-03', statut: 'termine', placement: 1, participants: 16 },
      { id: 't2', nom: 'Coupe à venir', teamNom: 'Team Alpha', debut: '2026-12-01', statut: 'a_venir', placement: null },
    ],
    matchs: [
      { tournoiId: 't1', issue: 'victoire', mvp: true },
      { tournoiId: 't1', issue: 'defaite', mvp: false },
      { tournoiId: null, issue: 'victoire', mvp: true },
    ],
  });
  assert.deepEqual(c.tournois.map(t => [t.nom, t.matchs, t.victoires, t.mvp]), [['Coupe Alpha', 2, 1, 1]]);
  assert.deepEqual(c.hors, { matchs: 1, victoires: 1, mvp: 1 });
  const fiche = {
    pseudo: 'Kai',
    nomReel: 'Nom Secret',
    teams: [{ nom: 'Team Alpha', jeuNom: 'Valorant', postes: ['Duelliste', 'IGL'] }],
    elos: [{ jeuNom: 'Valorant', valeur: '2450', rang: 'Immortel 2' }],
    palmares: [{ competition: 'Ligue Beta', placement: 3, participants: 64, date: '2025-03-01' }],
    calcule: c,
    structures: [{ structure: 'Ancienne Team' }],
    reseaux: [{ reseau: 'x', url: 'https://x.com/Kai_GG' }],
    visibilite: { structures: 'staff' },
  };
  const fr = texteFiche(fiche, 'fr');
  assert.match(fr, /^Kai\nTeam : Team Alpha \(Valorant\) · Duelliste \/ IGL/);
  assert.match(fr, /Elo Valorant : Immortel 2 · 2450/);
  assert.match(fr, /• 3e \/ 64 Ligue Beta — 2025-03/);
  assert.match(fr, /• 1er \/ 16 Coupe Alpha \(Team Alpha\) · MVP ×1/);
  assert.match(fr, /X : https:\/\/x\.com\/Kai_GG/);
  assert.doesNotMatch(fr, /Nom Secret|Ancienne Team/);
  const en = texteFiche(fiche, 'en');
  assert.match(en, /Achievements:\n• 3rd of 64 Ligue Beta/);
  assert.doesNotMatch(texteFiche({ ...fiche, visibilite: { reseaux: 'prive', elos: 'staff' } }, 'fr'), /x\.com|Immortel/);
});

// ------------------------------------------------------------------ Migration

test('migration 0030 sur une base existante : staff des teams, Responsable et Correspondant CM', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0030'));
  const t = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('team-1', 'Team', 'team', 'valorant', 'principal', ?, ?)", [t, t]);
  for (const cle of ['proprietaire', 'manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [`role-${cle}`, 'team-1', cle, cle, '#123456', t, t]);
  }
  assert.ok((await appliquerMigrations(base, migrations.filter(m => m.nom < '0031'))).includes('0030_trombinoscope.sql'));
  const perms = async (table, role) => (await base.tous(`SELECT permission FROM ${table} WHERE role_id = ? AND permission LIKE 'membres.trombi.%' ORDER BY permission`, [role])).map(l => l.permission);
  assert.deepEqual(await perms('role_permissions', 'role-manager'), ['membres.trombi.editer', 'membres.trombi.voir']);
  assert.deepEqual(await perms('role_permissions', 'role-coach'), ['membres.trombi.voir']);
  assert.deepEqual(await perms('role_permissions', 'role-analyste'), ['membres.trombi.voir']);
  assert.deepEqual(await perms('role_permissions', 'role-joueur'), []);
  assert.deepEqual(await perms('cm_role_permissions', 'cm-role-responsable'), ['membres.trombi.editer', 'membres.trombi.voir']);
  assert.deepEqual(await perms('cm_role_permissions', 'cm-role-correspondant'), ['membres.trombi.voir']);
  for (const table of ['trombi_fiches', 'trombi_photos']) assert.ok(TABLES.some(([n]) => n === table), `export : ${table}`);
});

// ------------------------------------------------------------------ Banc

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      own12345: { pseudo: 'Olga', role: 'proprietaire' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      tom12345: { pseudo: 'Tom', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
      coa12345: { pseudo: 'Coline', role: 'coach' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Beta', membres: { zoe12345: { pseudo: 'Zoé', role: 'joueur' } } });
  const s = { ...A.sessions, zoe12345: B.sessions.zoe12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.cor12345 = await b.session('cor12345', 'Corentin');
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  // Responsable CM du club ; Correspondant CM pour tout le club (voir seulement).
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cor12345', roleId: 'cm-role-correspondant', portee: 'club' } });
  return { b, A, B, s, api, ok };
}

const comptesDe = liste => liste.fiches.map(f => f.compte).sort();

// ------------------------------------------------------------------ Permissions

test('qui voit : le joueur ses teams (champs « membres »), le staff sa team, le CM et le Fondateur tout le club', async () => {
  const { b, s, api, ok } = await preparer();
  // Tom remplit sa fiche : nom réel (staff par défaut), elo réservé au staff, palmarès privé.
  await ok('/trombi/fiches/moi', s.tom12345, {
    methode: 'PATCH',
    corps: {
      nomReel: 'Thomas Exemple',
      elos: [{ jeu: 'valorant', valeur: '2450', rang: 'Immortel 2' }],
      palmares: [{ competition: 'Coupe Alpha', placement: 1, participants: 16, date: '2026-05' }],
      reseaux: [{ reseau: 'x', url: 'https://x.com/Tom_GG' }],
      postes: { [(await ok('/trombi', s.tom12345)).fiches[0].teams[0].id]: { postes: ['duelliste', 'igl'], personnages: ['jett'] } },
      visibilite: { elos: 'staff', palmares: 'prive' },
    },
  });
  // Léa (joueuse, même team) : les membres de SA team seulement ; ni nom réel, ni elo (staff), ni palmarès (privé).
  const vueLea = await ok('/trombi', s.lea12345);
  assert.equal(vueLea.droits.voir, 'equipe');
  assert.deepEqual(comptesDe(vueLea), ['coa12345', 'lea12345', 'man12345', 'own12345', 'principal', 'tom12345'], 'le Fondateur a créé la team');
  const tomVuParLea = await ok('/trombi/fiches/tom12345', s.lea12345);
  assert.equal(tomVuParLea.niveau, 'membre');
  assert.equal(tomVuParLea.nomReel, null);
  assert.equal(tomVuParLea.elos, null);
  assert.equal(tomVuParLea.palmares, null);
  assert.equal(tomVuParLea.visibilite, undefined, 'la visibilité n’est montrée qu’au joueur');
  assert.deepEqual(tomVuParLea.teams[0].postes.map(p => p.nom), ['Duelliste', 'IGL'], 'postes : noms du profil de jeu de la team');
  assert.deepEqual(tomVuParLea.reseaux.map(r => r.url), ['https://x.com/Tom_GG']);
  assert.equal(vueLea.fiches.find(f => f.compte === 'tom12345').elo, null);
  // Léa ne voit pas Zoé (autre team) : 404, comme une fiche qui n'existe pas.
  assert.equal((await api('/trombi/fiches/zoe12345', s.lea12345)).statut, 404);
  // Coach (staff de la team) : nom réel et elo, pas le palmarès privé ; pas Zoé.
  const vueCoach = await ok('/trombi', s.coa12345);
  assert.equal(vueCoach.droits.voir, 'teams');
  assert.ok(!comptesDe(vueCoach).includes('zoe12345'));
  const tomVuParCoach = await ok('/trombi/fiches/tom12345', s.coa12345);
  assert.equal(tomVuParCoach.nomReel, 'Thomas Exemple');
  assert.equal(tomVuParCoach.elos[0].rang, 'Immortel 2');
  assert.equal(tomVuParCoach.palmares, null);
  // Correspondant CM (club) : tout le club, Zoé comprise ; le Fondateur : tout, privé compris.
  const vueCor = await ok('/trombi', s.cor12345);
  assert.equal(vueCor.droits.voir, 'club');
  assert.equal(vueCor.droits.editer, false);
  assert.ok(comptesDe(vueCor).includes('zoe12345'));
  assert.equal((await ok('/trombi/fiches/tom12345', s.cor12345)).elos[0].valeur, '2450');
  assert.equal((await ok('/trombi/fiches/tom12345', s.fondateur)).palmares[0].competition, 'Coupe Alpha');
  // Un compte sans team ni droit : sa propre fiche seulement.
  const seul = await b.session('sol12345', 'Solo');
  assert.deepEqual(comptesDe(await ok('/trombi', seul)), ['sol12345']);
});

test('qui modifie : le joueur SA fiche ; l’éditeur complète sans toucher au privé ni à la visibilité ; lecture seule : 403', async () => {
  const { s, api, ok } = await preparer();
  await ok('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { presentation: 'Entry fragger', visibilite: { structures: 'prive' } } });
  // Léa ne modifie pas la fiche de Tom (403 : elle la voit, mais n'a pas le droit).
  for (const corps of [{ presentation: 'Piraté' }, { nomReel: 'X' }]) assert.equal((await api('/trombi/fiches/tom12345', s.lea12345, { methode: 'PATCH', corps })).statut, 403);
  assert.equal((await api('/trombi/fiches/tom12345/photo', s.lea12345, { methode: 'PUT', corps: photo() })).statut, 403);
  // Correspondant CM (voir seulement) et coach (voir) : 403.
  assert.equal((await api('/trombi/fiches/tom12345', s.cor12345, { methode: 'PATCH', corps: { presentation: 'x' } })).statut, 403);
  assert.equal((await api('/trombi/fiches/tom12345', s.coa12345, { methode: 'PATCH', corps: { presentation: 'x' } })).statut, 403);
  // Manager (éditeur de la team) : complète l'elo ; pas les anciennes structures (privées), pas la visibilité.
  const v = await ok('/trombi/fiches/tom12345', s.man12345, { methode: 'PATCH', corps: { elos: [{ jeu: 'valorant', valeur: '2300' }] } });
  assert.equal(v.niveau, 'editeur');
  assert.equal(v.elos[0].majLe, '2026-10-20', 'date de mise à jour posée');
  assert.equal((await api('/trombi/fiches/tom12345', s.man12345, { methode: 'PATCH', corps: { structures: [{ structure: 'Ancienne Team' }] } })).corps.code, 'champ-prive');
  assert.equal((await api('/trombi/fiches/tom12345', s.man12345, { methode: 'PATCH', corps: { visibilite: { elos: 'membres' } } })).corps.code, 'visibilite');
  // Responsable CM (club) : complète aussi Zoé (autre team).
  await ok('/trombi/fiches/zoe12345', s.cm123456, { methode: 'PATCH', corps: { reseaux: [{ reseau: 'twitch', url: 'https://www.twitch.tv/zoe_live' }] } });
  // Validation des adresses par l'API : mauvais domaine, publication au lieu du profil, http.
  for (const url of ['https://www.twitch.tv.site-pirate.fr/zoe', 'https://www.twitch.tv/zoe_live/clip/abc', 'http://www.twitch.tv/zoe_live']) {
    const r = await api('/trombi/fiches/zoe12345', s.cm123456, { methode: 'PATCH', corps: { reseaux: [{ reseau: 'twitch', url }] } });
    assert.equal(r.statut, 400, url);
    assert.equal(r.corps.code, 'reseau-url');
  }
  // Postes : seulement des clés du profil de jeu de la team du joueur.
  const teamA = (await ok('/trombi/fiches/tom12345', s.tom12345)).teams[0].id;
  assert.equal((await api('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { postes: { [teamA]: { postes: ['inconnu'] } } } })).corps.code, 'postes-cle');
  const teamB = (await ok('/trombi/fiches/zoe12345', s.zoe12345)).teams[0].id;
  assert.equal((await api('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { postes: { [teamB]: { postes: ['igl'] } } } })).corps.code, 'postes-team');
  // Version attendue : 409 si la fiche a changé.
  const actuelle = await ok('/trombi/fiches/moi', s.tom12345);
  assert.equal((await api('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { presentation: 'a', versionAttendue: actuelle.version - 1 } })).statut, 409);
  // Le joueur est prévenu quand un autre modifie sa fiche.
  const notifs = await ok('/notifications', s.tom12345);
  assert.ok(notifs.liste.some(n => n.type === 'trombi-modifiee'));
  // Un joueur sans droit ne voit pas les droits d'édition.
  assert.equal((await ok('/trombi', s.lea12345)).fiches.find(f => f.compte === 'tom12345').peutEditer, false);
  assert.equal((await ok('/trombi', s.lea12345)).fiches.find(f => f.compte === 'lea12345').peutEditer, true);
});

test('photo : le joueur l’envoie (carrée, vérifiée), la carte montre la miniature, l’export la propose', async () => {
  const { s, api, ok } = await preparer();
  const d = await ok('/trombi/fiches/moi/photo', s.lea12345, { methode: 'PUT', corps: photo() });
  assert.match(d.photo.url, /^data:image\/png;base64,/);
  assert.equal(d.photo.cote, 512);
  assert.match((await ok('/trombi', s.tom12345)).fiches.find(f => f.compte === 'lea12345').photo, /^data:image\/png;base64,/);
  assert.equal((await api('/trombi/fiches/moi/photo', s.lea12345, { methode: 'PUT', corps: { ...photo(), donnees: png(512, 300) } })).corps.code, 'photo-carree');
  // Photo privée : le Manager (éditeur) ne la voit plus et ne la remplace pas.
  await ok('/trombi/fiches/moi', s.lea12345, { methode: 'PATCH', corps: { visibilite: { photo: 'prive' } } });
  assert.equal((await ok('/trombi/fiches/lea12345', s.man12345)).photo, null);
  assert.equal((await api('/trombi/fiches/lea12345/photo', s.man12345, { methode: 'DELETE' })).corps.code, 'champ-prive');
  assert.equal((await ok('/trombi/fiches/moi/photo', s.lea12345, { methode: 'DELETE' })).photo, null);
});

// ------------------------------------------------------------------ Palmarès calculé, texte, visuel

test('palmarès calculé depuis les tournois et résultats du club (MVP, placements), jamais un résultat staff', async () => {
  const { b, A, s, ok } = await preparer();
  const t = '2026-10-01T00:00:00.000Z';
  const base = b.base;
  await base.executer(
    "INSERT INTO tournois (id, team_id, nom, jeu, debut, fin, statut, classement_final, participants, publiable, cree_le, maj_le) VALUES ('tn-1', ?, 'Coupe Gamma', 'valorant', '2026-09-01', '2026-09-03', 'termine', 2, 32, 1, ?, ?)",
    [A.teamId, t, t],
  );
  await base.executer("INSERT INTO tournois (id, team_id, nom, jeu, statut, publiable, cree_le, maj_le) VALUES ('tn-2', ?, 'Coupe privée', 'valorant', 'termine', 0, ?, ?)", [A.teamId, t, t]);
  for (const id of ['tn-1', 'tn-2']) await base.executer("INSERT INTO tournoi_roster (tournoi_id, compte_id, team_id, role, cree_le) VALUES (?, 'tom12345', ?, 'titulaire', ?)", [id, A.teamId, t]);
  const resultat = (id, tournoi, issue, mvp, visibilite = 'team') =>
    base.executer(
      "INSERT INTO resultats (id, team_id, genre, tournoi_id, jeu, systeme, date_match, issue, mvp_id, visibilite, publiable, cree_le, maj_le) VALUES (?, ?, ?, ?, 'valorant', 'serie', '2026-09-02', ?, ?, ?, 1, ?, ?)",
      [id, A.teamId, tournoi ? 'tournoi' : 'officiel', tournoi, issue, mvp, visibilite, t, t],
    );
  await resultat('r-1', 'tn-1', 'victoire', 'tom12345');
  await resultat('r-2', 'tn-1', 'defaite', null);
  await resultat('r-3', null, 'victoire', 'tom12345');
  await resultat('r-4', null, 'victoire', 'tom12345', 'staff');
  for (const [i, r] of ['r-1', 'r-2', 'r-3', 'r-4'].entries()) await base.executer("INSERT INTO resultat_joueurs (id, resultat_id, team_id, compte_id, position) VALUES (?, ?, ?, 'tom12345', 0)", [`rj-${i}`, r, A.teamId]);
  const d = await ok('/trombi/fiches/tom12345', s.cm123456);
  assert.deepEqual(d.calcule.tournois.map(x => [x.nom, x.placement, x.participants, x.matchs, x.victoires, x.mvp, x.calcule]), [['Coupe Gamma', 2, 32, 2, 1, 1, true]]);
  assert.deepEqual(d.calcule.hors, { matchs: 1, victoires: 1, mvp: 1 }, 'le résultat réservé au staff ne compte pas');
  // Texte d'annonce, en français et en anglais : palmarès calculé compris, jamais le nom réel.
  await ok('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { nomReel: 'Thomas Exemple', reseaux: [{ reseau: 'instagram', url: 'https://www.instagram.com/tom.gg/' }] } });
  const texte = await ok('/trombi/fiches/tom12345/texte', s.cm123456);
  assert.match(texte.fr, /^Tom\nTeam : Team Alpha \(Valorant\)/);
  assert.match(texte.fr, /• 2e \/ 32 Coupe Gamma \(Team Alpha\) · MVP ×1/);
  assert.match(texte.en, /• 2nd of 32 Coupe Gamma/);
  assert.match(texte.fr, /Instagram : https:\/\/www\.instagram\.com\/tom\.gg\//);
  assert.doesNotMatch(`${texte.fr}${texte.en}`, /Thomas|Coupe privée/);
});

test('visuel « Recrue » prérempli : postes du profil de la team, elo ; le rôle de team sans fiche', async () => {
  const { b, A, s, ok } = await preparer();
  await ok('/trombi/fiches/moi', s.tom12345, { methode: 'PATCH', corps: { postes: { [A.teamId]: { postes: ['igl'] } }, elos: [{ jeu: 'valorant', rang: 'Ascendant 3' }], structures: [{ structure: 'Ancienne Team', debut: '2024' }] } });
  const d = await donneesVisuel(b.base, { genre: 'membre', teamId: A.teamId, id: 'tom12345' });
  assert.deepEqual([d.fr.champs.joueur, d.fr.champs.poste, d.fr.champs.elo, d.fr.champs.ancienne_structure], ['Tom', 'IGL', 'Ascendant 3', 'Ancienne Team']);
  const lea = await donneesVisuel(b.base, { genre: 'membre', teamId: A.teamId, id: 'lea12345' });
  assert.deepEqual([lea.fr.champs.poste, lea.en.champs.poste, lea.fr.champs.elo], ['Joueur', 'Player', '']);
});

// ------------------------------------------------------------------ RGPD, export / import

test('RGPD : export de la fiche et de la photo ; suppression du compte : fiche et photo effacées', async () => {
  const { b, s, api, ok } = await preparer();
  await ok('/trombi/fiches/moi', s.lea12345, { methode: 'PATCH', corps: { nomReel: 'Léa Exemple', palmares: [{ competition: 'Coupe Alpha', placement: 3 }] } });
  await ok('/trombi/fiches/moi/photo', s.lea12345, { methode: 'PUT', corps: photo() });
  // Le Manager corrige la fiche de Tom : à la suppression du Manager, il n'en est plus l'auteur.
  await ok('/trombi/fiches/tom12345', s.man12345, { methode: 'PATCH', corps: { presentation: 'Support' } });
  const exp = await ok('/moi/export', s.lea12345);
  assert.equal(exp.trombinoscope.nomReel, 'Léa Exemple');
  assert.equal(exp.trombinoscope.palmares[0].competition, 'Coupe Alpha');
  assert.match(exp.trombinoscopePhoto.image, /^data:image\/png;base64,/);
  // Copie de la base (export / import) avant les suppressions.
  const copie = await exporterBase(b.base);
  assert.equal(copie.tables.trombi_photos.length, 1);
  const autre = await baseMigree();
  const bilan = await importerBase(autre, copie);
  assert.equal(bilan.trombi_fiches, 2);
  assert.equal((await autre.premier("SELECT nom_reel FROM trombi_fiches WHERE compte_id = 'lea12345'", [])).nom_reel, 'Léa Exemple');
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM trombi_fiches WHERE compte_id = 'lea12345'", [])).n * 1, 0);
  assert.equal((await b.base.premier("SELECT COUNT(*) AS n FROM trombi_photos WHERE compte_id = 'lea12345'", [])).n * 1, 0);
  // Retrait d'un compte par l'Administration (Fondateur) : même effacement.
  assert.equal((await api('/admin/comptes/man12345/hub', s.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.premier("SELECT maj_par FROM trombi_fiches WHERE compte_id = 'tom12345'", [])).maj_par, null);
});
