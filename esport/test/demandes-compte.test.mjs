/**
 * Permission « Créer des membres » (`members.create`) et demandes de compte :
 *  - un Joueur sans la permission → 403 ; le Propriétaire la donne au rôle
 *    Joueur (rôle système : seule cette permission est ajustable) ;
 *  - avec la permission → DEMANDE (nom, e-mail, team, rôle ≤ au sien) ;
 *    anti-escalade ; isolation entre teams ; plafond et limite de débit ;
 *  - le Fondateur la voit (liste, badge, notification, Discord sans l'adresse)
 *    et la valide (`POST /comptes` + `demandeId` : compte et team, demande
 *    close, adresse effacée) ou la refuse ; le demandeur suit le statut ;
 *  - la permission ajoute aussi un compte qui a déjà un profil Esport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traiterFile } from '../noyau/discord/file.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { URL_TEST } from './discord-aide.mjs';

const EMAIL = 'noa@exemple.fr';

async function preparer() {
  const appels = [];
  const fetchDiscord = async (url, init) => {
    appels.push(JSON.parse(init.body).content);
    return new Response(null, { status: 204 });
  };
  const b = await banc({ fetchDiscord });
  const A = await teamAvecMembres(b, {
    nom: 'Team Alpha',
    membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' }, kai12345: { pseudo: 'Kai', role: 'joueur' } },
  });
  const B = await teamAvecMembres(b, { nom: 'Team Bravo', membres: { bob12345: { pseudo: 'Bob', role: 'joueur' } } });
  const s = { ...A.sessions, bob12345: B.sessions.bob12345 };
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const demander = (qui, corps) => api('/comptes/demandes', s[qui], { methode: 'POST', corps: { teamId: A.teamId, roleId: A.roles.joueur.id, pseudo: 'Noa', email: EMAIL, ...corps } });
  /** Le Propriétaire donne (ou retire) « Créer des membres » au rôle Joueur de la Team Alpha. */
  const permissionJoueur = async (donner, jeton = s.fondateur) => {
    const role = (await api(`/teams/${A.teamId}/roles`, s.fondateur)).corps.roles.find(r => r.cle === 'joueur');
    const permissions = donner ? [...role.permissions, 'members.create'] : role.permissions.filter(p => p !== 'members.create');
    return api(`/teams/${A.teamId}/roles/${role.id}`, jeton, { methode: 'PATCH', corps: { permissions } });
  };
  return { b, A, B, s, api, demander, permissionJoueur, appels };
}

test('permission : un Joueur sans « Créer des membres » reçoit 403 ; le Propriétaire la donne au rôle Joueur (seule permission ajustable d’un rôle système)', async () => {
  const { A, s, api, demander, permissionJoueur } = await preparer();
  const r = await demander('lea12345');
  assert.equal(r.statut, 403);
  assert.equal(r.corps.code, 'permission');
  // Désactivée par défaut : ni le Joueur, ni le Manager ne l'ont.
  const roles = (await api(`/teams/${A.teamId}/roles`, s.fondateur)).corps.roles;
  for (const cle of ['joueur', 'manager', 'coach', 'remplacant']) assert.ok(!roles.find(x => x.cle === cle).permissions.includes('members.create'), cle);
  // Un Manager (roles.manage, sans members.create) ne peut pas la donner : anti-escalade.
  assert.equal((await permissionJoueur(true, s.max12345)).statut, 403);
  // Le Propriétaire : oui. Mais rien d'autre sur un rôle système (nom, autre permission, rôle Propriétaire).
  const joueur = roles.find(x => x.cle === 'joueur');
  assert.equal((await api(`/teams/${A.teamId}/roles/${joueur.id}`, s.fondateur, { methode: 'PATCH', corps: { nom: 'Pirate' } })).statut, 403);
  assert.equal((await api(`/teams/${A.teamId}/roles/${joueur.id}`, s.fondateur, { methode: 'PATCH', corps: { permissions: [...joueur.permissions, 'team.manage'] } })).statut, 403);
  const ok = await permissionJoueur(true);
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  assert.ok(ok.corps.permissions.includes('members.create'));
  assert.ok((await api(`/teams/${A.teamId}`, s.lea12345)).corps.moi.permissions.includes('members.create'));
  // Et la retirer.
  assert.equal((await permissionJoueur(false)).statut, 200);
  assert.equal((await demander('lea12345')).statut, 403);
});

