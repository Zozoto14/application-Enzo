import {
  hasVault, getMode, getAccountInfo, hasQuickUnlock, hasBiometricUnlock,
  createLocalVault, unlockLocalVault, changeLocalPin, unlockWithPin, enableQuickUnlock,
  readLegacyPlaintextState, hasLegacyPlaintextData, wipeVault, saveVault,
  getLockStatus, registerFailedAttempt, registerSuccessfulUnlock,
  loadPrefs, savePrefs, getSyncMeta, setSyncMeta,
} from './storage.js';
import {
  defaultState, generateRecurringTransactions, getSetting, setSetting, categoryId,
} from './model.js';
import {
  store, setRenderer, setToastHandler, showToast, openSession, closeSession,
  isOpen, commit, removeWithUndo,
} from './store.js';
import { renderDashboard, renderTransactions, renderPlanning, renderSettings } from './views.js';
import { openTransactionModal, openBudgetModal, openGoalModal, openRecurringModal, openModal, closeModal } from './modals.js';
import { signup, login, logout, adoptAccountVault, changeAccountPassword, refreshSession } from './account.js';
import { syncNow, onSyncChange, SyncStatus } from './sync.js';
import { isBiometricSupported, isPlatformAuthenticatorAvailable, enrollBiometric, unlockWithBiometric, removeBiometric } from './biometric.js';
import { buildBackup, downloadBackup, readBackupFile, restoreBackup } from './backup.js';
import { escapeHtml } from './ui.js';

const appRoot = document.getElementById('app');
const lockRoot = document.getElementById('lock-root');
const viewRoot = document.getElementById('view-root');
const pageTitle = document.getElementById('page-title');
const toastRoot = document.getElementById('toast-root');
const fabAdd = document.getElementById('fab-add');

const TAB_TITLES = {
  dashboard: 'Tableau de bord',
  transactions: 'Transactions',
  planning: 'Objectifs',
  settings: 'Réglages',
};

let idleTimer = null;
let biometricAvailable = false;
let syncState = { status: SyncStatus.IDLE, message: 'Synchronisé' };
let toastTimer = null;

// ---------- Toast ----------

setToastHandler((message, action) => {
  if (toastTimer) clearTimeout(toastTimer);
  toastRoot.innerHTML = `
    <div class="toast">
      <span>${escapeHtml(message)}</span>
      ${action ? `<button id="toast-action">${escapeHtml(action.label)}</button>` : ''}
    </div>`;
  if (action) {
    toastRoot.querySelector('#toast-action').addEventListener('click', async () => {
      toastRoot.innerHTML = '';
      await action.handler();
    });
  }
  toastTimer = setTimeout(() => { toastRoot.innerHTML = ''; }, action ? 7000 : 3500);
});

// ---------- Theme ----------

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function currentTheme() {
  return isOpen() ? getSetting(store.state, 'theme', 'auto') : 'auto';
}

// ---------- Lock screens ----------

function showLockOverlay(html) {
  appRoot.style.display = 'none';
  closeModal();
  lockRoot.innerHTML = `<div class="lock-overlay">${html}</div>`;
}

function hideLockOverlay() {
  lockRoot.innerHTML = '';
  appRoot.style.display = '';
}

function renderWelcome() {
  showLockOverlay(`
    <div class="lock-card">
      <div class="lock-icon">💶</div>
      <h2>Mon Budget</h2>
      <p class="lock-sub">Suivez vos dépenses personnelles, vos candidatures et vos projets. Vos données sont chiffrées sur l'appareil — et si vous créez un compte, elles le restent aussi sur le serveur.</p>
      <button class="btn-primary" id="choose-account">Créer un compte et synchroniser</button>
      <button class="btn-secondary" id="choose-login">J'ai déjà un compte</button>
      <button class="btn-secondary" id="choose-local">Utiliser sur cet appareil uniquement</button>
    </div>
  `);
  lockRoot.querySelector('#choose-account').addEventListener('click', () => renderAccountAuth('signup'));
  lockRoot.querySelector('#choose-login').addEventListener('click', () => renderAccountAuth('login'));
  lockRoot.querySelector('#choose-local').addEventListener('click', () => renderLocalPinSetup());
}

