/**
 * Page « Rôles et permissions » (migration 0033, docs/esport/roles-permissions.md) :
 *  - rôle système du club « Second CEO » : presque tout (teams avec les droits du Propriétaire, membres, comptes,
 *    statistiques, jeux, tout le CM) sauf la page elle-même, la suppression d'une team et le RGPD ;
 *  - rôle du club personnalisé (« inviter des membres » donné à un compte) ;
 *  - garde-fous : Fondateur intouchable, délégation roles.gerer (anti-escalade, roles.gerer et Second CEO réservés),
 *    modèle des nouvelles teams (Fondateur seul), journal, export / import, RGPD ;
 *  - cohérence du catalogue : toute permission vérifiée par le serveur est décrite au catalogue, et inversement.
 * Tourne sur SQLite et, avec ESPORT_TEST_PG, sur PostgreSQL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banc, teamAvecMembres } from './aide.mjs';
import { catalogue, TOUTES_PERMISSIONS } from '../noyau/permissions.mjs';
import { PERMISSIONS_ROLES_CM } from '../noyau/sponsors/commun.mjs';
import { PERMISSIONS_GLOBALES } from '../noyau/roles/globales.mjs';
import { PERMISSIONS_ROLE_GLOBAL, permissionsParDefautGlobal } from '../noyau/roles/service.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { baseMigree } from './base.mjs';

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  // Grimm : un compte Esport qui n'est membre d'AUCUNE team.
  const grimm = await b.session('grimm123', 'Grimm');
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const vue = async (jeton = A.sessions.fondateur) => (await api('/roles-permissions', jeton)).corps;
  const roleGlobal = async cle => (await vue()).globaux.roles.find(r => r.cle === cle || r.nom === cle);
  const attribuer = (roleId, compte, jeton = A.sessions.fondateur) => api(`/roles-permissions/globaux/${roleId}/comptes`, jeton, { methode: 'POST', corps: { compte } });
  return { b, A, grimm, api, vue, roleGlobal, attribuer };
}

test('Second CEO : rôle système du club, permissions par défaut (tout sauf roles.gerer), attribué par le Fondateur', async () => {
  const { A, grimm, api, vue, roleGlobal, attribuer } = await preparer();
  const v = await vue();
  assert.equal(v.moi.fondateur, true);
  const sc = v.globaux.roles.find(r => r.cle === 'second_ceo');
  assert.ok(sc, 'Second CEO présent');
  assert.equal(sc.systeme, true);
  assert.equal(sc.modifie, false, 'la migration pose exactement les permissions par défaut du catalogue');
  assert.deepEqual(sc.permissions, permissionsParDefautGlobal('second_ceo'));
  assert.ok(!sc.permissions.includes('roles.gerer'));
  for (const p of ['teams.acces_total', 'membres.inviter', 'comptes.discord_id', 'statistiques.voir', 'jeux.gerer', 'cm.gerer', 'cm.drive.gerer', 'sponsors.gerer', 'membres.trombi.editer']) assert.ok(sc.permissions.includes(p), p);

  // Avant : Grimm ne voit ni la team, ni le CM, ni les statistiques.
  assert.equal((await api(`/teams/${A.teamId}`, grimm)).statut, 404);
  assert.equal((await api('/statistiques', grimm)).statut, 404);
  assert.equal((await api('/cm/roles', grimm)).statut, 403);

  const r = await attribuer(sc.id, 'grimm123');
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(r.corps.comptes.map(c => c.pseudo), ['Grimm']);
  assert.deepEqual((await roleGlobal('second_ceo')).comptes.map(c => c.compte), ['grimm123']);

  // Après : toutes les teams avec les droits du Propriétaire (sauf supprimer la team).
  const moi = (await api('/moi', grimm)).corps;
  assert.equal(moi.superAdmin, false);
  assert.equal(moi.peutCreerTeam, true);
  assert.equal(moi.peutGererJeux, true);
  assert.equal(moi.peutVoirStatistiques, true);
  assert.equal(moi.peutGererRoles, false);
  assert.ok((await api('/teams', grimm)).corps.teams.some(t => t.id === A.teamId));
  const detail = await api(`/teams/${A.teamId}`, grimm);
  assert.equal(detail.statut, 200);
  assert.ok(detail.corps.moi.permissions.includes('roles.manage'));
  assert.ok(!detail.corps.moi.permissions.includes('team.delete'));
  assert.equal((await api(`/teams/${A.teamId}`, grimm, { methode: 'PATCH', corps: { description: 'Par Grimm' } })).statut, 200);
  assert.equal((await api(`/teams/${A.teamId}`, grimm, { methode: 'DELETE' })).statut, 403, 'supprimer une team reste au Fondateur et aux Propriétaires');
  // Rôles de la team : il modifie le Coach, mais ne nomme pas de Propriétaire.
  const coach = A.roles.coach;
  const p = await api(`/teams/${A.teamId}/roles/${coach.id}`, grimm, { methode: 'PATCH', corps: { permissions: coach.permissions.filter(x => x !== 'strats.share') } });
  assert.equal(p.statut, 200, JSON.stringify(p.corps));
  const promo = await api(`/teams/${A.teamId}/membres/${A.membres.lea12345.id}`, grimm, { methode: 'PATCH', corps: { roleId: A.roles.proprietaire.id } });
  assert.equal(promo.statut, 403);
  // CM : il gère l'équipe CM (cm.gerer) ; Sponsors ; statistiques ; Discord ID d'un membre.
  assert.equal((await api('/cm/roles', grimm)).statut, 200);
  assert.equal((await api('/cm/moi', grimm)).corps.gerer, true);
  assert.equal((await api('/statistiques', grimm)).statut, 200);
  assert.equal((await api('/comptes/lea12345/discord-id', grimm, { methode: 'PUT', corps: { discordId: '123456789012345678' } })).statut, 200);

  // Ce qui reste au Fondateur.
  assert.equal((await api('/roles-permissions', grimm)).statut, 404, 'la page Rôles et permissions');
  assert.equal((await api(`/teams/${A.teamId}/membres/${A.membres.principal.id}`, grimm, { methode: 'DELETE' })).corps.code, 'compte-fondateur', 'retirer le Fondateur d’une team');
  assert.equal((await api('/comptes/principal/discord-id', grimm, { methode: 'PUT', corps: { discordId: '223456789012345678' } })).statut, 403, 'le compte du Fondateur');
  assert.equal((await api('/admin/comptes/lea12345', grimm, { methode: 'DELETE' })).statut, 403, 'suppression RGPD');
  assert.equal((await api('/admin/export', grimm)).statut, 403, 'export de la base');
  assert.equal((await api('/statistiques/reglages', grimm, { methode: 'PUT', corps: { collecte: false } })).statut, 404, 'réglages de la collecte');
  assert.equal((await api('/jeux/ia/gestionnaires', grimm)).statut, 403, 'Administration de l’IA');
});

test('Second CEO : seul le Fondateur le modifie, le rétablit et l’attribue ; le Fondateur peut y cocher roles.gerer', async () => {
  const { A, grimm, api, roleGlobal, attribuer } = await preparer();
  const sc = await roleGlobal('second_ceo');
  // Un délégué roles.gerer (rôle personnalisé) ne touche pas au Second CEO.
  const deleg = await api('/roles-permissions/globaux', A.sessions.fondateur, { methode: 'POST', corps: { nom: 'Gestion des rôles', couleur: '#336699', permissions: ['roles.gerer', 'cm.voir'] } });
  assert.equal(deleg.statut, 200, JSON.stringify(deleg.corps));
  assert.equal((await attribuer(deleg.corps.id, 'max12345')).statut, 200);
  const max = A.sessions.max12345;
  assert.equal((await api('/roles-permissions', max)).statut, 200);
  assert.equal((await attribuer(sc.id, 'grimm123', max)).corps.code, 'role-reserve');
  assert.equal((await api(`/roles-permissions/globaux/${sc.id}`, max, { methode: 'PATCH', corps: { permissions: ['cm.voir'] } })).corps.code, 'role-reserve');
  assert.equal((await api(`/roles-permissions/globaux/${sc.id}/retablir`, max, { methode: 'POST' })).corps.code, 'role-reserve');

  // Le Fondateur ajuste le rôle (comme les autres), puis le rétablit.
  const sans = sc.permissions.filter(p => p !== 'statistiques.voir');
  const m = await api(`/roles-permissions/globaux/${sc.id}`, A.sessions.fondateur, { methode: 'PATCH', corps: { permissions: [...sans, 'roles.gerer'] } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.equal(m.corps.modifie, true);
  assert.equal((await api(`/roles-permissions/globaux/${sc.id}`, A.sessions.fondateur, { methode: 'PATCH', corps: { nom: 'Autre' } })).statut, 403, 'nom fixe');
  assert.equal((await attribuer(sc.id, 'grimm123')).statut, 200);
  assert.equal((await api('/roles-permissions', grimm)).statut, 200, 'roles.gerer coché par le Fondateur');
  assert.equal((await api('/statistiques', grimm)).statut, 404, 'effet immédiat du retrait');
  const r = await api(`/roles-permissions/globaux/${sc.id}/retablir`, A.sessions.fondateur, { methode: 'POST' });
  assert.equal(r.corps.modifie, false);
  assert.equal((await api('/roles-permissions', grimm)).statut, 404);
  // Retrait : plus rien.
  assert.equal((await api(`/roles-permissions/globaux/${sc.id}/comptes/grimm123`, A.sessions.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await api(`/teams/${A.teamId}`, grimm)).statut, 404);
  assert.equal((await api(`/roles-permissions/globaux/${sc.id}`, A.sessions.fondateur, { methode: 'DELETE' })).statut, 403, 'un rôle système ne se supprime pas');
});

test('badge « Second CEO » automatique : il suit le rôle du club (portée club), ni attribuable ni retirable à la main', async () => {
  const { b, A, api, roleGlobal, attribuer } = await preparer();
  const f = A.sessions.fondateur;
  const badges = async compte => ((await api('/trombi', f)).corps.fiches.find(x => x.compte === compte)?.badges ?? []).map(x => [x.nom, x.auto, x.teamId]);
  const badge = await b.base.premier("SELECT auto, reserve FROM trombi_badges WHERE id = 'badge-second-ceo'", []);
  assert.equal(badge.auto, 'second-ceo');
  assert.equal(Number(badge.reserve), 1);
  // Grimm n'est dans aucune team : on le met dans la team pour qu'il ait une carte du trombinoscope.
  await api(`/teams/${A.teamId}/membres`, f, { methode: 'POST', corps: { compte: 'grimm123', roleId: A.roles.joueur.id } });
  assert.deepEqual(await badges('grimm123'), []);
  const sc = await roleGlobal('second_ceo');
  await attribuer(sc.id, 'grimm123');
  assert.deepEqual(await badges('grimm123'), [['Second CEO', true, null]]);
  assert.equal((await api('/trombi/badges/badge-second-ceo/membres', f, { methode: 'POST', corps: { comptes: ['lea12345'] } })).corps.code, 'badge-auto');
  await api(`/roles-permissions/globaux/${sc.id}/comptes/grimm123`, f, { methode: 'DELETE' });
  assert.deepEqual(await badges('grimm123'), []);
});

test('rôle du club personnalisé « Recruteur » (inviter des membres) : ajout et demande de compte dans une team étrangère ; jamais un rôle de gestion', async () => {
  const b = await banc();
  const A = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const grimm = await b.session('grimm123', 'Grimm');
  await b.session('nina1234', 'Nina');
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  const c = await api('/roles-permissions/globaux', A.sessions.fondateur, { methode: 'POST', corps: { nom: 'Recruteur', couleur: '#22a879', permissions: ['membres.inviter'] } });
  const ajout = roleId => api(`/teams/${A.teamId}/membres`, grimm, { methode: 'POST', corps: { compte: 'nina1234', roleId } });
  assert.equal((await ajout(A.roles.joueur.id)).statut, 404, 'sans le rôle');
  assert.equal((await api(`/roles-permissions/globaux/${c.corps.id}/comptes`, A.sessions.fondateur, { methode: 'POST', corps: { compte: 'grimm123' } })).statut, 200);
  // L'annuaire lui propose la team et ses rôles (sans en montrer les membres).
  const annuaire = (await api('/membres', grimm)).corps;
  const t = annuaire.teams.find(x => x.id === A.teamId);
  assert.ok(t && t.droits.ajouter);
  assert.equal(t.roles.find(r => r.cle === 'manager').attribuable, false);
  assert.equal(t.roles.find(r => r.cle === 'joueur').attribuable, true);
  assert.ok(!annuaire.comptes.some(x => x.compte === 'lea12345'), 'pas les membres d’une team qu’il ne voit pas');
  // Manager ou Propriétaire : refusé ; Joueur : ajouté.
  assert.equal((await ajout(A.roles.manager.id)).corps.code, 'role-gestion');
  assert.equal((await ajout(A.roles.proprietaire.id)).corps.code, 'role-gestion');
  const ok = await ajout(A.roles.joueur.id);
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  assert.equal((await api(`/teams/${A.teamId}/membres`, A.sessions.fondateur)).corps.membres.find(m => m.compte === 'nina1234')?.role.cle, 'joueur');
  // Demande de compte au Fondateur dans cette team.
  const d = await api('/comptes/demandes', grimm, { methode: 'POST', corps: { teamId: A.teamId, roleId: A.roles.joueur.id, pseudo: 'Nouvelle', email: 'nouvelle@example.com' } });
  assert.equal(d.statut, 200, JSON.stringify(d.corps));
  // Mais il n'entre pas dans la team pour autant.
  assert.equal((await api(`/teams/${A.teamId}`, grimm)).statut, 404);
});

test('garde-fous de la délégation roles.gerer : anti-escalade, roles.gerer réservé, compte du Fondateur, modèle des teams', async () => {
  const { A, grimm, api, vue, attribuer } = await preparer();
  const f = A.sessions.fondateur;
  const deleg = await api('/roles-permissions/globaux', f, { methode: 'POST', corps: { nom: 'Délégué', couleur: '#336699', permissions: ['roles.gerer', 'teams.creer', 'cm.voir'] } });
  assert.equal((await attribuer(deleg.corps.id, 'grimm123')).statut, 200);
  const v = await vue(grimm);
  assert.equal(v.moi.fondateur, false);
  assert.deepEqual(v.moi.permissions, ['cm.voir', 'roles.gerer', 'teams.creer']);
  assert.equal(v.modele.modifiable, false);
  // Il crée un rôle avec ce qu'il a…
  const ok = await api('/roles-permissions/globaux', grimm, { methode: 'POST', corps: { nom: 'Créateur de teams', couleur: '#22a879', permissions: ['teams.creer'] } });
  assert.equal(ok.statut, 200, JSON.stringify(ok.corps));
  // … pas avec ce qu'il n'a pas, ni roles.gerer.
  const esc = await api('/roles-permissions/globaux', grimm, { methode: 'POST', corps: { nom: 'Trop', couleur: '#22a879', permissions: ['statistiques.voir'] } });
  assert.equal(esc.statut, 403);
  assert.equal(esc.corps.code, 'escalade');
  assert.deepEqual(esc.corps.details.manquantes, ['statistiques.voir']);
  assert.equal((await api('/roles-permissions/globaux', grimm, { methode: 'POST', corps: { nom: 'Copie', couleur: '#22a879', permissions: ['roles.gerer'] } })).corps.code, 'permission-reservee');
  // Il ne peut pas se priver lui-même de roles.gerer (ni se retirer le rôle qui le porte) : verrouillage impossible.
  assert.equal((await api(`/roles-permissions/globaux/${deleg.corps.id}`, grimm, { methode: 'PATCH', corps: { permissions: ['teams.creer'] } })).corps.code, 'permission-reservee');
  assert.equal((await api(`/roles-permissions/globaux/${deleg.corps.id}/comptes/grimm123`, grimm, { methode: 'DELETE' })).corps.code, 'permission-reservee');
  // Un rôle plus puissant que lui : intouchable.
  const fort = await api('/roles-permissions/globaux', f, { methode: 'POST', corps: { nom: 'Stats', couleur: '#22a879', permissions: ['statistiques.voir'] } });
  assert.equal((await api(`/roles-permissions/globaux/${fort.corps.id}`, grimm, { methode: 'DELETE' })).corps.code, 'escalade');
  assert.equal((await attribuer(fort.corps.id, 'lea12345', grimm)).corps.code, 'escalade');
  // Le compte du Fondateur : jamais de rôle.
  assert.equal((await attribuer(ok.corps.id, 'principal', grimm)).corps.code, 'compte-fondateur');
  assert.equal((await attribuer(ok.corps.id, 'principal')).corps.code, 'compte-fondateur');
  assert.equal((await api('/cm/affectations', f, { methode: 'POST', corps: { compte: 'principal', roleId: 'cm-role-responsable' } })).corps.code, 'compte-fondateur');
  // Rôles CM : ouverts à roles.gerer (sans cm.gerer), anti-escalade.
  assert.equal((await api('/cm/roles', grimm)).statut, 200);
  assert.equal((await api('/cm/reglages', grimm)).statut, 403, 'les réglages du CM restent à cm.gerer');
  assert.equal((await api('/cm/roles', grimm, { methode: 'POST', corps: { nom: 'Lecteur', couleur: '#22a879', permissions: ['cm.voir'] } })).statut, 200);
  assert.equal((await api('/cm/roles', grimm, { methode: 'POST', corps: { nom: 'Valideur', couleur: '#22a879', permissions: ['cm.valider'] } })).corps.code, 'escalade');
  // Modèle des nouvelles teams : Fondateur seul.
  assert.equal((await api('/roles-permissions/modele/coach', grimm, { methode: 'PUT', corps: { permissions: ['members.view'] } })).statut, 403);
  // Sans roles.gerer : la page n'existe pas.
  assert.equal((await api('/roles-permissions', A.sessions.max12345)).statut, 404);
  assert.equal((await api('/roles-permissions/globaux', A.sessions.max12345, { methode: 'POST', corps: { nom: 'X', permissions: [] } })).statut, 404);
});

test('modèle des rôles des nouvelles teams : appliqué à la création, rétablissable ; journal des changements', async () => {
  const { A, api, vue } = await preparer();
  const f = A.sessions.fondateur;
  const coach = (await vue()).modele.roles.find(r => r.cle === 'coach');
  assert.equal(coach.modifie, false);
  const sans = coach.permissions.filter(p => p !== 'strats.delete');
  const m = await api('/roles-permissions/modele/coach', f, { methode: 'PUT', corps: { permissions: sans } });
  assert.equal(m.statut, 200, JSON.stringify(m.corps));
  assert.equal(m.corps.modifie, true);
  assert.equal((await api('/roles-permissions/modele/proprietaire', f, { methode: 'PUT', corps: { permissions: [] } })).statut, 404, 'le Propriétaire a tout, toujours');
  assert.equal((await api('/roles-permissions/modele/coach', f, { methode: 'PUT', corps: { permissions: ['inconnue.x'] } })).statut, 400);
  // Nouvelle team : le Coach suit le modèle ; la team existante ne change pas.
  const t = await api('/teams', f, { methode: 'POST', corps: { nom: 'Team Beta', jeu: 'valorant', preset: 'valorant_complet' } });
  const roles = (await api(`/teams/${t.corps.team.id}/roles`, f)).corps.roles;
  assert.ok(!roles.find(r => r.cle === 'coach').permissions.includes('strats.delete'));
  assert.ok((await api(`/teams/${A.teamId}/roles`, f)).corps.roles.find(r => r.cle === 'coach').permissions.includes('strats.delete'));
  const r = await api('/roles-permissions/modele/coach/retablir', f, { methode: 'POST' });
  assert.equal(r.corps.modifie, false);
  // Journal : modèle, rôle du club créé.
  await api('/roles-permissions/globaux', f, { methode: 'POST', corps: { nom: 'Analyste du club', couleur: '#0891b2', permissions: ['statistiques.voir'] } });
  const j = (await api('/roles-permissions/journal', f)).corps.entrees.map(e => e.action);
  assert.ok(j.includes('roles.modele_modifie'));
  assert.ok(j.includes('roles.global_cree'));
});

test('export / import de la base et RGPD : rôles du club conservés, effacés avec le compte', async () => {
  const { b, A, api, roleGlobal, attribuer } = await preparer();
  const sc = await roleGlobal('second_ceo');
  await attribuer(sc.id, 'grimm123');
  await api('/roles-permissions/modele/coach', A.sessions.fondateur, { methode: 'PUT', corps: { permissions: ['members.view'] } });
  const exp = await exporterBase(b.base);
  assert.equal(exp.tables.roles_globaux_affectations.length, 1);
  assert.equal(exp.tables.roles_modele.length, 1);
  const neuve = await baseMigree();
  await importerBase(neuve, exp);
  assert.equal((await neuve.tous('SELECT * FROM roles_globaux_affectations', [])).length, 1);
  assert.equal((await neuve.tous("SELECT * FROM roles_globaux WHERE cle_systeme = 'second_ceo'", [])).length, 1);
  // RGPD : export de ses données, puis suppression par le Fondateur.
  const mes = (await api('/moi/export', await b.session('grimm123'))).corps;
  assert.deepEqual(mes.rolesClub.map(r => r.role), ['Second CEO']);
  assert.equal((await api('/admin/comptes/grimm123/hub', A.sessions.fondateur, { methode: 'DELETE' })).statut, 200);
  assert.equal((await b.base.tous("SELECT * FROM roles_globaux_affectations WHERE compte_id = 'grimm123'", [])).length, 0);
});

// ---------------------------------------------------------------- Cohérence du catalogue

const DOSSIER = fileURLToPath(new URL('../noyau/', import.meta.url));
function sources(d = DOSSIER) {
  const sortie = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) sortie.push(...sources(p));
    else if (n.endsWith('.mjs')) sortie.push([p.slice(DOSSIER.length), readFileSync(p, 'utf8')]);
  }
  return sortie;
}

/**
 * Permissions VÉRIFIÉES par le serveur, relevées dans le code : arguments littéraux des contrôles (`exiger`, `peut`,
 * `autorise`, `.has`, `aGlobale`…), listes contrôlées par `.some(… peut/exiger …)`, constantes PERMISSION(S)_* et
 * permissions nommées dans le SQL (`permission = '…'`, `permission IN (…)`).
 */
