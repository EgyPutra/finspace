const DB_NAME = 'finspace-db-v2';
const DB_VERSION = 2;
const STORES = ['wallets', 'transactions', 'budgets', 'goals', 'settings'];

const CATEGORIES = {
  expense: ['Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Lainnya'],
  income: ['Gaji', 'Bonus', 'Bisnis', 'Pengembalian dana', 'Pendapatan lain'],
};

const state = {
  wallets: [],
  transactions: [],
  budgets: [],
  goals: [],
  settings: { id: 'profile', name: '', aiEnabled: true, hideMoney: false, theme: 'system' },
  currentView: 'dashboard',
  aiDraft: null,
  receiptImage: null,
  freshInstall: false,
  sync: { client: null, user: null, available: false, syncing: false, subscription: null, lastUploadedAt: null },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const monthKey = (date = todayISO()) => date.slice(0, 7);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const amountValue = (value) => Number(String(value ?? '').replace(/[^0-9]/g, '')) || 0;
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const shortMoney = (value) => {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1_000_000_000) return `Rp${(number / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(number) >= 1_000_000) return `Rp${(number / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (Math.abs(number) >= 1_000) return `Rp${(number / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return money(number);
};
const dateLabel = (iso) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00`));
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

function effectiveTheme(preference = state.settings.theme || 'system') {
  return preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
}

function applyTheme() {
  const preference = ['system', 'light', 'dark'].includes(state.settings.theme) ? state.settings.theme : 'system';
  const theme = effectiveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem('finspace-theme', preference); } catch (error) { /* Tema tetap aktif untuk sesi ini. */ }
  const dark = theme === 'dark';
  $('#theme-toggle').textContent = dark ? '◑' : '◐';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
  $('#theme-toggle').title = dark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
  $('#theme-color').content = dark ? '#101214' : '#ccff00';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbReadAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbClearAll() {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) tx.objectStore(store).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbReplaceAll(backup) {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) tx.objectStore(store).clear();
  for (const wallet of backup.wallets) tx.objectStore('wallets').put(wallet);
  for (const transaction of backup.transactions) tx.objectStore('transactions').put(transaction);
  for (const budget of backup.budgets) tx.objectStore('budgets').put(budget);
  for (const goal of backup.goals || []) tx.objectStore('goals').put(goal);
  tx.objectStore('settings').put(backup.settings);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Pemulihan data dibatalkan.'));
  });
}

async function seedData() {
  const wallets = await dbReadAll('wallets');
  state.freshInstall = !wallets.length;
  if (!wallets.length) {
    await dbPut('wallets', { id: uid(), name: 'Tunai', type: 'cash', openingBalance: 0, createdAt: new Date().toISOString() });
    await dbPut('wallets', { id: uid(), name: 'Rekening utama', type: 'bank', openingBalance: 0, createdAt: new Date().toISOString() });
  }
  const profiles = await dbReadAll('settings');
  if (!profiles.length) await dbPut('settings', state.settings);
}

async function loadState() {
  await seedData();
  const [wallets, transactions, budgets, goals, settings] = await Promise.all(STORES.map(dbReadAll));
  state.wallets = wallets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.transactions = transactions.sort(sortTransactions);
  state.budgets = budgets;
  state.goals = goals.sort((a, b) => String(a.targetDate).localeCompare(String(b.targetDate)));
  state.settings = { ...state.settings, ...(settings.find((item) => item.id === 'profile') || {}) };
}

function sortTransactions(a, b) {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
}

function walletBalance(walletId) {
  const wallet = state.wallets.find((item) => item.id === walletId);
  let balance = Number(wallet?.openingBalance || 0);
  for (const transaction of state.transactions) {
    if (transaction.type === 'income' && transaction.walletId === walletId) balance += transaction.amount;
    if (transaction.type === 'expense' && transaction.walletId === walletId) balance -= transaction.amount;
    if (transaction.type === 'transfer') {
      if (transaction.walletId === walletId) balance -= transaction.amount;
      if (transaction.destinationWalletId === walletId) balance += transaction.amount;
    }
  }
  return balance;
}

function monthTransactions() {
  const key = monthKey();
  return state.transactions.filter((transaction) => transaction.date.startsWith(key));
}

function monthSummary() {
  return monthTransactions().reduce((result, transaction) => {
    if (transaction.type === 'income') result.income += transaction.amount;
    if (transaction.type === 'expense') result.expense += transaction.amount;
    return result;
  }, { income: 0, expense: 0 });
}

function currentBudgets() {
  const key = monthKey();
  return state.budgets.filter((budget) => budget.month === key);
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 3400);
}

let confirmResolver = null;

function requestConfirmation({ title, message, confirmLabel = 'Lanjutkan', danger = true }) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = confirmLabel;
  $('#confirm-accept').className = `button ${danger ? 'button-danger' : 'button-primary'}`;
  if (dialog.open) dialog.close();
  dialog.showModal();
  window.setTimeout(() => $('#confirm-cancel').focus(), 50);
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function settleConfirmation(accepted) {
  const resolver = confirmResolver;
  confirmResolver = null;
  if ($('#confirm-dialog').open) $('#confirm-dialog').close();
  resolver?.(accepted);
}

function setView(view) {
  if (!document.querySelector(`[data-view-panel="${view}"]`)) view = 'dashboard';
  state.currentView = view;
  $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const titles = { dashboard: 'Beranda', history: 'Riwayat', wallets: 'Dompet', budgets: 'Anggaran', goals: 'Goals', settings: 'Pengaturan' };
  $('#page-title').textContent = titles[view] || 'FinSpace';
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  renderAll();
}

function renderAll() {
  applyTheme();
  renderHeader();
  renderWalletOptions();
  renderDashboard();
  renderHistory();
  renderWallets();
  renderBudgets();
  renderGoals();
  renderSettings();
  applyPrivacyMode();
}

function renderHeader() {
  const hour = new Date().getHours();
  const part = hour < 11 ? 'PAGI' : hour < 15 ? 'SIANG' : hour < 19 ? 'SORE' : 'MALAM';
  const name = state.settings.name ? `, ${state.settings.name.toUpperCase()}` : '';
  $('#greeting').textContent = `SELAMAT ${part}${name}`;
}

function renderDashboard() {
  const balances = state.wallets.map((wallet) => ({ ...wallet, balance: walletBalance(wallet.id) }));
  const total = balances.reduce((sum, wallet) => sum + wallet.balance, 0);
  const summary = monthSummary();
  const surplus = summary.income - summary.expense;
  const activeBudgets = currentBudgets();
  const budgetedCategories = new Set(activeBudgets.map((item) => item.category));
  const budgetedExpense = monthTransactions()
    .filter((item) => item.type === 'expense' && budgetedCategories.has(item.category))
    .reduce((sum, item) => sum + item.amount, 0);
  const totalBudget = activeBudgets.reduce((sum, item) => sum + item.limit, 0);
  const budgetLeft = totalBudget ? totalBudget - budgetedExpense : null;

  $('#total-balance').textContent = money(total);
  $('#balance-note').textContent = state.transactions.length
    ? `${state.transactions.length} transaksi tercatat pada ${state.wallets.length} dompet.`
    : 'Tambahkan transaksi pertama untuk mulai membaca arus uang.';
  $('#metric-income').textContent = money(summary.income);
  $('#metric-expense').textContent = money(summary.expense);
  $('#metric-surplus').textContent = money(surplus);
  $('#metric-budget').textContent = budgetLeft === null ? 'Belum diatur' : money(budgetLeft);
  $('#budget-caption').textContent = budgetLeft === null ? 'Atur batas per kategori' : budgetLeft >= 0 ? 'Masih tersedia bulan ini' : 'Anggaran terlampaui';
  $('#wallet-chips').innerHTML = balances.length
    ? balances.slice(0, 5).map((wallet) => `<div class="wallet-chip"><span>${escapeHTML(wallet.name)}</span><output class="money">${money(wallet.balance)}</output></div>`).join('')
    : '<div class="wallet-chip"><span>Belum ada dompet</span><output>Rp0</output></div>';

  renderWeeklyChart();
  renderCategoryBreakdown();
  renderTransactionList($('#recent-transactions'), state.transactions.slice(0, 5), false);
  renderInsight(summary);
  renderFinancialHealth(total, summary, activeBudgets);
}

function clamp(value, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }

