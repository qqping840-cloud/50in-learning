/**
 * server.js — 本地服务
 * 职责：
 *   1. 托管静态文件（index.html / css / js / assets）
 *   2. POST /api/generate：代理 DeepSeek 生成文章
 *   3. GET/POST /api/config：读取/保存本地配置（API key 等）
 * 零依赖，Node 原生 http。
 */
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var ROOT = __dirname;
var PORT = 3000;

// ---------- 配置 ----------
var CONFIG_PATH = path.join(ROOT, 'config.json');
var EXAMPLE_PATH = path.join(ROOT, 'config.example.json');
var DEFAULT_CONFIG = {
  deepseekApiKey: '',
  model: 'deepseek-chat',
  port: 3000,
  temperature: 0.7,
  subtitleDir: path.join(ROOT, 'subs'),
  ttsVoice: 'ja-JP-NanamiNeural',
  duoToken: '',
  duoUserId: '',
  duoCourse: { learning: 'ja', from: 'zh' }
};

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // 首次运行：从 example 复制，或写入默认空模板
    if (fs.existsSync(EXAMPLE_PATH)) {
      fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
    } else {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    }
  }
}

function loadConfig() {
  ensureConfig();
  try {
    var cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Object.assign({}, DEFAULT_CONFIG, cfg);
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig(partial) {
  var cfg = Object.assign(loadConfig(), partial);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// ---------- 静态文件服务 ----------
var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, urlPath) {
  var filePath;
  if (urlPath === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  // 解码 URL 编码（支持中文/日文文件名）
  try { urlPath = decodeURIComponent(urlPath); } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath !== '/' && urlPath !== '/index.html' && !/^\/(css|js|assets)\//.test(urlPath)) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  if (urlPath.indexOf('\\') !== -1 || urlPath.split('/').indexOf('..') !== -1) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(ROOT, 'index.html');
  } else {
    filePath = path.join(ROOT, urlPath);
  }
  // 防路径穿越
  if (path.relative(ROOT, filePath).startsWith('..') || path.isAbsolute(path.relative(ROOT, filePath))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404); res.end('Not Found'); return;
    }
    var ext = path.extname(filePath).toLowerCase();
    var cacheControl = (urlPath.indexOf('/assets/lib/dict/') === 0)
      ? 'max-age=315360000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl
    });
    res.end(data);
  });
}

// ---------- DeepSeek 代理 ----------
function handleGenerate(req, res, body) {
  var cfg = loadConfig();
  var payload;
  try { payload = JSON.parse(body) || {}; } catch (e) { payload = {}; }

  var apiKey = payload.apiKey || cfg.deepseekApiKey;
  if (!apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NO_API_KEY', message: '请先配置 DeepSeek API Key' }));
    return;
  }

  // 结构化批注模式：产出 { title, sents:[{ja,zh,words:[{t,zh}]}] }
  if (payload.mode === 'gloss') {
    handleGloss(apiKey, cfg, payload, res);
    return;
  }

  var systemPrompt =
    '你是一名日语学习内容生成器。严格按照用户要求的难度、主题、篇幅和形式生成日语文章。\n' +
    '输出规范（必须严格遵守）：\n' +
    '1. 只输出文章正文，不要输出标题、不要输出"以下"等引导语、不要任何解释或额外说明。\n' +
    '2. 纯文本，不要使用 Markdown 标记（如 #、*、-、**）、不要 HTML 标签、不要代码块。\n' +
    '3. 正文用自然段落，句号结尾，不要空行分隔句子。\n' +
    '4. 只用日语假名和标点，不要夹杂英文单词、拼音或注释。\n' +
    '5. 如果用户要求"纯假名"，请尽量使用平假名书写，使文章适合假名初学者；若个别汉字难以避免，允许少量出现，系统会自动为汉字标注读音。';
  var userPrompt = buildPrompt(payload);

  callDeepSeek(apiKey, payload.model || cfg.model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], (typeof payload.temperature === 'number') ? payload.temperature : cfg.temperature,
  function (err, content) {
    if (err) {
      res.writeHead(err.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'DEEPSEEK_ERROR', status: err.status, message: err.message }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ content: content }));
  });
}

