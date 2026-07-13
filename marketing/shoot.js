/* Генератор маркетинговых скриншотов «Строгой Копилки» (headless Chrome) */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const URL = 'http://localhost:8123';
const OUT = __dirname;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function dk(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// богатое состояние: сетка 90 ячеек на 900 000, 8 взносов, 1 штраф, серия 6
function richState(overrides = {}) {
  const grid = [];
  let sum = 0;
  for (let i = 0; i < 90; i++) {
    const a = Math.max(100, Math.round((3000 + Math.random() * 17000) / 100) * 100);
    grid.push({ amount: a, done: false, day: null });
    sum += a;
  }
  grid[89].amount += 900000 - sum;
  if (grid[89].amount < 100) grid[89].amount = 100;

  const history = [];
  let done = 0;
  for (let d = -9; d <= -1; d++) {
    if (d === -7) {
      history.unshift({ type: 'penalty', amount: 14200, day: dk(d), ts: Date.now() });
      continue;
    }
    const cell = grid[done];
    cell.done = true;
    cell.day = dk(d);
    done++;
    history.unshift({ type: 'deposit', amount: cell.amount, day: dk(d), ts: Date.now() });
  }

  const iso = new Date().toISOString();
  return {
    email: 'aidos.k@gmail.com',
    uid: null,
    consent: { date: iso, ip: 'web-client', rulesVersion: '1.0 от 01.07.2026' },
    goal: { name: 'MacBook Pro', target: 900000, days: 90, daily: 10000, createdDay: dk(-9), mode: 'grid', grid },
    balance: 318400,
    streak: 6,
    lastAccountedDay: dk(-1),
    lastDepositDay: dk(-1),
    dayOffset: 0,
    notifStyle: 'harsh',
    gender: 'm',
    lang: 'ru',
    theme: 'dark',
    sound: true,
    achievements: {
      first_deposit: iso, big_deposit: iso, pct25: iso, comeback: iso, streak7: iso,
    },
    duel: null,
    recent: {},
    history,
    ...overrides,
  };
}

async function shot(page, state, file, actions) {
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate((s) => {
    if (s) localStorage.setItem('strictpiggy_v1', JSON.stringify(s));
    else localStorage.removeItem('strictpiggy_v1');
  }, state);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  if (actions) await actions(page);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('OK', file);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 930, deviceScaleFactor: 2 });

  // 1. Онбординг с логотипом
  await shot(page, null, '01-onboarding.png');

  // 2. Экран согласия
  await shot(page, { email: 'aidos.k@gmail.com' }, '02-consent.png');

  // 3. Создание цели (заполненная форма, режим сетки)
  await shot(page, richState({ goal: null, history: [], balance: 0, streak: 0 }), '03-goal.png', async (p) => {
    await p.evaluate(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input-goal-name', 'MacBook Pro');
      set('input-goal-amount', '900000');
      set('input-goal-days', '90');
      document.querySelector('.pay-mode[data-mode="grid"]').click();
    });
  });

  // 4. Дашборд: сетка, календарь, жёсткий баннер, серия
  await shot(page, richState(), '04-dashboard-grid.png');

  // 5. Модалка штрафа
  await shot(page, richState({ lastAccountedDay: dk(-3), lastDepositDay: dk(-3) }), '05-penalty.png');

  // 6. Награды
  await shot(page, richState(), '06-awards.png', async (p) => {
    await p.evaluate(() => document.querySelector('#screen-dashboard [data-tab="awards"]').click());
  });

  // 7. Светлая тема
  await shot(page, richState({ theme: 'light', notifStyle: 'soft' }), '07-dashboard-light.png');

  // 8. Английская версия
  await shot(page, richState({ lang: 'en' }), '08-dashboard-en.png');

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
