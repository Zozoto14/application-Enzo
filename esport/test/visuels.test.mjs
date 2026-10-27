/**
 * Visuels de la section CM (migration 0025) :
 *  - règles pures : validation d'un document (calques, couleurs, polices, sources d'image SANS adresse,
 *    entrées hostiles), de la charte, dimensions des images (PNG, JPEG, GIF, WebP), classement d'équipes ;
 *  - données des champs dynamiques selon le profil : Valorant BO3 (score de série + maps + MVP), multi-équipes
 *    (The Finals : place, points, classement des équipes), annonce (date, heure, fuseau), roster, programme ;
 *  - permissions : charte (cm.gerer), modèles et visuels (cm.editer de la portée), périmètre (contenu staff
 *    jamais), autre team 404 ;
 *  - modèles : création, versions, restauration, duplication, conflit ;
 *  - rendu : taille exacte vérifiée, joint à la carte post (remplace le précédent, invalide un post validé),
 *    données changées (409), régénération signalée ;
 *  - RGPD, export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { morceau, sha } from './medias-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { TABLES, exporterBase, importerBase } from '../noyau/transfert.mjs';
import { CHARTE_DEFAUT, DocumentInvalide, lireCharte, lireDocument, lireDocuments } from '../noyau/cm/visuels/document.mjs';
import { dimensionsImage, dimensionsAcceptables } from '../noyau/cm/visuels/images.mjs';
import { classementEquipes, morceauxDate } from '../noyau/cm/visuels/champs.mjs';

// ------------------------------------------------------------------ Outils

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = o => {
  let c = 0xffffffff;
  for (const x of o) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
};
/** PNG valide (uni, RGB) de `l` × `h` pixels. */
function pngFactice(l, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const brut = Buffer.alloc((l * 3 + 1) * h);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(brut)), chunk('IEND', Buffer.alloc(0))]));
}

const calqueTexte = (id, texte, extra = {}) => ({ id, type: 'texte', x: 80, y: 80, l: 900, h: 200, texte, police: 'charte:titre', taille: 96, graisse: 800, couleur: { type: 'uni', couleur: 'charte:primaire' }, ...extra });
const docCarre = (calques = [calqueTexte('t1', { fr: '{team} vs {adversaire}', en: '{team} vs {adversaire}' })]) => ({ format: 'carre', fond: { type: 'degrade', couleurs: ['charte:fond', 'charte:fond2'], angle: 135 }, calques });

const invalide = (f, raison) => assert.throws(f, e => e instanceof DocumentInvalide && e.raison === raison, raison);

// ------------------------------------------------------------------ Règles pures

test('document : sérialisation et relecture stables ; calques, jetons de charte, effets', () => {
  const doc = lireDocument({
    ...docCarre([
      calqueTexte('titre', { fr: 'JOUR DE MATCH', en: 'MATCH DAY' }, { glitch: true, lueur: { couleur: 'charte:secondaire', force: 40 }, ajuster: true, majuscules: true }),
      { id: 'logo', type: 'logo', cible: 'team', x: 40, y: 40, l: 160, h: 160 },
      { id: 'map', type: 'image', source: { champ: 'map_1' }, x: 0, y: 0, l: 1080, h: 600, opacite: 0.4 },
      { id: 'agent', type: 'image', source: { asset: 'agent:kay-o' }, x: 0, y: 0, l: 300, h: 300 },
      { id: 'cadre', type: 'forme', forme: 'chanfrein', coupe: 40, remplissage: { type: 'uni', couleur: '#00F0FF80' }, contour: { couleur: 'charte:accent', epaisseur: 4 } },
      { id: 'maps', type: 'liste', source: 'manches', ligne: { fr: '{carte}  {score}', en: '{carte}  {score}' }, si: 'serie' },
    ]),
    effets: { scanlines: 0.5, grain: 0.2 },
  });
  assert.equal(doc.calques.length, 6);
  assert.equal(doc.calques[4].remplissage.couleur, '#00f0ff80', 'couleurs en minuscules');
  assert.equal(doc.calques[0].police, 'charte:titre');
  assert.equal(doc.calques[5].si, 'serie');
  // Relire ce qu'on a écrit donne la même chose (aller-retour JSON).
  assert.deepEqual(lireDocument(JSON.parse(JSON.stringify(doc))), doc);
  // Texte simple → même texte dans les deux langues ; contrôles retirés, longueur bornée.
  const t = lireDocument(docCarre([calqueTexte('a', 'Bonjour\u0007 {team}\nligne 2')])).calques[0].texte;
  assert.deepEqual(t, { fr: 'Bonjour {team}\nligne 2', en: 'Bonjour {team}\nligne 2' });
  assert.equal(lireDocument(docCarre([calqueTexte('a', 'x'.repeat(900))])).calques[0].texte.fr.length, 600);
  // Documents d'un modèle : un par format, le format est sa clé.
  const docs = lireDocuments({ carre: docCarre(), story: { ...docCarre(), format: 'story' } });
  assert.deepEqual(Object.keys(docs), ['carre', 'story']);
});