// 结构化批注：先让模型出 【正文 + 整句意译】，再由服务端把正文交给前端切词、回填词义
function handleGloss(apiKey, cfg, payload, res) {
  var model = payload.model || cfg.model;
  var userPrompt =
    buildPrompt(payload) +
    '\n\n请严格按系统给定的 JSON 结构输出：整篇正文切成若干完整句子，每句给出自然的中文意译。' +
    'words 字段先给空数组 []，后续会另行补全。';
  callDeepSeek(apiKey, model, [
    { role: 'system', content: GLOSS_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ], Math.min(payload.temperature == null ? 0.4 : payload.temperature, 0.6),
  function (err, content) {
    if (err) {
      res.writeHead(err.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'DEEPSEEK_ERROR', status: err.status, message: err.message }));
      return;
    }
    var obj = extractJson(content);
    if (!obj || !obj.sents || !obj.sents.length) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'BAD_GLOSS', message: '模型未返回有效的结构化批注' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ res: obj }));
  });
}

// 词义补全：前端把按 edge-tts 边界切好的词序列传上来
function handleGlossFill(req, res, body) {
  var cfg = loadConfig();
  var payload;
  try { payload = JSON.parse(body) || {}; } catch (e) { payload = {}; }
  var apiKey = payload.apiKey || cfg.deepseekApiKey;
  if (!apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NO_API_KEY', message: '请先配置 DeepSeek API Key' }));
    return;
  }
  if (!Array.isArray(payload.sents) || !payload.sents.length || payload.sents.some(function (s) {
    return !s || !Array.isArray(s.words) || s.words.some(function (w) { return !w || (typeof w !== 'string' && typeof w.t !== 'string'); });
  })) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NO_SENTS', message: '缺少 sents' }));
    return;
  }
  fillGlosses(apiKey, payload.model || cfg.model, payload.sents, function (err, sents, stats) {
    if (err) {
      logEvent('gloss_failed', { status: err.status || 502,
        reason: String(err.message || err).replace(/\s+/g, ' ').slice(0, 160) });
      res.writeHead(err.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'DEEPSEEK_ERROR', status: err.status, message: err.message }));
      return;
    }
    var filled = 0;
    sents.forEach(function (s) {
      (s.words || []).forEach(function (w) { if (w && w.zh) filled++; });
    });
    logEvent('gloss_filled', { words: filled, asked: stats.asked, cached: stats.cached });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sents: sents, partial: stats.asked > 0 && filled === 0 }));
  });
}

// 构建生成 prompt
function buildPrompt(p) {
  var parts = [];
  if (p.difficulty) parts.push('难度：' + p.difficulty);
  if (p.topic) parts.push('主题：' + p.topic);
  if (p.length) parts.push('篇幅：' + p.length);
  if (p.form) parts.push('形式：' + p.form);
  return '请生成一篇日语学习文章。要求：' + parts.join('，') + '。只输出文章正文。';
}

// ---------- 结构化批注（句级译文 + 词级词义） ----------
// 由 /api/generate?gloss=1 触发：要求 DeepSeek 只输出 JSON，服务端再让第二个模型翻一遍词义
var GLOSS_SYSTEM_PROMPT =
  '你是一名日语教学内容生成器，服务对象是【完全没学过日语的中文母语者】。\n' +
  '严格只输出一个 JSON 对象，不要输出 markdown 代码块、不要任何解释文字。\n' +
  'JSON 结构（严格遵守）：\n' +
  '{\n' +
  '  "title": "短标题（中文或日文皆可）",\n' +
  '  "sents": [\n' +
  '    {\n' +
  '      "ja": "完整的一整句日文（含标点，必须与正文逐字一致；标点不产生词边界，勿额外拆句）",\n' +
  '      "zh": "该句自然通顺的中文意译（不是直译，要像中文作品一样流畅）",\n' +
  '      "words": [\n' +
  '        { "t": "日文词（必须能在本句 ja 里原样找到）", "zh": "该词的中文词义" }\n' +
  '      ]\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  '硬性要求：\n' +
  '1. 把所有 sents[].ja 按顺序拼起来，必须与日文正文（去掉空白）完全一致，一个字都不能多或少。\n' +
  '2. words 覆盖该句所有词，按出现顺序排列；t 必须能在本句 ja 中找到。\n' +
  '3. 助词（は・が・を・に・で・へ・と・も・の 等）和纯语法词尾的 zh 留空字符串 ""。\n' +
  '4. 只对实词（名词/动词/形容词/副词等有独立意思的词）给出中文词义。\n' +
  '5. 词义是"词义"不是"译文"，例如 山→山、力持ち→大力士、投げ飛ばして→扔飞出去。';

