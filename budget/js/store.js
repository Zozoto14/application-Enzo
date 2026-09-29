import { saveVault, getMode, getAccountInfo } from './storage.js';
import { scheduleSync, cancelScheduledSync } from './sync.js';
import { putRecord, deleteRecord } from './model.js';

export const store = {
  state: null,
  vaultKey: null,
  mode: null,
  account: null,
  ui: {
    tab: 'dashboard',
    dashboardSpace: 'all',
    dashboardPeriod: 'month',
    txSpace: 'all',
    txSearch: '',
    privacyMode: false,
  },
};

let renderer = () => {};
let toastHandler = () => {};

export function setRenderer(fn) {
  renderer = fn;
}

export function setToastHandler(fn) {
  toastHandler = fn;
}

export function showToast(message, action) {
  toastHandler(message, action);
}

export function openSession(vaultKey, state) {
  store.vaultKey = vaultKey;
  store.state = state;
  store.mode = getMode();
  store.account = getAccountInfo();
}

export function closeSession() {
  cancelScheduledSync();
  store.vaultKey = null;
  store.state = null;
}

export function isOpen() {
  return Boolean(store.vaultKey && store.state);
}

async function persistNow() {
  if (!isOpen()) return;
  await saveVault(store.vaultKey, store.state);
}

// Single write path for every mutation: encrypt locally right away, queue a sync
// if this device has an account, then repaint.
export async function commit(mutator, { render = true } = {}) {
  if (!isOpen()) return;
  mutator(store.state);
  await persistNow();
  if (store.mode === 'account') {
    scheduleSync(() => ({
      vaultKey: store.vaultKey,
      state: store.state,
      onMerged: (merged) => {
        store.state = merged;
        renderer();
      },
    }));
  }
  if (render) renderer();
}

export function rerender() {
  renderer();
}

export async function upsert(collection, record) {
  let saved = null;
  await commit((state) => {
    saved = putRecord(state, collection, record);
  });
  return saved;
}

// Deletes keep the previous record around in the toast so a mistaken tap is
// recoverable; restoring re-puts it with a fresh timestamp so it wins the merge.
export async function removeWithUndo(collection, id, label) {
  if (!isOpen()) return;
  const previous = store.state[collection][id];
  if (!previous) return;
  await commit((state) => {
    deleteRecord(state, collection, id);
  });
  showToast(label, {
    label: 'Annuler',
    handler: async () => {
      await commit((state) => {
        state[collection][id] = { ...previous, updatedAt: Date.now(), deleted: false };
      });
    },
  });
}