function renderLocalPinSetup() {
  const migrating = hasLegacyPlaintextData();
  showLockOverlay(`
    <div class="lock-card">
      <div class="lock-icon">🔒</div>
      <h2>Protégez votre budget</h2>
      <p class="lock-sub">Créez un code d'accès. Vos données seront chiffrées sur cet appareil avec ce code.${migrating ? ' Vos transactions existantes seront conservées et chiffrées.' : ''}
      <strong> Si vous l'oubliez, les données ne pourront pas être récupérées</strong> — il n'existe aucune porte dérobée.</p>
      <form id="create-pin-form">
        <div class="form-row">
          <label for="pin1">Code d'accès (4 caractères minimum)</label>
          <input type="password" id="pin1" inputmode="numeric" autocomplete="new-password" minlength="4" required />
        </div>
        <div class="form-row">
          <label for="pin2">Confirmez le code</label>
          <input type="password" id="pin2" inputmode="numeric" autocomplete="new-password" minlength="4" required />
        </div>
        <p class="lock-error" id="lock-error"></p>
        <button type="submit" class="btn-primary">Créer le code et continuer</button>
        <button type="button" class="btn-secondary" id="back-welcome">Retour</button>
      </form>
    </div>
  `);

  lockRoot.querySelector('#back-welcome').addEventListener('click', renderWelcome);
  lockRoot.querySelector('#create-pin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin1 = lockRoot.querySelector('#pin1').value;
    const pin2 = lockRoot.querySelector('#pin2').value;
    const errorEl = lockRoot.querySelector('#lock-error');
    if (pin1.length < 4) {
      errorEl.textContent = 'Le code doit contenir au moins 4 caractères.';
      return;
    }
    if (pin1 !== pin2) {
      errorEl.textContent = 'Les deux codes ne correspondent pas.';
      return;
    }
    const legacy = migrating ? readLegacyPlaintextState() : null;
    const { key, state } = await createLocalVault(pin1, legacy || defaultState());
    await enterSession(key, state);
  });
}

function renderAccountAuth(mode, prefill = {}) {
  const isSignup = mode === 'signup';
  showLockOverlay(`
    <div class="lock-card">
      <div class="lock-icon">${isSignup ? '✨' : '👋'}</div>
      <h2>${isSignup ? 'Créer un compte' : 'Connexion'}</h2>
      <p class="lock-sub">${isSignup
        ? "Votre mot de passe chiffre vos données avant qu'elles ne quittent l'appareil. Le serveur ne peut jamais les lire — et ne peut pas non plus réinitialiser ce mot de passe."
        : 'Connectez-vous pour retrouver vos données synchronisées.'}</p>
      <form id="account-form">
        <div class="form-row">
          <label for="acc-email">Adresse email</label>
          <input type="email" id="acc-email" autocomplete="email" value="${escapeHtml(prefill.email || '')}" required />
        </div>
        <div class="form-row">
          <label for="acc-password">Mot de passe</label>
          <input type="password" id="acc-password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required />
        </div>
        ${isSignup ? `
          <div class="form-row">
            <label for="acc-password2">Confirmez le mot de passe</label>
            <input type="password" id="acc-password2" autocomplete="new-password" required />
          </div>
          <p class="row-sub">12 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial. Les mots de passe déjà présents dans des fuites connues sont refusés.</p>
        ` : ''}
        <p class="lock-error" id="lock-error"></p>
        <p class="lock-success" id="lock-success"></p>
        <button type="submit" class="btn-primary" id="account-submit">${isSignup ? 'Créer le compte' : 'Se connecter'}</button>
        <button type="button" class="btn-secondary" id="switch-mode">${isSignup ? "J'ai déjà un compte" : 'Créer un compte'}</button>
        ${hasVault() ? '' : '<button type="button" class="btn-secondary" id="back-welcome">Retour</button>'}
      </form>
    </div>
  `);

  const backButton = lockRoot.querySelector('#back-welcome');
  if (backButton) backButton.addEventListener('click', renderWelcome);
  lockRoot.querySelector('#switch-mode').addEventListener('click', () => renderAccountAuth(isSignup ? 'login' : 'signup', {
    email: lockRoot.querySelector('#acc-email').value,
  }));

  lockRoot.querySelector('#account-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = lockRoot.querySelector('#lock-error');
    const successEl = lockRoot.querySelector('#lock-success');
    const submitButton = lockRoot.querySelector('#account-submit');
    errorEl.textContent = '';
    successEl.textContent = '';
    const email = lockRoot.querySelector('#acc-email').value.trim();
    const password = lockRoot.querySelector('#acc-password').value;

    submitButton.disabled = true;
    submitButton.textContent = 'Veuillez patienter…';
    try {
      if (isSignup) {
        if (password !== lockRoot.querySelector('#acc-password2').value) {
          errorEl.textContent = 'Les deux mots de passe ne correspondent pas.';
          return;
        }
        const result = await signup(email, password, isOpen() ? store.state : null);
        if (!result.ok) {
          errorEl.textContent = result.message;
          return;
        }
        successEl.textContent = result.message;
        submitButton.textContent = 'Compte créé';
        setTimeout(() => renderAccountAuth('login', { email }), 2500);
        return;
      }

      const result = await login(email, password);
      if (!result.ok) {
        errorEl.textContent = result.message;
        return;
      }
      await adoptAccountAndOpen(result);
    } finally {
      if (lockRoot.querySelector('#account-submit')) {
        submitButton.disabled = false;
        if (!isSignup) submitButton.textContent = 'Se connecter';
      }
    }
  });
}

