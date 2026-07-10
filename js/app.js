/* ===== Строгая Копилка — логика приложения ===== */
'use strict';

const STORAGE_KEY = 'strictpiggy_v1';
const RULES_VERSION = '1.0 от 01.07.2026';
const PENALTY_RATE = 0.10;   // 10% за пропущенный день
const REVOKE_RATE = 0.50;    // потеря 50% при отзыве согласия

/* ---------- Состояние ---------- */

const defaultState = () => ({
  email: null,
  uid: null,
  consent: null,            // { date, ip, rulesVersion }
  goal: null,               // { name, target, days, daily, createdDay }
  balance: 0,
  streak: 0,
  lastAccountedDay: null,   // последний день, за который всё учтено (взнос или штраф)
  lastDepositDay: null,
  dayOffset: 0,             // демо-сдвиг времени в днях
  notifStyle: 'harsh',
  history: [],              // { type: 'deposit'|'penalty'|'withdraw'|'revoke', amount, day, ts }
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { /* повреждённые данные — начинаем заново */ }
  return defaultState();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  cloudSave();
}

/* ---------- Работа с датами ---------- */

function appToday() {
  const d = new Date();
  d.setDate(d.getDate() + (state.dayOffset || 0));
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDay(key) {
  const d = new Date(key + 'T00:00:00');
  return d;
}

function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

function fmtMoney(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸';
}

function fmtDay(key) {
  return parseDay(key).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Firebase (Auth + Firestore) ---------- */

let fbAuth = null;
let fbDb = null;
let fbUser = null;
let cloudSaveTimer = null;

function initFirebase() {
  if (!window.firebase || !window.FIREBASE_CONFIG) return;
  try {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbAuth.onAuthStateChanged(async (user) => {
      fbUser = user;
      if (!user) return;
      try {
        const snap = await fbDb.collection('users').doc(user.uid).get();
        if (snap.exists && snap.data().state) {
          // облако — источник истины
          state = { ...defaultState(), ...snap.data().state };
        }
        state.email = user.email;
        state.uid = user.uid;
        save();
        route();
      } catch (e) {
        console.warn('Firestore load failed', e);
      }
    });
  } catch (e) {
    console.warn('Firebase init failed', e);
  }
}

function cloudSave() {
  if (!fbDb || !fbUser) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    fbDb.collection('users').doc(fbUser.uid).set({
      state,
      email: fbUser.email,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((e) => console.warn('Firestore save failed', e));
  }, 800);
}

async function firebaseSignOutAndDelete(deleteData) {
  if (!fbAuth || !fbUser) return;
  try {
    if (deleteData && fbDb) await fbDb.collection('users').doc(fbUser.uid).delete();
    if (deleteData) await fbUser.delete().catch(() => fbAuth.signOut());
    else await fbAuth.signOut();
  } catch (e) {
    console.warn('Firebase sign-out failed', e);
  }
  fbUser = null;
}

/* ---------- Тексты уведомлений ---------- */

const NOTIF = {
  harsh: {
    deposit: [
      'Ладно, сегодня выжил. Завтра посмотрим, на что ты способен.',
      'Взнос принят. Не расслабляйся — полночь всегда рядом.',
      'Молодец, что не слился. Пока что.',
      'О, ты ещё в игре? Деньги принял. Свободен до завтра.',
      'Неплохо. Но один пропуск — и я заберу 10%. Помни об этом.',
      'Копишь? Правильно. Нищета не ждёт слабых решений.',
      'Сегодня зачёт. Но я слежу за тобой каждый день.',
    ],
    penalty: [
      (a) => `Слабак. Ты пропустил день — штраф ${a} уже улетел владельцу приложения. Поздравляю с потерей.`,
      (a) => `Ты опять пропустил? ${a} твоих денег уже улетели владельцу. Ты серьёзно хочешь остаться нищим?`,
      (a) => `Минус ${a}. Дисциплина — не твоё? Тогда и деньги не твои.`,
      (a) => `${a} испарились. Владелец приложения передаёт спасибо. Может, хватит сливаться?`,
    ],
    reminder: [
      'Ты опять тянешь? Пропустишь день — 10% твоих денег испарятся. Ты серьёзно хочешь остаться нищим?',
      'Часики тикают. Полночь заберёт 10%, если не пополнишь. Решай.',
      'Не вижу взноса. Хочешь подарить владельцу ещё 10%? Смелый ход.',
      'Опять откладываешь? Штраф не откладывает. Никогда.',
    ],
    progress: [
      (pct) => `Всего ${pct}%. Копишь как черепаха. Шевелись.`,
      (pct) => `${pct}%? И это всё, на что ты способен?`,
      (pct) => `${pct}%. До цели далеко, а до штрафа — одна ночь.`,
    ],
  },
  soft: {
    deposit: [
      'Ещё один день — и ты на шаг ближе. Горжусь тобой! 💚',
      'Отличная работа! Дисциплина — твоя суперсила 🔥',
      'Взнос сделан! Ты строишь своё будущее по кирпичику 🧱',
      'Есть! Сегодняшний шаг сделан — мечта стала ближе ✨',
      'Ты умница! Серия продолжается, так держать 🌟',
      'Каждый взнос — это подарок будущему себе. Красавчик! 💪',
      'День засчитан! Маленькие шаги создают большие результаты 🚀',
    ],
    penalty: [
      (a) => `К сожалению, день был пропущен — списан штраф ${a}. Не сдавайся, начни новую серию сегодня! 🌱`,
      (a) => `Штраф ${a} 😔 Бывает. Главное — вернуться в строй прямо сейчас!`,
      (a) => `Потеря ${a} — это урок, а не приговор. Новая серия начинается с сегодняшнего взноса 💫`,
    ],
    reminder: [
      'Не забудь про сегодняшний взнос! Ты слишком близко к мечте, чтобы терять деньги 💫',
      'Сегодняшний взнос — и ты герой 🔥 Не дай штрафу ни единого шанса!',
      'Твоя мечта ждёт! Один маленький взнос — и день засчитан 🌤',
      'Ты справлялся раньше — справишься и сегодня. Пополни копилку! 💚',
    ],
    progress: [
      (pct) => `Ты на ${pct}% ближе к мечте! Сегодняшний взнос — и ты герой 🔥`,
      (pct) => `Уже ${pct}%! Ты делаешь это лучше, чем большинство 🚀`,
      (pct) => `${pct}% пройдено. Каждый день — кирпичик твоего будущего 🧱`,
    ],
  },
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// стабильный выбор на день (чтобы баннер не менялся при каждом рендере)
function pickDaily(arr) {
  const seed = parseDay(dayKey(appToday())).getTime() / 86400000;
  return arr[Math.floor(seed) % arr.length];
}

/* ---------- Утилиты DOM ---------- */

const $ = (id) => document.getElementById(id);

const SCREENS = ['onboarding', 'signin', 'consent', 'goal', 'dashboard', 'history', 'penalties', 'withdraw', 'settings'];

function showScreen(name) {
  SCREENS.forEach((s) => $('screen-' + s).classList.toggle('hidden', s !== name));
  window.scrollTo(0, 0);
}

function showModal(id, show = true) {
  $(id).classList.toggle('hidden', !show);
}

function toast(text, harsh = false, ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast' + (harsh ? ' harsh' : '');
  el.textContent = text;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Сетка сумм (челлендж) ---------- */

// Генерирует массив из `days` разных сумм, кратных 100, с точной суммой `target`
function generateGrid(target, days) {
  const weights = Array.from({ length: days }, () => 0.3 + Math.random() * 1.9);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => Math.max(100, Math.round((w * target) / sumW / 100) * 100));
  let diff = target - amounts.reduce((a, b) => a + b, 0);
  let i = 0;
  while (diff !== 0 && i < days * 200) {
    const idx = i % days;
    if (Math.abs(diff) < 100) { amounts[idx] += diff; diff = 0; break; }
    const step = diff > 0 ? 100 : -100;
    if (amounts[idx] + step >= 100) { amounts[idx] += step; diff -= step; }
    i++;
  }
  return amounts.map((amount) => ({ amount, done: false, day: null }));
}

function gridRemaining() {
  return state.goal.grid.filter((c) => !c.done).length;
}

/* ---------- Штрафы ---------- */

function runPenaltyCheck() {
  if (!state.goal) return;
  const today = dayKey(appToday());
  let missed = [];
  let cursor = state.lastAccountedDay;
  // все полные дни между последним учтённым днём и сегодня — пропущены
  while (daysBetween(cursor, today) > 1) {
    const next = new Date(parseDay(cursor));
    next.setDate(next.getDate() + 1);
    cursor = dayKey(next);
    missed.push(cursor);
  }
  if (!missed.length) return;

  let totalPenalty = 0;
  missed.forEach((day) => {
    const amount = state.balance * PENALTY_RATE;
    if (amount <= 0) return;
    state.balance -= amount;
    totalPenalty += amount;
    state.history.unshift({ type: 'penalty', amount, day, ts: Date.now() });
  });
  state.streak = 0;
  state.lastAccountedDay = missed[missed.length - 1];
  save();

  if (totalPenalty > 0) {
    $('penalty-message').textContent =
      pick(NOTIF[state.notifStyle].penalty)(fmtMoney(totalPenalty)) +
      (missed.length > 1 ? ` (пропущено дней: ${missed.length})` : '');
    showModal('modal-penalty');
    $('balance-card').classList.add('penalty-flash');
    setTimeout(() => $('balance-card').classList.remove('penalty-flash'), 600);
  }
}

/* ---------- Рендер дашборда ---------- */

let countdownTimer = null;

function renderDashboard() {
  const g = state.goal;
  if (!g) return;
  const today = dayKey(appToday());
  const pct = Math.min(100, Math.floor((state.balance / g.target) * 100));
  const daysGone = daysBetween(g.createdDay, today);
  const daysLeft = Math.max(0, g.days - daysGone);
  const penaltiesTotal = state.history
    .filter((h) => h.type === 'penalty')
    .reduce((s, h) => s + h.amount, 0);
  const depositedToday = state.lastDepositDay === today;

  $('dash-email').textContent = state.email || '';
  $('dash-goal-name').textContent = '🎯 ' + g.name;
  $('dash-balance').textContent = fmtMoney(state.balance);
  $('dash-progress').style.width = pct + '%';
  $('dash-percent').textContent = pct + '%';
  $('dash-target').textContent = 'из ' + fmtMoney(g.target);
  $('dash-streak').textContent = state.streak;
  $('dash-days-left').textContent = daysLeft;
  $('dash-penalties-total').textContent = fmtMoney(penaltiesTotal);

  // Баннер состояния
  const banner = $('dash-status-banner');
  banner.classList.remove('hidden', 'ok', 'warn', 'bad');
  if (state.balance >= g.target) {
    banner.classList.add('ok');
    banner.textContent = '🏆 Цель достигнута! Забери свои деньги на вкладке «Вывод».';
  } else if (depositedToday) {
    banner.classList.add('ok');
    banner.textContent = '✅ Сегодня ты в безопасности. Серия: ' + state.streak + ' 🔥';
  } else {
    banner.classList.add(state.notifStyle === 'harsh' ? 'bad' : 'warn');
    banner.textContent = '⏰ ' + pickDaily(NOTIF[state.notifStyle].reminder);
  }

  // Блок пополнения
  $('deposit-done').classList.toggle('hidden', !depositedToday);
  $('input-deposit').placeholder = 'Сумма, например ' + Math.round(g.daily);

  // Режим сетки
  const isGrid = g.mode === 'grid';
  const gridDone = isGrid && gridRemaining() === 0;
  $('grid-block').classList.toggle('hidden', !isGrid);
  // свободный ввод: линейный режим или сетка закрыта (докрыть недостачу после штрафов)
  $('deposit-input-row').classList.toggle('hidden', isGrid && !gridDone);
  if (isGrid) renderGrid(depositedToday, gridDone);
  updateDepositButton(depositedToday, isGrid, gridDone);

  // Обратный отсчёт до полуночи (реальное время + демо-сдвиг не влияет на часы)
  clearInterval(countdownTimer);
  const tick = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ms = midnight - now;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    $('deposit-countdown').innerHTML = depositedToday
      ? 'Следующий взнос — завтра'
      : `До штрафа осталось: <b>${h}ч ${String(m).padStart(2, '0')}м ${String(s).padStart(2, '0')}с</b>`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ---------- Рендер сетки ---------- */

let selectedCell = null;

function updateDepositButton(depositedToday, isGrid, gridDone) {
  const btn = $('btn-deposit');
  if (depositedToday) {
    btn.disabled = true;
    btn.textContent = '💰 Пополнить сегодня';
    return;
  }
  if (isGrid && !gridDone) {
    const cell = selectedCell != null ? state.goal.grid[selectedCell] : null;
    btn.disabled = !cell;
    btn.textContent = cell ? `💰 Внести ${fmtMoney(cell.amount)}` : '💰 Выбери ячейку из сетки';
  } else {
    btn.disabled = false;
    btn.textContent = '💰 Пополнить сегодня';
  }
}

function renderGrid(depositedToday, gridDone) {
  const wrap = $('grid-cells');
  wrap.innerHTML = '';
  const g = state.goal;
  const total = g.grid.length;
  $('grid-progress').textContent = `закрыто ${total - gridRemaining()} из ${total}`;
  $('btn-grid-random').disabled = depositedToday || gridDone;
  g.grid.forEach((cell, idx) => {
    const el = document.createElement('button');
    el.className = 'cell' + (cell.done ? ' done' : '') + (idx === selectedCell ? ' selected' : '');
    el.textContent = cell.amount.toLocaleString('ru-RU');
    if (cell.done) el.title = 'Закрыто ' + (cell.day ? fmtDay(cell.day) : '');
    else if (!depositedToday) {
      el.addEventListener('click', () => {
        selectedCell = idx;
        renderGrid(depositedToday, gridDone);
        updateDepositButton(depositedToday, true, gridDone);
      });
    }
    wrap.appendChild(el);
  });
}

$('btn-grid-random').addEventListener('click', () => {
  const free = state.goal.grid.map((c, i) => (c.done ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return;
  selectedCell = free[Math.floor(Math.random() * free.length)];
  renderDashboard();
});

/* ---------- Рендер истории и штрафов ---------- */

function renderHistory() {
  const list = $('history-list');
  list.innerHTML = '';
  if (!state.history.length) {
    list.innerHTML = '<li class="op-empty">Операций пока нет</li>';
    return;
  }
  const labels = { deposit: '💰 Пополнение', penalty: '💀 Штраф 10%', withdraw: '🏦 Вывод средств', revoke: '⚠️ Вывод при удалении (−50%)' };
  state.history.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'op-item' + (h.type === 'penalty' ? ' penalty' : '');
    const sign = h.type === 'deposit' ? '+' : '−';
    const cls = h.type === 'deposit' ? 'plus' : 'minus';
    li.innerHTML = `
      <div><div class="op-title">${labels[h.type]}</div><div class="op-date">${fmtDay(h.day)}</div></div>
      <div class="op-amount ${cls}">${sign}${fmtMoney(h.amount)}</div>`;
    list.appendChild(li);
  });
}

function renderPenalties() {
  const list = $('penalties-list');
  list.innerHTML = '';
  const pens = state.history.filter((h) => h.type === 'penalty');
  const total = pens.reduce((s, h) => s + h.amount, 0);
  $('penalties-sum').textContent = fmtMoney(total);
  if (!pens.length) {
    list.innerHTML = '<li class="op-empty">Штрафов нет. Так держать! 🔥</li>';
    return;
  }
  pens.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'op-item penalty';
    li.innerHTML = `
      <div><div class="op-title">💀 Пропущен день</div><div class="op-date">${fmtDay(h.day)} · в пользу владельца приложения</div></div>
      <div class="op-amount minus">−${fmtMoney(h.amount)}</div>`;
    list.appendChild(li);
  });
}

function renderWithdraw() {
  const g = state.goal;
  const reached = state.balance >= g.target;
  $('withdraw-locked').classList.toggle('hidden', reached);
  $('withdraw-unlocked').classList.toggle('hidden', !reached);
  $('withdraw-remaining').textContent = fmtMoney(Math.max(0, g.target - state.balance));
  $('withdraw-amount').textContent = fmtMoney(state.balance);
}

function renderSettings() {
  document.querySelectorAll('.settings-notif').forEach((b) =>
    b.classList.toggle('active', b.dataset.style === state.notifStyle));
  const c = state.consent;
  $('consent-log').innerHTML = c
    ? `Согласие принято: <b>${new Date(c.date).toLocaleString('ru-RU')}</b><br>IP: ${c.ip}<br>Версия правил: ${c.rulesVersion}`
    : 'Согласие не оформлено';
}

/* ---------- Навигация по табам ---------- */

function openTab(tab) {
  runPenaltyCheck();
  showScreen(tab);
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'history') renderHistory();
  if (tab === 'penalties') renderPenalties();
  if (tab === 'withdraw') renderWithdraw();
}

document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => openTab(btn.dataset.tab)));