function renderFinancialHealth(totalBalance, summary, budgets) {
  const monthCount = state.transactions.filter((item) => item.date.startsWith(monthKey())).length;
  if (!summary.income && !summary.expense) {
    $('#health-score').textContent = '0';
    $('#health-title').textContent = 'Mulai ukur kebiasaanmu.';
    $('#health-summary').textContent = 'Catat transaksi untuk membangun skor yang lebih akurat.';
    $('#health-factors').innerHTML = '<span>Butuh data transaksi</span>';
    return;
  }
  const surplus = summary.income - summary.expense;
  const cashflow = summary.income ? (summary.expense <= summary.income ? 30 : 0) : 0;
  const savingsRate = summary.income ? clamp(surplus / summary.income / 0.2, 0, 1) * 25 : 0;
  const budgetScore = budgets.length ? budgets.reduce((total, budget) => {
    const used = monthTransactions().filter((item) => item.type === 'expense' && item.category === budget.category).reduce((sum, item) => sum + item.amount, 0);
    return total + (used <= budget.limit ? 1 : clamp(1 - ((used - budget.limit) / budget.limit), 0, 1));
  }, 0) / budgets.length * 20 : 10;
  const emergencyScore = summary.expense ? clamp(totalBalance / (summary.expense * 3), 0, 1) * 15 : 15;
  const consistency = clamp(monthCount / 12, 0, 1) * 10;
  const score = Math.round(cashflow + savingsRate + budgetScore + emergencyScore + consistency);
  const label = score >= 80 ? 'Sangat sehat.' : score >= 60 ? 'Keuanganmu sehat.' : score >= 40 ? 'Mulai stabil.' : 'Perlu perhatian.';
  const opportunity = summary.income && surplus < summary.income * .2 ? 'Naikkan surplus menuju 20% pemasukan.' : budgets.some((budget) => monthTransactions().filter((item) => item.type === 'expense' && item.category === budget.category).reduce((sum, item) => sum + item.amount, 0) > budget.limit) ? 'Ada anggaran yang terlewati bulan ini.' : 'Pertahankan kebiasaan pencatatanmu.';
  $('#health-score').textContent = String(score);
  $('#health-score-orb').style.setProperty('--score', `${score}%`);
  $('#health-title').textContent = label;
  $('#health-summary').textContent = opportunity;
  $('#health-factors').innerHTML = [
    `Arus kas ${Math.round(cashflow)}/30`,
    `Menabung ${Math.round(savingsRate)}/25`,
    `Anggaran ${Math.round(budgetScore)}/20`,
    `Dana aman ${Math.round(emergencyScore)}/15`,
    `Konsistensi ${Math.round(consistency)}/10`,
  ].map((item) => `<span>${escapeHTML(item)}</span>`).join('');
}

function renderWeeklyChart() {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const value = state.transactions.filter((item) => item.date === iso && item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
    days.push({ iso, label: new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(date).slice(0, 3).toUpperCase(), value });
  }
  const max = Math.max(...days.map((day) => day.value), 1);
  const total = days.reduce((sum, day) => sum + day.value, 0);
  $('#weekly-total').textContent = shortMoney(total);
  $('#weekly-chart').innerHTML = days.map((day) => {
    const height = day.value ? Math.max(12, Math.round((day.value / max) * 150)) : 3;
    return `<div class="bar-column" title="${escapeHTML(day.label)}: ${money(day.value)}"><span class="bar-value money">${day.value ? shortMoney(day.value) : ''}</span><span class="bar" style="height:${height}px"></span><span class="bar-day">${day.label}</span></div>`;
  }).join('');
}

