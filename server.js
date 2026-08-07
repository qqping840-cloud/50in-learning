/**
 * server.js — 本地服务
 * 职责：
 *   1. 托管静态文件（index.html / css / js / assets）
 *   2. POST /api/generate：代理 DeepSeek 生成文章
 *   3. GET/POST /api/config：读取/保存本地配置（API key 等）
 * 零依赖，Node 原生 http。
 */
var http = require('http');
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

  var systemPrompt =
    '你是一名日语学习内容生成器。严格按照用户要求的难度、主题、篇幅和形式生成日语文章。\n' +
    '输出规范（必须严格遵守）：\n' +
    '1. 只输出文章正文，不要输出标题、不要输出"以下"等引导语、不要任何解释或额外说明。\n' +
    '2. 纯文本，不要使用 Markdown 标记（如 #、*、-、**）、不要 HTML 标签、不要代码块。\n' +
    '3. 正文用自然段落，句号结尾，不要空行分隔句子。\n' +
    '4. 只用日语假名和标点，不要夹杂英文单词、拼音或注释。\n' +
    '5. 如果用户要求"纯假名"，则文章不得出现任何汉字，全部用平假名书写。';
  var userPrompt = buildPrompt(payload);

  var requestBody = JSON.stringify({
    model: payload.model || cfg.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: (typeof payload.temperature === 'number') ? payload.temperature : cfg.temperature,
    stream: false
  });

  var req2 = http.request({
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
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out);
    });
  });
  req2.on('error', function (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'PROXY_ERROR', message: e.message }));
  });
  req2.write(requestBody);
  req2.end();
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
