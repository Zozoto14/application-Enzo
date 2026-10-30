/**
 * Après l'installation de Jest : délais d'attente généreux pour les runners lents ou chargés (CI à 2-4 cœurs
 * avec ~280 fichiers de test en parallèle). Aucun test n'attend ces délais quand tout va bien : ce sont des
 * plafonds, pas des pauses.
 */
const { configure } = require('@testing-library/react-native');

// findBy* / waitFor : 1 s par défaut, trop court quand l'écran est lourd et la machine saturée.
configure({ asyncUtilTimeout: 10000 });