function renderCategoryBreakdown() {
  const expenses = monthTransactions().filter((item) => item.type === 'expense');
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const grouped = Object.entries(expenses.reduce((result, item) => {
    result[item.category] = (result[item.category] || 0) + item.amount;
    return result;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#category-breakdown').innerHTML = grouped.length
    ? grouped.map(([category, value]) => `<div class="category-row"><strong>${escapeHTML(category)}</strong><output class="money">${shortMoney(value)} · ${Math.round((value / total) * 100)}%</output><div class="category-track"><div class="category-fill" style="width:${Math.max(4, (value / total) * 100)}%"></div></div></div>`).join('')
    : emptyState('Belum ada pengeluaran', 'Kategori akan muncul setelah kamu mencatat pengeluaran pertama.');
}

function renderInsight(summary) {
  const monthExpenses = monthTransactions().filter((item) => item.type === 'expense');
  if (!monthExpenses.length) {
    $('#insight-title').textContent = 'Mulai dari satu transaksi.';
    $('#insight-copy').textContent = 'FinSpace akan merangkum pola pengeluaran setelah datamu cukup.';
    return;
  }
  const grouped = monthExpenses.reduce((result, item) => {
    result[item.category] = (result[item.category] || 0) + item.amount;
    return result;
  }, {});
  const [topCategory, topValue] = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
  $('#insight-title').textContent = `${topCategory} paling besar bulan ini.`;
  $('#insight-copy').textContent = `${money(topValue)} dari ${money(summary.expense)} pengeluaran bulan berjalan tercatat pada kategori ini.`;
}

function transactionMarkup(transaction, allowActions) {
  const wallet = state.wallets.find((item) => item.id === transaction.walletId);
  const destination = state.wallets.find((item) => item.id === transaction.destinationWalletId);
  const sign = transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : '↔';
  const label = transaction.note || transaction.category || 'Transfer dana';
  const meta = transaction.type === 'transfer' ? `${wallet?.name || 'Dompet'} ke ${destination?.name || 'Dompet'}` : `${transaction.category} · ${wallet?.name || 'Dompet'}`;
  return `<article class="transaction-item" data-type="${escapeHTML(transaction.type)}" data-id="${escapeHTML(transaction.id)}">
    <span class="transaction-icon" aria-hidden="true">${transaction.type === 'income' ? 'IN' : transaction.type === 'expense' ? 'OUT' : 'TR'}</span>
    <div class="transaction-copy"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(meta)}</small></div>
    <div class="transaction-amount"><output class="money">${sign}${money(transaction.amount)}</output><small>${dateLabel(transaction.date)}</small>${allowActions ? `<div class="transaction-actions"><button type="button" data-edit-transaction="${escapeHTML(transaction.id)}">Ubah</button><button type="button" data-delete-transaction="${escapeHTML(transaction.id)}">Hapus</button></div>` : ''}</div>
  </article>`;
}

function emptyState(title, copy, action = '') {
  return `<div class="empty-state"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(copy)}</p>${action}</div>`;
}

function renderTransactionList(container, transactions, allowActions) {
  if (!container) return;
  container.innerHTML = transactions.length ? transactions.map((item) => transactionMarkup(item, allowActions)).join('') : emptyState('Belum ada transaksi', 'Tekan Catat untuk menambahkan pemasukan atau pengeluaran pertama.');
}

function renderHistory() {
  const query = ($('#history-search')?.value || '').trim().toLowerCase();
  const filter = $('#history-filter')?.value || 'all';
  const transactions = state.transactions.filter((item) => {
    const wallet = state.wallets.find((candidate) => candidate.id === item.walletId)?.name || '';
    const haystack = `${item.note || ''} ${item.category || ''} ${wallet}`.toLowerCase();
    return (filter === 'all' || item.type === filter) && (!query || haystack.includes(query));
  });
  renderTransactionList($('#history-list'), transactions, true);
}

function renderWallets() {
  $('#wallet-grid').innerHTML = state.wallets.length ? state.wallets.map((wallet) => `<article class="wallet-card">
    <div class="wallet-card-top"><span class="wallet-type">${walletTypeLabel(wallet.type)}</span><div class="card-actions"><button type="button" data-edit-wallet="${escapeHTML(wallet.id)}">Ubah</button><button type="button" data-delete-wallet="${escapeHTML(wallet.id)}">Hapus</button></div></div>
    <h3>${escapeHTML(wallet.name)}</h3>
    <output class="money">${money(walletBalance(wallet.id))}</output>
    <small>Saldo awal ${money(wallet.openingBalance)}</small>
  </article>`).join('') : emptyState('Belum ada dompet', 'Tambahkan sumber dana sebelum mencatat transaksi.', '<button class="button button-primary" type="button" data-add-wallet>Tambah dompet</button>');
}

function walletTypeLabel(type) {
  return ({ bank: 'Bank', ewallet: 'E-wallet', cash: 'Tunai', savings: 'Tabungan' })[type] || 'Lainnya';
}

function renderBudgets() {
  const expenses = monthTransactions().filter((item) => item.type === 'expense');
  const activeBudgets = currentBudgets();
  $('#budget-grid').innerHTML = activeBudgets.length ? activeBudgets.map((budget) => {
    const used = expenses.filter((item) => item.category === budget.category).reduce((sum, item) => sum + item.amount, 0);
    const percent = budget.limit ? Math.round((used / budget.limit) * 100) : 0;
    const remaining = budget.limit - used;
    return `<article class="budget-card"><div class="budget-card-top"><span class="wallet-type">${monthKey()}</span><div class="card-actions"><button type="button" data-edit-budget="${escapeHTML(budget.id)}">Ubah</button><button type="button" data-delete-budget="${escapeHTML(budget.id)}">Hapus</button></div></div><h3>${escapeHTML(budget.category)}</h3><output class="money">${money(remaining)}</output><small>${remaining >= 0 ? 'tersisa' : 'melebihi batas'}</small><div class="budget-progress ${percent > 100 ? 'over' : ''}"><span style="width:${Math.min(100, Math.max(2, percent))}%"></span></div><div class="budget-meta"><span>${money(used)}</span><span>${percent}%</span></div></article>`;
  }).join('') : emptyState('Belum ada anggaran', 'Tetapkan batas bulanan untuk kategori yang ingin kamu kendalikan.', '<button class="button button-primary" type="button" data-add-budget>Atur anggaran</button>');
}

function goalMonthlyNeed(goal) {
  const remaining = Math.max(0, Number(goal.targetAmount) - Number(goal.currentAmount || 0));
  const today = new Date(`${todayISO()}T12:00:00`);
  const target = new Date(`${goal.targetDate}T12:00:00`);
  const months = Math.max(1, Math.ceil((target - today) / (1000 * 60 * 60 * 24 * 30.44)));
  return { remaining, months, monthly: Math.ceil(remaining / months) };
}

function renderGoals() {
  const container = $('#goal-grid');
  if (!state.goals.length) {
    container.innerHTML = emptyState('Belum ada goal', 'Mulai dari tujuan sederhana agar progresmu mudah terlihat.', '<button class="button button-primary" type="button" data-add-goal>Buat goal</button>');
    return;
  }
  container.innerHTML = state.goals.map((goal) => {
    const target = Number(goal.targetAmount) || 1;
    const current = Number(goal.currentAmount) || 0;
    const percent = clamp(Math.round(current / target * 100));
    const plan = goalMonthlyNeed(goal);
    const complete = current >= target;
    return `<article class="goal-card brutal-panel">
      <div class="wallet-card-top"><span class="wallet-type">${complete ? 'Tercapai' : `Target ${dateLabel(goal.targetDate)}`}</span><div class="card-actions"><button type="button" data-edit-goal="${escapeHTML(goal.id)}">Ubah</button><button type="button" data-delete-goal="${escapeHTML(goal.id)}">Hapus</button></div></div>
      <h3>${escapeHTML(goal.name)}</h3>
      <output class="money">${money(current)}</output><small>dari ${money(target)}</small>
      <div class="goal-track" aria-label="${percent}% tercapai"><span style="width:${Math.max(2, percent)}%"></span></div>
      <div class="goal-meta"><span>${percent}% tercapai</span><span>${complete ? 'Selesai' : `${money(plan.monthly)}/bulan`}</span></div>
      <button class="button button-secondary button-full" type="button" data-update-goal="${escapeHTML(goal.id)}">${complete ? 'Ubah progres' : 'Update progres'}</button>
    </article>`;
  }).join('');
}

function renderSettings() {
  $('#display-name').value = state.settings.name || '';
  $('#ai-enabled').checked = state.settings.aiEnabled !== false;
  $('#ai-tab').disabled = state.settings.aiEnabled === false;
  $('#theme-select').value = ['system', 'light', 'dark'].includes(state.settings.theme) ? state.settings.theme : 'system';
  renderAccountState();
}

function renderWalletOptions() {
  const options = state.wallets.map((wallet) => `<option value="${wallet.id}">${escapeHTML(wallet.name)}</option>`).join('');
  const currentWallet = $('#wallet-select').value;
  const currentDestination = $('#destination-wallet-select').value;
  $('#wallet-select').innerHTML = options;
  $('#destination-wallet-select').innerHTML = options;
  if (state.wallets.some((item) => item.id === currentWallet)) $('#wallet-select').value = currentWallet;
  if (state.wallets.some((item) => item.id === currentDestination)) $('#destination-wallet-select').value = currentDestination;
  renderCategoryOptions();
  $('#budget-category').innerHTML = CATEGORIES.expense.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
}

function renderCategoryOptions(selected) {
  const type = $('input[name="type"]:checked')?.value || 'expense';
  const categories = CATEGORIES[type] || [];
  $('#category-select').innerHTML = categories.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
  if (selected && categories.includes(selected)) $('#category-select').value = selected;
  const transfer = type === 'transfer';
  $('#destination-field').hidden = !transfer;
  $('#category-field').hidden = transfer;
}

function applyPrivacyMode() {
  const hide = Boolean(state.settings.hideMoney);
  $$('.money').forEach((element) => element.classList.toggle('masked', hide));
  $('#privacy-toggle').textContent = hide ? '◉' : '◎';
  $('#privacy-toggle').setAttribute('aria-label', hide ? 'Tampilkan nominal' : 'Sembunyikan nominal');
  $('#privacy-toggle').title = hide ? 'Tampilkan nominal' : 'Sembunyikan nominal';
}

function openCapture(transaction = null) {
  if (!state.wallets.length) {
    showToast('Tambahkan dompet terlebih dahulu.', 'error');
    openWalletDialog();
    return;
  }
  resetTransactionForm();
  if (transaction) fillTransactionForm(transaction);
  $('#capture-dialog').showModal();
  switchCaptureMode('manual');
  window.setTimeout(() => $('#amount').focus(), 180);
}

function closeCapture() {
  $('#capture-dialog').close();
}

function resetTransactionForm() {
  $('#transaction-form').reset();
  $('#transaction-id').value = '';
  $('#transaction-date').value = todayISO();
  $('#amount').value = '';
  $('#transaction-message').textContent = '';
  $('#amount-error').textContent = '';
  state.aiDraft = null;
  state.receiptImage = null;
  $('#ai-preview').hidden = true;
  $('#ai-input').value = '';
  $('#receipt-file').value = '';
  $('#receipt-preview-image').hidden = true;
  $('#receipt-preview-image').removeAttribute('src');
  $('#receipt-message').textContent = '';
  $('#parse-receipt').disabled = true;
  renderCategoryOptions();
  $('#save-transaction').textContent = 'Simpan transaksi';
}

function fillTransactionForm(transaction) {
  $('#transaction-id').value = transaction.id;
  $(`input[name="type"][value="${transaction.type}"]`).checked = true;
  renderCategoryOptions(transaction.category);
  $('#amount').value = new Intl.NumberFormat('id-ID').format(transaction.amount);
  $('#wallet-select').value = transaction.walletId;
  $('#destination-wallet-select').value = transaction.destinationWalletId || '';
  $('#transaction-date').value = transaction.date;
  $('#transaction-note').value = transaction.note || '';
  $('#save-transaction').textContent = 'Simpan perubahan';
}

function switchCaptureMode(mode) {
  const ai = mode === 'ai';
  const receipt = mode === 'receipt';
  $('#manual-tab').classList.toggle('active', !ai && !receipt);
  $('#manual-tab').setAttribute('aria-selected', String(!ai && !receipt));
  $('#ai-tab').classList.toggle('active', ai);
  $('#ai-tab').setAttribute('aria-selected', String(ai));
  $('#receipt-tab').classList.toggle('active', receipt);
  $('#receipt-tab').setAttribute('aria-selected', String(receipt));
  $('#manual-panel').hidden = ai || receipt;
  $('#ai-panel').hidden = !ai;
  $('#receipt-panel').hidden = !receipt;
  if (ai) window.setTimeout(() => $('#ai-input').focus(), 80);
}

async function saveTransactionFromForm(event) {
  event.preventDefault();
  const id = $('#transaction-id').value || uid();
  const type = $('input[name="type"]:checked').value;
  const amount = amountValue($('#amount').value);
  const walletId = $('#wallet-select').value;
  const destinationWalletId = type === 'transfer' ? $('#destination-wallet-select').value : null;
  const category = type === 'transfer' ? null : $('#category-select').value;
  const date = $('#transaction-date').value;
  const note = $('#transaction-note').value.trim();
  const existing = state.transactions.find((item) => item.id === id);

  $('#amount-error').textContent = '';
  $('#transaction-message').textContent = '';
  if (!amount || amount > 999_999_999_999) {
    $('#amount-error').textContent = 'Masukkan nominal antara Rp1 dan Rp999.999.999.999.';
    $('#amount').focus();
    return;
  }
  if (!walletId || !date || (type !== 'transfer' && !category)) {
    $('#transaction-message').textContent = 'Lengkapi dompet, kategori, dan tanggal.';
    return;
  }
  if (type === 'transfer' && (!destinationWalletId || destinationWalletId === walletId)) {
    $('#transaction-message').textContent = 'Pilih dompet tujuan yang berbeda.';
    return;
  }

  const record = { id, type, amount, walletId, destinationWalletId, category, date, note, source: existing?.source || 'manual', createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  $('#save-transaction').disabled = true;
  try {
    await dbPut('transactions', record);
    const index = state.transactions.findIndex((item) => item.id === id);
    if (index >= 0) state.transactions[index] = record; else state.transactions.push(record);
    state.transactions.sort(sortTransactions);
    closeCapture();
    renderAll();
    scheduleCloudSync();
    showToast(existing ? 'Perubahan transaksi tersimpan.' : 'Transaksi tersimpan di perangkat.');
  } catch (error) {
    $('#transaction-message').textContent = 'Penyimpanan gagal. Data pada formulir tetap aman, silakan coba lagi.';
  } finally {
    $('#save-transaction').disabled = false;
  }
}

async function deleteTransaction(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction) return;
  const accepted = await requestConfirmation({
    title: 'Hapus transaksi?',
    message: `${transaction.note || transaction.category || 'Transfer'} senilai ${money(transaction.amount)} akan dihapus dan saldo dihitung ulang.`,
    confirmLabel: 'Hapus transaksi',
  });
  if (!accepted) return;
  await dbDelete('transactions', id);
  state.transactions = state.transactions.filter((item) => item.id !== id);
  renderAll();
  scheduleCloudSync();
  showToast('Transaksi dihapus.');
}

function openWalletDialog(wallet = null) {
  $('#wallet-form').reset();
  $('#wallet-id').value = wallet?.id || '';
  $('#wallet-name').value = wallet?.name || '';
  $('#wallet-type').value = wallet?.type || 'bank';
  $('#wallet-opening-balance').value = wallet?.openingBalance ? new Intl.NumberFormat('id-ID').format(wallet.openingBalance) : '';
  $('#wallet-message').textContent = '';
  $('#wallet-dialog-label').textContent = wallet ? 'EDIT DOMPET' : 'DOMPET BARU';
  $('#wallet-dialog-title').textContent = wallet ? 'Ubah sumber dana' : 'Tambah sumber dana';
  $('#save-wallet').textContent = wallet ? 'Simpan perubahan' : 'Simpan dompet';
  $('#wallet-dialog').showModal();
  window.setTimeout(() => $('#wallet-name').focus(), 50);
}

async function saveWallet(event) {
  event.preventDefault();
  const id = $('#wallet-id').value;
  const name = $('#wallet-name').value.trim();
  const openingBalance = amountValue($('#wallet-opening-balance').value);
  const type = $('#wallet-type').value;
  const existing = state.wallets.find((item) => item.id === id);
  $('#wallet-message').textContent = '';
  if (!name) {
    $('#wallet-message').textContent = 'Nama dompet wajib diisi.';
    $('#wallet-name').focus();
    return;
  }
  if (state.wallets.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    $('#wallet-message').textContent = 'Nama dompet sudah digunakan.';
    $('#wallet-name').focus();
    return;
  }
  if (openingBalance > 999_999_999_999) {
    $('#wallet-message').textContent = 'Saldo awal maksimal Rp999.999.999.999.';
    $('#wallet-opening-balance').focus();
    return;
  }
  const wallet = { id: id || uid(), name, type, openingBalance, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  $('#save-wallet').disabled = true;
  try {
    await dbPut('wallets', wallet);
    const index = state.wallets.findIndex((item) => item.id === wallet.id);
    if (index >= 0) state.wallets[index] = wallet; else state.wallets.push(wallet);
    $('#wallet-dialog').close();
    renderAll();
    scheduleCloudSync();
    showToast(existing ? 'Perubahan dompet disimpan.' : 'Dompet baru ditambahkan.');
  } catch (error) {
    $('#wallet-message').textContent = 'Dompet belum tersimpan. Coba lagi.';
  } finally {
    $('#save-wallet').disabled = false;
  }
}

async function deleteWallet(id) {
  const wallet = state.wallets.find((item) => item.id === id);
  if (!wallet) return;
  const isUsed = state.transactions.some((item) => item.walletId === id || item.destinationWalletId === id);
  if (isUsed) {
    showToast('Dompet yang memiliki transaksi tidak dapat dihapus.', 'error');
    return;
  }
  if (state.wallets.length === 1) {
    showToast('Simpan minimal satu dompet untuk mencatat transaksi.', 'error');
    return;
  }
  if (!await requestConfirmation({ title: 'Hapus dompet?', message: `${wallet.name} akan dihapus. Tindakan ini tidak dapat dibatalkan.`, confirmLabel: 'Hapus dompet' })) return;
  await dbDelete('wallets', id);
  state.wallets = state.wallets.filter((item) => item.id !== id);
  renderAll();
  scheduleCloudSync();
  showToast('Dompet dihapus.');
}

function openBudgetDialog(budget = null) {
  $('#budget-form').reset();
  $('#budget-id').value = budget?.id || '';
  $('#budget-category').disabled = Boolean(budget);
  if (budget) $('#budget-category').value = budget.category;
  $('#budget-limit').value = budget?.limit ? new Intl.NumberFormat('id-ID').format(budget.limit) : '';
  $('#budget-message').textContent = '';
  $('#budget-dialog-label').textContent = budget ? 'EDIT BATAS' : 'BATAS BULANAN';
  $('#budget-dialog-title').textContent = budget ? 'Ubah anggaran' : 'Atur anggaran';
  $('#save-budget').textContent = budget ? 'Simpan perubahan' : 'Simpan anggaran';
  $('#budget-dialog').showModal();
  window.setTimeout(() => (budget ? $('#budget-limit') : $('#budget-category')).focus(), 50);
}

async function saveBudget(event) {
  event.preventDefault();
  const id = $('#budget-id').value;
  const category = $('#budget-category').value;
  const limit = amountValue($('#budget-limit').value);
  $('#budget-message').textContent = '';
  if (!category || !limit) {
    $('#budget-message').textContent = 'Pilih kategori dan masukkan batas minimal Rp1.';
    $('#budget-limit').focus();
    return;
  }
  if (limit > 999_999_999_999) {
    $('#budget-message').textContent = 'Batas maksimal Rp999.999.999.999.';
    $('#budget-limit').focus();
    return;
  }
  const old = state.budgets.find((item) => item.id === id) || state.budgets.find((item) => item.category === category && item.month === monthKey());
  const budget = { id: old?.id || uid(), category, limit, month: monthKey(), createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  $('#save-budget').disabled = true;
  try {
    await dbPut('budgets', budget);
    state.budgets = state.budgets.filter((item) => item.id !== budget.id);
    state.budgets.push(budget);
    $('#budget-dialog').close();
    renderAll();
    scheduleCloudSync();
    showToast(old ? 'Perubahan anggaran disimpan.' : 'Anggaran disimpan.');
  } catch (error) {
    $('#budget-message').textContent = 'Anggaran belum tersimpan. Coba lagi.';
  } finally {
    $('#save-budget').disabled = false;
  }
}

async function deleteBudget(id) {
  const budget = state.budgets.find((item) => item.id === id);
  if (!budget || !await requestConfirmation({ title: 'Hapus anggaran?', message: `Batas untuk ${budget.category} bulan ini akan dihapus.`, confirmLabel: 'Hapus anggaran' })) return;
  await dbDelete('budgets', id);
  state.budgets = state.budgets.filter((item) => item.id !== id);
  renderAll();
  scheduleCloudSync();
  showToast('Anggaran dihapus.');
}

function openGoalDialog(goal = null) {
  $('#goal-form').reset();
  $('#goal-id').value = goal?.id || '';
  $('#goal-name').value = goal?.name || '';
  $('#goal-target').value = goal?.targetAmount ? new Intl.NumberFormat('id-ID').format(goal.targetAmount) : '';
  $('#goal-current').value = goal?.currentAmount ? new Intl.NumberFormat('id-ID').format(goal.currentAmount) : '';
  $('#goal-date').value = goal?.targetDate || todayISO();
  $('#goal-message').textContent = '';
  $('#goal-dialog-label').textContent = goal ? 'EDIT GOAL' : 'GOAL BARU';
  $('#goal-dialog-title').textContent = goal ? 'Ubah tujuan' : 'Buat tujuan';
  $('#save-goal').textContent = goal ? 'Simpan perubahan' : 'Simpan goal';
  $('#goal-dialog').showModal();
  window.setTimeout(() => $('#goal-name').focus(), 50);
}

async function saveGoal(event) {
  event.preventDefault();
  const id = $('#goal-id').value;
  const name = $('#goal-name').value.trim();
  const targetAmount = amountValue($('#goal-target').value);
  const currentAmount = amountValue($('#goal-current').value);
  const targetDate = $('#goal-date').value;
  const old = state.goals.find((item) => item.id === id);
  $('#goal-message').textContent = '';
  if (!name || !targetAmount || !targetDate) {
    $('#goal-message').textContent = 'Nama, target nominal, dan tanggal wajib diisi.';
    return;
  }
  if (currentAmount > targetAmount) {
    $('#goal-message').textContent = 'Dana terkumpul tidak boleh melebihi target.';
    return;
  }
  const goal = { id: id || uid(), name, targetAmount, currentAmount, targetDate, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  $('#save-goal').disabled = true;
  try {
    await dbPut('goals', goal);
    state.goals = state.goals.filter((item) => item.id !== goal.id);
    state.goals.push(goal);
    state.goals.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    $('#goal-dialog').close();
    renderAll();
    scheduleCloudSync();
    showToast(old ? 'Goal diperbarui.' : 'Goal baru dibuat.');
  } catch (error) {
    $('#goal-message').textContent = 'Goal belum tersimpan. Coba lagi.';
  } finally {
    $('#save-goal').disabled = false;
  }
}

function openGoalProgressDialog(goal) {
  if (!goal) return;
  $('#goal-progress-form').reset();
  $('#goal-progress-id').value = goal.id;
  $('#goal-progress-name').textContent = `${goal.name} · ${money(goal.currentAmount)} dari ${money(goal.targetAmount)}`;
  $('#goal-progress-message').textContent = '';
  $('#goal-progress-dialog').showModal();
  window.setTimeout(() => $('#goal-progress-amount').focus(), 50);
}

async function saveGoalProgress(event) {
  event.preventDefault();
  const goal = state.goals.find((item) => item.id === $('#goal-progress-id').value);
  const amount = amountValue($('#goal-progress-amount').value);
  const direction = $('#goal-progress-type').value;
  if (!goal || !amount) {
    $('#goal-progress-message').textContent = 'Masukkan nominal perubahan.';
    return;
  }
  const next = direction === 'subtract' ? goal.currentAmount - amount : goal.currentAmount + amount;
  if (next < 0 || next > goal.targetAmount) {
    $('#goal-progress-message').textContent = next < 0 ? 'Dana goal tidak boleh kurang dari Rp0.' : 'Dana goal tidak boleh melebihi target.';
    return;
  }
  const updated = { ...goal, currentAmount: next, updatedAt: new Date().toISOString() };
  await dbPut('goals', updated);
  state.goals = state.goals.map((item) => item.id === updated.id ? updated : item);
  $('#goal-progress-dialog').close();
  renderAll();
  scheduleCloudSync();
  showToast('Progres goal diperbarui.');
}

async function deleteGoal(id) {
  const goal = state.goals.find((item) => item.id === id);
  if (!goal || !await requestConfirmation({ title: 'Hapus goal?', message: `${goal.name} akan dihapus.`, confirmLabel: 'Hapus goal' })) return;
  await dbDelete('goals', id);
  state.goals = state.goals.filter((item) => item.id !== id);
  renderAll();
  scheduleCloudSync();
  showToast('Goal dihapus.');
}

function localParse(text) {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const amountMatch = lower.match(/(?:rp\s*)?(\d+(?:[.,]\d+)*)\s*(jt|juta|rb|ribu|k)?/i);
  let parsedAmount = 0;
  if (amountMatch) {
    const unit = amountMatch[2]?.toLowerCase();
    const numeric = amountMatch[1];
    const raw = unit ? Number(numeric.replace(',', '.')) : Number(numeric.replace(/[^0-9]/g, ''));
    parsedAmount = Math.round(raw * (unit === 'jt' || unit === 'juta' ? 1_000_000 : unit === 'rb' || unit === 'ribu' || unit === 'k' ? 1_000 : 1));
  }
  const transfer = /pindah|transfer|kirim/.test(lower);
  const income = /gaji|bonus|pendapatan|masuk|diterima|refund/.test(lower) && !transfer;
  const type = transfer ? 'transfer' : income ? 'income' : 'expense';
  const category = type === 'income'
    ? (/gaji/.test(lower) ? 'Gaji' : /bonus/.test(lower) ? 'Bonus' : /refund/.test(lower) ? 'Pengembalian dana' : 'Pendapatan lain')
    : /kopi|makan|minum|resto|warung/.test(lower) ? 'Makan & Minum'
      : /bensin|ojek|grab|gojek|parkir|transport/.test(lower) ? 'Transportasi'
        : /listrik|internet|pulsa|tagihan/.test(lower) ? 'Tagihan'
          : /obat|dokter|klinik/.test(lower) ? 'Kesehatan'
            : /film|spotify|game|hiburan/.test(lower) ? 'Hiburan'
              : /beli|belanja/.test(lower) ? 'Belanja' : 'Lainnya';
  const mentioned = state.wallets.filter((wallet) => lower.includes(wallet.name.toLowerCase()));
  const walletId = mentioned[0]?.id || state.wallets[0]?.id;
  const destinationWalletId = transfer ? mentioned[1]?.id || state.wallets.find((wallet) => wallet.id !== walletId)?.id : null;
  const yesterday = /kemarin/.test(lower);
  const date = new Date();
  if (yesterday) date.setDate(date.getDate() - 1);
  const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const note = clean.replace(amountMatch?.[0] || '', '').replace(/\b(tadi|kemarin|pakai|pake|dengan|rp|di|ke)\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 80) || (type === 'transfer' ? 'Transfer dana' : category);
  return { status: parsedAmount ? 'ready_for_review' : 'needs_clarification', draft: { type, amount: parsedAmount, walletId, destinationWalletId, category: type === 'transfer' ? null : category, date: isoDate, note }, source: 'PARSER LOKAL' };
}

async function parseWithAI() {
  const text = $('#ai-input').value.trim();
  $('#ai-message').textContent = '';
  if (!text) {
    $('#ai-message').textContent = 'Tulis transaksi yang ingin dicatat.';
    return;
  }
  const button = $('#parse-ai');
  button.disabled = true;
  button.textContent = 'Membaca transaksi...';
  let result;
  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, today: todayISO(), wallets: state.wallets.map(({ id, name }) => ({ id, name })), categories: CATEGORIES }),
    });
    if (!response.ok) throw new Error('Gemini tidak tersedia');
    result = await response.json();
    result.source = 'GEMINI';
  } catch (error) {
    result = localParse(text);
    result.fallback = true;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Ubah jadi draf <span aria-hidden="true">↗</span>';
  }
  const normalized = normalizeAIDraft(result);
  if (!normalized.draft.amount) {
    $('#ai-preview').hidden = true;
    $('#ai-message').textContent = 'Nominal belum terbaca. Tambahkan angka, misalnya 20rb atau 20.000.';
    return;
  }
  state.aiDraft = normalized.draft;
  renderAIPreview(normalized);
}

async function selectReceipt(file) {
  $('#receipt-message').textContent = '';
  state.receiptImage = null;
  $('#parse-receipt').disabled = true;
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12_000_000) {
    $('#receipt-message').textContent = 'Gunakan JPG, PNG, atau WebP dengan ukuran maksimal 12 MB.';
    return;
  }
  $('#receipt-message').textContent = 'Menyiapkan foto struk...';
  const prepared = await compressReceipt(file);
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
    reader.readAsDataURL(prepared);
  });
  state.receiptImage = { dataUrl, mimeType: 'image/jpeg', name: file.name || `struk-${todayISO()}` };
  $('#receipt-preview-image').src = dataUrl;
  $('#receipt-preview-image').hidden = false;
  $('#parse-receipt').disabled = false;
  $('#receipt-message').textContent = 'Foto siap dianalisis.';
}

