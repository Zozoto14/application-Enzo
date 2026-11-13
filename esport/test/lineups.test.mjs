/**
 * Module Lineups (migration 0082, docs/esport/lineups.md) : filtres et tri (purs), création et correction, droits
 * (voir, proposer, gérer), flux proposé → validé avec ses notifications et leur lien direct, médias (4 images, une
 * vidéo, types vérifiés par les octets, tailles bornées, liens signés), favoris par compte, liens avec les strats
 * (lecture pour l'éditeur), corbeille de 30 jours et purge, temps réel, confidentialité (IA externe refusée, rien sur
 * Discord), RGPD et export de la base, migration des teams existantes.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';
import { ASCENT } from './strats-aide.mjs';
import { envoyer, mkvFactice, mp4Factice } from './medias-aide.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { EVENEMENTS_DISCORD } from '../noyau/discord/catalogue.mjs';
import { tacheConfidentielle } from '../noyau/ia/confidentialite.mjs';
import { CHAMPS_ECRITURE } from '../noyau/ia/ecriture.mjs';
import { TYPES_LINEUPS } from '../noyau/lineups/bus.mjs';
import { DUREE_CORBEILLE_LINEUPS_MS, IMAGES_MAX, TAILLE_MAX_IMAGE_LINEUP, TAILLE_MAX_VIDEO_LINEUP, filtrerLineups, purgerCorbeilleLineups, trierLineups } from '../noyau/lineups/service.mjs';
import { cibleEvenement } from '../noyau/notifications/cibles.mjs';
import { objetDe, publicationsDe, sujetsEvenement } from '../noyau/temps-reel/regles.mjs';
import { TABLES } from '../noyau/transfert.mjs';

const lineup = (champs = {}) => ({ titre: 'X', carte: { cle: 'ascent', nom: 'Ascent' }, personnage: null, capacite: null, side: '', zone: null, instructions: '', visee: '', timing: '', tags: [], statut: 'valide', favori: false, majLe: '2026-10-01', ...champs });

test('filtres combinés et tri (purs) : map, personnage, capacité, side, zone, tag, statut, favoris, recherche', () => {
  const liste = [
    lineup({ titre: 'Smoke Heaven', personnage: { cle: 'omen', nom: 'Omen' }, capacite: { cle: 'Ability2', nom: 'Dark Cover' }, side: 'attaque', zone: { cle: 'a-heaven', nom: 'A Heaven' }, tags: ['Exec A'], majLe: '2026-10-03' }),
    lineup({ titre: 'Molly défaut B', personnage: { cle: 'brimstone', nom: 'Brimstone' }, capacite: { cle: 'Ability1', nom: 'Incendiary' }, side: 'attaque', zone: { cle: null, nom: 'Défaut B' }, statut: 'propose', favori: true, instructions: 'Viser le coin de l’antenne', majLe: '2026-10-02' }),
    lineup({ titre: 'Recon mid', carte: { cle: 'bind', nom: 'Bind' }, personnage: { cle: 'sova', nom: 'Sova' }, side: 'defense', majLe: '2026-10-04' }),
  ];
  const titres = f => filtrerLineups(liste, f).map(l => l.titre);
  assert.deepEqual(titres({}).length, 3);
  assert.deepEqual(titres({ carte: 'ascent' }), ['Smoke Heaven', 'Molly défaut B']);
  assert.deepEqual(titres({ personnage: 'omen' }), ['Smoke Heaven']);
  assert.deepEqual(titres({ capacite: 'Ability1' }), ['Molly défaut B']);
  assert.deepEqual(titres({ side: 'defense' }), ['Recon mid']);
  assert.deepEqual(titres({ zone: 'a-heaven' }), ['Smoke Heaven'], 'callout par sa clé');
  assert.deepEqual(titres({ zone: 'defaut b' }), ['Molly défaut B'], 'zone libre, sans accents ni casse');
  assert.deepEqual(titres({ tag: 'exec a' }), ['Smoke Heaven']);
  assert.deepEqual(titres({ statut: 'propose' }), ['Molly défaut B']);
  assert.deepEqual(titres({ favoris: true }), ['Molly défaut B']);
  assert.deepEqual(titres({ q: 'ANTENNE' }), ['Molly défaut B'], 'consignes cherchées, casse ignorée');
  assert.deepEqual(titres({ q: 'sova', carte: 'ascent' }), []);
  assert.deepEqual(trierLineups(liste).map(l => l.titre), ['Molly défaut B', 'Recon mid', 'Smoke Heaven'], 'favoris, puis validés (récents d’abord)');
});

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  max12345: { pseudo: 'Max', role: 'manager' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};

const CORPS = {
  titre: 'Smoke Heaven depuis A main',
  carte: { cle: 'ascent', nom: 'Ascent' },
  personnage: { cle: 'omen', nom: 'Omen' },
  capacite: { cle: 'Ability2', nom: 'Dark Cover' },
  side: 'attaque',
  zone: { cle: 'a-heaven', nom: 'A Heaven' },
  posture: 'saut',
  visee: 'Coin haut gauche de la fenêtre',
  timing: 'À 1:25',
  instructions: 'Collé au mur, sauter puis lancer.',
  difficulte: 2,
  tags: ['Exec A', 'Smoke'],
  depart: { x: 412.4, y: 633 },
  arrivee: { x: 520, y: 380 },
};

async function preparer(options = {}) {
  const b = await banc(options.banc);
  const A = await teamAvecMembres(b, { membres: MEMBRES, ...options.team });
  const api = (chemin, jeton, o = {}) => b.appel(chemin, { jeton, methode: o.methode, corps: o.corps, entetes: o.entetes });
  const ok = async (chemin, jeton, o = {}) => {
    const r = await api(chemin, jeton, o);
    assert.equal(r.statut, 200, `${o.methode ?? 'GET'} ${chemin} : ${r.statut} ${JSON.stringify(r.corps)}`);
    return r.corps;
  };
  const tic = () => {
    b.horloge.t += 1000;
  };
  return { b, A, s: A.sessions, lu: `/teams/${A.teamId}/lineups`, api, ok, tic };
}

test('lineups par l’API : création, validation des champs, droits (voir, proposer, gérer), filtres, favoris', async () => {
  const { b, A, s, lu, api, ok, tic } = await preparer();
  // Un joueur PROPOSE (même s'il demande « validé ») ; les points sont arrondis dans le repère de 1000.
  const propose = await ok(lu, s.lea12345, { methode: 'POST', corps: { ...CORPS, statut: 'valide' } });
  assert.equal(propose.statut, 'propose');
  assert.deepEqual([propose.carte, propose.personnage, propose.capacite, propose.zone], [CORPS.carte, CORPS.personnage, CORPS.capacite, CORPS.zone]);
  assert.deepEqual([propose.depart, propose.arrivee], [{ x: 412, y: 633 }, { x: 520, y: 380 }]);
  assert.deepEqual([propose.posture, propose.difficulte, propose.side, propose.modele], ['saut', 2, 'attaque', 'valorant']);
  assert.deepEqual(propose.tags, ['Exec A', 'Smoke']);
  assert.equal(propose.creePar.pseudo, 'Léa');
  assert.deepEqual(propose.moi, { modifier: true, supprimer: true, valider: false, lier: false });
  tic();
  // Le staff qui gère crée directement un lineup validé ; zone en texte libre, sans personnage.
  const valide = await ok(lu, s.coach123, { methode: 'POST', corps: { titre: 'Molly défaut B', carte: { cle: 'ascent', nom: 'Ascent' }, zone: { nom: 'Défaut B' }, side: 'defense', videoUrl: 'https://videos.exemple.test/molly-b' } });
  assert.deepEqual([valide.statut, valide.validePar.pseudo, valide.personnage, valide.zone], ['valide', 'Coach Zed', null, { cle: null, nom: 'Défaut B' }]);
  assert.equal(valide.videoUrl, 'https://videos.exemple.test/molly-b');
  // Champs refusés.
  for (const [corps, code] of [
    [{ ...CORPS, titre: 'A' }, 'titre'],
    [{ ...CORPS, carte: null }, 'carte'],
    [{ ...CORPS, carte: { cle: 'Pas Une Clé', nom: 'x' } }, 'carte'],
    [{ ...CORPS, posture: 'couche' }, 'posture'],
    [{ ...CORPS, difficulte: 4 }, 'difficulte'],
    [{ ...CORPS, depart: { x: 1200, y: 10 } }, 'depart'],
    [{ ...CORPS, arrivee: { x: 'a', y: 10 } }, 'arrivee'],
    [{ ...CORPS, side: 'Attaque !' }, 'side'],
    [{ ...CORPS, videoUrl: 'http://videos.exemple.test/x' }, 'video-url'],
    [{ ...CORPS, videoUrl: 'javascript:alert(1)' }, 'video-url'],
    [{ ...CORPS, tags: ['<script>'] }, 'tag'],
  ]) {
    const r = await api(lu, s.coach123, { methode: 'POST', corps });
    assert.deepEqual([r.statut, r.corps.code], [400, code], JSON.stringify(corps).slice(0, 80));
  }
  // Droits : tout le monde lit (Remplaçant compris) ; le Remplaçant ne propose pas.
  for (const qui of Object.keys(MEMBRES)) {
    const liste = await ok(lu, s[qui]);
    assert.equal(liste.lineups.length, 2, qui);
    assert.deepEqual(liste.droits, { proposer: qui !== 'tom12345', gerer: ['coach123', 'max12345'].includes(qui), lier: ['coach123', 'max12345', 'ana12345'].includes(qui) }, qui);
  }
  assert.equal((await api(lu, s.tom12345, { methode: 'POST', corps: CORPS })).statut, 403);
  // Un autre joueur ne corrige pas la proposition de Léa ; Léa oui ; personne d'autre que le staff ne valide.
  assert.equal((await api(`${lu}/${propose.id}`, s.kai12345, { methode: 'PATCH', corps: { titre: 'Volé' } })).statut, 403);
  assert.equal((await ok(`${lu}/${propose.id}`, s.lea12345, { methode: 'PATCH', corps: { timing: 'À 1:20', arrivee: null } })).timing, 'À 1:20');
  assert.equal((await ok(`${lu}/${propose.id}`, s.lea12345)).arrivee, null);
  for (const qui of ['lea12345', 'ana12345', 'tom12345']) assert.equal((await api(`${lu}/${propose.id}`, s[qui], { methode: 'PATCH', corps: { statut: 'valide' } })).statut, 403, qui);
  // L'analyste (qui ne gère pas) ne corrige pas le lineup d'un autre ; le Manager, si.
  assert.equal((await api(`${lu}/${propose.id}`, s.ana12345, { methode: 'PATCH', corps: { titre: 'Analyste' } })).statut, 403);
  assert.equal((await ok(`${lu}/${propose.id}`, s.max12345, { methode: 'PATCH', corps: { difficulte: 3 } })).difficulte, 3);
  // Filtres de l'API et favoris par compte.
  const titres = async (q, qui = 'lea12345') => (await ok(`${lu}?${q}`, s[qui])).lineups.map(l => l.titre);
  assert.deepEqual(await titres('statut=propose'), [CORPS.titre]);
  assert.deepEqual(await titres('side=defense'), ['Molly défaut B']);
  assert.deepEqual(await titres('personnage=omen&capacite=Ability2&zone=a-heaven&tag=smoke'), [CORPS.titre]);
  assert.deepEqual(await titres('q=defaut'), ['Molly défaut B']);
  assert.equal((await api(`${lu}?statut=nimporte`, s.lea12345)).statut, 400);
  await ok(`${lu}/${propose.id}/favori`, s.kai12345, { methode: 'PUT' });
  await ok(`${lu}/${propose.id}/favori`, s.kai12345, { methode: 'PUT' });
  assert.deepEqual(await titres('favoris=1', 'kai12345'), [CORPS.titre]);
  assert.deepEqual(await titres('favoris=1', 'lea12345'), [], 'le favori est personnel');
  assert.equal((await ok(lu, s.kai12345)).lineups[0].id, propose.id, 'favoris en tête de grille');
  await ok(`${lu}/${propose.id}/favori`, s.kai12345, { methode: 'DELETE' });
  assert.deepEqual(await titres('favoris=1', 'kai12345'), []);
  // Autre team, module désactivé : 404 (rien n'est révélé).
  const B = await teamAvecMembres(b, { nom: 'Team Beta', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  assert.equal((await api(lu, B.sessions.bob12345)).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/lineups/${propose.id}`, B.sessions.bob12345)).statut, 404);
  await ok(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { lineups: false } } });
  assert.equal((await api(lu, s.coach123)).statut, 404);
  assert.equal((await api(lu, s.coach123, { methode: 'POST', corps: CORPS })).statut, 404);
});

test('proposé → validé : notifications (staff prévenu, puis l’auteur), lien direct, journal ; rien après validation pour l’auteur', async () => {
  const { b, A, s, lu, api, ok, tic } = await preparer();
  const l = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  tic();
  // Ceux qui gèrent (Coach, Manager, Propriétaire) sont prévenus ; pas l'auteure, ni les autres joueurs.
  const proposee = async qui => (await ok('/notifications/centre', s[qui])).liste.find(x => x.type === 'lineup-propose');
  for (const qui of ['coach123', 'max12345', 'fondateur']) {
    const n = await proposee(qui);
    assert.ok(n, qui);
    assert.deepEqual(n.cible, { v: 1, g: 'lineup', lineup: l.id, team: A.teamId });
  }
  for (const qui of ['lea12345', 'kai12345', 'ana12345']) assert.equal(await proposee(qui), undefined, qui);
  // Validation par le Coach : statut, auteur de la validation, notification de l'auteure avec son lien direct.
  const v = await ok(`${lu}/${l.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'valide' } });
  assert.deepEqual([v.statut, v.validePar.pseudo], ['valide', 'Coach Zed']);
  tic();
  const n = (await ok('/notifications/centre', s.lea12345)).liste.find(x => x.type === 'lineup-valide');
  assert.ok(n);
  assert.deepEqual(n.cible, { v: 1, g: 'lineup', lineup: l.id, team: A.teamId });
  assert.deepEqual(await ok('/notifications/cible', s.lea12345, { methode: 'POST', corps: { cible: n.cible } }), { etat: 'ok', cible: n.cible });
  // Une fois validé, l'auteure ne le corrige plus et ne le supprime plus ; le staff peut le repasser en « proposé ».
  assert.equal((await api(`${lu}/${l.id}`, s.lea12345, { methode: 'PATCH', corps: { titre: 'Retouche' } })).statut, 403);
  assert.equal((await api(`${lu}/${l.id}`, s.lea12345, { methode: 'DELETE' })).statut, 403);
  const retour = await ok(`${lu}/${l.id}`, s.max12345, { methode: 'PATCH', corps: { statut: 'propose' } });
  assert.deepEqual([retour.statut, retour.validePar], ['propose', null]);
  // Journal de la team : création, validation, modification.
  const actions = (await ok(`/teams/${A.teamId}/journal?module=lineups`, s.fondateur)).entrees.map(e => e.action);
  assert.deepEqual([...actions].reverse(), ['lineup.created', 'lineup.validated', 'lineup.updated']);
  // Lien direct : hors de la team → « plus accès » ; supprimé → « n'existe plus ».
  const etrangere = await b.session('zoe12345', 'Zoé');
  assert.deepEqual(await ok('/notifications/cible', etrangere, { methode: 'POST', corps: { cible: n.cible } }), { etat: 'interdit' });
  await ok(`${lu}/${l.id}`, s.coach123, { methode: 'DELETE' });
  assert.deepEqual(await ok('/notifications/cible', s.lea12345, { methode: 'POST', corps: { cible: n.cible } }), { etat: 'supprime' });
});

/** Petits fichiers reconnus par leurs octets. */
function png(taille = 600) {
  const o = new Uint8Array(taille);
  o.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < taille; i++) o[i] = (i * 13) & 0xff;
  return o;
}
function jpeg(taille = 600) {
  const o = new Uint8Array(taille);
  o.set([0xff, 0xd8, 0xff, 0xe0]);
  return o;
}
const pdf = () => new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