// 让模型补全/校验已切分词的词义（第二遍，只输出 JSON）
var GLOSS_FILL_PROMPT =
  '下面是若干日文句子，以及每句里已切分好的词（句子就是该词的语境）。\n' +
  '请为每个词给出【结合它所在句子】的中文词义，面向零基础中文学习者；助词与纯语法词尾返回空字符串。\n' +
  '同一个词在不同句子里意思不同时，按各自句子的语境分别给，不要一律套词典里的第一义项。\n' +
  '只输出 JSON 对象，形如 {"glosses":[{"t":"输入里的词原文","zh":"中文词义"}, ...]}；\n' +
  '数组长度与顺序都要和输入词一致，t 必须原样照抄输入的词（用来核对，错位会串词义）。\n' +
  '输入：';

// 调 DeepSeek /chat/completions，返回解析后的 content 字符串
function callDeepSeek(apiKey, model, messages, temperature, cb) {
  var requestBody = JSON.stringify({
    model: model || 'deepseek-chat',
    messages: messages,
    temperature: (typeof temperature === 'number') ? temperature : 0.7,
    stream: false
  });
  var req2 = https.request({
    hostname: 'api.deepseek.com',
    port: 443,
    path: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(requestBody)
    }
  }, function (res2) {
    var chunks = [];
    res2.on('data', function (c) { chunks.push(c); });
    res2.on('end', function () {
      var out = Buffer.concat(chunks).toString('utf8');
      var status = res2.statusCode;
      if (status >= 200 && status < 300) {
        var content = '';
        try {
          var parsed = JSON.parse(out);
          if (parsed.choices && parsed.choices[0] && parsed.choices[0].message) {
            content = parsed.choices[0].message.content || '';
          }
        } catch (e) {}
        cb(null, content);
      } else {
        var errMsg = '请求失败';
        try {
          var pe = JSON.parse(out);
          if (pe.error && pe.error.message) errMsg = pe.error.message;
          else if (pe.message) errMsg = pe.message;
        } catch (e) {
          var text = (out || '').trim().split('\n')[0];
          if (text && text.length < 300) errMsg = text;
        }
        cb({ status: status, message: errMsg });
      }
    });
  });
  req2.on('error', function (e) { cb({ status: 502, message: e.message }); });
  req2.write(requestBody);
  req2.end();
}

// 从模型输出里稳健地抠出 JSON（容忍 ```json 包裹、前后废话）
function extractJson(s) {
  if (!s) return null;
  var t = String(s).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  var start = t.indexOf('{');
  var end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  t = t.slice(start, end + 1);
  try { return JSON.parse(t); } catch (e) { return null; }
}

// ---------- 词义缓存（服务端，跨浏览器/跨 origin 共用） ----------
// 键是「句 + 词」（词义取决于语境），存 cache/glosses.json；模型只用来补缺。
var GLOSS_CACHE_PATH = path.join(ROOT, 'cache', 'glosses.json');
var GLOSS_CACHE_MAX = 20000;
var glossCache = null;
var glossSkipUntil = 0;     // 模型刚失败就先别撞它的接口

function glossKey(line, word) { return word + '\u0001' + (line || ''); }

