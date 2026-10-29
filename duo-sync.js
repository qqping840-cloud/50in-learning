/**
 * duo-sync.js — 把多邻国的已学单词拉到本地（供「单词」页的多邻国词表使用）
 *
 * 流程：读多邻国用户当前课程进度 → 拿已学词表 → 下载发音 → 补常用汉字形 → 写 JSON
 * 只用 Node 原生模块，和 server.js 一样零依赖。
 *
 * 汉字形的规则（用户 2026/10 定）：
 *   1. 已经是汉字形的词，跳过
 *   2. N5 词表里有这个词，用词表里的汉字形（中文释义优先匹配多的那一条）
 *   3. 否则查 JMdict（只取常用词条、常用汉字形、排除助词/代词/叹词这类），唯一候选才用
 *   4. 有多个候选（比如 はし = 橋/箸/端）就**不猜**，留空——宁可没有，也不给错的
 */
var https = require('https');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var vm = require('vm');

var ROOT = __dirname;
var DATA_DIR = path.join(ROOT, 'assets', 'data');
var AUDIO_DIR = path.join(ROOT, 'assets', 'audio', 'duo');
var KANJI_MAP = path.join(DATA_DIR, 'kana-kanji.json');
var OUT_FILE = path.join(DATA_DIR, 'duolingo-words.json');

var BAD_KANJI_PREFIX = /^[〜~]/;

function hasKanji(s) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) return true;
  }
  return false;
}

// 中文释义相似度：共用字符越多越像（用来在多条同音词里挑对的那条）
function zhScore(a, b) {
  var set = {};
  for (var i = 0; i < b.length; i++) set[b[i]] = 1;
  var n = 0;
  for (var j = 0; j < a.length; j++) if (set[a[j]]) n++;
  return n;
}

// ---------- N5 词表（复用前端那份 js/n5-wordbook.js） ----------
var n5Cache = null;
function loadN5() {
  if (n5Cache) return n5Cache;
  n5Cache = {};
  try {
    var code = fs.readFileSync(path.join(ROOT, 'js', 'n5-wordbook.js'), 'utf8');
    var sandbox = { window: { WORDBOOKS: [] } };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    (sandbox.window.WORDBOOKS || []).forEach(function (book) {
      (book.words || []).forEach(function (w) {
        if (!w || !w.kana) return;
        (n5Cache[w.kana] = n5Cache[w.kana] || []).push(w);
      });
    });
  } catch (e) {
    // 词表读不了不影响主流程，退回纯 JMdict 判断
    console.error('N5 词表加载失败（汉字形将只用 JMdict 判断）：' + e.message);
  }
  return n5Cache;
}

var mapCache = null;
function loadKanjiMap() {
  if (mapCache) return mapCache;
  try {
    mapCache = JSON.parse(fs.readFileSync(KANJI_MAP, 'utf8'));
  } catch (e) {
    mapCache = {};
  }
  return mapCache;
}

var IDAN = { 'う': 'い', 'く': 'き', 'ぐ': 'ぎ', 'す': 'し', 'つ': 'ち', 'ぬ': 'に', 'ぶ': 'び', 'む': 'み', 'る': 'り' };

// 这些词现代日语基本只写假名，套上汉字形反而是错的（指示词/寒暄语）
var KANA_ONLY = ['ここ', 'そこ', 'あそこ', 'どこ', 'これ', 'それ', 'あれ', 'どれ',
  'この', 'その', 'あの', 'どの', 'こんな', 'そんな', 'あんな', 'どんな',
  'こんにちは', 'こんばんは', 'ありがとう', 'すみません', 'ごめんなさい', 'おはよう', 'はじめまして'];

// たべます → 食べます：查 食べる / 飲む 这类辞书形再还原成 ます 形
function masuForm(kana, map) {
  if (kana.slice(-2) !== 'ます') return '';
  var stem = kana.slice(0, -2);
  var hits = {};
  var c = map[stem + 'る'];
  if (c && c.length && c[0].slice(-1) === 'る') hits[c[0].slice(0, -1) + 'ます'] = 1;
  Object.keys(IDAN).forEach(function (d) {
    if (d === 'る') return;   // る 段已经按一段动词处理过，别再算一遍五段
    var cc = map[stem + d];
    if (cc && cc.length && cc[0].slice(-1) === d) hits[cc[0].slice(0, -1) + IDAN[d] + 'ます'] = 1;
  });
  var list = Object.keys(hits);
  return list.length === 1 ? list[0] : '';
}