test('médias : 4 images et une vidéo, types vérifiés par les octets, tailles bornées, liens signés, retrait', async () => {
  const { b, A, s, lu, api, ok } = await preparer();
  const l = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  const deposer = async (qui, octets, nom) => {
    const e = await envoyer(b, s[qui], A.teamId, octets, { section: 'lineups', nom });
    return e;
  };
  const attacher = (qui, envoi, role, id = l.id) => api(`${lu}/${id}/medias`, s[qui], { methode: 'POST', corps: { envoi, role } });
  // Une image envoyée par l'auteure, rangée « position » ; le lien signé rend les octets.
  const image = png();
  const e1 = await deposer('lea12345', image, 'position.png');
  assert.equal(e1.fin.statut, 200, JSON.stringify(e1.fin?.corps ?? e1.debut.corps));
  let r = await attacher('lea12345', e1.id, 'position');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.medias.length, 1);
  const m1 = r.corps.medias[0];
  assert.deepEqual([m1.role, m1.genre, m1.type, m1.taille, m1.nom], ['position', 'image', 'image/png', image.length, 'position.png']);
  assert.ok(m1.lien.url.includes('/fichiers/'), m1.lien.url);
  const lu1 = await b.brut(m1.lien.url);
  assert.equal(lu1.status, 200);
  assert.deepEqual(new Uint8Array(await lu1.arrayBuffer()), image);
  // Un envoi ne se rattache qu'une fois ; celui d'un autre est introuvable.
  assert.equal((await attacher('lea12345', e1.id, 'visee')).statut, 409);
  const eKai = await deposer('kai12345', jpeg(), 'kai.jpg');
  assert.equal((await attacher('lea12345', eKai.id, 'visee')).statut, 404);
  // Kai ne touche pas au lineup de Léa (403) ; le Coach, si.
  assert.equal((await attacher('kai12345', eKai.id, 'visee')).statut, 403);
  // Types refusés dès le premier morceau : PDF, MKV, fichier quelconque.
  for (const [octets, nom] of [[pdf(), 'doc.pdf'], [mkvFactice(), 'clip.mkv'], [new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'page.html']]) {
    const e = await deposer('lea12345', octets, nom);
    assert.deepEqual([e.morceaux[0].statut, e.morceaux[0].corps.code], [415, 'format-fichier'], nom);
  }
  // Une image n'est pas une vidéo, une vidéo n'est pas une image (l'envoi refusé est effacé).
  const e2 = await deposer('lea12345', jpeg(), 'visee.jpg');
  r = await attacher('lea12345', e2.id, 'video');
  assert.deepEqual([r.statut, r.corps.code], [415, 'format-video']);
  assert.equal((await api(`${lu}/envois/${e2.id}`, s.lea12345)).statut, 404, 'envoi refusé effacé');
  const video = mp4Factice({ taille: 40_000 });
  const ev = await deposer('lea12345', video, 'lineup.mp4');
  r = await attacher('lea12345', ev.id, 'resultat');
  assert.deepEqual([r.statut, r.corps.code], [415, 'format-image']);
  // Rôle inconnu.
  const e3 = await deposer('lea12345', jpeg(), 'visee.jpg');
  assert.equal((await attacher('lea12345', e3.id, 'selfie')).statut, 400);
  // Jusqu'à 4 images (visée, résultat, autre), pas une de plus.
  assert.equal((await attacher('lea12345', e3.id, 'visee')).statut, 200);
  for (const role of ['resultat', 'autre']) {
    const e = await deposer('coach123', png(), `${role}.png`);
    assert.equal((await attacher('coach123', e.id, role)).statut, 200, role);
  }
  const trop = await deposer('lea12345', png(), 'cinq.png');
  r = await attacher('lea12345', trop.id, 'autre');
  assert.deepEqual([r.statut, r.corps.code], [409, 'trop-d-images']);
  assert.equal(IMAGES_MAX, 4);
  // Une vidéo, pas deux.
  const v1 = await deposer('lea12345', video, 'lineup.mp4');
  r = await attacher('lea12345', v1.id, 'video');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const mv = r.corps.medias.find(m => m.role === 'video');
  assert.deepEqual([mv.genre, mv.type], ['video', 'video/mp4']);
  const v2 = await deposer('lea12345', mp4Factice({ taille: 30_000 }), 'encore.mp4');
  r = await attacher('lea12345', v2.id, 'video');
  assert.deepEqual([r.statut, r.corps.code], [409, 'video-deja-la']);
  // Lecture par plage de la vidéo (lecteur du navigateur).
  const plage = await b.traiter(new Request(mv.lien.url, { headers: { Range: 'bytes=0-99' } }));
  assert.equal(plage.status, 206);
  // Tailles : une vidéo de plus de 200 Mo est refusée avant tout envoi ; une image de plus de 12 Mo au rattachement.
  const gros = await api(`${lu}/envois`, s.lea12345, { methode: 'POST', corps: { nom: 'long.mp4', taille: TAILLE_MAX_VIDEO_LINEUP + 1, type: 'video/mp4' } });
  assert.deepEqual([gros.statut, gros.corps.code], [413, 'fichier-trop-gros']);
  const autre = await ok(lu, s.lea12345, { methode: 'POST', corps: { ...CORPS, titre: 'Autre lineup' } });
  const lourde = await deposer('lea12345', png(TAILLE_MAX_IMAGE_LINEUP + 1024), 'lourde.png');
  assert.equal(lourde.fin.statut, 200);
  r = await attacher('lea12345', lourde.id, 'position', autre.id);
  assert.deepEqual([r.statut, r.corps.code], [413, 'fichier-trop-gros']);
  // Le rôle d'une image se change ; celui de la vidéo non.
  const fiche = await ok(`${lu}/${l.id}`, s.kai12345);
  assert.deepEqual(fiche.medias.map(m => m.role), ['position', 'visee', 'resultat', 'autre', 'video']);
  assert.equal((await ok(`${lu}/${l.id}/medias/${m1.id}`, s.lea12345, { methode: 'PATCH', corps: { role: 'autre' } })).medias[0].role, 'autre');
  assert.equal((await api(`${lu}/${l.id}/medias/${mv.id}`, s.lea12345, { methode: 'PATCH', corps: { role: 'visee' } })).statut, 400);
  // Le Remplaçant (lecture seule) ne dépose rien.
  assert.equal((await api(`${lu}/envois`, s.tom12345, { methode: 'POST', corps: { nom: 'x.png', taille: 100 } })).statut, 403);
  // Retrait : le média disparaît de la fiche, ses octets du stockage (le lien ne rend plus rien).
  const apres = await ok(`${lu}/${l.id}/medias/${m1.id}`, s.lea12345, { methode: 'DELETE' });
  assert.equal(apres.medias.length, 4);
  assert.equal((await b.brut(m1.lien.url)).status, 404);
  // Un lien signé ne sert plus un membre retiré de la team.
  const lienKai = (await ok(`${lu}/${l.id}`, s.kai12345)).medias[0].lien.url;
  assert.equal((await b.brut(lienKai)).status, 200);
  await ok(`/teams/${A.teamId}/membres/${A.membres.kai12345.id}`, s.fondateur, { methode: 'DELETE' });
  assert.equal((await b.brut(lienKai)).status, 403);
});

