import { generateSaltBase64, deriveKey, encryptJSON, decryptJSON, DEFAULT_ITERATIONS } from './crypto.js';
import { normalizeState, mergeStates } from './model.js';

const FORMAT = 'mon-budget-backup';
const FORMAT_VERSION = 1;

// The backup carries its own salt and is sealed with a passphrase chosen at export
// time, so it can be restored on a device that has a different app code.
export async function buildBackup(state, passphrase) {
  const salt = generateSaltBase64();
  const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
  const data = await encryptJSON(key, state);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { salt, iterations: DEFAULT_ITERATIONS },
    data,
  };
}

export function downloadBackup(backup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `mon-budget-sauvegarde-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBackupFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: 'Ce fichier n\'est pas une sauvegarde valide.' };
  }
  if (!parsed || parsed.format !== FORMAT || !parsed.data || !parsed.kdf) {
    return { ok: false, message: 'Ce fichier n\'est pas une sauvegarde Mon Budget.' };
  }
  return { ok: true, backup: parsed };
}

export async function restoreBackup(backup, passphrase, currentState) {
  let restored;
  try {
    const key = await deriveKey(passphrase, backup.kdf.salt, backup.kdf.iterations || DEFAULT_ITERATIONS);
    restored = normalizeState(await decryptJSON(key, backup.data));
  } catch (e) {
    return { ok: false, message: 'Mot de passe de sauvegarde incorrect.' };
  }
  // Merging rather than replacing keeps anything added on this device since the
  // backup was taken; per-record timestamps decide each conflict.
  return { ok: true, state: currentState ? mergeStates(currentState, restored) : restored };
}
