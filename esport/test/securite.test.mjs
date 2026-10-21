/**
 * Revue de sécurité (phase 7) : tests NÉGATIFS, un par point de la revue
 * (docs/esport/securite.md).
 *
 *  1. Contrôle d'accès sur TOUTES les routes, parcourues automatiquement :
 *     sans session (401), membre d'une autre team (404), membre suspendu (403),
 *     module désactivé (404), et l'ORDRE des contrôles (authentification →
 *     appartenance → module → permission).
 *  2. Anti-escalade ; invitations (empreinte, expiration, force brute).
 *  3. Limites de débit : session, profil, création de team, invitations.
 *  4. Fichiers : type, taille, octets magiques, liens signés (falsifiés,
 *     expirés, membre retiré).
 *  5. Secrets (webhook Discord) jamais renvoyés ni journalisés.
 *  6. XSS (notes, Markdown, page de partage), CSRF (type de contenu), en-têtes.
 *  7. Injection SQL (code et entrées), fuites dans le journal et vers Discord.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITES } from '../noyau/limites.mjs';
import { banc, teamAvecMembres } from './aide.mjs';
import { texteCharge } from '../noyau/discord/messages.mjs';
import { URL_TEST } from './discord-aide.mjs';
import { ASCENT } from './strats-aide.mjs';

const UUID = '0b0b0b0b-1111-4222-8333-444455556666';

/**
 * Toutes les routes de team (méthode, chemin à partir de /teams/:t, module requis ou null).
 * Tenue à jour à la main : le test « couverture » ci-dessous vérifie que chaque section
 * routée par le serveur y figure.
 */
