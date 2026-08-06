/**
 * ui.js — 渲染逻辑
 * 负责四个页面（首页/学习/练习/测验）的 DOM 渲染与发音。
 * 依赖全局：KANA_DATA, ROWS, ROW_INFO, getKanaByRow, getKana, Storage, SRS, App
 */
(function () {

  // ---------- 内部工具 ----------

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 洗牌（返回新数组）
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 从全部假名里随机取 n 个干扰项（排除 exclude）
  function pickDistractors(exclude, n) {
    var pool = KANA_DATA.filter(function (k) { return k.hiragana !== exclude.hiragana; });
    return shuffle(pool).slice(0, n);
  }

  // ---------- 模块状态 ----------

  var state = {
    // 学习页
    learnRow: null,          // 当前学习的行 id
    learnIndex: 0,           // 行内索引
    // 练习页
    practiceMode: 'forward', // forward=看假名想读音, reverse=听发音想字形
    practiceKana: null,      // 当前卡片假名
    practiceFlipped: false,
    // 测验页
    quizTotal: 10,
    quizIndex: 0,
    quizScore: 0,
    quizCurrent: null,       // { kana, type, options, answer }
    quizLocked: false
  };

  // ---------- 发音 ----------

  // ---------- 发音 ----------
  // 预加载日语 voice，降低首次发音延迟
  var jaVoice = null;
  var voiceReady = false;
  function loadVoices() {
    if (!window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;
    // 优先选日语 voice
    jaVoice = voices.find(function (v) { return /ja[-_]JP/i.test(v.lang); }) ||
              voices.find(function (v) { return /^ja/i.test(v.lang); }) || null;
    voiceReady = true;
  }
  // 立即尝试 + 监听异步加载完成
  loadVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  // 预热引擎：静默发音一次，让浏览器加载语音引擎
  var warmed = false;
  function warmUp() {
    if (warmed || !window.speechSynthesis) return;
    warmed = true;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.lang = 'ja-JP';
      u.volume = 0;
      u.rate = 1;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    } catch (e) { /* ignore */ }
  }

  function speak(text) {
    if (!window.speechSynthesis) return;
    warmUp();
    window.speechSynthesis.cancel(); // 先取消，避免重叠
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (jaVoice) u.voice = jaVoice;
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }

  // ---------- 页面切换 ----------

  function showPage(pageName) {
    ['home', 'learn', 'practice', 'quiz'].forEach(function (p) {
      var page = el('page-' + p);
      if (page) page.classList.toggle('active', p === pageName);
    });
    // 更新底部导航 active 状态
    var navBtns = document.querySelectorAll('#bottom-nav .nav-btn');
    Array.prototype.forEach.call(navBtns, function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page') === pageName);
    });
  }

  // ---------- 连续天数 ----------

  function updateStreakDisplay() {
    var box = el('streak-display');
    if (!box) return;
    var stats = Storage.getStats();
    box.textContent = '连续学习 ' + (stats.streakDays || 0) + ' 天';
  }

  // ---------- 首页 ----------

  function renderHome() {
    renderProgressOverview();
    renderTodayTasks();
    renderRowMap();
  }

  // 进度总览：大进度环 + 三个数字
  function renderProgressOverview() {
    var box = el('progress-overview');
    if (!box) return;
    var mastered = SRS.getMasteredCount();
    var learning = SRS.getLearningCount();
    var total = KANA_DATA.length;
    var notStarted = total - mastered - learning;
    var pct = total ? Math.round(mastered / total * 100) : 0;
    box.innerHTML =
      '<div class="progress-ring" style="--pct:' + pct + '">' +
        '<div class="progress-ring-inner">' +
          '<div class="progress-big">' + mastered + '<span class="progress-total">/' + total + '</span></div>' +
          '<div class="progress-label">已掌握</div>' +
        '</div>' +
      '</div>' +
      '<div class="progress-numbers">' +
        '<div class="pn-item"><div class="pn-num mastered">' + mastered + '</div><div class="pn-label">已掌握</div></div>' +
        '<div class="pn-item"><div class="pn-num learning">' + learning + '</div><div class="pn-label">学习中</div></div>' +
        '<div class="pn-item"><div class="pn-num not-started">' + notStarted + '</div><div class="pn-label">未学</div></div>' +
      '</div>';
  }

  // 今日任务卡片
  function renderTodayTasks() {
    var box = el('today-tasks');
    if (!box) return;
    var tasks = SRS.getTodayTasks();
    box.innerHTML =
      '<h2 class="section-title">今日任务</h2>' +
      '<div class="task-list">' +
        '<div class="task-item">复习 <b>' + tasks.review.length + '</b> 个假名</div>' +
        '<div class="task-item">新学 <b>' + tasks.new.length + '</b> 个假名（' + esc(tasks.currentRowName) + '）</div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-start-learn">开始学习</button>';
    el('btn-start-learn').onclick = function () {
      state.learnRow = tasks.currentRow;
      state.learnIndex = 0;
      App.navigate('learn');
    };
  }

  // 学习路径地图：27 行
  function renderRowMap() {
    var box = el('row-map');
    if (!box) return;
    var currentRow = SRS.getCurrentRow();
    var html = '<h2 class="section-title">学习路径</h2><div class="row-grid">';
    ROWS.forEach(function (row) {
      var info = ROW_INFO[row];
      var prog = SRS.getRowProgress(row);
      var cls = 'row-cell';
      if (SRS.isRowComplete(row)) cls += ' done';            // 已完成：绿色
      else if (row === currentRow) cls += ' current';        // 当前行：高亮+脉动
      else if (!SRS.isRowUnlocked(row)) cls += ' locked';    // 未解锁：灰色
      html +=
        '<div class="' + cls + '" data-row="' + esc(row) + '">' +
          '<div class="row-name">' + esc(info.name) + '</div>' +
          '<div class="row-prog">' + prog.learned + '/' + prog.total + '</div>' +
        '</div>';
    });
    html += '</div>';
    box.innerHTML = html;

    // 点击已解锁的行进入学习
    Array.prototype.forEach.call(box.querySelectorAll('.row-cell'), function (cell) {
      cell.onclick = function () {
        var row = cell.getAttribute('data-row');
        if (!SRS.isRowUnlocked(row)) return;
        state.learnRow = row;
        state.learnIndex = 0;
        App.navigate('learn');
      };
    });
  }

  // ---------- 学习页 ----------

  function renderLearn() {
    var header = el('learn-header');
    var card = el('kana-card-display');
    var controls = el('learn-controls');
    if (!header || !card || !controls) return;

    // 默认进入当前行
    if (!state.learnRow) {
      state.learnRow = SRS.getCurrentRow();
      state.learnIndex = 0;
    }
    var kanaList = getKanaByRow(state.learnRow);
    if (!kanaList.length) { App.navigate('home'); return; }
    if (state.learnIndex >= kanaList.length) state.learnIndex = 0;

    var info = ROW_INFO[state.learnRow];
    var kana = kanaList[state.learnIndex];

    // 题头：行名 + 进度
    header.innerHTML =
      '<div class="learn-row-name">' + esc(info.name) + '</div>' +
      '<div class="learn-progress-text">第 ' + (state.learnIndex + 1) + ' 个 / 共 ' + kanaList.length + ' 个</div>';

    // 假名卡片：平假名左、片假名右、罗马音下、发音按钮
    card.innerHTML =
      '<div class="kana-pair">' +
        '<div class="kana-char hiragana">' + esc(kana.hiragana) + '</div>' +
        '<div class="kana-char katakana">' + esc(kana.katakana) + '</div>' +
      '</div>' +
      '<div class="kana-romaji">' + esc(kana.romaji) + '</div>' +
      '<button class="btn btn-speak" id="btn-learn-speak">🔊 发音</button>';

    // 控制按钮
    controls.innerHTML =
      '<button class="btn" id="btn-learn-prev">上一个</button>' +
      '<button class="btn btn-primary" id="btn-learn-know">学会了</button>' +
      '<button class="btn" id="btn-learn-next">下一个</button>';

    // 事件绑定
    el('btn-learn-speak').onclick = function (e) {
      e.stopPropagation();
      speak(kana.hiragana);
    };
    card.onclick = function () { speak(kana.hiragana); }; // 点卡片也发音
    el('btn-learn-prev').onclick = function () {
      if (state.learnIndex > 0) { state.learnIndex--; renderLearn(); }
    };
    el('btn-learn-next').onclick = function () {
      if (state.learnIndex < kanaList.length - 1) { state.learnIndex++; renderLearn(); }
    };
    el('btn-learn-know').onclick = function () {
      SRS.startLearning(kana.hiragana); // 标记认识，进入 SRS
      if (state.learnIndex < kanaList.length - 1) {
        state.learnIndex++;
        renderLearn();
      } else {
        App.navigate('home'); // 本行学完，回首页
      }
    };
  }

  // ---------- 练习页 ----------

  // 从今日复习队列或当前行中随机取一个假名
  function pickPracticeKana() {
    var tasks = SRS.getTodayTasks();
    var pool = tasks.review.length ? tasks.review : getKanaByRow(SRS.getCurrentRow());
    if (!pool.length) pool = KANA_DATA;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function renderPractice() {
    var modeSwitch = el('practice-mode-switch');
    var card = el('flashcard');
    var controls = el('practice-controls');
    if (!modeSwitch || !card || !controls) return;

    // 没有当前卡片或刚答完，取新题
    if (!state.practiceKana) state.practiceKana = pickPracticeKana();
    var kana = state.practiceKana;

    // 模式切换
    modeSwitch.innerHTML =
      '<button class="btn mode-btn' + (state.practiceMode === 'forward' ? ' active' : '') + '" data-mode="forward">看假名想读音</button>' +
      '<button class="btn mode-btn' + (state.practiceMode === 'reverse' ? ' active' : '') + '" data-mode="reverse">听发音想字形</button>';

    // 翻卡区域
    var front, back;
    if (state.practiceMode === 'forward') {
      front = '<div class="flashcard-face"><div class="kana-char big">' + esc(kana.hiragana) + '</div></div>';
    } else {
      front = '<div class="flashcard-face"><button class="btn btn-speak" id="btn-practice-speak">🔊 播放发音</button></div>';
    }
    back =
      '<div class="flashcard-face flashcard-back">' +
        '<div class="kana-pair">' +
          '<div class="kana-char hiragana">' + esc(kana.hiragana) + '</div>' +
          '<div class="kana-char katakana">' + esc(kana.katakana) + '</div>' +
        '</div>' +
        '<div class="kana-romaji">' + esc(kana.romaji) + '</div>' +
        '<button class="btn btn-speak" id="btn-practice-speak-back">🔊 发音</button>' +
      '</div>';
    card.className = state.practiceFlipped ? 'flipped' : '';
    card.innerHTML =
      '<div class="flashcard-inner">' + front + back + '</div>';

    // 控制按钮
    controls.innerHTML =
      '<button class="btn btn-wrong" id="btn-practice-wrong">答错了</button>' +
      '<button class="btn btn-right" id="btn-practice-right">答对了</button>';

    // 事件绑定
    Array.prototype.forEach.call(modeSwitch.querySelectorAll('.mode-btn'), function (btn) {
      btn.onclick = function () {
        state.practiceMode = btn.getAttribute('data-mode');
        state.practiceFlipped = false;
        state.practiceKana = pickPracticeKana();
        renderPractice();
      };
    });
    card.onclick = function () { // 点击翻面
      state.practiceFlipped = !state.practiceFlipped;
      card.classList.toggle('flipped', state.practiceFlipped);
    };
    var speakBtn = el('btn-practice-speak');
    if (speakBtn) speakBtn.onclick = function (e) { e.stopPropagation(); speak(kana.hiragana); };
    var speakBackBtn = el('btn-practice-speak-back');
    if (speakBackBtn) speakBackBtn.onclick = function (e) { e.stopPropagation(); speak(kana.hiragana); };

    // 反向模式自动播放一次发音
    if (state.practiceMode === 'reverse' && !state.practiceFlipped) speak(kana.hiragana);

    el('btn-practice-right').onclick = function () {
      SRS.markCorrect(kana.hiragana);
      nextPractice();
    };
    el('btn-practice-wrong').onclick = function () {
      SRS.markWrong(kana.hiragana);
      nextPractice();
    };
  }

  function nextPractice() {
    state.practiceKana = pickPracticeKana();
    state.practiceFlipped = false;
    renderPractice();
  }

  // ---------- 测验页 ----------

  // 生成一道题：type 0=看假名选读音, 1=听发音选假名, 2=看读音选假名
  // 只从已学过的假名（box >= 1）中抽题
  function makeQuizQuestion() {
    var learned = KANA_DATA.filter(function (k) {
      return Storage.getKana(k.hiragana).box >= 1;
    });
    if (learned.length === 0) learned = KANA_DATA.slice(0, 5); // 还没学时先考第一行
    var kana = learned[Math.floor(Math.random() * learned.length)];
    var type = Math.floor(Math.random() * 3);
    var distractors = pickDistractors(kana, 3);
    var options, answer;
    if (type === 0) {
      options = shuffle([kana].concat(distractors)).map(function (k) { return k.romaji; });
      answer = kana.romaji;
    } else {
      options = shuffle([kana].concat(distractors)).map(function (k) { return k.hiragana; });
      answer = kana.hiragana;
    }
    return { kana: kana, type: type, options: options, answer: answer };
  }

  function renderQuiz() {
    var header = el('quiz-header');
    var question = el('quiz-question');
    var optionsBox = el('quiz-options');
    var feedback = el('quiz-feedback');
    var result = el('quiz-result');
    if (!header || !question || !optionsBox || !feedback || !result) return;

    // 全部答完：显示结果
    if (state.quizIndex >= state.quizTotal) {
      header.innerHTML = '';
      question.innerHTML = '';
      optionsBox.innerHTML = '';
      feedback.innerHTML = '';
      var pct = Math.round(state.quizScore / state.quizTotal * 100);
      result.innerHTML =
        '<div class="result-score">' + state.quizScore + ' / ' + state.quizTotal + '</div>' +
        '<div class="result-pct">正确率 ' + pct + '%</div>' +
        '<div class="result-judge">' + (pct >= 80 ? '合格！' : '继续加油！') + '</div>' +
        '<button class="btn btn-primary" id="btn-quiz-retry">再来一次</button>';
      el('btn-quiz-retry').onclick = function () {
        state.quizIndex = 0;
        state.quizScore = 0;
        state.quizCurrent = null;
        renderQuiz();
      };
      return;
    }

    // 新一轮测验重置
    if (!state.quizCurrent) {
      state.quizIndex = 0;
      state.quizScore = 0;
    }
    state.quizCurrent = makeQuizQuestion();
    state.quizLocked = false;
    var q = state.quizCurrent;

    result.innerHTML = '';
    feedback.innerHTML = '';

    // 题头：第X题/共Y题 + 得分
    header.innerHTML =
      '<div class="quiz-count">第 ' + (state.quizIndex + 1) + ' 题 / 共 ' + state.quizTotal + ' 题</div>' +
      '<div class="quiz-score">得分：' + state.quizScore + '</div>';

    // 题干
    if (q.type === 0) {
      question.innerHTML = '<div class="quiz-prompt">这个假名怎么读？</div><div class="kana-char big">' + esc(q.kana.hiragana) + '</div>';
    } else if (q.type === 1) {
      question.innerHTML = '<div class="quiz-prompt">听发音，选假名</div><button class="btn btn-speak" id="btn-quiz-speak">🔊 播放发音</button>';
    } else {
      question.innerHTML = '<div class="quiz-prompt">' + esc(q.kana.romaji) + ' 是哪个假名？</div><div class="quiz-romaji big">' + esc(q.kana.romaji) + '</div>';
    }

    // 选项
    var optHtml = '';
    q.options.forEach(function (opt) {
      optHtml += '<button class="btn quiz-option" data-value="' + esc(opt) + '">' + esc(opt) + '</button>';
    });
    optionsBox.innerHTML = optHtml;

    // 听音题自动播放
    if (q.type === 1) {
      speak(q.kana.hiragana);
      el('btn-quiz-speak').onclick = function () { speak(q.kana.hiragana); };
    }

    // 选项点击
    Array.prototype.forEach.call(optionsBox.querySelectorAll('.quiz-option'), function (btn) {
      btn.onclick = function () {
        if (state.quizLocked) return; // 防止重复点击
        state.quizLocked = true;
        var value = btn.getAttribute('data-value');
        var correct = (value === q.answer);
        // 标记对错颜色
        Array.prototype.forEach.call(optionsBox.querySelectorAll('.quiz-option'), function (b) {
          if (b.getAttribute('data-value') === q.answer) b.classList.add('correct');
        });
        if (correct) {
          btn.classList.add('correct');
          feedback.innerHTML = '<div class="feedback-right">正解！</div>';
          state.quizScore++;
          SRS.markCorrect(q.kana.hiragana);
        } else {
          btn.classList.add('wrong');
          feedback.innerHTML = '<div class="feedback-wrong">残念...</div>';
          SRS.markWrong(q.kana.hiragana);
        }
        // 1 秒后自动下一题
        setTimeout(function () {
          state.quizIndex++;
          renderQuiz();
        }, 1000);
      };
    });
  }

  // ---------- 导出 ----------

  window.UI = {
    showPage: showPage,
    renderHome: renderHome,
    renderLearn: renderLearn,
    renderPractice: renderPractice,
    renderQuiz: renderQuiz,
    speak: speak,
    updateStreakDisplay: updateStreakDisplay
  };
})();
