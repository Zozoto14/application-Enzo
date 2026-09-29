import { store, commit, upsert, removeWithUndo, showToast } from './store.js';
import { escapeHtml, todayIso } from './ui.js';
import { BUDGET_SPACES, categoriesForSpace, uid } from './model.js';

const modalRoot = document.getElementById('modal-root');

export function closeModal() {
  modalRoot.innerHTML = '';
}

function openModal(html) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <button class="modal-close" id="modal-close" aria-label="Fermer">✕</button>
        ${html}
      </div>
    </div>`;
  const overlay = modalRoot.querySelector('#modal-overlay');
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  modalRoot.querySelector('#modal-close').addEventListener('click', closeModal);
  return modalRoot.querySelector('.modal-sheet');
}

function spaceOptions(selected) {
  return BUDGET_SPACES.map((space) => `<option value="${space.id}" ${space.id === selected ? 'selected' : ''}>${space.icon} ${space.label}</option>`).join('');
}

function categoryOptions(space, selected) {
  return categoriesForSpace(store.state, space)
    .map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`)
    .join('');
}

// Receipts are stored inside the encrypted vault and also travel through sync, so
// they are downscaled aggressively before they ever hit storage.
const MAX_RECEIPT_EDGE = 1400;
const RECEIPT_QUALITY = 0.72;

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Image illisible.'));
      image.onload = () => {
        const scale = Math.min(1, MAX_RECEIPT_EDGE / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', RECEIPT_QUALITY));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Shown on top of the transaction sheet; closing it reopens the sheet so the edit
// in progress is not lost.
function showFullReceipt(dataUrl, onClose) {
  const sheet = openModal(`
    <p class="modal-title">Reçu</p>
    <img class="receipt-full" src="${dataUrl}" alt="Photo du reçu" />
    <button type="button" class="btn-secondary" id="close-receipt">Retour</button>
  `);
  sheet.querySelector('#close-receipt').addEventListener('click', () => {
    closeModal();
    if (onClose) onClose();
  });
}

export function openTransactionModal(id) {
  const existing = id ? store.state.transactions[id] : null;
  const type = existing ? existing.type : 'expense';
  const space = existing ? existing.space : BUDGET_SPACES[0].id;
  let pendingReceipt = existing && existing.receiptId ? store.state.receipts[existing.receiptId] : null;
  let receiptDataUrl = pendingReceipt && !pendingReceipt.deleted ? pendingReceipt.dataUrl : null;
  let receiptRemoved = false;

  const sheet = openModal(`
    <p class="modal-title">${existing ? 'Modifier' : 'Nouvelle'} transaction</p>
    <form id="tx-form">
      <div class="form-row">
        <div class="type-toggle">
          <button type="button" data-type="expense" class="${type === 'expense' ? 'active expense' : ''}">Dépense</button>
          <button type="button" data-type="income" class="${type === 'income' ? 'active income' : ''}">Revenu</button>
        </div>
        <input type="hidden" name="type" value="${type}" />
      </div>
      <div class="form-row">
        <label for="f-amount">Montant (€)</label>
        <input type="number" id="f-amount" name="amount" inputmode="decimal" step="0.01" min="0" value="${existing ? existing.amount : ''}" required />
      </div>
      <div class="form-row">
        <label for="f-space">Espace budgétaire</label>
        <select id="f-space" name="space">${spaceOptions(space)}</select>
      </div>
      <div class="form-row">
        <label for="f-category">Catégorie</label>
        <select id="f-category" name="category">${categoryOptions(space, existing ? existing.category : '')}</select>
      </div>
      <div class="form-row">
        <label for="f-date">Date</label>
        <input type="date" id="f-date" name="date" value="${existing ? escapeHtml(existing.date) : todayIso()}" required />
      </div>
      <div class="form-row">
        <label for="f-desc">Description</label>
        <input type="text" id="f-desc" name="description" value="${existing ? escapeHtml(existing.description) : ''}" placeholder="Optionnel" />
      </div>
      <div class="form-row">
        <label>Reçu</label>
        <div class="receipt-zone" id="receipt-zone">
          ${receiptDataUrl ? `<img class="receipt-thumb" src="${receiptDataUrl}" alt="Aperçu du reçu" />` : '<span class="row-sub">Aucune photo</span>'}
        </div>
        <div class="receipt-actions">
          <button type="button" class="btn-inline" id="receipt-add">${receiptDataUrl ? 'Remplacer' : '📷 Ajouter une photo'}</button>
          ${receiptDataUrl ? '<button type="button" class="btn-inline danger" id="receipt-remove">Retirer</button>' : ''}
        </div>
        <input type="file" id="receipt-input" accept="image/*" capture="environment" hidden />
        <p class="lock-error" id="receipt-error"></p>
      </div>
      <button type="submit" class="btn-primary">Enregistrer</button>
      ${existing ? '<button type="button" class="btn-danger" id="tx-delete">Supprimer</button>' : ''}
      <button type="button" class="btn-secondary" id="tx-cancel">Annuler</button>
    </form>
  `);

  const form = sheet.querySelector('#tx-form');
  const spaceSelect = sheet.querySelector('#f-space');
  const categorySelect = sheet.querySelector('#f-category');
  const typeInput = form.querySelector('input[name="type"]');
  const receiptInput = sheet.querySelector('#receipt-input');
  const receiptZone = sheet.querySelector('#receipt-zone');
  const receiptError = sheet.querySelector('#receipt-error');

  sheet.querySelectorAll('.type-toggle button').forEach((button) => {
    button.addEventListener('click', () => {
      sheet.querySelectorAll('.type-toggle button').forEach((b) => b.classList.remove('active', 'income', 'expense'));
      button.classList.add('active', button.dataset.type);
      typeInput.value = button.dataset.type;
    });
  });

  spaceSelect.addEventListener('change', () => {
    categorySelect.innerHTML = categoryOptions(spaceSelect.value, '');
  });

  sheet.querySelector('#receipt-add').addEventListener('click', () => receiptInput.click());
  receiptZone.addEventListener('click', (event) => {
    if (!event.target.classList.contains('receipt-thumb') || !receiptDataUrl) return;
    showFullReceipt(receiptDataUrl, () => openTransactionModal(id));
  });
  receiptInput.addEventListener('change', async () => {
    const file = receiptInput.files && receiptInput.files[0];
    if (!file) return;
    receiptError.textContent = '';
    try {
      receiptDataUrl = await resizeImage(file);
      receiptRemoved = false;
      receiptZone.innerHTML = `<img class="receipt-thumb" src="${receiptDataUrl}" alt="Aperçu du reçu" />`;
    } catch (error) {
      receiptError.textContent = error.message;
    }
  });
  const removeButton = sheet.querySelector('#receipt-remove');
  if (removeButton) {
    removeButton.addEventListener('click', () => {
      receiptDataUrl = null;
      receiptRemoved = true;
      receiptZone.innerHTML = '<span class="row-sub">Aucune photo</span>';
      removeButton.remove();
    });
  }

  sheet.querySelector('#tx-cancel').addEventListener('click', closeModal);
  if (existing) {
    sheet.querySelector('#tx-delete').addEventListener('click', async () => {
      closeModal();
      await removeWithUndo('transactions', existing.id, 'Transaction supprimée');
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const amount = parseFloat(data.get('amount'));
    if (Number.isNaN(amount) || amount <= 0) return;

    const chosenSpace = data.get('space');
    const category = data.get('category') || categoriesForSpace(store.state, chosenSpace)[0] || 'Autres';

    let receiptId = existing ? existing.receiptId || null : null;
    if (receiptRemoved && receiptId) {
      const removedId = receiptId;
      await commit((state) => {
        state.receipts[removedId] = { id: removedId, deleted: true, updatedAt: Date.now() };
      }, { render: false });
      receiptId = null;
    }
    if (receiptDataUrl && (!existing || !existing.receiptId || receiptDataUrl !== (store.state.receipts[existing.receiptId] || {}).dataUrl)) {
      receiptId = receiptId || uid();
      const savedId = receiptId;
      await commit((state) => {
        state.receipts[savedId] = { id: savedId, dataUrl: receiptDataUrl, updatedAt: Date.now(), deleted: false };
      }, { render: false });
    }

    await upsert('transactions', {
      id: existing ? existing.id : uid(),
      type: data.get('type'),
      amount,
      space: chosenSpace,
      category,
      date: data.get('date'),
      description: (data.get('description') || '').trim(),
      receiptId,
      recurringId: existing ? existing.recurringId || null : null,
    });
    closeModal();
  });
}

export function openBudgetModal(id) {
  const existing = id ? store.state.budgets[id] : null;
  const space = existing ? existing.space : BUDGET_SPACES[0].id;

  const sheet = openModal(`
    <p class="modal-title">${existing ? 'Modifier le budget' : 'Nouveau budget mensuel'}</p>
    <form id="budget-form">
      <div class="form-row">
        <label for="b-space">Espace budgétaire</label>
        <select id="b-space" name="space">${spaceOptions(space)}</select>
      </div>
      <div class="form-row">
        <label for="b-category">Catégorie</label>
        <select id="b-category" name="category">${categoryOptions(space, existing ? existing.category : '')}</select>
      </div>
      <div class="form-row">
        <label for="b-amount">Plafond mensuel (€)</label>
        <input type="number" id="b-amount" name="amount" inputmode="decimal" step="0.01" min="0" value="${existing ? existing.amount : ''}" required />
      </div>
      <button type="submit" class="btn-primary">Enregistrer</button>
      ${existing ? '<button type="button" class="btn-danger" id="budget-delete">Supprimer</button>' : ''}
      <button type="button" class="btn-secondary" id="budget-cancel">Annuler</button>
    </form>
  `);

  const spaceSelect = sheet.querySelector('#b-space');
  const categorySelect = sheet.querySelector('#b-category');
  spaceSelect.addEventListener('change', () => {
    categorySelect.innerHTML = categoryOptions(spaceSelect.value, '');
  });
  sheet.querySelector('#budget-cancel').addEventListener('click', closeModal);
  if (existing) {
    sheet.querySelector('#budget-delete').addEventListener('click', async () => {
      closeModal();
      await removeWithUndo('budgets', existing.id, 'Budget supprimé');
    });
  }

  sheet.querySelector('#budget-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const amount = parseFloat(data.get('amount'));
    if (Number.isNaN(amount) || amount <= 0) return;
    await upsert('budgets', {
      id: existing ? existing.id : uid(),
      space: data.get('space'),
      category: data.get('category'),
      amount,
    });
    closeModal();
  });
}

export function openGoalModal(id) {
  const existing = id ? store.state.goals[id] : null;

  const sheet = openModal(`
    <p class="modal-title">${existing ? 'Modifier l\'objectif' : 'Nouvel objectif d\'épargne'}</p>
    <form id="goal-form">
      <div class="form-row">
        <label for="g-name">Nom de l'objectif</label>
        <input type="text" id="g-name" name="name" value="${existing ? escapeHtml(existing.name) : ''}" placeholder="Ex. : fonds d'urgence" required />
      </div>
      <div class="form-row">
        <label for="g-target">Montant visé (€)</label>
        <input type="number" id="g-target" name="targetAmount" inputmode="decimal" step="0.01" min="0" value="${existing ? existing.targetAmount : ''}" required />
      </div>
      <div class="form-row">
        <label for="g-saved">Déjà épargné (€)</label>
        <input type="number" id="g-saved" name="savedAmount" inputmode="decimal" step="0.01" min="0" value="${existing ? existing.savedAmount : '0'}" required />
      </div>
      <div class="form-row">
        <label for="g-date">Échéance (optionnel)</label>
        <input type="date" id="g-date" name="targetDate" value="${existing && existing.targetDate ? escapeHtml(existing.targetDate) : ''}" />
      </div>
      <button type="submit" class="btn-primary">Enregistrer</button>
      ${existing ? '<button type="button" class="btn-danger" id="goal-delete">Supprimer</button>' : ''}
      <button type="button" class="btn-secondary" id="goal-cancel">Annuler</button>
    </form>
  `);

  sheet.querySelector('#goal-cancel').addEventListener('click', closeModal);
  if (existing) {
    sheet.querySelector('#goal-delete').addEventListener('click', async () => {
      closeModal();
      await removeWithUndo('goals', existing.id, 'Objectif supprimé');
    });
  }

  sheet.querySelector('#goal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const targetAmount = parseFloat(data.get('targetAmount'));
    const savedAmount = parseFloat(data.get('savedAmount')) || 0;
    if (Number.isNaN(targetAmount) || targetAmount <= 0) return;
    await upsert('goals', {
      id: existing ? existing.id : uid(),
      name: (data.get('name') || '').trim(),
      targetAmount,
      savedAmount,
      targetDate: data.get('targetDate') || null,
    });
    closeModal();
  });
}

export function openRecurringModal(id) {
  const existing = id ? store.state.recurring[id] : null;
  const space = existing ? existing.space : BUDGET_SPACES[0].id;
  const type = existing ? existing.type : 'expense';

  const sheet = openModal(`
    <p class="modal-title">${existing ? 'Modifier la récurrence' : 'Nouvelle transaction récurrente'}</p>
    <form id="recurring-form">
      <div class="form-row">
        <div class="type-toggle">
          <button type="button" data-type="expense" class="${type === 'expense' ? 'active expense' : ''}">Dépense</button>
          <button type="button" data-type="income" class="${type === 'income' ? 'active income' : ''}">Revenu</button>
        </div>
        <input type="hidden" name="type" value="${type}" />
      </div>
      <div class="form-row">
        <label for="r-desc">Libellé</label>
        <input type="text" id="r-desc" name="description" value="${existing ? escapeHtml(existing.description) : ''}" placeholder="Ex. : loyer" required />
      </div>
      <div class="form-row">
        <label for="r-amount">Montant (€)</label>
        <input type="number" id="r-amount" name="amount" inputmode="decimal" step="0.01" min="0" value="${existing ? existing.amount : ''}" required />
      </div>
      <div class="form-row">
        <label for="r-space">Espace budgétaire</label>
        <select id="r-space" name="space">${spaceOptions(space)}</select>
      </div>
      <div class="form-row">
        <label for="r-category">Catégorie</label>
        <select id="r-category" name="category">${categoryOptions(space, existing ? existing.category : '')}</select>
      </div>
      <div class="form-row">
        <label for="r-day">Jour du mois</label>
        <input type="number" id="r-day" name="dayOfMonth" inputmode="numeric" min="1" max="31" value="${existing ? existing.dayOfMonth : 1}" required />
      </div>
      <div class="form-row">
        <label for="r-start">À partir du</label>
        <input type="date" id="r-start" name="startDate" value="${existing ? escapeHtml(existing.startDate) : todayIso()}" required />
      </div>
      <div class="form-row">
        <label for="r-end">Jusqu'au (optionnel)</label>
        <input type="date" id="r-end" name="endDate" value="${existing && existing.endDate ? escapeHtml(existing.endDate) : ''}" />
      </div>
      <button type="submit" class="btn-primary">Enregistrer</button>
      ${existing ? '<button type="button" class="btn-danger" id="recurring-delete">Supprimer</button>' : ''}
      <button type="button" class="btn-secondary" id="recurring-cancel">Annuler</button>
    </form>
  `);

  const spaceSelect = sheet.querySelector('#r-space');
  const categorySelect = sheet.querySelector('#r-category');
  const typeInput = sheet.querySelector('input[name="type"]');
  spaceSelect.addEventListener('change', () => {
    categorySelect.innerHTML = categoryOptions(spaceSelect.value, '');
  });
  sheet.querySelectorAll('.type-toggle button').forEach((button) => {
    button.addEventListener('click', () => {
      sheet.querySelectorAll('.type-toggle button').forEach((b) => b.classList.remove('active', 'income', 'expense'));
      button.classList.add('active', button.dataset.type);
      typeInput.value = button.dataset.type;
    });
  });
  sheet.querySelector('#recurring-cancel').addEventListener('click', closeModal);
  if (existing) {
    sheet.querySelector('#recurring-delete').addEventListener('click', async () => {
      closeModal();
      await removeWithUndo('recurring', existing.id, 'Récurrence supprimée');
    });
  }

  sheet.querySelector('#recurring-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const amount = parseFloat(data.get('amount'));
    if (Number.isNaN(amount) || amount <= 0) return;
    await upsert('recurring', {
      id: existing ? existing.id : uid(),
      type: data.get('type'),
      amount,
      space: data.get('space'),
      category: data.get('category'),
      description: (data.get('description') || '').trim(),
      dayOfMonth: Number(data.get('dayOfMonth')) || 1,
      startDate: data.get('startDate'),
      endDate: data.get('endDate') || null,
      lastGeneratedMonth: existing ? existing.lastGeneratedMonth || null : null,
    });
    showToast('Récurrence enregistrée. Les échéances passées seront créées à la prochaine ouverture.');
    closeModal();
  });
}

export { openModal };