function compressReceipt(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 960 / longestSide);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const encode = (quality) => new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
      let blob = await encode(0.7);
      if (blob && blob.size > 450_000) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.72));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.72));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await encode(0.62);
      }
      if (blob && blob.size > 450_000) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.72));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.72));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await encode(0.55);
      }
      if (blob) resolve(blob); else reject(new Error('Foto struk tidak dapat diproses.'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Foto struk tidak dapat dibuka.')); };
    image.src = objectUrl;
  });
}

async function parseReceipt() {
  if (!state.receiptImage) return;
  const button = $('#parse-receipt');
  $('#receipt-message').textContent = '';
  button.disabled = true;
  button.textContent = 'Membaca struk...';
  try {
    const response = await fetch('/api/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.receiptImage.dataUrl.split(',')[1],
        mimeType: state.receiptImage.mimeType,
        today: todayISO(),
        wallets: state.wallets.map(({ id, name }) => ({ id, name })),
        categories: CATEGORIES,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const explanation = response.status === 413 ? 'Foto masih terlalu besar. Pilih foto lain atau potong area struk terlebih dahulu.' : result.error;
      throw new Error(explanation || 'Struk tidak dapat dianalisis.');
    }
    const normalized = normalizeAIDraft({ ...result, source: 'FOTO STRUK' });
    if (!normalized.draft.amount) throw new Error('Nominal pada struk belum terbaca. Isi manual untuk melanjutkan.');
    state.aiDraft = normalized.draft;
    switchCaptureMode('ai');
    renderAIPreview({ ...normalized, source: 'FOTO STRUK' });
    $('#ai-message').textContent = 'Draf dibuat dari foto struk. Periksa sebelum menyimpan.';
  } catch (error) {
    $('#receipt-message').textContent = error.message === 'Failed to fetch' || error.message === 'Load failed'
      ? 'Koneksi ke server analisis terputus. Coba lagi dengan jaringan stabil.'
      : (error.message || 'Struk tidak dapat dianalisis.');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Analisis struk <span aria-hidden="true">↗</span>';
  }
}