// Carries whatever is already on this device into the account vault, then lets the
// sync merge decide per record against whatever the server holds.
async function adoptAccountAndOpen(loginResult) {
  const localState = isOpen() ? store.state : null;
  const seed = localState || defaultState();
  await adoptAccountVault(loginResult.account, loginResult.vaultKey, seed, 0);
  await enterSession(loginResult.vaultKey, seed);
  if (!loginResult.emailVerified) {
    store.state && setSyncState(SyncStatus.UNVERIFIED, 'Confirmez votre email pour activer la synchronisation');
  }
  await runSync();
}

function renderUnlock() {
  const mode = getMode();
  const account = getAccountInfo();
  const quickUnlock = hasQuickUnlock();
  const canUsePin = mode === 'local' || quickUnlock;
  const status = getLockStatus();
  const lockedOut = status.remainingMs > 0;

  showLockOverlay(`
    <div class="lock-card">
      <div class="lock-icon">🔒</div>
      <h2>Mon Budget verrouillé</h2>
      <p class="lock-sub">${account ? `Compte : ${escapeHtml(account.email)}` : 'Entrez votre code d\'accès pour continuer.'}</p>
      ${hasBiometricUnlock() ? '<button class="btn-secondary" id="biometric-unlock">🫆 Déverrouiller avec Face ID / Touch ID</button>' : ''}
      <form id="unlock-form">
        <div class="form-row">
          <label for="pin-unlock">${canUsePin ? "Code d'accès" : 'Mot de passe du compte'}</label>
          <input type="password" id="pin-unlock" inputmode="${canUsePin ? 'numeric' : 'text'}" autocomplete="current-password" required ${lockedOut ? 'disabled' : 'autofocus'} />
        </div>
        <p class="lock-error" id="lock-error"></p>
        <button type="submit" class="btn-primary" id="unlock-submit" ${lockedOut ? 'disabled' : ''}>Déverrouiller</button>
        ${mode === 'account' && quickUnlock ? '<button type="button" class="btn-secondary" id="use-password">Utiliser le mot de passe du compte</button>' : ''}
      </form>
    </div>
  `);

  let countdown = null;
  function tickCountdown() {
    const current = getLockStatus();
    if (current.remainingMs <= 0) {
      clearInterval(countdown);
      renderUnlock();
      return;
    }
    lockRoot.querySelector('#lock-error').textContent = `Trop de tentatives. Réessayez dans ${Math.ceil(current.remainingMs / 1000)}s.`;
  }
  if (lockedOut) {
    tickCountdown();
    countdown = setInterval(tickCountdown, 1000);
  }

  const biometricButton = lockRoot.querySelector('#biometric-unlock');
  if (biometricButton) {
    biometricButton.addEventListener('click', async () => {
      const result = await unlockWithBiometric();
      if (!result.ok) {
        lockRoot.querySelector('#lock-error').textContent = result.message;
        return;
      }
      if (countdown) clearInterval(countdown);
      registerSuccessfulUnlock();
      await enterSession(result.key, result.state);
      await runSync();
    });
  }

  const passwordButton = lockRoot.querySelector('#use-password');
  if (passwordButton) passwordButton.addEventListener('click', () => renderAccountAuth('login', { email: account ? account.email : '' }));

  lockRoot.querySelector('#unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const secret = lockRoot.querySelector('#pin-unlock').value;
    const submitButton = lockRoot.querySelector('#unlock-submit');
    const errorEl = lockRoot.querySelector('#lock-error');
    submitButton.disabled = true;

    let unlocked = null;
    if (mode === 'local') unlocked = await unlockLocalVault(secret);
    else if (quickUnlock) unlocked = await unlockWithPin(secret);

    if (!unlocked && mode === 'account' && !quickUnlock) {
      const result = await login(account.email, secret);
      if (result.ok) {
        await adoptAccountAndOpen(result);
        if (countdown) clearInterval(countdown);
        registerSuccessfulUnlock();
        return;
      }
    }

    if (unlocked) {
      if (countdown) clearInterval(countdown);
      registerSuccessfulUnlock();
      await enterSession(unlocked.key, unlocked.state);
      await runSync();
      return;
    }

    const failure = registerFailedAttempt();
    submitButton.disabled = false;
    if (failure.remainingMs > 0) {
      renderUnlock();
      return;
    }
    const remaining = Math.max(0, 5 - failure.failedAttempts);
    errorEl.textContent = remaining > 0
      ? `Code incorrect (${remaining} tentative${remaining > 1 ? 's' : ''} avant blocage temporaire).`
      : 'Code incorrect.';
    lockRoot.querySelector('#pin-unlock').value = '';
  });
}

