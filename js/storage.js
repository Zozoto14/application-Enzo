import {
  generateSaltBase64, deriveKey, encryptJSON, decryptJSON,
  wrapKey, unwrapKey, DEFAULT_ITERATIONS,
} from './crypto.js';
import { normalizeState, defaultState } from './model.js';

const VAULT_KEY = 'budget-app-vault-v3';
const LEGACY_PIN_VAULT_KEY = 'budget-app-vault-v2';
const LEGACY_PLAINTEXT_KEY = 'budget-app-data-v1';
const LOCK_META_KEY = 'budget-app-lock-meta-v1';
const PREFS_KEY = 'budget-app-prefs-v1';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getVaultRecord() {
  return readJson(VAULT_KEY);
}

function setVaultRecord(record) {
  writeJson(VAULT_KEY, record);
}

export function hasVault() {
  return getVaultRecord() !== null || localStorage.getItem(LEGACY_PIN_VAULT_KEY) !== null;
}

export function getMode() {
  const record = getVaultRecord();
  if (record) return record.mode;
  if (localStorage.getItem(LEGACY_PIN_VAULT_KEY)) return 'local';
  return null;
}

export function getAccountInfo() {
  const record = getVaultRecord();
  return record && record.mode === 'account' ? record.account : null;
}

export function hasQuickUnlock() {
  const record = getVaultRecord();
  return Boolean(record && record.quickUnlock);
}

export function hasBiometricUnlock() {
  const record = getVaultRecord();
  return Boolean(record && record.biometric);
}

export function hasLegacyPlaintextData() {
  return localStorage.getItem(LEGACY_PLAINTEXT_KEY) !== null;
}

export function readLegacyPlaintextState() {
  const raw = readJson(LEGACY_PLAINTEXT_KEY);
  return raw ? normalizeState(raw) : null;
}

// ---------- Local (no account) mode ----------

export async function createLocalVault(pin, initialState) {
  const salt = generateSaltBase64();
  const key = await deriveKey(pin, salt, DEFAULT_ITERATIONS, true);
  const state = normalizeState(initialState || defaultState());
  const data = await encryptJSON(key, state);
  setVaultRecord({ version: 3, mode: 'local', kdf: { salt, iterations: DEFAULT_ITERATIONS }, data });
  localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
  localStorage.removeItem(LEGACY_PIN_VAULT_KEY);
  resetLockMeta();
  return { key, state };
}

// Reads the pre-account PIN vault so an existing install keeps its data when the
// app is upgraded, then rewrites it in the current format.
async function unlockLegacyPinVault(pin) {
  const legacy = readJson(LEGACY_PIN_VAULT_KEY);
  if (!legacy) return null;
  try {
    const key = await deriveKey(pin, legacy.salt, legacy.iterations || DEFAULT_ITERATIONS, true);
    const state = normalizeState(await decryptJSON(key, legacy));
    const data = await encryptJSON(key, state);
    setVaultRecord({ version: 3, mode: 'local', kdf: { salt: legacy.salt, iterations: legacy.iterations || DEFAULT_ITERATIONS }, data });
    localStorage.removeItem(LEGACY_PIN_VAULT_KEY);
    return { key, state };
  } catch (e) {
    return null;
  }
}

export async function unlockLocalVault(pin) {
  const record = getVaultRecord();
  if (!record) return unlockLegacyPinVault(pin);
  if (record.mode !== 'local') return null;
  try {
    const key = await deriveKey(pin, record.kdf.salt, record.kdf.iterations || DEFAULT_ITERATIONS, true);
    const state = normalizeState(await decryptJSON(key, record.data));
    return { key, state };
  } catch (e) {
    return null;
  }
}

export async function changeLocalPin(oldPin, newPin) {
  const unlocked = await unlockLocalVault(oldPin);
  if (!unlocked) return null;
  const salt = generateSaltBase64();
  const key = await deriveKey(newPin, salt, DEFAULT_ITERATIONS, true);
  const data = await encryptJSON(key, unlocked.state);
  setVaultRecord({ version: 3, mode: 'local', kdf: { salt, iterations: DEFAULT_ITERATIONS }, data });
  return { key, state: unlocked.state };
}

// ---------- Account (synced) mode ----------

export async function installAccountVault({ email, authSalt, vaultSalt, iterations }, vaultKey, state, syncVersion = 0) {
  const data = await encryptJSON(vaultKey, state);
  setVaultRecord({
    version: 3,
    mode: 'account',
    account: { email, authSalt, vaultSalt, iterations },
    quickUnlock: null,
    biometric: null,
    data,
    sync: { version: syncVersion, lastSyncAt: null },
  });
  resetLockMeta();
}

export async function readVaultState(key) {
  const record = getVaultRecord();
  if (!record || !record.data) return null;
  try {
    return normalizeState(await decryptJSON(key, record.data));
  } catch (e) {
    return null;
  }
}