const ROUTES_TEAM = [
  // Cœur (pas de module).
  ['GET', '', null],
  ['PATCH', '', null],
  ['DELETE', '', null],
  ['PUT', '/modules', null],
  ['GET', '/roles', null],
  ['POST', '/roles', null],
  ['PATCH', `/roles/${UUID}`, null],
  ['DELETE', `/roles/${UUID}`, null],
  ['GET', '/membres', null],
  ['PATCH', `/membres/${UUID}`, null],
  ['DELETE', `/membres/${UUID}`, null],
  ['GET', '/invitations', null],
  ['POST', '/invitations', null],
  ['DELETE', `/invitations/${UUID}`, null],
  ['GET', '/stats', null],
  // Espace utilisé (Paramètres).
  ['GET', '/espace', null],
  ['DELETE', `/espace/${UUID}`, null],
  ['GET', '/m/planning', 'planning'],
  // Journal.
  ['GET', '/journal', 'activity_log'],
  ['GET', '/journal/export.csv', 'activity_log'],
  ['GET', '/journal/reglages', 'activity_log'],
  ['PUT', '/journal/reglages', 'activity_log'],
  // Planning, présence, disponibilités.
  ['GET', '/planning', 'planning'],
  ['POST', '/planning', 'planning'],
  ['GET', '/planning/accueil', 'planning'],
  ['GET', '/planning/reglages', 'planning'],
  ['PUT', '/planning/reglages', 'planning'],
  ['GET', '/planning/export.ics', 'planning'],
  ['GET', '/planning/ical', 'planning'],
  ['POST', '/planning/ical', 'planning'],
  ['DELETE', `/planning/ical/${UUID}`, 'planning'],
  ['GET', `/planning/${UUID}`, 'planning'],
  ['PATCH', `/planning/${UUID}`, 'planning'],
  ['DELETE', `/planning/${UUID}`, 'planning'],
  ['PATCH', `/planning/${UUID}/occurrences/2026-10-21T18:00:00.000Z`, 'planning'],
  ['DELETE', `/planning/${UUID}/occurrences/2026-10-21T18:00:00.000Z`, 'planning'],
  ['PUT', `/planning/${UUID}/occurrences/2026-10-21T18:00:00.000Z/rsvp`, 'attendance'],
  ['GET', `/planning/${UUID}/occurrences/2026-10-21T18:00:00.000Z/presence`, 'attendance'],
  ['PUT', `/planning/${UUID}/occurrences/2026-10-21T18:00:00.000Z/presence`, 'attendance'],
  ['GET', '/presence/stats', 'attendance'],
  ['GET', '/presence/export.csv', 'attendance'],
  ['GET', '/dispos/moi', 'availability'],
  ['PUT', '/dispos/moi/regles', 'availability'],
  ['POST', '/dispos/moi/exceptions', 'availability'],
  ['DELETE', `/dispos/moi/exceptions/${UUID}`, 'availability'],
  ['GET', '/dispos/carte', 'availability'],
  // Résumés de réunions.
  ['GET', '/resumes', 'meeting_summaries'],
  ['POST', '/resumes', 'meeting_summaries'],
  ['GET', '/resumes/miens', 'meeting_summaries'],
  ['GET', '/resumes/types', 'meeting_summaries'],
  ['POST', '/resumes/types', 'meeting_summaries'],
  ['PATCH', `/resumes/types/${UUID}`, 'meeting_summaries'],
  ['DELETE', `/resumes/types/${UUID}`, 'meeting_summaries'],
  ['GET', `/resumes/${UUID}`, 'meeting_summaries'],
  ['PATCH', `/resumes/${UUID}`, 'meeting_summaries'],
  ['DELETE', `/resumes/${UUID}`, 'meeting_summaries'],
  ['POST', `/resumes/${UUID}/vu`, 'meeting_summaries'],
  ['POST', `/resumes/${UUID}/lien`, 'meeting_summaries'],
  ['PUT', `/resumes/${UUID}/pdf`, 'meeting_summaries'],
  // Enregistrements déposés et transcription (migration 0014).
  ['POST', '/resumes/envois', 'meeting_summaries'],
  ['GET', `/resumes/envois/${UUID}`, 'meeting_summaries'],
  ['DELETE', `/resumes/envois/${UUID}`, 'meeting_summaries'],
  ['PUT', `/resumes/envois/${UUID}/morceaux/0`, 'meeting_summaries'],
  ['POST', `/resumes/envois/${UUID}/fin`, 'meeting_summaries'],
  ['POST', `/resumes/${UUID}/enregistrement/lien`, 'meeting_summaries'],
  ['GET', `/resumes/${UUID}/transcription`, 'meeting_summaries'],
  ['PUT', `/resumes/${UUID}/transcription`, 'meeting_summaries'],
  ['POST', `/resumes/${UUID}/transcription/lien`, 'meeting_summaries'],
  ['POST', `/resumes/${UUID}/transcription/externe`, 'meeting_summaries'],
  // Objectifs et tâches.
  ['GET', '/objectifs', 'goals_tasks'],
  ['POST', '/objectifs', 'goals_tasks'],
  ['GET', '/objectifs/export.csv', 'goals_tasks'],
  ['PATCH', `/objectifs/${UUID}`, 'goals_tasks'],
  ['DELETE', `/objectifs/${UUID}`, 'goals_tasks'],
  ['GET', '/taches', 'goals_tasks'],
  ['POST', '/taches', 'goals_tasks'],
  ['GET', '/taches/export.csv', 'goals_tasks'],
  ['PATCH', `/taches/${UUID}`, 'goals_tasks'],
  ['DELETE', `/taches/${UUID}`, 'goals_tasks'],
  // Discord.
  ['GET', '/discord', 'discord'],
  ['PUT', '/discord/webhook', 'discord'],
  ['DELETE', '/discord/webhook', 'discord'],
  ['POST', '/discord/test', 'discord'],
  ['PUT', '/discord/parametres/event_created', 'discord'],
  ['PUT', '/discord/langue', 'discord'],
  // Bot Discord : liaison du serveur, pings, qui est lié.
  ['GET', '/discord/bot', 'discord'],
  ['POST', '/discord/bot/code', 'discord'],
  ['DELETE', '/discord/bot/serveur', 'discord'],
  ['PUT', '/discord/bot/pings/scrim', 'discord'],
  // Review vidéo.
  ['GET', '/review', 'video_review'],
  ['POST', '/review', 'video_review'],
  ['GET', `/review/${UUID}`, 'video_review'],
  ['PATCH', `/review/${UUID}`, 'video_review'],
  ['DELETE', `/review/${UUID}`, 'video_review'],
  ['GET', `/review/${UUID}/export.md`, 'video_review'],
  // Vidéos déposées (migration 0014).
  ['POST', `/review/${UUID}/video/lien`, 'video_review'],
  ['POST', '/review/envois', 'video_review'],
  ['GET', `/review/envois/${UUID}`, 'video_review'],
  ['DELETE', `/review/envois/${UUID}`, 'video_review'],
  ['PUT', `/review/envois/${UUID}/morceaux/0`, 'video_review'],
  ['POST', `/review/envois/${UUID}/fin`, 'video_review'],
  ['POST', `/review/${UUID}/reperes`, 'video_review'],
  ['PATCH', `/review/${UUID}/reperes/${UUID}`, 'video_review'],
  ['DELETE', `/review/${UUID}/reperes/${UUID}`, 'video_review'],
  ['POST', `/review/${UUID}/reperes/${UUID}/commentaires`, 'video_review'],
  ['DELETE', `/review/${UUID}/reperes/${UUID}/commentaires/${UUID}`, 'video_review'],
  // Scouting.
  ['GET', '/scouting/adversaires', 'scouting'],
  ['POST', '/scouting/adversaires', 'scouting'],
  ['GET', `/scouting/adversaires/${UUID}`, 'scouting'],
  ['PATCH', `/scouting/adversaires/${UUID}`, 'scouting'],
  ['DELETE', `/scouting/adversaires/${UUID}`, 'scouting'],
  ...['joueurs', 'tendances', 'vods'].flatMap(x => [
    ['POST', `/scouting/adversaires/${UUID}/${x}`, 'scouting'],
    ['PATCH', `/scouting/adversaires/${UUID}/${x}/${UUID}`, 'scouting'],
    ['DELETE', `/scouting/adversaires/${UUID}/${x}/${UUID}`, 'scouting'],
  ]),
  ['POST', `/scouting/adversaires/${UUID}/vods/${UUID}/review`, 'scouting'],
  // Strats et playbook.
  ['GET', '/strats', 'strat_editor'],
  ['POST', '/strats', 'strat_editor'],
  ['GET', `/strats/${UUID}`, 'strat_editor'],
  ['PUT', `/strats/${UUID}`, 'strat_editor'],
  ['PATCH', `/strats/${UUID}`, 'strat_editor'],
  ['DELETE', `/strats/${UUID}`, 'strat_editor'],
  ['POST', `/strats/${UUID}/dupliquer`, 'strat_editor'],
  ['GET', `/strats/${UUID}/versions`, 'strat_editor'],
  ['GET', `/strats/${UUID}/versions/1`, 'strat_editor'],
  ['GET', `/strats/${UUID}/partages`, 'strat_editor'],
  ['POST', `/strats/${UUID}/partages`, 'strat_editor'],
  ['DELETE', `/strats/${UUID}/partages/${UUID}`, 'strat_editor'],
  ['GET', '/playbook', 'playbook'],
  ['POST', '/playbook', 'playbook'],
  ['PATCH', `/playbook/${UUID}`, 'playbook'],
  ['DELETE', `/playbook/${UUID}`, 'playbook'],
];

