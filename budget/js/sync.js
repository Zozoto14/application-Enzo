import { api, ApiError, OfflineError } from './api.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { mergeStates, normalizeState } from './model.js';
import { getSyncMeta, setSyncMeta, saveVault } from './storage.js';

const PUSH_DEBOUNCE_MS = 1500;

let pushTimer = null;
let inFlight = null;
const listeners = new Set();

export const SyncStatus = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  OFFLINE: 'offline',
  ERROR: 'error',
  UNVERIFIED: 'unverified',
};

let currentStatus = SyncStatus.IDLE;

export function onSyncChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(status, detail = {}) {
  currentStatus = status;
  listeners.forEach((listener) => listener({ status, ...detail }));
}

export function getSyncStatus() {
  return currentStatus;
}

async function fetchRemoteState(vaultKey) {
  const remote = await api.getVault();
  if (!remote.exists) return { state: null, version: 0 };
  try {
    return { state: normalizeState(await decryptJSON(vaultKey, remote)), version: remote.version };
  } catch (e) {
    // Wrong key for this blob: almost always a password changed on another device.
    throw new ApiError(409, 'decrypt_failed', 'Impossible de déchiffrer les données du serveur. Reconnectez-vous avec votre mot de passe actuel.');
  }
}

// Pull, merge, push. On a version conflict the server hands back its copy, which
// gets merged record-by-record and pushed again rather than overwriting it.
async function runSync(vaultKey, localState, { attempt = 0 } = {}) {
  const remote = await fetchRemoteState(vaultKey);
  const merged = remote.state ? mergeStates(localState, remote.state) : localState;

  const payload = await encryptJSON(vaultKey, merged);
  try {
    const result = await api.putVault({ ciphertext: payload.ciphertext, iv: payload.iv, baseVersion: remote.version });
    setSyncMeta({ version: result.version, lastSyncAt: result.updatedAt });
    await saveVault(vaultKey, merged);
    return merged;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && attempt < 3) {
      return runSync(vaultKey, merged, { attempt: attempt + 1 });
    }
    throw error;
  }
}

export async function syncNow(vaultKey, localState) {
  if (inFlight) return inFlight;
  emit(SyncStatus.SYNCING);
  inFlight = (async () => {
    try {
      const merged = await runSync(vaultKey, localState);
      emit(SyncStatus.IDLE, { lastSyncAt: getSyncMeta().lastSyncAt });
      return merged;
    } catch (error) {
      if (error instanceof OfflineError) {
        emit(SyncStatus.OFFLINE);
      } else if (error instanceof ApiError && error.code === 'email_unverified') {
        emit(SyncStatus.UNVERIFIED, { message: error.message });
      } else if (error instanceof ApiError && error.status === 401) {
        emit(SyncStatus.ERROR, { message: 'Session expirée. Reconnectez-vous.', needsLogin: true });
      } else {
        emit(SyncStatus.ERROR, { message: error.message });
      }
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function scheduleSync(getContext) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const context = getContext();
    if (!context || !context.vaultKey || !context.state) return;
    const merged = await syncNow(context.vaultKey, context.state);
    if (merged && context.onMerged) context.onMerged(merged);
  }, PUSH_DEBOUNCE_MS);
}

export function cancelScheduledSync() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}
