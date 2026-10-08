/**
 * storage.js — localStorage 封装
 * 负责日语50音学习进度（progress）与统计（stats）的持久化读写。
 * 存储 key：'kana-progress-v1'
 */
(function () {
  var KEY = 'kana-progress-v1';
  var ERR_KEY = 'kana-typing-errors-v1';   // 打字错题本，独立存储，不走 bumpDaily
  var DECAY = 0.8;                         // 错题分每过一天乘 0.8
  var CLEAN_TO_CLEAR = 10;                 // 同一假名连续答对 10 次，错题分清零

  var DEFAULT_KANA = { box: 0, nextReview: null, correctStreak: 0, totalReviews: 0, lastResult: null, studyCount: 0 };

  function defaultData() {
    return {
      progress: {},
      stats: { streakDays: 0, lastStudyDate: null, totalStudied: 0 }
    };
  }

  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 每次假名进度写入记为一次学习，按日期累计到 stats.daily（供热力图使用）
  function bumpDaily(data) {
    if (!data.stats.daily) data.stats.daily = {};
    var key = dateStr(new Date());
    data.stats.daily[key] = (data.stats.daily[key] || 0) + 1;
    data.stats.streakDays = computeStreak(data.stats.daily);
    data.stats.lastStudyDate = key;
  }

  // 从今天（今天没学则从昨天）往回数，连续有学习记录的天数
  function computeStreak(daily) {
    var d = new Date();
    if (!daily[dateStr(d)]) d.setDate(d.getDate() - 1);
    var n = 0;
    while (daily[dateStr(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function dayDiff(from, to) {
    return Math.round((new Date(to) - new Date(from)) / 86400000);
  }

  function loadErrors() {
    try { return JSON.parse(localStorage.getItem(ERR_KEY)) || {}; } catch (e) { return {}; }
  }

  function decayedScore(e, today) {
    if (!e || typeof e !== 'object' || !e.lastDay) return 0;
    return (e.score || 0) * Math.pow(DECAY, Math.max(0, dayDiff(e.lastDay, today)));
  }

  window.Storage = {
    // 读取全部数据，没有则返回初始结构
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return defaultData();
        var data = JSON.parse(raw);
        if (!data.progress) data.progress = {};
        if (!data.stats) data.stats = defaultData().stats;
        return data;
      } catch (e) {
        return defaultData();
      }
    },

    // 保存全部数据
    save: function (data) {
      localStorage.setItem(KEY, JSON.stringify(data));
    },

    // 获取单个假名进度，没有则返回默认值
    getKana: function (hiragana) {
      var p = this.load().progress[hiragana];
      return p ? Object.assign({}, DEFAULT_KANA, p) : Object.assign({}, DEFAULT_KANA);
    },

    // 合并更新单个假名进度
    updateKana: function (hiragana, updates) {
      var data = this.load();
      var p = data.progress[hiragana] || Object.assign({}, DEFAULT_KANA);
      data.progress[hiragana] = Object.assign(p, updates);
      bumpDaily(data);
      this.save(data);
    },

    // 获取统计数据
    getStats: function () {
      return this.load().stats;
    },

    // 每日学习次数：{ 'YYYY-MM-DD': n }
    getDailyCounts: function () {
      return this.load().stats.daily || {};
    },

    dayKey: dateStr,

    // 合并更新统计数据
    updateStats: function (updates) {
      var data = this.load();
      data.stats = Object.assign(data.stats, updates);
      this.save(data);
    },

    // 更新连续学习天数：同一天重复调用不变；昨天学过则连续 +1，否则重新计 1
    updateStreak: function () {
      var data = this.load();
      data.stats.streakDays = computeStreak(data.stats.daily || {});
      this.save(data);
    },

    // 记录一次打字按键结果：ok=true 为完成一个假名（计入每日学习），false 为错键
    recordTypingKey: function (char, ok) {
      var today = dateStr(new Date());
      var errs = loadErrors();
      var e = errs[char];
      if (!e || typeof e !== 'object') e = { attempts: 0, wrong: 0, score: 0, cleanStreak: 0, lastDay: today };
      e.score = decayedScore(e, today);
      e.lastDay = today;
      e.attempts++;
      if (ok) {
        e.cleanStreak++;
        if (e.cleanStreak >= CLEAN_TO_CLEAR) e.score = 0;
      } else {
        e.wrong++;
        e.score += 1;
        e.cleanStreak = 0;
      }
      errs[char] = e;
      localStorage.setItem(ERR_KEY, JSON.stringify(errs));
      if (ok) {
        var data = this.load();
        bumpDaily(data);
        this.save(data);
      }
    },

    // 当前错题分（已按天衰减）>= minScore 的假名：{ 假名: 分数 }
    getWeakKana: function (minScore) {
      var errs = loadErrors(), today = dateStr(new Date()), out = {};
      Object.keys(errs).forEach(function (c) {
        var s = decayedScore(errs[c], today);
        if (s >= minScore) out[c] = s;
      });
      return out;
    },

    clearTypingErrors: function () {
      localStorage.removeItem(ERR_KEY);
    },

    // 重置全部进度（含错题本）
    reset: function () {
      localStorage.removeItem(KEY);
      localStorage.removeItem(ERR_KEY);
    }
  };
})();
