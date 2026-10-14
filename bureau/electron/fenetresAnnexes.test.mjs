import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_ANNEXES, decisionOuverture, lireFonctionnalites, optionsAnnexe, tailleAnnexe } from './fenetresAnnexes.mjs';

const NOM = 'appdashboard-annexe-taches-ab12cd34ef56gh78';

test('seul about:blank sous le nom réservé ouvre une annexe', () => {
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: NOM }), 'annexe');
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: 'appdashboard-annexe-taches' }), 'refus');
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: 'autre' }), 'refus');
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: `${NOM}/../x` }), 'refus');
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: 'appdashboard-annexe-TACHES-ab12cd34ef56gh78' }), 'refus');
  // Le nom réservé n'ouvre jamais une autre adresse dans une fenêtre qui porte le préchargement.
  assert.equal(decisionOuverture({ url: 'file:///C:/x.html', frameName: NOM }), 'refus');
  assert.equal(decisionOuverture({ url: 'https://exemple.fr', frameName: NOM }), 'externe');
  assert.equal(decisionOuverture({ url: 'javascript:alert(1)', frameName: NOM }), 'refus');
});

test('liens web et mailto : vers le système, le reste refusé', () => {
  assert.equal(decisionOuverture({ url: 'https://exemple.fr/page', frameName: '' }), 'externe');
  assert.equal(decisionOuverture({ url: 'mailto:moi@exemple.fr', frameName: '' }), 'externe');
  assert.equal(decisionOuverture({ url: 'file:///etc/passwd', frameName: '' }), 'refus');
  assert.equal(decisionOuverture({ url: 'data:text/html,x', frameName: '' }), 'refus');
});

test('nombre d’annexes borné', () => {
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: NOM }, MAX_ANNEXES - 1), 'annexe');
  assert.equal(decisionOuverture({ url: 'about:blank', frameName: NOM }, MAX_ANNEXES), 'refus');
});

test('mêmes préférences de sécurité que la fenêtre principale', () => {
  const options = optionsAnnexe({ principales: { preload: '/app/prechargement.cjs' }, icone: '/app/i.png', demande: { width: 900, height: 700, x: 40, y: 30 } });
  assert.deepEqual(options.webPreferences, { preload: '/app/prechargement.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true });
  assert.equal(options.width, 900);
  assert.equal(options.height, 700);
  assert.equal(options.x, 40);
  assert.equal(options.y, 30);
  assert.equal(options.minWidth, 720);
});

test('taille bornée, place facultative', () => {
  assert.deepEqual(tailleAnnexe({ width: 100, height: 100 }), { width: 720, height: 560 });
  assert.deepEqual(tailleAnnexe({ width: 99999, height: 99999 }), { width: 4000, height: 3000 });
  assert.deepEqual(tailleAnnexe({}), { width: 1200, height: 860 });
  const sansPlace = optionsAnnexe({ principales: { preload: 'p' }, icone: 'i' });
  assert.equal('x' in sansPlace, false);
});

test('lecture des options de window.open', () => {
  assert.deepEqual(lireFonctionnalites('width=1200,height=800,left=10,top=20'), { width: 1200, height: 800, x: 10, y: 20 });
  assert.deepEqual(lireFonctionnalites('noopener,width=abc'), {});
  assert.deepEqual(lireFonctionnalites(undefined), {});
});

test('le processus principal applique la règle, et une seule instance', () => {
  const principal = readFileSync(new URL('./principal.mjs', import.meta.url), 'utf8');
  assert.match(principal, /decisionOuverture\(\{ url, frameName \}, annexes\.size\)/);
  assert.match(principal, /did-create-window/);
  assert.match(principal, /requestSingleInstanceLock/);
  // Montrer la fenêtre (icône, notification, seconde instance) : toujours la principale.
  assert.match(principal, /function montrerFenetre\(\) \{\n {2}const fenetre = principaleVivante\(\) \?\? creerFenetre\(\);/);
  const pont = readFileSync(new URL('./prechargement.cjs', import.meta.url), 'utf8');
  assert.match(pont, /fenetres: \{ version: 1 \}/);
});
