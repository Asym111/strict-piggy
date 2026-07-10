/* ===== Строгая Копилка — логика приложения ===== */
'use strict';

const STORAGE_KEY = 'strictpiggy_v1';
const RULES_VERSION = '1.0 от 01.07.2026';
const PENALTY_RATE = 0.10;   // 10% за пропущенный день
const REVOKE_RATE = 0.50;    // потеря 50% при отзыве согласия

/* ---------- Состояние ---------- */

const defaultState = () => ({
  email: null,
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

/* ---------- Тексты уведомлений ---------- */

const NOTIF = {
  harsh: {
    deposit: [
      'Ладно, сегодня выжил. Завтра посмотрим, на что ты способен.',
      'Взнос принят. Не расслабляйся — полночь всегда рядом.',
      'Молодец, что не слился. Пока что.',
    ],
    penalty: (amount) =>
      `Слабак. Ты пропустил день — штраф ${fmtMoney(amount)} уже улетел владельцу приложения. Поздравляю с потерей.`,
    reminder: 'Ты опять тянешь? Пропустишь день — 10% твоих денег испарятся. Ты серьёзно хочешь остаться нищим?',
    progress: (pct) => `Всего ${pct}%. Копишь как черепаха. Шевелись.`,
  },
  soft: {
    deposit: [
      'Ещё один день — и ты на шаг ближе. Горжусь тобой! 💚',
      'Отличная работа! Дисциплина — твоя суперсила 🔥',
      'Взнос сделан! Ты строишь своё будущее по кирпичику 🧱',
    ],
    penalty: (amount) =>
      `К сожалению, день был пропущен — списан штраф ${fmtMoney(amount)}. Не сдавайся, начни новую серию сегодня! 🌱`,
    reminder: 'Не забудь про сегодняшний взнос! Ты слишком близко к мечте, чтобы терять деньги 💫',
    progress: (pct) => `Ты на ${pct}% ближе к мечте! Сегодняшний взнос — и ты герой 🔥`,
  },
};

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
      NOTIF[state.notifStyle].penalty(totalPenalty) +
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
    banner.textContent = '⏰ ' + NOTIF[state.notifStyle].reminder;
  }

  // Блок пополнения
  $('btn-deposit').disabled = depositedToday;
  $('deposit-done').classList.toggle('hidden', !depositedToday);
  $('input-deposit').placeholder = 'Сумма, например ' + Math.round(g.daily);

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

$('btn-google-signin').addEventListener('click', () => {
  const email = $('input-email').value.trim();
  if (!email || !email.includes('@')) {
    toast('Введите корректный email', true);
    return;
  }
  state.email = email;
  save();
  toast('Вход выполнен: ' + email);
  showScreen('consent');
});

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
  state = defaultState();
  save();
  toast('Правильное решение, если не уверен в себе.');
  setSlide(0);
  showScreen('onboarding');
});

/* ---------- Создание цели ---------- */

function validateGoalForm() {
  const name = $('input-goal-name').value.trim();
  const amount = +$('input-goal-amount').value;
  const days = +$('input-goal-days').value;
  const valid = name.length > 0 && amount >= 1000 && days >= 7 && days <= 730;
  $('btn-create-goal').disabled = !valid;
  if (amount > 0 && days > 0) {
    $('goal-daily-preview').classList.remove('hidden');
    $('goal-daily-amount').textContent = fmtMoney(amount / days) + ' / день';
  } else {
    $('goal-daily-preview').classList.add('hidden');
  }
}

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
  };
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
  const amount = +$('input-deposit').value;
  if (!amount || amount <= 0) {
    toast('Введите сумму пополнения', true);
    return;
  }
  const today = dayKey(appToday());
  if (state.lastDepositDay === today) return;
  state.balance += amount;
  state.streak += 1;
  state.lastDepositDay = today;
  state.lastAccountedDay = today;
  state.history.unshift({ type: 'deposit', amount, day: today, ts: Date.now() });
  save();
  $('input-deposit').value = '';
  const msgs = NOTIF[state.notifStyle].deposit;
  toast(msgs[Math.floor(Math.random() * msgs.length)], state.notifStyle === 'harsh');
  const pct = Math.min(100, Math.floor((state.balance / state.goal.target) * 100));
  setTimeout(() => toast(NOTIF[state.notifStyle].progress(pct), state.notifStyle === 'harsh'), 1200);
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
  const consent = state.consent;
  state = defaultState();
  state.email = email;
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
  state = defaultState();
  save();
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

(function init() {
  if (state.goal && state.consent) {
    openTab('dashboard');
  } else if (state.consent && state.email) {
    showScreen('goal');
  } else if (state.email) {
    showScreen('consent');
  } else {
    showScreen('onboarding');
  }
})();
