export const SCHEMA_VERSION = 2;

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

export const COLLECTIONS = ['transactions', 'categories', 'budgets', 'recurring', 'goals', 'receipts'];

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

export function categoryId(space, name) {
  return `${space}::${name}`;
}

export function emptyState() {
  const state = { schemaVersion: SCHEMA_VERSION, settings: {} };
  COLLECTIONS.forEach((name) => { state[name] = {}; });
  return state;
}

export function defaultState() {
  const state = emptyState();
  const now = Date.now();
  Object.entries(DEFAULT_CATEGORIES).forEach(([space, names]) => {
    names.forEach((name) => {
      const id = categoryId(space, name);
      state.categories[id] = { id, space, name, updatedAt: now, deleted: false };
    });
  });
  return state;
}

// Accepts either a v1 state (arrays + plain category lists) or an already
// migrated v2 state, and always returns a well-formed v2 state.
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return defaultState();
  if (raw.schemaVersion === SCHEMA_VERSION) {
    const state = emptyState();
    COLLECTIONS.forEach((name) => {
      const source = raw[name];
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        Object.entries(source).forEach(([id, record]) => {
          if (record && typeof record === 'object') state[name][id] = { ...record, id };
        });
      }
    });
    state.settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    return state;
  }
  return migrateFromV1(raw);
}

function migrateFromV1(raw) {
  const state = emptyState();
  const now = Date.now();

  if (Array.isArray(raw.transactions)) {
    raw.transactions.forEach((tx) => {
      if (!tx || typeof tx !== 'object') return;
      const id = tx.id || uid();
      state.transactions[id] = {
        id,
        type: tx.type === 'income' ? 'income' : 'expense',
        amount: Number(tx.amount) || 0,
        space: tx.space || BUDGET_SPACES[0].id,
        category: tx.category || 'Autres',
        date: tx.date || new Date().toISOString().slice(0, 10),
        description: tx.description || '',
        receiptId: null,
        updatedAt: now,
        deleted: false,
      };
    });
  }

  const categories = raw.categories && typeof raw.categories === 'object' ? raw.categories : DEFAULT_CATEGORIES;
  Object.entries(categories).forEach(([space, names]) => {
    if (!Array.isArray(names)) return;
    names.forEach((name) => {
      const id = categoryId(space, name);
      state.categories[id] = { id, space, name, updatedAt: now, deleted: false };
    });
  });

  return state;
}

// ---------- Collection helpers ----------

export function activeRecords(state, collection) {
  return Object.values(state[collection] || {}).filter((record) => !record.deleted);
}

export function putRecord(state, collection, record) {
  const id = record.id || uid();
  state[collection][id] = { ...record, id, updatedAt: Date.now(), deleted: false };
  return state[collection][id];
}

// Deletions leave a tombstone: without one, a delete on this device would be
// resurrected by the next sync from a device that still has the record.
export function deleteRecord(state, collection, id) {
  const existing = state[collection][id];
  if (!existing) return;
  state[collection][id] = { id, deleted: true, updatedAt: Date.now() };
}

export function getSetting(state, key, fallback) {
  const entry = state.settings ? state.settings[key] : null;
  return entry && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : fallback;
}

export function setSetting(state, key, value) {
  if (!state.settings) state.settings = {};
  state.settings[key] = { value, updatedAt: Date.now() };
}

// ---------- Merge (last write wins per record) ----------

export function mergeStates(local, remote) {
  const merged = emptyState();

  COLLECTIONS.forEach((collection) => {
    const ids = new Set([...Object.keys(local[collection] || {}), ...Object.keys(remote[collection] || {})]);
    ids.forEach((id) => {
      const mine = (local[collection] || {})[id];
      const theirs = (remote[collection] || {})[id];
      if (!mine) merged[collection][id] = theirs;
      else if (!theirs) merged[collection][id] = mine;
      else merged[collection][id] = (theirs.updatedAt || 0) > (mine.updatedAt || 0) ? theirs : mine;
    });
  });

  const settingKeys = new Set([...Object.keys(local.settings || {}), ...Object.keys(remote.settings || {})]);
  settingKeys.forEach((key) => {
    const mine = (local.settings || {})[key];
    const theirs = (remote.settings || {})[key];
    if (!mine) merged.settings[key] = theirs;
    else if (!theirs) merged.settings[key] = mine;
    else merged.settings[key] = (theirs.updatedAt || 0) > (mine.updatedAt || 0) ? theirs : mine;
  });

  return merged;
}

// ---------- Domain logic ----------