/* ---------- Онбординг ---------- */

let slideIdx = 0;

function setSlide(i) {
  slideIdx = i;
  document.querySelectorAll('.slide').forEach((s, n) => s.classList.toggle('active', n === i));
  document.querySelectorAll('.dot').forEach((d, n) => d.classList.toggle('active', n === i));
  $('btn-onboarding-next').textContent = i === 2 ? 'Начать' : 'Далее';
}

$('btn-onboarding-next').addEventListener('click', () => {
  if (slideIdx < 2) setSlide(slideIdx + 1);
  else showScreen('signin');
});
$('btn-onboarding-skip').addEventListener('click', () => showScreen('signin'));

/* ---------- Вход ---------- */

function demoSignIn() {
  const email = $('input-email').value.trim();
  if (!email || !email.includes('@')) {
    toast('Введите корректный email для демо-режима', true);
    return;
  }
  state.email = email;
  save();
  toast('Демо-вход выполнен: ' + email);
  showScreen('consent');
}

$('btn-google-signin').addEventListener('click', async () => {
  if (!fbAuth) {
    toast('Firebase недоступен — используйте демо-режим', true);
    return;
  }
  try {
    const result = await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    toast('Вход выполнен: ' + result.user.email);
    // дальнейший роутинг сделает onAuthStateChanged после загрузки облачных данных
  } catch (e) {
    if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      console.warn('Google sign-in failed', e);
      toast('Не удалось войти через Google: ' + (e.code || e.message), true);
    }
  }
});

