import { loadState, saveState, uid, BUDGET_SPACES, spaceLabel, spaceIcon } from './storage.js';
import { renderDonutChart, renderBarChart, PALETTE } from './charts.js';

const state = loadState();
const ui = {
  tab: 'dashboard',
  dashboardSpace: 'all',
  dashboardPeriod: 'month',
  txSpace: 'all',
  txSearch: '',
  editingId: null,
};

const currencyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

const viewRoot = document.getElementById('view-root');
const pageTitle = document.getElementById('page-title');
const modalRoot = document.getElementById('modal-root');
const fabAdd = document.getElementById('fab-add');

const TAB_TITLES = { dashboard: 'Tableau de bord', transactions: 'Transactions', categories: 'Catégories' };

function persist() {
  saveState(state);
}

function formatAmount(n) {
  return currencyFmt.format(n);
}

function allCategoriesFor(spaceIds) {
  const set = new Set();
  spaceIds.forEach((id) => (state.categories[id] || []).forEach((c) => set.add(c)));
  return Array.from(set);
}

function spacesInScope(spaceFilter) {
  return spaceFilter === 'all' ? BUDGET_SPACES.map((s) => s.id) : [spaceFilter];
}

function inPeriod(tx, period) {
  const d = new Date(tx.date);
  const now = new Date();
  if (period === 'month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (period === 'year') {
    return d.getFullYear() === now.getFullYear();
  }
  return true;
}

function filteredTransactions({ space, period, search }) {
  const scope = spacesInScope(space);
  return state.transactions
    .filter((tx) => scope.includes(tx.space))
    .filter((tx) => (period ? inPeriod(tx, period) : true))
    .filter((tx) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return tx.description.toLowerCase().includes(q) || tx.category.toLowerCase().includes(q);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function computeTotals(list) {
  let income = 0;
  let expense = 0;
  list.forEach((tx) => {
    if (tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  });
  return { income, expense, balance: income - expense };
}

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  pageTitle.textContent = TAB_TITLES[tab];
  fabAdd.style.display = tab === 'categories' ? 'none' : 'flex';
  render();
}

function render() {
  if (ui.tab === 'dashboard') renderDashboard();
  else if (ui.tab === 'transactions') renderTransactions();
  else if (ui.tab === 'categories') renderCategories();
}

// ---------- Dashboard ----------

function renderDashboard() {
  const list = filteredTransactions({ space: ui.dashboardSpace, period: ui.dashboardPeriod });
  const totals = computeTotals(list);

  const spaceChips = ['all', ...BUDGET_SPACES.map((s) => s.id)]
    .map((id) => {
      const label = id === 'all' ? 'Tous' : `${spaceIcon(id)} ${spaceLabel(id)}`;
      return `<button data-space="${id}" class="${ui.dashboardSpace === id ? 'active' : ''}">${label}</button>`;
    })
    .join('');

  const periodChips = [
    ['month', 'Ce mois-ci'],
    ['year', 'Cette année'],
    ['all', 'Tout'],
  ]
    .map(([id, label]) => `<button data-period="${id}" class="${ui.dashboardPeriod === id ? 'active' : ''}">${label}</button>`)
    .join('');

  const expenseByCategory = {};
  list.filter((tx) => tx.type === 'expense').forEach((tx) => {
    expenseByCategory[tx.category] = (expenseByCategory[tx.category] || 0) + tx.amount;
  });
  const categoryData = Object.entries(expenseByCategory)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  categoryData.forEach((d, i) => (d.color = PALETTE[i % PALETTE.length]));

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  const monthlyData = months.map((d) => {
    const txs = state.transactions.filter((tx) => {
      const scope = spacesInScope(ui.dashboardSpace);
      if (!scope.includes(tx.space)) return false;
      const td = new Date(tx.date);
      return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth();
    });
    const t = computeTotals(txs);
    return { label: monthFmt.format(d), value: t.balance };
  });

  viewRoot.innerHTML = `
    <div class="segmented" id="dash-space-chips">${spaceChips}</div>
    <div class="segmented" id="dash-period-chips">${periodChips}</div>
    <div class="summary-grid">
      <div class="summary-card"><div class="label">Revenus</div><div class="value positive">${formatAmount(totals.income)}</div></div>
      <div class="summary-card"><div class="label">Dépenses</div><div class="value negative">${formatAmount(totals.expense)}</div></div>
      <div class="summary-card"><div class="label">Solde</div><div class="value ${totals.balance >= 0 ? 'positive' : 'negative'}">${formatAmount(totals.balance)}</div></div>
    </div>
    <div class="card">
      <p class="section-title">Dépenses par catégorie</p>
      ${categoryData.length ? `
        <div class="chart-wrap"><svg id="donut-chart"></svg></div>
        <div class="legend">
          ${categoryData
            .map(
              (d) => `<div class="legend-item"><span class="legend-dot" style="background:${d.color}"></span>${d.label}<span class="legend-amount">${formatAmount(d.value)}</span></div>`
            )
            .join('')}
        </div>
      ` : '<div class="empty-state">Aucune dépense sur cette période.</div>'}
    </div>
    <div class="card">
      <p class="section-title">Solde mensuel (6 derniers mois)</p>
      <div class="bar-chart-wrap"><svg id="bar-chart"></svg></div>
    </div>
  `;

  if (categoryData.length) {
    renderDonutChart(document.getElementById('donut-chart'), categoryData);
  }
  renderBarChart(document.getElementById('bar-chart'), monthlyData, { width: 320, height: 170 });

  document.getElementById('dash-space-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-space]');
    if (!btn) return;
    ui.dashboardSpace = btn.dataset.space;
    renderDashboard();
  });
  document.getElementById('dash-period-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-period]');
    if (!btn) return;
    ui.dashboardPeriod = btn.dataset.period;
    renderDashboard();
  });
}