test('liens avec les strats : lier (étape), lecture pour l’éditeur, strat privée cachée, délier', async () => {
  const { A, s, lu, api, ok } = await preparer();
  const strats = `/teams/${A.teamId}/strats`;
  const strat = await ok(strats, s.coach123, { methode: 'POST', corps: { titre: 'Exec A split', type: 'execute', carte: ASCENT, side: 'attaque' } });
  const privee = await ok(strats, s.coach123, { methode: 'POST', corps: { titre: 'Brouillon secret', carte: ASCENT, side: 'attaque', visibilite: 'privee' } });
  const l1 = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  const l2 = await ok(lu, s.coach123, { methode: 'POST', corps: { ...CORPS, titre: 'Flash A main' } });
  // Un joueur (ni lineups.gerer ni strats.update) ne lie pas ; le Coach et l'Analyste, si.
  assert.equal((await api(`${lu}/${l1.id}/strats/${strat.id}`, s.lea12345, { methode: 'PUT', corps: {} })).statut, 403);
  let r = await ok(`${lu}/${l1.id}/strats/${strat.id}`, s.coach123, { methode: 'PUT', corps: { etape: 2 } });
  assert.deepEqual(r.strats, [{ id: strat.id, titre: 'Exec A split', carte: 'Ascent', etape: 2, ouvrable: true }]);
  await ok(`${lu}/${l2.id}/strats/${strat.id}`, s.ana12345, { methode: 'PUT', corps: {} });
  // Lier deux fois ne fait que changer l'étape.
  r = await ok(`${lu}/${l1.id}/strats/${strat.id}`, s.coach123, { methode: 'PUT', corps: { etape: 1 } });
  assert.equal(r.strats[0].etape, 1);
  assert.equal((await api(`${lu}/${l1.id}/strats/${strat.id}`, s.coach123, { methode: 'PUT', corps: { etape: 0 } })).statut, 400);
  // Lecture pour l'éditeur de strats : lineups de la strat, triés par étape.
  const deStrat = await ok(`${strats}/${strat.id}/lineups`, s.lea12345);
  assert.deepEqual(deStrat.strat, { id: strat.id, titre: 'Exec A split' });
  assert.deepEqual(deStrat.lineups.map(l => [l.titre, l.etape]), [[CORPS.titre, 1], ['Flash A main', null]]);
  assert.deepEqual(deStrat.lineups[0].carte, CORPS.carte);
  assert.equal((await api(`${strats}/${strat.id}/lineups`, s.lea12345, { methode: 'POST', corps: {} })).statut, 404, 'lecture seule');
  // Strat privée : liée par son auteur ; les joueurs savent qu'il y a un lien, sans son titre ; sa lecture leur est fermée.
  await ok(`${lu}/${l1.id}/strats/${privee.id}`, s.coach123, { methode: 'PUT', corps: {} });
  const vueLea = (await ok(`${lu}/${l1.id}`, s.lea12345)).strats;
  assert.equal(vueLea.length, 2);
  assert.deepEqual(vueLea.find(x => !x.ouvrable), { id: null, titre: null, carte: null, etape: null, ouvrable: false });
  assert.equal((await api(`${strats}/${privee.id}/lineups`, s.lea12345)).statut, 404);
  assert.equal((await ok(`${strats}/${privee.id}/lineups`, s.coach123)).lineups.length, 1);
  // Le Remplaçant voit les lineups mais pas les strats : liens comptés, jamais nommés.
  assert.ok((await ok(`${lu}/${l1.id}`, s.tom12345)).strats.every(x => !x.ouvrable));
  assert.equal((await api(`${strats}/${strat.id}/lineups`, s.tom12345)).statut, 404);
  // Délier ; une strat à la corbeille n'apparaît plus.
  r = await ok(`${lu}/${l1.id}/strats/${strat.id}`, s.coach123, { methode: 'DELETE' });
  assert.deepEqual(r.strats.map(x => x.titre), ['Brouillon secret']);
  await ok(`${strats}/${strat.id}`, s.coach123, { methode: 'DELETE' });
  assert.deepEqual((await ok(`${lu}/${l2.id}`, s.coach123)).strats, []);
  assert.equal((await api(`${lu}/${l2.id}/strats/${strat.id}`, s.coach123, { methode: 'PUT', corps: {} })).statut, 404);
  // Journal : liaisons et retrait.
  const actions = (await ok(`/teams/${A.teamId}/journal?module=lineups`, s.fondateur)).entrees.map(e => e.action);
  assert.equal(actions.filter(a => a === 'lineup.linked').length, 3);
  assert.equal(actions.filter(a => a === 'lineup.unlinked').length, 1);
});