export function categoriesForSpace(state, space) {
  return activeRecords(state, 'categories')
    .filter((cat) => cat.space === space)
    .map((cat) => cat.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

export function transactionsInScope(state, { space = 'all', period = null, search = '' } = {}) {
  const scope = space === 'all' ? BUDGET_SPACES.map((s) => s.id) : [space];
  const now = new Date();
  return activeRecords(state, 'transactions')
    .filter((tx) => scope.includes(tx.space))
    .filter((tx) => {
      if (!period) return true;
      const d = new Date(tx.date);
      if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      if (period === 'year') return d.getFullYear() === now.getFullYear();
      return true;
    })
    .filter((tx) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (tx.description || '').toLowerCase().includes(q) || (tx.category || '').toLowerCase().includes(q);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
}

export function computeTotals(list) {
  let income = 0;
  let expense = 0;
  list.forEach((tx) => {
    if (tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  });
  return { income, expense, balance: income - expense };
}

export function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function transactionsForMonth(state, spaceFilter, date) {
  const scope = spaceFilter === 'all' ? BUDGET_SPACES.map((s) => s.id) : [spaceFilter];
  const key = monthKey(date);
  return activeRecords(state, 'transactions').filter((tx) => scope.includes(tx.space) && monthKey(tx.date) === key);
}

// Spend against each budget for the given month, so the UI can flag overruns.
export function budgetProgress(state, date = new Date()) {
  const key = monthKey(date);
  const spentByCategory = {};
  activeRecords(state, 'transactions').forEach((tx) => {
    if (tx.type !== 'expense' || monthKey(tx.date) !== key) return;
    const id = categoryId(tx.space, tx.category);
    spentByCategory[id] = (spentByCategory[id] || 0) + tx.amount;
  });

  return activeRecords(state, 'budgets')
    .map((budget) => {
      const spent = spentByCategory[categoryId(budget.space, budget.category)] || 0;
      const ratio = budget.amount > 0 ? spent / budget.amount : 0;
      return { ...budget, spent, remaining: budget.amount - spent, ratio, exceeded: spent > budget.amount };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

export function goalProgress(goal) {
  const ratio = goal.targetAmount > 0 ? Math.min(goal.savedAmount / goal.targetAmount, 1) : 0;
  return { ...goal, ratio, remaining: Math.max(goal.targetAmount - goal.savedAmount, 0), reached: goal.savedAmount >= goal.targetAmount };
}

function addMonths(date, count) {
  const d = new Date(date.getFullYear(), date.getMonth() + count, 1);
  return d;
}

// Materializes one transaction per elapsed month for each active template. Runs on
// every app open and is idempotent: lastGeneratedMonth advances as it goes, and a
// transaction id derived from the template plus month keeps re-runs from duplicating.
export function generateRecurringTransactions(state, today = new Date()) {
  const created = [];
  activeRecords(state, 'recurring').forEach((template) => {
    if (!template.startDate) return;
    const start = new Date(template.startDate);
    if (Number.isNaN(start.getTime())) return;
    const end = template.endDate ? new Date(template.endDate) : null;

    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (template.lastGeneratedMonth) {
      const [year, month] = template.lastGeneratedMonth.split('-').map(Number);
      cursor = addMonths(new Date(year, month - 1, 1), 1);
    }

    const limit = new Date(today.getFullYear(), today.getMonth(), 1);
    let guard = 0;
    while (cursor <= limit && guard < 240) {
      guard += 1;
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const day = Math.min(Math.max(Number(template.dayOfMonth) || 1, 1), daysInMonth);
      const occurrence = new Date(cursor.getFullYear(), cursor.getMonth(), day);

      const withinRange = occurrence >= start && (!end || occurrence <= end);
      const notInFuture = occurrence <= today;
      if (withinRange && notInFuture) {
        const id = `rec-${template.id}-${monthKey(occurrence)}`;
        if (!state.transactions[id]) {
          state.transactions[id] = {
            id,
            type: template.type,
            amount: template.amount,
            space: template.space,
            category: template.category,
            date: occurrence.toISOString().slice(0, 10),
            description: template.description || 'Transaction récurrente',
            recurringId: template.id,
            receiptId: null,
            updatedAt: Date.now(),
            deleted: false,
          };
          created.push(state.transactions[id]);
        }
        state.recurring[template.id] = { ...template, lastGeneratedMonth: monthKey(occurrence), updatedAt: Date.now() };
      }
      cursor = addMonths(cursor, 1);
    }
  });
  return created;
}
