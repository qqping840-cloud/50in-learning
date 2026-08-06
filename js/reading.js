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

  // ---------- API ----------
  function apiGet(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }
  function apiPost(url, data) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); });
  }

  // ---------- 渲染主入口 ----------
  function render() {
    loadConfig();
    renderKeyConfig();
    renderTabs();
    renderArticleArea();
    bindGenerate();
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
      state.article = content.trim();
      state.typingActive = false;
      state.hideRomaji = false;
      // 解析假名序列（供阅读/打字用）
      state.parsed = window.Typing.parseText(state.article);
      renderArticleArea();
    }).catch(function (err) {
      state.generating = false;
      if (genBtn) { genBtn.disabled = false; genBtn.innerText = '生成文章'; }
      alert('请求失败：' + err.message);
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
    var hide = state.hideRomaji;
    var html = '<div class="reading-article' + (hide ? ' hide-romaji' : '') + '">';
    var i = 0;
    while (i < state.article.length) {
      var ch = state.article[i];
      // 从解析结果找这个位置的假名（用于点读发音）
      var kana = getKana(ch);
      if (kana) {
        var romaji = kana.romaji;
        html +=
          '<span class="reading-char" data-kana="' + esc(ch) + '">' +
            '<ruby>' + esc(ch) + '<rt>' + esc(romaji) + '</rt></ruby>' +
          '</span>';
      } else if (ch === 'ー' || ch === ' ') {
        html += '<span class="reading-space">' + esc(ch) + '</span>';
      } else {
        // 汉字或其他：直接显示，无注音
        html += '<span class="reading-plain">' + esc(ch) + '</span>';
      }
      i++;
    }
    html += '</div>';
    box.innerHTML = html;

    // 点击假名发音
    Array.prototype.forEach.call(box.querySelectorAll('.reading-char[data-kana]'), function (span) {
      span.onclick = function () {
        if (window.UI && window.UI.speak) window.UI.speak(span.getAttribute('data-kana'));
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
      if (result.type === 'progress' && result.pos >= result.total) {
        TypingUI.showResult();
      }
      // 引擎自身报告 complete
      if (result.type === 'complete') {
        TypingUI.showResult();
      }
    },

    // 渲染当前状态
    render: function () {
      var wrap = el('reading-typing-wrap');
      if (!wrap || !this.engine) return;
      var st = this.engine.getState();
      var s = this.engine;
      var html = '';

      // 顶栏：返回阅读 / 提示开关
      html += '<div class="typing-topbar">' +
        '<button class="btn btn-secondary" id="btn-typing-back">返回阅读</button>' +
        '<span class="typing-progress">' + st.pos + ' / ' + st.total + '</span>' +
        '<button class="btn btn-secondary" id="btn-typing-hint">' + (this.hintOn ? '隐藏提示' : '显示提示') + '</button>' +
      '</div>';

      // 假名序列：逐个显示，当前高亮，完成变绿
      html += '<div class="typing-kana-row">';
      st.kanaList.forEach(function (item, idx) {
        var cls = 'typing-kana';
        if (idx < st.pos) cls += ' done';
        else if (idx === st.pos) cls += ' current';
        else cls += ' todo';
        var hint = '';
        if (idx === st.pos && TypingUI.hintOn) {
          hint = '<span class="typing-hint">' + esc(item.romaji) + '</span>';
        }
        html += '<span class="' + cls + '">' + esc(item.char) + hint + '</span>';
      });
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
  window.Reading = {
    render: render,
    generate: generateArticle,
    // 加载一篇文章（供打字/阅读测试与预设文章复用）
    loadArticle: function (text) {
      state.article = text;
      state.parsed = window.Typing.parseText(text);
      state.typingActive = false;
      state.hideRomaji = false;
      renderArticleArea();
    }
  };

})();