async function enterSession(vaultKey, state) {
  openSession(vaultKey, state);
  store.ui.privacyMode = getSetting(state, 'privacyMode', false);
  applyTheme(getSetting(state, 'theme', 'auto'));

  const created = generateRecurringTransactions(store.state);
  if (created.length) {
    await commit(() => {}, { render: false });
  }

  biometricAvailable = await isPlatformAuthenticatorAvailable();
  hideLockOverlay();
  setupAutoLock();
  setTab(store.ui.tab || 'dashboard');
  if (created.length) {
    const plural = created.length > 1 ? 's' : '';
    setTimeout(() => showToast(`${created.length} transaction${plural} récurrente${plural} ajoutée${plural}.`), 400);
  }
}

function lockApp() {
  if (!isOpen()) return;
  closeSession();
  teardownAutoLock();
  renderUnlock();
}

// ---------- Auto-lock ----------

const idleEvents = ['pointerdown', 'keydown', 'touchstart'];

function resetIdleTimer() {
  if (!isOpen()) return;
  if (idleTimer) clearTimeout(idleTimer);
  const prefs = loadPrefs();
  if (!prefs.autoLockMinutes) return;
  idleTimer = setTimeout(lockApp, prefs.autoLockMinutes * 60 * 1000);
}

function onVisibilityChange() {
  if (document.hidden && isOpen()) lockApp();
}

