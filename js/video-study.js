/**
 * video-study.js — 视频跟读
 * 左原视频、右日语/译文字幕。日语词点读复用 UI.speak（与阅读、单词同音源）；
 * 句前按钮重播本句原声；椭圆光斑随播放位置跟随（有词级时间才逐词，否则跟整句）。
 * 依赖：VideoStudyData（字幕读取校验）、KuromojiAnalyzer（词切分）、UI.speak（点读音源）
 */
(function () {
  'use strict';

  var state = {
    videoUrl: null,
    cues: [],
    els: [],            // 每条字幕的 DOM 引用
    activeIndex: -1,
    showZh: true,
    follow: true,
    romaji: false,
    built: false,
    tokenizer: null,
    tokenizerReady: false,
    stopAt: null,
    raf: 0,
    items: [],
    loadedId: null,
    pendingTokens: 0,
    tokensReady: false,
    warming: false,
    glossing: false,
    glossFailed: false
  };
  var lastCueKey = '';

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }
  // 片假名 → 平假名，保证点读走单词音频（assets/audio/words/<假名>.mp3）
  function toHiragana(s) {
    return String(s).replace(/[\u30a1-\u30f6]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    });
  }

  // ---------- 词切分（KuromojiAnalyzer，与阅读板块同一套词典） ----------
  function initTokenizer() {
    if (state.tokenizerReady || state.tokenizer) return;
    if (typeof window.KuromojiAnalyzer === 'undefined') return;
    state.tokenizer = new window.KuromojiAnalyzer({ dictPath: 'assets/lib/dict' });
    var analyzer = state.tokenizer;
    state.tokenizerReady = true;
    analyzer.init().then(function () { state.tokenizerReady = true; state.tokensReady = true; refreshLines(); })
      .catch(function () { state.tokenizerReady = false; });
  }

  function tokenize(text) {
    if (!state.tokenizerReady) return Promise.resolve([{ surface: text, kana: text, pos: '' }]);
    return state.tokenizer.parse(text).then(function (rows) {
      return rows.map(function (t) {
        var surface = t.surface_form || '';
        var kana = t.reading && t.reading !== '*' ? toHiragana(t.reading) : surface;
        return { surface: surface, kana: kana, pos: t.pos || '' };
      }).filter(function (t) { return t.surface; });
    }).catch(function () { return [{ surface: text, kana: text, pos: '' }]; });
  }

  // ---------- DOM 构建（只做一次） ----------
  function build() {
    var page = el('page-video');
    if (!page || state.built) return;
    page.innerHTML =
      '<div class="video-study-toolbar">' +
        '<label class="video-study-import">导入视频' +
          '<input id="video-study-file" type="file" accept="video/*"></label>' +
        '<label class="video-study-import">导入字幕' +
          '<input id="video-study-subs" type="file" accept=".json,.srt" multiple></label>' +
        '<label class="video-study-toggle"><input id="video-study-zh" type="checkbox" checked>译文</label>' +
        '<label class="video-study-toggle"><input id="video-study-follow" type="checkbox" checked>跟随</label>' +
        '<label class="video-study-toggle"><input id="video-study-romaji" type="checkbox">罗马音</label>' +
        '<span class="video-study-time" id="video-study-time">00:00</span>' +
      '</div>' +
      '<div class="video-study-library" id="video-study-library" hidden>' +
        '<span class="video-study-library-label">已处理</span>' +
        '<div class="video-study-chips" id="video-study-chips"></div>' +
      '</div>' +
      '<div class="video-study-columns">' +
        '<section class="video-study-media">' +
          '<div class="video-study-frame">' +
            '<video id="video-study-player" controls playsinline preload="metadata"></video>' +
            '<div class="video-study-empty" id="video-study-empty">从上面挑一条，或导入本地视频</div>' +
          '</div>' +
        '</section>' +
        '<section class="video-study-transcript" id="video-study-transcript">' +
          '<div class="reading-highlight" id="video-study-glow"></div>' +
          '<ol class="video-study-lines" id="video-study-lines"></ol>' +
          '<p class="video-study-hint" id="video-study-hint">导入日语字幕开始</p>' +
        '</section>' +
      '</div>' +
      '<div class="video-study-tip" id="video-study-tip" hidden></div>';
    state.built = true;

    var input = el('video-study-file');
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) importVideo(input.files[0]);
    });
    var subs = el('video-study-subs');
    subs.addEventListener('change', function () { importSubtitles(subs.files); });
    el('video-study-zh').addEventListener('change', function (e) {
      state.showZh = e.target.checked;
      var box = el('video-study-lines');
      if (box) box.classList.toggle('hide-zh', !state.showZh);
    });
    el('video-study-follow').addEventListener('change', function (e) { state.follow = e.target.checked; });
    // 罗马音只切换显示（词按钮上已带 data-romaji），不用重新注音
    try { state.romaji = localStorage.getItem('video-romaji') === 'on'; } catch (e) {}
    el('video-study-romaji').checked = state.romaji;
    document.getElementById('video-study-lines').classList.toggle('show-romaji', state.romaji);
    el('video-study-romaji').addEventListener('change', function (e) {
      state.romaji = e.target.checked;
      try { localStorage.setItem('video-romaji', state.romaji ? 'on' : 'off'); } catch (err) {}
      document.getElementById('video-study-lines').classList.toggle('show-romaji', state.romaji);
      updateHighlight();
    });

    var video = el('video-study-player');
    video.addEventListener('play', loop);
    video.addEventListener('seeked', updateHighlight);
    video.addEventListener('timeupdate', onTime);
    window.addEventListener('resize', function () { updateHighlight(); hideTip(); });
    // 滚动/播放/切页时提示会飘在错的位置，直接收起来
    var transcript = el('video-study-transcript');
    if (transcript) transcript.addEventListener('scroll', hideTip);
    window.addEventListener('scroll', hideTip, true);
    video.addEventListener('play', hideTip);
  }

  function importVideo(file) {
    var video = el('video-study-player');
    state.loadedId = null;
    renderChips();
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.videoUrl = URL.createObjectURL(file);
    video.src = state.videoUrl;
    video.load();
    el('video-study-empty').hidden = true;
  }

  function importSubtitles(files) {
    if (!files || !files.length) return;
    state.loadedId = null;
    renderChips();
    var list = Array.prototype.slice.call(files);
    var job = Promise.resolve(null);
    var baseFile = list.find(function (f) { return /\.json$/i.test(f.name); }) ||
      list.find(function (f) { return !/\.zh\.srt$/i.test(f.name) && /\.srt$/i.test(f.name); });
    var zhFile = list.find(function (f) { return /\.zh\.srt$/i.test(f.name); });
    if (!baseFile) return setHint('需要日语字幕：study.json 或 srt 文件');
    job = readText(baseFile).then(function (text) {
      return /\.json$/i.test(baseFile.name)
        ? VideoStudyData.normalizeStudy(JSON.parse(text))
        : VideoStudyData.parseSrt(text);
    }).then(function (study) {
      if (!zhFile) return study;
      return readText(zhFile).then(function (text) {
        return VideoStudyData.mergeTranslation(study, VideoStudyData.parseSrt(text));
      });
    });
    job.then(function (study) {
      state.cues = study.cues;
      renderLines();
      setHint('');
    }).catch(function (err) {
      setHint(err && err.message ? err.message : '字幕无法读取');
    });
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('文件读取失败：' + file.name)); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function setHint(text) {
    var hint = el('video-study-hint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.hidden = !text;
  }

  // ---------- 成品库（像选集一样直接打开） ----------
  function getText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('加载失败 ' + r.status);
      return r.text();
    });
  }

  function loadLibrary() {
    return fetch('/api/library').then(function (r) { return r.json(); }).then(function (data) {
      state.items = (data && data.items) || [];
      renderChips();
      if (!state.loadedId && state.items.length) return loadItem(state.items[0], true);
    }).catch(function () {
      state.items = [];
      renderChips();
      setHint('成品库读取失败，可手动导入视频和字幕');
    });
  }

  function renderChips() {
    var box = el('video-study-chips');
    var wrap = el('video-study-library');
    if (!box || !wrap) return;
    if (!state.items.length) { wrap.hidden = true; box.innerHTML = ''; return; }
    wrap.hidden = false;
    box.innerHTML = state.items.map(function (it) {
      return '<button type="button" class="video-study-chip' +
        (state.loadedId === it.id ? ' active' : '') + '" data-id="' + escAttr(it.id) + '" title="' +
        escAttr(it.title + (it.hasVideo ? '' : '（暂无视频，可手动导入）')) + '">' +
        esc(it.title) + (it.hasVideo ? '' : '<i>无视频</i>') + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.video-study-chip'), function (btn) {
      btn.addEventListener('click', function () {
        var it = state.items.filter(function (x) { return x.id === btn.getAttribute('data-id'); })[0];
        if (it) loadItem(it);
      });
    });
  }

  function loadItem(item, silent) {
    state.loadedId = item.id;
    renderChips();
    var video = el('video-study-player');
    var empty = el('video-study-empty');
    if (item.hasVideo) {
      if (state.videoUrl) { URL.revokeObjectURL(state.videoUrl); state.videoUrl = null; }
      video.src = '/api/library/' + item.id + '/media';
      video.load();
      empty.hidden = true;
    } else {
      video.removeAttribute('src');
      video.load();
      empty.hidden = false;
      empty.textContent = '这一条没有视频，用「导入视频」补上';
    }
    setHint('');
    var studyJob = item.words ? getText('/api/library/' + item.id + '/study')
                              : getText('/api/library/' + item.id + '/srt');
    var zhJob = item.hasZh ? getText('/api/library/' + item.id + '/zh') : Promise.resolve(null);
    return Promise.all([studyJob, zhJob]).then(function (out) {
      var text = (out[0] || '').trim();
      var study = text.charAt(0) === '{' ? VideoStudyData.normalizeStudy(JSON.parse(text))
                                         : VideoStudyData.parseSrt(text);
      return out[1] ? VideoStudyData.mergeTranslation(study, VideoStudyData.parseSrt(out[1])) : study;
    }).then(function (study) {
      state.cues = study.cues;
      renderLines();
      if (silent) setHint('');
    }).catch(function (err) {
      setHint('字幕读取失败：' + (err && err.message ? err.message : err));
    });
  }

  // ---------- 字幕渲染 ----------
  function renderLines() {
    var box = el('video-study-lines');
    if (!box) return;
    state.els = [];
    box.innerHTML = state.cues.map(function (cue, i) {
      return '<li data-i="' + i + '">' +
        '<button class="video-study-replay" type="button" aria-label="重播本句原声">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<path d="M8 5v14l11-7z"/></svg></button>' +
        '<div class="video-study-body">' +
          '<p class="video-study-ja"></p>' +
          (cue.zh ? '<p class="video-study-zh">' + esc(cue.zh) + '</p>' : '') +
        '</div></li>';
    }).join('');

    var items = box.querySelectorAll('li');
    state.pendingTokens = items.length;
    Array.prototype.forEach.call(items, function (li, i) {
      var cue = state.cues[i];
      var entry = { li: li, start: cue.start, end: cue.end, ja: li.querySelector('.video-study-ja') };
      state.els.push(entry);
      li.querySelector('.video-study-replay').addEventListener('click', function (e) {
        e.stopPropagation();
        replay(entry);
      });
      li.addEventListener('click', function (e) {
        if (e.target.closest('.video-study-word')) return;
        var video = el('video-study-player');
        if (video) { video.currentTime = entry.start; }
      });
      renderTokens(entry, cue);
    });
    box.classList.toggle('hide-zh', !state.showZh);
  }

  // 假名 -> 罗马音（复用 kuroshiro 的转换，和单词页同一套规则）
  function romajiOf(kana) {
    var C = window.Kuroshiro && (window.Kuroshiro.default || window.Kuroshiro);
    if (!kana || !C || !C.Util || !C.Util.kanaToRomaji) return '';
    try { return C.Util.kanaToRomaji(kana) || ''; } catch (e) { return ''; }
  }

  // 字幕自带词划分时以它为准：词边界来自素材（歌词/字幕怎么写的），
  // 通用分词器经常切碎（「だんご」会被切成 だ|ん|ご），读音、词义、光斑都跟着散。
  // 没有词划分（纯 srt）才退回通用分词。
  function renderTokens(entry, cue) {
    if ((cue.words || []).length) renderByWords(entry, cue);
    else tokenize(cue.text).then(function (tokens) { renderByTokens(entry, cue, tokens); });
  }

  function renderByWords(entry, cue) {
    var cursor = 0, last = 0, parts = [], count = 0;
    (cue.words || []).forEach(function (w) {
      var text = w.w || '';
      if (!text) return;
      var at = cue.text.indexOf(text, cursor);
      if (at < 0) at = cue.text.indexOf(text);
      if (at < 0) return;
      if (at > last) parts.push(esc(cue.text.slice(last, at)));   // 词之间的空格按原文保留
      parts.push('<button class="video-study-word" type="button" data-a="' + at +
        '" data-b="' + (at + text.length) + '">' + esc(text) + '</button>');
      last = at + text.length;
      cursor = last;
      count++;
    });
    if (last < cue.text.length) parts.push(esc(cue.text.slice(last)));
    if (!count) {
      tokenize(cue.text).then(function (tokens) { renderByTokens(entry, cue, tokens); });
      return;
    }
    entry.ja.innerHTML = parts.join('');
    wireButtons(entry, cue);
  }

  function renderByTokens(entry, cue, tokens) {
    var off = 0;
    var html = tokens.map(function (t) {
      if (t.pos === '記号' || !t.surface.trim()) {
        off += t.surface.length;
        return esc(t.surface);
      }
      var from = off;
      off += t.surface.length;
      var r = romajiOf(t.kana);
      var say = t.kana || t.surface;
      // 记下这个按钮占的字符区间，用来跟字幕的逐字时间对上
      return '<button class="video-study-word" type="button" data-a="' + from +
        '" data-b="' + off + '" data-say="' + escAttr(say) + '"' +
        (r ? ' data-romaji="' + escAttr(r) + '"' : '') +
        ' aria-label="' + escAttr(t.kana) + '">' + esc(t.surface) + '</button>';
    }).join('');
    entry.ja.innerHTML = html;
    wireButtons(entry, cue);
  }

  // 按钮的假名（点读、罗马音、悬停标题都靠它）：逐词取读音
  function labelButtons(entry) {
    var jobs = [];
    Array.prototype.forEach.call(entry.ja.querySelectorAll('.video-study-word'), function (btn) {
      if (btn.getAttribute('data-say')) return;
      var text = btn.textContent || '';
      if (!text) return;
      jobs.push(tokenize(text).then(function (rows) {
        var kana = rows.map(function (t) { return t.kana || t.surface; }).join('');
        if (!kana) return;
        btn.setAttribute('data-say', kana);
        var r = romajiOf(kana);
        if (r) btn.setAttribute('data-romaji', r);
        btn.setAttribute('aria-label', kana);
      }));
    });
    return Promise.all(jobs);
  }

  function wireButtons(entry, cue) {
    labelButtons(entry).then(function () {
      Array.prototype.forEach.call(entry.ja.querySelectorAll('.video-study-word'), function (btn) {
        var say = function () { return btn.getAttribute('data-say') || btn.textContent || ''; };
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (window.UI && window.UI.speak && say()) window.UI.speak(say());
        });
        // 悬停：显示「假名 + 中文词义」，同时预热语音
        var warm = 0;
        btn.addEventListener('mouseenter', function () {
          showTip(btn);
          clearTimeout(warm);
          warm = setTimeout(function () {
            if (window.UI && window.UI.prefetchSpeak && say()) window.UI.prefetchSpeak(say());
          }, 150);
        });
        btn.addEventListener('mouseleave', function () {
          hideTip();
          clearTimeout(warm);
        });
      });
      buildSpans(entry, cue);
      if (state.pendingTokens > 0) {
        state.pendingTokens--;
        if (!state.pendingTokens) { warmAudio(); warmGloss(); }
      }
    });
  }

  // ---------- 悬停提示：假名 + 中文词义 ----------
  function showTip(btn) {
    var tip = el('video-study-tip');
    var box = el('video-study-transcript');
    if (!tip || !box) return;
    var surface = btn.textContent || '';
    var kana = btn.getAttribute('data-say') || '';
    var zh = meaningOf(surface, kana, lineOf(btn));
    tip.innerHTML = '<b>' + esc(kana) + '</b>' + (zh ? '<span>' + esc(zh) + '</span>' : '');
    tip.hidden = false;
    var r = btn.getBoundingClientRect();
    var bb = box.getBoundingClientRect();
    var top = r.top - tip.offsetHeight - 6;
    if (top < bb.top + 2) top = r.bottom + 6;
    var left = r.left + r.width / 2 - tip.offsetWidth / 2;
    left = Math.max(bb.left + 4, Math.min(left, bb.right - tip.offsetWidth - 4));
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  function hideTip() {
    var tip = el('video-study-tip');
    if (tip) tip.hidden = true;
  }

  // 词义来源：① 本地词库（离线、即时）② 之前存下的批量释义 ③ 都没有就先只显示假名
  var bookIndex = null;
  function bookIndexBuild() {
    if (bookIndex) return bookIndex;
    bookIndex = {};
    (window.WORDBOOKS || []).forEach(function (bk) {
      (bk.words || []).forEach(function (w) {
        if (!w || !w.zh) return;
        if (w.kanji && !bookIndex[w.kanji]) bookIndex[w.kanji] = w.zh;
        if (w.kana && !bookIndex[w.kana]) bookIndex[w.kana] = w.zh;
      });
    });
    return bookIndex;
  }

  // 词义由服务端缓存（cache/glosses.json，跨浏览器共用）；这里只放本次会话的副本
  var glossMap = {};
  // 早期版本把词义存在浏览器里，现在不用了，清掉以免留着以为还有用
  try { localStorage.removeItem('video-gloss'); } catch (e) {}

  // 词义缓存按「句子 + 词」存：同一个词在不同句子里可能是不同意思
  function glossKey(line, word) { return word + '\u0001' + (line || ''); }

  // 按钮所在的那句原文（就是这个词的语境）
  function lineOf(btn) {
    var li = btn.closest ? btn.closest('li') : null;
    var i = li ? parseInt(li.getAttribute('data-i'), 10) : -1;
    var cue = state.cues[i];
    if (cue) return cue.text;
    var ja = li ? li.querySelector('.video-study-ja') : null;
    return ja ? ja.textContent : '';
  }

  function meaningOf(surface, kana, line) {
    var idx = bookIndexBuild();
    if (surface && idx[surface]) return idx[surface];
    if (kana && idx[kana]) return idx[kana];
    // 只认带语境的条目（键 = 词 + 句）
    return (line && surface && glossMap[glossKey(line, surface)]) || '';
  }

  // 词库里没有的词：带上每个词所在的句子问服务端（服务端有缓存，缺的才送模型）
  function warmGloss() {
    if (state.glossing || state.glossFailed) return;
    var idx = bookIndexBuild();
    var tasks = [], pairs = [], need = 0, MAX = 1000;
    state.els.forEach(function (entry, i) {
      var cue = state.cues[i];
      if (!cue || pairs.length >= MAX) return;
      var words = [], seen = {};
      Array.prototype.forEach.call(entry.ja.querySelectorAll('.video-study-word'), function (btn) {
        var s = btn.textContent;
        if (!s || seen[s]) return;
        seen[s] = true;
        if (idx[s]) return;                 // 词库能给的不用问
        words.push(s);
      });
      if (!words.length) return;
      words = words.slice(0, MAX - pairs.length);
      tasks.push({ ja: cue.text, words: words });
      words.forEach(function (s) {
        pairs.push({ line: cue.text, word: s });
        if (!glossMap[glossKey(cue.text, s)]) need++;
      });
    });
    if (!tasks.length || !need) return;     // 本次会话已经全有了
    state.glossing = true;
    fetch('/api/gloss-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sents: tasks.map(function (t) {
          return { ja: t.ja, words: t.words.map(function (s) { return { t: s }; }) };
        })
      })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      var got = data && data.sents;
      if (!got) {
        // 请求本身失败（服务没起来等）：本次会话不再重试，原因看 logs/app.jsonl
        state.glossFailed = true;
        state.glossing = false;
        return;
      }
      var flat = [];
      got.forEach(function (s) {
        (s.words || []).forEach(function (w) { flat.push(w && w.zh); });
      });
      pairs.forEach(function (p, i) {
        if (flat[i]) glossMap[glossKey(p.line, p.word)] = flat[i];
      });
      state.glossing = false;
      hideTip();
    }).catch(function () { state.glossFailed = true; state.glossing = false; });
  }

  // ---------- 语音本地化（只做一次，之后点击不联网） ----------
  function warmAudio() {
    if (state.warming || !state.tokensReady) return;
    var list = [], seen = {};
    Array.prototype.forEach.call(document.querySelectorAll('#video-study-lines .video-study-word'), function (btn) {
      var t = btn.getAttribute('data-say');
      if (t && !seen[t]) { seen[t] = true; list.push(t); }
    });
    if (list.length < 2) return;
    var key = 'video-warm:' + (state.loadedId || 'local') + ':' + list.length;
    try { if (localStorage.getItem(key) === 'done') return; } catch (e) {}

    state.warming = true;
    var total = list.length, done = 0, failed = 0, next = 0, CONC = 1;
    function worker() {
      if (next >= total) return Promise.resolve();
      var text = list[next++];
      // 单个请求也要有上限，否则网络抽风时这个 worker 会永远卡住
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 90000);
      var opts = ctl ? { signal: ctl.signal } : undefined;
      return fetch('/api/tts?text=' + encodeURIComponent(text), opts).then(function (r) {
        if (!r.ok) failed++;
      }).catch(function () { failed++; }).then(function () {
        clearTimeout(timer);
        done++;
        if (done % 5 === 0 || done === total) {
          setHint('正在把语音存到本地 ' + done + '/' + total + '（只做一次）');
        }
        return worker();
      });
    }
    var jobs = [];
    for (var i = 0; i < Math.min(CONC, total); i++) jobs.push(worker());
    Promise.all(jobs).then(function () {
      state.warming = false;
      // 有失败就不记「完成」，下次进页面自动补一遍（已备好的瞬间跳过）
      if (!failed) { try { localStorage.setItem(key, 'done'); } catch (e) {} }
      setHint(failed ? '有 ' + failed + ' 个语音没存上，点击时会即时合成' : '');
    });
  }

  // 词按钮的时间区间。有逐字时间就按字符下标算（粒度 = App 自己的分词），
  // 只有词级时间时退回字幕的词区间。
  function buildSpans(entry, cue) {
    var ranges = [], cursor = 0;
    (cue.words || []).forEach(function (w) {
      var text = w.w || '';
      if (!text) return;
      var at = cue.text.indexOf(text, cursor);
      if (at < 0) at = cue.text.indexOf(text);
      if (at < 0) return;
      ranges.push({ start: at, end: at + text.length, t0: w.start, t1: w.end });
      cursor = at + text.length;
    });
    entry.wordRanges = ranges;

    // 渲染文字必须和 cue.text 等长，否则字符下标对不上，宁可不用逐字时间
    var spans = [];
    if (entry.ja.textContent.length === cue.text.length) {
      var times = {};
      (cue.chars || []).forEach(function (c) { times[c[0]] = c; });
      Array.prototype.forEach.call(entry.ja.querySelectorAll('.video-study-word'), function (btn) {
        var a = parseInt(btn.getAttribute('data-a'), 10);
        var b = parseInt(btn.getAttribute('data-b'), 10);
        if (!(b > a)) return;
        var t0 = Infinity, t1 = -Infinity;
        for (var i = a; i < b; i++) {
          var c = times[i];
          if (!c) continue;
          if (c[1] < t0) t0 = c[1];
          if (c[2] > t1) t1 = c[2];
        }
        if (t1 > t0) spans.push({ el: btn, t0: t0, t1: t1 });
      });
      // 时间必须随按钮顺序递增，乱序说明数据对不上，整条丢弃
      for (var k = 1; k < spans.length; k++) {
        if (spans[k].t0 < spans[k - 1].t0) { spans = []; break; }
      }
    }
    entry.spans = spans.length > 1 ? spans : [];
  }

  function refreshLines() {
    if (!state.cues.length) return;
    state.pendingTokens = state.els.length;
    state.els.forEach(function (entry, i) { renderTokens(entry, state.cues[i]); });
  }

  // ---------- 播放控制 ----------
  function replay(entry) {
    var video = el('video-study-player');
    if (!video || !video.src) return;
    video.currentTime = entry.start;
    state.stopAt = entry.end;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function onTime() {
    var video = el('video-study-player');
    if (!video) return;
    var t = video.currentTime || 0;
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    var label = el('video-study-time');
    if (label) label.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    if (state.stopAt != null && t >= state.stopAt - 0.02) {
      video.pause();
      state.stopAt = null;
    }
  }

  function loop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    function frame() {
      updateHighlight();
      state.raf = requestAnimationFrame(frame);
    }
    state.raf = requestAnimationFrame(frame);
    var video = el('video-study-player');
    if (video) {
      video.addEventListener('pause', function () {
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        updateHighlight();
      }, { once: true });
    }
  }

  function currentIndex(t) {
    for (var i = 0; i < state.els.length; i++) {
      if (t >= state.els[i].start && t < state.els[i].end) return i;
    }
    return -1;
  }

  // 选当前该罩住的范围：优先逐字时间算出的词按钮，其次字幕的词区间，最后整句。
  // 空档期停在上一个词，不弹回整句 —— 弹回整句就等于没跟。
  function pickRects(entry, t) {
    var spans = entry.spans || [];
    if (spans.length) {
      var cur = null, prev = null;
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i];
        if (t >= s.t0 && t < s.t1) { cur = s; break; }
        if (s.t0 <= t) prev = s;
      }
      cur = cur || prev || spans[0];
      var r = cur.el.getClientRects();
      if (r && r.length) return r;
    }
    var words = entry.wordRanges || [];
    if (words.length) {
      var cw = null, pw = null;
      for (var j = 0; j < words.length; j++) {
        var w = words[j];
        if (t >= w.t0 && t < w.t1) { cw = w; break; }
        if (w.t0 <= t) pw = w;
      }
      cw = cw || pw || words[0];
      var rects = [];
      Array.prototype.forEach.call(entry.ja.querySelectorAll('.video-study-word'), function (btn) {
        var a = parseInt(btn.getAttribute('data-a'), 10);
        var b = parseInt(btn.getAttribute('data-b'), 10);
        if (!(b > a) || b <= cw.start || a >= cw.end) return;
        Array.prototype.push.apply(rects, btn.getClientRects());
      });
      if (rects.length) return rects;
    }
    var range = document.createRange();
    range.selectNodeContents(entry.ja);
    return range.getClientRects();
  }

  function updateHighlight() {
    var video = el('video-study-player');
    var glow = el('video-study-glow');
    if (!video || !glow || !state.els.length) return;
    var t = video.currentTime || 0;
    var i = currentIndex(t);
    if (i < 0) { glow.classList.remove('on'); state.activeIndex = -1; return; }
    var entry = state.els[i];
    var rects = pickRects(entry, t);
    if (!rects || !rects.length) { glow.classList.remove('on'); return; }
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (var k = 0; k < rects.length; k++) {
      left = Math.min(left, rects[k].left);
      top = Math.min(top, rects[k].top);
      right = Math.max(right, rects[k].right);
      bottom = Math.max(bottom, rects[k].bottom);
    }
    var box = el('video-study-transcript');
    var bb = box.getBoundingClientRect();
    var padX = 6, padY = 4;
    glow.style.left = (left - bb.left + box.scrollLeft - padX) + 'px';
    glow.style.top = (top - bb.top + box.scrollTop - padY) + 'px';
    glow.style.width = (right - left + padX * 2) + 'px';
    glow.style.height = (bottom - top + padY * 2) + 'px';
    glow.classList.add('on');
    if (i !== state.activeIndex) {
      state.activeIndex = i;
      if (state.follow) {
        state.els.forEach(function (e, j) { e.li.classList.toggle('active', j === i); });
        var li = entry.li;
        var top = li.offsetTop, bottom = top + li.offsetHeight;
        if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
          box.scrollTop = top - box.clientHeight / 2 + li.offsetHeight / 2;
        }
      }
    } else if (state.follow) {
      entry.li.classList.add('active');
    }
  }

  // ---------- 对外 ----------
  function render() {
    build();
    initTokenizer();
    loadLibrary();
  }

  function stop() {
    var video = el('video-study-player');
    if (video && !video.paused) video.pause();
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.stopAt = null;
    var glow = el('video-study-glow');
    if (glow) glow.classList.remove('on');
  }

  window.VideoStudy = { render: render, stop: stop };
})();