function loadGlossCache() {
  if (glossCache) return glossCache;
  glossCache = {};
  try {
    var obj = JSON.parse(fs.readFileSync(GLOSS_CACHE_PATH, 'utf8'));
    if (obj && typeof obj === 'object') glossCache = obj;
  } catch (e) {
    // 没有或读坏了：当成空缓存，不阻塞功能（坏文件保留，人工可查）
  }
  return glossCache;
}

function saveGlossCache() {
  var cache = loadGlossCache();
  var keys = Object.keys(cache);
  if (keys.length > GLOSS_CACHE_MAX) {
    keys.slice(0, keys.length - GLOSS_CACHE_MAX).forEach(function (k) { delete cache[k]; });
  }
  try {
    fs.mkdirSync(path.dirname(GLOSS_CACHE_PATH), { recursive: true });
    var tmp = GLOSS_CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    fs.renameSync(tmp, GLOSS_CACHE_PATH);   // 先写临时文件再改名，避免写一半坏掉
  } catch (e) {
    logEvent('gloss_cache_write_failed', { reason: (e && e.message ? e.message : String(e)).slice(0, 120) });
  }
}

// 分批问模型：一次不超过 200 个词，按句分组（句子就是语境）
function askGlosses(apiKey, model, groups, cb) {
  var result = {};
  var at = 0;
  var CHUNK = 200;

  function next() {
    if (at >= groups.length) { cb(null, result); return; }
    var batch = [], count = 0;
    while (at < groups.length) {
      var g = groups[at];
      if (count && count + g.words.length > CHUNK) break;
      batch.push(g);
      count += g.words.length;
      at++;
    }
    if (!count) { cb(null, result); return; }
    callDeepSeek(apiKey, model, [
      { role: 'system', content: '你只输出 JSON，不要任何解释。' },
      { role: 'user', content: GLOSS_FILL_PROMPT + JSON.stringify(batch) }
    ], 0.2, function (err, content) {
      if (err) { cb(err); return; }
      var obj = extractJson(content);
      var glosses = (obj && obj.glosses) || [];
      // 按「词原文」匹配，不按位置：模型偶尔会转置顺序或改条数（曾出现「まし → 赏月」）
      var byWord = {};
      glosses.forEach(function (g) {
        if (g && typeof g === 'object' && typeof g.t === 'string') {
          byWord[g.t] = String(g.zh == null ? '' : g.zh);
        }
      });
      if (glosses.length !== count) {
        logEvent('gloss_shape', { got: glosses.length, want: count, mode: 'byWord' });
      }
      batch.forEach(function (g) {
        var seen = {};
        (g.words || []).forEach(function (word) {
          if (seen[word]) return;
          seen[word] = true;
          // 只认模型明确回过的词：没回的留空、下次再问；回了空串（助词）就记成"已知为空"
          if (Object.prototype.hasOwnProperty.call(byWord, word)) {
            result[glossKey(g.ja || '', word)] = byWord[word];
          }
        });
      });
      next();
    });
  }
  next();
}

// 把 sents 里的词补上词义：先查服务端缓存，只把缺的送模型。
// 关键：必须把每句原文一起给模型，否则词义会脱离语境（用户反馈过这个问题）。
function fillGlosses(apiKey, model, sents, done) {
  var pairs = [];
  sents.forEach(function (s) {
    (s.words || []).forEach(function (w) {
      var text = (typeof w === 'string') ? w : (w.t || '');
      if (!text) return;
      pairs.push({ line: s.ja || '', text: text, w: w, zh: '' });
    });
  });
  if (!pairs.length) { done(null, sents, { asked: 0, cached: 0 }); return; }

  var cache = loadGlossCache();
  var missing = [];
  pairs.forEach(function (p) {
    var hit = cache[glossKey(p.line, p.text)];
    if (typeof hit === 'string') p.zh = hit;      // 含"已知为空"（助词）
    else missing.push(p);
  });

  var finish = function () {
    pairs.forEach(function (p) {
      if (typeof p.w === 'string') return;
      p.w.zh = p.zh || '';
    });
    done(null, sents, { asked: missing.length, cached: pairs.length - missing.length });
  };

  if (!missing.length) { finish(); return; }
  if (Date.now() < glossSkipUntil) { finish(); return; }

  var groups = [], byLine = {};
  missing.forEach(function (p) {
    var g = byLine[p.line];
    if (!g) { g = byLine[p.line] = { ja: p.line, words: [] }; groups.push(g); }
    g.words.push(p.text);
  });

  askGlosses(apiKey, model, groups, function (err, got) {
    if (err) {
      // 有缓存的部分照常返回，不整单失败；原因进日志，60 秒内不再撞模型
      glossSkipUntil = Date.now() + 60000;
      logEvent('gloss_failed', { status: err.status || 502,
        reason: String(err.message || err).replace(/\s+/g, ' ').slice(0, 160) });
      finish();
      return;
    }
    Object.keys(got).forEach(function (k) { cache[k] = got[k]; });
    saveGlossCache();
    pairs.forEach(function (p) {
      if (p.zh) return;
      var hit = cache[glossKey(p.line, p.text)];
      if (typeof hit === 'string' && hit) p.zh = hit;
    });
    finish();
  });
}

