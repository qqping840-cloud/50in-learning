(function () {
  var KEY = 'n5-vocabulary-progress-v1';
  var INTERVALS = [1, 2, 4, 7, 15, 30];

  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function words() {
    var book = (window.WORDBOOKS || []).find(function (b) {
      return b.source && b.source.indexOf('anki-jlpt-decks') !== -1;
    });
    return book ? book.words : [];
  }
  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw === null) return { version: 1, words: {} };
      var data = JSON.parse(raw);
      if (!object(data) || data.version !== 1 || !object(data.words)) {
        return { error: '单词进度格式无法识别，原记录已保留。' };
      }
      return data;
    } catch (e) { return { error: '无法读取单词进度，原记录已保留。' }; }
  }
  function valid(p) {
    return object(p) && Number.isInteger(p.step) && p.step >= 0 && p.step < INTERVALS.length &&
      validTime(p.due) && validTime(p.lastReview) &&
      typeof p.lastSession === 'string' && ['wrong', 'hard', 'good'].indexOf(p.lastGrade) !== -1;
  }
  function time(now) { return now === undefined ? Date.now() : Number(now); }
  function validTime(value) { return Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime()); }
  function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
  function addDays(now, days) {
    var date = new Date(now);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }
  function tasks(now) {
    now = time(now);
    var data = read(), due = [], unseen = [];
    if (data.error) return { due: [], new: [], error: data.error };
    if (!validTime(now)) return { due: [], new: [], error: '复习时间无效。' };
    words().forEach(function (word) {
      var p = data.words[word.id];
      if (!valid(p)) unseen.push(word.id);
      else if (p.due <= now) due.push(word.id);
    });
    due.sort(function (a, b) { return data.words[a].due - data.words[b].due; });
    return { due: due, new: unseen };
  }

  window.WordSRS = {
    getTasks: tasks,
    getProgress: function (id) {
      var data = read();
      return !data.error && valid(data.words[id]) ? data.words[id] : null;
    },
    getSummary: function (now) {
      var list = tasks(now);
      return { due: list.due.length, learned: list.error ? 0 : words().length - list.new.length,
        unseen: list.new.length, error: list.error };
    },
    grade: function (id, result, sessionId, now) {
      now = time(now);
      if (!words().some(function (w) { return w.id === id; }) ||
          ['wrong', 'hard', 'good'].indexOf(result) === -1 ||
          typeof sessionId !== 'string' || !sessionId || !validTime(now) || !validTime(addDays(now, 30))) {
        return { saved: false, error: '单词或评分无效。', progress: null };
      }
      var data = read();
      if (data.error) return { saved: false, error: data.error, progress: null };
      var old = valid(data.words[id]) ? data.words[id] : null;
      var p = { step: 0, due: addDays(now, 1), lastReview: now, lastSession: sessionId, lastGrade: result };
      if (old) {
        p.step = old.step;
        p.due = old.due;
        p.lastReview = old.lastReview;
        p.lastSession = old.lastSession;
        p.lastGrade = old.lastGrade;
        // Only an overdue review on a later calendar day can advance the interval.
        if (result === 'wrong') {
          p.step = 0;
          p.due = old.due <= now ? addDays(now, 1) : Math.min(old.due, addDays(now, 1));
          p.lastReview = now;
          p.lastSession = sessionId;
          p.lastGrade = result;
        } else if (old.due <= now && !sameDay(old.lastReview, now) && old.lastSession !== sessionId) {
          p.step = result === 'good' ? Math.min(old.step + 1, INTERVALS.length - 1) : Math.max(old.step - 1, 0);
          p.due = addDays(now, INTERVALS[p.step]);
          p.lastReview = now;
          p.lastSession = sessionId;
          p.lastGrade = result;
        }
      }
      data.words[id] = p;
      try { window.localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) { return { saved: false, error: '单词进度未保存，请检查浏览器存储空间。', progress: old }; }
      return { saved: true, progress: p };
    }
  };
})();
