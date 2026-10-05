/**
 * bake_offline.js — 离线预生成：注音 + 朗读时间戳

目的：让「双击 index.html」也能用（不启动服务）。
浏览器在 file:// 下不能读词典/发 fetch，所以把内置文章和单词本例句的
注音结果、朗读词级时间戳预先算好，写进 js/offline-data.js。

用法（需要先启动服务，脚本会驱动一个无头浏览器去算）：
    node tools/bake_offline.js

前置：npm i -D playwright  （或用已装的 playwright）
加了新文章 / 新单词后，重跑本脚本即可。

注意：本脚本通过 Playwright 打开本地服务页面，调用 window.Reading.annotate
（强制走 kuroshiro），保证与网页里渲染结果完全一致，避免重复实现注音逻辑。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'offline-data.js');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('需要 playwright：npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const ready = await page.evaluate(() => window.Reading && window.Reading.initKuroshiro());
  if (!ready) { await browser.close(); console.error('kuroshiro 未就绪，检查服务与词典'); process.exit(1); }

  const data = await page.evaluate(async () => {
    const texts = new Set();
    (window.LIBRARY || []).forEach(x => { if (x.text) texts.add(x.text); });
    (window.WORDBOOKS || []).forEach(b => (b.words || []).forEach(w => { if (w.ex && w.ex.ja) texts.add(w.ex.ja); }));

    const furigana = {};
    for (const t of texts) {
      const html = await window.Reading.annotate(t);
      if (html) furigana[t] = html;
    }
    const tts = {};
    for (let i = 0; i < (window.LIBRARY || []).length; i++) {
      try { const r = await fetch('assets/tts/lib-' + i + '.json'); if (r.ok) tts[i] = await r.json(); } catch (e) {}
    }
    let exManifest = {};
    try { const r = await fetch('assets/audio/ex/manifest.json'); if (r.ok) exManifest = await r.json(); } catch (e) {}
    const exTiming = {};
    for (const k in exManifest) {
      const n = exManifest[k];
      try { const r = await fetch('assets/audio/ex/ex-' + n + '.json'); if (r.ok) exTiming[n] = await r.json(); } catch (e) {}
    }
    return { furigana, tts, exManifest, exTiming };
  });

  await browser.close();

  const js = '/* 离线预生成数据：注音 + 朗读时间戳。用 tools/bake_offline.js 重新生成。 */\n' +
             'window.OFFLINE = ' + JSON.stringify(data) + ';\n';
  fs.writeFileSync(OUT, js, 'utf8');
  console.log('已写入', OUT);
  console.log('文本', Object.keys(data.furigana).length,
              '| 文章朗读', Object.keys(data.tts).length,
              '| 例句朗读', Object.keys(data.exTiming).length,
              '|', (js.length / 1024).toFixed(0), 'KB');
}

main().catch(e => { console.error(e); process.exit(1); });