function resolveKanji(kana, zh) {
  if (hasKanji(kana)) return { kanji: '', why: 'already' };
  if (kana.length < 2 || KANA_ONLY.indexOf(kana) >= 0) return { kanji: '', why: 'kana-only' };
  var map = loadKanjiMap();
  var cands = map[kana] || [];
  var n5list = loadN5()[kana] || [];

  var n5best = null, n5bestScore = 0;
  n5list.forEach(function (w) {
    var k = (w.kanji || '').replace(BAD_KANJI_PREFIX, '');
    if (!k || !hasKanji(k)) return;
    // 中文释义要对得上才认，否则 とし（城市）会被套成「年」
    var s = zhScore(w.zh || '', zh || '');
    if (s === 0) return;
    if (n5best === null || s > n5bestScore) { n5best = k; n5bestScore = s; }
  });
  if (n5best) return { kanji: n5best, why: 'n5' };

  if (cands.length === 1) return { kanji: cands[0], why: 'jmdict' };
  if (cands.length > 1) return { kanji: '', why: 'ambiguous' };

  var masu = masuForm(kana, map);
  if (masu) return { kanji: masu, why: 'masu' };
  return { kanji: '', why: 'none' };
}

// ---------- HTTP ----------
function request(options, body) {
  return new Promise(function (resolve, reject) {
    var req = https.request(options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          var next = new URL(res.headers.location, options.hostname ? 'https://' + options.hostname : 'https://www.duolingo.com');
          request(Object.assign({}, options, { hostname: next.hostname, path: next.pathname + next.search }), body)
            .then(resolve, reject);
          return;
        }
        resolve({ status: res.statusCode, headers: res.headers, text: text });
      });
    });
    req.setTimeout(60000, function () { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function duoHeaders(token, isJson) {
  var h = {
    'Authorization': token,
    'Accept': 'application/json; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    // 短 UA 会被挡（403）；和浏览器一致最稳
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
  };
  if (isJson) h['Content-Type'] = 'application/json; charset=UTF-8';
  return h;
}

function getJson(pathname, token) {
  return request({ method: 'GET', hostname: 'www.duolingo.com', path: pathname, headers: duoHeaders(token) })
    .then(function (r) { return parse(r, pathname); });
}

function postJson(pathname, token, payload) {
  var body = JSON.stringify(payload);
  return request({
    method: 'POST', hostname: 'www.duolingo.com', path: pathname,
    headers: Object.assign(duoHeaders(token, true), { 'Content-Length': Buffer.byteLength(body) })
  }, body).then(function (r) { return parse(r, pathname); });
}

function parse(r, what) {
  if (r.status === 401 || r.status === 403) {
    var err = new Error('多邻国拒绝访问（token 过期或不对），请重新获取 token');
    err.code = 'AUTH';
    throw err;
  }
  if (r.status !== 200) {
    var e2 = new Error('多邻国接口 ' + what + ' 返回 ' + r.status + '：' + r.text.slice(0, 120));
    e2.code = 'HTTP';
    throw e2;
  }
  try { return JSON.parse(r.text); } catch (e) {
    throw new Error('多邻国返回的不是 JSON：' + r.text.slice(0, 100));
  }
}

// ---------- 主流程 ----------
function coursePath(course) {
  return course.learning + '/' + course.from;
}

function buildProgress(courseData) {
  var flat = [];
  (courseData.skills || []).forEach(function (unit) {
    if (Array.isArray(unit)) unit.forEach(function (s) { if (s && s.id) flat.push(s); });
    else if (unit && unit.id) flat.push(unit);
  });
  return flat.filter(function (s) { return s.finishedLevels > 0 || s.finishedLessons > 0; })
    .map(function (s) {
      return { finishedLevels: s.finishedLevels || 0, finishedSessions: s.finishedLessons || 0, skillId: { id: s.id } };
    });
}

function downloadAudio(url, file, force) {
  return new Promise(function (resolve) {
    if (!url) return resolve(false);
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 500) return resolve(false);
    var u = new URL(url);
    var req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, function (res) {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      var tmp = file + '.part';
      var out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', function () {
        out.close(function () {
          try { fs.renameSync(tmp, file); resolve(true); } catch (e) { resolve(false); }
        });
      });
      out.on('error', function () { try { fs.unlinkSync(tmp); } catch (e) {} resolve(false); });
    });
    req.setTimeout(30000, function () { req.destroy(); resolve(false); });
    req.on('error', function () { resolve(false); });
  });
}