test('corbeille de 30 jours : suppression douce, restauration, purge (lignes, favoris, liens, octets)', async () => {
  const { b, A, s, lu, api, ok } = await preparer();
  const l = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  const e = await envoyer(b, s.lea12345, A.teamId, png(), { section: 'lineups', nom: 'position.png' });
  await ok(`${lu}/${l.id}/medias`, s.lea12345, { methode: 'POST', corps: { envoi: e.id, role: 'position' } });
  await ok(`${lu}/${l.id}/favori`, s.kai12345, { methode: 'PUT' });
  const strat = await ok(`/teams/${A.teamId}/strats`, s.coach123, { methode: 'POST', corps: { titre: 'Exec A', carte: ASCENT, side: 'attaque' } });
  await ok(`${lu}/${l.id}/strats/${strat.id}`, s.coach123, { methode: 'PUT', corps: { etape: 3 } });
  // Un autre joueur ne supprime pas ; l'auteure d'une proposition, si.
  assert.equal((await api(`${lu}/${l.id}`, s.kai12345, { methode: 'DELETE' })).statut, 403);
  await ok(`${lu}/${l.id}`, s.lea12345, { methode: 'DELETE' });
  assert.equal((await api(`${lu}/${l.id}`, s.lea12345)).statut, 404);
  assert.equal((await ok(lu, s.coach123)).lineups.length, 0);
  assert.deepEqual((await ok(`/teams/${A.teamId}/strats/${strat.id}/lineups`, s.coach123)).lineups, []);
  // Corbeille : l'auteure et le staff la voient ; pas un autre joueur. Restauration : tout revient (média, lien, favori).
  assert.deepEqual((await ok(`${lu}/corbeille`, s.lea12345)).lineups.map(x => [x.titre, x.supprimePar.pseudo]), [[CORPS.titre, 'Léa']]);
  assert.equal((await ok(`${lu}/corbeille`, s.max12345)).lineups.length, 1);
  assert.equal((await ok(`${lu}/corbeille`, s.kai12345)).lineups.length, 0);
  assert.equal((await api(`${lu}/${l.id}/restaurer`, s.kai12345, { methode: 'POST' })).statut, 403);
  const revenu = await ok(`${lu}/${l.id}/restaurer`, s.coach123, { methode: 'POST' });
  assert.deepEqual([revenu.medias.length, revenu.strats.map(x => x.etape)], [1, [3]]);
  assert.equal((await ok(lu, s.kai12345)).lineups[0].favori, true);
  // Purge : rien avant 30 jours ; après, lignes, favoris, liens, fichier et octets disparaissent.
  await ok(`${lu}/${l.id}`, s.coach123, { methode: 'DELETE' });
  assert.equal(await purgerCorbeilleLineups(b.base, b.stockage, { maintenant: b.horloge.t + DUREE_CORBEILLE_LINEUPS_MS - 60_000 }), 0);
  const cle = (await b.base.premier("SELECT cle_stockage FROM fichiers WHERE entite_type = 'lineup_media' AND entite_id = ?", [l.id])).cle_stockage;
  assert.ok(await b.stockage.lire(cle));
  b.horloge.t += DUREE_CORBEILLE_LINEUPS_MS + 60_000;
  // (Trente jours plus tard, les sessions ont expiré : le Coach se reconnecte.)
  s.coach123 = await b.session('coach123');
  assert.equal((await ok(`${lu}/corbeille`, s.coach123)).lineups.length, 0, 'plus restaurable après 30 jours');
  assert.equal((await api(`${lu}/${l.id}/restaurer`, s.coach123, { methode: 'POST' })).statut, 404);
  assert.equal(await purgerCorbeilleLineups(b.base, b.stockage, { maintenant: b.horloge.t }), 1);
  for (const [table, colonne] of [['lineups', 'id'], ['lineup_medias', 'lineup_id'], ['lineup_favoris', 'lineup_id'], ['strat_lineups', 'lineup_id']]) {
    assert.equal(Number((await b.base.premier(`SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = ?`, [l.id])).n), 0, table);
  }
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM fichiers WHERE entite_type = 'lineup_media'", [])).n), 0);
  assert.equal(await b.stockage.lire(cle), null);
  // La strat, elle, est intacte.
  assert.equal((await ok(`/teams/${A.teamId}/strats/${strat.id}`, s.coach123)).titre, 'Exec A');
});

