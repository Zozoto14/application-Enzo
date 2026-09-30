import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ETENDUES, MOTIF_PROFIL, changementPermis, extensionPermise, fichierAutorise } from './portee.mjs';

test('un ami n’atteint que ses fichiers et la liste des profils', () => {
  assert.equal(fichierAutorise('coffre-lea0000001', 'lea0000001'), true);
  assert.equal(fichierAutorise('portefeuille-lea0000001', 'lea0000001'), true);
  assert.equal(fichierAutorise('profils', 'lea0000001'), true);
  assert.equal(fichierAutorise('coffre', 'lea0000001'), false);
  assert.equal(fichierAutorise('portefeuille', 'lea0000001'), false);
  assert.equal(fichierAutorise('coffre-hugo000002', 'lea0000001'), false);
  assert.equal(fichierAutorise('portefeuille-hugo000002', 'lea0000001'), false);
});

test('l’administrateur gère tous les fichiers', () => {
  assert.equal(fichierAutorise('coffre-hugo000002', 'principal'), true);
  assert.equal(fichierAutorise('coffre', 'principal'), true);
});

test('un ami ne passe pas à un autre compte sans quitter le sien', () => {
  assert.equal(changementPermis('lea0000001', 'principal'), false);
  assert.equal(changementPermis('lea0000001', 'hugo000002'), false);
  assert.equal(changementPermis('lea0000001', 'lea0000001'), true);
  assert.equal(changementPermis('principal', 'lea0000001'), true);
  assert.equal(changementPermis(undefined, 'lea0000001'), true);
  // Un titulaire (Administrateur) passe au compte qu'il a ajouté à sa portée (séquestre) ; jamais à principal.
  assert.equal(changementPermis('hugo000002', 'lea0000001', ['lea0000001']), true);
  assert.equal(changementPermis('hugo000002', 'max0000003', ['lea0000001']), false);
  assert.equal(changementPermis('hugo000002', 'principal', ['principal']), false);
});

test('identifiants de profil : ni chemin ni joker', () => {
  assert.equal(MOTIF_PROFIL.test('../coffre'), false);
  assert.equal(MOTIF_PROFIL.test('lea0000001'), true);
  assert.equal(MOTIF_PROFIL.test('principal'), true);
});

test('gestionnaire : la portée s’étend seulement aux comptes demandés, jamais à un autre', () => {
  assert.equal(fichierAutorise('coffre-hugo000002', 'lea0000001', []), false);
  assert.equal(fichierAutorise('coffre-hugo000002', 'lea0000001', ['hugo000002']), true);
  assert.equal(fichierAutorise('portefeuille-hugo000002', 'lea0000001', ['hugo000002']), true);
  assert.equal(fichierAutorise('coffre-zoe0000003', 'lea0000001', ['hugo000002']), false);
  assert.equal(fichierAutorise('coffre', 'lea0000001', ['hugo000002']), false);
  assert.equal(fichierAutorise('portefeuille', 'lea0000001', ['hugo000002']), false);
});

test('l’extension de portée est refusée hors compte ami ouvert', () => {
  assert.equal(extensionPermise('lea0000001', 'hugo000002', []), true);
  assert.equal(extensionPermise(undefined, 'hugo000002', []), false);
  assert.equal(extensionPermise('principal', 'hugo000002', []), false);
  assert.equal(extensionPermise('lea0000001', 'principal', []), false);
  assert.equal(extensionPermise('lea0000001', '../coffre', []), false);
  assert.equal(extensionPermise('lea0000001', 'lea0000001', []), false);
  const pleines = Array.from({ length: MAX_ETENDUES }, (_, i) => `ami${String(i).padStart(7, '0')}`);
  assert.equal(extensionPermise('lea0000001', 'hugo000002', pleines), false);
  assert.equal(extensionPermise('lea0000001', pleines[0], pleines), true);
});
