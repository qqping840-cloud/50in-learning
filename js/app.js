/**
 * app.js — 主入口
 * 负责初始化、底部导航绑定、页面切换调度。
 * 依赖全局：Storage, UI
 */
(function () {

  // 页面名 → 对应的渲染函数
  var RENDERERS = {
    home: function () { UI.renderHome(); },
    learn: function () { UI.renderLearn(); },
    chart: function () { UI.renderChart(); },
    practice: function () { UI.renderPractice(); },
    quiz: function () { UI.renderQuiz(); },
    reading: function () { UI.renderReading(); }
  };

  // 切换页面：更新显示、导航状态，并调用对应渲染
  function navigate(page) {
    if (!RENDERERS[page]) page = 'home';
    UI.showPage(page);
    RENDERERS[page]();
  }

  // 初始化
  function init() {
    // 初始化主题（跟随系统）
    UI.initTheme();

    // 更新连续学习天数
    Storage.updateStreak();

    // 绑定底部导航点击事件
    var navBtns = document.querySelectorAll('#bottom-nav .nav-btn');
    Array.prototype.forEach.call(navBtns, function (btn) {
      btn.onclick = function () {
        navigate(btn.getAttribute('data-page'));
      };
    });

    // 默认显示首页
    UI.showPage('home');
    UI.renderHome();
    UI.updateStreakDisplay();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.App = {
    init: init,
    navigate: navigate
  };
})();
