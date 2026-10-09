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

  // ---------- 错题复习出题 ----------
  var REVIEW_GROUP_MIN = 3, REVIEW_GROUP_MAX = 5;

  function pickWeighted(weights) {
    var keys = Object.keys(weights);
    var sum = 0;
    keys.forEach(function (k) { sum += weights[k]; });
    var r = Math.random() * sum;
    for (var i = 0; i < keys.length; i++) {
      r -= weights[keys[i]];
      if (r < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  /**
   * 生成错题复习的假名练习文本（纯假名，3~5 个一组用空格分隔）
   * 只从 weights 的键里出题，权重越高越常出；weights 为空时返回空字符串。
   * @param {Object} weights { 假名: 权重（错误次数） }
   * @param {number} total 假名个数
   */
  function buildReviewText(weights, total) {
    var keys = Object.keys(weights);
    if (!keys.length) return '';
    var seq = [], prev = null;
    for (var i = 0; i < total; i++) {
      var c = pickWeighted(weights);
      // 尽量避免同一假名连续出现（重试上限 20）。
      // 池子里只有 1~2 个假名时，「不连续」会退化成严格交替、把权重抹平，
      // 与「权重越高越常出」冲突，故此时不做去重（仍按权重抽取）。
      if (keys.length > 2 && c === prev) {
        for (var tries = 0; tries < 20; tries++) {
          var c2 = pickWeighted(weights);
          if (c2 !== prev) { c = c2; break; }
        }
      }
      seq.push(c);
      prev = c;
    }
    var out = '', count = 0, size = REVIEW_GROUP_MIN + Math.floor(Math.random() * (REVIEW_GROUP_MAX - REVIEW_GROUP_MIN + 1));
    seq.forEach(function (c) {
      out += c;
      count++;
      if (count === size) {
        out += ' ';
        count = 0;
        size = REVIEW_GROUP_MIN + Math.floor(Math.random() * (REVIEW_GROUP_MAX - REVIEW_GROUP_MIN + 1));
      }
    });
    return out.trim();
  }

  // ---------- 易混假名练习出题 ----------
  // 依据：最小对比串（minimal pair）辨别训练 + 交错排列（interleaving）。
  // 把形状相近 / 罗马音易错的假名相邻排布，逼学习者逐字辨别，而非靠上下文猜。
  var CONFUSABLE_GROUPS = [
    ['わ','ね','れ'], ['ぬ','め','あ'], ['る','ろ','そ'], ['は','ほ'],
    ['け','は'], ['い','り'], ['さ','き'], ['さ','ち'], ['し','つ'],
    ['し','も'], ['ま','も'], ['ま','よ'], ['こ','に'], ['た','に'],
    ['う','つ'], ['ち','ら'], ['す','む'], ['の','め'], ['や','か'], ['あ','お']
  ];

  // 罗马音易错字：含这些字的组被抽中概率更高（组权重 = 1 + 组内易错字数）
  var PITFALL = { 'し': 1, 'ち': 1, 'つ': 1, 'ふ': 1 };

  // Fisher–Yates 洗牌（返回新数组，不改原数组）
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 各易混组的权重表（下标字符串 -> 权重），复用 pickWeighted
  function groupWeights() {
    var w = {};
    for (var i = 0; i < CONFUSABLE_GROUPS.length; i++) {
      var weight = 1;
      CONFUSABLE_GROUPS[i].forEach(function (c) { if (PITFALL[c]) weight++; });
      w[i] = weight;
    }
    return w;
  }

  function distinctCount(s) {
    var set = {};
    for (var i = 0; i < s.length; i++) set[s[i]] = 1;
    return Object.keys(set).length;
  }

  // 单元内某字符的最大出现次数（用于判断能否排成「无相邻同字」）
  function maxCharCount(s) {
    var counts = {}, max = 0;
    for (var i = 0; i < s.length; i++) {
      counts[s[i]] = (counts[s[i]] || 0) + 1;
      if (counts[s[i]] > max) max = counts[s[i]];
    }
    return max;
  }

  // 生成一个易混串：按权重抽组，从该组取字符拼成长度 len；组内允许重复，
  // 但至少出现 2 个不同字符，且最多次数不超过 ceil(len/2)
  // （否则无论怎么排都会出现相邻同字，破坏单元结构）。重试若干次取不到就接受。
  function buildConfusionUnit(len, weights) {
    var group = CONFUSABLE_GROUPS[parseInt(pickWeighted(weights), 10)] || CONFUSABLE_GROUPS[0];
    for (var attempt = 0; attempt < 10; attempt++) {
      var s = '';
      for (var k = 0; k < len; k++) {
        s += group[Math.floor(Math.random() * group.length)];
      }
      if (group.length < 2 || (distinctCount(s) >= 2 && maxCharCount(s) <= Math.ceil(len / 2))) return s;
    }
    // 兜底：交替取组内前两个字符拼满（该排法必然可排成无相邻同字）
    var a = group[0], b = group.length > 1 ? group[1] : group[0];
    var out = '';
    for (var m = 0; m < len; m++) out += (m % 2 === 0 ? a : b);
    return out;
  }

  /**
   * 生成易混假名练习文本（纯假名，3~5 个一组用空格分隔，无实义）
   * 两段：① 覆盖段 —— allKana 每个假名各出现一次（单字单元）；
   *       ② 易混段 —— 按组权重抽相似假名组成 3~5 字串（最小对比串）。
   * 两段单元整体洗牌后，先在「单元层面」消除相邻同字（不跨单元搬字符），
   * 再展平并按 3~5 个一组加空格（与 buildReviewText 一致）。
   * @param {Array<string>} allKana 清音假名数组
   * @param {number} total 总假名个数
   */
  function buildConfusionDrill(allKana, total) {
    if (!allKana || !allKana.length) return '';
    total = Math.floor(total);
    if (!isFinite(total) || total < 0) total = allKana.length; // Infinity/NaN/负数回退为只出覆盖段
    // 覆盖段：每个假名各一次，作为单字单元
    var units = shuffle(allKana).map(function (c) { return [c]; });
    if (total < allKana.length) {
      // 总数不足覆盖段：只取 total 个单字单元
      units = units.slice(0, total);
    } else {
      // 易混段：按权重抽组拼串，直到凑满剩余数量
      var weights = groupWeights();
      var remaining = total - allKana.length;
      while (remaining > 0) {
        var len = REVIEW_GROUP_MIN + Math.floor(Math.random() * (REVIEW_GROUP_MAX - REVIEW_GROUP_MIN + 1)); // 3~5
        if (len > remaining) len = remaining; // 单元长度不得超过剩余
        units.push(buildConfusionUnit(len, weights).split(''));
        remaining -= len;
      }
      units = shuffle(units);
    }
    // 单元内排序：贪心选「与上一个不同、剩余出现次数最多」的字，避免单元内相邻同字。
    // avoidHead 非空时，首字尽量不等于 avoidHead（跨单元拼接时使用）；
    // 只剩与上一个相同的字时只能接受。
    function arrangeUnit(chars, avoidHead) {
      var counts = {};
      for (var ci = 0; ci < chars.length; ci++) counts[chars[ci]] = (counts[chars[ci]] || 0) + 1;
      var out = [], prev = avoidHead;
      for (var n = 0; n < chars.length; n++) {
        var best = null, bestCount = -1;
        for (var key in counts) {
          if (counts[key] <= 0 || key === prev) continue;
          if (counts[key] > bestCount) { best = key; bestCount = counts[key]; }
        }
        if (best === null) { // 没有与 prev 不同的字，只能取剩余任意字
          for (var key2 in counts) { if (counts[key2] > 0) { best = key2; break; } }
        }
        if (best === null) break;
        out.push(best); counts[best]--; prev = best;
      }
      return out;
    }
    units = units.map(function (u) { return arrangeUnit(u, null); });
    // 逐单元拼接：若当前单元首字等于上一单元末字，就把当前单元与后面某个
    // 「首字不等于上一末字」的单元整体交换（整单元交换，不搬单个字符）；
    // 交换不到再用带上一个末字约束重排；仍不行则接受（交给最后兜底）。
    for (var ui = 1; ui < units.length; ui++) {
      var prevLast = units[ui - 1][units[ui - 1].length - 1];
      if (units[ui].length && units[ui][0] === prevLast) {
        var swapped = false;
        for (var uj = ui + 1; uj < units.length; uj++) {
          if (units[uj].length && units[uj][0] !== prevLast) {
            var tmpU = units[ui]; units[ui] = units[uj]; units[uj] = tmpU;
            swapped = true; break;
          }
        }
        if (!swapped) units[ui] = arrangeUnit(units[ui], prevLast);
      }
    }
    // 展平
    var seq = [];
    units.forEach(function (u) { seq = seq.concat(u); });
    function hasAdjacentDup(s) {
      for (var di = 1; di < s.length; di++) if (s[di] === s[di - 1]) return true;
      return false;
    }
    // 最后兜底：单元处理后若仍有相邻同字，才启用扁平交换。
    // 其他情况跳过，避免把字搬出原单元、破坏「相似字相邻」的单元结构。
    // 优先换成与前一假名同属易混组的字，并就近交换，尽量保留「相似字相邻」的训练强度。
    function inSameGroup(a, b) {
      for (var gi = 0; gi < CONFUSABLE_GROUPS.length; gi++) {
        var g = CONFUSABLE_GROUPS[gi];
        if (g.indexOf(a) !== -1 && g.indexOf(b) !== -1) return true;
      }
      return false;
    }
    // 试交换 seq[i] 与 seq[j]，检查交换后 i、j 两处附近不会出现同字连排
    function swapKeepsClean(s, i, j) {
      var t = s[i]; s[i] = s[j]; s[j] = t;
      var good = true;
      if (i > 0 && s[i] === s[i - 1]) good = false;
      if (i + 1 < s.length && s[i] === s[i + 1]) good = false;
      if (j > 0 && s[j] === s[j - 1]) good = false;
      if (j + 1 < s.length && s[j] === s[j + 1]) good = false;
      t = s[i]; s[i] = s[j]; s[j] = t; // 还原
      return good;
    }
    if (hasAdjacentDup(seq)) {
      for (var guard = 0; guard < seq.length + 1; guard++) {
        var changed = false;
        for (var i = 1; i < seq.length; i++) {
          if (seq[i] !== seq[i - 1]) continue;
          var pick = -1, pickDist = seq.length + 1, pickSameGroup = false;
          for (var j = 0; j < seq.length; j++) {
            if (j === i || seq[j] === seq[i - 1]) continue;
            if (!swapKeepsClean(seq, i, j)) continue;
            var grp = inSameGroup(seq[j], seq[i - 1]); // 换来的字与前一假名同易混组则更优
            var dist = j > i ? j - i : i - j;
            if ((grp && !pickSameGroup) || (grp === pickSameGroup && dist < pickDist)) {
              pick = j; pickDist = dist; pickSameGroup = grp;
            }
          }
          if (pick !== -1) {
            var tmp = seq[i]; seq[i] = seq[pick]; seq[pick] = tmp;
            changed = true;
          }
        }
        if (!changed) break; // 已无同字连排，提前结束
      }
    }
    // 按 3~5 个一组加空格
    var out = '', count = 0;
    var size = REVIEW_GROUP_MIN + Math.floor(Math.random() * (REVIEW_GROUP_MAX - REVIEW_GROUP_MIN + 1));
    seq.forEach(function (c) {
      out += c;
      count++;
      if (count === size) {
        out += ' ';
        count = 0;
        size = REVIEW_GROUP_MIN + Math.floor(Math.random() * (REVIEW_GROUP_MAX - REVIEW_GROUP_MIN + 1));
      }
    });
    return out.trim();
  }

  // 导出
  window.Typing = {
    parseText: parseText,
    createEngine: createEngine,
    renderKeyboard: renderKeyboard,
    nextHintKey: nextHintKey,
    buildReviewText: buildReviewText,
    buildConfusionDrill: buildConfusionDrill,
    CONFUSABLE_GROUPS: CONFUSABLE_GROUPS,
    KEYBOARD_ROWS: KEYBOARD_ROWS
  };

})();
