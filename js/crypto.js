const PBKDF2_ITERATIONS = 200000;

function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export { bufToBase64, base64ToBuf };

export function generateSaltBase64() {
  return bufToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function importPbkdf2Material(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}

export async function deriveKey(secret, saltBase64, iterations = PBKDF2_ITERATIONS, extractable = false) {
  const baseKey = await importPbkdf2Material(secret);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBuf(saltBase64), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

// Sent to the server to prove who you are. Derived from a different salt than the
// vault key, so the server never holds material that could decrypt the vault.
export async function deriveAuthKey(password, authSaltBase64, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await importPbkdf2Material(password);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64ToBuf(authSaltBase64), iterations, hash: 'SHA-256' },
    baseKey,
    256
  );
  return bufToBase64(bits);
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: bufToBase64(iv), ciphertext: bufToBase64(ciphertext) };
}

export async function decryptJSON(key, payload) {
  const iv = new Uint8Array(base64ToBuf(payload.iv));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBuf(payload.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function exportRawKey(key) {
  return bufToBase64(await crypto.subtle.exportKey('raw', key));
}

export async function importRawKey(rawBase64, extractable = true) {
  return crypto.subtle.importKey('raw', base64ToBuf(rawBase64), { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

// Quick unlock: the vault key itself is sealed with a short PIN (or a biometric
// secret) so the long password is not needed to reopen the app on this device.
export async function wrapKey(vaultKey, wrappingKey) {
  const raw = await exportRawKey(vaultKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, new TextEncoder().encode(raw));
  return { iv: bufToBase64(iv), ciphertext: bufToBase64(ciphertext) };
}

export async function unwrapKey(wrapped, wrappingKey) {
  const iv = new Uint8Array(base64ToBuf(wrapped.iv));
  const rawBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, base64ToBuf(wrapped.ciphertext));
  return importRawKey(new TextDecoder().decode(rawBytes));
}

export const DEFAULT_ITERATIONS = PBKDF2_ITERATIONS;
