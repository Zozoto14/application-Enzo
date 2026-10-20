/**
 * Résumés de réunions (phase 3) : dépôt, boîte de réception du rédacteur,
 * statuts, PDF (validation, stockage privé, remplacement avec historique,
 * lien signé), visibilité par type, isolation entre teams, notifications.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, teamAvecMembres } from './aide.mjs';
import { octetsPdf, validerPdf, nomOriginal, TAILLE_MAX_PDF } from '../noyau/fichiers.mjs';
import { distribuer } from '../noyau/evenements.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { baseSqlite, lireMigrations } from '../adaptateurs/sqlite.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
  kai12345: { pseudo: 'Kai', role: 'joueur' },
  tom12345: { pseudo: 'Tom', role: 'remplacant' },
};
const HEBDO = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000004';
const encodeur = new TextEncoder();
const pdf = (texte = 'résumé') => encodeur.encode(`%PDF-1.7\n% ${texte}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

async function deposer(b, teamId, jeton, champs = {}) {
  return b.appel(`/teams/${teamId}/resumes`, {
    methode: 'POST',
    jeton,
    corps: { lien: 'https://youtu.be/abc123', typeId: HEBDO, dateReunion: '2026-10-19', titre: 'Réunion du lundi', note: 'Points : comms, retakes', ...champs },
  });
}

test('validation PDF : type annoncé, octets magiques %PDF-, taille, nom de fichier sûr', () => {
  assert.ok(octetsPdf(pdf()));
  assert.ok(!octetsPdf(encodeur.encode('<html>%PDF-1.7</html>')), 'un préambule n’est pas toléré');
  assert.ok(!octetsPdf(encodeur.encode('MZ\x90\x00 pas un pdf')));
  assert.throws(() => validerPdf({ contentType: 'text/plain', octets: pdf() }), e => e.statut === 415 && e.code === 'type-fichier');
  assert.throws(() => validerPdf({ contentType: 'application/pdf', octets: encodeur.encode('ceci est un faux PDF') }), e => e.statut === 415 && e.code === 'pdf-invalide');
  assert.throws(() => validerPdf({ contentType: 'application/pdf', octets: new Uint8Array() }), e => e.code === 'fichier-vide');
  assert.throws(() => validerPdf({ contentType: 'application/pdf', octets: pdf(), tailleAnnoncee: TAILLE_MAX_PDF + 1 }), e => e.statut === 413);
  validerPdf({ contentType: 'application/pdf; charset=binary', octets: pdf() });
  assert.equal(nomOriginal('..%2F..%2Fetc%2Fpasswd'), '.._.._etc_passwd.pdf');
  assert.equal(nomOriginal('Résumé%20S12.pdf'), 'Résumé S12.pdf');
  assert.equal(nomOriginal(''), 'resume.pdf');
});

test('permissions : un Joueur dépose mais ne rédige pas ; un Remplaçant ne dépose pas ; le Manager rédige', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const r = await deposer(b, teamId, sessions.lea12345);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'a_resumer');
  assert.equal(r.corps.type.nom, 'Hebdo');
  const id = r.corps.id;
  // Le Joueur ne rédige pas : statut, PDF, vu, boîte de réception, types.
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: sessions.lea12345, corps: { statut: 'en_cours' } })).statut, 403);
  assert.equal((await b.envoyer(`/teams/${teamId}/resumes/${id}/pdf`, { jeton: sessions.lea12345, octets: pdf() })).statut, 403);
  assert.equal(b.stockage.taille(), 0, 'rien n’est stocké quand la permission manque');
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}/vu`, { methode: 'POST', jeton: sessions.lea12345 })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/types`, { methode: 'POST', jeton: sessions.lea12345, corps: { nom: 'Perso' } })).statut, 403);
  const boiteLea = await b.appel('/resumes/boite', { jeton: sessions.lea12345 });
  assert.equal(boiteLea.statut, 200);
  assert.deepEqual(boiteLea.corps.depots, [], 'pas de boîte de réception pour un Joueur');
  // Remplaçant : lecture limitée, pas de dépôt.
  assert.equal((await deposer(b, teamId, sessions.tom12345)).statut, 403);
  // Manager : rédacteur de la team (rôle système mis à jour).
  const boiteMax = await b.appel('/resumes/boite', { jeton: sessions.max12345 });
  assert.equal(boiteMax.corps.depots.length, 1);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { statut: 'en_cours' } })).statut, 200);
  // Le Coach ne rédige pas (pas write_summary) et ne voit pas la boîte.
  assert.equal((await b.appel('/resumes/boite', { jeton: sessions.coach123 })).corps.depots.length, 0);
});

test('validation des dépôts : lien http(s), date, titre, type de la team ou global', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: MEMBRES.lea12345 } });
  const l = sessions.lea12345;
  assert.equal((await deposer(b, teamId, l, { lien: 'javascript:alert(1)' })).corps.code, 'lien');
  assert.equal((await deposer(b, teamId, l, { dateReunion: '2026-02-30' })).corps.code, 'date');
  assert.equal((await deposer(b, teamId, l, { titre: 'x' })).corps.code, 'titre');
  assert.equal((await deposer(b, teamId, l, { typeId: '11111111-1111-4111-8111-111111111111' })).corps.code, 'type');
  // Module désactivé : 404.
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.fondateur, corps: { modules: { meeting_summaries: false } } });
  const r = await deposer(b, teamId, l);
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
});

test('transitions de statut : À résumer → En cours → Terminé (PDF requis), réouverture ; « Nouveau » puis « Vu »', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: MEMBRES.lea12345 } });
  const f = sessions.fondateur;
  const id = (await deposer(b, teamId, sessions.lea12345)).corps.id;
  let boite = (await b.appel('/resumes/boite', { jeton: f })).corps;
  assert.equal(boite.attente, 1);
  assert.equal(boite.nouveaux, 1);
  assert.equal(boite.depots[0].nouveau, true);
  let r = await b.appel(`/teams/${teamId}/resumes/${id}/vu`, { methode: 'POST', jeton: f });
  assert.equal(r.corps.nouveau, false);
  assert.equal(r.corps.vu.par, 'principal');
  boite = (await b.appel('/resumes/boite', { jeton: f })).corps;
  assert.equal(boite.nouveaux, 0);
  assert.equal(boite.attente, 1);
  r = await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: f, corps: { statut: 'bidon' } });
  assert.equal(r.statut, 400);
  r = await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: f, corps: { statut: 'en_cours' } });
  assert.equal(r.corps.statut, 'en_cours');
  r = await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: f, corps: { statut: 'termine' } });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'pdf-requis');
  r = await b.envoyer(`/teams/${teamId}/resumes/${id}/pdf`, { jeton: f, octets: pdf(), nom: 'Résumé lundi.pdf' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'termine', 'Terminé automatiquement à l’upload du PDF');
  r = await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: f, corps: { statut: 'en_cours' } });
  assert.equal(r.corps.statut, 'en_cours', 'réouverture possible');
  r = await b.appel(`/teams/${teamId}/resumes/${id}`, { methode: 'PATCH', jeton: f, corps: { statut: 'termine' } });
  assert.equal(r.corps.statut, 'termine', 'avec un PDF, Terminé à la main');
  const journal = (await b.appel(`/teams/${teamId}/journal`, { jeton: f })).corps.entrees.map(e => e.action);
  for (const a of ['meeting.submitted', 'meeting.status_changed', 'meeting.summary_published']) assert.ok(journal.includes(a), a);
  assert.equal((await b.appel('/resumes/boite', { jeton: f })).corps.attente, 0);
});

test('PDF : faux PDF et mauvais type refusés, taille max, stockage privé à nom aléatoire, remplacement avec historique', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: MEMBRES.lea12345 } });
  const f = sessions.fondateur;
  const id = (await deposer(b, teamId, sessions.lea12345)).corps.id;
  const url = `/teams/${teamId}/resumes/${id}/pdf`;
  let r = await b.envoyer(url, { jeton: f, octets: encodeur.encode('juste du texte, pas un PDF'), nom: 'faux.pdf' });
  assert.equal(r.statut, 415);
  assert.equal(r.corps.code, 'pdf-invalide');
  r = await b.envoyer(url, { jeton: f, octets: pdf(), type: 'image/png' });
  assert.equal(r.statut, 415);
  assert.equal(r.corps.code, 'type-fichier');
  r = await b.envoyer(url, { jeton: f, octets: pdf(), entetes: { 'Content-Length': String(TAILLE_MAX_PDF + 1) } });
  assert.equal(r.statut, 413);
  const gros = new Uint8Array(TAILLE_MAX_PDF + 10);
  gros.set(pdf());
  r = await b.envoyer(url, { jeton: f, octets: gros });
  assert.equal(r.statut, 413, 'taille réelle vérifiée, même sans Content-Length fiable');
  assert.equal(b.stockage.taille(), 0);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}`, { jeton: f })).corps.statut, 'a_resumer');

  r = await b.envoyer(url, { jeton: f, octets: pdf('v1'), nom: 'Résumé v1.pdf' });
  assert.equal(r.statut, 200);
  const v1 = r.corps.resume.fichierId;
  r = await b.envoyer(url, { jeton: f, octets: pdf('v2'), nom: 'Résumé v2.pdf' });
  const v2 = r.corps.resume.fichierId;
  assert.notEqual(v1, v2);
  assert.equal(r.corps.fichiers.length, 2, 'historique : les deux versions');
  assert.deepEqual(r.corps.fichiers.map(x => [x.nom, x.actuel, Boolean(x.remplaceLe)]), [
    ['Résumé v2.pdf', true, false],
    ['Résumé v1.pdf', false, true],
  ]);
  assert.equal(b.stockage.taille(), 2, 'l’ancien PDF reste stocké');
  const cles = (await b.base.tous('SELECT cle_stockage FROM fichiers ORDER BY cree_le', [])).map(l => l.cle_stockage);
  for (const cle of cles) {
    assert.match(cle, new RegExp(`^teams/${teamId}/resumes/[0-9a-f-]{36}\\.pdf$`), 'nom aléatoire, jamais le nom d’origine');
  }
  // Le déposant ne voit que la version actuelle ; le rédacteur garde l’accès aux anciennes.
  const vueLea = (await b.appel(`/teams/${teamId}/resumes/${id}`, { jeton: sessions.lea12345 })).corps;
  assert.deepEqual(vueLea.fichiers.map(x => x.id), [v2]);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}/lien`, { methode: 'POST', jeton: sessions.lea12345, corps: { fichierId: v1 } })).statut, 404);
  const ancien = await b.appel(`/teams/${teamId}/resumes/${id}/lien`, { methode: 'POST', jeton: f, corps: { fichierId: v1 } });
  assert.equal(ancien.statut, 200);
  assert.match(new TextDecoder().decode(new Uint8Array(await (await b.brut(ancien.corps.url)).arrayBuffer())), /% v1/);
});

test('lien signé : temporaire, infalsifiable, en-têtes sûrs ; sans stockage → 503 clair', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: MEMBRES.lea12345 } });
  const id = (await deposer(b, teamId, sessions.lea12345)).corps.id;
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${id}/lien`, { methode: 'POST', jeton: sessions.lea12345 })).corps.code, 'pas-de-pdf');
  await b.envoyer(`/teams/${teamId}/resumes/${id}/pdf`, { jeton: sessions.fondateur, octets: pdf(), nom: 'Résumé.pdf' });
  const lien = (await b.appel(`/teams/${teamId}/resumes/${id}/lien`, { methode: 'POST', jeton: sessions.lea12345, corps: { telecharger: true } })).corps;
  assert.match(lien.url, /^https:\/\/esport\.test\/fichiers\/[0-9a-f-]{36}\?/);
  let r = await b.brut(lien.url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/pdf');
  assert.match(r.headers.get('Content-Disposition'), /^attachment; filename="R_sum_.pdf"; filename\*=UTF-8''R%C3%A9sum%C3%A9\.pdf$/);
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(r.headers.get('Cache-Control'), /no-store/);
  assert.ok(octetsPdf(new Uint8Array(await r.arrayBuffer())));
  // Falsifié (autre compte, autre fichier, signature modifiée) : 403. Sans signature : 403.
  const u = new URL(lien.url);
  u.searchParams.set('c', 'kai12345');
  assert.equal((await b.brut(u.toString())).status, 403);
  assert.equal((await b.brut(lien.url.replace(/sig=[^&]+/, 'sig=AAAA'))).status, 403);
  assert.equal((await b.brut(lien.url.split('?')[0])).status, 403);
  // Expiré après 5 minutes.
  b.horloge.t += 5 * 60 * 1000 + 1;
  r = await b.brut(lien.url);
  assert.equal(r.status, 410);

  const sans = await banc({ sansStockage: true });
  const t2 = await teamAvecMembres(sans, { membres: { lea12345: MEMBRES.lea12345 } });
  const id2 = (await deposer(sans, t2.teamId, t2.sessions.lea12345)).corps.id;
  const r2 = await sans.envoyer(`/teams/${t2.teamId}/resumes/${id2}/pdf`, { jeton: t2.sessions.fondateur, octets: pdf() });
  assert.equal(r2.statut, 503);
  assert.equal(r2.corps.code, 'stockage-absent');
});

test('isolation : la team A n’accède jamais aux dépôts, résumés ni PDF de la team B', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team A', membres: { lea12345: MEMBRES.lea12345, max12345: MEMBRES.max12345 } });
  const B = await teamAvecMembres(b, { nom: 'Team B', membres: { kai12345: MEMBRES.kai12345 } });
  const f = A.sessions.fondateur;
  const idB = (await deposer(b, B.teamId, B.sessions.kai12345, { titre: 'Secret B' })).corps.id;
  await b.envoyer(`/teams/${B.teamId}/resumes/${idB}/pdf`, { jeton: f, octets: pdf('secret B') });
  const fichierB = (await b.appel(`/teams/${B.teamId}/resumes/${idB}`, { jeton: f })).corps.resume.fichierId;
  for (const jeton of [A.sessions.lea12345, A.sessions.max12345]) {
    assert.equal((await b.appel(`/teams/${B.teamId}/resumes`, { jeton })).statut, 404);
    assert.equal((await b.appel(`/teams/${B.teamId}/resumes/${idB}`, { jeton })).statut, 404);
    assert.equal((await b.appel(`/teams/${B.teamId}/resumes/${idB}/lien`, { methode: 'POST', jeton })).statut, 404);
    assert.equal((await b.envoyer(`/teams/${B.teamId}/resumes/${idB}/pdf`, { jeton, octets: pdf() })).statut, 404);
    // Le bon identifiant de dépôt, mais par la route de SA team : introuvable.
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${idB}`, { jeton })).statut, 404);
    assert.equal((await b.appel(`/teams/${A.teamId}/resumes/${idB}/lien`, { methode: 'POST', jeton, corps: { fichierId: fichierB } })).statut, 404);
  }
  // Boîte du Manager de A : rien de B, et filtrer sur B est refusé.
  const boite = (await b.appel('/resumes/boite', { jeton: A.sessions.max12345 })).corps;
  assert.ok(boite.depots.every(d => d.team.id === A.teamId));
  assert.deepEqual(boite.teams.map(t => t.nom), ['Team A']);
  assert.equal((await b.appel(`/resumes/boite?team=${B.teamId}`, { jeton: A.sessions.max12345 })).statut, 404);
  // Le Fondateur (rédacteur partout) voit les deux teams.
  const tout = (await b.appel('/resumes/boite', { jeton: f })).corps;
  assert.deepEqual(tout.teams.map(t => t.nom).sort(), ['Team A', 'Team B']);
});

test('visibilité par type : « staff » réservé au staff (et au déposant) ; « team » ouvert aux lecteurs', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const f = sessions.fondateur;
  const staff = (await deposer(b, teamId, sessions.coach123, { typeId: STAFF, titre: 'Réunion staff' })).corps.id;
  const hebdo = (await deposer(b, teamId, sessions.kai12345, { titre: 'Hebdo' })).corps.id;
  for (const id of [staff, hebdo]) await b.envoyer(`/teams/${teamId}/resumes/${id}/pdf`, { jeton: f, octets: pdf() });
  // Léa (Joueur, lecture des résumés) : l’hebdo oui, le staff non (404).
  const listeLea = (await b.appel(`/teams/${teamId}/resumes`, { jeton: sessions.lea12345 })).corps.resumes.map(r => r.titre);
  assert.deepEqual(listeLea, ['Hebdo']);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${staff}`, { jeton: sessions.lea12345 })).statut, 404);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${staff}/lien`, { methode: 'POST', jeton: sessions.lea12345 })).statut, 404);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${hebdo}/lien`, { methode: 'POST', jeton: sessions.lea12345 })).statut, 200);
  // Coach (staff) : les deux. Remplaçant (pas de lecture des résumés) : aucun.
  assert.equal((await b.appel(`/teams/${teamId}/resumes`, { jeton: sessions.coach123 })).corps.resumes.length, 2);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${hebdo}`, { jeton: sessions.tom12345 })).statut, 404);
  // Un type de la team, rendu « staff » ensuite : la visibilité suit le type.
  const type = (await b.appel(`/teams/${teamId}/resumes/types`, { methode: 'POST', jeton: sessions.max12345, corps: { nom: 'Débrief coachs', couleur: '#123456' } })).corps;
  assert.equal(type.visibilite, 'team');
  const debrief = (await deposer(b, teamId, sessions.max12345, { typeId: type.id, titre: 'Débrief' })).corps.id;
  await b.envoyer(`/teams/${teamId}/resumes/${debrief}/pdf`, { jeton: f, octets: pdf() });
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${debrief}`, { jeton: sessions.lea12345 })).statut, 200);
  await b.appel(`/teams/${teamId}/resumes/types/${type.id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { visibilite: 'staff' } });
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${debrief}`, { jeton: sessions.lea12345 })).statut, 404);
  // Types globaux : seul le Fondateur les modifie.
  assert.equal((await b.appel(`/teams/${teamId}/resumes/types/${HEBDO}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { nom: 'Hebdomadaire' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/types`, { methode: 'POST', jeton: sessions.max12345, corps: { nom: 'Global', global: true } })).statut, 403);
  const types = (await b.appel(`/teams/${teamId}/resumes/types`, { jeton: sessions.lea12345 })).corps.types;
  assert.ok(types.some(t => t.global && t.nom === 'Staff' && t.visibilite === 'staff'));
  assert.ok(types.some(t => !t.global && t.nom === 'Débrief coachs'));
});

test('boîte de réception : filtres (statut, team, type, dates, déposant) et tris', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team A', membres: { lea12345: MEMBRES.lea12345, kai12345: MEMBRES.kai12345 } });
  const B = await teamAvecMembres(b, { nom: 'Team B', membres: { lea12345: MEMBRES.lea12345 } });
  const f = A.sessions.fondateur;
  const lea = A.sessions.lea12345;
  await deposer(b, A.teamId, lea, { titre: 'A1', dateReunion: '2026-10-01' });
  b.horloge.t += 1000;
  await deposer(b, A.teamId, A.sessions.kai12345, { titre: 'A2', dateReunion: '2026-10-10', typeId: STAFF });
  b.horloge.t += 1000;
  const b1 = (await deposer(b, B.teamId, lea, { titre: 'B1', dateReunion: '2026-10-05' })).corps.id;
  await b.appel(`/teams/${B.teamId}/resumes/${b1}`, { methode: 'PATCH', jeton: f, corps: { statut: 'en_cours' } });
  const titres = async q => (await b.appel(`/resumes/boite${q}`, { jeton: f })).corps.depots.map(d => d.titre);
  assert.deepEqual(await titres(''), ['B1', 'A2', 'A1']);
  assert.deepEqual(await titres('?tri=ancien'), ['A1', 'A2', 'B1']);
  assert.deepEqual(await titres('?tri=date'), ['A2', 'B1', 'A1']);
  assert.deepEqual(await titres('?tri=statut'), ['A1', 'A2', 'B1']);
  assert.deepEqual(await titres('?statut=en_cours'), ['B1']);
  assert.deepEqual(await titres(`?team=${A.teamId}`), ['A2', 'A1']);
  assert.deepEqual(await titres(`?type=${STAFF}`), ['A2']);
  assert.deepEqual(await titres('?du=2026-10-02&au=2026-10-09'), ['B1']);
  assert.deepEqual(await titres('?deposePar=lea12345'), ['B1', 'A1']);
  const boite = (await b.appel('/resumes/boite', { jeton: f })).corps;
  assert.equal(boite.attente, 3);
  assert.deepEqual(boite.deposants.map(d => d.pseudo).sort(), ['Kai', 'Léa']);
  assert.equal((await b.appel('/resumes/boite?statut=perdu', { jeton: f })).statut, 400);
  // Historique de ses dépôts, par team.
  const miens = (await b.appel(`/teams/${A.teamId}/resumes/miens`, { jeton: lea })).corps.depots;
  assert.deepEqual(miens.map(d => [d.titre, d.statut]), [['A1', 'a_resumer']]);
});

test('notifications : chaque dépôt prévient les rédacteurs ; la publication prévient le déposant', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const id = (await deposer(b, teamId, sessions.lea12345, { titre: 'Revue du scrim' })).corps.id;
  const types = async jeton => (await b.appel('/notifications', { jeton })).corps.liste.map(n => n.type);
  assert.ok((await types(sessions.fondateur)).includes('resume-depose'), 'Fondateur prévenu');
  assert.ok((await types(sessions.max12345)).includes('resume-depose'), 'Manager (rédacteur) prévenu');
  assert.ok(!(await types(sessions.coach123)).includes('resume-depose'), 'pas le Coach');
  assert.ok(!(await types(sessions.lea12345)).includes('resume-depose'), 'pas le déposant');
  await b.envoyer(`/teams/${teamId}/resumes/${id}/pdf`, { jeton: sessions.max12345, octets: pdf() });
  const n = (await b.appel('/notifications', { jeton: sessions.lea12345 })).corps;
  const publie = n.liste.find(x => x.type === 'resume-publie');
  assert.ok(publie);
  assert.equal(publie.charge.titre, 'Revue du scrim');
  assert.equal(publie.charge.reunion, id);
  // Idempotent : une seconde distribution ne double rien.
  await distribuer(b.base, { maintenant: b.horloge.t });
  assert.equal((await b.appel('/notifications', { jeton: sessions.lea12345 })).corps.liste.filter(x => x.type === 'resume-publie').length, 1);
});

test('suppression d’un dépôt : le déposant tant qu’il n’est pas pris en charge ; ensuite un rédacteur', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: MEMBRES.lea12345 } });
  const a = (await deposer(b, teamId, sessions.lea12345)).corps.id;
  const c = (await deposer(b, teamId, sessions.lea12345)).corps.id;
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${a}`, { methode: 'DELETE', jeton: sessions.lea12345 })).statut, 200);
  await b.appel(`/teams/${teamId}/resumes/${c}`, { methode: 'PATCH', jeton: sessions.fondateur, corps: { statut: 'en_cours' } });
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${c}`, { methode: 'DELETE', jeton: sessions.lea12345 })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/${c}`, { methode: 'DELETE', jeton: sessions.fondateur })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/resumes/miens`, { jeton: sessions.lea12345 })).corps.depots.length, 0);
});

test('migration 0003 : les rôles système des teams existantes reçoivent les nouvelles permissions', async () => {
  const base = await baseSqlite();
  const migrations = lireMigrations();
  await appliquerMigrations(base, migrations.filter(m => m.nom < '0003'));
  const d = '2026-01-01T00:00:00.000Z';
  await base.executer("INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES ('t', 'T', 't', 'valorant', 'principal', ?, ?)", [d, d]);
  for (const cle of ['manager', 'coach', 'joueur']) {
    await base.executer('INSERT INTO roles (id, team_id, cle_systeme, nom, couleur, systeme, position, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)', [cle, 't', cle, cle, '#000000', d, d]);
  }
  await appliquerMigrations(base, migrations);
  const perms = async role => (await base.tous('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission', [role])).map(l => l.permission);
  assert.deepEqual(await perms('manager'), ['meeting_summaries.view_staff', 'meeting_summaries.write_summary', 'scouting.view', 'video_review.react', 'video_review.view']); // + 0005 : review et scouting ; 0010 : réactions
  assert.deepEqual(await perms('joueur'), ['video_review.annotate', 'video_review.react', 'video_review.view']); // 0005 : le Joueur commente la review ; 0010 : il réagit
  assert.deepEqual((await perms('coach')).filter(p => p.startsWith('meeting_summaries.')), ['meeting_summaries.view_staff']);
  assert.equal((await base.tous('SELECT id FROM types_reunion WHERE team_id IS NULL', [])).length, 5);
});
