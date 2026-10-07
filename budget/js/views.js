import { store } from './store.js';
import { escapeHtml, money, dateFmt, monthFmt, monthLongFmt } from './ui.js';
import {
  BUDGET_SPACES, spaceLabel, spaceIcon, activeRecords, transactionsInScope,
  computeTotals, transactionsForMonth, budgetProgress, goalProgress, categoriesForSpace,
} from './model.js';
import { renderDonutChart, renderGroupedBarChart, PALETTE } from './charts.js';

function spaceChips(selected, attribute) {
  return ['all', ...BUDGET_SPACES.map((s) => s.id)]
    .map((id) => {
      const label = id === 'all' ? 'Tous' : `${spaceIcon(id)} ${spaceLabel(id)}`;
      return `<button data-${attribute}="${id}" class="${selected === id ? 'active' : ''}">${label}</button>`;
    })
    .join('');
}

// `riseIsGood` flips the colour coding: more income is good news, more spending is not.
function deltaBadge(current, previous, riseIsGood = false) {
  if (previous === 0) {
    return current === 0 ? '<span class="delta neutral">—</span>' : '<span class="delta neutral">nouveau</span>';
  }
  const rounded = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (rounded === 0) return '<span class="delta neutral">stable</span>';
  const rising = rounded > 0;
  const tone = rising === riseIsGood ? 'good' : 'bad';
  return `<span class="delta ${tone}">${rising ? '▲' : '▼'} ${Math.abs(rounded)} %</span>`;
}

export function renderDashboard(viewRoot) {
  const state = store.state;
  const { dashboardSpace: space, dashboardPeriod: period } = store.ui;
  const list = transactionsInScope(state, { space, period });
  const totals = computeTotals(list);

  const now = new Date();
  const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = computeTotals(transactionsForMonth(state, space, now));
  const lastMonth = computeTotals(transactionsForMonth(state, space, previousMonthDate));

  const expenseByCategory = {};
  list.filter((tx) => tx.type === 'expense').forEach((tx) => {
    expenseByCategory[tx.category] = (expenseByCategory[tx.category] || 0) + tx.amount;
  });
  const categoryData = Object.entries(expenseByCategory)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  categoryData.forEach((d, i) => { d.color = PALETTE[i % PALETTE.length]; });

  const months = [];
  for (let i = 5; i >= 0; i -= 1) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  const monthlyData = months.map((date) => {
    const monthTotals = computeTotals(transactionsForMonth(state, space, date));
    return { label: monthFmt.format(date), income: monthTotals.income, expense: monthTotals.expense };
  });

  const budgets = budgetProgress(state).filter((budget) => space === 'all' || budget.space === space);
  const exceeded = budgets.filter((budget) => budget.exceeded);

  viewRoot.innerHTML = `
    <div class="segmented" id="dash-space-chips">${spaceChips(space, 'space')}</div>
    <div class="segmented" id="dash-period-chips">
      ${[['month', 'Ce mois-ci'], ['year', 'Cette année'], ['all', 'Tout']]
        .map(([id, label]) => `<button data-period="${id}" class="${period === id ? 'active' : ''}">${label}</button>`)
        .join('')}
    </div>

    <div class="summary-grid">
      <div class="summary-card"><div class="label">Revenus</div><div class="value positive">${money(totals.income)}</div></div>
      <div class="summary-card"><div class="label">Dépenses</div><div class="value negative">${money(totals.expense)}</div></div>
      <div class="summary-card"><div class="label">Solde</div><div class="value ${totals.balance >= 0 ? 'positive' : 'negative'}">${money(totals.balance)}</div></div>
    </div>

    ${exceeded.length ? `
      <div class="alert-card">
        <strong>${exceeded.length} budget${exceeded.length > 1 ? 's' : ''} dépassé${exceeded.length > 1 ? 's' : ''}</strong>
        <div class="alert-list">${exceeded.slice(0, 3).map((budget) => `
          <div>${escapeHtml(budget.category)} — ${money(budget.spent)} / ${money(budget.amount)}</div>
        `).join('')}</div>
      </div>
    ` : ''}

    <div class="card">
      <p class="section-title">Ce mois-ci vs ${escapeHtml(monthLongFmt.format(previousMonthDate))}</p>
      <div class="compare-row">
        <div class="compare-cell">
          <div class="label">Dépenses</div>
          <div class="value negative">${money(thisMonth.expense)}</div>
          ${deltaBadge(thisMonth.expense, lastMonth.expense, false)}
          <div class="compare-previous">avant : ${money(lastMonth.expense)}</div>
        </div>
        <div class="compare-cell">
          <div class="label">Revenus</div>
          <div class="value positive">${money(thisMonth.income)}</div>
          ${deltaBadge(thisMonth.income, lastMonth.income, true)}
          <div class="compare-previous">avant : ${money(lastMonth.income)}</div>
        </div>
        <div class="compare-cell">
          <div class="label">Solde</div>
          <div class="value ${thisMonth.balance >= 0 ? 'positive' : 'negative'}">${money(thisMonth.balance)}</div>
          ${deltaBadge(thisMonth.balance, lastMonth.balance, true)}
          <div class="compare-previous">avant : ${money(lastMonth.balance)}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <p class="section-title">Revenus et dépenses (6 derniers mois)</p>
      <div class="bar-chart-wrap"><svg id="grouped-chart"></svg></div>
      <div class="legend">
        <div class="legend-item"><span class="legend-dot" style="background:#10B981"></span>Revenus</div>
        <div class="legend-item"><span class="legend-dot" style="background:#EF4444"></span>Dépenses</div>
      </div>
    </div>

    <div class="card">
      <p class="section-title">Dépenses par catégorie</p>
      ${categoryData.length ? `
        <div class="chart-wrap"><svg id="donut-chart"></svg></div>
        <div class="legend">
          ${categoryData.map((d) => `
            <div class="legend-item">
              <span class="legend-dot" style="background:${d.color}"></span>${escapeHtml(d.label)}
              <span class="legend-amount">${money(d.value)}</span>
            </div>`).join('')}
        </div>
      ` : '<div class="empty-state">Aucune dépense sur cette période.</div>'}
    </div>
  `;

  renderGroupedBarChart(viewRoot.querySelector('#grouped-chart'), monthlyData, { width: 340, height: 180 });
  if (categoryData.length) renderDonutChart(viewRoot.querySelector('#donut-chart'), categoryData);
}

