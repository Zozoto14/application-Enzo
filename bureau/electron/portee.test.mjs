import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTIF_PROFIL, changementPermis, fichierAutorise } from './portee.mjs';

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
});

test('identifiants de profil : ni chemin ni joker', () => {
  assert.equal(MOTIF_PROFIL.test('../coffre'), false);
  assert.equal(MOTIF_PROFIL.test('lea0000001'), true);
  assert.equal(MOTIF_PROFIL.test('principal'), true);
});