export async function saveVault(key, state) {
  const record = getVaultRecord();
  if (!record) return;
  const data = await encryptJSON(key, state);
  setVaultRecord({ ...record, data });
}

export function getSyncMeta() {
  const record = getVaultRecord();
  return (record && record.sync) || { version: 0, lastSyncAt: null };
}

export function setSyncMeta(sync) {
  const record = getVaultRecord();
  if (!record) return;
  setVaultRecord({ ...record, sync: { ...record.sync, ...sync } });
}

export function updateAccountInfo(account) {
  const record = getVaultRecord();
  if (!record) return;
  setVaultRecord({ ...record, account: { ...record.account, ...account } });
}

// ---------- Quick unlock (PIN over an account vault) ----------

export async function enableQuickUnlock(pin, vaultKey) {
  const record = getVaultRecord();
  if (!record) return;
  const salt = generateSaltBase64();
  const pinKey = await deriveKey(pin, salt, DEFAULT_ITERATIONS);
  const wrapped = await wrapKey(vaultKey, pinKey);
  setVaultRecord({ ...record, quickUnlock: { salt, iterations: DEFAULT_ITERATIONS, wrapped } });
}

export function disableQuickUnlock() {
  const record = getVaultRecord();
  if (!record) return;
  setVaultRecord({ ...record, quickUnlock: null });
}

export async function unlockWithPin(pin) {
  const record = getVaultRecord();
  if (!record || !record.quickUnlock) return null;
  try {
    const pinKey = await deriveKey(pin, record.quickUnlock.salt, record.quickUnlock.iterations || DEFAULT_ITERATIONS);
    const vaultKey = await unwrapKey(record.quickUnlock.wrapped, pinKey);
    const state = normalizeState(await decryptJSON(vaultKey, record.data));
    return { key: vaultKey, state };
  } catch (e) {
    return null;
  }
}

// ---------- Biometric unlock (WebAuthn PRF) ----------

export async function enableBiometricUnlock(credentialId, prfSecret, vaultKey) {
  const record = getVaultRecord();
  if (!record) return;
  const salt = generateSaltBase64();
  const bioKey = await deriveKey(prfSecret, salt, DEFAULT_ITERATIONS);
  const wrapped = await wrapKey(vaultKey, bioKey);
  setVaultRecord({ ...record, biometric: { credentialId, salt, iterations: DEFAULT_ITERATIONS, wrapped } });
}

export function disableBiometricUnlock() {
  const record = getVaultRecord();
  if (!record) return;
  setVaultRecord({ ...record, biometric: null });
}

export function getBiometricRecord() {
  const record = getVaultRecord();
  return record ? record.biometric : null;
}

export async function unlockWithBiometricSecret(prfSecret) {
  const record = getVaultRecord();
  if (!record || !record.biometric) return null;
  try {
    const bioKey = await deriveKey(prfSecret, record.biometric.salt, record.biometric.iterations || DEFAULT_ITERATIONS);
    const vaultKey = await unwrapKey(record.biometric.wrapped, bioKey);
    const state = normalizeState(await decryptJSON(vaultKey, record.data));
    return { key: vaultKey, state };
  } catch (e) {
    return null;
  }
}

export function wipeVault() {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(LEGACY_PIN_VAULT_KEY);
  localStorage.removeItem(LEGACY_PLAINTEXT_KEY);
  resetLockMeta();
}

// ---------- Local lockout (deterrent; the PBKDF2 cost is the real defense) ----------

function readLockMeta() {
  return readJson(LOCK_META_KEY) || { failedAttempts: 0, lockUntil: 0 };
}

export function resetLockMeta() {
  writeJson(LOCK_META_KEY, { failedAttempts: 0, lockUntil: 0 });
}

export function getLockStatus() {
  const meta = readLockMeta();
  return { failedAttempts: meta.failedAttempts, remainingMs: Math.max(0, meta.lockUntil - Date.now()) };
}

export function registerFailedAttempt() {
  const meta = readLockMeta();
  const failedAttempts = meta.failedAttempts + 1;
  let lockUntil = meta.lockUntil;
  if (failedAttempts >= 5) {
    lockUntil = Date.now() + Math.min(30 * 2 ** (failedAttempts - 5), 300) * 1000;
  }
  writeJson(LOCK_META_KEY, { failedAttempts, lockUntil });
  return getLockStatus();
}

export function registerSuccessfulUnlock() {
  resetLockMeta();
}

// ---------- Device preferences (not synced, not sensitive) ----------

const DEFAULT_PREFS = { autoLockMinutes: 2 };

export function loadPrefs() {
  return { ...DEFAULT_PREFS, ...(readJson(PREFS_KEY) || {}) };
}

export function savePrefs(prefs) {
  writeJson(PREFS_KEY, prefs);
}