// ---------- Transactions ----------

function renderTransactions() {
  const list = filteredTransactions({ space: ui.txSpace, period: null, search: ui.txSearch });

  const spaceChips = ['all', ...BUDGET_SPACES.map((s) => s.id)]
    .map((id) => {
      const label = id === 'all' ? 'Tous' : `${spaceIcon(id)} ${spaceLabel(id)}`;
      return `<button data-space="${id}" class="${ui.txSpace === id ? 'active' : ''}">${label}</button>`;
    })
    .join('');

  const groups = new Map();
  list.forEach((tx) => {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  });

  let rowsHtml = '';
  if (list.length === 0) {
    rowsHtml = '<div class="empty-state">Aucune transaction. Appuyez sur + pour en ajouter une.</div>';
  } else {
    for (const [date, txs] of groups) {
      rowsHtml += `<div class="tx-group-label">${dateFmt.format(new Date(date))}</div>`;
      txs.forEach((tx) => {
        rowsHtml += `
          <div class="tx-row" data-id="${tx.id}">
            <div class="tx-icon">${spaceIcon(tx.space)}</div>
            <div class="tx-info">
              <div class="tx-desc">${escapeHtml(tx.description || tx.category)}</div>
              <div class="tx-meta">${escapeHtml(tx.category)} · ${spaceLabel(tx.space)}</div>
            </div>
            <div class="tx-amount ${tx.type === 'income' ? 'positive' : 'negative'}">${tx.type === 'income' ? '+' : '-'}${formatAmount(tx.amount)}</div>
          </div>
        `;
      });
    }
  }

  viewRoot.innerHTML = `
    <input type="search" class="search-input" id="tx-search" placeholder="Rechercher..." value="${escapeHtml(ui.txSearch)}" />
    <div class="segmented" id="tx-space-chips">${spaceChips}</div>
    <div id="tx-list">${rowsHtml}</div>
  `;

  document.getElementById('tx-search').addEventListener('input', (e) => {
    ui.txSearch = e.target.value;
    renderTransactions();
  });
  document.getElementById('tx-space-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-space]');
    if (!btn) return;
    ui.txSpace = btn.dataset.space;
    renderTransactions();
  });
  document.getElementById('tx-list').addEventListener('click', (e) => {
    const row = e.target.closest('.tx-row');
    if (!row) return;
    openTransactionModal(row.dataset.id);
  });
}

// ---------- Categories ----------

function renderCategories() {
  const sections = BUDGET_SPACES.map((space) => {
    const cats = state.categories[space.id] || [];
    const usedCategories = new Set(state.transactions.filter((t) => t.space === space.id).map((t) => t.category));
    const rows = cats
      .map(
        (cat) => `
        <div class="category-row" data-space="${space.id}" data-cat="${escapeHtml(cat)}">
          <span>${escapeHtml(cat)}</span>
          ${usedCategories.has(cat) ? '' : '<button data-action="delete-cat">Supprimer</button>'}
        </div>
      `
      )
      .join('');
    return `
      <div class="card">
        <p class="section-title">${space.icon} ${space.label}</p>
        <div class="category-list">${rows || '<div class="empty-state">Aucune catégorie</div>'}</div>
        <div class="add-category-row">
          <input type="text" placeholder="Nouvelle catégorie" data-new-cat="${space.id}" />
          <button data-add-cat="${space.id}">Ajouter</button>
        </div>
      </div>
    `;
  }).join('');

  viewRoot.innerHTML = sections;

  viewRoot.querySelectorAll('[data-add-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spaceId = btn.dataset.addCat;
      const input = viewRoot.querySelector(`[data-new-cat="${spaceId}"]`);
      const value = input.value.trim();
      if (!value) return;
      if (!state.categories[spaceId].includes(value)) {
        state.categories[spaceId].push(value);
        persist();
      }
      renderCategories();
    });
  });

  viewRoot.querySelectorAll('[data-action="delete-cat"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.category-row');
      const spaceId = row.dataset.space;
      const cat = row.dataset.cat;
      state.categories[spaceId] = state.categories[spaceId].filter((c) => c !== cat);
      persist();
      renderCategories();
    });
  });
}