function setupAutoLock() {
  resetIdleTimer();
  idleEvents.forEach((event) => document.addEventListener(event, resetIdleTimer));
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function teardownAutoLock() {
  if (idleTimer) clearTimeout(idleTimer);
  idleEvents.forEach((event) => document.removeEventListener(event, resetIdleTimer));
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

// ---------- Sync ----------

function setSyncState(status, message) {
  syncState = { status, message };
  if (store.ui.tab === 'settings' && isOpen()) render();
}

onSyncChange(({ status, message }) => {
  const labels = {
    [SyncStatus.IDLE]: 'Synchronisé',
    [SyncStatus.SYNCING]: 'Synchronisation…',
    [SyncStatus.OFFLINE]: 'Hors ligne — les modifications seront envoyées plus tard',
    [SyncStatus.UNVERIFIED]: 'Confirmez votre email pour activer la synchronisation',
    [SyncStatus.ERROR]: message || 'Erreur de synchronisation',
  };
  setSyncState(status, labels[status] || message || '');
});

async function runSync() {
  if (!isOpen() || getMode() !== 'account') return;
  const merged = await syncNow(store.vaultKey, store.state);
  if (merged) {
    store.state = merged;
    store.ui.privacyMode = getSetting(merged, 'privacyMode', store.ui.privacyMode);
    applyTheme(getSetting(merged, 'theme', 'auto'));
    render();
  }
}

// ---------- Tabs and rendering ----------

function setTab(tab) {
  store.ui.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  pageTitle.textContent = TAB_TITLES[tab];
  fabAdd.style.display = tab === 'dashboard' || tab === 'transactions' ? 'flex' : 'none';
  render();
}

function render() {
  if (!isOpen()) return;
  document.body.classList.toggle('privacy-on', store.ui.privacyMode);
  if (store.ui.tab === 'dashboard') {
    renderDashboard(viewRoot);
    wireDashboard();
  } else if (store.ui.tab === 'transactions') {
    renderTransactions(viewRoot);
    wireTransactions();
  } else if (store.ui.tab === 'planning') {
    renderPlanning(viewRoot);
    wirePlanning();
  } else if (store.ui.tab === 'settings') {
    renderSettings(viewRoot, {
      syncStatus: syncState.status,
      syncMessage: syncState.message,
      lastSyncAt: getSyncMeta().lastSyncAt,
      prefs: loadPrefs(),
      theme: currentTheme(),
      biometricSupported: isBiometricSupported() && biometricAvailable,
      biometricEnabled: hasBiometricUnlock(),
      quickUnlockEnabled: hasQuickUnlock(),
    });
    wireSettings();
  }
}

setRenderer(render);

function wireDashboard() {
  viewRoot.querySelector('#dash-space-chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-space]');
    if (!button) return;
    store.ui.dashboardSpace = button.dataset.space;
    render();
  });
  viewRoot.querySelector('#dash-period-chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-period]');
    if (!button) return;
    store.ui.dashboardPeriod = button.dataset.period;
    render();
  });
}

function wireTransactions() {
  const search = viewRoot.querySelector('#tx-search');
  search.addEventListener('input', (event) => {
    store.ui.txSearch = event.target.value;
    renderTransactions(viewRoot);
    wireTransactions();
    const refreshed = viewRoot.querySelector('#tx-search');
    refreshed.focus();
    refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length);
  });
  viewRoot.querySelector('#tx-space-chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-space]');
    if (!button) return;
    store.ui.txSpace = button.dataset.space;
    render();
  });
  viewRoot.querySelector('#tx-list').addEventListener('click', (event) => {
    const row = event.target.closest('.tx-row');
    if (!row) return;
    openTransactionModal(row.dataset.id);
  });
}

function wirePlanning() {
  viewRoot.querySelector('#add-budget').addEventListener('click', () => openBudgetModal(null));
  viewRoot.querySelector('#add-goal').addEventListener('click', () => openGoalModal(null));
  viewRoot.querySelector('#add-recurring').addEventListener('click', () => openRecurringModal(null));
  viewRoot.querySelectorAll('[data-budget-id]').forEach((row) => {
    row.addEventListener('click', () => openBudgetModal(row.dataset.budgetId));
  });
  viewRoot.querySelectorAll('[data-goal-id]').forEach((row) => {
    row.addEventListener('click', () => openGoalModal(row.dataset.goalId));
  });
  viewRoot.querySelectorAll('[data-recurring-id]').forEach((row) => {
    row.addEventListener('click', () => openRecurringModal(row.dataset.recurringId));
  });
}

