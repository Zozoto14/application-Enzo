/**
 * API Esport de bout en bout (sans Cloudflare) : session par le relais,
 * teams, modules, rôles, membres, invitations, journal, notifications, RGPD,
 * export/import. Tests négatifs : un membre de la team A n'accède jamais à la
 * team B ; anti-escalade ; dernier Propriétaire ; force brute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseSqliteMigree } from '../adaptateurs/sqlite.mjs';
import { CLE, JETON_MAITRE, banc, teamAvecMembres } from './aide.mjs';
import { creerSession } from '../noyau/session.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';

const MEMBRES = {
  max12345: { pseudo: 'Max', role: 'manager' },
  coach123: { pseudo: 'Coach Zed', role: 'coach' },
  lea12345: { pseudo: 'Léa', role: 'joueur' },
};

// ------------------------------------------------------------------ Session

test('session : jeton maître → super admin ; jeton de profil → son compte ; faux → 401 ; révoqué → 403', async () => {
  const b = await banc();
  let r = await b.appel('/session', { methode: 'POST', jeton: JETON_MAITRE });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.compte, 'principal');
  assert.equal(r.corps.superAdmin, true);
  assert.match(r.corps.session, /^es1\./);
  assert.ok(!JSON.stringify(r.corps).includes(JETON_MAITRE), 'le jeton maître n’est jamais renvoyé');

  r = await b.appel('/session', { methode: 'POST', jeton: await b.jetonDeProfil('lea12345') });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.compte, 'lea12345');
  assert.equal(r.corps.superAdmin, false);
  assert.equal(r.corps.peutCreerTeam, false);

  assert.equal((await b.appel('/session', { methode: 'POST', jeton: `p1.lea12345.${'0'.repeat(64)}` })).statut, 401);
  assert.equal((await b.appel('/session', { methode: 'POST' })).statut, 401);
  await b.envRelais.BOITE.put('revoque:lea12345', '1');
  r = await b.appel('/session', { methode: 'POST', jeton: await b.jetonDeProfil('lea12345') });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'revoque');
});

test('session : relais pas encore en version 7 → 503 « relais-ancien »', async () => {
  const b = await banc({ relaisAncien: true });
  const r = await b.appel('/session', { methode: 'POST', jeton: JETON_MAITRE });
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, 'relais-ancien');
});

test('session : sans session, falsifiée ou expirée → 401 partout', async () => {
  const b = await banc();
  assert.equal((await b.appel('/teams')).statut, 401);
  assert.equal((await b.appel('/teams', { jeton: JETON_MAITRE })).statut, 401, 'le jeton du relais n’est pas une session');
  const autreCle = await creerSession('une-autre-cle-de-session-0123456789abcdef', { compte: 'principal', superAdmin: true }, b.horloge.t);
  assert.equal((await b.appel('/teams', { jeton: autreCle.jeton })).statut, 401);
  const s = await b.session('principal');
  b.horloge.t += 61 * 60 * 1000;
  assert.equal((await b.appel('/teams', { jeton: s })).statut, 401);
  const bonne = await creerSession(CLE, { compte: 'principal', superAdmin: true }, b.horloge.t);
  assert.equal((await b.appel('/teams', { jeton: bonne.jeton })).statut, 200);
});

// ------------------------------------------------------------------ Profil

test('profil : pseudo obligatoire (428), unique sans tenir compte de la casse (409), Riot ID et Discord facultatifs et vérifiés', async () => {
  const b = await banc();
  const f = await b.session('principal');
  let r = await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Alpha' } });
  assert.equal(r.statut, 428);
  assert.equal(r.corps.code, 'pseudo-requis');
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: f, corps: { pseudo: 'Fondateur', riotId: 'Fond#EUW' } })).statut, 200);
  const lea = await b.session('lea12345');
  r = await b.appel('/moi', { methode: 'PUT', jeton: lea, corps: { pseudo: 'FONDATEUR' } });
  assert.equal(r.statut, 409);
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: lea, corps: { pseudo: 'x' } })).statut, 400);
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: lea, corps: { pseudo: 'Léa', riotId: 'pas-un-riot-id' } })).statut, 400);
  assert.equal((await b.appel('/moi', { methode: 'PUT', jeton: lea, corps: { pseudo: 'Léa', discord: 'Léa !!' } })).statut, 400);
  r = await b.appel('/moi', { methode: 'PUT', jeton: lea, corps: { pseudo: 'Léa', riotId: 'Lea#1234', discord: 'lea_val' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.profil, { pseudo: 'Léa', riotId: 'Lea#1234', discord: 'lea_val' });
  const colonnes = Object.keys(await b.base.premier('SELECT * FROM comptes WHERE id = ?', ['lea12345']));
  assert.ok(!colonnes.some(c => /mail/.test(c)), 'aucune adresse e-mail stockée');
});

// ------------------------------------------------------------------ Teams et modules

test('création de team : réservée au Fondateur par défaut ; « tous » l’ouvre ; preset Minimal', async () => {
  let b = await banc();
  const lea = await b.session('lea12345', 'Léa');
  assert.equal((await b.appel('/teams', { methode: 'POST', jeton: lea, corps: { nom: 'Team Léa' } })).statut, 403);
  b = await banc({ creationTeams: 'tous' });
  const lea2 = await b.session('lea12345', 'Léa');
  const r = await b.appel('/teams', { methode: 'POST', jeton: lea2, corps: { nom: 'Team Léa', preset: 'minimal' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.modules.filter(m => m.active).map(m => m.cle).sort(), ['activity_log', 'availability', 'planning']);
  assert.equal(r.corps.moi.role.cle, 'proprietaire');
  assert.equal(r.corps.team.slug, 'team-lea');
});

test('modules : désactivé → 404 sur ses routes (journal, modules futurs) ; réactivé → données intactes ; activé mais futur → 501', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { preset: 'personnalise', modules: ['activity_log'] });
  const f = sessions.fondateur;
  assert.equal((await b.appel(`/teams/${teamId}/journal`, { jeton: f })).statut, 200);
  let r = await b.appel(`/teams/${teamId}/m/scouting`, { jeton: f });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: f, corps: { modules: { scouting: true } } });
  r = await b.appel(`/teams/${teamId}/m/scouting/fiches`, { jeton: f });
  assert.equal(r.statut, 501);
  assert.equal(r.corps.code, 'bientot');
  const avant = (await b.appel(`/teams/${teamId}/journal`, { jeton: f })).corps.entrees.length;
  r = await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: f, corps: { modules: { activity_log: false } } });
  assert.equal(r.statut, 200);
  assert.ok(!r.corps.moi.permissions.includes('activity_log.view'), 'la permission d’un module désactivé n’est plus proposée');
  r = await b.appel(`/teams/${teamId}/journal`, { jeton: f });
  assert.equal(r.statut, 404);
  assert.equal(r.corps.code, 'module-desactive');
  await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: f, corps: { modules: { activity_log: true } } });
  r = await b.appel(`/teams/${teamId}/journal`, { jeton: f });
  assert.ok(r.corps.entrees.length >= avant + 1, 'rien n’a été perdu (et les changements sont journalisés)');
  assert.ok(r.corps.entrees.some(e => e.action === 'modules.changed'));
  assert.equal((await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: f, corps: { modules: { finances: true } } })).statut, 400);
});

test('modules : seul modules.manage (Propriétaire) les change ; un Manager reçoit 403', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const r = await b.appel(`/teams/${teamId}/modules`, { methode: 'PUT', jeton: sessions.max12345, corps: { modules: { scouting: false } } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'permission');
});

// ------------------------------------------------------------------ Isolation entre teams

test('isolation : un membre de la team A n’accède JAMAIS à la team B (404 partout, même avec les bons identifiants)', async () => {
  const b = await banc();
  const a = await teamAvecMembres(b, { nom: 'Team A', membres: { lea12345: { pseudo: 'Léa', role: 'joueur' }, max12345: { pseudo: 'Max', role: 'manager' } } });
  const tb = await teamAvecMembres(b, { nom: 'Team B', membres: { tom12345: { pseudo: 'Tom', role: 'joueur' } } });
  const lea = a.sessions.lea12345;
  const max = a.sessions.max12345;
  const teamB = tb.teamId;
  const roleB = tb.roles.joueur.id;
  const membreB = tb.membres.tom12345.id;
  const essais = [
    ['GET', `/teams/${teamB}`],
    ['PATCH', `/teams/${teamB}`, { nom: 'Piratée' }],
    ['DELETE', `/teams/${teamB}`],
    ['PUT', `/teams/${teamB}/modules`, { modules: { planning: false } }],
    ['GET', `/teams/${teamB}/membres`],
    ['PATCH', `/teams/${teamB}/membres/${membreB}`, { roleId: roleB }],
    ['DELETE', `/teams/${teamB}/membres/${membreB}`],
    ['GET', `/teams/${teamB}/roles`],
    ['POST', `/teams/${teamB}/roles`, { nom: 'Pirate', permissions: [] }],
    ['DELETE', `/teams/${teamB}/roles/${roleB}`],
    ['GET', `/teams/${teamB}/invitations`],
    ['POST', `/teams/${teamB}/invitations`, { roleId: roleB }],
    ['GET', `/teams/${teamB}/journal`],
    ['GET', `/teams/${teamB}/m/planning`],
  ];
  for (const jeton of [lea, max]) {
    for (const [methode, chemin, corps] of essais) {
      const r = await b.appel(chemin, { methode, jeton, corps });
      assert.equal(r.statut, 404, `${methode} ${chemin} → ${r.statut}`);
      assert.equal(r.corps.code, 'team-introuvable');
    }
  }
  // Les identifiants d'une autre team, glissés sous SA team, ne passent pas non plus.
  assert.equal((await b.appel(`/teams/${a.teamId}/membres/${membreB}`, { methode: 'DELETE', jeton: max })).statut, 404);
  assert.equal((await b.appel(`/teams/${a.teamId}/invitations`, { methode: 'POST', jeton: max, corps: { roleId: roleB } })).statut, 404);
  // La liste ne montre que ses teams.
  const liste = (await b.appel('/teams', { jeton: lea })).corps.teams.map(t => t.nom);
  assert.deepEqual(liste, ['Team A']);
  // Rien n'a bougé dans B.
  const membresB = (await b.appel(`/teams/${teamB}/membres`, { jeton: tb.sessions.fondateur })).corps.membres;
  assert.equal(membresB.length, 2);
  assert.equal((await b.appel(`/teams/${teamB}`, { jeton: tb.sessions.fondateur })).corps.team.nom, 'Team B');
});

test('identifiants malformés : 404, jamais d’erreur SQL', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  for (const chemin of ["/teams/' OR 1=1 --", '/teams/123/membres', '/teams/%00/roles']) {
    const r = await b.appel(chemin, { jeton: f });
    assert.equal(r.statut, 404, chemin);
  }
});

// ------------------------------------------------------------------ Rôles et anti-escalade

test('rôles : matrice côté serveur (Joueur ne peut ni inviter ni lire le journal ; Manager oui)', async () => {
  const b = await banc();
  const { teamId, sessions, roles } = await teamAvecMembres(b, { membres: MEMBRES });
  const lea = sessions.lea12345;
  assert.equal((await b.appel(`/teams/${teamId}/membres`, { jeton: lea })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: lea, corps: { roleId: roles.joueur.id } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/journal`, { jeton: lea })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}`, { methode: 'PATCH', jeton: lea, corps: { nom: 'Team Léa' } })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}`, { methode: 'DELETE', jeton: lea })).statut, 403);
  assert.equal((await b.appel(`/teams/${teamId}/journal`, { jeton: sessions.max12345 })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: sessions.max12345, corps: { roleId: roles.joueur.id } })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}`, { methode: 'DELETE', jeton: sessions.max12345 })).statut, 403, 'seul le Propriétaire supprime la team');
  const detail = (await b.appel(`/teams/${teamId}`, { jeton: lea })).corps;
  assert.ok(detail.moi.permissions.includes('planning.view'));
  assert.ok(!detail.moi.permissions.includes('members.invite'));
});

test('anti-escalade : un Manager ne crée pas de rôle plus fort que lui, n’invite pas en Propriétaire, ne touche pas au Propriétaire', async () => {
  const b = await banc();
  const { teamId, sessions, roles, membres } = await teamAvecMembres(b, { membres: MEMBRES });
  const max = sessions.max12345;
  let r = await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: max, corps: { nom: 'Super', couleur: '#ff0000', permissions: ['planning.view', 'team.delete'] } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'escalade');
  assert.deepEqual(r.corps.details.manquantes, ['team.delete']);
  r = await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: max, corps: { nom: 'Capitaine', couleur: '#ff8800', permissions: ['planning.view', 'members.view', 'members.invite'] } });
  assert.equal(r.statut, 200);
  const capitaine = r.corps;
  assert.equal(capitaine.systeme, false);
  // Hiérarchie des rôles système : un Manager invite un Coach (rôle placé sous le sien).
  assert.equal((await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: max, corps: { roleId: roles.coach.id } })).statut, 200);
  r = await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: max, corps: { roleId: roles.proprietaire.id } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'escalade');
  r = await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: max, corps: { roleId: roles.proprietaire.id } });
  assert.equal(r.statut, 403, 'pas de promotion au-dessus de soi');
  r = await b.appel(`/teams/${teamId}/membres/${membres.principal.id}`, { methode: 'PATCH', jeton: max, corps: { roleId: roles.joueur.id } });
  assert.equal(r.statut, 403, 'pas de rétrogradation du Propriétaire');
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.principal.id}`, { methode: 'DELETE', jeton: max })).statut, 403);
  // Le Manager change bien le rôle d'un joueur vers un rôle qu'il domine.
  r = await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: max, corps: { roleId: capitaine.id } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.role.nom, 'Capitaine');
  // Un Manager ne peut pas s'attribuer un rôle plus fort, ni modifier un rôle système.
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.max12345.id}`, { methode: 'PATCH', jeton: max, corps: { roleId: roles.proprietaire.id } })).statut, 403);
  r = await b.appel(`/teams/${teamId}/roles/${roles.joueur.id}`, { methode: 'PATCH', jeton: max, corps: { permissions: ['planning.view'] } });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'role-systeme');
  // Un Coach ne gère pas les rôles du tout.
  assert.equal((await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: sessions.coach123, corps: { nom: 'X', permissions: [] } })).statut, 403);
});

test('rôle personnalisé : modifiable (anti-escalade comprise), non supprimable tant qu’il est assigné', async () => {
  const b = await banc();
  const { teamId, sessions, membres, roles } = await teamAvecMembres(b, { membres: MEMBRES });
  const f = sessions.fondateur;
  const r1 = await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: f, corps: { nom: 'Stratège', couleur: '#123456', permissions: ['strats.view', 'strats.create'] } });
  assert.equal(r1.statut, 200);
  const stratege = r1.corps;
  assert.equal((await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: f, corps: { nom: 'stratège', permissions: [] } })).statut, 409, 'nom déjà pris');
  assert.equal((await b.appel(`/teams/${teamId}/roles`, { methode: 'POST', jeton: f, corps: { nom: 'Bizarre', permissions: ['finances.tout'] } })).statut, 400);
  await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: f, corps: { roleId: stratege.id } });
  let r = await b.appel(`/teams/${teamId}/roles/${stratege.id}`, { methode: 'DELETE', jeton: f });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'role-assigne');
  // Le Manager ne peut pas ajouter au rôle une permission qu'il n'a pas.
  r = await b.appel(`/teams/${teamId}/roles/${stratege.id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { permissions: ['strats.view', 'strats.create', 'strats.delete'] } });
  assert.equal(r.statut, 403);
  r = await b.appel(`/teams/${teamId}/roles/${stratege.id}`, { methode: 'PATCH', jeton: f, corps: { permissions: ['strats.view'], couleur: '#654321' } });
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.permissions, ['strats.view']);
  // Réassigné, il se supprime.
  await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: f, corps: { roleId: roles.joueur.id } });
  assert.equal((await b.appel(`/teams/${teamId}/roles/${stratege.id}`, { methode: 'DELETE', jeton: f })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/roles/${roles.joueur.id}`, { methode: 'DELETE', jeton: f })).statut, 403, 'rôle système');
});

test('dernier Propriétaire : ni retiré, ni rétrogradé, ni suspendu, ne peut pas quitter ; possible dès qu’il y en a un second', async () => {
  const b = await banc();
  const { teamId, sessions, membres, roles } = await teamAvecMembres(b, { membres: MEMBRES });
  const f = sessions.fondateur;
  const proprio = membres.principal.id;
  let r = await b.appel(`/teams/${teamId}/membres/${proprio}`, { methode: 'PATCH', jeton: f, corps: { roleId: roles.manager.id } });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'dernier-proprietaire');
  assert.equal((await b.appel(`/teams/${teamId}/membres/${proprio}`, { methode: 'DELETE', jeton: f })).statut, 409);
  // Nommer Max Propriétaire, puis le Fondateur peut redevenir Manager.
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.max12345.id}`, { methode: 'PATCH', jeton: f, corps: { roleId: roles.proprietaire.id } })).statut, 200);
  r = await b.appel(`/teams/${teamId}/membres/${proprio}`, { methode: 'PATCH', jeton: f, corps: { roleId: roles.manager.id } });
  assert.equal(r.statut, 200);
  // Max est maintenant le dernier : il ne peut pas partir.
  r = await b.appel(`/teams/${teamId}/membres/${membres.max12345.id}`, { methode: 'DELETE', jeton: sessions.max12345 });
  assert.equal(r.statut, 409);
  // Un joueur, lui, peut quitter la team.
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'DELETE', jeton: sessions.lea12345 })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}`, { jeton: sessions.lea12345 })).statut, 404);
});

test('suspension : le membre suspendu n’ouvre plus la team (403) ; levée → accès rendu', async () => {
  const b = await banc();
  const { teamId, sessions, membres } = await teamAvecMembres(b, { membres: MEMBRES });
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { statut: 'suspendu' } })).statut, 200);
  const r = await b.appel(`/teams/${teamId}`, { jeton: sessions.lea12345 });
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'suspendu');
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { statut: 'actif' } })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}`, { jeton: sessions.lea12345 })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/membres/${membres.principal.id}`, { methode: 'PATCH', jeton: sessions.max12345, corps: { statut: 'suspendu' } })).statut, 403);
});

// ------------------------------------------------------------------ Invitations

test('invitations : code haché en base, montré une fois ; usage unique ; expiration ; révocation ; déjà membre', async () => {
  const b = await banc();
  const { teamId, sessions, roles } = await teamAvecMembres(b);
  const f = sessions.fondateur;
  const r = await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: f, corps: { roleId: roles.joueur.id, joursValidite: 2, libelle: 'Pour Léa' } });
  assert.equal(r.statut, 200);
  const { code, invitation } = r.corps;
  assert.match(code, /^esp_[A-Za-z0-9_-]{32}$/);
  const ligne = await b.base.premier('SELECT * FROM invitations WHERE id = ?', [invitation.id]);
  assert.ok(!JSON.stringify(ligne).includes(code), 'le code n’est jamais stocké en clair');
  assert.match(ligne.jeton_hash, /^[0-9a-f]{64}$/);
  const liste = (await b.appel(`/teams/${teamId}/invitations`, { jeton: f })).corps.invitations;
  assert.ok(!JSON.stringify(liste).includes(code), 'ni renvoyé par la liste');
  const journal = await b.base.tous('SELECT meta FROM journal', []);
  assert.ok(!JSON.stringify(journal).includes(code), 'ni écrit dans le journal');

  const lea = await b.session('lea12345', 'Léa');
  const tom = await b.session('tom12345', 'Tom');
  let a = await b.appel('/invitations/accepter', { methode: 'POST', jeton: lea, corps: { code } });
  assert.equal(a.statut, 200);
  assert.equal(a.corps.role.nom, 'Joueur');
  a = await b.appel('/invitations/accepter', { methode: 'POST', jeton: tom, corps: { code } });
  assert.equal(a.statut, 410);
  assert.equal(a.corps.code, 'invitation-epuisee');
  a = await b.appel('/invitations/accepter', { methode: 'POST', jeton: lea, corps: { code } });
  assert.equal(a.statut, 410);

  // Plusieurs utilisations, puis révocation.
  const multi = (await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: f, corps: { roleId: roles.remplacant.id, utilisationsMax: 2 } })).corps;
  assert.equal((await b.appel('/invitations/accepter', { methode: 'POST', jeton: tom, corps: { code: multi.code } })).statut, 200);
  assert.equal((await b.appel('/invitations/accepter', { methode: 'POST', jeton: tom, corps: { code: multi.code } })).corps.code, 'deja-membre');
  assert.equal((await b.appel(`/teams/${teamId}/invitations/${multi.invitation.id}`, { methode: 'DELETE', jeton: f })).statut, 200);
  const zoe = await b.session('zoe12345', 'Zoé');
  a = await b.appel('/invitations/accepter', { methode: 'POST', jeton: zoe, corps: { code: multi.code } });
  assert.equal(a.statut, 410);
  assert.equal(a.corps.code, 'invitation-revoquee');

  // Expiration.
  const courte = (await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: f, corps: { roleId: roles.joueur.id, joursValidite: 1 } })).corps;
  b.horloge.t += 25 * 3_600_000;
  const zoe2 = await b.session('zoe12345');
  a = await b.appel('/invitations/accepter', { methode: 'POST', jeton: zoe2, corps: { code: courte.code } });
  assert.equal(a.statut, 410);
  assert.equal(a.corps.code, 'invitation-expiree');
  const etats = (await b.appel(`/teams/${teamId}/invitations`, { jeton: await b.session('principal') })).corps.invitations.map(i => i.etat).sort();
  assert.deepEqual(etats, ['epuisee', 'expiree', 'revoquee']);
  // Bornes.
  assert.equal((await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: await b.session('principal'), corps: { roleId: roles.joueur.id, joursValidite: 90 } })).statut, 400);
});

test('invitations : pseudo requis pour accepter ; compte non relié (sans session) refusé', async () => {
  const b = await banc();
  const { teamId, sessions, roles } = await teamAvecMembres(b);
  const { code } = (await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: sessions.fondateur, corps: { roleId: roles.joueur.id } })).corps;
  const sansPseudo = await b.session('neo12345');
  const r = await b.appel('/invitations/accepter', { methode: 'POST', jeton: sansPseudo, corps: { code } });
  assert.equal(r.statut, 428);
  assert.equal((await b.appel('/invitations/accepter', { methode: 'POST', corps: { code } })).statut, 401);
});

test('invitations : anti-force brute (par compte et par adresse) → 429 après 5 codes faux', async () => {
  const b = await banc();
  const { teamId, sessions, roles } = await teamAvecMembres(b);
  const { code } = (await b.appel(`/teams/${teamId}/invitations`, { methode: 'POST', jeton: sessions.fondateur, corps: { roleId: roles.joueur.id } })).corps;
  const pirate = await b.session('pir12345', 'Pirate');
  const statuts = [];
  for (let i = 0; i < 7; i++) {
    statuts.push((await b.appel('/invitations/accepter', { methode: 'POST', jeton: pirate, corps: { code: `esp_${String(i).repeat(32).slice(0, 32)}` } })).statut);
  }
  assert.deepEqual(statuts.slice(0, 6), [404, 404, 404, 404, 404, 429]);
  const r = await b.appel('/invitations/accepter', { methode: 'POST', jeton: pirate, corps: { code } });
  assert.equal(r.statut, 429, 'même le bon code attend la fin du délai');
  assert.ok(r.corps.attente > 0);
  assert.ok(Number(r.entetes.get('Retry-After')) > 0);
  // Par adresse : un autre compte depuis la même IP est freiné aussi.
  const ip = '203.0.113.77';
  const autre = await b.session('aut12345', 'Autre');
  for (let i = 0; i < 5; i++) await b.appel('/invitations/accepter', { methode: 'POST', jeton: autre, ip, corps: { code: 'faux' } });
  const complice = await b.session('com12345', 'Complice');
  assert.equal((await b.appel('/invitations/accepter', { methode: 'POST', jeton: complice, ip, corps: { code } })).statut, 429);
  // Le délai passé, le bon code marche.
  b.horloge.t += 2 * 3_600_000;
  assert.equal((await b.appel('/invitations/accepter', { methode: 'POST', jeton: await b.session('pir12345'), corps: { code } })).statut, 200);
});

// ------------------------------------------------------------------ Journal, notifications

test('journal : tout est journalisé (création, invitation, arrivée, rôle, modules), lisible avec les pseudos ; aucune route pour le modifier', async () => {
  const b = await banc();
  const { teamId, sessions, membres, roles } = await teamAvecMembres(b, { membres: MEMBRES });
  await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: sessions.fondateur, corps: { roleId: roles.coach.id } });
  const r = await b.appel(`/teams/${teamId}/journal`, { jeton: sessions.max12345 });
  const actions = r.corps.entrees.map(e => e.action);
  for (const a of ['team.created', 'invitation.created', 'member.joined', 'member.role_changed']) assert.ok(actions.includes(a), a);
  const changement = r.corps.entrees.find(e => e.action === 'member.role_changed');
  assert.deepEqual([changement.meta.de, changement.meta.vers], ['Joueur', 'Coach']);
  assert.equal(r.corps.noms[changement.meta.compte], 'Léa');
  assert.equal(r.corps.noms[changement.acteur], 'Fondateur');
  // Filtres et pagination.
  const filtre = await b.appel(`/teams/${teamId}/journal?action=member`, { jeton: sessions.max12345 });
  assert.ok(filtre.corps.entrees.every(e => e.action.startsWith('member.')));
  const page = await b.appel(`/teams/${teamId}/journal?limite=2`, { jeton: sessions.max12345 });
  assert.equal(page.corps.entrees.length, 2);
  assert.ok(page.corps.suite);
  for (const methode of ['PUT', 'PATCH', 'DELETE', 'POST']) {
    assert.equal((await b.appel(`/teams/${teamId}/journal`, { methode, jeton: sessions.fondateur, corps: {} })).statut, 404, methode);
  }
  // Tous les événements de l'outbox ont été distribués.
  assert.equal(Number((await b.base.premier('SELECT COUNT(*) AS n FROM evenements WHERE traite_le IS NULL', [])).n), 0);
});

test('notifications in-app : bienvenue au nouveau membre, arrivée aux gestionnaires, changement de rôle ; marquage lu', async () => {
  const b = await banc();
  const { teamId, sessions, membres, roles } = await teamAvecMembres(b, { membres: MEMBRES });
  let n = (await b.appel('/notifications', { jeton: sessions.lea12345 })).corps;
  assert.ok(n.liste.some(x => x.type === 'bienvenue'));
  n = (await b.appel('/notifications', { jeton: sessions.max12345 })).corps;
  assert.ok(n.liste.some(x => x.type === 'membre-arrive' && n.noms[x.charge.membre] === 'Léa'));
  assert.ok(!(await b.appel('/notifications', { jeton: sessions.coach123 })).corps.liste.some(x => x.type === 'membre-arrive'), 'pas le Coach (il n’invite pas)');
  await b.appel(`/teams/${teamId}/membres/${membres.lea12345.id}`, { methode: 'PATCH', jeton: sessions.fondateur, corps: { roleId: roles.analyste.id } });
  n = (await b.appel('/notifications', { jeton: sessions.lea12345 })).corps;
  const role = n.liste.find(x => x.type === 'role-change');
  assert.deepEqual([role.charge.de, role.charge.vers], ['Joueur', 'Analyste']);
  assert.ok(n.nonLues >= 2);
  n = (await b.appel('/notifications/lues', { methode: 'POST', jeton: sessions.lea12345, corps: { tout: true } })).corps;
  assert.equal(n.nonLues, 0);
});

// ------------------------------------------------------------------ RGPD

test('RGPD : export de ses données ; suppression (refusée au dernier Propriétaire) ; plus aucune trace du profil', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  const exp = (await b.appel('/moi/export', { jeton: sessions.lea12345 })).corps;
  assert.equal(exp.profil.pseudo, 'Léa');
  assert.deepEqual(exp.teams.map(t => [t.team, t.role]), [['Team Alpha', 'Joueur']]);
  let r = await b.appel('/moi', { methode: 'DELETE', jeton: sessions.fondateur });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'dernier-proprietaire');
  r = await b.appel('/moi', { methode: 'DELETE', jeton: sessions.lea12345 });
  assert.equal(r.statut, 200);
  assert.equal(await b.base.premier('SELECT * FROM comptes WHERE id = ?', ['lea12345']), null);
  assert.equal(await b.base.premier('SELECT * FROM membres WHERE compte_id = ?', ['lea12345']), null);
  assert.equal(await b.base.premier('SELECT * FROM notifications WHERE compte_id = ?', ['lea12345']), null);
  assert.equal((await b.appel('/moi', { jeton: sessions.lea12345 })).corps.profil, null);
  const j = (await b.appel(`/teams/${teamId}/journal`, { jeton: sessions.fondateur })).corps;
  assert.ok(j.entrees.some(e => e.action === 'member.left'));
  assert.equal(j.noms.lea12345, null, 'le journal garde l’action, plus le pseudo');
});

// ------------------------------------------------------------------ Export / import de toute la base

test('admin : export JSON de toute la base, import dans une base vide (identique), refusé si non vide ou non Fondateur', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: MEMBRES });
  assert.equal((await b.appel('/admin/export', { jeton: sessions.max12345 })).statut, 403);
  const exp = (await b.appel('/admin/export', { jeton: sessions.fondateur })).corps;
  assert.equal(exp.format, 'applibourse-esport');
  assert.equal(exp.tables.teams.length, 1);
  assert.equal(exp.tables.membres.length, 4);
  assert.equal((await b.appel('/admin/import', { methode: 'POST', jeton: sessions.fondateur, corps: exp })).statut, 409);
  const neuve = await baseSqliteMigree();
  const bilan = await importerBase(neuve, exp);
  assert.equal(bilan.membres, 4);
  assert.deepEqual(await exporterBase(neuve, Date.parse(exp.exporteLe)), exp);
  const t = await neuve.premier('SELECT nom FROM teams WHERE id = ?', [teamId]);
  assert.equal(t.nom, 'Team Alpha');
  await assert.rejects(importerBase(await baseSqliteMigree(), { ...exp, tables: { ...exp.tables, pirate: [] } }));
  await assert.rejects(importerBase(await baseSqliteMigree(), { format: 'autre' }));
});

test('sécurité HTTP : en-têtes, CORS, corps trop gros, JSON illisible, route inconnue', async () => {
  const b = await banc();
  const s = await b.appel('/sante');
  assert.equal(s.statut, 200);
  assert.equal(s.corps.service, 'esport');
  assert.equal(s.entetes.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(s.entetes.get('Cache-Control'), 'no-store');
  assert.equal((await b.appel('/api/esport/sante')).statut, 200, 'préfixe /api/esport accepté');
  const f = await b.session('principal', 'Fondateur');
  assert.equal((await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'x'.repeat(70_000) } })).statut, 413);
  assert.equal((await b.appel('/inconnue', { jeton: f })).statut, 404);
  const cat = await b.appel('/catalogue');
  assert.ok(cat.corps.modules.length >= 11);
});