// ---------- 字幕成品库（读成果库目录，列已处理视频） ----------
// 只列「有字幕成品」的条目；视频可选。文件访问一律走这里扫出来的白名单，不接受客户端路径。
var VIDEO_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];
var LIB_SUFFIX = [
  ['.study.aligned.study.json', 'study_aligned'],
  ['.study.aligned.zh.srt', 'zh_aligned'],
  ['.study.aligned.srt', 'srt'],
  ['.study.json', 'study'],
  ['.zh.srt', 'zh'],
  ['.srt', 'srt'],
  ['.txt', 'text']
];

function libraryDir() {
  return loadConfig().subtitleDir || DEFAULT_CONFIG.subtitleDir;
}

function scanLibrary() {
  var dir = libraryDir();
  var map = {};
  var names;
  try { names = fs.readdirSync(dir); } catch (e) {
    logEvent('library_read_failed', { reason: e && e.code ? e.code : 'READ_FAILED' });
    return { dir: dir, items: [], error: 'READ_FAILED' };
  }
  names.forEach(function (name) {
    var full = path.join(dir, name);
    var st;
    try { st = fs.statSync(full); } catch (e) { return; }
    if (!st.isFile()) return;
    var ext = path.extname(name).toLowerCase();
    if (VIDEO_EXT.indexOf(ext) >= 0) {
      var vb = name.slice(0, -ext.length);
      (map[vb] = map[vb] || { files: {} }).files.media = { name: name, size: st.size, ext: ext };
      return;
    }
    for (var i = 0; i < LIB_SUFFIX.length; i++) {
      var suf = LIB_SUFFIX[i][0];
      if (name.length > suf.length && name.slice(-suf.length) === suf) {
        var base = name.slice(0, -suf.length);
        var e = map[base] = map[base] || { files: {} };
        e.files[LIB_SUFFIX[i][1]] = { name: name };
        return;
      }
    }
  });
  var items = Object.keys(map).filter(function (b) {
    var f = map[b].files;
    return !!(f.study_aligned || f.study || f.srt);
  }).map(function (b) {
    var f = map[b].files;
    return {
      id: encodeURIComponent(b),
      title: b,
      hasVideo: !!f.media,
      hasZh: !!(f.zh_aligned || f.zh),
      aligned: !!(f.study_aligned || f.zh_aligned),
      words: !!(f.study_aligned || f.study),
      sizeMB: f.media ? Math.round(f.media.size / 1048576) : 0
    };
  });
  items.sort(function (a, b) { return a.title.localeCompare(b.title); });
  return { dir: dir, items: items };
}

