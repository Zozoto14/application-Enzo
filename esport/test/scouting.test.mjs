/**
 * Scouting adverse (phase 5) : droits (invisible pour un Joueur), fiche,
 * joueurs, tendances, VODs, « Ouvrir en review vidéo », historique des
 * confrontations relié au planning, isolation entre teams, module désactivé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';

const MEMBRES = {
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  ana12345: { pseudo: 'Ana', role: 'analyste' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  rem12345: { pseudo: 'Rem', role: 'remplacant' },
  max12345: { pseudo: 'Max', role: 'manager' },
};
const ID = 'dQw4w9WgXcQ';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: MEMBRES });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'coach' } } });
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const sc = (suite = '', team = A.teamId) => `/teams/${team}/scouting/adversaires${suite}`;
  return { b, A, B, api, sc, s: A.sessions };
}

test('scouting : invisible pour un Joueur (403 en appel direct), lecture seule pour le Manager, gestion Coach et Analyste', async () => {
  const { A, api, sc, s } = await preparer();
  const nova = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova', notes: 'Joue vite.' } })).corps;
  assert.ok(nova.id);
  for (const [chemin, methode, corps] of [
    [sc(), 'GET'],
    [sc(), 'POST', { nom: 'Intrus' }],
    [sc(`/${nova.id}`), 'GET'],
    [sc(`/${nova.id}`), 'PATCH', { nom: 'Piraté' }],
    [sc(`/${nova.id}`), 'DELETE'],
    [sc(`/${nova.id}/joueurs`), 'POST', { pseudo: 'X' }],
    [sc(`/${nova.id}/vods`), 'POST', { url: `https://youtu.be/${ID}`, titre: 'VOD' }],
  ]) {
    for (const compte of ['lea12345', 'rem12345']) {
      const r = await api(chemin, s[compte], { methode, corps });
      assert.equal(r.statut, 403, `${compte} ${methode} ${chemin}`);
      assert.doesNotMatch(JSON.stringify(r.corps), /Nova/, 'rien ne fuit');
    }
  }
  // Manager : lit, ne modifie pas.
  assert.equal((await api(sc(), s.max12345)).corps.adversaires.length, 1);
  assert.equal((await api(sc(), s.max12345)).corps.droits.gerer, false);
  assert.equal((await api(sc(), s.max12345, { methode: 'POST', corps: { nom: 'Intrus' } })).statut, 403);
  assert.equal((await api(sc(`/${nova.id}`), s.max12345, { methode: 'PATCH', corps: { nom: 'X2' } })).statut, 403);
  // Analyste : gère.
  assert.equal((await api(sc(), s.ana12345, { methode: 'POST', corps: { nom: 'Orion' } })).statut, 200);
  const liste = (await api(sc(), s.coach123)).corps;
  assert.deepEqual(liste.adversaires.map(a => a.nom), ['Orion', 'Team Nova']);
  assert.equal(liste.droits.gerer, true);
  assert.equal(A.teamId.length > 10, true);
});

test('fiche adversaire : validation du nom et du logo (https seulement), modification, suppression logique', async () => {
  const { api, sc, s } = await preparer();
  for (const corps of [{ nom: 'x' }, { nom: 'Nova', logoUrl: 'javascript:alert(1)' }, { nom: 'Nova', logoUrl: 'http://exemple.fr/logo.png' }, { nom: 'Nova', logoUrl: 'https://exemple.fr/a b.png' }, { nom: 'Nova', logoUrl: 'data:image/png;base64,AAAA' }]) {
    assert.equal((await api(sc(), s.coach123, { methode: 'POST', corps })).statut, 400, JSON.stringify(corps));
  }
  const r = await api(sc(), s.coach123, { methode: 'POST', corps: { nom: '  Team   Nova ', logoUrl: 'https://exemple.fr/logo.png', notes: 'Notes\nsur deux lignes' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.nom, 'Team Nova');
  assert.equal(r.corps.logoUrl, 'https://exemple.fr/logo.png');
  const m = await api(sc(`/${r.corps.id}`), s.coach123, { methode: 'PATCH', corps: { logoUrl: null, notes: 'Mises à jour' } });
  assert.equal(m.corps.logoUrl, null);
  assert.equal(m.corps.nom, 'Team Nova', 'champs non envoyés inchangés');
  assert.equal((await api(sc(`/${r.corps.id}`), s.coach123, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(sc(`/${r.corps.id}`), s.coach123)).statut, 404);
  assert.equal((await api(sc(), s.coach123)).corps.adversaires.length, 0);
});

test('joueurs adverses, tendances par map et side, VODs : ajout, modification, suppression, validation', async () => {
  const { api, sc, s } = await preparer();
  const id = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova' } })).corps.id;
  // Joueurs.
  const j = await api(sc(`/${id}/joueurs`), s.ana12345, { methode: 'POST', corps: { pseudo: 'Phantom', riotId: 'Phantom#EUW', role: 'Duelliste', agents: ['Jett', 'Raze', 'Jett', ''], notes: 'Agressif' } });
  assert.equal(j.statut, 200, JSON.stringify(j.corps));
  assert.equal((await api(sc(`/${id}/joueurs`), s.ana12345, { methode: 'POST', corps: { pseudo: '' } })).statut, 400);
  assert.equal((await api(sc(`/${id}/joueurs`), s.ana12345, { methode: 'POST', corps: { pseudo: 'X', agents: 'Jett' } })).statut, 400);
  await api(sc(`/${id}/joueurs/${j.corps.id}`), s.ana12345, { methode: 'PATCH', corps: { agents: ['Jett', 'Neon'] } });
  // Tendances.
  const t = await api(sc(`/${id}/tendances`), s.ana12345, { methode: 'POST', corps: { map: 'Ascent', side: 'attaque', notes: 'Rush B', tauxVictoire: 62, compos: [['Jett', 'Sova', 'Omen', 'Killjoy', 'Sage'], ['Jett', 'Raze']] } });
  assert.equal(t.statut, 200, JSON.stringify(t.corps));
  for (const corps of [{ map: 'Ascent', side: 'milieu' }, { map: 'A', side: 'attaque' }, { map: 'Ascent', side: 'defense', tauxVictoire: 140 }, { map: 'Ascent', side: 'defense', tauxVictoire: 'beaucoup' }, { map: 'Ascent', side: 'defense', compos: [['a', 'b', 'c', 'd', 'e', 'f']] }]) {
    assert.equal((await api(sc(`/${id}/tendances`), s.ana12345, { methode: 'POST', corps })).statut, 400, JSON.stringify(corps));
  }
  assert.equal((await api(sc(`/${id}/tendances`), s.ana12345, { methode: 'POST', corps: { map: 'Bind', side: 'les_deux' } })).statut, 200, 'win rate facultatif');
  // VODs.
  for (const corps of [{ url: 'javascript:alert(1)', titre: 'VOD' }, { url: 'http://exemple.fr/v', titre: 'VOD' }, { url: `https://youtu.be/${ID}`, titre: 'x' }]) {
    assert.equal((await api(sc(`/${id}/vods`), s.ana12345, { methode: 'POST', corps })).statut, 400, JSON.stringify(corps));
  }
  const vod = await api(sc(`/${id}/vods`), s.ana12345, { methode: 'POST', corps: { url: `https://youtu.be/${ID}`, titre: 'Finale de ligue' } });
  assert.equal(vod.statut, 200);
  await api(sc(`/${id}/vods`), s.ana12345, { methode: 'POST', corps: { url: 'https://www.twitch.tv/videos/123', titre: 'Stream Twitch' } });

  const d = (await api(sc(`/${id}`), s.lea12345)).statut;
  assert.equal(d, 403);
  const detail = (await api(sc(`/${id}`), s.coach123)).corps;
  assert.deepEqual(detail.joueurs.map(x => [x.pseudo, x.agents]), [['Phantom', ['Jett', 'Neon']]]);
  assert.deepEqual(detail.tendances.map(x => [x.map, x.side, x.tauxVictoire]), [['Ascent', 'attaque', 62], ['Bind', 'les_deux', null]]);
  assert.deepEqual(detail.tendances[0].compos[0], ['Jett', 'Sova', 'Omen', 'Killjoy', 'Sage']);
  assert.deepEqual(detail.vods.map(v => [v.titre, v.youtube]).sort(), [['Finale de ligue', true], ['Stream Twitch', false]]);
  const liste = (await api(sc(), s.coach123)).corps.adversaires[0];
  assert.deepEqual([liste.joueurs, liste.vods], [1, 2]);
  // Suppression.
  assert.equal((await api(sc(`/${id}/joueurs/${j.corps.id}`), s.ana12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(sc(`/${id}/joueurs/${j.corps.id}`), s.ana12345, { methode: 'DELETE' })).statut, 404);
  assert.equal((await api(sc(`/${id}`), s.coach123)).corps.joueurs.length, 0);
});

test('« Ouvrir en review vidéo » : crée la review d’une VOD YouTube, la lie, puis rend la même', async () => {
  const { b, A, api, sc, s } = await preparer();
  const id = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova' } })).corps.id;
  const vod = (await api(sc(`/${id}/vods`), s.coach123, { methode: 'POST', corps: { url: `https://www.youtube.com/watch?v=${ID}`, titre: 'Finale' } })).corps.id;
  const twitch = (await api(sc(`/${id}/vods`), s.coach123, { methode: 'POST', corps: { url: 'https://www.twitch.tv/videos/123', titre: 'Stream' } })).corps.id;
  // Pas YouTube : refus clair. Manager (scouting.view seulement) : 403.
  const nonYt = await api(sc(`/${id}/vods/${twitch}/review`), s.coach123, { methode: 'POST', corps: {} });
  assert.equal(nonYt.statut, 400);
  assert.equal(nonYt.corps.code, 'pas-youtube');
  assert.equal((await api(sc(`/${id}/vods/${vod}/review`), s.max12345, { methode: 'POST', corps: {} })).statut, 403);
  assert.equal((await api(sc(`/${id}/vods/${vod}/review`), s.lea12345, { methode: 'POST', corps: {} })).statut, 403);
  // Création.
  const r = await api(sc(`/${id}/vods/${vod}/review`), s.coach123, { methode: 'POST', corps: {} });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.cree, true);
  const review = (await api(`/teams/${A.teamId}/review/${r.corps.reviewId}`, s.coach123)).corps.review;
  assert.equal(review.videoId, ID);
  assert.equal(review.titre, 'Team Nova · Finale');
  assert.equal(review.reference, 'Scouting : Team Nova');
  // Deuxième appel : la même review, pas de doublon.
  const encore = await api(sc(`/${id}/vods/${vod}/review`), s.coach123, { methode: 'POST', corps: {} });
  assert.deepEqual(encore.corps, { reviewId: r.corps.reviewId, cree: false });
  assert.equal((await api(`/teams/${A.teamId}/review`, s.coach123)).corps.reviews.length, 1);
  // La fiche expose la review liée (à qui peut voir les reviews).
  const detail = (await api(sc(`/${id}`), s.coach123)).corps;
  assert.equal(detail.vods.find(v => v.id === vod).reviewId, r.corps.reviewId);
  assert.equal(detail.droits.creerReview, true);
  assert.equal((await api(sc(`/${id}`), s.max12345)).corps.vods.find(v => v.id === vod).reviewId, r.corps.reviewId, 'le Manager voit la review');
  // « review créée » est bien émis (Discord s'y abonnera), avec le lien vers l'adversaire.
  const ev = await b.base.premier("SELECT charge FROM evenements WHERE type = 'review.created'", []);
  assert.equal(JSON.parse(ev.charge).adversaireId, id);
  assert.equal(JSON.parse(ev.charge).depuisVod, true);
  // Review supprimée : la VOD n'y pointe plus, et le bouton en recrée une.
  await api(`/teams/${A.teamId}/review/${r.corps.reviewId}`, s.coach123, { methode: 'DELETE' });
  assert.equal((await api(sc(`/${id}`), s.coach123)).corps.vods.find(v => v.id === vod).reviewId, null);
  const neuve = await api(sc(`/${id}/vods/${vod}/review`), s.coach123, { methode: 'POST', corps: {} });
  assert.equal(neuve.corps.cree, true);
  assert.notEqual(neuve.corps.reviewId, r.corps.reviewId);
  // Lier une review existante.
  const autre = (await api(`/teams/${A.teamId}/review`, s.coach123, { methode: 'POST', corps: { titre: 'Autre match', url: `https://youtu.be/${ID}` } })).corps.id;
  const lie = await api(sc(`/${id}/vods/${vod}/review`), s.coach123, { methode: 'POST', corps: { reviewId: autre } });
  assert.deepEqual(lie.corps, { reviewId: autre, cree: false });
});

test('historique des confrontations : événements du planning qui portent l’adversaire', async () => {
  const { A, api, sc, s } = await preparer();
  const nova = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova' } })).corps.id;
  const orion = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Orion' } })).corps.id;
  const evt = (corps, jeton = s.coach123) => api(`/teams/${A.teamId}/planning`, jeton, { methode: 'POST', corps });
  const e1 = await evt({ type: 'scrim', titre: 'Scrim vs Nova', date: '2026-10-10', heureDebut: '21:00', heureFin: '23:00', adversaireId: nova });
  assert.equal(e1.statut, 200, JSON.stringify(e1.corps));
  await evt({ type: 'match', titre: 'Ligue J4 vs Nova', date: '2026-10-25', heureDebut: '18:00', heureFin: '20:00', adversaireId: nova });
  await evt({ type: 'match', titre: 'Coupe vs Orion', date: '2026-10-26', heureDebut: '18:00', heureFin: '20:00', adversaireId: orion });
  await evt({ type: 'training', titre: 'Entraînement', date: '2026-10-27', heureDebut: '20:00', heureFin: '22:00' });
  const detail = (await api(sc(`/${nova}`), s.coach123)).corps;
  assert.deepEqual(detail.confrontations.map(c => [c.titre, c.type]), [['Ligue J4 vs Nova', 'match'], ['Scrim vs Nova', 'scrim']], 'les plus récentes d’abord');
  const liste = (await api(sc(), s.coach123)).corps.adversaires;
  assert.deepEqual(liste.map(a => [a.nom, a.confrontations]), [['Orion', 1], ['Team Nova', 2]]);
  assert.equal(liste.find(a => a.nom === 'Team Nova').derniere, '2026-10-25T17:00:00.000Z');
  // Une review liée à l'événement apparaît dans la confrontation.
  const review = (await api(`/teams/${A.teamId}/review`, s.coach123, { methode: 'POST', corps: { titre: 'Scrim Nova', url: `https://youtu.be/${ID}` } })).corps.id;
  await api(`/teams/${A.teamId}/planning/${e1.corps.id}`, s.coach123, { methode: 'PATCH', corps: { reviewId: review } });
  assert.equal((await api(sc(`/${nova}`), s.coach123)).corps.confrontations[1].reviewId, review);
  // Retirer l'adversaire de l'événement, ou supprimer la fiche, le détache.
  await api(`/teams/${A.teamId}/planning/${e1.corps.id}`, s.coach123, { methode: 'PATCH', corps: { adversaireId: null } });
  assert.equal((await api(sc(`/${nova}`), s.coach123)).corps.confrontations.length, 1);
  await api(sc(`/${nova}`), s.coach123, { methode: 'DELETE' });
  const restant = (await api(`/teams/${A.teamId}/planning?debut=2026-10-01&fin=2026-11-30`, s.coach123)).corps.occurrences.find(o => o.titre === 'Ligue J4 vs Nova');
  assert.equal(restant.adversaireId, null);
});

test('planning : on ne lie qu’un adversaire ou une review de SA team et visibles par soi', async () => {
  const { A, B, api, sc, s } = await preparer();
  const chezB = (await api(sc('', B.teamId), B.sessions.bob12345, { methode: 'POST', corps: { nom: 'Adversaire de B' } })).corps.id;
  const evt = corps => api(`/teams/${A.teamId}/planning`, s.coach123, { methode: 'POST', corps: { type: 'match', titre: 'Match', date: '2026-10-25', heureDebut: '18:00', heureFin: '20:00', ...corps } });
  assert.equal((await evt({ adversaireId: chezB })).statut, 400, 'adversaire d’une autre team');
  const revB = (await api(`/teams/${B.teamId}/review`, B.sessions.bob12345, { methode: 'POST', corps: { titre: 'Review de B', url: `https://youtu.be/${ID}` } })).corps.id;
  assert.equal((await evt({ reviewId: revB })).statut, 400, 'review d’une autre team');
  assert.equal((await evt({ adversaireId: null, reviewId: null })).statut, 200);
});

test('isolation entre teams et module désactivé', async () => {
  const { A, B, api, sc, s } = await preparer();
  const nova = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova' } })).corps.id;
  const vod = (await api(sc(`/${nova}/vods`), s.coach123, { methode: 'POST', corps: { url: `https://youtu.be/${ID}`, titre: 'Finale' } })).corps.id;
  const bob = B.sessions.bob12345;
  for (const [chemin, methode, corps] of [
    [sc('', A.teamId), 'GET'],
    [sc(`/${nova}`, A.teamId), 'GET'],
    [sc(`/${nova}/joueurs`, A.teamId), 'POST', { pseudo: 'Intrus' }],
  ]) assert.equal((await api(chemin, bob, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  for (const [chemin, methode, corps] of [
    [sc(`/${nova}`, B.teamId), 'GET'],
    [sc(`/${nova}`, B.teamId), 'PATCH', { nom: 'Volé' }],
    [sc(`/${nova}`, B.teamId), 'DELETE'],
    [sc(`/${nova}/joueurs`, B.teamId), 'POST', { pseudo: 'Intrus' }],
    [sc(`/${nova}/vods/${vod}/review`, B.teamId), 'POST', {}],
  ]) assert.equal((await api(chemin, bob, { methode, corps })).statut, 404, `${methode} ${chemin}`);
  assert.equal((await api(sc('', B.teamId), bob)).corps.adversaires.length, 0);
  // Module désactivé : 404 pour tout le monde, Fondateur compris ; les données reviennent à la réactivation.
  const modules = actifs => api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { scouting: actifs } } });
  await modules(false);
  assert.equal((await api(sc(), s.coach123)).statut, 404);
  assert.equal((await api(sc(`/${nova}`), s.fondateur)).statut, 404);
  await modules(true);
  assert.equal((await api(sc(`/${nova}`), s.coach123)).statut, 200);
  // Sans review vidéo, « Ouvrir en review » est refusé (module éteint) mais la fiche reste lisible.
  await api(`/teams/${A.teamId}/modules`, s.fondateur, { methode: 'PUT', corps: { modules: { video_review: false } } });
  assert.equal((await api(sc(`/${nova}/vods/${vod}/review`), s.coach123, { methode: 'POST', corps: {} })).statut, 404);
  const detail = (await api(sc(`/${nova}`), s.coach123)).corps;
  assert.deepEqual([detail.droits.creerReview, detail.droits.voirReview], [false, false]);
});

test('journal et bus : les écritures du scouting laissent une trace lisible', async () => {
  const { b, A, api, sc, s } = await preparer();
  const id = (await api(sc(), s.coach123, { methode: 'POST', corps: { nom: 'Team Nova' } })).corps.id;
  await api(sc(`/${id}/joueurs`), s.coach123, { methode: 'POST', corps: { pseudo: 'Phantom' } });
  await api(sc(`/${id}`), s.coach123, { methode: 'PATCH', corps: { notes: 'x' } });
  const types = (await b.base.tous("SELECT type FROM evenements WHERE type LIKE 'opponent.%' ORDER BY cree_le, id", [])).map(e => e.type);
  assert.deepEqual(types.sort(), ['opponent.created', 'opponent.detail_changed', 'opponent.updated']);
  const entrees = (await api(`/teams/${A.teamId}/journal?action=opponent`, s.fondateur)).corps.entrees;
  assert.equal(entrees.length, 3);
});
