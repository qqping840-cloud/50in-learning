/**
 * bake_offline_tts.js — 只刷新 js/offline-data.js 里的朗读时间戳（window.OFFLINE.tts）
 *
 * 为什么单独一个：离线注音（furigana）很少变，而 assets/tts/lib-*.json 每次重跑
 * tools/gen_tts.py 都会重新生成。用 tools/bake_offline.js 整体重烘焙会连 400KB 注音
 * 一起重算；只想同步时间戳（file:// 下朗读高亮 / 逐句点读要对得上音频）时用这个。
 *
 * 用法：
 *     node tools/bake_offline_tts.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'offline-data.js');
const TTS_DIR = path.join(ROOT, 'assets', 'tts');
const HEAD = '/* 离线预生成数据：注音 + 朗读时间戳。用 tools/bake_offline.js 重新生成。 */\n';

const src = fs.readFileSync(OUT, 'utf8');
const m = /window\.OFFLINE\s*=\s*([\s\S]*?);\s*$/.exec(src);
if (!m) { console.error('解析失败（找不到 window.OFFLINE）：' + OUT); process.exit(1); }

const data = JSON.parse(m[1]);
data.tts = {};
let n = 0;
fs.readdirSync(TTS_DIR).filter(f => /^lib-\d+\.json$/.test(f)).forEach(f => {
  const idx = f.slice(4, -5);
  data.tts[idx] = JSON.parse(fs.readFileSync(path.join(TTS_DIR, f), 'utf8'));
  n++;
});

fs.writeFileSync(OUT, HEAD + 'window.OFFLINE = ' + JSON.stringify(data) + ';\n', 'utf8');
console.log('已刷新朗读时间戳：' + n + ' 篇 →', OUT);
