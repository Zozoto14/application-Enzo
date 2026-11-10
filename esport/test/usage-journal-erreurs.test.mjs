/**
 * Erreurs JS des apps recopiées dans ~/logs/esport.log (esport/noyau/usage/collecte.mjs, docs/performance.md) :
 * message nettoyé, sans compte ; une même erreur au plus une fois par 10 minutes ; 30 lignes par minute au plus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerJournalErreursClient, nettoyerMessage, JOURNAL_ERREURS_PAR_MINUTE } from '../noyau/usage/collecte.mjs';

function journal() {
  const lignes = [];
  let t = Date.UTC(2026, 10, 10, 12, 0, 0);
  const j = creerJournalErreursClient({ ecrire: l => lignes.push(l), maintenant: () => t });
  return { j, lignes, avancer: ms => (t += ms) };
}

test('une ligne lisible : empreinte, appareil, page, message nettoyé', () => {
  const { j, lignes } = journal();
  const message = nettoyerMessage('[Tâches] TypeError: x is undefined (enzo@example.com, https://appdashboard.fr/assets/a.js)');
  assert.equal(j({ message, page: 'team.agenda.planning', appareil: 'tablette' }), true);
  assert.equal(lignes.length, 1);
  assert.match(lignes[0], /^erreur client \[[0-9a-f]{8}\] tablette team\.agenda\.planning : \[Tâches\] TypeError: x is undefined/);
  assert.doesNotMatch(lignes[0], /enzo|example\.com|https:/);
});

test('même erreur répétée : une seule ligne par 10 minutes', () => {
  const { j, lignes, avancer } = journal();
  for (let i = 0; i < 5; i++) j({ message: 'Erreur A', page: null, appareil: 'pc' });
  assert.equal(lignes.length, 1);
  avancer(10 * 60_000 + 1);
  j({ message: 'Erreur A', page: null, appareil: 'pc' });
  assert.equal(lignes.length, 2);
});

test('rafale : 30 lignes par minute au plus, puis un résumé', () => {
  const { j, lignes, avancer } = journal();
  for (let i = 0; i < 50; i++) j({ message: `Erreur ${'x'.repeat(i + 1)}`, page: null, appareil: 'pc' });
  assert.equal(lignes.length, JOURNAL_ERREURS_PAR_MINUTE);
  avancer(60_000);
  j({ message: 'Erreur nouvelle', page: null, appareil: 'pc' });
  assert.match(lignes.at(-2), /20 erreur\(s\) non recopiée\(s\)/);
  assert.match(lignes.at(-1), /Erreur nouvelle/);
});