function libraryFile(id, kind) {
  var base;
  try { base = decodeURIComponent(id); } catch (e) { return null; }
  if (!base || base.indexOf('..') >= 0 || base.indexOf('/') >= 0 || base.indexOf('\\') >= 0) return null;
  var dir = libraryDir();
  var map = {};
  fs.readdirSync(dir).forEach(function (name) {
    if (name.slice(0, base.length) !== base) return;
    map[name] = true;
  });
  // 只允许「base + 已知后缀」的文件，杜绝任意路径
  var candidates = [];
  if (kind === 'media') {
    VIDEO_EXT.forEach(function (ext) { candidates.push(base + ext); });
  } else if (kind === 'study') {
    candidates = [base + '.study.aligned.study.json', base + '.study.json'];
  } else if (kind === 'zh') {
    candidates = [base + '.study.aligned.zh.srt', base + '.zh.srt'];
  } else if (kind === 'srt') {
    candidates = [base + '.study.aligned.srt', base + '.srt'];
  } else {
    return null;
  }
  for (var i = 0; i < candidates.length; i++) {
    if (map[candidates[i]]) {
      var full = path.join(dir, candidates[i]);
      if (full.indexOf(dir) === 0 && fs.existsSync(full)) return full;
    }
  }
  return null;
}

function handleLibraryList(req, res) {
  var data = scanLibrary();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function handleLibraryFile(req, res, id, kind) {
  var file = libraryFile(id, kind);
  if (!file) {
    logEvent('library_file_missing', { kind: kind });
    res.writeHead(404); res.end('Not Found'); return;
  }
  if (kind !== 'media') {
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  streamMedia(req, res, file);
}

// 视频要能拖动进度，必须支持 Range（否则浏览器得整段下完才能跳）
function streamMedia(req, res, file) {
  var stat;
  try { stat = fs.statSync(file); } catch (e) { res.writeHead(404); res.end('Not Found'); return; }
  var type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  var range = req.headers.range;
  var m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (m) {
    var start = m[1] ? parseInt(m[1], 10) : 0;
    var end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(start) || isNaN(end) || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
      res.end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file, { start: start, end: end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
}

// ---------- 本地诊断日志 ----------
// 白名单字段，只记事件与结果；不记路径、字幕正文、cookie。
// 点读合成会记下那个词（本地文件，不进 Git），否则「哪个词没合成出来」无法排查。
var LOG_DIR = path.join(ROOT, 'logs');
var LOG_PATH = path.join(LOG_DIR, 'app.jsonl');

function logEvent(event, fields) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    var rec = Object.assign({ time: new Date().toISOString(), event: event }, fields || {});
    fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n', 'utf8');
  } catch (e) {
    // 日志写不了不能影响功能，也不静默假装成功：在终端提示一次
    if (!logEvent.warned) {
      logEvent.warned = true;
      console.error('日志写入失败（功能不受影响）：' + (e && e.message ? e.message : e));
    }
  }
}

// ---------- 点读语音合成（Edge 神经语音 + 磁盘缓存） ----------
// 预生成的 mp3 只覆盖词库里有的词；视频页的点读是任意词，所以这里按需合成并缓存。
var TTS_CACHE_DIR = path.join(ROOT, 'assets', 'audio', 'tts');
var TTS_SCRIPT = path.join(ROOT, 'tools', 'tts_one.py');
var ttsJobs = {};

function handleTts(req, res, text) {
  text = String(text || '').trim();
  if (!text || text.length > 60 || /[\/\\]/.test(text) || text.indexOf('..') >= 0) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('文本为空、过长或含非法字符');
    return;
  }
  // 词库/假名的预生成音频优先（和前端 UI.speak 的查找顺序一致，避免重复合成）
  var presets = [
    path.join(ROOT, 'assets', 'audio', 'words', text + '.mp3'),
    path.join(ROOT, 'assets', 'audio', text + '.mp3')
  ];
  for (var i = 0; i < presets.length; i++) {
    if (fs.existsSync(presets[i])) { streamMedia(req, res, presets[i]); return; }
  }
  var cfg = loadConfig();
  var voice = cfg.ttsVoice || DEFAULT_CONFIG.ttsVoice;
  var hash = crypto.createHash('sha1').update(voice + '\n' + text).digest('hex');
  var file = path.join(TTS_CACHE_DIR, hash + '.mp3');
  if (fs.existsSync(file)) { streamMedia(req, res, file); return; }

  var job = ttsJobs[hash];
  if (!job) {
    try { fs.mkdirSync(TTS_CACHE_DIR, { recursive: true }); } catch (e) {}
    var startedAt = Date.now();
    job = new Promise(function (resolve, reject) {
      var tmp = file + '.part';
      var child = spawn('python', [TTS_SCRIPT, text, voice, tmp], { windowsHide: true });
      var errTail = '';
      var done = false;
      var finish = function () { done = true; clearTimeout(killTimer); };
      // 必须把子进程的输出读掉，否则管道写满会把子进程卡死（曾经的坑）
      child.stderr.on('data', function (c) { errTail = (errTail + String(c)).slice(-300); });
      child.stdout.on('data', function () {});
      // 兜底：再慢也不能超过 2 分钟，避免请求永远不返回
      var killTimer = setTimeout(function () { try { child.kill(); } catch (e) {} }, 120000);
      child.on('error', function (err) { if (!done) { finish(); reject(err); } });
      child.on('close', function (code) {
        if (done) return;
        finish();
        if (code === 0 && fs.existsSync(tmp)) {
          try { fs.renameSync(tmp, file); resolve(); } catch (e) { reject(e); }
        } else {
          try { fs.unlinkSync(tmp); } catch (e) {}
          reject(new Error('tts exit ' + code + (errTail ? ' / ' + errTail.replace(/\s+/g, ' ').slice(-160) : '')));
        }
      });
    });
    ttsJobs[hash] = job;
  }
  job.then(function () {
    delete ttsJobs[hash];
    logEvent('tts_synth', { word: text, voice: voice, ms: Date.now() - startedAt, ok: true });
    streamMedia(req, res, file);
  }, function (err) {
    delete ttsJobs[hash];
    logEvent('tts_failed', { word: text, ms: Date.now() - startedAt, ok: false,
      reason: (err && err.message ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 200) });
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('语音合成失败：' + (err && err.message ? err.message : err));
  });
}

// ---------- 多邻国单词同步 ----------
var duo = require('./duo-sync');
var duoBusy = false;

function handleDuoSync(req, res) {
  if (duoBusy) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '正在同步中，稍等一下' }));
    return;
  }
  duoBusy = true;
  var startedAt = Date.now();
  var steps = [];
  var cfg = loadConfig();
  duo.sync(cfg, function (step) { steps.push(step); })
    .then(function (r) {
      duoBusy = false;
      logEvent('duo_sync', { ok: true, total: r.total, withKanji: r.withKanji, audioNew: r.audioNew, ms: Date.now() - startedAt });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(Object.assign({ ok: true }, r)));
    }, function (err) {
      duoBusy = false;
      logEvent('duo_sync_failed', {
        ok: false, code: err.code || '', ms: Date.now() - startedAt,
        reason: (err && err.message ? err.message : String(err)).slice(0, 200)
      });
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
    });
}