function wireSettings() {
  const byId = (id) => viewRoot.querySelector(`#${id}`);

  const createAccountButton = byId('create-account-btn');
  if (createAccountButton) createAccountButton.addEventListener('click', () => renderAccountAuth('signup'));
  const loginButton = byId('login-account-btn');
  if (loginButton) loginButton.addEventListener('click', () => renderAccountAuth('login'));

  const syncButton = byId('sync-now-btn');
  if (syncButton) syncButton.addEventListener('click', () => runSync());

  const logoutButton = byId('logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (!window.confirm('Se déconnecter de cet appareil ? Les données locales chiffrées seront effacées ; elles restent sur le serveur.')) return;
      await logout();
      wipeVault();
      closeSession();
      teardownAutoLock();
      renderWelcome();
    });
  }

  const changePasswordButton = byId('change-password-btn');
  if (changePasswordButton) changePasswordButton.addEventListener('click', openChangePasswordModal);

  byId('autolock-select').addEventListener('change', (event) => {
    savePrefs({ ...loadPrefs(), autoLockMinutes: Number(event.target.value) });
    resetIdleTimer();
  });

  byId('privacy-toggle').addEventListener('change', async (event) => {
    store.ui.privacyMode = event.target.checked;
    await commit((state) => setSetting(state, 'privacyMode', event.target.checked));
  });

  const biometricToggle = byId('biometric-toggle');
  if (biometricToggle) {
    biometricToggle.addEventListener('change', async (event) => {
      if (!event.target.checked) {
        removeBiometric();
        render();
        return;
      }
      const account = getAccountInfo();
      const result = await enrollBiometric(store.vaultKey, account ? account.email : 'Mon Budget');
      if (!result.ok) {
        window.alert(result.message);
      }
      render();
    });
  }

  byId('lock-now-btn').addEventListener('click', lockApp);
  byId('change-pin-btn').addEventListener('click', openPinModal);
  byId('theme-select').addEventListener('change', async (event) => {
    applyTheme(event.target.value);
    await commit((state) => setSetting(state, 'theme', event.target.value));
  });

  byId('export-btn').addEventListener('click', openExportModal);
  byId('import-btn').addEventListener('click', () => byId('import-file').click());
  byId('import-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const parsed = await readBackupFile(file);
    if (!parsed.ok) {
      window.alert(parsed.message);
      return;
    }
    openImportModal(parsed.backup);
  });

  viewRoot.querySelectorAll('[data-add-cat]').forEach((button) => {
    button.addEventListener('click', async () => {
      const space = button.dataset.addCat;
      const input = viewRoot.querySelector(`[data-new-cat="${space}"]`);
      const name = input.value.trim();
      if (!name) return;
      const id = categoryId(space, name);
      await commit((state) => {
        state.categories[id] = { id, space, name, updatedAt: Date.now(), deleted: false };
      });
    });
  });

  viewRoot.querySelectorAll('[data-action="delete-cat"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('.category-row');
      await removeWithUndo('categories', categoryId(row.dataset.space, row.dataset.cat), 'Catégorie supprimée');
    });
  });

  byId('wipe-btn').addEventListener('click', () => {
    if (!window.confirm('Effacer les données de cet appareil ? Cette action est irréversible sur cet appareil.')) return;
    wipeVault();
    closeSession();
    teardownAutoLock();
    renderWelcome();
  });

  const deleteAccountButton = byId('delete-account-btn');
  if (deleteAccountButton) {
    deleteAccountButton.addEventListener('click', async () => {
      if (!window.confirm('Supprimer définitivement votre compte et toutes les données du serveur ? Cette action est irréversible.')) return;
      try {
        const { api } = await import('./api.js');
        await api.deleteAccount();
      } catch (error) {
        window.alert(error.message);
        return;
      }
      wipeVault();
      closeSession();
      teardownAutoLock();
      renderWelcome();
    });
  }
}