/** Routes hors team qui exigent une session. */
const ROUTES_SESSION = [
  ['GET', '/moi'],
  ['PUT', '/moi'],
  ['PUT', '/moi/langue'],
  ['DELETE', '/moi'],
  ['GET', '/moi/export'],
  ['GET', '/notifications'],
  ['POST', '/notifications/lues'],
  ['POST', '/invitations/accepter'],
  ['GET', '/teams'],
  ['POST', '/teams'],
  ['GET', '/resumes/boite'],
  ['GET', '/admin/export'],
  ['POST', '/admin/import'],
  ['GET', '/admin/comptes/lea12345/export'],
  ['DELETE', '/admin/comptes/lea12345'],
];

async function appelRoute(b, teamId, [methode, chemin], jeton) {
  const ecriture = !['GET', 'DELETE'].includes(methode);
  return b.appel(`/teams/${teamId}${chemin}`, { methode, jeton, corps: ecriture ? {} : undefined });
}

/** Banc commun : team A complète (Propriétaire NON super admin, Joueur, Joueur suspendu), team B (autre), team C (aucun module). */
async function preparer(options = {}) {
  const b = await banc(options);
  const A = await teamAvecMembres(b, {
    nom: 'Team Alpha',
    membres: {
      own12345: { pseudo: 'Owner', role: 'proprietaire' },
      max12345: { pseudo: 'Max', role: 'manager' },
      lea12345: { pseudo: 'Léa', role: 'joueur' },
      sus12345: { pseudo: 'Sus', role: 'joueur' },
    },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'proprietaire' } } });
  const C = await teamAvecMembres(b, { nom: 'Team Charlie', preset: 'personnalise', modules: [], membres: { own12345: { pseudo: 'Owner', role: 'proprietaire' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const sus = await b.appel(`/teams/${A.teamId}/membres/${A.membres.sus12345.id}`, { methode: 'PATCH', jeton: A.sessions.own12345, corps: { statut: 'suspendu' } });
  assert.equal(sus.statut, 200, JSON.stringify(sus.corps));
  return { b, A, B, C };
}

// ------------------------------------------------------------------ 1. Contrôle d'accès

test('accès : toute route exige une session (401), même les routes de team', async () => {
  const { b, A } = await preparer();
  for (const r of ROUTES_TEAM) {
    const rep = await appelRoute(b, A.teamId, r, undefined);
    assert.equal(rep.statut, 401, `${r[0]} ${r[1]} : ${rep.statut} ${JSON.stringify(rep.corps)}`);
    assert.equal(rep.corps.code, 'session');
    const falsifiee = await appelRoute(b, A.teamId, r, `${A.sessions.lea12345.slice(0, -4)}AAAA`);
    assert.equal(falsifiee.statut, 401, `session falsifiée : ${r[0]} ${r[1]}`);
  }
  for (const [methode, chemin] of ROUTES_SESSION) {
    const rep = await b.appel(chemin, { methode, corps: ['POST', 'PUT'].includes(methode) ? {} : undefined });
    assert.equal(rep.statut, 401, `${methode} ${chemin}`);
  }
});

test('accès : un membre d’une AUTRE team reçoit 404 partout (la team n’existe pas pour lui)', async () => {
  const { b, A } = await preparer();
  // Bob est Propriétaire de la team B : il a toutes les permissions… chez lui.
  const bob = (await teamAvecMembres(b, { nom: 'Team Delta', membres: { bob12345: { pseudo: 'Bob', role: 'proprietaire' } } })).sessions.bob12345;
  for (const r of ROUTES_TEAM) {
    const rep = await appelRoute(b, A.teamId, r, bob);
    assert.equal(rep.statut, 404, `${r[0]} ${r[1]} : ${rep.statut} ${JSON.stringify(rep.corps)}`);
    assert.equal(rep.corps.code, 'team-introuvable', `${r[0]} ${r[1]} : ${rep.corps.code}`);
  }
});

test('accès : un membre SUSPENDU reçoit 403 « suspendu » partout', async () => {
  const { b, A } = await preparer();
  for (const r of ROUTES_TEAM) {
    const rep = await appelRoute(b, A.teamId, r, A.sessions.sus12345);
    assert.equal(rep.statut, 403, `${r[0]} ${r[1]} : ${rep.statut} ${JSON.stringify(rep.corps)}`);
    assert.equal(rep.corps.code, 'suspendu', `${r[0]} ${r[1]}`);
  }
  // Ni l'agenda iCal, ni la boîte des résumés ne contournent la suspension.
  const boite = await b.appel('/resumes/boite', { jeton: A.sessions.sus12345 });
  assert.ok(boite.corps.teams.every(t => t.id !== A.teamId));
});

test('accès : module désactivé → 404 « module-desactive » pour le Propriétaire lui-même, sur toutes les routes du module', async () => {
  const { b, C } = await preparer();
  for (const r of ROUTES_TEAM.filter(x => x[2])) {
    const rep = await appelRoute(b, C.teamId, r, C.sessions.own12345);
    assert.equal(rep.statut, 404, `${r[0]} ${r[1]} : ${rep.statut} ${JSON.stringify(rep.corps)}`);
    assert.equal(rep.corps.code, 'module-desactive', `${r[0]} ${r[1]} : ${rep.corps.code}`);
  }
  // Le cœur, lui, reste ouvert.
  assert.equal((await b.appel(`/teams/${C.teamId}`, { jeton: C.sessions.own12345 })).statut, 200);
});

test('accès : ordre des contrôles authentification → appartenance → module → permission', async () => {
  const { b, A, C } = await preparer();
  const bob = (await teamAvecMembres(b, { nom: 'Team Echo', membres: { bob12345: { pseudo: 'Bob', role: 'proprietaire' } } })).sessions.bob12345;
  // Module désactivé ET pas membre : on ne révèle même pas l'état des modules.
  assert.equal((await b.appel(`/teams/${C.teamId}/discord`, { jeton: bob })).corps.code, 'team-introuvable');
  // Membre sans la permission, module désactivé : le module d'abord.
  assert.equal((await b.appel(`/teams/${C.teamId}/discord`, { jeton: C.sessions.lea12345 })).corps.code, 'module-desactive');
  // Module activé, permission absente : 403.
  const r = await b.appel(`/teams/${A.teamId}/discord`, { jeton: A.sessions.lea12345 });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'permission');
  // Session absente avant tout (même pour une team inexistante).
  assert.equal((await b.appel(`/teams/${UUID}/discord`)).statut, 401);
});

test('accès : couverture — chaque section de team routée par le serveur est parcourue', () => {
  const dossier = fileURLToPath(new URL('../noyau/', import.meta.url));
  const sources = [];
  const lire = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) lire(p);
      else if (n.endsWith('.mjs')) sources.push(readFileSync(p, 'utf8'));
    }
  };
  lire(dossier);
  const texte = sources.join('\n');
  const sections = new Set(ROUTES_TEAM.flatMap(([, c]) => c.split('/').filter(x => /^[a-z]+$/.test(x))));
  // Sections nommées dans les routeurs : « section === 'x' » et les alternatives des expressions de route.
  const citees = new Set([...texte.matchAll(/section === '([a-z]+)'/g)].map(m => m[1]));
  for (const m of texte.matchAll(/\\\/teams\\\/\(\[\^\/\]\+\)\\\/\(([a-z|]+)\)/g)) for (const s of m[1].split('|')) citees.add(s);
  citees.add('discord');
  for (const s of citees) assert.ok(sections.has(s), `section « ${s} » absente du parcours`);
});

