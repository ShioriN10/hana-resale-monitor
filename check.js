const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'https://ticket.tickebo.jp/show/event.html?info=15070';
const TARGET_DATES = ['7/11', '7/12'];
const STATUSES = ['出品中', '出品待ち', '受付中', '受付前', '受付終了', '販売終了', '予定枚数終了'];
const STATE_FILE = 'state.json';
const TOPIC = process.env.NTFY_TOPIC;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function notify(title, message, priority = 5) {
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: TOPIC, title, message, priority, click: URL }),
  });
  console.log('notify:', title, res.status);
}

function statusAfterDate(fullText, date) {
  const idx = fullText.indexOf(date);
  if (idx === -1) return 'NOT_FOUND';
  const window = fullText.slice(idx, idx + 200);
  for (const s of STATUSES) {
    if (window.includes(s)) return s;
  }
  return 'UNKNOWN';
}

(async () => {
  if (!TOPIC) {
    console.error('NTFY_TOPIC が設定されていません');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    const fullText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    const current = {};
    for (const date of TARGET_DATES) {
      current[date] = statusAfterDate(fullText, date);
      console.log(date, '→', current[date]);
    }

    const prev = loadState();

    if (prev === null) {
      await notify(
        '監視を開始しました',
        TARGET_DATES.map((d) => `${d}: ${current[d]}`).join('\n'),
        3
      );
    } else {
      for (const date of TARGET_DATES) {
        const before = prev[date];
        const now = current[date];
        if (now === 'NOT_FOUND' || now === 'UNKNOWN') continue;
        if (before !== now) {
          const isOpen = now === '出品中' || now === '受付中';
          await notify(
            isOpen ? `🚨 ${date} リセール出品きた！` : `${date} ステータス変化`,
            `${before} → ${now}\n今すぐ開いて！`,
            isOpen ? 5 : 3
          );
        }
      }
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(current, null, 2));
  } finally {
    await browser.close();
  }
})();