// ---------- Settings modals ----------

function openPinModal() {
  const mode = getMode();
  const isLocal = mode === 'local';
  const sheet = openModal(`
    <p class="modal-title">${isLocal ? "Changer le code d'accès" : "Code d'accès rapide"}</p>
    <p class="lock-sub">${isLocal
      ? 'Ce code chiffre vos données sur cet appareil.'
      : "Ce code permet de rouvrir l'application sans retaper le mot de passe du compte. Il protège la clé stockée sur cet appareil."}</p>
    <form id="pin-form">
      ${isLocal ? `
        <div class="form-row">
          <label for="old-pin">Code actuel</label>
          <input type="password" id="old-pin" inputmode="numeric" autocomplete="current-password" required />
        </div>` : ''}
      <div class="form-row">
        <label for="new-pin1">${isLocal ? 'Nouveau code' : 'Code d\'accès'}</label>
        <input type="password" id="new-pin1" inputmode="numeric" autocomplete="new-password" minlength="4" required />
      </div>
      <div class="form-row">
        <label for="new-pin2">Confirmez</label>
        <input type="password" id="new-pin2" inputmode="numeric" autocomplete="new-password" minlength="4" required />
      </div>
      <p class="lock-error" id="pin-error"></p>
      <button type="submit" class="btn-primary">Enregistrer</button>
      <button type="button" class="btn-secondary" id="pin-cancel">Annuler</button>
    </form>
  `);

  sheet.querySelector('#pin-cancel').addEventListener('click', closeModal);
  sheet.querySelector('#pin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = sheet.querySelector('#pin-error');
    const pin1 = sheet.querySelector('#new-pin1').value;
    const pin2 = sheet.querySelector('#new-pin2').value;
    if (pin1.length < 4) {
      errorEl.textContent = 'Le code doit contenir au moins 4 caractères.';
      return;
    }
    if (pin1 !== pin2) {
      errorEl.textContent = 'Les deux codes ne correspondent pas.';
      return;
    }

    if (isLocal) {
      const result = await changeLocalPin(sheet.querySelector('#old-pin').value, pin1);
      if (!result) {
        errorEl.textContent = 'Code actuel incorrect.';
        return;
      }
      openSession(result.key, result.state);
    } else {
      await enableQuickUnlock(pin1, store.vaultKey);
    }
    closeModal();
    showToast('Code enregistré.');
    render();
  });
}

function openChangePasswordModal() {
  const sheet = openModal(`
    <p class="modal-title">Changer le mot de passe du compte</p>
    <p class="lock-sub">Vos données seront rechiffrées avec le nouveau mot de passe, puis renvoyées au serveur. Vos autres appareils devront se reconnecter.</p>
    <form id="password-form">
      <div class="form-row">
        <label for="cur-pass">Mot de passe actuel</label>
        <input type="password" id="cur-pass" autocomplete="current-password" required />
      </div>
      <div class="form-row">
        <label for="new-pass1">Nouveau mot de passe</label>
        <input type="password" id="new-pass1" autocomplete="new-password" required />
      </div>
      <div class="form-row">
        <label for="new-pass2">Confirmez</label>
        <input type="password" id="new-pass2" autocomplete="new-password" required />
      </div>
      <p class="lock-error" id="pass-error"></p>
      <button type="submit" class="btn-primary" id="pass-submit">Mettre à jour</button>
      <button type="button" class="btn-secondary" id="pass-cancel">Annuler</button>
    </form>
  `);

  sheet.querySelector('#pass-cancel').addEventListener('click', closeModal);
  sheet.querySelector('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = sheet.querySelector('#pass-error');
    const submitButton = sheet.querySelector('#pass-submit');
    const newPassword = sheet.querySelector('#new-pass1').value;
    if (newPassword !== sheet.querySelector('#new-pass2').value) {
      errorEl.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Mise à jour…';
    const result = await changeAccountPassword(sheet.querySelector('#cur-pass').value, newPassword, store.state);
    submitButton.disabled = false;
    submitButton.textContent = 'Mettre à jour';
    if (!result.ok) {
      errorEl.textContent = result.message;
      return;
    }
    store.vaultKey = result.vaultKey;
    await saveVault(result.vaultKey, store.state);
    setSyncMeta({ version: result.syncVersion, lastSyncAt: Date.now() });
    // A quick-unlock PIN wraps the old key, so it has to be re-created or dropped.
    if (hasQuickUnlock() || hasBiometricUnlock()) {
      removeBiometric();
      const { disableQuickUnlock } = await import('./storage.js');
      disableQuickUnlock();
    }
    closeModal();
    showToast('Mot de passe mis à jour. Reconfigurez le code rapide si besoin.');
    render();
  });
}

