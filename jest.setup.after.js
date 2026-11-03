/**
 * Après l'installation de Jest : délais d'attente généreux pour les runners lents ou chargés (CI à 2-4 cœurs
 * avec ~280 fichiers de test en parallèle). Aucun test n'attend ces délais quand tout va bien : ce sont des
 * plafonds, pas des pauses.
 */
const { configure } = require('@testing-library/react-native');

// findBy* / waitFor : 1 s par défaut, trop court quand l'écran est lourd et la machine saturée.
configure({ asyncUtilTimeout: 10000 });

// Temps réel de l'Esport (src/esport/tempsReel) : les canaux ouverts par un écran testé (flux SSE, attente longue,
// reconnexion) sont fermés à la fin de chaque fichier. Sans cela, Jest « en série » (CI à 2 cœurs : un seul
// processus) ne s'arrête jamais après les tests (« Jest did not exit ») et le workflow Site (o2switch) expire.
afterAll(() => {
  try {
    require('./src/esport/tempsReel/hooks').oublierCanaux();
  } catch {
    // Module absent ou déjà déchargé : rien à fermer.
  }
});
