/**
 * duo.js — 「单词」页的第二个来源：多邻国已学单词
 *
 * 数据由 duo-sync.js（服务端）生成：assets/data/duolingo-words.json
 * 发音用多邻国自己录的原声（assets/audio/duo/*.mp3），不是 Edge 合成音；播放统一走 UI.speakUrl。
 * 汉字形是同步时补的，只补常用且能确定的，歧义的不猜。
 */
(function () {
  'use strict';

  var DATA_URL = 'assets/data/duolingo-words.json';
  var DONE_KEY = 'duo-done';
  var state = { data: null, error: '', syncing: false, message: '', query: '', playing: -1, list: [] };
  var done = {};
  try { done = JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch (e) { done = {}; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function saveDone() {
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch (e) {}
  }
  function keyOf(word) { return word.kanji || word.w; }

  function load(force) {
    return fetch(DATA_URL + (force ? '?t=' + Date.now() : ''))
      .then(function (r) { if (!r.ok) throw new Error('404'); return r.json(); })
      .then(function (json) { state.data = json; state.error = ''; return json; })
      .catch(function () {
        if (!state.data) state.error = '还没有多邻国词表，点「更新」同步一次。';
        return state.data;
      });
  }

  function filtered() {
    var words = (state.data && state.data.words) || [];
    var q = state.query.trim().toLowerCase();
    var list = words.map(function (w, i) { return Object.assign({ _i: i }, w); });
    if (q) {
      list = list.filter(function (w) {
        return w.w.toLowerCase().indexOf(q) >= 0 ||
          String(w.kanji || '').indexOf(q) >= 0 ||
          String(w.zh || '').indexOf(q) >= 0;
      });
    }
    state.list = list;
    return list;
  }

  function play(index) {
    var word = state.list[index];
    state.playing = index;
    if (word && word.audio && window.UI && window.UI.speakUrl) window.UI.speakUrl(word.audio);
    Array.prototype.forEach.call(document.querySelectorAll('.duo-row'), function (row) {
      row.classList.toggle('is-playing', Number(row.getAttribute('data-index')) === state.playing);
    });
  }

  function sync() {
    if (state.syncing) return;
    state.syncing = true;
    state.message = '正在同步，第一次要下载发音，可能要十几秒…';
    render();
    fetch('/api/duo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        state.syncing = false;
        if (!res.ok) { state.message = '同步失败：' + (res.error || '未知错误'); render(); return; }
        state.message = '同步完成：' + res.total + ' 个词，补汉字形 ' + res.withKanji + ' 个，新下载发音 ' + res.audioNew + ' 条';
        return load(true).then(render);
      })
      .catch(function (e) {
        state.syncing = false;
        state.message = '同步失败：' + (e && e.message ? e.message : e);
        render();
      });
  }

  function rowHTML(word, index) {
    var isDone = !!done[keyOf(word)];
    return '<li class="duo-row' + (isDone ? ' is-done' : '') + '" data-index="' + index + '">' +
      '<div class="duo-body">' +
      '<p class="duo-word" lang="ja">' + esc(word.kanji || word.w) + '</p>' +
      (word.kanji ? '<p class="duo-kana" lang="ja">' + esc(word.w) + '</p>' : '') +
      '<p class="duo-zh">' + esc(word.zh) + '</p>' +
      '</div>' +
      '<button type="button" class="duo-speak" aria-label="播放发音">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4 6 8H3v8h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg></button>' +
      '<button type="button" class="duo-mark" aria-pressed="' + isDone + '">' + (isDone ? '已会' : '标记') + '</button>' +
      '</li>';
  }

  function metaHTML() {
    var all = (state.data && state.data.words) || [];
    var doneCount = 0;
    all.forEach(function (w) { if (done[keyOf(w)]) doneCount++; });
    var when = state.data && state.data.syncedAt ? new Date(state.data.syncedAt) : null;
    var whenText = when ? (when.getMonth() + 1) + '月' + when.getDate() + '日 ' +
      ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2) : '';
    if (!all.length) return '还没有数据';
    return '<strong>' + all.length + '</strong> 个词 · 已标记 ' + doneCount + (whenText ? ' · ' + whenText + ' 更新' : '');
  }

  // 只重画列表，输入框保持不动（否则每敲一个字焦点就丢）
  function paintList() {
    var root = document.getElementById('duo-root');
    if (!root) return;
    var meta = root.querySelector('.duo-meta');
    if (meta) meta.innerHTML = metaHTML();
    var msg = root.querySelector('.duo-message');
    if (msg) { msg.textContent = state.message; msg.hidden = !state.message; }
    var wrap = root.querySelector('.duo-list-wrap');
    if (!wrap) return;
    var list = filtered();
    if (state.error) wrap.innerHTML = '<p class="duo-empty">' + esc(state.error) + '</p>';
    else if (!list.length) wrap.innerHTML = '<p class="duo-empty">' + (state.query ? '没有匹配的词' : '词表是空的') + '</p>';
    else wrap.innerHTML = '<ul class="duo-list">' + list.map(rowHTML).join('') + '</ul>';
  }

  function buildShell(root) {
    root.innerHTML = '<div class="duo-head">' +
      '<div class="duo-meta"></div>' +
      '<button type="button" class="btn btn-primary duo-sync">更新</button></div>' +
      '<div class="duo-search-row"><input type="search" class="duo-search" placeholder="搜索假名 / 汉字 / 释义"></div>' +
      '<p class="duo-message" role="status" hidden></p>' +
      '<div class="duo-list-wrap"></div>';
    var input = root.querySelector('.duo-search');
    input.value = state.query;
    input.oninput = function () { state.query = input.value; paintList(); };
    root.querySelector('.duo-sync').onclick = sync;
    root.onclick = function (event) {
      var row = event.target.closest('.duo-row');
      if (!row) return;
      var index = Number(row.getAttribute('data-index'));
      var word = state.list[index];
      if (!word) return;
      if (event.target.closest('.duo-mark')) {
        var k = keyOf(word);
        if (done[k]) delete done[k]; else done[k] = 1;
        saveDone();
        paintList();
        return;
      }
      play(index);
    };
  }

  function render() {
    var root = document.getElementById('duo-root');
    if (!root) return;
    if (!root.querySelector('.duo-search')) buildShell(root);
    var btn = root.querySelector('.duo-sync');
    if (btn) { btn.disabled = state.syncing; btn.textContent = state.syncing ? '同步中…' : '更新'; }
    paintList();
  }

  function ensure() {
    render();
    if (!state.data) load().then(render);
  }

  window.DuoVocab = {
    render: ensure,
    stop: function () { state.playing = -1; if (window.UI && window.UI.stopSpeak) window.UI.stopSpeak(); }
  };
})();