/**
 * @param {Object} cfg  { duoToken, duoUserId, duoCourse: { learning, from } }
 * @returns {Promise<Object>} 同步结果摘要
 */
async function sync(cfg, onProgress) {
  var token = String(cfg.duoToken || '').trim();
  var userId = String(cfg.duoUserId || '').trim();
  var course = cfg.duoCourse || { learning: 'ja', from: 'zh' };
  if (!token || !userId) {
    var e = new Error('还没配置多邻国账号（config.json 里的 duoToken / duoUserId）');
    e.code = 'CONFIG';
    throw e;
  }
  if (token.indexOf('Bearer ') !== 0) token = 'Bearer ' + token;
  var step = onProgress || function () {};

  step('读取多邻国进度');
  var user = await getJson('/2023-05-23/users/' + encodeURIComponent(userId) + '?fields=currentCourse', token);
  var current = user.currentCourse;
  if (!current) throw new Error('多邻国没有返回当前课程，可能是账号换了课程');
  var progressed = buildProgress(current);
  if (!progressed.length) throw new Error('多邻国进度是空的（还没学过任何单元？）');

  step('拉取已学单词（' + progressed.length + ' 个单元）');
  var words = [], startIndex = 0, guard = 0;
  var cpath = '/2017-06-30/users/' + encodeURIComponent(userId) + '/courses/' + coursePath(course) + '/learned-lexemes';
  while (guard++ < 20) {
    var page = await postJson(cpath, token, { progressedSkills: progressed, startIndex: startIndex });
    var batch = page.learnedLexemes || [];
    words = words.concat(batch);
    var next = page.pagination && page.pagination.nextStartIndex;
    if (!batch.length || next === null || next === undefined || next === startIndex) break;
    startIndex = next;
  }
  if (!words.length) throw new Error('多邻国返回 0 个词（进度可能没同步）');

  step('下载发音');
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  // 上一轮同步记下的远端地址：同一个词如果换了录音，地址会变，就重下
  var prevSrc = {};
  try {
    var cached = readCached();
    (cached && cached.words || []).forEach(function (x) { if (x.src) prevSrc[x.w] = x.src; });
  } catch (e) {}
  var audioGot = 0, audioHave = 0;
  var items = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var text = String(w.text || '').trim();
    if (!text) continue;
    var file = crypto.createHash('sha1').update(text).digest('hex') + '.mp3';
    var full = path.join(AUDIO_DIR, file);
    var existed = fs.existsSync(full) && fs.statSync(full).size > 500;
    var changed = !!prevSrc[text] && prevSrc[text] !== w.audioURL;
    var ok = await downloadAudio(w.audioURL, full, changed);
    if (ok) audioGot++; else if (existed) audioHave++;
    var zh = (w.translations || []).join('；');
    var kr = resolveKanji(text, zh);
    items.push({
      w: text,
      zh: zh,
      kanji: kr.kanji || '',
      audio: (ok || existed) ? 'assets/audio/duo/' + file : '',
      src: w.audioURL || '',
      why: kr.why
    });
    if (i % 20 === 0) step('处理单词 ' + (i + 1) + '/' + words.length);
  }

  var out = {
    syncedAt: new Date().toISOString(),
    course: coursePath(course),
    total: items.length,
    withKanji: items.filter(function (x) { return x.kanji; }).length,
    words: items
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out), 'utf8');
  return { total: out.total, withKanji: out.withKanji, audioNew: audioGot, audioCached: audioHave, syncedAt: out.syncedAt };
}

function readCached() {
  try { return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch (e) { return null; }
}

module.exports = { sync: sync, readCached: readCached, resolveKanji: resolveKanji, masuForm: masuForm, OUTPUT: OUT_FILE };