test('accès : routes du Fondateur (export de la base, RGPD d’un membre) refusées aux autres', async () => {
  const { b, A } = await preparer();
  for (const [methode, chemin] of [['GET', '/admin/export'], ['POST', '/admin/import'], ['GET', '/admin/comptes/lea12345/export'], ['DELETE', '/admin/comptes/lea12345']]) {
    const r = await b.appel(chemin, { methode, jeton: A.sessions.own12345, corps: methode === 'POST' ? {} : undefined });
    assert.equal(r.statut, 403, `${methode} ${chemin}`);
    assert.equal(r.corps.code, 'super-admin');
  }
});

// ------------------------------------------------------------------ 2. Anti-escalade et invitations

test('anti-escalade : le Manager ne crée pas de rôle plus fort que le sien, n’attribue pas Propriétaire, ne promeut pas', async () => {
  const { b, A } = await preparer();
  const max = A.sessions.max12345;
  const role = await b.appel(`/teams/${A.teamId}/roles`, { methode: 'POST', jeton: max, corps: { nom: 'Super', couleur: '#123456', permissions: ['team.delete'] } });
  assert.equal(role.statut, 403);
  assert.equal(role.corps.code, 'escalade');
  assert.deepEqual(role.corps.details.manquantes, ['team.delete']);
  const promo = await b.appel(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, { methode: 'PATCH', jeton: max, corps: { roleId: A.roles.proprietaire.id } });
  assert.equal(promo.statut, 403);
  const inv = await b.appel(`/teams/${A.teamId}/membres`, { methode: 'POST', jeton: max, corps: { compte: 'lea12345', roleId: A.roles.proprietaire.id } });
  assert.equal(inv.statut, 403);
  assert.equal(inv.corps.code, 'escalade');
  // Invitation directe (création de compte) : réservée au Fondateur.
  const creation = await b.appel('/comptes', { methode: 'POST', jeton: max, corps: { compte: 'neo12345', pseudo: 'Neo', discordId: '612345678901234567', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  assert.equal(creation.statut, 403);
  // Il ne touche pas non plus au Propriétaire.
  assert.equal((await b.appel(`/teams/${A.teamId}/membres/${A.membres.own12345.id}`, { methode: 'DELETE', jeton: max })).statut, 403);
  // Un Joueur ne se donne rien.
  assert.equal((await b.appel(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, { methode: 'PATCH', jeton: A.sessions.lea12345, corps: { roleId: A.roles.manager.id } })).statut, 403);
});

test('codes d’invitation esp_ retirés : ni création ni acceptation (410), rien n’est écrit', async () => {
  const { b, A } = await preparer();
  const own = A.sessions.own12345;
  const inv = await b.appel(`/teams/${A.teamId}/invitations`, { methode: 'POST', jeton: own, corps: { roleId: A.roles.joueur.id, joursValidite: 1 } });
  assert.equal(inv.statut, 410);
  assert.equal(inv.corps.code, 'codes-retires');
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM invitations', [])).n), 0);
  const tim = await b.session('tim12345', 'Tim');
  for (let i = 0; i < 3; i++) {
    const r = await b.appel('/invitations/accepter', { methode: 'POST', jeton: tim, corps: { code: `esp_${'x'.repeat(31)}${i}` } });
    assert.equal(r.statut, 410);
  }
  assert.equal(await b.base.premier("SELECT id FROM membres WHERE compte_id = 'tim12345'", []), null);
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM tentatives', [])).n), 0);
});

// ------------------------------------------------------------------ 3. Limites de débit

test('limites de débit : ouverture de session (par IP), profil, création de team et d’invitations', async () => {
  const b = await banc({ creationTeams: 'tous' });
  const jeton = await b.jetonDeProfil('ray12345');
  const ip = '203.0.113.9';
  let r;
  for (let i = 0; i <= LIMITES.session.max; i++) r = await b.appel('/session', { methode: 'POST', jeton, ip });
  assert.equal(r.statut, 429);
  assert.equal(r.corps.code, 'trop-de-requetes');
  assert.ok(Number(r.entetes.get('Retry-After')) > 0);
  // Une autre IP n'est pas gênée ; la fenêtre passée, tout repart.
  assert.equal((await b.appel('/session', { methode: 'POST', jeton, ip: '203.0.113.10' })).statut, 200);
  b.horloge.t += LIMITES.session.fenetreS * 1000;
  assert.equal((await b.appel('/session', { methode: 'POST', jeton, ip })).statut, 200);

  // Profil (« création de compte ») : par compte.
  const s = await b.session('ray12345');
  for (let i = 0; i < LIMITES.profil.max; i++) assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: `Ray${i}` } })).statut, 200);
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: s, corps: { pseudo: 'RayZ' } })).statut, 429);

  // Création de team : par compte.
  for (let i = 0; i < LIMITES.team.max; i++) assert.equal((await b.appel('/teams', { methode: 'POST', jeton: s, corps: { nom: `Team ${i}`, preset: 'minimal' } })).statut, 200);
  const trop = await b.appel('/teams', { methode: 'POST', jeton: s, corps: { nom: 'Team de trop', preset: 'minimal' } });
  assert.equal(trop.statut, 429);

  // Invitations : par compte.
  const teamId = (await b.appel('/teams', { jeton: s })).corps.teams[0].id;
  const roles = (await b.appel(`/teams/${teamId}/roles`, { jeton: s })).corps.roles;
  const joueur = roles.find(x => x.cle === 'joueur').id;
  let derniere;
  for (let i = 0; i <= LIMITES.invitation.max; i++) derniere = await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: s, corps: { roleId: joueur } });
  assert.equal(derniere.statut, 429);
});

