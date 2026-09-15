const STORAGE_KEY = 'budget-app-data-v1';

export const BUDGET_SPACES = [
  { id: 'personnel', label: 'Personnel', icon: '🏠' },
  { id: 'candidature', label: 'Candidatures', icon: '💼' },
  { id: 'projet', label: 'Projet', icon: '📁' },
];

const DEFAULT_CATEGORIES = {
  personnel: ['Salaire', 'Autres revenus', 'Alimentation', 'Logement', 'Transport', 'Loisirs', 'Santé', 'Autres dépenses'],
  candidature: ['Déplacements entretien', 'Formations', 'Abonnements', 'Habillement', 'Autres'],
  projet: ['Subventions reçues', 'Matériel', 'Communication', 'Événements', 'Autres'],
};

function defaultState() {
  return {
    transactions: [],
    categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const fallback = defaultState();
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      categories: parsed.categories && typeof parsed.categories === 'object' ? { ...fallback.categories, ...parsed.categories } : fallback.categories,
    };
  } catch (e) {
    console.error('Erreur de lecture des données locales', e);
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Erreur de sauvegarde des données locales', e);
  }
}

export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function spaceLabel(id) {
  const space = BUDGET_SPACES.find((s) => s.id === id);
  return space ? space.label : id;
}

export function spaceIcon(id) {
  const space = BUDGET_SPACES.find((s) => s.id === id);
  return space ? space.icon : '📦';
}
