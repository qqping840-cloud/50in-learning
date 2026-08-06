/**
 * typing.js — 日语罗马音打字引擎
 * 参考 kanabr/keybr 的交互逻辑（逐假名高亮、罗马音实时解析、弱项统计），
 * 面向中文用户重新实现，不依赖任何外部库。
 *
 * 职责：
 *   1. 把平假名文本解析成「假名序列」，每个假名对应一个目标罗马音
 *   2. 实时解析用户按键：缓冲 + 前缀匹配，处理变长罗马音（shi/tsu/chi...）
 *   3. 虚拟键盘渲染与按键高亮
 *   4. 逐假名统计（正确率/用时），存 localStorage
 */
(function () {

  // ---------- 假名→罗马音映射（复用 data.js 的 KANA_DATA） ----------
  var KANA_MAP = {};   // 平假名 → 标准罗马音
  (function buildMap() {
    if (typeof window.KANA_DATA === 'undefined') return;
    window.KANA_DATA.forEach(function (k) {
      KANA_MAP[k.hiragana] = k.romaji;
    });
    // 补充 data.js 未收录的特殊小假名（供阅读/打字解析）
    KANA_MAP['っ'] = 'xtsu';
    KANA_MAP['ゃ'] = 'ya';
    KANA_MAP['ゅ'] = 'yu';
    KANA_MAP['ょ'] = 'yo';
    KANA_MAP['ゎ'] = 'wa';
    KANA_MAP['ゔ'] = 'vu';
  })();

  // 可接受的替代拼写（标准输入法习惯）
  var ALIASES = {
    'n': ['n', 'nn'],            // ん 可输入 n 或 nn
    'を': ['o', 'wo'],           // を 可输入 o 或 wo
    'っ': ['xtsu', 'ltu', 'xtu', 'ltsu'] // 促音（单独出现时）
  };

  // ---------- 文本解析：把文章拆成 token 序列 ----------
  // token 类型：
  //   { type:'kana', char, romaji }        需要打字的假名
  //   { type:'punct', char }               标点/长音/空格，自动通过（不输入）
  // 汉字：跳过（不显示不参与打字）
  function parseText(text) {
    var tokens = [];
    var i = 0;
    while (i < text.length) {
      var ch = text[i];
      // 双字符拗音
      var two = text.substr(i, 2);
      if (KANA_MAP[two]) {
        tokens.push({ type: 'kana', char: two, romaji: KANA_MAP[two] });
        i += 2;
        continue;
      }
      // 单字符假名
      if (KANA_MAP[ch]) {
        tokens.push({ type: 'kana', char: ch, romaji: KANA_MAP[ch] });
        i++;
        continue;
      }
      // 标点、长音、空格：保留为 punct（打字时自动通过）
      if (PUNCT_CHARS.indexOf(ch) !== -1) {
        tokens.push({ type: 'punct', char: ch });
        i++;
        continue;
      }
      // 其他（汉字等）：跳过
      i++;
    }
    return tokens;
  }

  // 打字时自动通过的标点符号
  var PUNCT_CHARS = [' ', 'ー', '、', '。', '，', '．', '！', '？', '…', '「', '」', '『', '』', '（', '）', '・', '：', '；'];

  // 词间微空格：原文中的空格在渲染时用更宽的间距区分（视觉提示分词）
  function isWordSpace(ch) { return ch === ' '; }

  // 判断输入流 buffer 是否匹配某个假名的目标罗马音
  // 返回 'done'（完整匹配）/ 'partial'（是前缀）/ 'miss'（不匹配）
  function matchInput(target, buffer, aliases) {
    var candidates = aliases.length ? aliases : [target];
    var done = false, partial = false;
    candidates.forEach(function (c) {
      if (buffer === c) done = true;
      else if (c.indexOf(buffer) === 0) partial = true;
    });
    if (done) return 'done';
    if (partial) return 'partial';
    return 'miss';
  }

  // ---------- 引擎 ----------
  /**
   * 创建打字引擎
   * @param {string} text 平假名文章
   */
  function createEngine(text) {
    var tokens = parseText(text);
    var pos = 0;
    var buffer = '';
    var startTime = Date.now();
    var stats = {}; // char -> { correct, wrong, totalTime }
    var errors = 0;

    // 前进到下一个需要打字的 kana（跳过标点），返回是否成功
    function advanceToKana() {
      while (pos < tokens.length && tokens[pos].type !== 'kana') pos++;
      return pos < tokens.length;
    }
    advanceToKana();

    // 当前假名的可接受拼写
    function currentTarget() {
      var item = tokens[pos];
      if (!item || item.type !== 'kana') return null;
      return { char: item.char, romaji: item.romaji, aliases: ALIASES[item.char] || [] };
    }

    // 处理一次按键
    function press(key) {
      if (pos >= tokens.length) return { type: 'complete' };
      var t = currentTarget();
      var nextBuffer = buffer + key;
      var result = matchInput(t.romaji, nextBuffer, t.aliases);

      if (result === 'done') {
        recordResult(t.char, true);
        pos++;
        advanceToKana(); // 跳过后面的标点
        buffer = '';
        return { type: 'progress', char: t.char, target: t, buffer: '', pos: pos, total: kanaCount() };
      }
      if (result === 'partial') {
        buffer = nextBuffer;
        return { type: 'partial', char: t.char, target: t, buffer: buffer, pos: pos, total: kanaCount() };
      }
      // 不匹配：记一次错误，丢弃该键
      recordResult(t.char, false);
      errors++;
      return { type: 'error', char: t.char, target: t, buffer: buffer, pos: pos, total: kanaCount() };
    }

    // 需要打字的总假名数（不含标点）
    function kanaCount() {
      return tokens.filter(function (t) { return t.type === 'kana'; }).length;
    }

    // 已完成的假名数（pos 之前的 kana 数量）
    function completedKana() {
      var n = 0;
      for (var i = 0; i < pos && i < tokens.length; i++) {
        if (tokens[i].type === 'kana') n++;
      }
      return n;
    }

    function recordResult(char, ok) {
      if (!stats[char]) stats[char] = { correct: 0, wrong: 0 };
      if (ok) stats[char].correct++;
      else stats[char].wrong++;
    }

    // 当前状态（供 UI 渲染）
    function getState() {
      return {
        tokens: tokens,
        pos: pos,
        buffer: buffer,
        total: kanaCount(),
        completed: completedKana(),
        target: currentTarget(),
        errors: errors,
        elapsedMs: Date.now() - startTime,
        stats: stats
      };
    }

    // 结果汇总
    function getResult() {
      var elapsed = Date.now() - startTime;
      var correctChars = Object.keys(stats).filter(function (c) { return stats[c].correct > 0; });
      return {
        total: kanaCount(),
        completed: completedKana() >= kanaCount(),
        errors: errors,
        elapsedMs: elapsed,
        accuracy: kanaCount() ? Math.max(0, 1 - errors / kanaCount()) : 1,
        // 弱项：错误率高的假名
        weak: correctChars.filter(function (c) {
          var s = stats[c];
          return s.wrong > 0 && s.wrong >= s.correct;
        }).slice(0, 10)
      };
    }

    return { press: press, getState: getState, getResult: getResult };
  }

  // ---------- 虚拟键盘 ----------
  var KEYBOARD_ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm']
  ];

  // 渲染虚拟键盘 HTML
  function renderKeyboard(activeKey, hintKey) {
    var html = '<div class="vkbd">';
    KEYBOARD_ROWS.forEach(function (row) {
      html += '<div class="vkbd-row">';
      row.forEach(function (key) {
        var cls = 'vkbd-key';
        if (key === activeKey) cls += ' pressed';
        if (key === hintKey && key !== activeKey) cls += ' hint';
        html += '<button class="' + cls + '" data-key="' + key + '">' + key + '</button>';
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // 从目标罗马音推导「下一个期望按键」（给提示高亮用）
  function nextHintKey(target, buffer) {
    if (!target) return null;
    var romaji = target.romaji;
    if (buffer.length < romaji.length) return romaji[buffer.length];
    return null;
  }

  // 导出
  window.Typing = {
    parseText: parseText,
    createEngine: createEngine,
    renderKeyboard: renderKeyboard,
    nextHintKey: nextHintKey,
    KEYBOARD_ROWS: KEYBOARD_ROWS
  };

})();