// ------------------------------------------------------------------ 4. Fichiers

test('fichiers : type, taille, octets magiques ; lien signé falsifié, expiré, ou d’un membre retiré entre-temps', async () => {
  const { b, A } = await preparer();
  const lea = A.sessions.lea12345;
  const own = A.sessions.own12345;
  const types = (await b.appel(`/teams/${A.teamId}/resumes/types`, { jeton: lea })).corps.types;
  const depot = await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: lea, corps: { lien: 'https://exemple.fr/rec', typeId: types[0].id, dateReunion: '2026-10-19', titre: 'Hebdo' } });
  assert.equal(depot.statut, 200, JSON.stringify(depot.corps));
  const pdf = `/teams/${A.teamId}/resumes/${depot.corps.id}/pdf`;
  const vrai = new Uint8Array([...new TextEncoder().encode('%PDF-1.7\n'), ...new Uint8Array(64)]);
  assert.equal((await b.envoyer(pdf, { jeton: own, octets: vrai, type: 'text/html' })).statut, 415);
  assert.equal((await b.envoyer(pdf, { jeton: own, octets: new TextEncoder().encode('<html><script>alert(1)</script>'), type: 'application/pdf' })).statut, 415);
  assert.equal((await b.envoyer(pdf, { jeton: own, octets: vrai, entetes: { 'Content-Length': String(30 * 1024 * 1024) } })).statut, 413);
  const ok = await b.envoyer(pdf, { jeton: own, octets: vrai, nom: '../../etc/passwd' });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  // Nom de stockage aléatoire, jamais le nom d'origine.
  const f = await b.base.premier('SELECT * FROM fichiers WHERE entite_id = ?', [depot.corps.id]);
  assert.match(f.cle_stockage, /^teams\/[0-9a-f-]{36}\/resumes\/[0-9a-f-]{36}\.pdf$/);
  assert.ok(!f.nom_original.includes('/'));
  const lien = (await b.appel(`/teams/${A.teamId}/resumes/${depot.corps.id}/lien`, { methode: 'POST', jeton: lea, corps: {} })).corps.url;
  const bon = await b.brut(lien);
  assert.equal(bon.status, 200);
  assert.equal(bon.headers.get('Content-Type'), 'application/pdf');
  assert.equal(bon.headers.get('X-Content-Type-Options'), 'nosniff');
  // Falsifié : autre compte, autre date, signature changée.
  assert.equal((await b.brut(lien.replace('c=lea12345', 'c=bob12345'))).status, 403);
  assert.equal((await b.brut(lien.replace(/exp=(\d+)/, (m, n) => `exp=${Number(n) + 3_600_000}`))).status, 403);
  assert.equal((await b.brut(lien.replace(/sig=[^&]+/, 'sig=AAAA'))).status, 403);
  // Membre retiré pendant la validité du lien : refusé.
  assert.equal((await b.appel(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, { methode: 'DELETE', jeton: own })).statut, 200);
  assert.equal((await b.brut(lien)).status, 403);
  // Expiré.
  const lienOwner = (await b.appel(`/teams/${A.teamId}/resumes/${depot.corps.id}/lien`, { methode: 'POST', jeton: own, corps: {} })).corps.url;
  b.horloge.t += 10 * 60_000;
  assert.equal((await b.brut(lienOwner)).status, 410);
});

