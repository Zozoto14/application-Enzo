/**
 * Langue par défaut d'un compte (migration 0019), réglée par le Fondateur :
 *  - choisie à la création (POST /comptes, `langue`), français sans choix, 400 si invalide ;
 *  - modifiable par le Fondateur SEUL (PUT /comptes/:compte/langue-defaut : 403 pour tout autre rôle) ;
 *  - le choix de l'utilisateur (PUT /moi/langue) PRIME, `{ langue: null }` revient à la langue définie par l'administrateur ;
 *  - elle sert au récapitulatif e-mail et aux réponses du bot Discord ;
 *  - migration : français pour les comptes existants, sauf ceux qui avaient déjà choisi English.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { tacheRecap } from '../noyau/recap.mjs';
import { configSmtp, creerEnvoyeur } from '../serveur/courriel-smtp.mjs';
import { decoderMessage, fauxSmtp } from '../../relais/test-smtp/faux-smtp.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { banc, CLE, teamAvecMembres } from './aide.mjs';
import { baseVierge, lireMigrations } from './base.mjs';

let smtp;
before(async () => {
  smtp = await fauxSmtp();
});
after(() => smtp.fermer());

async function preparer() {
  const b = await banc();
  const A = await teamAvecMembres(b, { nom: 'Team Alpha', membres: { bob12345: { pseudo: 'Bob', role: 'proprietaire' }, max12345: { pseudo: 'Max', role: 'manager' }, lea12345: { pseudo: 'Léa', role: 'joueur' }, tom12345: { pseudo: 'Tom', role: 'joueur' }, coach123: { pseudo: 'Zed', role: 'coach' } } });
  const f = A.sessions.fondateur;
  const api = (chemin, jeton, options = {}) => b.appel(chemin, { jeton, ...options });
  return { b, A, f, api };
}

const creation = (A, plus = {}) => ({ compte: 'zoe12345', pseudo: 'Zoé', discordId: '412345678901234567', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }], ...plus });

test('création : langue par défaut choisie (English), français sans choix, 400 si invalide', async () => {
  const { b, A, f, api } = await preparer();
  let r = await api('/comptes', f, { methode: 'POST', corps: creation(A, { langue: 'en' }) });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.langueDefaut, 'en');
  assert.equal(r.corps.langueChoisie, null);
  // Le compte invité ouvre sa session : langue par défaut en, aucun choix personnel.
  const zoe = await b.session('zoe12345');
  const moi = (await api('/moi', zoe)).corps;
  assert.equal(moi.langueDefaut, 'en');
  assert.equal(moi.langue, null);
  // Sans choix : français.
  r = await api('/comptes', f, { methode: 'POST', corps: creation(A, { compte: 'ian12345', pseudo: 'Ian', discordId: '412345678901234568' }) });
  assert.equal(r.corps.langueDefaut, 'fr');
  // Invalide : refusé, y compris pour la vérification seule.
  r = await api('/comptes', f, { methode: 'POST', corps: creation(A, { compte: 'ann12345', pseudo: 'Ann', discordId: '412345678901234569', langue: 'de' }) });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'langue');
  assert.equal(await b.base.premier("SELECT id FROM comptes WHERE pseudo = 'Ann'", []), null);
  // « Ajouter à une team » d'un compte du hub sans fiche Esport : la langue suit aussi.
  r = await api('/comptes/neuf12345/teams', f, { methode: 'POST', corps: { pseudo: 'Neuf', discordId: '412345678901234599', langue: 'en', affectations: [{ teamId: A.teamId, roleId: A.roles.joueur.id }] } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.langueDefaut, 'en');
});

test('langue par défaut : modifiable par le Fondateur SEUL (403 Propriétaire, Manager, le membre lui-même), visible du Fondateur seul', async () => {
  const { A, f, api } = await preparer();
  for (const [qui, jeton] of [['propriétaire', A.sessions.bob12345], ['manager', A.sessions.max12345], ['le membre', A.sessions.lea12345]]) {
    const r = await api('/comptes/lea12345/langue-defaut', jeton, { methode: 'PUT', corps: { langue: 'en' } });
    assert.equal(r.statut, 403, qui);
  }
  let membres = (await api('/membres', A.sessions.bob12345)).corps;
  assert.equal(membres.peutModifierLangue, false);
  assert.equal(membres.comptes.find(c => c.compte === 'lea12345').langueDefaut, undefined, 'pas pour les autres rôles');
  let r = await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.langueDefaut, 'en');
  membres = (await api('/membres', f)).corps;
  assert.equal(membres.peutModifierLangue, true);
  assert.equal(membres.comptes.find(c => c.compte === 'lea12345').langueDefaut, 'en');
  assert.equal(membres.comptes.find(c => c.compte === 'tom12345')?.langueDefaut ?? 'fr', 'fr');
  assert.equal((await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'de' } })).statut, 400);
  assert.equal((await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: {} })).statut, 400);
  assert.equal((await api('/comptes/pas+valide/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } })).statut, 400);
  r = await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'fr' } });
  assert.equal(r.corps.langueDefaut, 'fr');
});

test('compte du hub sans fiche Esport (créé dans l’Administration) : la langue attend sa première ouverture de l’Esport', async () => {
  const { b, A, f, api } = await preparer();
  // Réservé au Fondateur, même pour un compte pas encore connu.
  assert.equal((await api('/comptes/nouveau123/langue-defaut', A.sessions.bob12345, { methode: 'PUT', corps: { langue: 'en' } })).statut, 403);
  const r = await api('/comptes/nouveau123/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.enAttente, true);
  // Première session : pas encore de profil, mais la langue réglée par le Fondateur est déjà connue (l'interface s'ouvre en anglais).
  const nouveau = await b.session('nouveau123');
  let moi = (await api('/moi', nouveau)).corps;
  assert.equal(moi.profil, null);
  assert.equal(moi.langueDefaut, 'en');
  // Création de sa fiche : la langue par défaut devient celle du compte, l'attente est effacée.
  moi = (await api('/moi', nouveau, { methode: 'PUT', corps: { pseudo: 'Nouveau' } })).corps;
  assert.deepEqual([moi.langue, moi.langueDefaut], [null, 'en']);
  assert.equal(await b.base.premier('SELECT * FROM langues_attente', []), null);
  // Un compte supprimé dans l'Administration n'en laisse aucune trace.
  await api('/comptes/fantome123/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
  assert.equal((await api('/admin/comptes/fantome123/hub', f, { methode: 'DELETE' })).statut, 200);
  assert.equal(await b.base.premier('SELECT * FROM langues_attente', []), null);
});

test('priorité : le choix de l’utilisateur prime sur la langue par défaut ; null y revient', async () => {
  const { A, f, api } = await preparer();
  const lea = A.sessions.lea12345;
  await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
  let moi = (await api('/moi', lea)).corps;
  assert.deepEqual([moi.langue, moi.langueDefaut], [null, 'en']);
  // Léa choisit le français : son choix est gardé, la langue par défaut ne bouge pas.
  moi = (await api('/moi/langue', lea, { methode: 'PUT', corps: { langue: 'fr' } })).corps;
  assert.deepEqual([moi.langue, moi.langueDefaut], ['fr', 'en']);
  // Le Fondateur change la langue par défaut : le choix de Léa reste.
  await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'fr' } });
  moi = (await api('/moi', lea)).corps;
  assert.deepEqual([moi.langue, moi.langueDefaut], ['fr', 'fr']);
  // Le Fondateur voit les deux.
  const fiche = (await api('/membres', f)).corps.comptes.find(c => c.compte === 'lea12345');
  assert.deepEqual([fiche.langueChoisie, fiche.langueDefaut], ['fr', 'fr']);
  await api('/comptes/lea12345/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
  // « Revenir à la langue définie par l'administrateur ».
  moi = (await api('/moi/langue', lea, { methode: 'PUT', corps: { langue: null } })).corps;
  assert.deepEqual([moi.langue, moi.langueDefaut], [null, 'en']);
  assert.equal((await api('/moi/langue', lea, { methode: 'PUT', corps: { langue: 'de' } })).statut, 400);
  assert.equal((await api('/moi/langue', lea, { methode: 'PUT', corps: {} })).statut, 400);
  // Export RGPD : les deux langues.
  const profil = (await api('/moi/export', lea)).corps.profil;
  assert.deepEqual([profil.langue, profil.langueDefaut], [null, 'en']);
});

test('récapitulatif e-mail : dans la langue par défaut du compte, mais le choix de l’utilisateur prime', async () => {
  const { b, A, f, api } = await preparer();
  for (const c of ['lea12345', 'tom12345']) {
    await api('/comptes/' + c + '/langue-defaut', f, { methode: 'PUT', corps: { langue: 'en' } });
    const r = await api('/moi/recap-courriel', A.sessions[c], { methode: 'PUT', corps: { actif: true, adresse: `${c}@exemple.fr`, frequence: 'quotidien' } });
    assert.equal(r.statut, 200, JSON.stringify(r.corps));
  }
  // Tom choisit lui-même le français.
  await api('/moi/langue', A.sessions.tom12345, { methode: 'PUT', corps: { langue: 'fr' } });
  await api(`/teams/${A.teamId}/planning`, A.sessions.coach123, { methode: 'POST', corps: { type: 'scrim', titre: 'Scrim récap', date: '2026-10-22', heureDebut: '20:30', heureFin: '22:00' } });
  const envoyer = await creerEnvoyeur(configSmtp(smtp.env));
  try {
    b.horloge.t += 60_000;
    const avant = smtp.messages.length;
    const bilan = await tacheRecap(b.base, { cle: CLE, envoyer, maintenant: b.horloge.t, lienApp: 'https://appdashboard.fr' });
    assert.equal(bilan.envoyes, 2, JSON.stringify(bilan));
    const recus = Object.fromEntries(smtp.messages.slice(avant).map(m => [m.a[0], decoderMessage(m.donnees)]));
    assert.match(recus['lea12345@exemple.fr'].texte, /Here are the important Esport notifications/);
    assert.match(recus['lea12345@exemple.fr'].entetes, /Subject: Esport: your digest/);
    assert.match(recus['tom12345@exemple.fr'].texte, /Voici les notifications importantes/);
  } finally {
    envoyer.fermer();
  }
});

test('migration 0019 : français pour les comptes existants, English pour ceux qui l’avaient déjà choisi dans leur profil', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => !m.nom.startsWith('0019_')));
  const t = '2026-10-01T10:00:00.000Z';
  const ajouter = (id, langue) => base.executer('INSERT INTO comptes (id, pseudo, pseudo_cle, langue, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)', [id, id, id, langue, t, t]);
  await ajouter('anglais12', 'en');
  await ajouter('francais1', 'fr');
  await ajouter('jamaischo', null);
  await appliquerMigrations(base, toutes);
  const langues = Object.fromEntries((await base.tous('SELECT id, langue, langue_defaut FROM comptes', [])).map(l => [l.id, [l.langue, l.langue_defaut]]));
  assert.deepEqual(langues, { anglais12: ['en', 'en'], francais1: ['fr', 'fr'], jamaischo: [null, 'fr'] });
  await assert.rejects(() => base.executer("UPDATE comptes SET langue_defaut = 'de' WHERE id = 'francais1'", []));
});
