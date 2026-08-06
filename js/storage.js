/**
 * storage.js — localStorage 封装
 * 负责日语50音学习进度（progress）与统计（stats）的持久化读写。
 * 存储 key：'kana-progress-v1'
 */
(function () {
  var KEY = 'kana-progress-v1';

  var DEFAULT_KANA = { box: 0, nextReview: null, correctStreak: 0, totalReviews: 0, lastResult: null };

  function defaultData() {
    return {
      progress: {},
      stats: { streakDays: 0, lastStudyDate: null, totalStudied: 0 }
    };
  }

  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
      this.save(data);
    },

    // 获取统计数据
    getStats: function () {
      return this.load().stats;
    },

    // 合并更新统计数据
    updateStats: function (updates) {
      var data = this.load();
      data.stats = Object.assign(data.stats, updates);
      this.save(data);
    },

    // 更新连续学习天数：同一天重复调用不变；昨天学过则连续 +1，否则重新计 1
    updateStreak: function () {
      var stats = this.getStats();
      var today = dateStr(new Date());
      if (stats.lastStudyDate === today) return;
      var y = new Date();
      y.setDate(y.getDate() - 1);
      var streak = (stats.lastStudyDate === dateStr(y)) ? (stats.streakDays || 0) + 1 : 1;
      this.updateStats({ streakDays: streak, lastStudyDate: today });
    },

    // 重置全部进度
    reset: function () {
      localStorage.removeItem(KEY);
    }
  };
})();
