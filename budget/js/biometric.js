import { bufToBase64, base64ToBuf } from './crypto.js';
import { enableBiometricUnlock, disableBiometricUnlock, getBiometricRecord, unlockWithBiometricSecret } from './storage.js';

const PRF_SALT = new TextEncoder().encode('mon-budget:vault-unlock:v1');

export function isBiometricSupported() {
  return typeof window.PublicKeyCredential === 'function'
    && typeof navigator.credentials === 'object'
    && window.isSecureContext;
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) {
    return false;
  }
}

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function prfSecretFrom(credential) {
  const results = credential.getClientExtensionResults();
  const output = results && results.prf && results.prf.results ? results.prf.results.first : null;
  return output ? bufToBase64(output) : null;
}

// Face ID / Touch ID is used as a key source, not just a gate: the WebAuthn PRF
// extension returns a secret that only this authenticator can reproduce, and that
// secret wraps the vault key. Without PRF there is no way to bind a key to the
// biometric, so the feature is reported unsupported rather than faked.
export async function enrollBiometric(vaultKey, userLabel) {
  if (!isBiometricSupported()) return { ok: false, message: 'WebAuthn indisponible sur cet appareil.' };

  const userId = crypto.getRandomValues(new Uint8Array(16));
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: 'Mon Budget', id: window.location.hostname },
        user: { id: userId, name: userLabel || 'Mon Budget', displayName: userLabel || 'Mon Budget' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
        extensions: { prf: {} },
      },
    });
  } catch (error) {
    return { ok: false, message: error.name === 'NotAllowedError' ? 'Enregistrement biométrique annulé.' : 'Enregistrement biométrique impossible.' };
  }

  const extensions = credential.getClientExtensionResults();
  if (!extensions || !extensions.prf || extensions.prf.enabled === false) {
    return { ok: false, message: "Cet appareil ne permet pas de dériver une clé depuis la biométrie (extension PRF absente)." };
  }

  const credentialId = bufToBase64(credential.rawId);
  // PRF output is delivered on assertion, so read the secret with an immediate get().
  const assertion = await requestAssertion(credentialId);
  if (!assertion.ok) return assertion;

  await enableBiometricUnlock(credentialId, assertion.secret, vaultKey);
  return { ok: true };
}

async function requestAssertion(credentialId) {
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        rpId: window.location.hostname,
        allowCredentials: credentialId ? [{ type: 'public-key', id: new Uint8Array(base64ToBuf(credentialId)) }] : [],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    });
    const secret = prfSecretFrom(credential);
    if (!secret) return { ok: false, message: 'Aucun secret biométrique renvoyé par cet appareil.' };
    return { ok: true, secret };
  } catch (error) {
    return { ok: false, message: error.name === 'NotAllowedError' ? 'Déverrouillage biométrique annulé.' : 'Déverrouillage biométrique impossible.' };
  }
}

export async function unlockWithBiometric() {
  const record = getBiometricRecord();
  if (!record) return { ok: false, message: 'Aucune biométrie enregistrée sur cet appareil.' };
  const assertion = await requestAssertion(record.credentialId);
  if (!assertion.ok) return assertion;
  const unlocked = await unlockWithBiometricSecret(assertion.secret);
  if (!unlocked) return { ok: false, message: 'Le secret biométrique ne correspond plus. Utilisez votre code.' };
  return { ok: true, ...unlocked };
}

export function removeBiometric() {
  disableBiometricUnlock();
}