test('document : entrées hostiles ou malformées refusées avec le chemin fautif', () => {
  invalide(() => lireDocument(null), 'objet');
  invalide(() => lireDocument({ format: 'a4', calques: [] }), 'valeur');
  invalide(() => lireDocument(docCarre([{ id: 'i', type: 'image', source: { url: 'https://site-exemple.fr/a.png' } }])), 'source');
  invalide(() => lireDocument(docCarre([{ id: 'i', type: 'image', source: { fichier: 'data:image/png;base64,AAAA' } }])), 'source');
  invalide(() => lireDocument(docCarre([{ id: 'i', type: 'image', source: { asset: 'map:../../etc' } }])), 'source');
  invalide(() => lireDocument(docCarre([{ id: 'i', type: 'image', source: { champ: 'logo_team', url: 'https://x' } }])), 'source');
  invalide(() => lireDocument(docCarre([{ id: 'i', type: 'script' }])), 'valeur');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x'), calqueTexte('a', 'y')])), 'id-en-double');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { couleur: { type: 'uni', couleur: 'red' } })])), 'couleur');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { couleur: { type: 'uni', couleur: 'url(javascript:1)' } })])), 'couleur');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { police: 'Comic Sans MS' })])), 'police');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { taille: 1e9 })])), 'nombre');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { x: Number.NaN })])), 'nombre');
  invalide(() => lireDocument(docCarre([calqueTexte('a', 'x', { si: 'champ:a; drop' })])), 'condition');
  invalide(() => lireDocument(docCarre(Array.from({ length: 121 }, (_, i) => calqueTexte(`c${i}`, 'x')))), 'trop-de-calques');
  invalide(() => lireDocuments({ carre: { ...docCarre(), format: 'story' } }), 'format');
  invalide(() => lireDocuments({}), 'vide');
  try {
    lireDocument(docCarre([calqueTexte('ok', 'x'), { id: 'i', type: 'image', source: { url: 'https://x' } }]));
  } catch (e) {
    assert.equal(e.chemin, 'document.calques.1.source');
  }
});

test('charte : thème cyberpunk par défaut, saisie validée, valeurs absentes gardées', () => {
  const d = lireCharte({});
  assert.equal(d.couleurs.primaire, CHARTE_DEFAUT.couleurs.primaire);
  assert.deepEqual(d.polices, { titre: 'Orbitron', sousTitre: 'Chakra Petch', texte: 'Manrope', chiffres: 'Orbitron' });
  assert.ok(d.effets.scanlines > 0 && d.effets.glitch);
  const c = lireCharte({ couleurs: { primaire: '#FF0000' }, polices: { titre: 'Chakra Petch' }, effets: { grain: 0 }, club: '  Les Faucons ' });
  assert.equal(c.couleurs.primaire, '#ff0000');
  assert.equal(c.couleurs.secondaire, CHARTE_DEFAUT.couleurs.secondaire);
  assert.equal(c.polices.titre, 'Chakra Petch');
  assert.equal(c.effets.grain, 0);
  assert.equal(c.club, 'Les Faucons');
  assert.equal(lireCharte({ effets: { neon: 0.1 } }, c).couleurs.primaire, '#ff0000', 'modification partielle');
  invalide(() => lireCharte({ couleurs: { primaire: 'rouge' } }), 'couleur');
  invalide(() => lireCharte({ couleurs: { inconnue: '#000000' } }), 'cle');
  invalide(() => lireCharte({ polices: { titre: 'Arial' } }), 'police');
  invalide(() => lireCharte({ logos: { club: 'https://site-exemple.fr/logo.png' } }), 'fichier');
});