$('btn-demo-signin').addEventListener('click', demoSignIn);

/* ---------- Согласие ---------- */

$('chk-consent').addEventListener('change', (e) => {
  $('btn-consent').disabled = !e.target.checked;
});

let demoCode = '';

$('btn-consent').addEventListener('click', () => {
  demoCode = String(Math.floor(100000 + Math.random() * 900000));
  $('demo-code').textContent = demoCode;
  $('input-code').value = '';
  $('code-error').classList.add('hidden');
  showModal('modal-confirm-consent');
});

$('btn-code-cancel').addEventListener('click', () => showModal('modal-confirm-consent', false));

$('btn-code-confirm').addEventListener('click', () => {
  if ($('input-code').value.trim() !== demoCode) {
    $('code-error').classList.remove('hidden');
    return;
  }
  state.consent = { date: new Date().toISOString(), ip: '127.0.0.1 (демо)', rulesVersion: RULES_VERSION };
  save();
  showModal('modal-confirm-consent', false);
  toast('Согласие зафиксировано. Пути назад нет.', true);
  showScreen('goal');
});

$('btn-consent-decline').addEventListener('click', () => {
  firebaseSignOutAndDelete(false);
  state = defaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  toast('Правильное решение, если не уверен в себе.');
  setSlide(0);
  showScreen('onboarding');
});