test('demande : le Joueur autorisé dépose, le Fondateur valide (compte et team, adresse effacée), le demandeur suit le statut', async () => {
  const { b, A, s, api, demander, permissionJoueur, appels } = await preparer();
  // Discord de la team : l'annonce de la demande part, jamais l'adresse.
  assert.equal((await api(`/teams/${A.teamId}/discord/webhook`, s.fondateur, { methode: 'PUT', corps: { url: URL_TEST } })).statut, 200);
  await permissionJoueur(true);
  const r = await demander('lea12345', { posteJeu: 'Sentinelle', message: 'Ma cousine, très bonne en Sentinelle' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.statut, 'en_attente');
  assert.equal(r.corps.email, EMAIL, 'le demandeur relit son adresse');
  const id = r.corps.id;

  // Le Fondateur : liste, badge, notification, journal sans l'adresse, Discord sans l'adresse.
  const liste = (await api('/comptes/demandes', s.fondateur)).corps;
  assert.equal(liste.enAttente, 1);
  assert.equal(liste.demandes[0].email, EMAIL);
  assert.equal(liste.demandes[0].demandeurPseudo, 'Léa');
  assert.equal((await api('/membres', s.fondateur)).corps.demandesEnAttente, 1);
  assert.ok((await api('/notifications', s.fondateur)).corps.liste.some(n => n.type === 'demande-compte' && n.charge.pseudo === 'Noa'));
  const journal = await b.base.tous("SELECT meta FROM journal WHERE action = 'member.account_requested'", []);
  assert.equal(journal.length, 1);
  assert.ok(!journal[0].meta.includes(EMAIL));
  await traiterFile(b.base, { cle: CLE, fetch: async () => new Response(null, { status: 204 }), maintenant: b.horloge.t });
  assert.ok(appels.some(c => /Demande de compte/.test(c) && c.includes('Noa')), JSON.stringify(appels));
  assert.ok(!appels.some(c => c.includes(EMAIL)));

  // Un autre joueur (même permission) ne voit pas la demande de Léa, ne la refuse ni ne l'annule.
  assert.equal((await api('/comptes/demandes', s.kai12345)).corps.demandes.length, 0);
  assert.equal((await api(`/comptes/demandes/${id}/refuser`, s.kai12345, { methode: 'POST', corps: {} })).statut, 403);
  assert.equal((await api(`/comptes/demandes/${id}`, s.kai12345, { methode: 'DELETE' })).statut, 404);
  // Seul le Fondateur valide (il faut ses clés du hub) : POST /comptes avec demandeId → 403 pour les autres.
  const affectations = [{ teamId: A.teamId, roleId: A.roles.joueur.id, posteJeu: 'Sentinelle' }];
  assert.equal((await api('/comptes', s.max12345, { methode: 'POST', corps: { compte: 'noa12345', pseudo: 'Noa', affectations, demandeId: id } })).statut, 403);

  // Validation en un clic : contrôle, puis création (compte du hub créé par l'app du Fondateur, ici simulé).
  assert.equal((await api('/comptes', s.fondateur, { methode: 'POST', corps: { pseudo: 'Noa', affectations, demandeId: id, verifier: true } })).statut, 200);
  const v = await api('/comptes', s.fondateur, { methode: 'POST', corps: { compte: 'noa12345', pseudo: 'Noa', affectations, demandeId: id } });
  assert.equal(v.statut, 200, JSON.stringify(v.corps));
  assert.equal(v.corps.statut, 'invite');
  const membre = (await api(`/teams/${A.teamId}/membres`, s.fondateur)).corps.membres.find(m => m.compte === 'noa12345');
  assert.equal(membre.role.cle, 'joueur');
  assert.equal(membre.posteJeu, 'Sentinelle');
  const ligne = await b.base.premier('SELECT * FROM demandes_compte WHERE id = ?', [id]);
  assert.deepEqual([ligne.statut, ligne.compte_id, ligne.email], ['validee', 'noa12345', null], 'adresse effacée du serveur Esport');
  // Déjà traitée : 409.
  assert.equal((await api('/comptes', s.fondateur, { methode: 'POST', corps: { compte: 'zoe12345', pseudo: 'Zoé', affectations, demandeId: id } })).statut, 409);
  // Le demandeur suit le statut (et est prévenu) ; Noa voit sa team dès sa première session.
  const miennes = (await api('/comptes/demandes', s.lea12345)).corps.demandes;
  assert.deepEqual([miennes[0].statut, miennes[0].email], ['validee', null]);
  assert.ok((await api('/notifications', s.lea12345)).corps.liste.some(n => n.type === 'demande-compte-validee'));
  const noa = await b.session('noa12345');
  assert.deepEqual((await api('/teams', noa)).corps.teams.map(x => x.nom), ['Team Alpha']);
});

test('demande : anti-escalade, isolation entre teams, refus, annulation, doublons, plafond et limite de débit', async () => {
  const { A, B, s, api, demander, permissionJoueur } = await preparer();
  await permissionJoueur(true);
  // Anti-escalade : jamais un rôle au-dessus du sien.
  for (const cle of ['manager', 'proprietaire', 'coach']) {
    const r = await demander('lea12345', { roleId: A.roles[cle].id });
    assert.equal(r.statut, 403, cle);
    assert.equal(r.corps.code, 'escalade');
  }
  // Isolation : pas dans une team dont on n'est pas membre (404), ni avec le rôle d'une autre team.
  assert.equal((await demander('lea12345', { teamId: B.teamId, roleId: B.roles.joueur.id })).statut, 404);
  assert.equal((await demander('lea12345', { roleId: B.roles.joueur.id })).statut, 404);
  // Le Joueur de Bravo n'a pas la permission (rôles propres à chaque team).
  assert.equal((await api('/comptes/demandes', s.bob12345, { methode: 'POST', corps: { teamId: B.teamId, roleId: B.roles.joueur.id, pseudo: 'Noa', email: EMAIL } })).statut, 403);
  // Saisie : adresse invalide, pseudo pris dans l'Esport, demande en double.
  assert.equal((await demander('lea12345', { email: 'pas-une-adresse' })).statut, 400);
  assert.equal((await demander('lea12345', { pseudo: 'Kai' })).corps.code, 'pseudo-pris');
  const r = await demander('lea12345');
  assert.equal(r.statut, 200);
  assert.equal((await demander('kai12345')).corps.code, 'demande-existe');

  // Refus par le Fondateur (motif) : statut suivi, adresse effacée.
  const refus = await api(`/comptes/demandes/${r.corps.id}/refuser`, s.fondateur, { methode: 'POST', corps: { motif: 'Effectif complet' } });
  assert.equal(refus.statut, 200);
  assert.deepEqual([refus.corps.statut, refus.corps.motif, refus.corps.email], ['refusee', 'Effectif complet', null]);
  assert.ok((await api('/notifications', s.lea12345)).corps.liste.some(n => n.type === 'demande-compte-refusee'));
  assert.equal((await api(`/comptes/demandes/${r.corps.id}/refuser`, s.fondateur, { methode: 'POST', corps: {} })).statut, 409);
  // Annulation par le demandeur.
  const autre = await demander('lea12345', { pseudo: 'Zoé' });
  assert.equal((await api(`/comptes/demandes/${autre.corps.id}`, s.lea12345, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api('/comptes/demandes', s.lea12345)).corps.demandes.find(d => d.id === autre.corps.id).statut, 'annulee');

  // Limite de débit : 10 demandes par heure et par compte (le doublon refusé plus haut compte), puis 429.
  for (let i = 0; i < 9; i++) {
    const x = await demander('kai12345', { pseudo: `Recrue ${i}` });
    assert.equal(x.statut, 200, `${i} : ${JSON.stringify(x.corps)}`);
  }
  const trop = await demander('kai12345', { pseudo: 'Recrue X' });
  assert.equal(trop.statut, 429);
});

test('ajout direct : la permission ajoute à la team un compte qui a déjà un profil Esport (sans le Fondateur), avec l’anti-escalade', async () => {
  const { A, s, api, permissionJoueur } = await preparer();
  const ajouter = corps => api(`/teams/${A.teamId}/membres`, s.lea12345, { methode: 'POST', corps });
  // Sans la permission : 403.
  assert.equal((await ajouter({ pseudo: 'Bob', roleId: A.roles.joueur.id })).statut, 403);
  await permissionJoueur(true);
  // Bob (profil Esport, Team Bravo) : par son pseudo exact, en Joueur ; jamais en Manager.
  assert.equal((await ajouter({ pseudo: 'Bob', roleId: A.roles.manager.id })).corps.code, 'escalade');
  const ok = await ajouter({ pseudo: 'bob', roleId: A.roles.joueur.id });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  assert.ok((await api(`/teams/${A.teamId}/membres`, s.fondateur)).corps.membres.some(m => m.compte === 'bob12345'));
  // Inconnu de l'Esport : 404 (il faut alors une demande au Fondateur) ; le Fondateur ne s'ajoute pas ainsi.
  assert.equal((await ajouter({ pseudo: 'Personne', roleId: A.roles.joueur.id })).statut, 404);
  assert.equal((await ajouter({ pseudo: 'Fondateur', roleId: A.roles.joueur.id })).statut, 404);
});
