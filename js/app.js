/* ===== Строгая Копилка — логика приложения ===== */
'use strict';

const STORAGE_KEY = 'strictpiggy_v1';
const PENALTY_RATE = 0.10;   // 10% за пропущенный день
const REVOKE_RATE = 0.50;    // потеря 50% при отзыве согласия

/* ---------- Состояние ---------- */

const defaultState = () => ({
  email: null,
  uid: null,
  consent: null,            // { date, ip, rulesVersion }
  goal: null,               // { name, target, days, daily, createdDay, mode, grid }
  balance: 0,
  streak: 0,
  lastAccountedDay: null,
  lastDepositDay: null,
  dayOffset: 0,
  notifStyle: 'harsh',
  gender: 'm',              // 'm' | 'f'
  lang: null,               // 'ru' | 'en', null = автоопределение
  history: [],
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

function lang() {
  return state.lang || (String(navigator.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en');
}

function isF() { return state.gender === 'f'; }

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
          state = { ...defaultState(), ...snap.data().state };
        }
        state.email = user.email;
        state.uid = user.uid;
        save();
        applyI18n();
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

/* ---------- Работа с датами и деньгами ---------- */

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
  return new Date(key + 'T00:00:00');
}

function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

function fmtMoney(n) {
  return Math.round(n).toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-US') + ' ₸';
}

function fmtDay(key) {
  return parseDay(key).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-US',
    { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Интерфейсные тексты (i18n) ---------- */

const I18N = {
  ru: {
    ob1Title: 'Строгая Копилка',
    ob1Text: 'Приложение, которое <b>заставит</b> тебя накопить. Никаких оправданий. Никакой жалости.',
    ob2Title: 'Жёсткие правила',
    ob2Text: 'Пополняешь копилку <b>каждый день</b>. Пропустил день — теряешь <b class="red">10% всех накоплений</b>. Навсегда.',
    ob3Title: 'Цель — всё',
    ob3Text: 'Вывести деньги можно <b>только после достижения цели</b>. Дисциплина или потери — выбор за тобой.',
    next: 'Далее', nextStart: 'Начать', skip: 'Пропустить',
    signinTitle: 'Вход в аккаунт',
    signinSub: 'Для продолжения войдите через Google',
    googleBtn: 'Войти через Google',
    demoDivider: 'или демо-режим без аккаунта',
    demoEmailPh: 'Email для демо-режима',
    demoBtn: 'Продолжить в демо-режиме',
    consentTitle: 'ВНИМАНИЕ!<br>ЖЁСТКИЕ ПРАВИЛА',
    consentP1: 'Если вы пропустите ежедневное пополнение хотя бы на <b>1 день</b>, с вашего баланса автоматически списывается <b>10% от текущих накоплений</b> в пользу владельца приложения.',
    consentP2: '<b>ЭТО НЕОБРАТИМО.</b> Штрафы не возвращаются.',
    consentP3: 'Отзыв согласия = удаление аккаунта + вывод остатка <b>с потерей 50%</b>.',
    consentP4: 'Вывод накоплений возможен <b>только после достижения цели</b>.',
    rulesVersion: 'Версия правил: 1.0 от 01.07.2026',
    consentCheck: 'Я полностью понимаю и соглашаюсь с правилами, включая безвозвратные штрафы 10% за каждый пропущенный день',
    consentBtn: 'Я ПОЛНОСТЬЮ ПОНИМАЮ И СОГЛАШАЮСЬ',
    consentDecline: 'Отказаться и выйти',
    codeTitle: 'Повторное подтверждение',
    codeText: 'На ваш email отправлен код подтверждения (демо-код:',
    codePh: 'Введите код из письма',
    codeError: 'Неверный код. Попробуйте ещё раз.',
    codeConfirm: 'Подтвердить согласие',
    cancel: 'Отмена',
    goalTitle: '🎯 Твоя цель',
    goalSub: 'Определи, ради чего будешь страдать',
    goalName: 'Название цели',
    goalNamePh: 'Например: MacBook Pro',
    goalAmount: 'Сумма цели, ₸',
    goalDays: 'Срок, дней',
    modeLabel: 'Режим накопления',
    modeLinear: '📏 Линейно',
    modeGrid: '🎲 Сетка сумм',
    modeHintLinear: 'Одинаковый взнос каждый день',
    modeHintGrid: 'Сетка разных сумм — каждый день закрываешь одну ячейку (как бумажный челлендж)',
    dailyLabel: 'Ежедневный взнос:',
    perDay: (a) => `${a} / день`,
    avgPerDay: (a) => `в среднем ${a} / день (суммы разные)`,
    genderLabel: 'К кому обращаться?',
    genderM: '👨 Я парень',
    genderF: '👩 Я девушка',
    notifLabel: 'Стиль уведомлений',
    styleHarsh: '😤 Жёсткий',
    styleSoft: '🌤 Мотивирующий',
    createGoal: 'Начать копить',
    saved: 'Накоплено',
    of: (a) => 'из ' + a,
    statStreak: 'дней подряд 🔥',
    statDaysLeft: 'дней осталось',
    statPenalties: 'штрафов 💀',
    gridTitle: '🎲 Сетка сумм',
    gridProgress: (d, t) => `закрыто ${d} из ${t}`,
    gridRandom: '🎲 Выбрать случайную ячейку',
    gridClosed: (d) => 'Закрыто ' + d,
    dailyBtn: 'дневной',
    depositBtn: '💰 Пополнить сегодня',
    depositAmountBtn: (a) => `💰 Внести ${a}`,
    depositPickCell: '💰 Выбери ячейку из сетки',
    depositDone: '✅ Сегодняшний взнос сделан. Ты в безопасности до полуночи.',
    depositPh: (a) => 'Сумма, например ' + a,
    countdown: (h, m, s) => `До штрафа осталось: <b>${h}ч ${m}м ${s}с</b>`,
    countdownDone: 'Следующий взнос — завтра',
    tabHome: 'Главная', tabHistory: 'История', tabPenalties: 'Штрафы', tabWithdraw: 'Вывод',
    historyTitle: '📜 История операций',
    opDeposit: '💰 Пополнение', opPenalty: '💀 Штраф 10%', opWithdraw: '🏦 Вывод средств',
    opRevoke: '⚠️ Вывод при удалении (−50%)',
    opEmpty: 'Операций пока нет',
    penaltiesTitle: '💀 История штрафов',
    totalLost: 'Всего потеряно:',
    penEmpty: 'Штрафов нет. Так держать! 🔥',
    penMissed: '💀 Пропущен день',
    penOwner: 'в пользу владельца приложения',
    withdrawTitle: '🏦 Вывод средств',
    withdrawLocked: 'Вывод доступен <b>только после достижения цели</b>.',
    withdrawRemaining: 'Осталось накопить:',
    goalReached: 'Цель достигнута!',
    withdrawUnlockedText: 'Ты справился. Весь баланс доступен к выводу.',
    withdrawUnlockedTextF: 'Ты справилась. Весь баланс доступен к выводу.',
    withdrawBtn: 'Вывести',
    dangerZone: '⚠️ Опасная зона',
    dangerText: 'Отзыв согласия удаляет аккаунт. Остаток выводится с потерей 50%.',
    revokeBtn: 'Отозвать согласие и удалить аккаунт',
    settingsTitle: '⚙️ Настройки',
    langLabel: 'Язык / Language',
    consentLogTitle: 'Согласие',
    consentLog: (d, ip, v) => `Согласие принято: <b>${d}</b><br>IP: ${ip}<br>Версия правил: ${v}`,
    consentNone: 'Согласие не оформлено',
    demoTitle: '🧪 Демо-режим',
    demoText: 'Симуляция следующего дня — для проверки логики штрафов.',
    simulateBtn: '⏭ Симулировать следующий день',
    penaltyTitle: 'ШТРАФ!',
    penaltyOk: 'Принять потерю',
    missedSuffix: (n) => ` (пропущено дней: ${n})`,
    revokeTitle: 'Отзыв согласия',
    revokeText1: 'Аккаунт будет удалён. Вы получите',
    revokeText2: '(50% от баланса',
    revokeType: 'Для подтверждения введите:',
    revokeWord: 'УДАЛИТЬ',
    revokeConfirm: 'Удалить аккаунт навсегда',
    successOk: 'Начать заново',
    bannerReached: '🏆 Цель достигнута! Забери свои деньги на вкладке «Вывод».',
    bannerSafe: (s) => `✅ Сегодня ты в безопасности. Серия: ${s} 🔥`,
    toastEmailInvalid: 'Введите корректный email для демо-режима',
    toastDemoIn: (e) => 'Демо-вход выполнен: ' + e,
    toastSignedIn: (e) => 'Вход выполнен: ' + e,
    toastFirebaseNA: 'Firebase недоступен — используйте демо-режим',
    toastSignInFail: (c) => 'Не удалось войти через Google: ' + c,
    toastConsentSaved: 'Согласие зафиксировано. Пути назад нет.',
    toastDeclined: 'Правильное решение, если не уверен в себе.',
    toastGoalHarsh: 'Цель создана. Теперь ты в ловушке. Плати каждый день.',
    toastGoalSoft: 'Цель создана! Начни свою серию сегодня 🔥',
    toastPickCell: 'Сначала выбери ячейку из сетки',
    toastEnterAmount: 'Введите сумму пополнения',
    toastNewDay: (d) => '⏭ Наступил новый день: ' + d,
    toastNotifStyle: (h) => 'Стиль уведомлений: ' + (h ? 'жёсткий 😤' : 'мотивирующий 🌤'),
    toastGender: (f) => (f ? 'Теперь обращаемся к тебе как к девушке 👩' : 'Теперь обращаемся к тебе как к парню 👨'),
    successGoalTitle: (n) => `🎉 Цель «${n}» достигнута!`,
    successGoalMsg: (a, f) => `Выведено ${a}. Ты ${f ? 'доказала' : 'доказал'}, что дисциплина сильнее лени.`,
    accountDeleted: 'Аккаунт удалён',
    revokePaid: (a) => `Согласие отозвано. Выплачено ${a} (50% удержано по правилам).`,
    toHome: 'На главный экран',
  },
  en: {
    ob1Title: 'Strict Piggy',
    ob1Text: 'The app that will <b>force</b> you to save. No excuses. No mercy.',
    ob2Title: 'Harsh rules',
    ob2Text: 'Top up your piggy bank <b>every single day</b>. Miss a day — lose <b class="red">10% of all your savings</b>. Forever.',
    ob3Title: 'Goal is everything',
    ob3Text: 'You can withdraw money <b>only after reaching your goal</b>. Discipline or losses — your choice.',
    next: 'Next', nextStart: 'Start', skip: 'Skip',
    signinTitle: 'Sign in',
    signinSub: 'Sign in with Google to continue',
    googleBtn: 'Sign in with Google',
    demoDivider: 'or demo mode without an account',
    demoEmailPh: 'Email for demo mode',
    demoBtn: 'Continue in demo mode',
    consentTitle: 'WARNING!<br>HARSH RULES',
    consentP1: 'If you miss your daily deposit even by <b>1 day</b>, <b>10% of your current savings</b> is automatically deducted from your balance in favor of the app owner.',
    consentP2: '<b>THIS IS IRREVERSIBLE.</b> Penalties are not refunded.',
    consentP3: 'Revoking consent = account deletion + withdrawal of the remainder <b>with a 50% loss</b>.',
    consentP4: 'Withdrawal is possible <b>only after reaching your goal</b>.',
    rulesVersion: 'Rules version: 1.0 of 01.07.2026',
    consentCheck: 'I fully understand and agree to the rules, including irreversible 10% penalties for every missed day',
    consentBtn: 'I FULLY UNDERSTAND AND AGREE',
    consentDecline: 'Decline and exit',
    codeTitle: 'Second confirmation',
    codeText: 'A confirmation code was sent to your email (demo code:',
    codePh: 'Enter the code from the email',
    codeError: 'Wrong code. Try again.',
    codeConfirm: 'Confirm consent',
    cancel: 'Cancel',
    goalTitle: '🎯 Your goal',
    goalSub: 'Decide what you will suffer for',
    goalName: 'Goal name',
    goalNamePh: 'E.g.: MacBook Pro',
    goalAmount: 'Target amount, ₸',
    goalDays: 'Duration, days',
    modeLabel: 'Saving mode',
    modeLinear: '📏 Linear',
    modeGrid: '🎲 Amount grid',
    modeHintLinear: 'Same deposit every day',
    modeHintGrid: 'A grid of different amounts — close one cell per day (like the paper challenge)',
    dailyLabel: 'Daily deposit:',
    perDay: (a) => `${a} / day`,
    avgPerDay: (a) => `avg ${a} / day (amounts vary)`,
    genderLabel: 'How should we address you?',
    genderM: "👨 I'm a guy",
    genderF: "👩 I'm a girl",
    notifLabel: 'Notification style',
    styleHarsh: '😤 Harsh',
    styleSoft: '🌤 Motivating',
    createGoal: 'Start saving',
    saved: 'Saved',
    of: (a) => 'of ' + a,
    statStreak: 'day streak 🔥',
    statDaysLeft: 'days left',
    statPenalties: 'penalties 💀',
    gridTitle: '🎲 Amount grid',
    gridProgress: (d, t) => `${d} of ${t} closed`,
    gridRandom: '🎲 Pick a random cell',
    gridClosed: (d) => 'Closed ' + d,
    dailyBtn: 'daily',
    depositBtn: '💰 Deposit today',
    depositAmountBtn: (a) => `💰 Deposit ${a}`,
    depositPickCell: '💰 Pick a cell from the grid',
    depositDone: "✅ Today's deposit is done. You're safe until midnight.",
    depositPh: (a) => 'Amount, e.g. ' + a,
    countdown: (h, m, s) => `Time until penalty: <b>${h}h ${m}m ${s}s</b>`,
    countdownDone: 'Next deposit — tomorrow',
    tabHome: 'Home', tabHistory: 'History', tabPenalties: 'Penalties', tabWithdraw: 'Withdraw',
    historyTitle: '📜 Operation history',
    opDeposit: '💰 Deposit', opPenalty: '💀 Penalty 10%', opWithdraw: '🏦 Withdrawal',
    opRevoke: '⚠️ Deletion payout (−50%)',
    opEmpty: 'No operations yet',
    penaltiesTitle: '💀 Penalty history',
    totalLost: 'Total lost:',
    penEmpty: 'No penalties. Keep it up! 🔥',
    penMissed: '💀 Missed day',
    penOwner: 'to the app owner',
    withdrawTitle: '🏦 Withdraw',
    withdrawLocked: 'Withdrawal is available <b>only after reaching your goal</b>.',
    withdrawRemaining: 'Left to save:',
    goalReached: 'Goal reached!',
    withdrawUnlockedText: 'You did it. Your entire balance is available.',
    withdrawUnlockedTextF: 'You did it. Your entire balance is available.',
    withdrawBtn: 'Withdraw',
    dangerZone: '⚠️ Danger zone',
    dangerText: 'Revoking consent deletes the account. The remainder is paid out with a 50% loss.',
    revokeBtn: 'Revoke consent and delete account',
    settingsTitle: '⚙️ Settings',
    langLabel: 'Язык / Language',
    consentLogTitle: 'Consent',
    consentLog: (d, ip, v) => `Consent accepted: <b>${d}</b><br>IP: ${ip}<br>Rules version: ${v}`,
    consentNone: 'No consent recorded',
    demoTitle: '🧪 Demo mode',
    demoText: 'Simulate the next day — to test the penalty logic.',
    simulateBtn: '⏭ Simulate next day',
    penaltyTitle: 'PENALTY!',
    penaltyOk: 'Accept the loss',
    missedSuffix: (n) => ` (missed days: ${n})`,
    revokeTitle: 'Revoke consent',
    revokeText1: 'The account will be deleted. You will receive',
    revokeText2: '(50% of balance',
    revokeType: 'To confirm, type:',
    revokeWord: 'DELETE',
    revokeConfirm: 'Delete account forever',
    successOk: 'Start over',
    bannerReached: '🏆 Goal reached! Grab your money on the Withdraw tab.',
    bannerSafe: (s) => `✅ You're safe today. Streak: ${s} 🔥`,
    toastEmailInvalid: 'Enter a valid email for demo mode',
    toastDemoIn: (e) => 'Demo sign-in: ' + e,
    toastSignedIn: (e) => 'Signed in: ' + e,
    toastFirebaseNA: 'Firebase unavailable — use demo mode',
    toastSignInFail: (c) => 'Google sign-in failed: ' + c,
    toastConsentSaved: 'Consent recorded. There is no way back.',
    toastDeclined: "A wise choice if you're not sure about yourself.",
    toastGoalHarsh: "Goal created. You're trapped now. Pay every day.",
    toastGoalSoft: 'Goal created! Start your streak today 🔥',
    toastPickCell: 'Pick a cell from the grid first',
    toastEnterAmount: 'Enter the deposit amount',
    toastNewDay: (d) => '⏭ A new day has come: ' + d,
    toastNotifStyle: (h) => 'Notification style: ' + (h ? 'harsh 😤' : 'motivating 🌤'),
    toastGender: (f) => (f ? "Got it — we'll talk to you as a girl 👩" : "Got it — we'll talk to you as a guy 👨"),
    successGoalTitle: (n) => `🎉 Goal "${n}" reached!`,
    successGoalMsg: (a) => `Withdrawn ${a}. You proved discipline beats laziness.`,
    accountDeleted: 'Account deleted',
    revokePaid: (a) => `Consent revoked. Paid out ${a} (50% withheld per the rules).`,
    toHome: 'Back to start',
  },
};

function t(key, ...args) {
  const v = I18N[lang()][key];
  return typeof v === 'function' ? v(...args) : v;
}

/* ---------- Фразы уведомлений (язык × стиль × пол) ---------- */

const NOTIF = {
  ru: {
    harsh: {
      deposit: (f) => [
        'Ладно, сегодня ' + (f ? 'выжила' : 'выжил') + '. Завтра посмотрим, на что ты способ' + (f ? 'на' : 'ен') + '.',
        'Взнос принят. Не расслабляйся — полночь всегда рядом.',
        'Молодец, что не слил' + (f ? 'ась' : 'ся') + '. Пока что.',
        'О, ты ещё в игре? Деньги принял. Свободн' + (f ? 'а' : '') + ' до завтра.',
        'Неплохо. Но один пропуск — и я заберу 10%. Помни об этом.',
        'Копишь? Правильно. Нищета не ждёт слабых решений.',
        'Сегодня зачёт. Но я слежу за тобой каждый день.',
        'Деньги в копилке. Хоть на что-то ты способ' + (f ? 'на' : 'ен') + '.',
        'Ещё день без позора. Продолжай, пока не надоело мне.',
      ],
      penalty: (f, a) => [
        `${f ? 'Слабачка' : 'Слабак'}. Ты пропустил${f ? 'а' : ''} день — штраф ${a} уже улетел владельцу приложения. Поздравляю с потерей.`,
        `Ты опять пропустил${f ? 'а' : ''}? ${a} твоих денег уже улетели владельцу. Ты серьёзно хочешь остаться ${f ? 'нищей' : 'нищим'}?`,
        `Минус ${a}. Дисциплина — не твоё? Тогда и деньги не твои.`,
        `${a} испарились. Владелец приложения передаёт спасибо. Может, хватит сливаться?`,
        `Проспал${f ? 'а' : ''}? Забыл${f ? 'а' : ''}? Неважно. ${a} уже не вернуть. НИКОГДА.`,
        `Очередной пропуск — очередные ${a} мимо. С такими темпами цель увидишь во сне.`,
      ],
      reminder: (f) => [
        'Ты опять тянешь? Пропустишь день — 10% твоих денег испарятся. Ты серьёзно хочешь остаться ' + (f ? 'нищей' : 'нищим') + '?',
        'Часики тикают. Полночь заберёт 10%, если не пополнишь. Решай.',
        'Не вижу взноса. Хочешь подарить владельцу ещё 10%? Смелый ход.',
        'Опять откладываешь? Штраф не откладывает. Никогда.',
        'Весь день впереди — и ноль взноса. Жду. И полночь тоже ждёт.',
        (f ? 'Готова' : 'Готов') + ' потерять 10% просто из-за лени? Тогда продолжай ничего не делать.',
      ],
      progress: (f, pct) => [
        `Всего ${pct}%. Копишь как черепаха. Шевелись.`,
        `${pct}%? И это всё, на что ты способ${f ? 'на' : 'ен'}?`,
        `${pct}%. До цели далеко, а до штрафа — одна ночь.`,
        `${pct}%. Медленно. Но хотя бы не ноль.`,
      ],
    },
    soft: {
      deposit: (f) => [
        'Ещё один день — и ты на шаг ближе. Горжусь тобой! 💚',
        'Отличная работа! Дисциплина — твоя суперсила 🔥',
        'Взнос сделан! Ты строишь своё будущее по кирпичику 🧱',
        'Есть! Сегодняшний шаг сделан — мечта стала ближе ✨',
        (f ? 'Ты умница! Серия продолжается, так держать 🌟' : 'Ты молодец! Серия продолжается, так держать 🌟'),
        'Каждый взнос — это подарок будущему себе. ' + (f ? 'Красавица! 💪' : 'Красавчик! 💪'),
        'День засчитан! Маленькие шаги создают большие результаты 🚀',
        'Вот это стабильность! Твоя копилка растёт на глазах 🌱',
        (f ? 'Героиня' : 'Герой') + ' дня — это ты. Увидимся завтра! 🏅',
      ],
      penalty: (f, a) => [
        `К сожалению, день был пропущен — списан штраф ${a}. Не сдавайся, начни новую серию сегодня! 🌱`,
        `Штраф ${a} 😔 Бывает. Главное — вернуться в строй прямо сейчас!`,
        `Потеря ${a} — это урок, а не приговор. Новая серия начинается с сегодняшнего взноса 💫`,
        `Минус ${a}, но твоя цель никуда не делась. Один взнос — и ты снова в игре! 🌤`,
      ],
      reminder: (f) => [
        'Не забудь про сегодняшний взнос! Ты слишком близко к мечте, чтобы терять деньги 💫',
        'Сегодняшний взнос — и ты ' + (f ? 'героиня' : 'герой') + ' 🔥 Не дай штрафу ни единого шанса!',
        'Твоя мечта ждёт! Один маленький взнос — и день засчитан 🌤',
        (f ? 'Ты справлялась раньше — справишься и сегодня. Пополни копилку! 💚' : 'Ты справлялся раньше — справишься и сегодня. Пополни копилку! 💚'),
        'Небольшой взнос сегодня — большая гордость завтра ✨',
        'Серия ждёт продолжения! Ты же не дашь ей оборваться? 🔥',
      ],
      progress: (f, pct) => [
        `Ты на ${pct}% ближе к мечте! Сегодняшний взнос — и ты ${f ? 'героиня' : 'герой'} 🔥`,
        `Уже ${pct}%! Ты делаешь это лучше, чем большинство 🚀`,
        `${pct}% пройдено. Каждый день — кирпичик твоего будущего 🧱`,
        `${pct}%! Продолжай в том же духе, и цель не устоит 💪`,
      ],
    },
  },
  en: {
    harsh: {
      deposit: (f) => [
        "Fine, you survived today. Let's see what you're made of tomorrow.",
        "Deposit accepted. Don't relax — midnight is always near.",
        "Good job not quitting. For now.",
        "Oh, you're still in the game? Money taken. Free until tomorrow.",
        "Not bad. But one miss — and I take 10%. Remember that.",
        "Saving? Correct. Poverty doesn't wait for weak decisions.",
        "Today counts. But I'm watching you every single day.",
        "Money's in. So you ARE capable of something.",
        "Another day without shame. Keep going before I get bored.",
      ],
      penalty: (f, a) => [
        `Weak. You missed a day — a ${a} penalty just flew to the app owner. Congrats on the loss.`,
        `You missed AGAIN? ${a} of your money is gone to the owner. Do you seriously want to stay broke?`,
        `Minus ${a}. Discipline isn't your thing? Then money isn't either.`,
        `${a} evaporated. The app owner says thanks. Maybe stop failing?`,
        `Overslept? Forgot? Doesn't matter. ${a} is gone. FOREVER.`,
        `Another miss — another ${a} down the drain. At this pace you'll see your goal only in dreams.`,
      ],
      reminder: (f) => [
        "Stalling again? Miss the day and 10% of your money evaporates. Do you seriously want to stay broke?",
        "Clock's ticking. Midnight takes 10% if you don't deposit. Decide.",
        "I don't see a deposit. Want to gift the owner another 10%? Bold move.",
        "Procrastinating again? The penalty never procrastinates. Ever.",
        "The whole day ahead — and zero deposit. I'm waiting. So is midnight.",
        "Ready to lose 10% out of pure laziness? Then keep doing nothing.",
      ],
      progress: (f, pct) => [
        `Only ${pct}%. Saving like a turtle. Move it.`,
        `${pct}%? That's ALL you've got?`,
        `${pct}%. The goal is far, but the penalty is one night away.`,
        `${pct}%. Slow. But at least not zero.`,
      ],
    },
    soft: {
      deposit: (f) => [
        "One more day — one step closer. Proud of you! 💚",
        "Great job! Discipline is your superpower 🔥",
        "Deposit done! You're building your future brick by brick 🧱",
        "Yes! Today's step is done — the dream got closer ✨",
        "You're amazing! The streak continues, keep it up 🌟",
        `Every deposit is a gift to your future self. ${f ? 'Queen! 💪' : 'Champ! 💪'}`,
        "Day counted! Small steps create big results 🚀",
        "Now that's consistency! Your piggy bank is growing fast 🌱",
        `${f ? 'Heroine' : 'Hero'} of the day — that's you. See you tomorrow! 🏅`,
      ],
      penalty: (f, a) => [
        `Unfortunately the day was missed — a ${a} penalty was deducted. Don't give up, start a new streak today! 🌱`,
        `Penalty ${a} 😔 It happens. What matters is getting back on track right now!`,
        `Losing ${a} is a lesson, not a verdict. A new streak starts with today's deposit 💫`,
        `Minus ${a}, but your goal is still there. One deposit — and you're back in the game! 🌤`,
      ],
      reminder: (f) => [
        "Don't forget today's deposit! You're too close to the dream to lose money 💫",
        `Today's deposit — and you're a ${f ? 'heroine' : 'hero'} 🔥 Don't give the penalty a single chance!`,
        "Your dream is waiting! One small deposit — and the day counts 🌤",
        "You've done it before — you'll do it today. Top up the piggy! 💚",
        "A small deposit today — big pride tomorrow ✨",
        "The streak wants to continue! You won't let it break, right? 🔥",
      ],
      progress: (f, pct) => [
        `You're ${pct}% closer to the dream! Today's deposit makes you a ${f ? 'heroine' : 'hero'} 🔥`,
        `Already ${pct}%! You're doing better than most 🚀`,
        `${pct}% done. Every day is a brick of your future 🧱`,
        `${pct}%! Keep it up and the goal doesn't stand a chance 💪`,
      ],
    },
  },
};

/* Хайповые события: рубежи прогресса и серии */
const MILESTONES = {
  ru: {
    progress: (f, pct) => ({
      25: `🚀 ЧЕТВЕРТЬ ПУТИ! ${pct}% в копилке. Машина, а не человек!`,
      50: `⚡ ЭКВАТОР! Половина цели твоя. Теперь отступать глупо.`,
      75: `🔥 75%! Финишная прямая. Цель уже видно невооружённым глазом!`,
      100: `👑 100%! ЦЕЛЬ ВЗЯТА! Ты ${f ? 'сделала' : 'сделал'} это!`,
    }[pct]),
    streak: (f, n) => `🔥 СЕРИЯ ${n}! ${n} дней подряд без единого пропуска. ${f ? 'Железная леди!' : 'Железная дисциплина!'}`,
  },
  en: {
    progress: (f, pct) => ({
      25: `🚀 QUARTER WAY! ${pct}% in the bank. A machine, not a human!`,
      50: `⚡ HALFWAY! Half the goal is yours. Quitting now would be dumb.`,
      75: `🔥 75%! Home stretch. The goal is in plain sight!`,
      100: `👑 100%! GOAL SMASHED! You did it!`,
    }[pct]),
    streak: (f, n) => `🔥 STREAK ${n}! ${n} days in a row without a single miss. Iron discipline!`,
  },
};

const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];

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

function toastImpact(text, harsh = false, ms = 6000) {
  const el = document.createElement('div');
  el.className = 'toast impact' + (harsh ? ' harsh' : '');
  el.textContent = text;
  $('toast-container').appendChild(el);
  if (navigator.vibrate) navigator.vibrate(harsh ? [90, 60, 90, 60, 180] : [50, 40, 50]);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Применение языка ---------- */

function applyI18n() {
  const L = lang();
  document.documentElement.lang = L;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = I18N[L][el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const v = I18N[L][el.dataset.i18nHtml];
    if (typeof v === 'string') el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const v = I18N[L][el.dataset.i18nPh];
    if (typeof v === 'string') el.placeholder = v;
  });
  document.querySelectorAll('.lang-chip, .lang-pick').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === L));
  document.querySelectorAll('.gender-pick').forEach((b) =>
    b.classList.toggle('active', b.dataset.gender === state.gender));
  $('mode-hint').textContent = t(goalMode === 'grid' ? 'modeHintGrid' : 'modeHintLinear');
  $('revoke-word').textContent = t('revokeWord');
  $('input-revoke').placeholder = t('revokeWord');
}

function setLang(L) {
  state.lang = L;
  save();
  applyI18n();
  // перерисовать активный экран с новым языком
  const active = SCREENS.find((s) => !$('screen-' + s).classList.contains('hidden'));
  if (['dashboard', 'history', 'penalties', 'withdraw'].includes(active)) openTab(active);
  if (active === 'settings') renderSettings();
  if (active === 'onboarding') setSlide(slideIdx);
  if (active === 'goal') validateGoalForm();
}

document.querySelectorAll('.lang-chip, .lang-pick').forEach((b) =>
  b.addEventListener('click', () => setLang(b.dataset.lang)));

/* ---------- Сетка сумм (челлендж) ---------- */

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
      pick(NOTIF[lang()][state.notifStyle].penalty(isF(), fmtMoney(totalPenalty))) +
      (missed.length > 1 ? t('missedSuffix', missed.length) : '');
    showModal('modal-penalty');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
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
  $('dash-target').textContent = t('of', fmtMoney(g.target));
  $('dash-streak').textContent = state.streak;
  $('dash-days-left').textContent = daysLeft;
  $('dash-penalties-total').textContent = fmtMoney(penaltiesTotal);

  const banner = $('dash-status-banner');
  banner.classList.remove('hidden', 'ok', 'warn', 'bad');
  if (state.balance >= g.target) {
    banner.classList.add('ok');
    banner.textContent = t('bannerReached');
  } else if (depositedToday) {
    banner.classList.add('ok');
    banner.textContent = t('bannerSafe', state.streak);
  } else {
    banner.classList.add(state.notifStyle === 'harsh' ? 'bad' : 'warn');
    banner.textContent = '⏰ ' + pickDaily(NOTIF[lang()][state.notifStyle].reminder(isF()));
  }

  $('deposit-done').classList.toggle('hidden', !depositedToday);
  $('input-deposit').placeholder = t('depositPh', Math.round(g.daily));

  const isGrid = g.mode === 'grid';
  const gridDone = isGrid && gridRemaining() === 0;
  $('grid-block').classList.toggle('hidden', !isGrid);
  $('deposit-input-row').classList.toggle('hidden', isGrid && !gridDone);
  if (isGrid) renderGrid(depositedToday, gridDone);
  updateDepositButton(depositedToday, isGrid, gridDone);

  clearInterval(countdownTimer);
  const tick = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ms = midnight - now;
    const h = Math.floor(ms / 3600000);
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    $('deposit-countdown').innerHTML = depositedToday ? t('countdownDone') : t('countdown', h, m, s);
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
    btn.textContent = t('depositBtn');
    return;
  }
  if (isGrid && !gridDone) {
    const cell = selectedCell != null ? state.goal.grid[selectedCell] : null;
    btn.disabled = !cell;
    btn.textContent = cell ? t('depositAmountBtn', fmtMoney(cell.amount)) : t('depositPickCell');
  } else {
    btn.disabled = false;
    btn.textContent = t('depositBtn');
  }
}