/* ---------- Создание цели ---------- */

let goalMode = 'linear';

function validateGoalForm() {
  const name = $('input-goal-name').value.trim();
  const amount = +$('input-goal-amount').value;
  const days = +$('input-goal-days').value;
  let valid = name.length > 0 && amount >= 1000 && days >= 7 && days <= 730;
  // в режиме сетки минимум 100 ₸ на ячейку
  if (goalMode === 'grid' && days > 0 && amount / days < 100) valid = false;
  $('btn-create-goal').disabled = !valid;
  if (amount > 0 && days > 0) {
    $('goal-daily-preview').classList.remove('hidden');
    $('goal-daily-amount').textContent = goalMode === 'grid'
      ? `в среднем ${fmtMoney(amount / days)} / день (суммы разные)`
      : fmtMoney(amount / days) + ' / день';
  } else {
    $('goal-daily-preview').classList.add('hidden');
  }
}

document.querySelectorAll('.pay-mode').forEach((btn) =>
  btn.addEventListener('click', () => {
    goalMode = btn.dataset.mode;
    document.querySelectorAll('.pay-mode').forEach((b) =>
      b.classList.toggle('active', b === btn));
    $('mode-hint').textContent = goalMode === 'grid'
      ? 'Сетка разных сумм — каждый день закрываешь одну ячейку (как бумажный челлендж)'
      : 'Одинаковый взнос каждый день';
    validateGoalForm();
  }));