test('temps réel : sujet du module, objet sondé, favori personnel jamais diffusé', () => {
  const t = '11111111-2222-4333-8444-555555555555';
  const l = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  assert.deepEqual(objetDe(`/teams/${t}/lineups/${l}`), { sujet: `team:${t}:lineups`, cle: `lineup:${l}`, sonde: `/teams/${t}/lineups/${l}`, objetPublic: false, exact: true });
  assert.equal(objetDe(`/teams/${t}/lineups/corbeille`), null);
  assert.deepEqual(publicationsDe('POST', `/teams/${t}/lineups`, { compte: 'x' }), [{ sujet: `team:${t}:lineups`, action: 'cree' }]);
  assert.equal(publicationsDe('PATCH', `/teams/${t}/lineups/${l}`, { compte: 'x' })[0].bump, true);
  assert.equal(publicationsDe('PUT', `/teams/${t}/lineups/${l}/strats/${l}`, { compte: 'x' })[0].sujet, `team:${t}:lineups`);
  assert.deepEqual(publicationsDe('PUT', `/teams/${t}/lineups/${l}/favori`, { compte: 'x' }), []);
  assert.deepEqual(publicationsDe('PUT', `/teams/${t}/lineups/envois/${l}/morceaux/0`, { compte: 'x' }), []);
  assert.deepEqual(sujetsEvenement({ type: 'lineup.validated', team_id: t }), [{ sujet: `team:${t}:lineups`, invalider: false }]);
});

