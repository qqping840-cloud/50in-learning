/**
 * srs.js — Leitner 盒子间隔重复算法
 * 依赖全局：window.KANA_DATA / window.ROWS / window.ROW_INFO（data.js 提供）、window.Storage（storage.js 提供）
 * 盒子 0=未学，1=每天，2=2天，3=4天，4=7天，5=15天（已掌握）
 */
(function () {
  var BOX_INTERVALS = [0, 1, 2, 4, 7, 15]; // 索引即盒子号

  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return dateStr(new Date()); }
  function addDaysStr(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return dateStr(d);
  }

  function kanaOfRow(row) {
    return window.KANA_DATA.filter(function (k) { return k.row === row; });
  }

  window.SRS = {
    BOX_INTERVALS: BOX_INTERVALS,

    // 今日任务：到期复习 + （复习压力不大时）当前行最多 5 个新假名
    getTodayTasks: function () {
      var today = todayStr();
      var review = [];
      window.KANA_DATA.forEach(function (k) {
        var p = window.Storage.getKana(k.hiragana);
        if (p.box >= 1 && p.nextReview && p.nextReview <= today) review.push(k.hiragana);
      });

      var row = this.getCurrentRow();
      var newKana = [];
      if (review.length < 30 && row) {
        var inRow = kanaOfRow(row);
        for (var i = 0; i < inRow.length && newKana.length < 5; i++) {
          if (window.Storage.getKana(inRow[i].hiragana).box === 0) newKana.push(inRow[i].hiragana);
        }
      }

      var rowName = null;
      if (row) {
        var info = window.ROW_INFO && window.ROW_INFO[row];
        rowName = (info && info.name) || (kanaOfRow(row)[0].hiragana + '行');
      }
      return { review: review, new: newKana, currentRow: row, currentRowName: rowName };
    },

    // 答对：升盒子（上限 5），按新盒子间隔排下次复习
    markCorrect: function (hiragana) {
      var p = window.Storage.getKana(hiragana);
      var box = Math.min(p.box + 1, 5);
      window.Storage.updateKana(hiragana, {
        box: box,
        nextReview: addDaysStr(BOX_INTERVALS[box]),
        correctStreak: p.correctStreak + 1,
        totalReviews: p.totalReviews + 1,
        lastResult: true
      });
    },

    // 答错：掉回盒子 1，明天再复习
    markWrong: function (hiragana) {
      var p = window.Storage.getKana(hiragana);
      window.Storage.updateKana(hiragana, {
        box: 1,
        nextReview: addDaysStr(1),
        correctStreak: 0,
        totalReviews: p.totalReviews + 1,
        lastResult: false
      });
    },

    // 当前学习行：ROWS 顺序中第一个仍有 box === 0 假名的行；全部学完返回 null
    getCurrentRow: function () {
      var rows = window.ROWS;
      for (var i = 0; i < rows.length; i++) {
        var hasNew = kanaOfRow(rows[i]).some(function (k) {
          return window.Storage.getKana(k.hiragana).box === 0;
        });
        if (hasNew) return rows[i];
      }
      return null;
    },

    // 某行是否已解锁：它之前的所有行，所有假名 box >= 1
    isRowUnlocked: function (row) {
      var idx = window.ROWS.indexOf(row);
      if (idx <= 0) return idx === 0;
      for (var i = 0; i < idx; i++) {
        var allStarted = kanaOfRow(window.ROWS[i]).every(function (k) {
          return window.Storage.getKana(k.hiragana).box >= 1;
        });
        if (!allStarted) return false;
      }
      return true;
    },

    // 已掌握数量（box >= 5）
    getMasteredCount: function () {
      return window.KANA_DATA.filter(function (k) {
        return window.Storage.getKana(k.hiragana).box >= 5;
      }).length;
    },

    // 学习中数量（box 1-4）
    getLearningCount: function () {
      return window.KANA_DATA.filter(function (k) {
        var b = window.Storage.getKana(k.hiragana).box;
        return b >= 1 && b <= 4;
      }).length;
    },

    // 记录一次学习接触（学习页学会/练习答对/测验答对时调用），studyCount + 1
    recordStudy: function (hiragana) {
      var p = window.Storage.getKana(hiragana);
      window.Storage.updateKana(hiragana, { studyCount: (p.studyCount || 0) + 1 });
    },

    // 开始学习某个假名：box=1，今天复习
    startLearning: function (hiragana) {
      window.Storage.updateKana(hiragana, { box: 1, nextReview: todayStr() });
    },

    // 某行是否完成：所有假名 box >= 2
    isRowComplete: function (row) {
      return kanaOfRow(row).every(function (k) {
        return window.Storage.getKana(k.hiragana).box >= 2;
      });
    },

    // 某行进度：{ total, learned(box>=1), mastered(box>=5) }
    getRowProgress: function (row) {
      var total = 0, learned = 0, mastered = 0;
      kanaOfRow(row).forEach(function (k) {
        total++;
        var b = window.Storage.getKana(k.hiragana).box;
        if (b >= 1) learned++;
        if (b >= 5) mastered++;
      });
      return { total: total, learned: learned, mastered: mastered };
    }
  };
})();