['input-goal-name', 'input-goal-amount', 'input-goal-days'].forEach((id) =>
  $(id).addEventListener('input', validateGoalForm));

document.querySelectorAll('#screen-goal .notif-style').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.notifStyle = btn.dataset.style;
    document.querySelectorAll('#screen-goal .notif-style').forEach((b) =>
      b.classList.toggle('active', b === btn));
  }));

$('btn-create-goal').addEventListener('click', () => {
  const target = +$('input-goal-amount').value;
  const days = +$('input-goal-days').value;
  const today = dayKey(appToday());
  state.goal = {
    name: $('input-goal-name').value.trim(),
    target,
    days,
    daily: target / days,
    createdDay: today,
    mode: goalMode,
    grid: goalMode === 'grid' ? generateGrid(target, days) : null,
  };
  selectedCell = null;
  state.balance = 0;
  state.streak = 0;
  state.history = [];
  state.lastAccountedDay = today; // за день создания штраф не начисляется
  state.lastDepositDay = null;
  save();
  toast(state.notifStyle === 'harsh'
    ? 'Цель создана. Теперь ты в ловушке. Плати каждый день.'
    : 'Цель создана! Начни свою серию сегодня 🔥', state.notifStyle === 'harsh');
  openTab('dashboard');
});

/* ---------- Пополнение ---------- */

