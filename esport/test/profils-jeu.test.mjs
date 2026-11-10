/**
 * Profils de jeu (migration 0021) : modèle et validation (strict / tolérant), profil Valorant préconfiguré,
 * rattachement des teams existantes, liaison team ↔ jeu (jeu obligatoire à la création), gestion des
 * profils (versions, conflits, restauration, archivage, suppression), permission globale `jeux.gerer`,
 * export / import de la base.
 *
 * Tourne sur SQLite (défaut) et sur PostgreSQL (ESPORT_TEST_PG, esport/test/pg/lancer.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { banc, teamAvecMembres } from './aide.mjs';
import { baseMigree, baseVierge, lireMigrations } from './base.mjs';
import { appliquerMigrations } from '../noyau/migrations.mjs';
import { exporterBase, importerBase } from '../noyau/transfert.mjs';
import { libelleFormat, validerDonnees, validerEntete } from '../noyau/jeux/schema.mjs';
import { profilAutre, profilValorant } from '../noyau/jeux/valorant.mjs';
import { resumeDifferences } from '../noyau/jeux/differences.mjs';

const FINALS = {
  formats: [
    { nom: 'Tournoi 3v3v3v3', equipes: 4, joueursParEquipe: 3, bo: [1] },
    { nom: 'Finale 3v3', equipes: 2, joueursParEquipe: 3, bo: [1, 3] },
  ],
  score: { type: 'placement', bareme: [{ place: 1, points: 10 }, { place: 2, points: 6 }], notes: 'Classement par manche.' },
  modes: [{ nom: 'Cashout', formats: ['tournoi-3v3v3v3'], description: 'Encaisser le plus d’argent.' }],
  cartes: [{ nom: 'Carte Exemple', image: 'https://images-exemple.fr/carte.png', modes: ['cashout', 'mode-inconnu'] }],
  classes: [{ nom: 'Light' }, { nom: 'Medium' }, { nom: 'Heavy' }],
  personnages: [{ nom: 'Build léger', classe: 'light' }, { nom: 'Build lourd', classe: 'classe-inconnue' }],
  roster: { titulaires: 3, remplacants: 1 },
  rolesJoueurs: [{ nom: 'Support' }],
  champs: [{ nom: 'Manches par tournoi', type: 'nombre', valeur: '3' }, { nom: 'Saison', type: 'texte', valeur: 'Exemple' }],
  libelles: { personnages: 'Builds', classes: 'Classes' },
  sources: [{ url: 'https://wiki-exemple.fr/the-finals', titre: 'Wiki' }, { url: 'http://wiki-exemple.fr/http' }, { url: 'https://10.0.0.1/interne' }],
};

// ------------------------------------------------------------------ Modèle et validation

test('schéma : profil valide normalisé (clés dérivées, références nettoyées, sources https publiques seulement)', () => {
  const { donnees, avertissements } = validerDonnees(FINALS);
  assert.deepEqual(avertissements, []);
  assert.deepEqual(donnees.formats.map(f => [f.cle, libelleFormat(f)]), [['tournoi-3v3v3v3', '3v3v3v3'], ['finale-3v3', '3v3']]);
  assert.equal(donnees.score.type, 'placement');
  assert.deepEqual(donnees.cartes[0].modes, ['cashout'], 'mode inconnu retiré');
  assert.equal(donnees.personnages[0].classe, 'light');
  assert.equal(donnees.personnages[1].classe, null, 'classe inconnue retirée');
  assert.deepEqual(donnees.champs.map(c => c.valeur), [3, 'Exemple']);
  assert.deepEqual(donnees.sources.map(s => s.url), ['https://wiki-exemple.fr/the-finals']);
  assert.equal(libelleFormat({ equipes: 20, joueursParEquipe: 3 }), '20 × 3');
});

test('schéma strict : la première erreur lève 400 profil-invalide avec son chemin ; champs inconnus jetés', () => {
  const erreur = (donnees, chemin, raison) => {
    try {
      validerDonnees(donnees);
      assert.fail('attendu : erreur');
    } catch (e) {
      assert.equal(e.statut, 400);
      assert.equal(e.code, 'profil-invalide');
      assert.deepEqual(e.details, { chemin, raison });
    }
  };
  erreur({ formats: [{ nom: '5v5', equipes: 0, joueursParEquipe: 5 }] }, 'formats.0.equipes', 'nombre-hors-limites');
  erreur({ formats: [{ nom: '5v5', equipes: 2, joueursParEquipe: 5, bo: [4] }] }, 'formats.0.bo', 'bo');
  erreur({ cartes: [{ nom: 'A', image: 'http://images-exemple.fr/a.png' }] }, 'cartes.0.image', 'image');
  erreur({ cartes: [{ nom: 'A', image: 'https://192.168.1.10/a.png' }] }, 'cartes.0.image', 'image');
  erreur({ cartes: [{ nom: 'A', image: 'javascript:alert(1)' }] }, 'cartes.0.image', 'image');
  erreur({ cartes: [{ nom: 'Ascent' }, { nom: 'ascent' }] }, 'cartes.1.cle', 'doublon');
  erreur({ score: { type: 'rounds' } }, 'score.roundsGagnants', 'requis');
  erreur({ score: { type: 'kills' } }, 'score.type', 'type-score');
  erreur({ personnages: [{ nom: '' }] }, 'personnages.0.nom', 'texte-requis');
  erreur({ roster: { titulaires: 0 } }, 'roster.titulaires', 'nombre-hors-limites');
  erreur({ cartes: 'Ascent' }, 'cartes', 'liste');
  const { donnees } = validerDonnees({ cartes: [{ nom: 'A', script: '<script>', __proto__x: 1 }], inconnu: true });
  assert.deepEqual(Object.keys(donnees.cartes[0]).sort(), ['actif', 'cle', 'image', 'modes', 'nom']);
  assert.ok(!('inconnu' in donnees));
  assert.throws(() => validerEntete({ nom: 'IA', cle: 'ia' }, { avecCle: true }), e => e.code === 'profil-invalide' && e.details.chemin === 'cle');
  assert.throws(() => validerEntete({ nom: 'X', couleur: 'rouge' }), e => e.details?.chemin === 'nom' || e.details?.chemin === 'couleur');
  assert.deepEqual(validerEntete({ nom: 'The Finals', couleur: '#D31F3C' }, { avecCle: true }), { cle: 'the-finals', nom: 'The Finals', couleur: '#d31f3c', icone: null });
});

test('schéma tolérant (réponse d’IA) : éléments invalides retirés avec avertissement, image refusée retirée seule', () => {
  const { donnees, avertissements } = validerDonnees(
    {
      formats: [{ nom: 'ok', equipes: 2, joueursParEquipe: 5, bo: [1] }, { nom: 'ko', equipes: 999, joueursParEquipe: 5 }],
      cartes: [{ nom: 'Carte', image: 'http://pistage-exemple.fr/pixel.gif' }, 'pas un objet'],
      score: { type: 'inconnu' },
      roster: 'cinq',
    },
    { tolerant: true },
  );
  assert.deepEqual(donnees.formats.map(f => f.nom), ['ok']);
  assert.deepEqual(donnees.cartes.map(c => [c.nom, c.image]), [['Carte', null]]);
  assert.equal(donnees.score, null);
  assert.equal(donnees.roster, null);
  assert.deepEqual(avertissements.map(a => a.chemin).sort(), ['cartes.0.image', 'cartes.1', 'formats.1.equipes', 'roster', 'score.type']);
});

test('différences : résumé par section (ajouts, modifications, retraits)', () => {
  const a = profilValorant();
  const b = structuredClone(a);
  b.cartes.push({ cle: 'nouvelle', nom: 'Nouvelle', image: null, actif: true, modes: [] });
  b.cartes.find(c => c.cle === 'breeze').actif = false;
  b.personnages = b.personnages.filter(x => x.cle !== 'iso');
  b.score.roundsGagnants = 12;
  const r = resumeDifferences(a, b);
  assert.deepEqual(r.cartes, { ajouts: ['Nouvelle'], modifications: ['Breeze'], retraits: [] });
  assert.deepEqual(r.personnages, { ajouts: [], modifications: [], retraits: ['Iso'] });
  assert.equal(r.score, true);
  assert.equal(r.roster, undefined);
});

// ------------------------------------------------------------------ Valorant préconfiguré, migration

test('Valorant préconfiguré : la migration pose exactement les données de l’app (maps, agents, rôles, score, roster)', async () => {
  const base = await baseMigree();
  const v = await base.premier("SELECT * FROM jeux WHERE cle = 'valorant'", []);
  assert.deepEqual(JSON.parse(v.donnees), profilValorant());
  assert.equal(v.base, 'valorant');
  assert.equal(Number(v.version), 1);
  const d = profilValorant();
  assert.equal(d.cartes.length, 12);
  assert.ok(d.cartes.every(c => c.actif && /^[a-z]+$/.test(c.cle)));
  assert.equal(d.cartes.find(c => c.cle === 'ascent').image, 'https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/listviewicon.png');
  assert.equal(d.personnages.length, 27);
  assert.deepEqual(d.personnages.find(p => p.cle === 'kay-o'), { cle: 'kay-o', nom: 'KAY/O', classe: 'initiateur', image: null, actif: true });
  assert.deepEqual(d.classes.map(c => c.cle), ['duelliste', 'initiateur', 'controleur', 'sentinelle']);
  assert.deepEqual(d.rolesJoueurs.map(r => r.nom), ['Duelliste', 'Contrôleur', 'Initiateur', 'Sentinelle', 'Flex', 'IGL']);
  assert.deepEqual(d.score, { type: 'rounds', roundsGagnants: 13, roundsParMiTemps: 12, prolongations: { active: true, regle: 'À 12-12 : prolongations, victoire avec deux rounds d’écart.' }, notes: '' });
  assert.deepEqual(d.roster, { titulaires: 5, remplacants: 2 });
  assert.deepEqual(d.formats.map(f => [libelleFormat(f), f.bo]), [['5v5', [1, 3, 5]]]);
  // Mêmes clés que l'éditeur de strats (src/esport/strats/assets.ts) : les strats existantes restent reliées à leur map.
  const assets = readFileSync(new URL('../../src/esport/strats/assets.ts', import.meta.url), 'utf8');
  for (const c of d.cartes) assert.ok(assets.includes(`'${c.nom}'`), c.nom);
  const versions = await base.tous("SELECT version, motif FROM jeu_versions WHERE jeu_cle = 'valorant'", []);
  assert.deepEqual(versions.map(x => [Number(x.version), x.motif]), [[1, 'preconfiguration']]);
  assert.deepEqual(JSON.parse((await base.premier("SELECT donnees FROM jeux WHERE cle = 'autre'", [])).donnees), profilAutre());
  // The Finals n'est pas préconfiguré (laissé à l'assistant IA).
  assert.equal(await base.premier("SELECT cle FROM jeux WHERE cle = 'the-finals'", []), null);
});

test('migration sur une base existante : les teams sont rattachées (valorant, autre ; tout le reste → Valorant)', async () => {
  const base = await baseVierge();
  const toutes = lireMigrations();
  await appliquerMigrations(base, toutes.filter(m => m.nom < '0021'));
  const d = '2026-01-01T00:00:00.000Z';
  for (const [id, jeu] of [['t1', 'valorant'], ['t2', 'autre'], ['t3', 'lol'], ['t4', '']]) {
    await base.executer('INSERT INTO teams (id, nom, slug, jeu, cree_par, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, id, id, jeu, 'principal', d, d]);
  }
  assert.deepEqual(await appliquerMigrations(base, toutes), toutes.filter(m => m.nom >= '0021').map(m => m.nom));
  const jeux = await base.tous("SELECT id, jeu FROM teams WHERE genre <> 'cm' ORDER BY id", []);
  assert.deepEqual(jeux.map(t => [t.id, t.jeu]), [['t1', 'valorant'], ['t2', 'autre'], ['t3', 'valorant'], ['t4', 'valorant']]);
});

// ------------------------------------------------------------------ Liaison team ↔ jeu

test('team ↔ jeu : jeu obligatoire et actif à la création, nom du jeu dans les listes, profil lu par les membres seulement', async () => {
  const b = await banc({ creationTeams: 'tous' });
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' } } });
  const f = sessions.fondateur;
  let r = await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Sans jeu', preset: 'minimal' } });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, 'jeu-requis');
  r = await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Jeu inconnu', jeu: 'pas-un-jeu', preset: 'minimal' } });
  assert.equal(r.corps.code, 'jeu');
  r = await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Injection', jeu: "valorant' OR '1'='1", preset: 'minimal' } });
  assert.equal(r.corps.code, 'jeu');
  // Profil propre de la team : lu par un Joueur, avec les maps et agents de Valorant.
  r = await b.appel(`/teams/${teamId}/jeu`, { jeton: sessions.lea12345 });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.cle, 'valorant');
  assert.equal(r.corps.base, 'valorant');
  assert.equal(r.corps.donnees.cartes.length, 12);
  // Un compte hors de la team : 404 (on ne dit pas qu'elle existe).
  const bob = await b.session('bob12345', 'Bob');
  assert.equal((await b.appel(`/teams/${teamId}/jeu`, { jeton: bob })).statut, 404);
  // Nom du jeu dans la liste et le détail.
  const liste = (await b.appel('/teams', { jeton: sessions.lea12345 })).corps.teams;
  assert.equal(liste[0].jeuNom, 'Valorant');
  assert.equal((await b.appel(`/teams/${teamId}`, { jeton: f })).corps.team.jeuNom, 'Valorant');
  // Profil archivé : plus proposé à la création, mais la team qui l'a le garde (et peut le garder en modification).
  assert.equal((await b.appel('/jeux/valorant/archiver', { methode: 'POST', jeton: f, corps: { archive: true } })).statut, 200);
  assert.equal((await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Archivé', jeu: 'valorant', preset: 'minimal' } })).corps.code, 'jeu');
  assert.equal((await b.appel(`/teams/${teamId}`, { methode: 'PATCH', jeton: f, corps: { jeu: 'valorant', nom: 'Faucons' } })).statut, 200);
  assert.equal((await b.appel(`/teams/${teamId}/jeu`, { jeton: sessions.lea12345 })).corps.statut, 'archive');
  assert.ok(!(await b.appel('/jeux', { jeton: sessions.lea12345 })).corps.jeux.some(j => j.cle === 'valorant'));
  // Changer le jeu d'une team : un profil actif.
  r = await b.appel(`/teams/${teamId}`, { methode: 'PATCH', jeton: f, corps: { jeu: 'autre' } });
  assert.equal(r.corps.team.jeu, 'autre');
  assert.equal((await b.appel(`/teams/${teamId}`, { methode: 'PATCH', jeton: f, corps: { jeu: 'valorant' } })).corps.code, 'jeu');
});

// ------------------------------------------------------------------ Gestion, versions, permissions

test('gestion : création, modification versionnée, conflit, historique, restauration ; suppression refusée si utilisé', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  let r = await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'The Finals', couleur: '#d31f3c', donnees: FINALS } });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.cle, 'the-finals');
  assert.equal(r.corps.version, 1);
  assert.equal(r.corps.donnees.formats[0].equipes, 4);
  assert.equal((await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'The Finals' } })).corps.code, 'jeu-existe');
  assert.equal((await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'Mauvais', donnees: { cartes: [{ nom: 'X', image: 'http://x-exemple.fr/a.png' }] } } })).corps.details.chemin, 'cartes.0.image');
  // Modification : nouvelle version, résumé des différences.
  const donnees = { ...r.corps.donnees, cartes: [...r.corps.donnees.cartes, { nom: 'Deuxième carte' }] };
  r = await b.appel('/jeux/the-finals', { methode: 'PATCH', jeton: f, corps: { version: 1, donnees, couleur: '#aa0000' } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.version, 2);
  // Version périmée : 409 (deux onglets ouverts).
  r = await b.appel('/jeux/the-finals', { methode: 'PATCH', jeton: f, corps: { version: 1, nom: 'Autre nom' } });
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, 'version-conflit');
  assert.equal(r.corps.details.version, 2);
  assert.equal((await b.appel('/jeux/the-finals', { methode: 'PATCH', jeton: f, corps: { nom: 'Sans version' } })).corps.code, 'version-requise');
  // Historique.
  let h = (await b.appel('/jeux/the-finals/versions', { jeton: f })).corps.versions;
  assert.deepEqual(h.map(v => [v.version, v.motif]), [[2, 'modification'], [1, 'creation']]);
  assert.deepEqual(h[0].resume.cartes, { ajouts: ['Deuxième carte'], modifications: [], retraits: [] });
  assert.equal(h[0].resume.couleur, true);
  assert.equal(h[0].auteur.pseudo, 'Fondateur');
  assert.equal((await b.appel('/jeux/the-finals/versions/1', { jeton: f })).corps.donnees.cartes.length, 1);
  // Restauration de la version 1 : version 3 (rien n'est effacé de l'historique).
  r = await b.appel('/jeux/the-finals/versions/1/restaurer', { methode: 'POST', jeton: f, corps: { version: 2 } });
  assert.equal(r.corps.version, 3);
  assert.equal(r.corps.couleur, '#d31f3c');
  h = (await b.appel('/jeux/the-finals/versions', { jeton: f })).corps.versions;
  assert.deepEqual(h.map(v => v.motif), ['restauration', 'modification', 'creation']);
  // Utilisé par une team : suppression refusée ; archivage possible.
  const team = await b.appel('/teams', { methode: 'POST', jeton: f, corps: { nom: 'Finalistes', jeu: 'the-finals', preset: 'minimal' } });
  assert.equal(team.statut, 200);
  assert.equal(team.corps.team.jeuNom, 'The Finals');
  r = await b.appel('/jeux/the-finals', { methode: 'DELETE', jeton: f });
  assert.equal(r.corps.code, 'jeu-utilise');
  await b.appel(`/teams/${team.corps.team.id}`, { methode: 'DELETE', jeton: f });
  assert.equal((await b.appel('/jeux/the-finals', { methode: 'DELETE', jeton: f })).statut, 200);
  assert.equal((await b.appel('/jeux/the-finals', { jeton: f })).statut, 404);
  // Clés réservées par les routes.
  assert.equal((await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'Propositions' } })).corps.code, 'profil-invalide');
});

test('permissions : jeux.gerer (Fondateur, ou délégué par lui) ; Administration de l’IA réservée au Fondateur', async () => {
  const b = await banc();
  const { teamId, sessions } = await teamAvecMembres(b, { membres: { lea12345: { pseudo: 'Léa', role: 'joueur' }, own12345: { pseudo: 'Owen', role: 'proprietaire' } } });
  const f = sessions.fondateur;
  const lea = sessions.lea12345;
  const owen = sessions.own12345;
  // Lecture des profils actifs : tout compte Esport (création de team), sans les détails de gestion.
  let r = await b.appel('/jeux', { jeton: lea });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.gerer, false);
  assert.ok(r.corps.jeux.some(j => j.cle === 'valorant' && j.resume.cartes === 12));
  assert.equal(r.corps.ia, undefined);
  assert.equal(r.corps.jeux[0].teams, undefined);
  assert.equal((await b.appel('/moi', { jeton: lea })).corps.peutGererJeux, false);
  assert.equal((await b.appel('/moi', { jeton: f })).corps.peutGererJeux, true);
  // Écriture et routes de gestion : 403, même pour le Propriétaire d'une team.
  const refus = [
    ['POST', '/jeux', { nom: 'Pirate' }],
    ['PATCH', '/jeux/valorant', { version: 1, nom: 'Pirate' }],
    ['POST', '/jeux/valorant/archiver', { archive: true }],
    ['DELETE', '/jeux/autre'],
    ['GET', '/jeux/valorant/versions'],
    ['GET', '/jeux/valorant/versions/1'],
    ['POST', '/jeux/valorant/versions/1/restaurer', { version: 1 }],
    ['PUT', '/jeux/valorant/maj', { majAuto: false }],
    ['POST', '/jeux/valorant/verifier', {}],
    ['GET', '/jeux/propositions'],
    ['POST', '/jeux/valorant/propositions/decider', { acceptees: [] }],
    ['GET', '/jeux/ia'],
    ['POST', '/jeux/ia/brouillons', { nom: 'The Finals' }],
    ['GET', '/jeux/ia/travaux'],
    ['GET', '/jeux/ia/travaux/00000000-0000-4000-8000-000000000000'],
  ];
  for (const jeton of [lea, owen]) {
    for (const [methode, chemin, corps] of refus) {
      const x = await b.appel(chemin, { methode, jeton, corps });
      assert.equal(x.statut, 403, `${methode} ${chemin} : ${x.statut} ${JSON.stringify(x.corps)}`);
      assert.equal(x.corps.code, 'permission');
    }
  }
  // Délégation par le Fondateur : Léa gère les profils… mais pas l'Administration de l'IA.
  assert.equal((await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: lea, corps: { ajouter: ['lea12345'] } })).corps.code, 'super-admin');
  r = await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: f, corps: { ajouter: ['lea12345', 'inconnu99'] } });
  assert.equal(r.corps.code, 'compte-introuvable');
  r = await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: f, corps: { ajouter: ['lea12345'] } });
  assert.deepEqual(r.corps.gestionnaires.map(g => [g.compte, g.pseudo]), [['lea12345', 'Léa']]);
  assert.equal((await b.appel('/moi', { jeton: lea })).corps.peutGererJeux, true);
  r = await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: lea, corps: { version: 1, couleur: '#ff0000' } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.version, 2);
  assert.equal((await b.appel('/jeux/ia', { jeton: lea })).statut, 200);
  for (const [methode, chemin] of [['PUT', '/jeux/ia/reglages'], ['POST', '/jeux/ia/test'], ['GET', '/jeux/ia/gestionnaires']]) {
    const x = await b.appel(chemin, { methode, jeton: lea, corps: methode === 'GET' ? undefined : {} });
    assert.equal(x.statut, 403, chemin);
    assert.equal(x.corps.code, 'super-admin');
  }
  // Retrait de la délégation : effet immédiat.
  await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: f, corps: { retirer: ['lea12345'] } });
  assert.equal((await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: lea, corps: { version: 2, couleur: '#00ff00' } })).statut, 403);
  // Le profil de la team reste lisible par ses membres, quel que soit leur rôle.
  assert.equal((await b.appel(`/teams/${teamId}/jeu`, { jeton: lea })).statut, 200);
  // Sans session : 401.
  assert.equal((await b.appel('/jeux')).statut, 401);
});

test('export / import : profils, historique, propositions et délégations suivent ; les profils préconfigurés sont remplacés', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  await b.session('lea12345', 'Léa');
  await b.appel('/jeux', { methode: 'POST', jeton: f, corps: { nom: 'The Finals', donnees: FINALS } });
  await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: f, corps: { version: 1, nom: 'VALORANT' } });
  await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: f, corps: { ajouter: ['lea12345'] } });
  const exporte = await exporterBase(b.base, b.horloge.t);
  assert.equal(exporte.tables.jeux.length, 3);
  assert.equal(exporte.tables.jeu_versions.length, 4);
  assert.equal(exporte.tables.permissions_globales.length, 1);
  const cible = await baseMigree();
  const bilan = await importerBase(cible, JSON.parse(JSON.stringify(exporte)));
  assert.equal(bilan.jeux, 3);
  assert.deepEqual(await exporterBase(cible, b.horloge.t), exporte);
  assert.equal((await cible.premier("SELECT nom FROM jeux WHERE cle = 'valorant'", [])).nom, 'VALORANT');
});

test('RGPD : export du compte (délégation, versions écrites) ; suppression → délégation retirée, versions sans auteur', async () => {
  const b = await banc();
  const f = await b.session('principal', 'Fondateur');
  const lea = await b.session('lea12345', 'Léa');
  await b.appel('/jeux/ia/gestionnaires', { methode: 'PUT', jeton: f, corps: { ajouter: ['lea12345'] } });
  await b.appel('/jeux/valorant', { methode: 'PATCH', jeton: lea, corps: { version: 1, couleur: '#ff0000' } });
  const exporte = (await b.appel('/moi/export', { jeton: lea })).corps;
  assert.deepEqual(exporte.permissionsGlobales.map(p => p.permission), ['jeux.gerer']);
  assert.deepEqual(exporte.versionsProfilsJeu.map(v => [v.jeu, v.version, v.motif]), [['valorant', 2, 'modification']]);
  assert.equal((await b.appel('/moi', { methode: 'DELETE', jeton: lea })).statut, 200);
  assert.equal(await b.base.premier("SELECT compte_id FROM permissions_globales WHERE compte_id = 'lea12345'", []), null);
  assert.equal((await b.base.premier("SELECT auteur_id FROM jeu_versions WHERE jeu_cle = 'valorant' AND version = 2", [])).auteur_id, null);
  assert.equal((await b.base.premier("SELECT maj_par FROM jeux WHERE cle = 'valorant'", [])).maj_par, null);
});