test('images : dimensions PNG, GIF, WebP, JPEG ; bornes', () => {
  assert.deepEqual(dimensionsImage(pngFactice(1080, 1350)), { format: 'png', largeur: 1080, hauteur: 1350 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(dimensionsImage(gif), { format: 'gif', largeur: 320, hauteur: 240 });
  const webp = new Uint8Array(30);
  webp.set(Buffer.from('RIFF'), 0);
  webp.set(Buffer.from('WEBPVP8X'), 8);
  webp.set([0x7f, 0x07, 0x00], 24);
  webp.set([0x37, 0x04, 0x00], 27);
  assert.deepEqual(dimensionsImage(webp), { format: 'webp', largeur: 1920, hauteur: 1080 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0, 0, 0, 0, 0]);
  assert.deepEqual(dimensionsImage(jpeg), { format: 'jpeg', largeur: 1920, hauteur: 1080 });
  assert.equal(dimensionsImage(new Uint8Array([1, 2, 3])), null);
  assert.ok(!dimensionsAcceptables({ largeur: 9000, hauteur: 10 }));
  assert.ok(dimensionsAcceptables({ largeur: 1080, hauteur: 1920 }));
});

test('classement des équipes (multi-équipes) et morceaux de date avec fuseau', () => {
  const manches = [
    { place: 2, points: 6, classement: [{ nom: 'Orion', place: 1, points: 10 }, { nom: 'Vega', place: 3, points: 3 }, { nom: 'Lynx', place: 4, points: 1 }] },
    { place: 1, points: 10, classement: [{ nom: 'Orion', place: 4, points: 1 }, { nom: 'Vega', place: 2, points: 6 }, { nom: 'Lynx', place: 3, points: 3 }] },
  ];
  assert.deepEqual(classementEquipes(manches, 'Squad', { place: 1 }).map(l => [l.place, l.equipe, l.points, l.nous]), [['1', 'Squad', '16', true], ['2', 'Orion', '11', false], ['3', 'Vega', '9', false], ['4', 'Lynx', '4', false]]);
  assert.deepEqual(classementEquipes([manches[0]], 'Squad').map(l => l.equipe), ['Orion', 'Squad', 'Vega', 'Lynx']);
  const d = morceauxDate('Europe/Paris', '2026-10-24T18:00:00.000Z', 'fr');
  assert.equal(d.heure, '20:00');
  assert.equal(d.fuseau, 'CEST');
  assert.match(d.date, /samedi 24 octobre/);
  const en = morceauxDate('Europe/Paris', '2026-10-24T18:00:00.000Z', 'en');
  assert.match(en.date, /Saturday 24 October/);
  assert.equal(morceauxDate('Europe/Paris', '2026-11-24T19:00:00.000Z', 'fr').fuseau, 'CET');
});

test('migration 0025 sur une base existante, tables exportées', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0025'));
  assert.deepEqual(await appliquerMigrations(base, migrations), migrations.filter(m => m.nom >= '0025').map(m => m.nom));
  for (const t of ['cm_charte', 'cm_modeles', 'cm_modele_versions', 'cm_visuels', 'cm_visuel_images']) assert.ok(TABLES.some(([n]) => n === t), `export : ${t}`);
});

// ------------------------------------------------------------------ Banc

const FINALS = {
  formats: [{ nom: '3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] }],
  score: { type: 'placement', bareme: [{ place: 1, points: 10 }, { place: 2, points: 6 }, { place: 3, points: 3 }, { place: 4, points: 1 }] },
  modes: [{ nom: 'Cashout', formats: ['3v3v3v3'] }],
  cartes: [{ nom: 'Monaco', modes: ['cashout'] }, { nom: 'Seoul', modes: ['cashout'] }],
  classes: [{ nom: 'Light' }, { nom: 'Medium' }, { nom: 'Heavy' }],
  personnages: [{ nom: 'Light', classe: 'light' }, { nom: 'Medium', classe: 'medium' }, { nom: 'Heavy', classe: 'heavy' }],
  roster: { titulaires: 3, remplacants: 1 },
};

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, {
    membres: {
      coach123: { pseudo: 'Zed', role: 'coach' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      kai12345: { pseudo: 'Kai', role: 'joueur' },
      man12345: { pseudo: 'Max', role: 'manager' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { nox12345: { pseudo: 'Nox', role: 'joueur' } } });
  const s = { ...A.sessions, nox12345: B.sessions.nox12345 };
  s.cm123456 = await b.session('cm123456', 'Clara');
  s.cor12345 = A.sessions.man12345;
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  await ok('/cm/affectations', s.fondateur, { methode: 'POST', corps: { compte: 'cm123456', roleId: 'cm-role-responsable', portee: 'club' } });
  for (const t of [A.teamId, B.teamId]) await ok(`/teams/${t}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  const nova = (await ok(`/teams/${A.teamId}/scouting/adversaires`, s.coach123, { methode: 'POST', corps: { nom: 'Nova' } })).id;
  return { b, A, B, s, api, ok, nova };
}

/** Envoie des octets par morceaux dans la section CM (portée club ou team) ; rend l'identifiant de l'envoi. */
async function envoyerCm(b, ok, jeton, portee, octets, nom = 'visuel.png') {
  const env = await ok(`/cm/portees/${portee}/envois`, jeton, { methode: 'POST', corps: { nom, taille: octets.length } });
  for (let i = 0; i < env.morceaux; i++) {
    const r = await morceau(b, jeton, `/cm/portees/${portee}/envois/${env.id}`, i, octets.subarray(i * env.tailleMorceau, (i + 1) * env.tailleMorceau));
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  }
  await ok(`/cm/portees/${portee}/envois/${env.id}/fin`, jeton, { methode: 'POST', corps: { sha256: sha(octets) } });
  return env.id;
}

/** Résultat Valorant BO3 publiable (2-1 contre Nova, maps Ascent, Bind, Haven ; MVP Léa sur Jett). */
const bo3 = nova => ({
  genre: 'officiel',
  date: '2026-10-19 20:00',
  bo: 3,
  adversaires: [{ id: nova }],
  manches: [
    { carteCle: 'ascent', nous: 13, eux: 9 },
    { carteCle: 'bind', nous: 7, eux: 13 },
    { carteCle: 'haven', nous: 14, eux: 12 },
  ],
  joueurs: [{ compte: 'lea12345', personnages: ['jett'] }, { compte: 'kai12345', personnages: ['kay-o'] }],
  mvp: 'lea12345',
});

// ------------------------------------------------------------------ Champs dynamiques selon le profil

test('données : Valorant BO3 (score de série, maps, MVP et son agent) en français et en anglais ; staff jamais', async () => {
  const { A, s, api, ok, nova } = await preparer();
  const r = (await ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: bo3(nova) })).resultat;
  const { donnees: d } = await ok(`/cm/visuels/donnees?portee=club&genre=resultat&teamId=${A.teamId}&id=${r.id}`, s.cm123456);
  assert.equal(d.systeme, 'serie');
  assert.equal(d.fr.champs.score, '2-1');
  assert.deepEqual([d.fr.champs.score_nous, d.fr.champs.score_eux], ['2', '1']);
  assert.equal(d.fr.champs.issue, 'Victoire');
  assert.equal(d.en.champs.issue, 'Victory');
  assert.equal(d.fr.champs.adversaire, 'Nova');
  assert.equal(d.fr.champs.team, 'Team Alpha');
  assert.equal(d.fr.champs.bo, 'BO3');
  assert.equal(d.fr.champs.mvp, 'Léa');
  assert.equal(d.fr.champs.mvp_agent, 'Jett');
  assert.equal(d.fr.champs.heure, '20:00');
  assert.equal(d.fr.champs.fuseau, 'CEST');
  assert.deepEqual(d.fr.listes.manches.map(m => [m.carte, m.score, m.issue]), [['Ascent', '13-9', 'Victoire'], ['Bind', '7-13', 'Défaite'], ['Haven', '14-12', 'Victoire']]);
  assert.equal(d.en.listes.manches[1].issue, 'Defeat');
  assert.deepEqual(d.images.map_1, { asset: 'map:ascent' });
  assert.deepEqual(d.images.map_3, { asset: 'map:haven' });
  assert.deepEqual(d.images.agent_mvp, { asset: 'agent:jett' });
  assert.deepEqual(d.jeu, { cle: 'valorant', base: 'valorant' });
  assert.match(d.empreinte, /^[0-9a-f]{64}$/);
  // Un résultat réservé au staff n'est jamais lisible par le CM.
  const staff = (await ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: { ...bo3(nova), visibilite: 'staff' } })).resultat;
  assert.equal((await api(`/cm/visuels/donnees?portee=club&genre=resultat&teamId=${A.teamId}&id=${staff.id}`, s.cm123456)).corps.code, 'non-publiable');
  // Un joueur (sans cm.editer) ne lit pas les données ; une autre team : 404.
  assert.equal((await api(`/cm/visuels/donnees?portee=${A.teamId}&genre=resultat&id=${r.id}`, s.lea12345)).statut, 403);
  assert.equal((await api(`/cm/visuels/donnees?portee=${A.teamId}&genre=resultat&id=${r.id}`, s.nox12345)).statut, 404);
});

test('données : multi-équipes (The Finals) — place, points, classement des équipes ; annonce avec fuseau ; roster ; programme', async () => {
  const { b, A, s, ok, nova } = await preparer();
  assert.equal((await b.appel('/jeux', { methode: 'POST', jeton: s.fondateur, corps: { nom: 'The Finals', couleur: '#d31f3c', donnees: FINALS } })).statut, 200);
  const F = await teamAvecMembres(b, { nom: 'Finals Squad', jeu: 'the-finals', membres: { tom12345: { pseudo: 'Tom', role: 'joueur' }, zoe12345: { pseudo: 'Zoé', role: 'coach' } } });
  await ok(`/teams/${F.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { cm: true } } });
  const res = (
    await ok(`/teams/${F.teamId}/resultats`, F.sessions.zoe12345, {
      methode: 'POST',
      corps: {
        formatCle: '3v3v3v3',
        date: '2026-10-19 21:00',
        adversaires: [{ nom: 'Orion' }, { nom: 'Vega' }, { nom: 'Lynx' }],
        manches: [
          { carteCle: 'monaco', modeCle: 'cashout', place: 2, classement: [{ nom: 'Orion', place: 1 }, { nom: 'Vega', place: 3 }, { nom: 'Lynx', place: 4 }] },
          { carteCle: 'seoul', modeCle: 'cashout', place: 1, classement: [{ nom: 'Orion', place: 4 }, { nom: 'Vega', place: 2 }, { nom: 'Lynx', place: 3 }] },
        ],
      },
    })
  ).resultat;
  const { donnees: d } = await ok(`/cm/visuels/donnees?portee=club&genre=resultat&teamId=${F.teamId}&id=${res.id}`, s.cm123456);
  assert.equal(d.systeme, 'classement');
  assert.equal(d.fr.champs.place, '1er');
  assert.equal(d.en.champs.place, '1st');
  assert.equal(d.fr.champs.points, '16');
  assert.equal(d.fr.champs.classement, '1er sur 4');
  assert.equal(d.fr.champs.score_nous, '', 'pas de score de série');
  assert.deepEqual(d.fr.listes.classement.map(l => [l.place_texte, l.equipe, l.points, l.nous]), [['1er', 'Finals Squad', '16', true], ['2e', 'Orion', '11', false], ['3e', 'Vega', '9', false], ['4e', 'Lynx', '4', false]]);
  assert.deepEqual(d.fr.listes.manches.map(m => [m.carte, m.place, m.points]), [['Monaco', '2e', '6'], ['Seoul', '1er', '10']]);
  assert.equal(d.jeu.cle, 'the-finals');

  // Annonce d'un match de tournoi (Valorant) : date, heure et fuseau de la team ; roster du tournoi.
  const t = `/teams/${A.teamId}/tournois`;
  const tournoi = (await ok(t, s.coach123, { methode: 'POST', corps: { nom: 'Coupe d’automne', formatCle: '5v5', bo: 3 } })).tournoi;
  await ok(`${t}/${tournoi.id}/roster`, s.coach123, { methode: 'PUT', corps: { titulaires: ['lea12345', 'kai12345'] } });
  const m = (await ok(`${t}/${tournoi.id}/matchs`, s.coach123, { methode: 'POST', corps: { tour: 'Quart de finale', date: '2026-11-07', heure: '20:30', adversaires: [{ id: nova }] } })).matchs.at(-1);
  const an = (await ok(`/cm/visuels/donnees?portee=${A.teamId}&genre=annonce&id=${m.id}`, s.cm123456)).donnees;
  assert.equal(an.fr.champs.heure, '20:30');
  assert.equal(an.fr.champs.fuseau, 'CET');
  assert.match(an.fr.champs.date_heure, /samedi 7 novembre · 20:30 CET/);
  assert.match(an.en.champs.date, /Saturday 7 November/);
  assert.equal(an.fr.champs.tournoi, 'Coupe d’automne');
  assert.equal(an.fr.champs.tour, 'Quart de finale');
  assert.deepEqual(an.fr.listes.roster.map(r => r.pseudo).sort(), ['Kai', 'Léa']);
  // Roster de la team (joueurs d'abord), membre (recrue), programme de la semaine.
  const eq = (await ok(`/cm/visuels/donnees?portee=club&genre=equipe&teamId=${A.teamId}`, s.cm123456)).donnees;
  assert.deepEqual(eq.fr.listes.roster.slice(0, 2).map(r => r.role), ['Joueur', 'Joueur']);
  assert.equal(eq.en.listes.roster[0].role, 'Player');
  const mb = (await ok(`/cm/visuels/donnees?portee=club&genre=membre&teamId=${A.teamId}&id=kai12345`, s.cm123456)).donnees;
  assert.deepEqual([mb.fr.champs.joueur, mb.fr.champs.poste], ['Kai', 'Joueur']);
  const sem = (await ok('/cm/visuels/donnees?portee=club&genre=semaine&date=2026-11-05', s.cm123456)).donnees;
  assert.equal(sem.fr.listes.programme.length, 1);
  assert.deepEqual([sem.fr.listes.programme[0].team, sem.fr.listes.programme[0].adversaire, sem.fr.listes.programme[0].heure], ['Team Alpha', 'Nova', '20:30']);
  assert.match(sem.fr.champs.semaine, /^Semaine du 02\/11 au 08\/11$/);
  const vide = (await ok('/cm/visuels/donnees?portee=club&genre=semaine&date=2026-12-15', s.cm123456)).donnees;
  assert.equal(vide.fr.listes.programme.length, 0);
  assert.equal(vide.en.champs.phrase, 'No match scheduled this week');
});

// ------------------------------------------------------------------ Charte, modèles, permissions

test('charte : lecture par la section, modification cm.gerer, logos importés seulement, version', async () => {
  const { b, A, s, api, ok } = await preparer();
  const c = await ok('/cm/charte', s.cm123456);
  assert.equal(c.version, 0);
  assert.equal(c.charte.polices.titre, 'Orbitron');
  assert.equal(c.gerer, true);
  // Le correspondant d'une team (Manager : cm.voir de la team) lit la charte sans la modifier.
  const lue = await ok('/cm/charte', s.man12345);
  assert.equal(lue.gerer, false);
  assert.equal((await api('/cm/charte', s.man12345, { methode: 'PUT', corps: { charte: { couleurs: { primaire: '#ff0000' } } } })).statut, 403);
  assert.equal((await api('/cm/charte', s.lea12345)).statut, 403, 'un joueur ne voit pas la section');
  const maj = await ok('/cm/charte', s.cm123456, { methode: 'PUT', corps: { version: 0, charte: { couleurs: { primaire: '#ff0000' }, club: 'Les Faucons' } } });
  assert.equal(maj.version, 1);
  assert.equal(maj.charte.couleurs.primaire, '#ff0000');
  assert.equal((await api('/cm/charte', s.cm123456, { methode: 'PUT', corps: { version: 0, charte: {} } })).corps.code, 'conflit');
  assert.equal((await api('/cm/charte', s.cm123456, { methode: 'PUT', corps: { charte: { couleurs: { primaire: 'red' } } } })).corps.code, 'document-invalide');
  // Logo : une image importée (pas une adresse, pas un fichier quelconque).
  assert.equal((await api('/cm/charte', s.cm123456, { methode: 'PUT', corps: { charte: { logos: { club: '00000000-0000-4000-8000-000000000000' } } } })).corps.code, 'logo');
  const envoi = await envoyerCm(b, ok, s.cm123456, 'club', pngFactice(512, 512), 'logo.png');
  const img = await ok('/cm/visuels/images', s.cm123456, { methode: 'POST', corps: { portee: 'club', envoi } });
  assert.deepEqual([img.largeur, img.hauteur], [512, 512]);
  const avecLogo = await ok('/cm/charte', s.cm123456, { methode: 'PUT', corps: { charte: { logos: { club: img.fichierId, teams: { [A.teamId]: img.fichierId } } } } });
  assert.equal(avecLogo.charte.logos.teams[A.teamId], img.fichierId);
  // Le logo du club se lit par lien signé, y compris par le correspondant de la team.
  const lien = await ok(`/cm/visuels/fichiers/${img.fichierId}/lien`, s.man12345, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lien.url)).status, 200);
  assert.equal((await api(`/cm/visuels/fichiers/${img.fichierId}/lien`, s.lea12345, { methode: 'POST', corps: {} })).statut, 403);
  // Données : le logo de la team vient de la charte.
  const d = (await ok(`/cm/visuels/donnees?portee=club&genre=equipe&teamId=${A.teamId}`, s.cm123456)).donnees;
  assert.deepEqual(d.images.logo_team, { fichier: img.fichierId });
  assert.equal(d.fr.champs.club, 'Les Faucons');
  // Réinitialiser : thème par défaut, logos et nom gardés.
  const re = await ok('/cm/charte', s.cm123456, { methode: 'PUT', corps: { reinitialiser: true } });
  assert.equal(re.charte.couleurs.primaire, '#00f0ff');
  assert.equal(re.charte.logos.club, img.fichierId);
  assert.equal(re.charte.club, 'Les Faucons');
  // Une image qui n'est pas une image (ou trop grande) est refusée.
  const pdf = new Uint8Array(200);
  pdf.set(Buffer.from('%PDF-1.4'));
  const envPdf = await envoyerCm(b, ok, s.cm123456, 'club', pdf, 'doc.pdf');
  assert.equal((await api('/cm/visuels/images', s.cm123456, { methode: 'POST', corps: { portee: 'club', envoi: envPdf } })).corps.code, 'format-image');
  const geant = await envoyerCm(b, ok, s.cm123456, 'club', pngFactice(9000, 4), 'geant.png');
  assert.equal((await api('/cm/visuels/images', s.cm123456, { methode: 'POST', corps: { portee: 'club', envoi: geant } })).corps.code, 'image-dimensions');
  // Journal : changement de charte.
  assert.ok((await ok('/cm/journal', s.cm123456)).entrees.some(e => e.action === 'cm.charte_modifiee'));
});

