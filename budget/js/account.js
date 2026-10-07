import { api, ApiError, OfflineError } from './api.js';
import { deriveAuthKey, deriveKey, generateSaltBase64, DEFAULT_ITERATIONS, encryptJSON } from './crypto.js';
import { installAccountVault, getAccountInfo, getVaultRecord, updateAccountInfo } from './storage.js';
import { validatePassword } from './password-policy.js';
import { defaultState } from './model.js';

// The password produces two independent keys. Only the auth key is ever sent;
// the vault key stays here, so the server cannot decrypt what it stores.
async function deriveKeys(password, { authSalt, vaultSalt, iterations }) {
  const [authKey, vaultKey] = await Promise.all([
    deriveAuthKey(password, authSalt, iterations),
    deriveKey(password, vaultSalt, iterations, true),
  ]);
  return { authKey, vaultKey };
}

export async function signup(email, password, currentState) {
  const validation = await validatePassword(password);
  if (!validation.ok) return { ok: false, message: validation.message };

  const authSalt = generateSaltBase64();
  let vaultSalt = generateSaltBase64();
  while (vaultSalt === authSalt) vaultSalt = generateSaltBase64();
  const iterations = DEFAULT_ITERATIONS;

  const { authKey, vaultKey } = await deriveKeys(password, { authSalt, vaultSalt, iterations });

  try {
    await api.signup({ email, authKey, authSalt, vaultSalt, iterations });
  } catch (error) {
    if (error instanceof OfflineError) return { ok: false, message: 'Serveur injoignable. Vérifiez votre connexion.' };
    return { ok: false, message: error.message };
  }

  return {
    ok: true,
    pendingVerification: true,
    message: 'Compte créé. Ouvrez le lien de confirmation envoyé à votre adresse email, puis connectez-vous.',
    keys: { authSalt, vaultSalt, iterations, vaultKey, email, state: currentState || defaultState() },
    breachCheckUnavailable: validation.breachCheckUnavailable,
  };
}

export async function login(email, password) {
  let salts;
  try {
    salts = await api.prelogin(email);
  } catch (error) {
    if (error instanceof OfflineError) return { ok: false, message: 'Serveur injoignable. Vérifiez votre connexion.' };
    return { ok: false, message: error.message };
  }

  const { authKey, vaultKey } = await deriveKeys(password, {
    authSalt: salts.authSalt,
    vaultSalt: salts.vaultSalt,
    iterations: salts.iterations,
  });

  try {
    const session = await api.login(email, authKey);
    return {
      ok: true,
      emailVerified: session.emailVerified,
      account: { email: session.email, authSalt: salts.authSalt, vaultSalt: session.vaultSalt, iterations: session.iterations },
      vaultKey,
    };
  } catch (error) {
    if (error instanceof OfflineError) return { ok: false, message: 'Serveur injoignable. Vérifiez votre connexion.' };
    if (error instanceof ApiError && error.status === 429) return { ok: false, message: error.message };
    return { ok: false, message: 'Email ou mot de passe incorrect.' };
  }
}

export async function adoptAccountVault(account, vaultKey, state, syncVersion = 0) {
  await installAccountVault(account, vaultKey, state, syncVersion);
}

export async function logout() {
  try {
    await api.logout();
  } catch (e) {
    // A failed call still ends the local session; the cookie expires server-side.
  }
}

export async function changeAccountPassword(currentPassword, newPassword, state) {
  const validation = await validatePassword(newPassword);
  if (!validation.ok) return { ok: false, message: validation.message };

  const account = getAccountInfo();
  if (!account) return { ok: false, message: 'Aucun compte connecté sur cet appareil.' };

  const currentAuthKey = await deriveAuthKey(currentPassword, account.authSalt, account.iterations);

  const newAuthSalt = generateSaltBase64();
  let newVaultSalt = generateSaltBase64();
  while (newVaultSalt === newAuthSalt) newVaultSalt = generateSaltBase64();
  const iterations = DEFAULT_ITERATIONS;

  const { authKey: newAuthKey, vaultKey: newVaultKey } = await deriveKeys(newPassword, {
    authSalt: newAuthSalt,
    vaultSalt: newVaultSalt,
    iterations,
  });

  // The vault is re-encrypted under the new key in the same request that rotates
  // the password, so the server never holds a blob nobody can open.
  const payload = await encryptJSON(newVaultKey, state);

  try {
    await api.changePassword({
      currentAuthKey,
      newAuthKey,
      newAuthSalt,
      newVaultSalt,
      iterations,
      vault: { ciphertext: payload.ciphertext, iv: payload.iv },
    });
  } catch (error) {
    if (error instanceof OfflineError) return { ok: false, message: 'Serveur injoignable. Réessayez une fois en ligne.' };
    return { ok: false, message: error.message };
  }

  updateAccountInfo({ authSalt: newAuthSalt, vaultSalt: newVaultSalt, iterations });
  const record = getVaultRecord();
  const currentVersion = record && record.sync ? record.sync.version : 0;
  return { ok: true, vaultKey: newVaultKey, syncVersion: currentVersion + 1 };
}

export async function refreshSession() {
  try {
    return await api.session();
  } catch (e) {
    return { authenticated: false, offline: e instanceof OfflineError };
  }
}