function normalizeAIDraft(result) {
  const draft = result.draft || result;
  const type = ['income', 'expense', 'transfer'].includes(draft.type) ? draft.type : 'expense';
  const validWallet = state.wallets.some((item) => item.id === draft.walletId) ? draft.walletId : state.wallets[0]?.id;
  const validDestination = state.wallets.some((item) => item.id === draft.destinationWalletId) && draft.destinationWalletId !== validWallet ? draft.destinationWalletId : state.wallets.find((item) => item.id !== validWallet)?.id || null;
  const categoryList = CATEGORIES[type] || [];
  const category = type === 'transfer' ? null : categoryList.includes(draft.category) ? draft.category : categoryList.at(-1);
  return { ...result, draft: { type, amount: amountValue(draft.amount ?? draft.amount_idr), walletId: validWallet, destinationWalletId: type === 'transfer' ? validDestination : null, category, date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date || draft.transaction_date || '') ? (draft.date || draft.transaction_date) : todayISO(), note: String(draft.note || '').slice(0, 500) } };
}

function renderAIPreview(result) {
  const draft = result.draft;
  const wallet = state.wallets.find((item) => item.id === draft.walletId)?.name || 'Dompet pertama';
  const destination = state.wallets.find((item) => item.id === draft.destinationWalletId)?.name;
  $('#ai-source').textContent = result.fallback ? 'PARSER LOKAL' : (result.source || 'GEMINI');
  $('#ai-preview-data').innerHTML = [
    ['Jenis', draft.type === 'expense' ? 'Pengeluaran' : draft.type === 'income' ? 'Pemasukan' : 'Transfer'],
    ['Nominal', money(draft.amount)],
    ['Dompet', draft.type === 'transfer' ? `${wallet} ke ${destination || 'Pilih tujuan'}` : wallet],
    ['Kategori', draft.category || 'Transfer'],
    ['Tanggal', dateLabel(draft.date)],
    ['Catatan', draft.note || '-'],
  ].map(([term, description]) => `<div><dt>${term}</dt><dd>${escapeHTML(description)}</dd></div>`).join('');
  $('#ai-preview').hidden = false;
  $('#ai-message').textContent = result.fallback ? 'Gemini belum dikonfigurasi. Draf dibuat oleh parser lokal dan tetap perlu diperiksa.' : '';
}