// ------------------------------------------------------------------ 5. Secrets

test('secrets : l’adresse du webhook Discord est chiffrée au repos et n’est renvoyée nulle part', async () => {
  const { b, A } = await preparer({ fetchDiscord: async () => new Response(null, { status: 204 }) });
  const own = A.sessions.own12345;
  assert.equal((await b.appel(`/teams/${A.teamId}/discord/webhook`, { methode: 'PUT', jeton: own, corps: { url: URL_TEST } })).statut, 200);
  const jetonWebhook = URL_TEST.split('/').pop();
  const lignes = JSON.stringify(await b.base.tous('SELECT * FROM discord_webhooks', []));
  assert.ok(!lignes.includes(jetonWebhook), 'chiffré au repos');
  const reponses = [
    await b.appel(`/teams/${A.teamId}/discord`, { jeton: own }),
    await b.appel(`/teams/${A.teamId}/journal`, { jeton: own }),
    await b.appel(`/teams/${A.teamId}/journal/export.csv?format=json`, { jeton: own }),
    await b.appel('/moi/export', { jeton: own }),
    await b.appel('/admin/export', { jeton: A.sessions.fondateur }),
    await b.appel(`/teams/${A.teamId}`, { jeton: own }),
  ];
  for (const r of reponses) {
    assert.equal(r.statut, 200);
    assert.ok(!JSON.stringify(r.corps).includes(jetonWebhook), 'jamais renvoyé');
  }
  assert.ok(!JSON.stringify(await b.base.tous('SELECT * FROM journal', [])).includes(jetonWebhook), 'jamais journalisé');
  assert.ok(!JSON.stringify(await b.base.tous('SELECT * FROM evenements', [])).includes(jetonWebhook), 'jamais dans le bus');
  // La session n'est jamais écrite en base.
  assert.ok(!JSON.stringify(await b.base.tous('SELECT * FROM journal', [])).includes(own));
});

// ------------------------------------------------------------------ 6. XSS, CSRF, en-têtes