function openExportModal() {
  const sheet = openModal(`
    <p class="modal-title">Exporter mes données</p>
    <p class="lock-sub">Choisissez un mot de passe pour protéger le fichier. Il vous sera demandé lors de la restauration — il n'est stocké nulle part.</p>
    <form id="export-form">
      <div class="form-row">
        <label for="exp-pass1">Mot de passe du fichier</label>
        <input type="password" id="exp-pass1" autocomplete="new-password" minlength="8" required />
      </div>
      <div class="form-row">
        <label for="exp-pass2">Confirmez</label>
        <input type="password" id="exp-pass2" autocomplete="new-password" minlength="8" required />
      </div>
      <p class="lock-error" id="exp-error"></p>
      <button type="submit" class="btn-primary">Télécharger la sauvegarde</button>
      <button type="button" class="btn-secondary" id="exp-cancel">Annuler</button>
    </form>
  `);

  sheet.querySelector('#exp-cancel').addEventListener('click', closeModal);
  sheet.querySelector('#export-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = sheet.querySelector('#exp-error');
    const pass1 = sheet.querySelector('#exp-pass1').value;
    if (pass1.length < 8) {
      errorEl.textContent = 'Utilisez au moins 8 caractères.';
      return;
    }
    if (pass1 !== sheet.querySelector('#exp-pass2').value) {
      errorEl.textContent = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    const backup = await buildBackup(store.state, pass1);
    downloadBackup(backup);
    closeModal();
    showToast('Sauvegarde chiffrée téléchargée.');
  });
}

function openImportModal(backup) {
  const sheet = openModal(`
    <p class="modal-title">Restaurer une sauvegarde</p>
    <p class="lock-sub">Sauvegarde du ${escapeHtml(new Date(backup.createdAt).toLocaleDateString('fr-FR'))}. Les données seront fusionnées avec celles de cet appareil : en cas de doublon, la version la plus récente est conservée.</p>
    <form id="import-form">
      <div class="form-row">
        <label for="imp-pass">Mot de passe du fichier</label>
        <input type="password" id="imp-pass" autocomplete="current-password" required />
      </div>
      <p class="lock-error" id="imp-error"></p>
      <button type="submit" class="btn-primary">Restaurer</button>
      <button type="button" class="btn-secondary" id="imp-cancel">Annuler</button>
    </form>
  `);

  sheet.querySelector('#imp-cancel').addEventListener('click', closeModal);
  sheet.querySelector('#import-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorEl = sheet.querySelector('#imp-error');
    const result = await restoreBackup(backup, sheet.querySelector('#imp-pass').value, store.state);
    if (!result.ok) {
      errorEl.textContent = result.message;
      return;
    }
    await commit((state) => {
      Object.assign(state, result.state);
    });
    closeModal();
    showToast('Sauvegarde restaurée.');
    await runSync();
  });
}

// ---------- Boot ----------

document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

fabAdd.addEventListener('click', () => openTransactionModal(null));

window.addEventListener('online', () => runSync());
window.addEventListener('focus', () => {
  if (isOpen() && getMode() === 'account') runSync();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => console.error('SW registration failed', error));
  });
}

applyTheme('auto');

if (!hasVault()) {
  if (hasLegacyPlaintextData()) renderLocalPinSetup();
  else renderWelcome();
} else {
  renderUnlock();
  refreshSession();
}