$('btn-deposit-daily').addEventListener('click', () => {
  $('input-deposit').value = Math.ceil(state.goal.daily);
});

$('btn-deposit').addEventListener('click', () => {
  runPenaltyCheck();
  const today = dayKey(appToday());
  if (state.lastDepositDay === today) return;

  const g = state.goal;
  const gridActive = g.mode === 'grid' && gridRemaining() > 0;
  let amount;
  if (gridActive) {
    if (selectedCell == null || g.grid[selectedCell].done) {
      toast('Сначала выбери ячейку из сетки', true);
      return;
    }
    amount = g.grid[selectedCell].amount;
    g.grid[selectedCell].done = true;
    g.grid[selectedCell].day = today;
    selectedCell = null;
  } else {
    amount = +$('input-deposit').value;
    if (!amount || amount <= 0) {
      toast('Введите сумму пополнения', true);
      return;
    }
  }

  state.balance += amount;
  state.streak += 1;
  state.lastDepositDay = today;
  state.lastAccountedDay = today;
  state.history.unshift({ type: 'deposit', amount, day: today, ts: Date.now() });
  save();
  $('input-deposit').value = '';
  toast(pick(NOTIF[state.notifStyle].deposit), state.notifStyle === 'harsh');
  const pct = Math.min(100, Math.floor((state.balance / state.goal.target) * 100));
  setTimeout(() => toast(pick(NOTIF[state.notifStyle].progress)(pct), state.notifStyle === 'harsh'), 1200);
  renderDashboard();
});