test('verrou optimiste : une fiche lue périmée est refusée (409), rien n’est écrasé', async () => {
  const { b, s, lu, api, ok } = await preparer();
  const l = await ok(lu, s.coach123, { methode: 'POST', corps: CORPS });
  const chemin = `${lu}/${l.id}`;
  const version = async qui => (await ok(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s[qui])).version;
  const v0 = await version('coach123');
  // Le Coach et le Manager ouvrent la même fiche ; le premier qui enregistre a la main.
  const r1 = await api(chemin, s.coach123, { methode: 'PATCH', corps: { timing: 'À 1:20' }, entetes: { 'X-Version-Lue': String(v0) } });
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  const r2 = await api(chemin, s.max12345, { methode: 'PATCH', corps: { timing: 'À 1:10' }, entetes: { 'X-Version-Lue': String(v0) } });
  assert.deepEqual([r2.statut, r2.corps.code], [409, 'conflit-version']);
  assert.equal((await ok(chemin, s.max12345)).timing, 'À 1:20', 'rien n’est écrasé');
  // Avec la version à jour, l'enregistrement passe.
  const r3 = await api(chemin, s.max12345, { methode: 'PATCH', corps: { timing: 'À 1:10' }, entetes: { 'X-Version-Lue': String(await version('max12345')) } });
  assert.equal(r3.statut, 200);
  // La version n'est donnée qu'à qui voit la fiche (le Remplaçant la voit ; un compte hors de la team, non).
  assert.equal((await api(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, s.tom12345)).statut, 200);
  assert.equal((await api(`/temps-reel/version?chemin=${encodeURIComponent(chemin)}`, await b.session('zoe12345', 'Zoé'))).statut, 404);
});

