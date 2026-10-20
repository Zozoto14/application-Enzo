/**
 * Review vidéo v2 : réactions 👍 / 👎 (unicité, changement, retrait, isolation
 * entre teams, permission video_review.react, commentaires), dessin posé sur
 * la vidéo (validation de forme et de taille, enregistrement, export Markdown
 * et RGPD), événement du bus sans notification, migration 0010.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseSqlite, lireMigrations } from '../adaptateurs/sqlite.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { OBJETS_DESSIN_MAX, TAILLE_DESSIN_MAX, lireDessin, resumeDessin, validerDessin } from '../noyau/review/dessin.mjs';
import { exporterMarkdown } from '../noyau/review/export.mjs';
import { exporterBase } from '../noyau/transfert.mjs';

const ID = 'dQw4w9WgXcQ';
const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  rem12345: { pseudo: 'Rem', role: 'remplacant' },
  max12345: { pseudo: 'Max', role: 'manager' },
};
const FLECHE = { v: 1, objets: [{ t: 'fleche', c: '#E5484D', e: 4, p: [0.1, 0.2, 0.55, 0.6] }] };

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'joueur' } } });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const s = A.sessions;
  const review = (await api(`/teams/${A.teamId}/review`, s.coach123, { methode: 'POST', corps: { titre: 'Faucons vs Nova', url: `https://youtu.be/${ID}` } })).corps;
  const repere = (await api(`/teams/${A.teamId}/review/${review.id}/reperes`, s.coach123, { methode: 'POST', corps: { debut: 30, categorie: 'erreur', titre: 'Peek trop large' } })).corps;
  const r = (suite = '') => `/teams/${A.teamId}/review/${review.id}${suite}`;
  return { b, A, B, api, s, review, repere, r };
}

test('dessin : validation de la forme, des coordonnées relatives et de la taille', () => {
  assert.equal(validerDessin(null), null);
  assert.equal(validerDessin(undefined), null);
  assert.equal(validerDessin({ v: 1, objets: [] }), null, 'aucune forme : pas de dessin');
  const propre = validerDessin({
    v: 1,
    objets: [
      { t: 'fleche', c: '#E5484D', e: 4, p: [0.123456789, 0, 1, 0.5] },
      { t: 'cercle', c: '#ffffff', e: 2, p: [0.1, 0.1, 0.3, 0.3] },
      { t: 'rect', c: '#000000', e: 1, p: [0, 0, 1, 1] },
      { t: 'trait', c: '#30a46c', e: 6, p: [0, 0, 0.2, 0.2, 0.4, 0.1] },
      { t: 'texte', c: '#f5a524', e: 5, p: [0.5, 0.5], x: '  Rotation <b>B</b>  ' },
    ],
    autre: 'ignoré',
  });
  assert.equal(propre.objets.length, 5);
  assert.deepEqual(propre.objets[0], { t: 'fleche', c: '#e5484d', e: 4, p: [0.1235, 0, 1, 0.5] }, 'couleur en minuscules, coordonnées arrondies');
  assert.equal(propre.objets[4].x, 'Rotation bB/b', 'texte : sans chevrons ni contrôles');
  assert.equal(propre.autre, undefined, 'champs inconnus retirés');
  // Accepte aussi le JSON en texte.
  assert.deepEqual(validerDessin(JSON.stringify(FLECHE)), validerDessin(FLECHE));
  const mauvais = [
    'pas du json',
    '[]',
    42,
    { v: 2, objets: [] },
    { v: 1 },
    { v: 1, objets: [null] },
    { v: 1, objets: [{ t: 'image', c: '#000000', e: 2, p: [0, 0, 1, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: 'red', e: 2, p: [0, 0, 1, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 0, p: [0, 0, 1, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2.5, p: [0, 0, 1, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, 1.2, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, -0.1, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, 1] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, 1, 1, 0.5, 0.5] }] },
    { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, '1', 1] }] },
    { v: 1, objets: [{ t: 'trait', c: '#000000', e: 2, p: Array(402).fill(0.5) }] },
    { v: 1, objets: [{ t: 'texte', c: '#000000', e: 2, p: [0.5, 0.5], x: '   ' }] },
    { v: 1, objets: [{ t: 'texte', c: '#000000', e: 2, p: [0.5, 0.5], x: 'x'.repeat(121) }] },
    { v: 1, objets: Array(OBJETS_DESSIN_MAX + 1).fill(FLECHE.objets[0]) },
    'x'.repeat(TAILLE_DESSIN_MAX + 1),
  ];
  for (const d of mauvais) {
    assert.throws(() => validerDessin(d), e => e.statut === 400 && e.code === 'dessin', JSON.stringify(d).slice(0, 80));
  }
  // Trop volumineux une fois sérialisé (100 traits de 200 points).
  const lourd = { v: 1, objets: Array(100).fill({ t: 'trait', c: '#000000', e: 2, p: Array(400).fill(0.123456) }) };
  assert.throws(() => validerDessin(lourd), e => e.code === 'dessin');
  assert.equal(lireDessin('{abîmé'), null);
  assert.equal(resumeDessin(validerDessin(FLECHE)), '1 forme (flèche)');
});

test('réactions : une par membre et par repère, changement, retrait, compteurs et noms visibles par tous', async () => {
  const { api, s, repere, r } = await preparer();
  const reagir = (jeton, valeur, cible = `/reperes/${repere.id}`) => api(r(`${cible}/reaction`), jeton, { methode: 'PUT', corps: { valeur } });
  const lea = await reagir(s.lea12345, 'like');
  assert.equal(lea.statut, 200, JSON.stringify(lea.corps));
  assert.deepEqual({ like: lea.corps.reactions.like, dislike: lea.corps.reactions.dislike, moi: lea.corps.reactions.moi }, { like: 1, dislike: 0, moi: 'like' });
  assert.deepEqual(lea.corps.reactions.qui.like, [{ compte: 'lea12345', pseudo: 'Léa' }]);
  // Deux fois le même like : toujours une seule réaction.
  assert.equal((await reagir(s.lea12345, 'like')).corps.reactions.like, 1, 'unicité');
  // Kai dislike, le Manager like (il voit la review, il réagit).
  assert.equal((await reagir(s.kai12345, 'dislike')).statut, 200);
  const max = await reagir(s.max12345, 'like');
  assert.equal(max.statut, 200);
  assert.deepEqual([max.corps.reactions.like, max.corps.reactions.dislike], [2, 1]);
  // Léa change d'avis : like → dislike, toujours une seule ligne.
  const change = await reagir(s.lea12345, 'dislike');
  assert.deepEqual([change.corps.reactions.like, change.corps.reactions.dislike, change.corps.reactions.moi], [1, 2, 'dislike']);
  assert.deepEqual(change.corps.reactions.qui.dislike.map(p => p.pseudo).sort(), ['Kai', 'Léa']);
  // Vue par le Coach : compteurs identiques, sa propre réaction vide.
  const vu = (await api(r(), s.coach123)).corps.reperes[0].reactions;
  assert.deepEqual([vu.like, vu.dislike, vu.moi], [1, 2, null]);
  // Retrait (DELETE ou valeur null).
  assert.equal((await api(r(`/reperes/${repere.id}/reaction`), s.lea12345, { methode: 'DELETE' })).corps.reactions.dislike, 1);
  assert.equal((await reagir(s.kai12345, null)).corps.reactions.dislike, 0);
  assert.equal((await reagir(s.kai12345, null)).statut, 200, 'retirer deux fois : sans effet');
  // Valeur inconnue.
  const e = await reagir(s.lea12345, 'love');
  assert.equal(e.statut, 400);
  assert.equal(e.corps.code, 'valeur');
});

test('réactions : unicité garantie par la base (une ligne par membre et par cible)', async () => {
  const { b, s, repere, r, api } = await preparer();
  for (const v of ['like', 'dislike', 'like', 'dislike']) await api(r(`/reperes/${repere.id}/reaction`), s.lea12345, { methode: 'PUT', corps: { valeur: v } });
  const lignes = await b.base.tous('SELECT valeur FROM review_reactions WHERE compte_id = ?', ['lea12345']);
  assert.deepEqual(lignes.map(l => l.valeur), [-1]);
  await assert.rejects(
    b.base.executer("INSERT INTO review_reactions (id, team_id, review_id, repere_id, cible_type, cible_id, compte_id, valeur, cree_le, maj_le) SELECT 'x', team_id, review_id, repere_id, cible_type, cible_id, compte_id, 1, cree_le, maj_le FROM review_reactions", []),
    /UNIQUE/,
  );
});

test('réactions sur les commentaires des repères', async () => {
  const { api, s, repere, r } = await preparer();
  const com = (await api(r(`/reperes/${repere.id}/commentaires`), s.kai12345, { methode: 'POST', corps: { texte: 'Je prends **note**' } })).corps.commentaires[0];
  assert.deepEqual(com.reactions, { like: 0, dislike: 0, moi: null, qui: { like: [], dislike: [] } });
  const x = await api(r(`/reperes/${repere.id}/commentaires/${com.id}/reaction`), s.lea12345, { methode: 'PUT', corps: { valeur: 'like' } });
  assert.equal(x.statut, 200, JSON.stringify(x.corps));
  assert.equal(x.corps.commentaires[0].reactions.like, 1);
  assert.equal(x.corps.reactions.like, 0, 'la réaction au commentaire ne compte pas pour le repère');
  assert.equal((await api(r(`/reperes/${repere.id}/commentaires/${com.id}/reaction`), s.lea12345, { methode: 'DELETE' })).corps.commentaires[0].reactions.like, 0);
  const inconnu = '00000000-0000-4000-8000-000000000000';
  assert.equal((await api(r(`/reperes/${repere.id}/commentaires/${inconnu}/reaction`), s.lea12345, { methode: 'PUT', corps: { valeur: 'like' } })).statut, 404);
});

test('réactions : permission video_review.react et isolation entre teams', async () => {
  const { A, B, api, s, repere, r, review } = await preparer();
  // Le Remplaçant ne voit pas la review : il ne réagit pas.
  assert.equal((await api(r(`/reperes/${repere.id}/reaction`), s.rem12345, { methode: 'PUT', corps: { valeur: 'like' } })).statut, 403);
  // Un rôle qui voit la review SANS video_review.react : 403, et `droits.reagir` faux.
  const fond = s.fondateur;
  const role = await api(`/teams/${A.teamId}/roles`, fond, { methode: 'POST', corps: { nom: 'Spectateur', couleur: '#445566', permissions: ['members.view', 'video_review.view'] } });
  assert.equal(role.statut, 200, JSON.stringify(role.corps));
  const membreKai = A.membres.kai12345;
  assert.equal((await api(`/teams/${A.teamId}/membres/${membreKai.id}`, fond, { methode: 'PATCH', corps: { roleId: role.corps.id ?? role.corps.role?.id } })).statut, 200);
  assert.equal((await api(r(`/reperes/${repere.id}/reaction`), s.kai12345, { methode: 'PUT', corps: { valeur: 'like' } })).statut, 403);
  assert.equal((await api(r(), s.kai12345)).corps.droits.reagir, false);
  // Bob (team B) : la team A n'existe pas pour lui ; avec SA team, la review de A est introuvable.
  const bob = B.sessions.bob12345;
  assert.equal((await api(r(`/reperes/${repere.id}/reaction`), bob, { methode: 'PUT', corps: { valeur: 'like' } })).statut, 404);
  assert.equal((await api(`/teams/${B.teamId}/review/${review.id}/reperes/${repere.id}/reaction`, bob, { methode: 'PUT', corps: { valeur: 'dislike' } })).statut, 404);
  const vu = (await api(r(), s.coach123)).corps.reperes[0].reactions;
  assert.deepEqual([vu.like, vu.dislike], [0, 0], 'aucune réaction n’a fui');
});

test('réactions : événement sur le bus (journal), sans notification', async () => {
  const { b, A, api, s, repere, r, review } = await preparer();
  const avant = Number((await b.base.premier('SELECT COUNT(*) AS n FROM notifications', [])).n);
  await api(r(`/reperes/${repere.id}/reaction`), s.lea12345, { methode: 'PUT', corps: { valeur: 'like' } });
  await api(r(`/reperes/${repere.id}/reaction`), s.lea12345, { methode: 'PUT', corps: { valeur: 'like' } });
  const evs = await b.base.tous("SELECT * FROM evenements WHERE type = 'review.reaction_changed'", []);
  assert.equal(evs.length, 1, 'un seul événement : la seconde fois ne change rien');
  assert.deepEqual(JSON.parse(evs[0].charge), { reviewId: review.id, review: 'Faucons vs Nova', repereId: repere.id, repereTitre: 'Peek trop large', cible: 'repere', valeur: 'like', avant: null });
  assert.ok(evs[0].traite_le, 'distribué');
  const journal = await api(`/teams/${A.teamId}/journal?action=review`, s.fondateur);
  assert.ok(journal.corps.entrees.some(e => e.action === 'review.reaction_changed'), 'au journal');
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM notifications', [])).n), avant, 'aucune notification');
});

test('dessin : enregistré sur un repère (création ou modification), validé, exporté (Markdown, RGPD)', async () => {
  const { b, A, api, s, r, review } = await preparer();
  // Léa (Joueur, annotate) crée un repère avec un dessin au temps courant.
  const cree = await api(r('/reperes'), s.lea12345, { methode: 'POST', corps: { debut: 95, categorie: 'placement', titre: 'Dessin 01:35', dessin: FLECHE } });
  assert.equal(cree.statut, 200, JSON.stringify(cree.corps));
  assert.deepEqual(cree.corps.dessin, { v: 1, objets: [{ t: 'fleche', c: '#e5484d', e: 4, p: [0.1, 0.2, 0.55, 0.6] }] });
  // Modification : ajout d'un cercle, puis forme invalide refusée (400), puis retrait.
  const deux = { v: 1, objets: [...FLECHE.objets, { t: 'cercle', c: '#30a46c', e: 3, p: [0.4, 0.4, 0.6, 0.7] }] };
  const m = await api(r(`/reperes/${cree.corps.id}`), s.lea12345, { methode: 'PATCH', corps: { dessin: deux } });
  assert.equal(m.corps.dessin.objets.length, 2);
  const e = await api(r(`/reperes/${cree.corps.id}`), s.lea12345, { methode: 'PATCH', corps: { dessin: { v: 1, objets: [{ t: 'fleche', c: '#000000', e: 2, p: [0, 0, 3, 3] }] } } });
  assert.equal(e.statut, 400);
  assert.equal(e.corps.code, 'dessin');
  assert.equal((await api(r(`/reperes/${cree.corps.id}`), s.lea12345, { methode: 'PATCH', corps: { dessin: 'x'.repeat(40000) } })).statut, 400, 'trop volumineux');
  // Le Manager (sans annotate) ne dessine pas ; Kai ne dessine pas sur le repère de Léa.
  assert.equal((await api(r('/reperes'), s.max12345, { methode: 'POST', corps: { debut: 5, categorie: 'comms', titre: 'Essai', dessin: FLECHE } })).statut, 403);
  assert.equal((await api(r(`/reperes/${cree.corps.id}`), s.kai12345, { methode: 'PATCH', corps: { dessin: FLECHE } })).statut, 403);
  // Lu par tous les lecteurs.
  assert.equal((await api(r(), s.max12345)).corps.reperes.find(x => x.id === cree.corps.id).dessin.objets.length, 2);
  // Export Markdown : mention du dessin et réactions.
  await api(r(`/reperes/${cree.corps.id}/reaction`), s.kai12345, { methode: 'PUT', corps: { valeur: 'like' } });
  const md = (await api(r('/export.md?format=json'), s.lea12345)).corps.contenu;
  assert.match(md, /✏️ Dessin sur la vidéo : 2 formes \(flèche, cercle\), visible sur le site ou l’app PC\./);
  assert.match(md, /Réactions : 👍 1 · 👎 0/);
  // RGPD : le dessin et les réactions sont dans l'export du compte.
  const lea = (await api('/moi/export', s.lea12345)).corps;
  assert.equal(lea.reviewReperes.find(x => x.titre === 'Dessin 01:35').dessin.objets.length, 2);
  const kai = (await api('/moi/export', s.kai12345)).corps;
  assert.deepEqual(kai.reviewReactions.map(x => [x.review, x.repere, x.cible, x.reaction]), [['Faucons vs Nova', 'Dessin 01:35', 'repere', 'like']]);
  // Export de la base (déménagement) : la table des réactions suit.
  assert.equal((await exporterBase(b.base)).tables.review_reactions.length, 1);
  // Suppression du compte de Kai : ses réactions disparaissent.
  assert.equal((await api('/moi', s.kai12345, { methode: 'DELETE' })).statut, 200);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM review_reactions', [])).n), 0);
  assert.ok(A.teamId && review.id);
});

test('export Markdown : réactions et mention du dessin, rien de dangereux', () => {
  const md = exporterMarkdown({
    review: { titre: 'R', url: `https://www.youtube.com/watch?v=${ID}`, videoId: ID },
    reperes: [{ debut: 1, fin: null, categorie: 'erreur', titre: 'T', note: '', reactions: { like: 3, dislike: 1 }, dessin: validerDessin({ v: 1, objets: [{ t: 'texte', c: '#000000', e: 2, p: [0.5, 0.5], x: '<script>' }] }), commentaires: [] }],
  });
  assert.match(md, /Réactions : 👍 3 · 👎 1/);
  assert.match(md, /✏️ Dessin sur la vidéo : 1 forme \(texte\)/);
  assert.doesNotMatch(md, /<script/);
});

test('migration 0010 : table des réactions, colonne dessin, video_review.react pour les rôles qui voient la review', async () => {
  const base = await baseSqlite();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0010'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['proprietaire', 'manager', 'coach', 'analyste', 'joueur', 'remplacant']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  }
  await base.executer("INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES ('perso', 't', NULL, 'Perso', '#000000', 0, 9, ?, ?)", [d, d]);
  await base.executer("INSERT INTO role_permissions (role_id, permission) VALUES ('perso', 'video_review.view')", []);
  // Repère d'avant la migration : il garde ses données, sans dessin.
  await base.executer("INSERT INTO reviews (id, team_id, titre, url, video_id, cree_par, cree_le, maj_le) VALUES ('rv', 't', 'R', 'u', ?, 'principal', ?, ?)", [ID, d, d]);
  await base.executer("INSERT INTO review_reperes (id, review_id, team_id, debut_s, categorie, titre, auteur_id, cree_le, maj_le) VALUES ('rp', 'rv', 't', 3, 'erreur', 'Ancien', 'principal', ?, ?)", [d, d]);
  const toutes = migrations.filter(m => m.nom <= '0010_review_v2.sql');
  assert.ok((await appliquerMigrations(base, toutes)).includes('0010_review_v2.sql'));
  assert.deepEqual(await appliquerMigrations(base, toutes), [], 'idempotente');
  const a = async role => (await base.tous("SELECT permission FROM role_permissions WHERE role_id = ? AND permission = 'video_review.react'", [role])).length === 1;
  assert.deepEqual(
    Object.fromEntries(await Promise.all(['manager', 'coach', 'analyste', 'joueur', 'remplacant', 'perso'].map(async c => [c, await a(c)]))),
    { manager: true, coach: true, analyste: true, joueur: true, remplacant: false, perso: false },
  );
  assert.equal((await base.premier("SELECT dessin FROM review_reperes WHERE id = 'rp'", [])).dessin, null);
  await base.executer("INSERT INTO review_reactions (id, team_id, review_id, repere_id, cible_type, cible_id, compte_id, valeur, cree_le, maj_le) VALUES ('x1', 't', 'rv', 'rp', 'repere', 'rp', 'lea12345', 1, ?, ?)", [d, d]);
  await assert.rejects(base.executer("INSERT INTO review_reactions (id, team_id, review_id, repere_id, cible_type, cible_id, compte_id, valeur, cree_le, maj_le) VALUES ('x2', 't', 'rv', 'rp', 'repere', 'rp', 'lea12345', -1, ?, ?)", [d, d]), /UNIQUE/);
  await assert.rejects(base.executer("INSERT INTO review_reactions (id, team_id, review_id, repere_id, cible_type, cible_id, compte_id, valeur, cree_le, maj_le) VALUES ('x3', 't', 'rv', 'rp', 'repere', 'rp', 'kai12345', 2, ?, ?)", [d, d]), /CHECK/);
});
