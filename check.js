const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'https://ticket.tickebo.jp/show/event.html?info=15070';
const TARGET_DATES = ['7/11', '7/12'];
const STATUSES = ['出品待ち', '出品中', '受付中', '受付前', '受付終了', '販売終了', '予定枚数終了'];
const STATE_FILE = 'state.json';
const TOPIC = process.env.NTFY_TOPIC;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null; // 初回
  }
}

async function notify(title, message, priority = 5) {
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: TOPIC,
      title,
      message,
      priority,
      click: URL,
    }),
  });
  console.log('notify:', title, res.status);
}

function detectStatus(text) {
  for (const s of STATUSES) {
    if (text.includes(s)) return s;
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
    await page.waitForTimeout(5000); // 描画待ち

    const texts = await page.$$eval('li', (els) =>
      els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim())
    );

    const current = {};
    for (const date of TARGET_DATES) {
      const matches = texts.filter(
        (t) => t.includes(date) && t.includes('ガーデンシアター')
      );
      if (matches.length === 0) {
        current[date] = 'NOT_FOUND';
        continue;
      }
      // 最も内側(短い)の要素を採用
      const row = matches.sort((a, b) => a.length - b.length)[0];
      current[date] = detectStatus(row);
      console.log(date, '→', current[date]);
    }

    const prev = loadState();

    if (prev === null) {
      // 初回: 動作確認を兼ねて通知
      await notify(
        '監視を開始しました',
        TARGET_DATES.map((d) => `${d}: ${current[d]}`).join('\n'),
        3
      );
    } else {
      for (const date of TARGET_DATES) {
        const before = prev[date];
        const now = current[date];
        if (now === 'NOT_FOUND' || now === 'UNKNOWN') continue; // 取得失敗時は騒がない
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