function handleDuoStatus(req, res) {
  var cached = duo.readCached();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    busy: duoBusy,
    syncedAt: cached ? cached.syncedAt : null,
    total: cached ? cached.total : 0,
    withKanji: cached ? cached.withKanji : 0,
    configured: !!loadConfig().duoToken && !!loadConfig().duoUserId
  }));
}

// ---------- 配置接口 ----------
function handleConfigGet(req, res) {
  var cfg = loadConfig();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    hasKey: !!cfg.deepseekApiKey,
    model: cfg.model,
    port: cfg.port,
    temperature: cfg.temperature,
    subtitleDir: cfg.subtitleDir,
    ttsVoice: cfg.ttsVoice
  }));
}

function handleConfigPost(req, res, body) {
  var partial;
  try { partial = JSON.parse(body) || {}; } catch (e) { partial = {}; }
  // 只允许写入白名单字段
  var allowed = {};
  if (typeof partial.deepseekApiKey === 'string') allowed.deepseekApiKey = partial.deepseekApiKey;
  if (typeof partial.model === 'string') allowed.model = partial.model;
  if (typeof partial.port === 'number') allowed.port = partial.port;
  if (typeof partial.temperature === 'number') allowed.temperature = partial.temperature;
  if (typeof partial.subtitleDir === 'string') allowed.subtitleDir = partial.subtitleDir;
  if (typeof partial.ttsVoice === 'string') allowed.ttsVoice = partial.ttsVoice;
  if (typeof partial.duoToken === 'string') allowed.duoToken = partial.duoToken;
  if (typeof partial.duoUserId === 'string') allowed.duoUserId = partial.duoUserId;
  if (partial.duoCourse && typeof partial.duoCourse === 'object' &&
      typeof partial.duoCourse.learning === 'string' && typeof partial.duoCourse.from === 'string') {
    allowed.duoCourse = { learning: partial.duoCourse.learning, from: partial.duoCourse.from };
  }
  saveConfig(allowed);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, hasKey: !!loadConfig().deepseekApiKey }));
}

