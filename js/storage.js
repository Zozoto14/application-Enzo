import { generateSaltBase64, deriveKey, encryptJSON, decryptJSON, DEFAULT_ITERATIONS } from './crypto.js';

const VAULT_KEY = 'budget-app-vault-v2';
const LOCK_META_KEY = 'budget-app-lock-meta-v1';
const PREFS_KEY = 'budget-app-prefs-v1';
const LEGACY_PLAINTEXT_KEY = 'budget-app-data-v1';

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

function normalizeState(parsed) {
  const fallback = defaultState();
  if (!parsed || typeof parsed !== 'object') return fallback;
  return {
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    categories: parsed.categories && typeof parsed.categories === 'object' ? { ...fallback.categories, ...parsed.categories } : fallback.categories,
  };
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

// ---------- Vault (encrypted storage) ----------

export function hasVault() {
  return localStorage.getItem(VAULT_KEY) !== null;
}

export function hasLegacyPlaintextData() {
  return localStorage.getItem(LEGACY_PLAINTEXT_KEY) !== null;
}

function readVaultRecord() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY));
  } catch (e) {
    return null;
  }
}

function writeVaultRecord(record) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(record));
}

// Creates a new vault protected by `pin`, seeded with `initialState` (defaults to empty state,
// or migrated legacy plaintext data if present). Returns the derived CryptoKey to keep the
// session unlocked without asking for the PIN again.
export async function createVault(pin, initialState) {
  const salt = generateSaltBase64();
  const key = await deriveKey(pin, salt);
  const state = normalizeState(initialState || defaultState());
  const { iv, ciphertext } = await encryptJSON(key, state);
  writeVaultRecord({ salt, iterations: DEFAULT_ITERATIONS, iv, ciphertext });
  if (hasLegacyPlaintextData()) localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
  resetLockMeta();
  return { key, state };
}

// Attempts to unlock the vault with `pin`. Returns { key, state } on success, or null if the
// PIN is wrong (AES-GCM authentication fails on any tampering or wrong key).
export async function unlockVault(pin) {
  const record = readVaultRecord();
  if (!record) return null;
  try {
    const key = await deriveKey(pin, record.salt, record.iterations || DEFAULT_ITERATIONS);
    const state = normalizeState(await decryptJSON(key, record));
    return { key, state };
  } catch (e) {
    return null;
  }
}

export async function saveVault(key, state) {
  const record = readVaultRecord();
  const { iv, ciphertext } = await encryptJSON(key, normalizeState(state));
  writeVaultRecord({ ...record, iv, ciphertext });
}

export async function changePin(oldPin, newPin) {
  const unlocked = await unlockVault(oldPin);
  if (!unlocked) return null;
  const salt = generateSaltBase64();
  const key = await deriveKey(newPin, salt);
  const { iv, ciphertext } = await encryptJSON(key, unlocked.state);
  writeVaultRecord({ salt, iterations: DEFAULT_ITERATIONS, iv, ciphertext });
  return key;
}

export function wipeVault() {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
  resetLockMeta();
}

// ---------- Legacy plaintext migration ----------

export function readLegacyPlaintextState() {
  try {
    const raw = localStorage.getItem(LEGACY_PLAINTEXT_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

// ---------- Best-effort local lockout (deterrent only: the real protection is the PBKDF2 cost) ----------

function readLockMeta() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_META_KEY)) || { failedAttempts: 0, lockUntil: 0 };
  } catch (e) {
    return { failedAttempts: 0, lockUntil: 0 };
  }
}

function writeLockMeta(meta) {
  localStorage.setItem(LOCK_META_KEY, JSON.stringify(meta));
}

export function resetLockMeta() {
  writeLockMeta({ failedAttempts: 0, lockUntil: 0 });
}

export function getLockStatus() {
  const meta = readLockMeta();
  const remainingMs = Math.max(0, meta.lockUntil - Date.now());
  return { failedAttempts: meta.failedAttempts, remainingMs };
}

export function registerFailedAttempt() {
  const meta = readLockMeta();
  const failedAttempts = meta.failedAttempts + 1;
  let lockUntil = meta.lockUntil;
  if (failedAttempts >= 5) {
    const extraStrikes = failedAttempts - 5;
    const seconds = Math.min(30 * 2 ** extraStrikes, 300);
    lockUntil = Date.now() + seconds * 1000;
  }
  writeLockMeta({ failedAttempts, lockUntil });
  return getLockStatus();
}

export function registerSuccessfulUnlock() {
  resetLockMeta();
}

// ---------- Non-sensitive preferences (auto-lock delay) ----------

const DEFAULT_PREFS = { autoLockMinutes: 2 };

export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