test('confidentialité : tâche IA confidentielle, assistant d’écriture refusé, aucun message Discord', async () => {
  // IA : tout nom de tâche qui évoque un lineup (ou un placement) est confidentiel : IA locale seulement.
  for (const t of ['lineups', 'lineup', 'placements', 'lineups.instructions', 'resume-lineup']) assert.equal(tacheConfidentielle(t), 'strats', t);
  for (const t of ['planning', 'planning.description', 'ecriture', 'traduction', 'profils']) assert.equal(tacheConfidentielle(t), null, t);
  assert.ok(!Object.keys(CHAMPS_ECRITURE).some(c => /lineup/i.test(c)), 'aucun champ de lineup permis à l’assistant d’écriture');
  // Discord : aucun type de message ne s'abonne aux événements des lineups.
  for (const d of EVENEMENTS_DISCORD) assert.ok(!d.types.some(t => t.startsWith('lineup.')), d.cle);
  const urls = [];
  const { b, A, s, lu, api, ok } = await preparer({ banc: { fetchDiscord: async u => (urls.push(String(u)), new Response(null, { status: 204 })) } });
  const w = await api(`/teams/${A.teamId}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd' } });
  assert.equal(w.statut, 200, JSON.stringify(w.corps));
  // Tous les messages Discord de la team activés : un lineup proposé, validé, lié, supprimé ne poste RIEN.
  for (const d of EVENEMENTS_DISCORD) await api(`/teams/${A.teamId}/discord/parametres/${d.cle}`, s.fondateur, { methode: 'PUT', corps: { actif: true } });
  urls.length = 0;
  await b.base.executer('DELETE FROM discord_file', []);
  const l = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  await ok(`${lu}/${l.id}`, s.coach123, { methode: 'PATCH', corps: { statut: 'valide', instructions: 'Secret tactique' } });
  await ok(`${lu}/${l.id}`, s.coach123, { methode: 'DELETE' });
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM discord_file', [])).n), 0);
  assert.deepEqual(urls, []);
  // Assistant d'écriture : un champ de lineup est refusé (403) avant tout appel à une IA.
  const r = await api('/ia/ecriture', s.fondateur, { methode: 'POST', corps: { mode: 'corriger', texte: 'Smoke heaven depuis A main', champ: 'lineups.instructions' } });
  assert.deepEqual([r.statut, r.corps.code], [403, 'ecriture-confidentielle'], JSON.stringify(r.corps));
});

test('RGPD et export de la base : export du compte, suppression (anonymisation), tables exportées', async () => {
  const { b, A, s, lu, api, ok } = await preparer();
  const l = await ok(lu, s.lea12345, { methode: 'POST', corps: CORPS });
  const e = await envoyer(b, s.lea12345, A.teamId, png(), { section: 'lineups', nom: 'position.png' });
  await ok(`${lu}/${l.id}/medias`, s.lea12345, { methode: 'POST', corps: { envoi: e.id, role: 'position' } });
  const deCoach = await ok(lu, s.coach123, { methode: 'POST', corps: { ...CORPS, titre: 'Du coach' } });
  await ok(`${lu}/${deCoach.id}/favori`, s.lea12345, { methode: 'PUT' });
  const exporte = await ok('/moi/export', s.lea12345);
  assert.deepEqual(exporte.lineups.map(x => [x.team, x.titre, x.carte, x.personnage, x.capacite, x.statut]), [['Team Alpha', CORPS.titre, 'Ascent', 'Omen', 'Dark Cover', 'propose']]);
  assert.deepEqual(exporte.lineupsFavoris.map(x => x.lineup), ['Du coach']);
  // Suppression du compte : ses lineups restent pour la team, sans auteur ; ses favoris disparaissent.
  assert.equal((await api('/moi', s.lea12345, { methode: 'DELETE' })).statut, 200);
  const reste = await ok(`${lu}/${l.id}`, s.coach123);
  assert.deepEqual(reste.creePar, { compte: null, pseudo: null });
  assert.equal(reste.medias.length, 1);
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM lineup_favoris WHERE compte_id = 'lea12345'", [])).n), 0);
  assert.equal((await b.base.premier("SELECT depose_par FROM fichiers WHERE entite_type = 'lineup_media'", [])).depose_par, '');
  assert.equal(Number((await b.base.premier("SELECT COUNT(*) AS n FROM lineup_medias WHERE cree_par = 'lea12345'", [])).n), 0);
  // Export / import de la base : les quatre tables y sont, après celles dont elles dépendent.
  const noms = TABLES.map(([t]) => t);
  for (const t of ['lineups', 'lineup_medias', 'lineup_favoris', 'strat_lineups']) assert.ok(noms.includes(t), t);
  assert.ok(noms.indexOf('lineups') > noms.indexOf('strats') && noms.indexOf('lineup_medias') > noms.indexOf('fichiers') && noms.indexOf('strat_lineups') > noms.indexOf('lineups'));
  const tables = (await ok('/admin/export', s.fondateur)).tables;
  assert.equal(tables.lineups.length, 2);
  assert.equal(tables.lineup_medias.length, 1);
});

test('événements et cibles : tous les types rangés, cible d’un événement', () => {
  assert.deepEqual(TYPES_LINEUPS, ['lineup.created', 'lineup.updated', 'lineup.validated', 'lineup.deleted', 'lineup.restored', 'lineup.linked', 'lineup.unlinked']);
  assert.deepEqual(cibleEvenement({ type: 'lineup.validated', team_id: 't1', entite_type: 'lineup', entite_id: 'l1', charge: '{}' }), { v: 1, g: 'lineup', lineup: 'l1', team: 't1' });
  assert.equal(cibleEvenement({ type: 'lineup.deleted', team_id: 't1', entite_type: 'lineup', entite_id: 'l1', charge: '{}' }), null);
});

test('migration 0082 : module activé pour les teams qui ont les strats, permissions des rôles système, usage « lineup » des envois', async () => {
  const base = await baseVierge();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0082'));
  const d = '2026-01-01T00:00:00.000Z';
  for (const [id, strats] of [['t-avec', 1], ['t-sans', 0]]) {
    await base.executer('INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, id, id, 'valorant', 'principal', d, d]);
    await base.executer("INSERT INTO team_modules (team_id, module, active, config, maj_le) VALUES (?, 'strat_editor', ?, '{}', ?)", [id, strats, d]);
  }
  for (const cle of ['manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't-avec', cle, cle, '#000000', d, d]);
  }
  await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES ('perso', 't-avec', NULL, 'Perso', '#000000', 0, 9, ?, ?)", [d, d]);
  // Un envoi en cours avant la migration est gardé tel quel.
  await base.executer(
    "INSERT INTO envois (id, team_id, portee, compte_id, usage, nom_original, taille, taille_morceau, morceaux, empreinte_etat, cle_stockage, cree_le, maj_le) VALUES ('e1', 't-avec', 't-avec', 'principal', 'review', 'match.mp4', 10, 10, 1, '{}', 'teams/t-avec/videos/x.media', ?, ?)",
    [d, d],
  );
  await appliquerMigrations(base, migrations);
  const actif = async id => Number((await base.premier("SELECT active FROM team_modules WHERE team_id = ? AND module = 'lineups'", [id]))?.active ?? 0);
  assert.deepEqual([await actif('t-avec'), await actif('t-sans')], [1, 0]);
  const a = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND permission LIKE 'lineups.%' ORDER BY permission", [role])).map(l => l.permission);
  assert.deepEqual(await a('manager'), ['lineups.gerer', 'lineups.proposer', 'lineups.voir']);
  assert.deepEqual(await a('coach'), ['lineups.gerer', 'lineups.proposer', 'lineups.voir']);
  assert.deepEqual(await a('analyste'), ['lineups.proposer', 'lineups.voir']);
  assert.deepEqual(await a('joueur'), ['lineups.proposer', 'lineups.voir']);
  assert.deepEqual(await a('remplacant'), ['lineups.voir']);
  assert.deepEqual(await a('perso'), [], 'un rôle personnalisé ne change pas');
  assert.equal((await base.premier("SELECT usage FROM envois WHERE id = 'e1'", [])).usage, 'review');
  await base.executer(
    "INSERT INTO envois (id, team_id, portee, compte_id, usage, nom_original, taille, taille_morceau, morceaux, empreinte_etat, cle_stockage, cree_le, maj_le) VALUES ('e2', 't-avec', 't-avec', 'principal', 'lineup', 'p.png', 10, 10, 1, '{}', 'teams/t-avec/lineups/y.media', ?, ?)",
    [d, d],
  );
  await assert.rejects(
    base.executer("INSERT INTO envois (id, team_id, portee, compte_id, usage, nom_original, taille, taille_morceau, morceaux, empreinte_etat, cle_stockage, cree_le, maj_le) VALUES ('e3', 't-avec', 't-avec', 'principal', 'autre', 'p.png', 10, 10, 1, '{}', 'teams/t-avec/lineups/z.media', ?, ?)", [d, d]),
  );
});