function putAIDraftIntoForm() {
  if (!state.aiDraft) return;
  const draft = state.aiDraft;
  $(`input[name="type"][value="${draft.type}"]`).checked = true;
  renderCategoryOptions(draft.category);
  $('#amount').value = new Intl.NumberFormat('id-ID').format(draft.amount);
  $('#wallet-select').value = draft.walletId;
  if (draft.destinationWalletId) $('#destination-wallet-select').value = draft.destinationWalletId;
  $('#transaction-date').value = draft.date;
  $('#transaction-note').value = draft.note || '';
  switchCaptureMode('manual');
}

async function confirmAIDraft() {
  if (!state.aiDraft) return;
  const draft = state.aiDraft;
  if (!draft.amount || !draft.walletId || (draft.type === 'transfer' && (!draft.destinationWalletId || draft.destinationWalletId === draft.walletId))) {
    putAIDraftIntoForm();
    $('#transaction-message').textContent = 'Periksa dompet asal, dompet tujuan, dan nominal sebelum menyimpan.';
    return;
  }
  $('#confirm-ai-draft').disabled = true;
  try {
    const receiptPath = await saveReceiptToCloud();
    const record = { id: uid(), ...draft, source: state.receiptImage ? 'receipt' : 'ai', receiptPath, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await dbPut('transactions', record);
    state.transactions.push(record);
    state.transactions.sort(sortTransactions);
    closeCapture();
    renderAll();
    scheduleCloudSync();
    showToast('Draf AI dikonfirmasi dan disimpan.');
  } catch (error) {
    $('#ai-message').textContent = 'Draf belum tersimpan. Coba lagi atau edit detail secara manual.';
  } finally {
    $('#confirm-ai-draft').disabled = false;
  }
}

function downloadBlob(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  const backup = { schemaVersion: 2, exportedAt: new Date().toISOString(), app: 'FinSpace', wallets: state.wallets, transactions: state.transactions, budgets: state.budgets, goals: state.goals, settings: state.settings };
  downloadBlob(`finspace-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  showToast('Backup JSON diunduh.');
}

function safeCSV(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCSV() {
  const header = ['tanggal', 'jenis', 'nominal_idr', 'dompet', 'dompet_tujuan', 'kategori', 'catatan', 'sumber'];
  const rows = state.transactions.map((item) => [item.date, item.type, item.amount, state.wallets.find((wallet) => wallet.id === item.walletId)?.name || '', state.wallets.find((wallet) => wallet.id === item.destinationWalletId)?.name || '', item.category || '', item.note || '', item.source || 'manual']);
  downloadBlob(`finspace-transaksi-${todayISO()}.csv`, '\uFEFF' + [header, ...rows].map((row) => row.map(safeCSV).join(',')).join('\n'), 'text/csv;charset=utf-8');
  showToast('CSV transaksi diunduh.');
}

async function importJSON(file) {
  try {
    if (file.size > 5_000_000) throw new Error('Ukuran backup maksimal 5 MB.');
    const backup = validateBackup(JSON.parse(await file.text()));
    const summary = `${backup.wallets.length} dompet, ${backup.transactions.length} transaksi, ${backup.budgets.length} anggaran, dan ${(backup.goals || []).length} goal`;
    if (!await requestConfirmation({ title: 'Pulihkan backup?', message: `${summary} akan dipulihkan dan mengganti data saat ini.`, confirmLabel: 'Pulihkan data', danger: false })) return;
    await dbReplaceAll(backup);
    await loadState();
    renderAll();
    scheduleCloudSync();
    showToast('Backup berhasil dipulihkan.');
  } catch (error) {
    showToast(error.message || 'Backup tidak dapat dipulihkan.', 'error');
  } finally {
    $('#import-json').value = '';
  }
}

function validateBackup(backup) {
  if (!backup || ![1, 2].includes(backup.schemaVersion) || !Array.isArray(backup.wallets) || !Array.isArray(backup.transactions) || !Array.isArray(backup.budgets)) throw new Error('Format backup tidak dikenali.');
  if (!backup.wallets.length || backup.wallets.length > 100 || backup.transactions.length > 50_000 || backup.budgets.length > 5_000) throw new Error('Jumlah data pada backup tidak valid.');
  const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value);
  const validAmount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 999_999_999_999;
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const timestamp = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
  const walletIds = new Set();
  for (const wallet of backup.wallets) {
    if (!validId(wallet.id) || walletIds.has(wallet.id) || typeof wallet.name !== 'string' || !wallet.name.trim() || wallet.name.length > 30 || !['bank', 'ewallet', 'cash', 'savings'].includes(wallet.type) || !validAmount(wallet.openingBalance)) throw new Error('Ada data dompet yang tidak valid.');
    walletIds.add(wallet.id);
  }
  const transactionIds = new Set();
  for (const item of backup.transactions) {
    const typeValid = ['expense', 'income', 'transfer'].includes(item.type);
    const categoryValid = item.type === 'transfer' ? item.category == null : CATEGORIES[item.type]?.includes(item.category);
    const destinationValid = item.type !== 'transfer' || (walletIds.has(item.destinationWalletId) && item.destinationWalletId !== item.walletId);
    if (!validId(item.id) || transactionIds.has(item.id) || !typeValid || !validAmount(item.amount) || Number(item.amount) < 1 || !walletIds.has(item.walletId) || !destinationValid || !categoryValid || !validDate(item.date) || String(item.note || '').length > 500) throw new Error('Ada data transaksi yang tidak valid.');
    transactionIds.add(item.id);
  }
  const budgetIds = new Set();
  for (const budget of backup.budgets) {
    if (!validId(budget.id) || budgetIds.has(budget.id) || !CATEGORIES.expense.includes(budget.category) || !validAmount(budget.limit) || Number(budget.limit) < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(budget.month || '')) throw new Error('Ada data anggaran yang tidak valid.');
    budgetIds.add(budget.id);
  }
  const goals = Array.isArray(backup.goals) ? backup.goals : [];
  if (goals.length > 500) throw new Error('Jumlah goal pada backup tidak valid.');
  const goalIds = new Set();
  for (const goal of goals) {
    if (!validId(goal.id) || goalIds.has(goal.id) || typeof goal.name !== 'string' || !goal.name.trim() || goal.name.length > 60 || !validAmount(goal.targetAmount) || Number(goal.targetAmount) < 1 || !validAmount(goal.currentAmount) || Number(goal.currentAmount) > Number(goal.targetAmount) || !validDate(goal.targetDate)) throw new Error('Ada data goal yang tidak valid.');
    goalIds.add(goal.id);
  }
  const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {};
  backup.settings = {
    id: 'profile',
    name: typeof settings.name === 'string' ? settings.name.slice(0, 40) : '',
    aiEnabled: settings.aiEnabled !== false,
    hideMoney: Boolean(settings.hideMoney),
    theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system',
  };
  backup.wallets = backup.wallets.map((wallet) => ({ ...wallet, name: wallet.name.trim(), openingBalance: Number(wallet.openingBalance), createdAt: timestamp(wallet.createdAt), updatedAt: timestamp(wallet.updatedAt || wallet.createdAt) }));
  backup.transactions = backup.transactions.map((item) => ({ ...item, amount: Number(item.amount), note: String(item.note || ''), destinationWalletId: item.type === 'transfer' ? item.destinationWalletId : null, category: item.type === 'transfer' ? null : item.category, createdAt: timestamp(item.createdAt), updatedAt: timestamp(item.updatedAt || item.createdAt) }));
  backup.budgets = backup.budgets.map((budget) => ({ ...budget, limit: Number(budget.limit), createdAt: timestamp(budget.createdAt), updatedAt: timestamp(budget.updatedAt || budget.createdAt) }));
  backup.goals = goals.map((goal) => ({ ...goal, name: goal.name.trim(), targetAmount: Number(goal.targetAmount), currentAmount: Number(goal.currentAmount), createdAt: timestamp(goal.createdAt), updatedAt: timestamp(goal.updatedAt || goal.createdAt) }));
  return backup;
}

function snapshotData() {
  return {
    schemaVersion: 2,
    wallets: state.wallets,
    transactions: state.transactions,
    budgets: state.budgets,
    goals: state.goals,
    settings: state.settings,
    updatedAt: new Date().toISOString(),
  };
}

function meaningfulLocalData() {
  return state.transactions.length > 0 || state.budgets.length > 0 || state.goals.length > 0 || state.wallets.some((wallet) => !['Tunai', 'Rekening utama'].includes(wallet.name) || Number(wallet.openingBalance) !== 0);
}

function mergeRecords(local = [], remote = []) {
  const records = new Map();
  for (const item of [...remote, ...local]) {
    const old = records.get(item.id);
    const oldDate = Date.parse(old?.updatedAt || old?.createdAt || 0) || 0;
    const newDate = Date.parse(item.updatedAt || item.createdAt || 0) || 0;
    if (!old || newDate >= oldDate) records.set(item.id, item);
  }
  return [...records.values()];
}

async function applyCloudSnapshot(data, { merge = true } = {}) {
  if (!data || !Array.isArray(data.wallets) || !Array.isArray(data.transactions)) return;
  const remote = {
    wallets: data.wallets || [],
    transactions: data.transactions || [],
    budgets: data.budgets || [],
    goals: data.goals || [],
    settings: { ...state.settings, ...(data.settings || {}), id: 'profile' },
  };
  const useRemote = !merge || state.freshInstall || !meaningfulLocalData();
  const next = useRemote ? remote : {
    wallets: mergeRecords(state.wallets, remote.wallets),
    transactions: mergeRecords(state.transactions, remote.transactions),
    budgets: mergeRecords(state.budgets, remote.budgets),
    goals: mergeRecords(state.goals, remote.goals),
    settings: remote.settings,
  };
  if (!next.wallets.length) return;
  await dbReplaceAll(next);
  await loadState();
  renderAll();
}

function setSyncStatus(message, type = '') {
  const status = $('#account-state');
  if (!status) return;
  status.textContent = message;
  status.className = `account-state ${type}`;
}

function renderAccountState() {
  const ready = state.sync.available;
  const user = state.sync.user;
  $('#connect-account').hidden = Boolean(user);
  $('#sync-now').hidden = !user;
  $('#sign-out').hidden = !user;
  if (user) {
    setSyncStatus(`Tersambung: ${user.email}`, 'connected');
    $('#sync-description').textContent = 'Data akan disinkronkan ke akun ini saat online dan tersedia di perangkat lain yang memakai email sama.';
  } else if (ready) {
    setSyncStatus('Belum terhubung', '');
    $('#sync-description').textContent = 'Masuk dengan email yang sama di laptop dan HP untuk menyinkronkan data secara aman.';
  } else {
    setSyncStatus('Mode lokal · sinkronisasi belum dikonfigurasi', '');
    $('#sync-description').textContent = 'Tambahkan konfigurasi Supabase di Vercel untuk mengaktifkan sinkronisasi antar perangkat.';
  }
}

async function initCloudSync() {
  try {
    const response = await fetch('/api/supabase-config');
    if (!response.ok) return;
    const config = await response.json();
    if (!config.url || !config.anonKey) return;
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const client = createClient(config.url, config.anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    state.sync.client = client;
    state.sync.available = true;
    const { data: { user } } = await client.auth.getUser();
    state.sync.user = user || null;
    client.auth.onAuthStateChange(async (_event, session) => {
      state.sync.user = session?.user || null;
      if (state.sync.user) {
        await syncCloud({ initial: true });
        subscribeToCloud();
      } else {
        unsubscribeFromCloud();
      }
      renderAll();
    });
    if (user) {
      await syncCloud({ initial: true });
      subscribeToCloud();
    }
  } catch (error) {
    console.info('Sinkronisasi cloud belum aktif:', error.message);
  }
}

function unsubscribeFromCloud() {
  if (state.sync.subscription && state.sync.client) state.sync.client.removeChannel(state.sync.subscription);
  state.sync.subscription = null;
  state.sync.lastUploadedAt = null;
}

function subscribeToCloud() {
  const { client, user } = state.sync;
  if (!client || !user || state.sync.subscription) return;
  state.sync.subscription = client
    .channel(`finspace-snapshot-${user.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'finspace_snapshots', filter: `user_id=eq.${user.id}`,
    }, async (payload) => {
      const data = payload.new?.data;
      if (!data || data.updatedAt === state.sync.lastUploadedAt || state.sync.syncing) return;
      state.sync.syncing = true;
      try {
        await applyCloudSnapshot(data, { merge: true });
        setSyncStatus('Pembaruan dari perangkat lain diterapkan', 'connected');
      } catch (error) {
        console.info('Pembaruan realtime gagal:', error.message);
      } finally {
        state.sync.syncing = false;
      }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.info('Realtime Supabase belum tersedia:', status);
    });
}

async function syncCloud({ initial = false } = {}) {
  const { client, user } = state.sync;
  if (!client || !user || state.sync.syncing || !navigator.onLine) return;
  state.sync.syncing = true;
  try {
    setSyncStatus('Menyinkronkan...', 'pending');
    const { data: remote, error: readError } = await client.from('finspace_snapshots').select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (readError) throw readError;
    if (remote?.data) await applyCloudSnapshot(remote.data, { merge: initial });
    const snapshot = snapshotData();
    state.sync.lastUploadedAt = snapshot.updatedAt;
    const { error: writeError } = await client.from('finspace_snapshots').upsert({ user_id: user.id, data: snapshot }, { onConflict: 'user_id' });
    if (writeError) throw writeError;
    setSyncStatus(`Tersinkron ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`, 'connected');
  } catch (error) {
    console.info('Sinkronisasi gagal:', error.message);
    setSyncStatus('Offline atau sinkronisasi perlu disiapkan', '');
  } finally {
    state.sync.syncing = false;
  }
}

let syncTimer = null;
function scheduleCloudSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => syncCloud(), 700);
}

