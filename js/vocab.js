/* N5 vocabulary sessions; progress is saved by WordSRS after each answer. */
(function () {
  'use strict';
  var session = null;
  var words = [], byId = {}, formCounts = {};
  var showRomaji = true, exampleRomaji = {};
  var exampleContainer = null;
  try { showRomaji = localStorage.getItem('vocab-romaji') !== 'off'; } catch (e) {}

  function romaji(kana) {
    var library = window.Kuroshiro && (window.Kuroshiro.default || window.Kuroshiro);
    return library ? library.Util.kanaToRomaji(kana) : '';
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function form(word) { return word.kanji || word.kana; }
  function shuffle(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), item = copy[i];
      copy[i] = copy[j]; copy[j] = item;
    }
    return copy;
  }
  function loadWords() {
    if (words.length) return;
    var book = (window.WORDBOOKS || []).find(function (b) {
      return b.level === 'N5' && String(b.source || '').indexOf('anki-jlpt-decks') !== -1;
    });
    words = book ? book.words : [];
    words.forEach(function (word) {
      byId[word.id] = word;
      formCounts[form(word)] = (formCounts[form(word)] || 0) + 1;
    });
  }
  function button(action, text, style, disabled) {
    return '<button type="button" class="btn ' + (style || 'btn-secondary') + '" data-vocab="' + action + '"' +
      (disabled ? ' disabled' : '') + '>' + esc(text) + '</button>';
  }
  function exampleText(text) {
    return Array.from(text).map(function (ch) {
      return /[\s、。！？，．「」『』（）・：；…]/.test(ch) ? esc(ch) : '<span class="reading-char">' + esc(ch) + '</span>';
    }).join('');
  }
  function stopRead() {
    if (exampleContainer && window.Reading && window.Reading.stopExample) window.Reading.stopExample(exampleContainer);
    exampleContainer = null;
  }
  function details(word) {
    return '<div class="vocab-details"><p class="vocab-meaning">' + esc(word.zh) + '</p>' +
      (word.pos ? '<p class="vocab-pos">' + esc(word.pos) + '</p>' : '') +
      (word.ex ? '<div class="vocab-example"><div class="vocab-example-row"><div class="vocab-example-stage"><p class="vocab-example-text" lang="ja">' + exampleText(word.ex.ja) + '</p></div>' +
        '<button type="button" class="vocab-example-speak" data-vocab="speak-example" aria-label="播放例句发音">播放</button></div>' +
        (showRomaji ? '<p class="vocab-romaji" data-romaji-example="' + esc(word.ex.ja) + '"></p>' : '') +
        '<p>' + esc(word.ex.zh) + '</p></div>' : '') + '</div>';
  }
  function wordCard(word, showDetails, disambiguate) {
    return '<div class="vocab-card"><div class="vocab-word-row"><div><p class="vocab-word" lang="ja">' + esc(form(word)) + '</p>' +
      (word.kanji ? '<p class="vocab-kana" lang="ja">' + esc(word.kana) + '</p>' : '') +
      (showRomaji ? '<p class="vocab-romaji">' + esc(romaji(word.kana)) + '</p>' : '') + '</div>' +
      '<button type="button" class="vocab-speak" data-vocab="speak" aria-label="播放单词发音">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4 6 8H3v8h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg></button></div>' +
      (disambiguate && formCounts[form(word)] > 1 && word.ex ? '<p class="vocab-context" lang="ja">' + esc(word.ex.ja) + '</p>' : '') +
      (showDetails ? details(word) : '') + '</div>';
  }
  function optionsFor(word) {
    var meanings = [word.zh];
    shuffle(words).some(function (candidate) {
      if (candidate.kana !== word.kana && form(candidate) !== form(word) && meanings.indexOf(candidate.zh) === -1) meanings.push(candidate.zh);
      return meanings.length === 4;
    });
    return shuffle(meanings);
  }
  function start(mode) {
    var tasks = window.WordSRS.getTasks(), ids;
    if (tasks.error) { render(true); return; }
    if (mode === 'learn') ids = tasks.new.slice(0, 10);
    else if (mode === 'review') ids = tasks.due.slice(0, 10);
    else {
      var learned = words.filter(function (w) { return !!window.WordSRS.getProgress(w.id); });
      ids = shuffle(learned.length ? learned : words).slice(0, 10).map(function (w) { return w.id; });
    }
    ids = ids.filter(function (id) { return !!byId[id]; });
    if (!ids.length) return;
    session = {
      id: 'vocab-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      mode: mode, phase: mode === 'learn' ? 'learn' : 'quiz',
      ids: ids, queue: ids.map(function (id) { return { id: id, retry: false }; }),
      index: 0, learnIndex: 0, revealed: false, selected: null, grade: null,
      saved: false, saving: false, error: '', correct: 0, wrong: 0, hard: 0, retried: {}, options: null
    };
    render(true);
  }
  function currentWord() {
    return byId[session.phase === 'learn' ? session.ids[session.learnIndex] : session.queue[session.index].id];
  }
  function saveAnswer() {
    if (!session || session.saving || session.saved || !session.grade) return;
    session.saving = true;
    var result;
    try {
      result = window.WordSRS.grade(currentWord().id, session.grade, session.id);
    } catch (e) {
      result = { saved: false, error: e.message };
    }
    session.saving = false;
    if (!result || !result.saved) {
      session.error = '保存失败。' + (result && result.error ? result.error : '请重试。');
      render(true);
      return;
    }
    session.saved = true;
    session.error = '';
    var item = session.queue[session.index];
    if (!item.retry) {
      if (session.grade === 'good') session.correct++;
      else if (session.grade === 'hard') session.hard++;
      else session.wrong++;
      if (session.grade === 'wrong' && !session.retried[item.id]) {
        session.retried[item.id] = true;
        // The same session id keeps this correction from advancing the review interval again.
        session.queue.splice(Math.min(session.index + 4, session.queue.length), 0, { id: item.id, retry: true });
      }
    }
    render(true);
  }
  function submit(grade, selected) {
    if (!session || session.grade || session.phase !== 'quiz') return;
    if (session.mode === 'review' && !session.revealed) return;
    session.selected = selected == null ? null : selected;
    session.grade = grade;
    session.revealed = true;
    saveAnswer();
  }
  function advance() {
    if (!session) return;
    if (session.phase === 'learn') {
      if (!session.revealed) return;
      session.learnIndex++;
      if (session.learnIndex === session.ids.length) session.phase = 'quiz';
    } else {
      if (!session.saved) return;
      session.index++;
      if (session.index === session.queue.length) session.phase = 'done';
    }
    session.revealed = false; session.selected = null; session.grade = null;
    session.saved = false; session.error = ''; session.options = null;
    render(true);
  }
  function homeHTML() {
    var summary = window.WordSRS.getSummary();
    return '<div class="vocab-home"><h2 tabindex="-1">N5 单词</h2>' +
      (summary.error ? '<p class="vocab-save-error" role="alert">' + esc(summary.error) + '</p>' : '') + '<div class="vocab-stats">' +
      '<div><strong>' + esc(summary.learned) + '</strong><span>已学</span></div>' +
      '<div><strong>' + esc(summary.due) + '</strong><span>待复习</span></div>' +
      '<div><strong>' + esc(summary.unseen) + '</strong><span>新词</span></div></div>' +
      '<div class="vocab-home-actions">' + button('learn', '学习新词', 'btn-primary', !!summary.error || !summary.unseen) +
      button('quiz', '测验', 'btn-secondary', !!summary.error) + button('review', '到期复习', 'btn-secondary', !!summary.error || !summary.due) + '</div></div>';
  }
  function sessionHTML() {
    if (session.phase === 'done') {
      var review = session.mode === 'review';
      return '<div class="vocab-result"><h2 tabindex="-1">本组完成</h2>' +
        '<p class="vocab-result-score">' + (review ? '记得 ' : '答对 ') + session.correct + ' / ' + session.ids.length + '</p>' +
        (review ? '<p>模糊 ' + session.hard + ' · 忘了 ' + session.wrong + '</p>' : '') +
        button('home', '返回', 'btn-primary') + '</div>';
    }
    var word = currentWord(), learning = session.phase === 'learn', review = session.mode === 'review';
    var item = learning ? null : session.queue[session.index];
    var heading = learning ? '学习新词' : review ? '到期复习' : '测验';
    var count = learning ? session.learnIndex + 1 : session.queue.slice(0, session.index + 1).filter(function (q) { return !q.retry; }).length;
    var html = '<div class="vocab-session"><div class="vocab-session-top">' + button('home', '返回', 'vocab-back') +
      '<h2 tabindex="-1">' + heading + '</h2><span>' + (item && item.retry ? '再练' : count + ' / ' + session.ids.length) + '</span></div>' +
      '<progress class="vocab-progress" max="' + session.ids.length + '" value="' + (learning ? session.learnIndex : count - (item && item.retry ? 0 : 1)) + '" aria-label="本组进度"></progress>';
    html += wordCard(word, learning || review ? session.revealed : false, !learning);
    if (learning) {
      html += '<div class="vocab-actions">' + (session.revealed ? button('next', session.learnIndex === session.ids.length - 1 ? '开始测验' : '下一词', 'btn-primary') : button('reveal', '查看释义', 'btn-primary')) + '</div>';
    } else if (review) {
      if (!session.revealed) html += '<div class="vocab-actions">' + button('reveal', '查看答案', 'btn-primary') + '</div>';
      else html += '<div class="vocab-ratings">' + button('wrong', '忘了', 'btn-error', !!session.grade) + button('hard', '模糊', 'btn-secondary', !!session.grade) + button('good', '记得', 'btn-success', !!session.grade) + '</div>';
    } else {
      if (!session.options) session.options = optionsFor(word);
      html += '<div class="vocab-options" aria-label="选择中文释义">';
      session.options.forEach(function (meaning, i) {
        var status = session.grade ? meaning === word.zh ? ' is-correct' : session.selected === i ? ' is-wrong' : '' : '';
        html += '<button type="button" class="vocab-option' + status + '" data-vocab="answer" data-index="' + i + '"' + (session.grade ? ' disabled' : '') + '><span class="vocab-option-number" aria-hidden="true">' + (i + 1) + '</span><span>' + esc(meaning) + '</span></button>';
      });
      html += '</div>';
      if (session.grade) html += '<div class="vocab-feedback" role="status">' + (session.grade === 'good' ? '答对了' : '正确答案：' + esc(word.zh)) + '</div>' + details(word);
    }
    if (session.error) html += '<div class="vocab-save-error" role="alert">' + esc(session.error) + '</div><div class="vocab-actions">' + button('save', '重试保存', 'btn-primary') + '</div>';
    else if (session.saved) html += '<div class="vocab-actions">' + button('next', session.index === session.queue.length - 1 ? '完成' : '下一词', 'btn-primary') + '</div>';
    return html + '</div>';
  }
  function handleClick(event) {
    var target = event.target.closest('[data-vocab]');
    if (!target || target.disabled) return;
    var action = target.getAttribute('data-vocab');
    if (action === 'romaji') {
      showRomaji = !showRomaji;
      try { localStorage.setItem('vocab-romaji', showRomaji ? 'on' : 'off'); } catch (e) {}
      render();
      document.querySelector('#page-vocab [data-vocab="romaji"]').focus();
    }
    else if (action === 'home') { session = null; render(true); }
    else if (action === 'learn' || action === 'quiz' || action === 'review') start(action);
    else if (action === 'speak') { stopRead(); if (session && window.UI && window.UI.speak) window.UI.speak(currentWord().kana); }
    else if (action === 'speak-example') {
      if (session && currentWord().ex && window.Reading && window.Reading.playExample) {
        if (window.UI && window.UI.stopSpeak) window.UI.stopSpeak();
        exampleContainer = target.closest('.vocab-example').querySelector('.vocab-example-text');
        window.Reading.playExample(exampleContainer, currentWord().ex.ja, target);
      }
    }
    else if (action === 'reveal') { if (session) { session.revealed = true; render(true); } }
    else if (action === 'next') advance();
    else if (action === 'save') saveAnswer();
    else if (action === 'answer') {
      var index = Number(target.getAttribute('data-index'));
      submit(session.options[index] === currentWord().zh ? 'good' : 'wrong', index);
    } else if (action === 'wrong' || action === 'hard' || action === 'good') submit(action);
  }
  function render(focus) {
    var page = document.getElementById('page-vocab');
    if (!page) return;
    stopRead();
    loadWords();
    if (!words.length || !window.WordSRS) {
      page.innerHTML = '<p role="alert">单词数据未能加载，请刷新页面。</p>';
      return;
    }
    page.innerHTML = '<div class="vocab-toolbar"><button type="button" class="vocab-romaji-toggle" data-vocab="romaji" role="switch" aria-checked="' + showRomaji + '"><span>罗马音</span><span class="vocab-toggle-track" aria-hidden="true"></span></button></div>' +
      (session ? sessionHTML() : homeHTML());
    page.onclick = handleClick;
    if (showRomaji && window.Reading && window.Reading.toRomaji) {
      page.querySelectorAll('[data-romaji-example]').forEach(function (node) {
        var text = node.getAttribute('data-romaji-example');
        if (!exampleRomaji[text]) exampleRomaji[text] = window.Reading.toRomaji(text);
        exampleRomaji[text].then(function (value) {
          if (node.isConnected && showRomaji && value) node.textContent = value;
          if (!value) delete exampleRomaji[text];
        });
      });
    }
    if (focus === true) {
      var next = page.querySelector('[data-vocab="save"], [data-vocab="next"], [data-vocab="reveal"], .vocab-option:not(:disabled), [data-vocab="wrong"]:not(:disabled)') || page.querySelector('h2');
      if (next) next.focus();
    }
  }
  window.addEventListener('pagehide', stopRead);
  window.Vocab = { render: render, stopRead: stopRead };
})();