$('btn-penalty-ok').addEventListener('click', () => {
  showModal('modal-penalty', false);
  renderDashboard();
});

/* ---------- Вывод средств ---------- */

$('btn-withdraw').addEventListener('click', () => {
  const amount = state.balance;
  state.history.unshift({ type: 'withdraw', amount, day: dayKey(appToday()), ts: Date.now() });
  state.balance = 0;
  save();
  $('success-title').textContent = '🎉 Цель «' + state.goal.name + '» достигнута!';
  $('success-message').textContent = 'Выведено ' + fmtMoney(amount) + '. Ты доказал, что дисциплина сильнее лени.';
  showModal('modal-success');
});

$('btn-success-ok').addEventListener('click', () => {
  const email = state.email;
  const uid = state.uid;
  const consent = state.consent;
  state = defaultState();
  state.email = email;
  state.uid = uid;
  state.consent = consent;
  save();
  showModal('modal-success', false);
  showScreen('goal');
});

/* ---------- Отзыв согласия ---------- */

$('btn-revoke').addEventListener('click', () => {
  $('revoke-balance').textContent = fmtMoney(state.balance);
  $('revoke-amount').textContent = fmtMoney(state.balance * (1 - REVOKE_RATE));
  $('input-revoke').value = '';
  $('btn-revoke-confirm').disabled = true;
  showModal('modal-revoke');
});

$('input-revoke').addEventListener('input', (e) => {
  $('btn-revoke-confirm').disabled = e.target.value.trim().toUpperCase() !== 'УДАЛИТЬ';
});

$('btn-revoke-cancel').addEventListener('click', () => showModal('modal-revoke', false));

$('btn-revoke-confirm').addEventListener('click', () => {
  const payout = state.balance * (1 - REVOKE_RATE);
  showModal('modal-revoke', false);
  firebaseSignOutAndDelete(true);
  state = defaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $('success-title').textContent = 'Аккаунт удалён';
  $('success-message').textContent = 'Согласие отозвано. Выплачено ' + fmtMoney(payout) + ' (50% удержано по правилам).';
  showModal('modal-success');
  $('btn-success-ok').textContent = 'На главный экран';
});

/* ---------- Настройки ---------- */

$('btn-settings').addEventListener('click', () => {
  renderSettings();
  showScreen('settings');
});

$('btn-settings-back').addEventListener('click', () => openTab('dashboard'));

document.querySelectorAll('.settings-notif').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.notifStyle = btn.dataset.style;
    save();
    renderSettings();
    toast('Стиль уведомлений: ' + (state.notifStyle === 'harsh' ? 'жёсткий 😤' : 'мотивирующий 🌤'));
  }));

$('btn-simulate-day').addEventListener('click', () => {
  state.dayOffset = (state.dayOffset || 0) + 1;
  save();
  toast('⏭ Наступил новый день: ' + fmtDay(dayKey(appToday())));
  openTab('dashboard');
});

/* ---------- Старт ---------- */

function route() {
  if (state.goal && state.consent) {
    openTab('dashboard');
  } else if (state.consent && state.email) {
    showScreen('goal');
  } else if (state.email) {
    showScreen('consent');
  } else {
    showScreen('onboarding');
  }
}

initFirebase();
route();