async function sendMagicLink(event) {
  event.preventDefault();
  const email = $('#account-email').value.trim();
  if (!state.sync.client) {
    $('#account-message').textContent = 'Sinkronisasi belum dikonfigurasi di server.';
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    $('#account-message').textContent = 'Masukkan alamat email yang valid.';
    return;
  }
  const button = $('#send-magic-link');
  button.disabled = true;
  $('#account-message').textContent = '';
  try {
    const { error } = await state.sync.client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) throw error;
    $('#account-message').textContent = 'Tautan masuk sudah dikirim. Buka email ini pada perangkat yang ingin kamu sinkronkan.';
  } catch (error) {
    $('#account-message').textContent = error.message || 'Tautan masuk tidak dapat dikirim.';
  } finally {
    button.disabled = false;
  }
}

async function signOutCloud() {
  if (!state.sync.client || !await requestConfirmation({ title: 'Keluar dari akun?', message: 'Data lokal tetap ada di perangkat ini. Sinkronisasi akan berhenti sampai kamu masuk lagi.', confirmLabel: 'Keluar', danger: false })) return;
  await state.sync.client.auth.signOut();
  state.sync.user = null;
  unsubscribeFromCloud();
  renderAll();
  showToast('Kamu sudah keluar dari akun sinkronisasi.');
}