export function renderTransactions(viewRoot) {
  const state = store.state;
  const list = transactionsInScope(state, { space: store.ui.txSpace, search: store.ui.txSearch });

  const groups = new Map();
  list.forEach((tx) => {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  });

  let rowsHtml = '';
  if (!list.length) {
    rowsHtml = '<div class="empty-state">Aucune transaction. Appuyez sur + pour en ajouter une.</div>';
  } else {
    groups.forEach((txs, date) => {
      rowsHtml += `<div class="tx-group-label">${escapeHtml(dateFmt.format(new Date(date)))}</div>`;
      txs.forEach((tx) => {
        const hasReceipt = tx.receiptId && state.receipts[tx.receiptId] && !state.receipts[tx.receiptId].deleted;
        rowsHtml += `
          <div class="tx-row" data-id="${escapeHtml(tx.id)}">
            <div class="tx-icon">${spaceIcon(tx.space)}</div>
            <div class="tx-info">
              <div class="tx-desc">${escapeHtml(tx.description || tx.category)}</div>
              <div class="tx-meta">
                ${escapeHtml(tx.category)} · ${escapeHtml(spaceLabel(tx.space))}
                ${hasReceipt ? '<span class="chip-mini">📎 reçu</span>' : ''}
                ${tx.recurringId ? '<span class="chip-mini">🔁 récurrent</span>' : ''}
              </div>
            </div>
            <div class="tx-amount ${tx.type === 'income' ? 'positive' : 'negative'}">${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}</div>
          </div>`;
      });
    });
  }

  viewRoot.innerHTML = `
    <input type="search" class="search-input" id="tx-search" placeholder="Rechercher..." value="${escapeHtml(store.ui.txSearch)}" />
    <div class="segmented" id="tx-space-chips">${spaceChips(store.ui.txSpace, 'space')}</div>
    <div id="tx-list">${rowsHtml}</div>
  `;
}