test('modèles : création validée, versions et restauration, duplication, conflit, permissions par portée', async () => {
  const { A, B, s, api, ok } = await preparer();
  const documents = { carre: docCarre(), story: { ...docCarre(), format: 'story' } };
  const cree = (await ok('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Annonce néon', type: 'annonce', base: 'defaut:annonce', documents } })).modele;
  assert.deepEqual([cree.version, cree.formats.sort(), cree.base], [1, ['carre', 'story'], 'defaut:annonce']);
  assert.equal(cree.documents.carre.calques[0].texte.fr, '{team} vs {adversaire}');
  // Entrées invalides.
  assert.equal((await api('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'X', type: 'inconnu', documents } })).corps.code, 'type');
  const hostile = await api('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'X', type: 'libre', documents: { carre: docCarre([{ id: 'i', type: 'image', source: { url: 'https://site-exemple.fr/x.png' } }]) } } });
  assert.equal(hostile.corps.code, 'document-invalide');
  assert.equal(hostile.corps.details.chemin, 'documents.carre.calques.0.source');
  assert.equal((await api('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'X', type: 'libre', documents: { carre: docCarre([{ id: 'i', type: 'image', source: { fichier: '00000000-0000-4000-8000-000000000000' } }]) } } })).corps.code, 'image-inconnue');
  // Versions.
  const v2 = (await ok(`/cm/modeles/${cree.id}`, s.cm123456, { methode: 'PATCH', corps: { version: 1, nom: 'Annonce néon v2', documents: { carre: docCarre([calqueTexte('t1', 'MATCH')]) } } })).modele;
  assert.deepEqual([v2.version, v2.formats], [2, ['carre']]);
  assert.equal((await api(`/cm/modeles/${cree.id}`, s.cm123456, { methode: 'PATCH', corps: { version: 1, nom: 'Concurrent' } })).corps.code, 'conflit');
  const versions = await ok(`/cm/modeles/${cree.id}/versions`, s.cm123456);
  assert.deepEqual(versions.versions.map(v => v.version), [1]);
  assert.equal((await ok(`/cm/modeles/${cree.id}/versions/1`, s.cm123456)).nom, 'Annonce néon');
  const restaure = (await ok(`/cm/modeles/${cree.id}/versions/1/restaurer`, s.cm123456, { methode: 'POST', corps: { version: 2 } })).modele;
  assert.deepEqual([restaure.version, restaure.nom, restaure.formats.sort()], [3, 'Annonce néon', ['carre', 'story']]);
  // Duplication dans la portée d'une team.
  const copie = (await ok(`/cm/modeles/${cree.id}/dupliquer`, s.cm123456, { methode: 'POST', corps: { portee: A.teamId } })).modele;
  assert.deepEqual([copie.portee, copie.version, copie.nom, copie.base], [A.teamId, 1, 'Annonce néon (2)', cree.id]);
  // Visibilité : le Manager de A (cm.voir de A) voit le modèle du club et celui de A ; celui de B non.
  await ok(`/cm/modeles/${cree.id}/dupliquer`, s.cm123456, { methode: 'POST', corps: { portee: B.teamId, nom: 'Bravo' } });
  const vus = (await ok('/cm/modeles', s.man12345)).modeles.map(m => m.nom).sort();
  assert.deepEqual(vus, ['Annonce néon', 'Annonce néon (2)']);
  // Sans cm.editer : pas de création ni de modification.
  assert.equal((await api('/cm/modeles', s.man12345, { methode: 'POST', corps: { portee: A.teamId, nom: 'X', type: 'libre', documents } })).statut, 403);
  assert.equal((await api(`/cm/modeles/${copie.id}`, s.man12345, { methode: 'PATCH', corps: { version: 1, nom: 'X' } })).statut, 403);
  assert.equal((await api(`/cm/modeles/${copie.id}`, s.nox12345)).statut, 404, 'un joueur de B ne voit pas la partie CM de A');
  await ok(`/cm/modeles/${copie.id}`, s.cm123456, { methode: 'DELETE' });
  assert.equal((await api(`/cm/modeles/${copie.id}`, s.cm123456)).statut, 404);
});

// ------------------------------------------------------------------ Visuels, rendu, carte post

test('visuels : depuis une suggestion (résultat), rendu à la taille exacte joint à la carte, invalidation, données changées, régénération', async () => {
  const { b, A, s, api, ok, nova } = await preparer();
  const r = (await ok(`/teams/${A.teamId}/resultats`, s.coach123, { methode: 'POST', corps: bo3(nova) })).resultat;
  // La suggestion automatique « Résultat » propose le visuel « résultat » avec sa source.
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus');
  const carte = (await ok(`/cm/tableaux/${club.id}`, s.cm123456)).cartes.find(c => c.origine === 'suggestion' && c.titre.startsWith('Résultat'));
  const prop = await ok(`/cm/cartes/${carte.id}/visuels`, s.cm123456);
  assert.deepEqual(prop.proposition, { type: 'resultat', source: { genre: 'resultat', teamId: A.teamId, id: r.id } });
  assert.equal(prop.suggestion, 'resultat');
  assert.deepEqual(prop.visuels, []);
  // Création depuis la carte.
  let v = (await ok('/cm/visuels', s.cm123456, { methode: 'POST', corps: { carteId: carte.id, modele: 'defaut:resultat', format: 'portrait', langue: 'fr', source: prop.proposition.source } })).visuel;
  assert.deepEqual([v.portee, v.carteId, v.type, v.format, v.retouche, v.fichierId], ['club', carte.id, 'resultat', 'portrait', false, null]);
  assert.equal(v.donnees.fr.champs.score, '2-1');
  assert.equal(v.perime, null, 'pas encore rendu');
  assert.equal((await api('/cm/visuels', s.cm123456, { methode: 'POST', corps: { carteId: carte.id, modele: 'defaut:inconnu', format: 'portrait', langue: 'fr', source: prop.proposition.source } })).corps.code, 'modele');
  assert.equal((await api('/cm/visuels', s.cm123456, { methode: 'POST', corps: { carteId: carte.id, modele: 'defaut:resultat', format: 'a4', langue: 'fr', source: prop.proposition.source } })).corps.code, 'format');
  // Rendu à la mauvaise taille : refusé ; empreinte périmée : 409.
  const mauvais = await envoyerCm(b, ok, s.cm123456, 'club', pngFactice(1080, 1080));
  const refus = await api(`/cm/visuels/${v.id}/rendu`, s.cm123456, { methode: 'POST', corps: { envoi: mauvais, empreinte: v.donnees.empreinte } });
  assert.equal(refus.corps.code, 'rendu-dimensions');
  assert.deepEqual(refus.corps.details.attendu, { largeur: 1080, hauteur: 1350, ratio: '4:5' });
  const bon = await envoyerCm(b, ok, s.cm123456, 'club', pngFactice(1080, 1350));
  assert.equal((await api(`/cm/visuels/${v.id}/rendu`, s.cm123456, { methode: 'POST', corps: { envoi: bon, empreinte: 'x'.repeat(64) } })).corps.code, 'donnees-changees');
  v = (await ok(`/cm/visuels/${v.id}/rendu`, s.cm123456, { methode: 'POST', corps: { envoi: bon, empreinte: v.donnees.empreinte } })).visuel;
  assert.ok(v.fichierId && v.pieceId);
  assert.deepEqual(v.perime, { donnees: false, charte: false, modele: false });
  let fiche = await ok(`/cm/cartes/${carte.id}`, s.cm123456);
  assert.equal(fiche.carte.pieces.length, 1);
  assert.equal(fiche.carte.pieces[0].nom, 'match-officiel-portrait-fr.png');
  assert.equal(fiche.carte.pieces[0].fichier.type, 'image/png');
  assert.ok(fiche.carte.activite.some(a => a.action === 'visuel_joint'));
  const lien = await ok(`/cm/visuels/${v.id}/lien`, s.cm123456, { methode: 'POST', corps: { telecharger: true } });
  assert.equal((await b.brut(lien.url)).status, 200);
  // Post soumis puis validé : régénérer le visuel change la pièce jointe → le post repasse « à valider ».
  await ok(`/cm/cartes/${carte.id}/soumettre`, s.cm123456, { methode: 'POST', corps: {} });
  fiche = await ok(`/cm/cartes/${carte.id}`, s.cm123456);
  await ok(`/cm/cartes/${carte.id}/valider`, s.fondateur, { methode: 'POST', corps: { version: fiche.carte.version } });
  // Les données changent (score corrigé) : le visuel est signalé périmé.
  await ok(`/teams/${A.teamId}/resultats/${r.id}`, s.coach123, { methode: 'PATCH', corps: { manches: [{ carteCle: 'ascent', nous: 13, eux: 9 }, { carteCle: 'bind', nous: 13, eux: 7 }] } });
  v = (await ok(`/cm/visuels/${v.id}`, s.cm123456)).visuel;
  assert.equal(v.perime.donnees, true);
  assert.equal(v.donnees.fr.champs.score, '2-0');
  const bon2 = await envoyerCm(b, ok, s.cm123456, 'club', pngFactice(1080, 1350));
  v = (await ok(`/cm/visuels/${v.id}/rendu`, s.cm123456, { methode: 'POST', corps: { envoi: bon2, empreinte: v.donnees.empreinte } })).visuel;
  fiche = await ok(`/cm/cartes/${carte.id}`, s.cm123456);
  assert.equal(fiche.carte.pieces.length, 1, 'le nouveau rendu remplace l’ancien');
  assert.equal(fiche.carte.pieces[0].id, v.pieceId);
  assert.equal(fiche.carte.statut, 'a_valider', 'un post validé repasse à valider');
  assert.equal(v.perime.donnees, false);
  // Charte modifiée depuis le rendu : signalée.
  await ok('/cm/charte', s.cm123456, { methode: 'PUT', corps: { charte: { effets: { grain: 0 } } } });
  assert.equal((await ok(`/cm/visuels/${v.id}`, s.cm123456)).visuel.perime.charte, true);
  // Retouche : document propre au visuel (validé) ; revenir au modèle (null).
  const doc = { ...docCarre([calqueTexte('t1', { fr: 'RETOUCHÉ {score}', en: 'EDITED {score}' })]), format: 'portrait' };
  v = (await ok(`/cm/visuels/${v.id}`, s.cm123456, { methode: 'PATCH', corps: { version: v.version, document: doc } })).visuel;
  assert.equal(v.retouche, true);
  assert.equal(v.document.calques[0].texte.fr, 'RETOUCHÉ {score}');
  assert.equal((await api(`/cm/visuels/${v.id}`, s.cm123456, { methode: 'PATCH', corps: { version: v.version, document: { ...doc, format: 'carre' } } })).corps.code, 'document-invalide');
  assert.equal((await api(`/cm/visuels/${v.id}`, s.cm123456, { methode: 'PATCH', corps: { version: 1, nom: 'x' } })).corps.code, 'conflit');
  v = (await ok(`/cm/visuels/${v.id}`, s.cm123456, { methode: 'PATCH', corps: { version: v.version, document: null } })).visuel;
  assert.equal(v.retouche, false);
  // Le joueur ne voit rien ; le Manager de A (cm.voir de A) ne voit pas un visuel du club.
  assert.equal((await api(`/cm/visuels/${v.id}`, s.lea12345)).statut, 404);
  assert.equal((await api(`/cm/visuels/${v.id}`, s.man12345)).statut, 404);
  // Journal.
  assert.ok((await ok('/cm/journal', s.cm123456)).entrees.some(e => e.action === 'cm.visuel_genere'));
  // Supprimer le visuel garde la pièce jointe de la carte (et ses octets).
  await ok(`/cm/visuels/${v.id}`, s.cm123456, { methode: 'DELETE' });
  fiche = await ok(`/cm/cartes/${carte.id}`, s.cm123456);
  assert.equal(fiche.carte.pieces.length, 1);
  const lienPiece = await ok(`/cm/pieces/${fiche.carte.pieces[0].id}/lien`, s.cm123456, { methode: 'POST', corps: {} });
  assert.equal((await b.brut(lienPiece.url)).status, 200);
});

test('visuels : portée d’une team, source d’une autre team refusée, lien à une carte, RGPD, export / import', async () => {
  const { b, A, B, s, api, ok } = await preparer();
  // Le CM du club crée un visuel « recrue » dans la portée de la team A.
  let v = (await ok('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, modele: 'defaut:recrue', format: 'carre', langue: 'en', source: { genre: 'membre', id: 'kai12345' } } })).visuel;
  assert.deepEqual([v.portee, v.source.teamId, v.donnees.en.champs.joueur, v.donnees.en.champs.poste], [A.teamId, A.teamId, 'Kai', 'Player']);
  assert.equal((await api('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, modele: 'defaut:recrue', format: 'carre', langue: 'en', source: { genre: 'membre', teamId: B.teamId, id: 'nox12345' } } })).corps.code, 'source');
  assert.equal((await api('/cm/visuels', s.cm123456, { methode: 'POST', corps: { portee: A.teamId, modele: 'defaut:recrue', format: 'carre', langue: 'de', source: { genre: 'membre', id: 'kai12345' } } })).corps.code, 'langue');
  // Le Manager de A voit la partie CM de A : il lit le visuel, sans le modifier.
  assert.equal((await ok(`/cm/visuels/${v.id}`, s.man12345)).visuel.id, v.id);
  assert.equal((await api(`/cm/visuels/${v.id}`, s.man12345, { methode: 'PATCH', corps: { version: v.version, nom: 'x' } })).statut, 403);
  // Lier à une carte de la même portée après le rendu : la pièce est jointe.
  const envoi = await envoyerCm(b, ok, s.cm123456, A.teamId, pngFactice(1080, 1080));
  v = (await ok(`/cm/visuels/${v.id}/rendu`, s.cm123456, { methode: 'POST', corps: { envoi, empreinte: v.donnees.empreinte } })).visuel;
  await ok(`/cm/teams/${A.teamId}`, s.cm123456);
  const tb = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.team?.id === A.teamId);
  const detail = await ok(`/cm/tableaux/${tb.id}`, s.cm123456);
  const carte = (await ok(`/cm/tableaux/${tb.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: detail.listes[0].id, titre: 'Bienvenue Kai', post: true } })).carte;
  v = (await ok(`/cm/visuels/${v.id}/carte`, s.cm123456, { methode: 'POST', corps: { carteId: carte.id } })).visuel;
  assert.equal(v.carteId, carte.id);
  assert.equal((await ok(`/cm/cartes/${carte.id}`, s.cm123456)).carte.pieces.length, 1);
  const club = (await ok('/cm/tableaux', s.cm123456)).tableaux.find(t => t.cleDefaut === 'contenus' && !t.team);
  const carteClub = (await ok(`/cm/tableaux/${club.id}/cartes`, s.cm123456, { methode: 'POST', corps: { listeId: (await ok(`/cm/tableaux/${club.id}`, s.cm123456)).listes[0].id, titre: 'Ailleurs' } })).carte;
  assert.equal((await api(`/cm/visuels/${v.id}/carte`, s.cm123456, { methode: 'POST', corps: { carteId: carteClub.id } })).corps.code, 'portee');
  // Modèle personnalisé + RGPD : l'export du compte liste ses modèles et visuels.
  await ok('/cm/modeles', s.cm123456, { methode: 'POST', corps: { portee: 'club', nom: 'Mon modèle', type: 'libre', documents: { carre: docCarre() } } });
  const exp = await ok('/moi/export', s.cm123456);
  assert.equal(exp.cmModeles[0].nom, 'Mon modèle');
  assert.equal(exp.cmVisuels[0].type, 'recrue');
  // Export / import de la base : les tables des visuels suivent.
  const sauvegarde = await exporterBase(b.base);
  assert.equal(sauvegarde.tables.cm_visuels.length, 1);
  const { baseMigree } = await import('./base.mjs');
  const neuve = await baseMigree();
  const bilan = await importerBase(neuve, JSON.parse(JSON.stringify(sauvegarde)));
  assert.equal(bilan.cm_visuels, 1);
  assert.equal(bilan.cm_modeles, 1);
  // Suppression des comptes : le membre disparaît de la source (le rendu reste), l'auteur des modèles et visuels aussi.
  await ok('/moi', s.cm123456, { methode: 'DELETE' });
  await ok('/moi', A.sessions.kai12345, { methode: 'DELETE' });
  const ligne = await b.base.premier('SELECT source, cree_par, fichier_id FROM cm_visuels WHERE id = ?', [v.id]);
  assert.equal(ligne.cree_par, null);
  assert.equal(JSON.parse(ligne.source).genre, 'libre');
  assert.ok(ligne.fichier_id);
  assert.equal((await b.base.premier("SELECT cree_par FROM cm_modeles WHERE nom = 'Mon modèle'", [])).cree_par, null);
});