function renderGrid(depositedToday, gridDone) {
  const wrap = $('grid-cells');
  wrap.innerHTML = '';
  const g = state.goal;
  const total = g.grid.length;
  $('grid-progress').textContent = t('gridProgress', total - gridRemaining(), total);
  $('btn-grid-random').disabled = depositedToday || gridDone;
  g.grid.forEach((cell, idx) => {
    const el = document.createElement('button');
    el.className = 'cell' + (cell.done ? ' done' : '') + (idx === selectedCell ? ' selected' : '');
    el.textContent = cell.amount.toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-US');
    if (cell.done) el.title = t('gridClosed', cell.day ? fmtDay(cell.day) : '');
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
    list.innerHTML = `<li class="op-empty">${t('opEmpty')}</li>`;
    return;
  }
  const labels = {
    deposit: t('opDeposit'), penalty: t('opPenalty'),
    withdraw: t('opWithdraw'), revoke: t('opRevoke'),
  };
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
    list.innerHTML = `<li class="op-empty">${t('penEmpty')}</li>`;
    return;
  }
  pens.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'op-item penalty';
    li.innerHTML = `
      <div><div class="op-title">${t('penMissed')}</div><div class="op-date">${fmtDay(h.day)} · ${t('penOwner')}</div></div>
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
  document.querySelectorAll('.settings-gender').forEach((b) =>
    b.classList.toggle('active', b.dataset.gender === state.gender));
  document.querySelectorAll('.lang-pick').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === lang()));
  const c = state.consent;
  $('consent-log').innerHTML = c
    ? t('consentLog', new Date(c.date).toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-US'), c.ip, c.rulesVersion)
    : t('consentNone');
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
  $('btn-onboarding-next').textContent = t(i === 2 ? 'nextStart' : 'next');
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
    toast(t('toastEmailInvalid'), true);
    return;
  }
  state.email = email;
  save();
  toast(t('toastDemoIn', email));
  showScreen('consent');
}

$('btn-google-signin').addEventListener('click', async () => {
  if (!fbAuth) {
    toast(t('toastFirebaseNA'), true);
    return;
  }
  try {
    const result = await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    toast(t('toastSignedIn', result.user.email));
  } catch (e) {
    if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      console.warn('Google sign-in failed', e);
      toast(t('toastSignInFail', e.code || e.message), true);
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
  state.consent = { date: new Date().toISOString(), ip: '127.0.0.1 (демо)', rulesVersion: I18N.ru.rulesVersion };
  save();
  showModal('modal-confirm-consent', false);
  toast(t('toastConsentSaved'), true);
  showScreen('goal');
});

$('btn-consent-decline').addEventListener('click', () => {
  firebaseSignOutAndDelete(false);
  state = defaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  toast(t('toastDeclined'));
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
  if (goalMode === 'grid' && days > 0 && amount / days < 100) valid = false;
  $('btn-create-goal').disabled = !valid;
  if (amount > 0 && days > 0) {
    $('goal-daily-preview').classList.remove('hidden');
    $('goal-daily-amount').textContent = goalMode === 'grid'
      ? t('avgPerDay', fmtMoney(amount / days))
      : t('perDay', fmtMoney(amount / days));
  } else {
    $('goal-daily-preview').classList.add('hidden');
  }
}

['input-goal-name', 'input-goal-amount', 'input-goal-days'].forEach((id) =>
  $(id).addEventListener('input', validateGoalForm));

document.querySelectorAll('.pay-mode').forEach((btn) =>
  btn.addEventListener('click', () => {
    goalMode = btn.dataset.mode;
    document.querySelectorAll('.pay-mode').forEach((b) =>
      b.classList.toggle('active', b === btn));
    $('mode-hint').textContent = t(goalMode === 'grid' ? 'modeHintGrid' : 'modeHintLinear');
    validateGoalForm();
  }));

document.querySelectorAll('#screen-goal .notif-style').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.notifStyle = btn.dataset.style;
    document.querySelectorAll('#screen-goal .notif-style').forEach((b) =>
      b.classList.toggle('active', b === btn));
  }));

function setGender(g) {
  state.gender = g;
  save();
  document.querySelectorAll('.gender-pick').forEach((b) =>
    b.classList.toggle('active', b.dataset.gender === g));
}

document.querySelectorAll('.goal-gender').forEach((btn) =>
  btn.addEventListener('click', () => setGender(btn.dataset.gender)));

document.querySelectorAll('.settings-gender').forEach((btn) =>
  btn.addEventListener('click', () => {
    setGender(btn.dataset.gender);
    toast(t('toastGender', isF()));
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
  state.lastAccountedDay = today;
  state.lastDepositDay = null;
  save();
  toast(t(state.notifStyle === 'harsh' ? 'toastGoalHarsh' : 'toastGoalSoft'), state.notifStyle === 'harsh');
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
      toast(t('toastPickCell'), true);
      return;
    }
    amount = g.grid[selectedCell].amount;
    g.grid[selectedCell].done = true;
    g.grid[selectedCell].day = today;
    selectedCell = null;
  } else {
    amount = +$('input-deposit').value;
    if (!amount || amount <= 0) {
      toast(t('toastEnterAmount'), true);
      return;
    }
  }

  const pctBefore = Math.floor((state.balance / g.target) * 100);
  state.balance += amount;
  state.streak += 1;
  state.lastDepositDay = today;
  state.lastAccountedDay = today;
  state.history.unshift({ type: 'deposit', amount, day: today, ts: Date.now() });
  save();
  $('input-deposit').value = '';

  const L = lang();
  const harsh = state.notifStyle === 'harsh';
  const pctAfter = Math.min(100, Math.floor((state.balance / g.target) * 100));

  // хайповые события: рубеж прогресса или серии — иначе обычная фраза
  const crossed = [25, 50, 75, 100].find((m) => pctBefore < m && pctAfter >= m);
  if (crossed) {
    toastImpact(MILESTONES[L].progress(isF(), crossed), harsh);
  } else if (STREAK_MILESTONES.includes(state.streak)) {
    toastImpact(MILESTONES[L].streak(isF(), state.streak), harsh);
  } else {
    toast(pick(NOTIF[L][state.notifStyle].deposit(isF())), harsh);
    setTimeout(() => toast(pick(NOTIF[L][state.notifStyle].progress(isF(), pctAfter)), harsh), 1200);
  }
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
  $('success-title').textContent = t('successGoalTitle', state.goal.name);
  $('success-message').textContent = t('successGoalMsg', fmtMoney(amount), isF());
  $('btn-success-ok').textContent = t('successOk');
  showModal('modal-success');
});

$('btn-success-ok').addEventListener('click', () => {
  const email = state.email;
  const uid = state.uid;
  const consent = state.consent;
  const keep = { lang: state.lang, gender: state.gender, notifStyle: state.notifStyle };
  state = defaultState();
  Object.assign(state, keep, { email, uid, consent });
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
  $('btn-revoke-confirm').disabled = e.target.value.trim().toUpperCase() !== t('revokeWord');
});

$('btn-revoke-cancel').addEventListener('click', () => showModal('modal-revoke', false));

$('btn-revoke-confirm').addEventListener('click', () => {
  const payout = state.balance * (1 - REVOKE_RATE);
  showModal('modal-revoke', false);
  firebaseSignOutAndDelete(true);
  const paidMsg = t('revokePaid', fmtMoney(payout));
  state = defaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $('success-title').textContent = t('accountDeleted');
  $('success-message').textContent = paidMsg;
  $('btn-success-ok').textContent = t('toHome');
  showModal('modal-success');
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
    toast(t('toastNotifStyle', state.notifStyle === 'harsh'));
  }));

$('btn-simulate-day').addEventListener('click', () => {
  state.dayOffset = (state.dayOffset || 0) + 1;
  save();
  toast(t('toastNewDay', fmtDay(dayKey(appToday()))));
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
applyI18n();
route();
