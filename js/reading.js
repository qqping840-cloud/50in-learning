/**
 * reading.js — 阅读板块
 * 职责：
 *   1. API key 配置（存 config.json，通过 server.js 读写）
 *   2. 需求卡片（难度/主题/篇幅/形式，每组可自定义）
 *   3. 调用 /api/generate 生成文章
 *   4. 阅读模式：furigana 罗马音标注 + 屏蔽开关 + 逐假名点读
 *   5. 集成打字模式（typing.js）
 * 依赖：window.Typing, window.UI（运行时）, getKana
 */
(function () {

  // ---------- 内部状态 ----------
  var state = {
    config: { hasKey: false },
    params: { difficulty: '初级', topic: '日常对话', length: '短（约50字）', form: '纯假名' },
    article: null,      // 生成的纯文本
    parsed: [],         // 假名序列 [{char, romaji, ...}]
    annotated: null,    // 注音 token 数组（kuroshiro 结果），null=未注音
    annotatedText: null, // 上次注音对应的文章文本（用于判断缓存是否过期）
    hideRomaji: false,
    typingActive: false,
    generating: false
  };

  // 需求卡片定义（每组末尾都有「自定义」）
  var TABS = [
    {
      key: 'difficulty', title: '难度',
      options: ['入门', '初级', '中级', '高级']
    },
    {
      key: 'topic', title: '主题',
      options: ['日常对话', '旅行', '美食', '校园', '科技']
    },
    {
      key: 'length', title: '篇幅',
      options: ['短（约50字）', '中（约150字）', '长（约300字）']
    },
    {
      key: 'form', title: '形式',
      options: ['纯假名（无汉字）', '含汉字（标注读音）']
    }
  ];

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 特殊小假名补充映射（data.js 未收录，供阅读注音）
  var EXTRA_KANA = {
    'っ': 'xtsu', 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'ゎ': 'wa', 'ゔ': 'vu'
  };
  // 查假名罗马音：优先 getKana，其次补充映射
  function kanaRomaji(ch) {
    var k = getKana(ch);
    if (k) return k.romaji;
    if (EXTRA_KANA[ch]) return EXTRA_KANA[ch];
    return null;
  }
  // 词间微空格判断
  function isWordSpace(ch) { return ch === ' '; }

  // ---------- 汉字注音（kuroshiro） ----------
  var kuroshiroPromise = null;  // 惰性初始化
  var kuroshiroReady = false;
  var globalKuroshiro = null;

  // 惰性初始化 kuroshiro，返回 Promise。失败时返回 null（降级，不崩）
  function initKuroshiro() {
    if (kuroshiroReady) return Promise.resolve(true);
    if (kuroshiroPromise) return kuroshiroPromise;
    kuroshiroPromise = new Promise(function (resolve) {
      try {
        if (typeof Kuroshiro === 'undefined' || typeof KuromojiAnalyzer === 'undefined') {
          resolve(false); return;
        }
        // kuroshiro 的 UMD 构建挂在 window.Kuroshiro.default 上
        var KuroshiroCtor = Kuroshiro.default || Kuroshiro;
        var k = new KuroshiroCtor();
        k.init(new KuromojiAnalyzer({ dictPath: 'assets/lib/dict' }))
          .then(function () { kuroshiroReady = true; resolve(true); })
          .catch(function () { resolve(false); });
        globalKuroshiro = k;
      } catch (e) { resolve(false); }
    });
    return kuroshiroPromise;
  }

  // 判断字符是否为假名（含长音符ー），供 token 分类用
  function isKanaCh(ch) { return !!kanaRomaji(ch) || ch === 'ー'; }

  // 缓存 key：文章文本 → 注音 HTML
  function cacheKey(text) {
    return 'kana-furigana-v1-' + text.length + '-' + text.slice(0, 50);
  }

  // 处理 kuroshiro 返回的 furigana HTML：
  // 用 DOM 遍历：汉字 ruby 节点加 data-reading（点读），顶层假名文本补罗马音
  function decorateHtml(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    // 1. 汉字 ruby → 加 data-reading span
    Array.prototype.forEach.call(wrap.querySelectorAll('ruby'), function (ruby) {
      var rt = ruby.querySelector('rt');
      var reading = rt ? rt.textContent : '';
      var span = document.createElement('span');
      span.className = 'reading-char';
      span.setAttribute('data-reading', reading);
      ruby.parentNode.insertBefore(span, ruby);
      span.appendChild(ruby);
    });
    // 2. 顶层假名文本节点 → 补罗马音 ruby
    walkText(wrap, function (node) {
      var text = node.nodeValue;
      if (!text) return;
      var pieces = splitKana(text);
      if (!pieces || pieces.length === 0) return;
      var frag = document.createDocumentFragment();
      var inserted = false;
      pieces.forEach(function (p) {
        if (p.type === 'kana') {
          inserted = true;
          frag.appendChild(htmlToEl(plainHtml(p.text)));
        } else {
          frag.appendChild(document.createTextNode(p.text));
        }
      });
      if (inserted) node.parentNode.replaceChild(frag, node);
    });
    return wrap.innerHTML;
  }

  // 把文本切成假名段和非假名段
  function splitKana(text) {
    var parts = [];
    var cur = '';
    var curIsKana = null;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var isK = isKanaCh(ch);
      if (curIsKana === null) { curIsKana = isK; cur = ch; }
      else if (isK === curIsKana) { cur += ch; }
      else { parts.push({ type: curIsKana ? 'kana' : 'other', text: cur }); curIsKana = isK; cur = ch; }
    }
    if (cur) parts.push({ type: curIsKana ? 'kana' : 'other', text: cur });
    return parts.filter(function (p) { return p.type === 'kana'; });
  }

  // HTML 字符串 → DOM 元素
  function htmlToEl(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstChild;
  }

  // 遍历文本节点（不含 ruby 内部）
  function walkText(root, fn) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        // 跳过 ruby 内部的 rt/rp
        if (node.parentNode && node.parentNode.tagName && /^(RT|RP|RUBY)$/i.test(node.parentNode.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(fn);
  }

  // 取文章注音结果。优先读缓存；无缓存则调 kuroshiro 转换并写入缓存。
  // 返回 Promise：resolve 注音 HTML；失败降级 resolve null
  function annotateArticle(text) {
    if (!kuroshiroReady || !globalKuroshiro) return Promise.resolve(null);
    var key = cacheKey(text);
    // 1. 先查 localStorage 缓存
    try {
      var cached = localStorage.getItem(key);
      if (cached) return Promise.resolve(cached);
    } catch (e) {}
    // 2. 调 kuroshiro 转换（furigana 模式返回带 ruby 注音的 HTML）
    return globalKuroshiro.convert(text, { to: 'hiragana', mode: 'furigana' })
      .then(function (html) {
        var decorated = decorateHtml(html);
        try { localStorage.setItem(key, decorated); } catch (e) {}
        return decorated;
      })
      .catch(function () { return null; });
  }

  // ---------- AI 生成结果清洗 ----------
  // 无论 AI 返回什么，清洗成干净的日语纯文本（剥离 markdown/HTML/标题/空行/英文注释）
  function sanitizeArticle(text, form) {
    if (!text) return '';
    var s = String(text);
    // 1. 剥离代码块
    s = s.replace(/```[\s\S]*?```/g, '');
    // 2. 剥离 HTML 标签
    s = s.replace(/<[^>]+>/g, '');
    // 3. 剥离 Markdown 标记（# 标题、**加粗、*斜体、- 列表、> 引用、` 行内代码）
    s = s.replace(/^#{1,6}\s*/gm, '');
    s = s.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '').replace(/^>\s*/gm, '');
    // 4. 剥离"标题："、"文章："、"正文："等前缀引导语
    s = s.replace(/^(标题|文章|正文|以下|以下是|内容|作文)[：:]\s*/gm, '');
    s = s.replace(/^(これは|以下は|本文は)[：:]\s*/g, '');
    // 5. 行首列表符号（-、•、数字.）
    s = s.replace(/^[-•]\s+/gm, '');
    s = s.replace(/^\d+[.、]\s+/gm, '');
    // 6. 合并空白：多个空格→一个，去行尾空格
    s = s.replace(/[ \t]+/g, ' ').replace(/[ \t]+$/gm, '');
    // 7. 合并多余空行
    s = s.replace(/\n{3,}/g, '\n\n');
    // 8. 纯假名模式：不再强制删除汉字（兼容汉字，前端自动注音），
    //    仅清理英文注释等无关内容（如"（watashi）"这类拼音注释）
    var pureKana = form && form.indexOf('纯假名') !== -1;
    if (pureKana) {
      // 移除括号内英文注释（kuroshiro 注音时不需要英文干扰）
      s = s.replace(/[（(][A-Za-z\s]+[)）]/g, '');
    }
    return s.trim();
  }

  // ---------- API ----------
  // 容错解析响应：优先 JSON，非 JSON 时返回 { error, message } 不抛异常
  function safeParse(r) {
    return r.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        var msg = (text || '').trim().split('\n')[0];
        if (msg.length > 300) msg = msg.slice(0, 300) + '...';
        return { error: 'BAD_RESPONSE', message: msg || ('请求失败（HTTP ' + r.status + '）') };
      }
    });
  }
  function apiGet(url) {
    return fetch(url).then(function (r) { return safeParse(r); });
  }
  function apiPost(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) { return safeParse(r); });
  }

  // ---------- 渲染主入口 ----------
  function render() {
    loadConfig();
    renderLibrary();
    renderKeyConfig();
    renderTabs();
    renderArticleArea();
    bindGenerate();
  }

  // ---------- 内置精选文章 ----------
  function renderLibrary() {
    var box = el('reading-library');
    if (!box) return;
    var lib = window.LIBRARY || [];
    var html = '<div class="reading-library-title">精选文章</div>';
    html += '<div class="reading-library-grid">';
    lib.forEach(function (item, idx) {
      html +=
        '<button class="reading-lib-card" data-idx="' + idx + '">' +
          '<div class="reading-lib-title">' + esc(item.title) + '</div>' +
          '<div class="reading-lib-meta">' +
            '<span class="reading-lib-level">' + esc(item.level) + '</span>' +
            (item.kana ? '<span class="reading-lib-kana">纯假名</span>' : '<span class="reading-lib-kanji">含汉字</span>') +
          '</div>' +
        '</button>';
    });
    html += '</div>';
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('.reading-lib-card'), function (card) {
      card.onclick = function () {
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        var item = lib[idx];
        if (!item) return;
        loadArticle(item.text);
      };
    });
  }

  // 生成按钮绑定
  function bindGenerate() {
    var btn = el('btn-reading-generate');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.onclick = function () { generateArticle(); };
    }
  }

  // ---------- API key 配置区 ----------
  function loadConfig() {
    apiGet('/api/config').then(function (cfg) { state.config = cfg; }).catch(function () {});
  }

  function renderKeyConfig() {
    var box = el('reading-key-config');
    if (!box) return;
    var hasKey = state.config.hasKey;
    box.innerHTML =
      '<div class="reading-key-box">' +
        '<span class="reading-key-label">' + (hasKey ? '✅ API Key 已配置' : 'API Key 未配置') + '</span>' +
        '<div class="reading-key-row">' +
          '<input type="password" class="reading-key-input" id="reading-key-input" placeholder="输入 DeepSeek API Key" value="">' +
          '<button class="btn btn-primary" id="btn-reading-savekey">保存</button>' +
        '</div>' +
        '<div class="reading-key-hint">获取 Key：platform.deepseek.com → API Keys（仅存本地 config.json，不上传）</div>' +
      '</div>';
    var saveBtn = el('btn-reading-savekey');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var key = el('reading-key-input').value.trim();
        apiPost('/api/config', { deepseekApiKey: key }).then(function () {
          state.config.hasKey = !!key;
          renderKeyConfig();
        });
      };
    }
  }

  // ---------- 需求卡片 ----------
  function renderTabs() {
    var box = el('reading-tabs');
    if (!box) return;
    var html = '';
    TABS.forEach(function (tab) {
      html += '<div class="reading-tab-group">';
      html += '<div class="reading-tab-title">' + esc(tab.title) + '</div>';
      html += '<div class="reading-tab-options" data-group="' + tab.key + '">';
      tab.options.forEach(function (opt) {
        var active = (state.params[tab.key] === opt) ? ' active' : '';
        html += '<button class="reading-opt' + active + '" data-group="' + tab.key + '" data-value="' + esc(opt) + '">' + esc(opt) + '</button>';
      });
      // 自定义按钮
      var isCustom = tab.options.indexOf(state.params[tab.key]) === -1;
      html += '<button class="reading-opt custom' + (isCustom ? ' active' : '') + '" data-group="' + tab.key + '" data-custom="1">✏️ 自定义</button>';
      html += '</div>';
      // 自定义输入框（选中自定义时显示）
      if (isCustom) {
        html += '<input class="reading-custom-input" data-group="' + tab.key + '" placeholder="自定义 ' + tab.title + '" value="' + esc(state.params[tab.key]) + '">';
      }
      html += '</div>';
    });
    box.innerHTML = html;

    // 选项点击
    Array.prototype.forEach.call(box.querySelectorAll('.reading-opt'), function (btn) {
      btn.onclick = function () {
        var group = btn.getAttribute('data-group');
        var isCustom = btn.hasAttribute('data-custom');
        if (isCustom) {
          // 进入自定义：显示输入框，值设为空待填
          state.params[group] = '';
        } else {
          state.params[group] = btn.getAttribute('data-value');
        }
        renderTabs();
      };
    });
    // 自定义输入框
    Array.prototype.forEach.call(box.querySelectorAll('.reading-custom-input'), function (input) {
      input.onchange = function () {
        state.params[input.getAttribute('data-group')] = input.value.trim() || '自定义';
        renderTabs();
      };
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { input.blur(); }
      };
    });
  }

  // ---------- 生成文章 ----------
  function generateArticle() {
    if (state.generating) return;
    // 校验 key
    if (!state.config.hasKey) {
      alert('请先配置 DeepSeek API Key');
      return;
    }
    state.generating = true;
    var genBtn = el('btn-reading-generate');
    if (genBtn) { genBtn.disabled = true; genBtn.innerText = '生成中...'; }

    apiPost('/api/generate', {
      difficulty: state.params.difficulty,
      topic: state.params.topic,
      length: state.params.length,
      form: state.params.form
    }).then(function (data) {
      state.generating = false;
      if (genBtn) { genBtn.disabled = false; genBtn.innerText = '生成文章'; }
      if (data.error) {
        alert('生成失败：' + (data.message || data.error));
        return;
      }
      // 解析 DeepSeek 响应
      var content = '';
      try {
        if (data.choices && data.choices[0] && data.choices[0].message) {
          content = data.choices[0].message.content || '';
        }
      } catch (e) {}
      if (!content) {
        alert('生成结果为空，请重试');
        return;
      }
      // 清洗 AI 输出（剥离 markdown/标题/空行等，纯假名模式过滤汉字）
      content = sanitizeArticle(content, state.params.form);
      if (!content) {
        alert('生成结果无效，请重试');
        return;
      }
      state.article = content;
      state.typingActive = false;
      state.hideRomaji = false;
      // 解析假名序列（供阅读/打字用）
      state.parsed = window.Typing.parseText(state.article);
      renderArticleArea();
    }).catch(function (err) {
      state.generating = false;
      if (genBtn) { genBtn.disabled = false; genBtn.innerText = '生成文章'; }
      alert('请求失败：' + ((err && err.message) || '网络错误，请检查服务是否在运行'));
    });
  }

  // ---------- 阅读 / 打字 区域 ----------
  function renderArticleArea() {
    var view = el('reading-view');
    var wrap = el('reading-typing-wrap');
    if (!view || !wrap) return;

    if (!state.article) {
      view.style.display = 'none';
      wrap.style.display = 'none';
      return;
    }
    view.style.display = 'block';
    renderToolbar();
    if (state.typingActive) {
      view.style.display = 'none';
      wrap.style.display = 'block';
      TypingUI.start(state.article, state.parsed);    } else {
      wrap.style.display = 'none';
      renderArticle();
    }
  }

  // 工具栏：屏蔽罗马音 / 打字 / 重新生成
  function renderToolbar() {
    var bar = el('reading-toolbar');
    if (!bar) return;
    bar.innerHTML =
      '<button class="btn btn-secondary" id="btn-reading-hide">' + (state.hideRomaji ? '显示罗马音' : '屏蔽罗马音') + '</button>' +
      '<button class="btn btn-primary" id="btn-reading-typing">打字练习</button>' +
      '<button class="btn btn-secondary" id="btn-reading-regenerate">重新生成</button>';

    el('btn-reading-hide').onclick = function () {
      state.hideRomaji = !state.hideRomaji;
      renderArticle();
      renderToolbar();
    };
    el('btn-reading-typing').onclick = function () {
      state.typingActive = true;
      renderArticleArea();
    };
    el('btn-reading-regenerate').onclick = function () {
      state.article = null;
      renderArticleArea();
      render();
    };
  }

  // 阅读模式：逐假名 furigana 展示，可点读
  function renderArticle() {
    var box = el('reading-article');
    if (!box) return;
    var pending = !state.annotated || state.annotatedText !== state.article;
    if (pending) {
      box.innerHTML = '<div class="reading-loading">正在加载注音...</div>';
    }
    initKuroshiro().then(function (ok) {
      if (ok) {
        // kuroshiro 可用：汉字有注音
        renderAnnotated();
      } else {
        // 降级：用现有逐字符逻辑（汉字走 reading-plain，无注音）
        renderFallback();
      }
    });
  }

  // 汉字注音渲染：渲染 kuroshiro 生成的注音 HTML
  function renderAnnotated() {
    var box = el('reading-article');
    if (!box) return;
    annotateArticle(state.article).then(function (html) {
      if (!html) { renderFallback(); return; }
      state.annotated = html;
      state.annotatedText = state.article;
      var hide = state.hideRomaji;
      box.innerHTML = '<div class="reading-article' + (hide ? ' hide-romaji' : '') + '">' + html + '</div>';
      bindCharClick(box);
    });
  }

  // 逐字符生成 furigana 标记（假名+罗马音，汉字无注音），不包外层容器
  function plainHtml(text) {
    var html = '';
    var i = 0;
    while (i < text.length) {
      var ch = text[i];
      // 优先匹配双字符拗音（きょ 等），与打字解析逻辑一致
      var two = text.substr(i, 2);
      var twoRomaji = (getKana(two) || EXTRA_KANA[two]) ? kanaRomaji(two) : null;
      if (twoRomaji) {
        html +=
          '<span class="reading-char" data-kana="' + esc(two) + '">' +
            '<ruby>' + esc(two) + '<rt>' + esc(twoRomaji) + '</rt></ruby>' +
          '</span>';
        i += 2;
        continue;
      }
      // 单字符假名
      var romaji = kanaRomaji(ch);
      if (romaji) {
        html +=
          '<span class="reading-char" data-kana="' + esc(ch) + '">' +
            '<ruby>' + esc(ch) + '<rt>' + esc(romaji) + '</rt></ruby>' +
          '</span>';
      } else if (ch === 'ー' || ch === ' ' || ch === '、' || ch === '。' || ch === '！' || ch === '？') {
        html += '<span class="reading-space">' + esc(ch) + '</span>';
      } else {
        // 汉字或其他：直接显示，无注音
        html += '<span class="reading-plain">' + esc(ch) + '</span>';
      }
      i++;
    }
    return html;
  }

  // 降级渲染：kuroshiro 不可用时的逐字符逻辑（原 renderArticle 主体）
  function renderFallback() {
    var box = el('reading-article');
    if (!box) return;
    var hide = state.hideRomaji;
    // 检测是否 file:// 协议（此时词典无法加载）
    var isFile = (typeof location !== 'undefined') && location.protocol === 'file:';
    var notice = isFile
      ? '<div class="reading-notice">⚠️ 汉字注音需要启动本地服务：请双击 <b>start.bat</b> 打开，而不是直接双击 index.html</div>'
      : '<div class="reading-notice">⚠️ 注音词典加载失败，已降级为无注音模式</div>';
    var html = '<div class="reading-article' + (hide ? ' hide-romaji' : '') + '">';
    html += plainHtml(state.article);
    html += '</div>';
    box.innerHTML = notice + html;
    bindCharClick(box);
  }

  // 绑定点读：假名点读原假名，汉字点读 data-reading 假名读音
  function bindCharClick(box) {
    Array.prototype.forEach.call(box.querySelectorAll('.reading-char[data-kana], .reading-char[data-reading]'), function (span) {
      span.onclick = function () {
        var word = span.getAttribute('data-reading') || span.getAttribute('data-kana');
        if (window.UI && window.UI.speak) window.UI.speak(word);
      };
    });
  }

  // ---------- 打字模式 UI ----------
  // 渲染打字区：假名序列 + 高亮 + 虚拟键盘 + 结果面板
  var TypingUI = {
    engine: null,
    hintOn: true,
    activeKey: null,

    start: function (article, parsed) {
      this.engine = window.Typing.createEngine(article);
      this.render();
      // 绑定键盘
      if (!this._bound) {
        this._bound = true;
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', function () {
          TypingUI.activeKey = null;
          var el2 = document.querySelector('#reading-typing-wrap .vkbd-key.pressed');
          if (el2) el2.classList.remove('pressed');
        });
      }
      // 聚焦页面接收键盘
      el('reading-typing-wrap').tabIndex = 0;
      el('reading-typing-wrap').focus();
    },

    handleKeyDown: function (e) {
      if (!TypingUI.engine) return;
      // 只处理字母键
      var key = e.key;
      if (!/^[a-z]$/i.test(key)) return;
      e.preventDefault();
      var lower = key.toLowerCase();
      // 高亮按下键
      TypingUI.activeKey = lower;
      var keyEl = document.querySelector('#reading-typing-wrap .vkbd-key[data-key="' + lower + '"]');
      if (keyEl) keyEl.classList.add('pressed');

      var result = TypingUI.engine.press(lower);
      TypingUI.render();
      if (result.type === 'progress') {
        if (window.UI && window.UI.speak) window.UI.speak(result.char);
      }
      // 完成全部假名 → 显示结果
      if (result.type === 'progress' && result.completed >= result.total) {
        TypingUI.showResult();
      }
      // 引擎自身报告 complete
      if (result.type === 'complete') {
        TypingUI.showResult();
      }
    },

    // 平移距离（px）：已完成 token 的累积宽度，用于 translateX
    shiftPx: 0,

    // 滚动到当前假名（居中）——用 translateX 平移整行，保证滚动稳定
    scrollToCurrent: function () {
      var wrap = el('reading-typing-wrap');
      if (!wrap) return;
      var row = el('typing-kana-row');
      var scroll = el('typing-scroll');
      if (!row || !scroll) return;
      var cur = wrap.querySelector('.typing-token.current');
      if (!cur) {
        this.shiftPx = 0;
        row.style.transform = 'translateX(0px)';
        return;
      }
      // 强制当前假名居中：允许负平移（把行右移让前方内容进入）
      var curCenter = cur.offsetLeft + cur.offsetWidth / 2;
      this.shiftPx = curCenter - scroll.clientWidth / 2;
      row.style.transform = 'translateX(' + (-this.shiftPx) + 'px)';
    },
    render: function () {
      var wrap = el('reading-typing-wrap');
      if (!wrap || !this.engine) return;
      var st = this.engine.getState();
      var s = this.engine;
      var html = '';

      // 顶栏：返回阅读 / 提示开关
      html += '<div class="typing-topbar">' +
        '<button class="btn btn-secondary" id="btn-typing-back">返回阅读</button>' +
        '<span class="typing-progress">' + st.completed + ' / ' + st.total + '</span>' +
        '<button class="btn btn-secondary" id="btn-typing-hint">' + (this.hintOn ? '隐藏提示' : '显示提示') + '</button>' +
      '</div>';

      // 横向滚动假名序列：完整渲染整行，用 translateX 平移
      // （参考 type-kana 的 margin-left 平移方案，保证滚动稳定不错位）
      html += '<div class="typing-scroll" id="typing-scroll">';
      html += '<div class="typing-kana-row" id="typing-kana-row" style="transform: translateX(' + (-this.shiftPx) + 'px)">';
      var tokens = st.tokens;
      for (var i = 0; i < tokens.length; i++) {
        var item = tokens[i];
        var cls = 'typing-token';
        if (item.type === 'punct') {
          // 标点/空格：灰色窄显示，词间空格加宽
          cls += ' punct' + (isWordSpace(item.char) ? ' word-space' : '');
        } else {
          if (i < st.pos) cls += ' done';
          else if (i === st.pos) cls += ' current';
          else cls += ' todo';
          var hint = '';
          if (i === st.pos && TypingUI.hintOn) {
            hint = '<span class="typing-hint">' + esc(item.romaji) + '</span>';
          }
          cls += ' kana';
          html += '<span class="' + cls + '" data-pos="' + i + '">' + esc(item.char) + hint + '</span>';
          continue;
        }
        html += '<span class="' + cls + '">' + esc(item.char) + '</span>';
      }
      html += '</div>';
      html += '</div>';

      // 当前输入缓冲显示
      html += '<div class="typing-buffer">' +
        '<span class="typing-buffer-target">' + (st.target ? esc(st.target.romaji) : '') + '</span>' +
        '<span class="typing-buffer-typed">' + esc(st.buffer) + '</span>' +
        '<span class="typing-cursor"></span>' +
      '</div>';

      // 虚拟键盘（当前按下键高亮 + 目标提示键）
      var hintKey = window.Typing.nextHintKey(st.target, st.buffer);
      html += window.Typing.renderKeyboard(this.activeKey, this.hintOn ? hintKey : null);

      wrap.innerHTML = html;

      // 滚动到当前假名（居中）—— 重建 DOM 后重新计算
      this.scrollToCurrent();

      // 事件
      el('btn-typing-back').onclick = function () {
        state.typingActive = false;
        TypingUI.engine = null;
        renderArticleArea();
      };
      el('btn-typing-hint').onclick = function () {
        TypingUI.hintOn = !TypingUI.hintOn;
        TypingUI.render();
      };
      // 虚拟键盘点击
      Array.prototype.forEach.call(wrap.querySelectorAll('.vkbd-key'), function (btn) {
        btn.onclick = function () {
          var key = btn.getAttribute('data-key');
          TypingUI.activeKey = key;
          btn.classList.add('pressed');
          var result = TypingUI.engine.press(key);
          TypingUI.render();
          if (result.type === 'progress' && window.UI) window.UI.speak(result.char);
          if ((result.type === 'progress' && result.pos >= result.total) || result.type === 'complete') TypingUI.showResult();
        };
      });
      wrap.focus();
    },

    showResult: function () {
      var res = this.engine.getResult();
      var wrap = el('reading-typing-wrap');
      if (!wrap) return;
      var mins = res.elapsedMs / 60000;
      var secs = Math.round((res.elapsedMs % 60000) / 1000);
      var weakHtml = res.weak.length
        ? '<div class="typing-weak">弱项假名：' + res.weak.map(function (w) { return '<span class="typing-weak-char">' + esc(w) + '</span>'; }).join('') + '</div>'
        : '<div class="typing-weak">全部掌握，太棒了！</div>';
      wrap.innerHTML =
        '<div class="typing-result">' +
          '<div class="typing-result-title">练习完成！</div>' +
          '<div class="typing-result-stats">' +
            '<div class="typing-stat">用时 <b>' + mins.toFixed(1) + '分' + secs + '秒</b></div>' +
            '<div class="typing-stat">正确率 <b>' + Math.round(res.accuracy * 100) + '%</b></div>' +
            '<div class="typing-stat">错键 <b>' + res.errors + '</b></div>' +
          '</div>' +
          weakHtml +
          '<div class="typing-result-actions">' +
            '<button class="btn btn-primary" id="btn-typing-retry">再来一次</button>' +
            '<button class="btn btn-secondary" id="btn-typing-back2">返回阅读</button>' +
          '</div>' +
        '</div>';
      el('btn-typing-retry').onclick = function () {
        TypingUI.engine = window.Typing.createEngine(state.article);
        TypingUI.render();
      };
      el('btn-typing-back2').onclick = function () {
        state.typingActive = false;
        TypingUI.engine = null;
        renderArticleArea();
      };
    }
  };

  // ---------- 导出 ----------
  // 加载一篇文章（供精选文章/AI生成/测试复用）
  function loadArticle(text) {
    state.article = text;
    state.parsed = window.Typing.parseText(text);
    state.typingActive = false;
    state.hideRomaji = false;
    renderArticleArea();
  }

  // ---------- 导出 ----------
  window.Reading = {
    render: render,
    generate: generateArticle,
    loadArticle: loadArticle
  };

})();
