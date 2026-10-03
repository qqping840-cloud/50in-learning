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

var ROOT = __dirname;
var PORT = 3000;

// ---------- 配置 ----------
var CONFIG_PATH = path.join(ROOT, 'config.json');
var EXAMPLE_PATH = path.join(ROOT, 'config.example.json');
var DEFAULT_CONFIG = {
  deepseekApiKey: '',
  model: 'deepseek-chat',
  port: 3000,
  temperature: 0.7
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
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, urlPath) {
  var filePath;
  // 解码 URL 编码（支持中文/日文文件名）
  try { urlPath = decodeURIComponent(urlPath); } catch (e) {}
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(ROOT, 'index.html');
  } else {
    filePath = path.join(ROOT, urlPath);
  }
  // 防路径穿越
  if (filePath.indexOf(ROOT) !== 0) {
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
  try { payload = JSON.parse(body); } catch (e) { payload = {}; }

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
  try { payload = JSON.parse(body); } catch (e) { payload = {}; }
  var apiKey = payload.apiKey || cfg.deepseekApiKey;
  if (!apiKey) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NO_API_KEY', message: '请先配置 DeepSeek API Key' }));
    return;
  }
  if (!payload.sents || !payload.sents.length) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'NO_SENTS', message: '缺少 sents' }));
    return;
  }
  fillGlosses(apiKey, payload.model || cfg.model, payload.sents, function (err, sents) {
    if (err) {
      res.writeHead(err.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'DEEPSEEK_ERROR', status: err.status, message: err.message }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sents: sents }));
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
  '下面是若干日文词（来自一篇浅显日语文章，已切分）和它们的词性上下文。\n' +
  '请为每个词给出【面向零基础中文学习者】的中文词义；助词与纯语法词尾返回空字符串。\n' +
  '只输出 JSON 对象，形如 {"glosses":["词义1","词义2",...]}，数组长度必须与输入词数一致，顺序一致。\n' +
  '输入词：';

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

// 把已切分好词序列的 sents 补全词义（词序列由前端按 edge-tts 边界切好传上来）
function fillGlosses(apiKey, model, sents, done) {
  var words = [];
  sents.forEach(function (s) {
    (s.words || []).forEach(function (w) { words.push(w.t || w); });
  });
  if (!words.length) { done(null, sents); return; }
  var prompt = GLOSS_FILL_PROMPT + JSON.stringify(words);
  callDeepSeek(apiKey, model, [
    { role: 'system', content: '你只输出 JSON，不要任何解释。' },
    { role: 'user', content: prompt }
  ], 0.2, function (err, content) {
    if (err) { done(err); return; }
    var obj = extractJson(content);
    var glosses = (obj && obj.glosses) || [];
    var k = 0;
    sents.forEach(function (s) {
      (s.words || []).forEach(function (w) {
        var g = glosses[k++];
        if (typeof g === 'string') w.zh = g;
        else if (w.zh == null) w.zh = '';
      });
    });
    done(null, sents);
  });
}

// ---------- 配置接口 ----------
function handleConfigGet(req, res) {
  var cfg = loadConfig();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    hasKey: !!cfg.deepseekApiKey,
    model: cfg.model,
    port: cfg.port,
    temperature: cfg.temperature
  }));
}

function handleConfigPost(req, res, body) {
  var partial;
  try { partial = JSON.parse(body); } catch (e) { partial = {}; }
  // 只允许写入白名单字段
  var allowed = {};
  if (typeof partial.deepseekApiKey === 'string') allowed.deepseekApiKey = partial.deepseekApiKey;
  if (typeof partial.model === 'string') allowed.model = partial.model;
  if (typeof partial.port === 'number') allowed.port = partial.port;
  if (typeof partial.temperature === 'number') allowed.temperature = partial.temperature;
  saveConfig(allowed);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, hasKey: !!loadConfig().deepseekApiKey }));
}

// ---------- 路由 ----------
var server = http.createServer(function (req, res) {
  var urlPath = req.url.split('?')[0];

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
  if (req.method === 'GET' && urlPath === '/api/config') {
    handleConfigGet(req, res); return;
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
server.listen(PORT, function () {
  console.log('50音学堂 已启动：http://localhost:' + PORT);
  console.log('按 Ctrl+C 停止服务');
});