function permissionsDuCode() {
  const trouvees = new Map();
  const noter = (p, ou) => {
    if (!trouvees.has(p)) trouvees.set(p, ou);
  };
  const LITTERAL = /'([a-z_]+(?:\.[a-z_]+)+)'/g;
  for (const [fichier, texte] of sources()) {
    if (fichier.startsWith('textes/')) continue;
    const motifs = [
      /\b(?:exiger|exigerUn|peut|autorise|aGlobale|exigerGestion|ctxPortee|etiquetteVisible)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,
      /\.has\(('[^']+')\)/g,
      /\[([^\]]*)\]\.(?:some|every)\(\s*\w+\s*=>\s*(?:peut|ctx\.permissions\.has|exiger)/g,
      /\bPERMISSIONS?_[A-Z_]+\s*=\s*(?:Object\.freeze\()?([^;]*)/g,
      /permission\s*(?:=|IN)\s*\(?([^)"`]*)/g,
    ];
    for (const m of motifs) for (const x of texte.matchAll(m)) for (const l of x[1].matchAll(LITTERAL)) noter(l[1], fichier);
  }
  return trouvees;
}

test('catalogue : toute permission vérifiée côté serveur est décrite (catégorie, FR, EN), et toute permission décrite est vérifiée', () => {
  const decrites = new Set(Object.keys(catalogue.descriptions));
  const categories = new Set(catalogue.categories.map(c => c.cle));
  const attendues = new Set([...TOUTES_PERMISSIONS, ...PERMISSIONS_ROLES_CM, ...PERMISSIONS_GLOBALES]);
  // Chaque permission des trois familles (team, CM, club) a sa description, et rien d'autre n'est décrit.
  assert.deepEqual([...attendues].filter(p => !decrites.has(p)), [], 'permissions sans description');
  assert.deepEqual([...decrites].filter(p => !attendues.has(p)), [], 'descriptions sans permission');
  for (const [p, d] of Object.entries(catalogue.descriptions)) {
    assert.ok(categories.has(d.categorie), `${p} : catégorie ${d.categorie}`);
    assert.ok(d.fr?.length > 5 && d.en?.length > 5, `${p} : description FR et EN`);
  }
  // Toute permission contrôlée dans le code est au catalogue.
  const code = permissionsDuCode();
  const inconnues = [...code].filter(([p]) => !decrites.has(p)).map(([p, f]) => `${p} (${f})`);
  assert.deepEqual(inconnues, [], 'permissions vérifiées par le serveur absentes du catalogue');
  // Et inversement : chaque permission du catalogue est vérifiée quelque part.
  const tout = sources().map(([, t]) => t).join('\n');
  const jamais = [...decrites].filter(p => !code.has(p) && !tout.includes(`'${p}'`));
  assert.deepEqual(jamais, [], 'permissions du catalogue jamais vérifiées par le serveur');
});

test('catalogue : un rôle du club porte les permissions du club et du CM ; le Second CEO a tout sauf roles.gerer', () => {
  assert.deepEqual([...PERMISSIONS_ROLE_GLOBAL].sort(), [...new Set([...PERMISSIONS_GLOBALES, ...PERMISSIONS_ROLES_CM])].sort());
  const sc = permissionsParDefautGlobal('second_ceo');
  assert.deepEqual(PERMISSIONS_ROLE_GLOBAL.filter(p => !sc.includes(p)).sort(), ['deploiement.voir', 'devblog.gerer', 'roles.gerer']);
  // La migration 0033 pose exactement ces permissions (sinon « Modifié » s'afficherait dès l'installation), complétée
  // par les migrations suivantes (0039 : réunions de l'équipe CM ; 0054 : tickets).
  const sql = readFileSync(fileURLToPath(new URL('../migrations/0033_roles_globaux.sql', import.meta.url)), 'utf8');
  const sql38 = readFileSync(fileURLToPath(new URL('../migrations/0039_cm_reunions.sql', import.meta.url)), 'utf8');
  // 0054 : les quatre permissions des tickets.
  const sql54 = readFileSync(fileURLToPath(new URL('../migrations/0054_tickets.sql', import.meta.url)), 'utf8');
  const suivantes = [sql38, sql54].flatMap(s => [...s.matchAll(/SELECT id, '([a-z_.]+)' FROM roles_globaux WHERE id = 'role-global-second-ceo'/g)].map(m => m[1]));
  const posees = [...[...sql.matchAll(/\('role-global-second-ceo', '([a-z_.]+)'\)/g)].map(m => m[1]), ...suivantes];
  assert.deepEqual(posees.sort(), [...sc].sort());
});