// ---------- 路由 ----------
var server = http.createServer(function (req, res) {
  var urlPath = req.url.split('?')[0];

  // 统一 origin：浏览器把 localhost 和 127.0.0.1 当成两个站点，localStorage 各存一份，
  // 用 127.0.0.1 打开会看到「进度清零」。直接跳到 localhost，保证只留一份数据。
  if (req.headers.host && req.headers.host.indexOf('127.0.0.1') === 0) {
    res.writeHead(301, { Location: 'http://localhost:' + (req.headers.host.split(':')[1] || PORT) + req.url });
    res.end();
    return;
  }

  if (req.method === 'POST') {
    var origin = req.headers.origin;
    if (origin && origin !== 'http://localhost:' + PORT && origin !== 'http://127.0.0.1:' + PORT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    req.setEncoding('utf8');
  }

  if (req.method === 'POST' && urlPath === '/api/generate') {
    var body1 = '';
    req.on('data', function (c) { body1 += c; });
    req.on('end', function () { handleGenerate(req, res, body1); });
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/gloss-fill') {
    var body3 = '';
    req.on('data', function (c) { body3 += c; });
    req.on('end', function () { handleGlossFill(req, res, body3); });
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/duo/sync') {
    handleDuoSync(req, res); return;
  }
  if (req.method === 'GET' && urlPath === '/api/duo/status') {
    handleDuoStatus(req, res); return;
  }
  if (req.method === 'GET' && urlPath === '/api/config') {
    handleConfigGet(req, res); return;
  }
  if (req.method === 'GET' && urlPath === '/api/library') {
    handleLibraryList(req, res); return;
  }
  if (req.method === 'GET' && urlPath === '/api/tts') {
    var q = req.url.slice(req.url.indexOf('?') + 1);
    var m = /(?:^|&)text=([^&]*)/.exec(q);
    var ttsText = '';
    try { ttsText = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; } catch (e) { ttsText = ''; }
    handleTts(req, res, ttsText); return;
  }
  var libMatch = req.method === 'GET' && /^\/api\/library\/([^/]+)\/(media|study|zh|srt)$/.exec(urlPath);
  if (libMatch) {
    handleLibraryFile(req, res, libMatch[1], libMatch[2]); return;
  }
  if (req.method === 'POST' && urlPath === '/api/config') {
    var body2 = '';
    req.on('data', function (c) { body2 += c; });
    req.on('end', function () { handleConfigPost(req, res, body2); });
    return;
  }
  serveStatic(req, res, urlPath);
});

ensureConfig();
var cfg = loadConfig();
PORT = cfg.port || 3000;
server.listen(PORT, '127.0.0.1', function () {
  console.log('50音学堂 已启动：http://localhost:' + PORT);
  console.log('按 Ctrl+C 停止服务');
  logEvent('server_started', { port: PORT });
});

// 任何未捕获的请求级异常都记一笔，避免「页面没反应但没有任何线索」
process.on('uncaughtException', function (err) {
  logEvent('server_error', { reason: (err && err.message ? err.message : String(err)).slice(0, 200) });
  console.error('服务器异常，已退出：' + (err && err.message ? err.message : err));
  process.exit(1);   // 例：端口被占用——退出，别留一个假活着的进程
});