export function renderPlanning(viewRoot) {
  const state = store.state;
  const budgets = budgetProgress(state);
  const goals = activeRecords(state, 'goals').map(goalProgress);
  const recurring = activeRecords(state, 'recurring');

  const budgetRows = budgets.length ? budgets.map((budget) => {
    const percent = Math.min(Math.round(budget.ratio * 100), 999);
    const barWidth = Math.min(budget.ratio * 100, 100);
    const tone = budget.exceeded ? 'over' : budget.ratio > 0.8 ? 'warn' : 'ok';
    return `
      <div class="progress-row" data-budget-id="${escapeHtml(budget.id)}">
        <div class="progress-head">
          <span>${spaceIcon(budget.space)} ${escapeHtml(budget.category)}</span>
          <span class="progress-value ${tone}">${money(budget.spent)} / ${money(budget.amount)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill ${tone}" style="width:${barWidth}%"></div></div>
        <div class="progress-foot">${percent} % utilisé · ${budget.exceeded ? `dépassement de ${money(-budget.remaining)}` : `reste ${money(budget.remaining)}`}</div>
      </div>`;
  }).join('') : '<div class="empty-state">Aucun budget défini. Fixez un plafond mensuel par catégorie.</div>';

  const goalRows = goals.length ? goals.map((goal) => {
    const percent = Math.round(goal.ratio * 100);
    return `
      <div class="progress-row" data-goal-id="${escapeHtml(goal.id)}">
        <div class="progress-head">
          <span>${goal.reached ? '🏆' : '🎯'} ${escapeHtml(goal.name)}</span>
          <span class="progress-value ${goal.reached ? 'ok' : ''}">${money(goal.savedAmount)} / ${money(goal.targetAmount)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill ok" style="width:${percent}%"></div></div>
        <div class="progress-foot">
          ${goal.reached ? 'Objectif atteint' : `reste ${money(goal.remaining)}`}
          ${goal.targetDate ? ` · échéance ${escapeHtml(dateFmt.format(new Date(goal.targetDate)))}` : ''}
        </div>
      </div>`;
  }).join('') : '<div class="empty-state">Aucun objectif d\'épargne pour le moment.</div>';

  const recurringRows = recurring.length ? recurring.map((template) => `
      <div class="category-row" data-recurring-id="${escapeHtml(template.id)}">
        <span>
          ${template.type === 'income' ? '📈' : '📉'} ${escapeHtml(template.description || template.category)}
          <span class="row-sub">${money(template.amount)} · le ${escapeHtml(String(template.dayOfMonth))} du mois · ${escapeHtml(spaceLabel(template.space))}</span>
        </span>
        <button data-action="edit-recurring">Modifier</button>
      </div>`).join('') : '<div class="empty-state">Aucune transaction récurrente.</div>';

  viewRoot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <p class="section-title">Budgets prévisionnels</p>
        <button class="btn-inline" id="add-budget">+ Ajouter</button>
      </div>
      <div class="progress-list">${budgetRows}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <p class="section-title">Objectifs d'épargne</p>
        <button class="btn-inline" id="add-goal">+ Ajouter</button>
      </div>
      <div class="progress-list">${goalRows}</div>
    </div>

    <div class="card">
      <div class="card-head">
        <p class="section-title">Transactions récurrentes</p>
        <button class="btn-inline" id="add-recurring">+ Ajouter</button>
      </div>
      <div class="category-list">${recurringRows}</div>
    </div>
  `;
}

export function renderSettings(viewRoot, context) {
  const state = store.state;
  const { syncStatus, syncMessage, lastSyncAt, prefs, biometricSupported, biometricEnabled, quickUnlockEnabled } = context;

  const categorySections = BUDGET_SPACES.map((space) => {
    const names = categoriesForSpace(state, space.id);
    const used = new Set(activeRecords(state, 'transactions').filter((tx) => tx.space === space.id).map((tx) => tx.category));
    const rows = names.map((name) => `
      <div class="category-row" data-space="${space.id}" data-cat="${escapeHtml(name)}">
        <span>${escapeHtml(name)}</span>
        ${used.has(name) ? '<span class="row-sub">utilisée</span>' : '<button data-action="delete-cat">Supprimer</button>'}
      </div>`).join('');
    return `
      <div class="subsection">
        <p class="subsection-title">${space.icon} ${space.label}</p>
        <div class="category-list">${rows || '<div class="empty-state">Aucune catégorie</div>'}</div>
        <div class="add-category-row">
          <input type="text" placeholder="Nouvelle catégorie" data-new-cat="${space.id}" />
          <button data-add-cat="${space.id}">Ajouter</button>
        </div>
      </div>`;
  }).join('');

  const accountBlock = store.mode === 'account' ? `
      <p class="lock-sub">Connecté en tant que <strong>${escapeHtml(store.account ? store.account.email : '')}</strong>.</p>
      <div class="sync-status ${syncStatus}">
        <span class="sync-dot"></span>
        <span>${escapeHtml(syncMessage)}</span>
      </div>
      ${lastSyncAt ? `<p class="row-sub">Dernière synchro : ${escapeHtml(dateFmt.format(new Date(lastSyncAt)))}</p>` : ''}
      <button class="btn-secondary" id="sync-now-btn">Synchroniser maintenant</button>
      <button class="btn-secondary" id="change-password-btn">Changer le mot de passe du compte</button>
      <button class="btn-secondary" id="logout-btn">Se déconnecter de cet appareil</button>
    ` : `
      <p class="lock-sub">Vos données restent sur cet appareil uniquement. Créez un compte pour les synchroniser entre votre iPad et votre téléphone — elles resteront chiffrées : le serveur ne peut pas les lire.</p>
      <button class="btn-primary" id="create-account-btn">Créer un compte et synchroniser</button>
      <button class="btn-secondary" id="login-account-btn">J'ai déjà un compte</button>
    `;

  viewRoot.innerHTML = `
    <div class="card">
      <p class="section-title">Compte et synchronisation</p>
      ${accountBlock}
    </div>

    <div class="card">
      <p class="section-title">Verrouillage</p>
      <p class="lock-sub">L'application se verrouille dès qu'elle passe en arrière-plan, et après une période d'inactivité.</p>
      <div class="form-row">
        <label for="autolock-select">Verrouiller après inactivité</label>
        <select id="autolock-select">
          ${[[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [15, '15 minutes'], [0, 'Jamais (déconseillé)']]
            .map(([value, label]) => `<option value="${value}" ${prefs.autoLockMinutes === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </div>
      <label class="switch-row">
        <span>Mode confidentialité <span class="row-sub">masque les montants à l'écran</span></span>
        <input type="checkbox" id="privacy-toggle" ${store.ui.privacyMode ? 'checked' : ''} />
      </label>
      ${biometricSupported ? `
        <label class="switch-row">
          <span>Déverrouillage biométrique <span class="row-sub">Face ID / Touch ID</span></span>
          <input type="checkbox" id="biometric-toggle" ${biometricEnabled ? 'checked' : ''} />
        </label>` : '<p class="row-sub">Le déverrouillage biométrique n\'est pas disponible sur cet appareil ou ce navigateur.</p>'}
      <button class="btn-secondary" id="lock-now-btn">Verrouiller maintenant</button>
      <button class="btn-secondary" id="change-pin-btn">${quickUnlockEnabled || store.mode === 'local' ? 'Changer le code d\'accès' : 'Définir un code d\'accès rapide'}</button>
    </div>

    <div class="card">
      <p class="section-title">Apparence</p>
      <div class="form-row">
        <label for="theme-select">Thème</label>
        <select id="theme-select">
          ${[['auto', 'Automatique (système)'], ['light', 'Clair'], ['dark', 'Sombre']]
            .map(([value, label]) => `<option value="${value}" ${context.theme === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </div>
    </div>

    <div class="card">
      <p class="section-title">Sauvegarde</p>
      <p class="lock-sub">Le fichier exporté est chiffré avec un mot de passe que vous choisissez au moment de l'export. Gardez-le pour restaurer vos données ou les transférer sur un autre appareil.</p>
      <button class="btn-secondary" id="export-btn">Exporter mes données (chiffré)</button>
      <button class="btn-secondary" id="import-btn">Importer une sauvegarde</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
    </div>

    <div class="card">
      <p class="section-title">Catégories</p>
      ${categorySections}
    </div>

    <div class="card">
      <p class="section-title">Zone dangereuse</p>
      <p class="lock-sub">Efface les données de cet appareil. ${store.mode === 'account' ? 'Vos données synchronisées restent sur le serveur tant que le compte existe.' : 'Cette action est irréversible.'}</p>
      <button class="btn-danger" id="wipe-btn">Réinitialiser cet appareil</button>
      ${store.mode === 'account' ? '<button class="btn-danger" id="delete-account-btn">Supprimer définitivement mon compte</button>' : ''}
    </div>
  `;
}