test('XSS : notes de review nettoyées, Markdown sûr, page publique de partage échappée et sans script', async () => {
  const { b, A } = await preparer();
  const own = A.sessions.own12345;
  const charge = '<img src=x onerror=alert(1)><script>alert(2)</script>[clic](javascript:alert(3))';
  const review = await b.appel(`/teams/${A.teamId}/review`, { methode: 'POST', jeton: own, corps: { titre: 'VOD', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
  assert.equal(review.statut, 200, JSON.stringify(review.corps));
  const repere = await b.appel(`/teams/${A.teamId}/review/${review.corps.id}/reperes`, { methode: 'POST', jeton: own, corps: { debut: 12, categorie: 'erreur', titre: 'Peek', note: charge } });
  assert.equal(repere.statut, 200, JSON.stringify(repere.corps));
  const note = repere.corps.note;
  assert.ok(!/<[a-z]/i.test(note), note);
  assert.ok(!note.includes('javascript:'), note);
  const md = await b.appel(`/teams/${A.teamId}/review/${review.corps.id}/export.md`, { jeton: own });
  assert.ok(!/<script|<img|javascript:/i.test(md.corps), 'export Markdown sûr');
  assert.match(md.entetes.get('Content-Security-Policy'), /sandbox/);
  // Page publique d'une strat : titre et notes échappés, CSP sans script.
  const strat = await b.appel(`/teams/${A.teamId}/strats`, { methode: 'POST', jeton: own, corps: { titre: '<script>alert(1)</script>', notes: '"><img src=x onerror=alert(1)>', type: 'execute', carte: ASCENT, side: 'attaque' } });
  assert.equal(strat.statut, 200, JSON.stringify(strat.corps));
  const partage = await b.appel(`/teams/${A.teamId}/strats/${strat.corps.id}/partages`, { methode: 'POST', jeton: own, corps: {} });
  const page = await b.brut(partage.corps.url);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(!html.includes('<script>alert'), 'titre échappé');
  assert.ok(!html.includes('<img src=x'), 'notes échappées');
  const csp = page.headers.get('Content-Security-Policy');
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  assert.equal(page.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(page.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(page.headers.get('Strict-Transport-Security'));
});

test('CSRF : un corps qui n’est pas annoncé JSON est refusé (415) ; aucun cookie, CORS sans identifiants', async () => {
  const { b, A } = await preparer();
  const r = await b.appel('/sante');
  assert.equal(r.entetes.get('Set-Cookie'), null);
  assert.equal(r.entetes.get('Access-Control-Allow-Credentials'), null);
  // Formulaire HTML ou fetch « simple » d'un site tiers, même avec une session volée en paramètre : rien ne passe.
  const { creerApi } = await import('../noyau/api.mjs');
  assert.ok(creerApi);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
    const rep = await b.appel(`/teams/${A.teamId}/taches`, { methode: 'POST', jeton: A.sessions.own12345, corps: { titre: 'Piège' }, type });
    assert.equal(rep.statut, 415, type);
    assert.equal(rep.corps.code, 'type-contenu');
  }
  assert.equal((await b.appel(`/teams/${A.teamId}/taches`, { jeton: A.sessions.own12345 })).corps.taches.length, 0);
});

test('en-têtes de sécurité : JSON, fichiers (CSV, iCal), erreurs', async () => {
  const { b, A } = await preparer();
  const verifier = (h, quoi) => {
    assert.equal(h.get('X-Content-Type-Options'), 'nosniff', quoi);
    assert.equal(h.get('X-Frame-Options'), 'DENY', quoi);
    assert.equal(h.get('Referrer-Policy'), 'no-referrer', quoi);
    assert.match(h.get('Strict-Transport-Security') ?? '', /max-age=\d+/, quoi);
    assert.match(h.get('Content-Security-Policy') ?? '', /default-src 'none'/, quoi);
    assert.match(h.get('Cache-Control') ?? '', /no-store/, quoi);
  };
  verifier((await b.appel('/sante')).entetes, 'santé');
  verifier((await b.appel('/inconnu', { jeton: A.sessions.own12345 })).entetes, 'erreur 404');
  verifier((await b.appel(`/teams/${A.teamId}/presence/export.csv`, { jeton: A.sessions.own12345 })).entetes, 'CSV');
  verifier((await b.appel(`/teams/${A.teamId}/planning/export.ics`, { jeton: A.sessions.own12345 })).entetes, 'iCal');
  verifier((await b.appel(`/teams/${A.teamId}/journal/export.csv`, { jeton: A.sessions.own12345 })).entetes, 'journal CSV');
});

// ------------------------------------------------------------------ 7. Injection SQL, fuites

test('injection SQL : aucune valeur interpolée dans le SQL (seulement des noms de colonnes ou des « ? » fixés par le code)', () => {
  const dossier = fileURLToPath(new URL('../noyau/', import.meta.url));
  // Expressions autorisées dans un gabarit SQL : listes de colonnes validées, conditions et marqueurs « ? » construits par le code.
  const AUTORISEES = [
    /^champs\.map\(c => `\$\{c\} = \?`\)\.join\(', '\)$/,
    /^cols\.map\(c => `\$\{c\} = \?`\)\.join\(', '\)$/,
    /^colonnes\.map\(c => `\$\{c\} = \?`\)\.join\(', '\)$/,
    /^champs\.map\(c => `, \$\{c\} = \?`\)\.join\(''\)$/,
    /^(conditions|condition)(\.join\(' AND '\))?$/,
    /^[a-z]+\.map\(\(\) => '\?'\)\.join\(', '\)$/i,
    /^(def\.table|table|ordre|extra|avant|apres|sql|prefixes\.map\(\(\) => 'action LIKE \?'\)\.join\(' OR '\)|colonnes\.join\(', '\))$/,
    /^p\.map\(\(\) => '\?'\)\.join\(', '\)$/,
    // Fragment constant choisi par le code (ternaire entre deux textes fixes).
    /^[a-zA-Z]+ \? '[^'$`]*' : '[^'$`]*'$/,
  ];
  const trouvees = [];
  const lire = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) lire(p);
      else if (n.endsWith('.mjs')) {
        const texte = readFileSync(p, 'utf8');
        for (const m of texte.matchAll(/`((?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/g)) {
          for (const x of m[1].matchAll(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
            if (!AUTORISEES.some(r => r.test(x[1].trim()))) trouvees.push(`${n} : \${${x[1]}}`);
          }
        }
      }
    }
  };
  lire(dossier);
  assert.deepEqual(trouvees, []);
});

test('injection SQL : les filtres hostiles sont refusés ou traités comme du texte (jamais d’erreur 500)', async () => {
  const { b, A } = await preparer();
  const own = A.sessions.own12345;
  const hostile = encodeURIComponent("x' OR '1'='1' --");
  for (const chemin of [
    `/teams/${A.teamId}/journal?action=${hostile}`,
    `/teams/${A.teamId}/journal?acteur=${hostile}`,
    `/teams/${A.teamId}/journal?module=${hostile}`,
    `/teams/${A.teamId}/journal?du=${hostile}`,
    `/teams/${A.teamId}/taches?assigne=${hostile}`,
    `/teams/${A.teamId}/taches?statut=${hostile}`,
    `/teams/${A.teamId}/strats?q=${hostile}`,
    `/teams/${A.teamId}/playbook?q=${hostile}&tag=${hostile}`,
    `/resumes/boite?deposePar=${hostile}`,
    `/teams/${encodeURIComponent("' OR 1=1 --")}`,
  ]) {
    const r = await b.appel(chemin, { jeton: own });
    assert.ok([200, 400, 404].includes(r.statut), `${chemin} : ${r.statut}`);
    if (r.statut === 200 && Array.isArray(r.corps.strats)) assert.equal(r.corps.strats.length, 0);
  }
  // Les tables sont intactes.
  assert.ok((await b.base.premier('SELECT COUNT(*) AS n FROM teams', [])).n >= 3);
});

test('fuites : rien de sensible dans le journal ni vers Discord (réunion staff, strat privée)', async () => {
  const envois = [];
  const { b, A } = await preparer({ fetchDiscord: async (url, init) => (envois.push(texteCharge(JSON.parse(init.body))), new Response(null, { status: 204 })) });
  const own = A.sessions.own12345;
  await b.appel(`/teams/${A.teamId}/discord/webhook`, { methode: 'PUT', jeton: own, corps: { url: URL_TEST } });
  for (const cle of ['summary_submitted', 'strat_created']) await b.appel(`/teams/${A.teamId}/discord/parametres/${cle}`, { methode: 'PUT', jeton: own, corps: { actif: true } });
  envois.length = 0;
  // Réunion d'un type « staff » : son titre ne part pas sur le salon de la team.
  const types = (await b.appel(`/teams/${A.teamId}/resumes/types`, { jeton: own })).corps.types;
  const staff = types.find(t => t.visibilite === 'staff');
  const publique = types.find(t => t.visibilite === 'team');
  await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: own, corps: { lien: 'https://exemple.fr/r1', typeId: staff.id, dateReunion: '2026-10-19', titre: 'Recrutement confidentiel' } });
  await b.appel(`/teams/${A.teamId}/resumes`, { methode: 'POST', jeton: own, corps: { lien: 'https://exemple.fr/r2', typeId: publique.id, dateReunion: '2026-10-19', titre: 'Hebdo ouverte' } });
  // Strat privée : jamais annoncée ; strat de team : annoncée.
  await b.appel(`/teams/${A.teamId}/strats`, { methode: 'POST', jeton: own, corps: { titre: 'Brouillon secret', type: 'execute', carte: ASCENT, side: 'attaque', visibilite: 'privee' } });
  await b.appel(`/teams/${A.teamId}/strats`, { methode: 'POST', jeton: own, corps: { titre: 'Exec publique', type: 'execute', carte: ASCENT, side: 'attaque' } });
  const tout = envois.join('\n');
  assert.ok(!tout.includes('Recrutement confidentiel'), tout);
  assert.ok(!tout.includes('Brouillon secret'), tout);
  assert.ok(tout.includes('Hebdo ouverte'), tout);
  assert.ok(tout.includes('Exec publique'), tout);
  // Journal : ni session, ni code, ni adresse de webhook, ni IP.
  const journal = JSON.stringify(await b.base.tous('SELECT * FROM journal', []));
  for (const secret of [own, URL_TEST, 'es1.', 'esp_']) assert.ok(!journal.includes(secret), secret);
  assert.ok((await b.base.tous('SELECT ip FROM journal WHERE ip IS NOT NULL', [])).length === 0);
});