// ---------- Add / Edit modal ----------

function openTransactionModal(id) {
  ui.editingId = id || null;
  const existing = id ? state.transactions.find((t) => t.id === id) : null;
  const type = existing ? existing.type : 'expense';
  const space = existing ? existing.space : BUDGET_SPACES[0].id;
  const amount = existing ? existing.amount : '';
  const date = existing ? existing.date : new Date().toISOString().slice(0, 10);
  const description = existing ? existing.description : '';
  const category = existing ? existing.category : '';

  const spaceOptions = BUDGET_SPACES.map((s) => `<option value="${s.id}" ${s.id === space ? 'selected' : ''}>${s.icon} ${s.label}</option>`).join('');
  const categoryOptions = (state.categories[space] || [])
    .map((c) => `<option value="${escapeHtml(c)}" ${c === category ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet">
        <button class="modal-close" id="modal-close" aria-label="Fermer">✕</button>
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
            <input type="number" id="f-amount" name="amount" inputmode="decimal" step="0.01" min="0" value="${amount}" required />
          </div>
          <div class="form-row">
            <label for="f-space">Espace budgétaire</label>
            <select id="f-space" name="space">${spaceOptions}</select>
          </div>
          <div class="form-row">
            <label for="f-category">Catégorie</label>
            <select id="f-category" name="category">${categoryOptions}</select>
          </div>
          <div class="form-row">
            <label for="f-date">Date</label>
            <input type="date" id="f-date" name="date" value="${date}" required />
          </div>
          <div class="form-row">
            <label for="f-desc">Description</label>
            <input type="text" id="f-desc" name="description" value="${escapeHtml(description)}" placeholder="Optionnel" />
          </div>
          <button type="submit" class="btn-primary">Enregistrer</button>
          ${existing ? '<button type="button" class="btn-danger" id="tx-delete">Supprimer</button>' : ''}
          <button type="button" class="btn-secondary" id="tx-cancel">Annuler</button>
        </form>
      </div>
    </div>
  `;

  const overlay = document.getElementById('modal-overlay');
  const form = document.getElementById('tx-form');
  const spaceSelect = document.getElementById('f-space');
  const categorySelect = document.getElementById('f-category');
  const typeToggleBtns = form.querySelectorAll('.type-toggle button');
  const typeHiddenInput = form.querySelector('input[name="type"]');

  function closeModal() {
    modalRoot.innerHTML = '';
    ui.editingId = null;
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('tx-cancel').addEventListener('click', closeModal);

  typeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      typeToggleBtns.forEach((b) => b.classList.remove('active', 'income', 'expense'));
      btn.classList.add('active', btn.dataset.type);
      typeHiddenInput.value = btn.dataset.type;
    });
  });

  function refreshCategoryOptions() {
    const cats = state.categories[spaceSelect.value] || [];
    categorySelect.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
  spaceSelect.addEventListener('change', refreshCategoryOptions);

  if (existing) {
    document.getElementById('tx-delete').addEventListener('click', () => {
      state.transactions = state.transactions.filter((t) => t.id !== existing.id);
      persist();
      closeModal();
      render();
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const amountValue = parseFloat(data.get('amount'));
    if (Number.isNaN(amountValue) || amountValue <= 0) return;
    const categoryValue = data.get('category') || (state.categories[data.get('space')] || [])[0] || 'Autres';

    const payload = {
      type: data.get('type'),
      amount: amountValue,
      space: data.get('space'),
      category: categoryValue,
      date: data.get('date'),
      description: (data.get('description') || '').trim(),
    };

    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.transactions.push({ id: uid(), ...payload });
    }
    persist();
    closeModal();
    render();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Wiring ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

fabAdd.addEventListener('click', () => openTransactionModal(null));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW registration failed', err));
  });
}

setTab('dashboard');