async function saveReceiptToCloud() {
  if (!state.receiptImage || !state.sync.client || !state.sync.user) return null;
  try {
    const blob = await fetch(state.receiptImage.dataUrl).then((response) => response.blob());
    const extension = state.receiptImage.mimeType.split('/')[1] || 'jpg';
    const path = `${state.sync.user.id}/${uid()}.${extension}`;
    const { error } = await state.sync.client.storage.from('receipts').upload(path, blob, { contentType: state.receiptImage.mimeType, upsert: false });
    if (error) throw error;
    return path;
  } catch (error) {
    console.info('Foto struk tidak diunggah:', error.message);
    return null;
  }
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch, id: 'profile' };
  if (patch.theme) applyTheme();
  try {
    await dbPut('settings', state.settings);
    renderAll();
    scheduleCloudSync();
  } catch (error) {
    showToast('Pengaturan belum tersimpan. Coba lagi.', 'error');
  }
}

function formatAmountInput(input) {
  const value = amountValue(input.value);
  input.value = value ? new Intl.NumberFormat('id-ID').format(value) : '';
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view]');
    const viewLink = event.target.closest('[data-view-link]');
    if (viewButton) setView(viewButton.dataset.view);
    if (viewLink) setView(viewLink.dataset.viewLink);
    if (event.target.closest('[data-open-capture]')) openCapture();
    const editButton = event.target.closest('[data-edit-transaction]');
    if (editButton) openCapture(state.transactions.find((item) => item.id === editButton.dataset.editTransaction));
    const deleteButton = event.target.closest('[data-delete-transaction]');
    if (deleteButton) await deleteTransaction(deleteButton.dataset.deleteTransaction);
    const deleteWalletButton = event.target.closest('[data-delete-wallet]');
    if (deleteWalletButton) await deleteWallet(deleteWalletButton.dataset.deleteWallet);
    const editWalletButton = event.target.closest('[data-edit-wallet]');
    if (editWalletButton) openWalletDialog(state.wallets.find((item) => item.id === editWalletButton.dataset.editWallet));
    if (event.target.closest('[data-add-wallet]')) openWalletDialog();
    const deleteBudgetButton = event.target.closest('[data-delete-budget]');
    if (deleteBudgetButton) await deleteBudget(deleteBudgetButton.dataset.deleteBudget);
    const editBudgetButton = event.target.closest('[data-edit-budget]');
    if (editBudgetButton) openBudgetDialog(state.budgets.find((item) => item.id === editBudgetButton.dataset.editBudget));
    if (event.target.closest('[data-add-budget]')) openBudgetDialog();
    const editGoalButton = event.target.closest('[data-edit-goal]');
    if (editGoalButton) openGoalDialog(state.goals.find((item) => item.id === editGoalButton.dataset.editGoal));
    const deleteGoalButton = event.target.closest('[data-delete-goal]');
    if (deleteGoalButton) await deleteGoal(deleteGoalButton.dataset.deleteGoal);
    const updateGoalButton = event.target.closest('[data-update-goal]');
    if (updateGoalButton) openGoalProgressDialog(state.goals.find((item) => item.id === updateGoalButton.dataset.updateGoal));
    if (event.target.closest('[data-add-goal]')) openGoalDialog();
  });
  $$('.dialog-close').forEach((button) => button.addEventListener('click', closeCapture));
  $$('.compact-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#confirm-cancel').addEventListener('click', () => settleConfirmation(false));
  $('#confirm-accept').addEventListener('click', () => settleConfirmation(true));
  $('#confirm-dialog').addEventListener('close', () => {
    if (confirmResolver) settleConfirmation(false);
  });
  $('#manual-tab').addEventListener('click', () => switchCaptureMode('manual'));
  $('#ai-tab').addEventListener('click', () => switchCaptureMode('ai'));
  $('#receipt-tab').addEventListener('click', () => switchCaptureMode('receipt'));
  $$('input[name="type"]').forEach((input) => input.addEventListener('change', () => renderCategoryOptions()));
  $('#transaction-form').addEventListener('submit', saveTransactionFromForm);
  $('#amount').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#wallet-opening-balance').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#budget-limit').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#goal-target').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#goal-current').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#goal-progress-amount').addEventListener('input', (event) => formatAmountInput(event.target));
  $('#history-search').addEventListener('input', renderHistory);
  $('#history-filter').addEventListener('change', renderHistory);
  $('#add-wallet-button').addEventListener('click', () => openWalletDialog());
  $('#add-budget-button').addEventListener('click', () => openBudgetDialog());
  $('#add-goal-button').addEventListener('click', () => openGoalDialog());
  $('#wallet-form').addEventListener('submit', saveWallet);
  $('#budget-form').addEventListener('submit', saveBudget);
  $('#goal-form').addEventListener('submit', saveGoal);
  $('#goal-progress-form').addEventListener('submit', saveGoalProgress);
  $('#parse-ai').addEventListener('click', parseWithAI);
  $('#edit-ai-draft').addEventListener('click', putAIDraftIntoForm);
  $('#confirm-ai-draft').addEventListener('click', confirmAIDraft);
  $('#receipt-file').addEventListener('change', (event) => selectReceipt(event.target.files[0]).catch((error) => { $('#receipt-message').textContent = error.message; }));
  $('#parse-receipt').addEventListener('click', parseReceipt);
  $('#privacy-toggle').addEventListener('click', () => saveSettings({ hideMoney: !state.settings.hideMoney }));
  $('#theme-toggle').addEventListener('click', () => saveSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }));
  $('#theme-select').addEventListener('change', (event) => saveSettings({ theme: event.target.value }).then(() => showToast('Tema aplikasi diperbarui.')));
  $('#save-profile').addEventListener('click', () => saveSettings({ name: $('#display-name').value.trim() }).then(() => showToast('Nama disimpan.')));
  $('#ai-enabled').addEventListener('change', (event) => saveSettings({ aiEnabled: event.target.checked }).then(() => showToast(event.target.checked ? 'Input AI diaktifkan.' : 'Input AI dimatikan.')));
  $('#export-json').addEventListener('click', exportJSON);
  $('#export-csv').addEventListener('click', exportCSV);
  $('#import-json').addEventListener('change', (event) => event.target.files[0] && importJSON(event.target.files[0]));
  $('#connect-account').addEventListener('click', () => {
    if (!state.sync.available) { showToast('Tambahkan konfigurasi Supabase di Vercel terlebih dahulu.', 'error'); return; }
    $('#account-form').reset();
    $('#account-message').textContent = '';
    $('#account-dialog').showModal();
    window.setTimeout(() => $('#account-email').focus(), 50);
  });
  $('#account-form').addEventListener('submit', sendMagicLink);
  $('#sync-now').addEventListener('click', async () => { await syncCloud(); renderAll(); });
  $('#sign-out').addEventListener('click', signOutCloud);
  $('#reset-data').addEventListener('click', async () => {
    if (!await requestConfirmation({ title: 'Reset semua data?', message: 'Semua dompet, transaksi, anggaran, dan pengaturan pada browser ini akan dihapus permanen.', confirmLabel: 'Reset semua data' })) return;
    await dbClearAll();
    state.wallets = [];
    state.transactions = [];
    state.budgets = [];
    state.goals = [];
    state.settings = { id: 'profile', name: '', aiEnabled: true, hideMoney: false, theme: 'system' };
    await loadState();
    setView('dashboard');
    scheduleCloudSync();
    showToast('Semua data lokal sudah direset.');
  });
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  window.addEventListener('online', () => scheduleCloudSync());
  window.addEventListener('focus', () => scheduleCloudSync());
  systemTheme.addEventListener('change', () => {
    if (state.settings.theme === 'system') applyTheme();
  });
  window.addEventListener('hashchange', () => {
    const requestedView = location.hash.slice(1);
    if (requestedView && requestedView !== state.currentView) setView(requestedView);
  });
}

function updateConnectionStatus() {
  if (location.protocol === 'file:') {
    $('#sidebar-status-light').classList.add('offline');
    $('#sidebar-status').textContent = 'Mode file lokal, PWA nonaktif';
    return;
  }
  const online = navigator.onLine;
  $('#sidebar-status-light').classList.toggle('offline', !online);
  $('#sidebar-status').textContent = online ? 'Data tersimpan lokal' : 'Offline, tetap bisa mencatat';
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (error) { console.info('Service worker belum aktif:', error.message); }
  }
}

async function init() {
  try {
    await loadState();
    bindEvents();
    updateConnectionStatus();
    $('#transaction-date').value = todayISO();
    setView(location.hash.slice(1) || 'dashboard');
    await initCloudSync();
    renderAll();
    await registerServiceWorker();
    if (new URLSearchParams(location.search).get('action') === 'capture') window.setTimeout(() => openCapture(), 200);
  } catch (error) {
    document.body.innerHTML = `<main class="fatal-error"><h1>FinSpace belum dapat dibuka</h1><p>${escapeHTML(error.message)}</p><button onclick="location.reload()">Coba lagi</button></main>`;
  }
}

init();
