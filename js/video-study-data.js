/* 独立字幕文件的读取与校验；不运行转录，也不更改原文词时间轴。 */
(function (root) {
  'use strict';

  function validTime(start, end) {
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
  }

  function normalizeStudy(input) {
    if (!input || input.version !== 1 || !Array.isArray(input.cues) || !input.cues.length) {
      throw new Error('需要 version=1 且含有效 cues 的学习字幕文件。');
    }
    if (input.cues.length > 20000) throw new Error('字幕超过 20000 条，请分段导入。');
    var previous = -1;
    var discardedWords = 0;
    var cues = input.cues.map(function (cue, i) {
      if (!cue || !validTime(cue.start, cue.end) || typeof cue.text !== 'string' || !cue.text.trim()) {
        throw new Error('第 ' + (i + 1) + ' 条字幕的文字或时间无效。');
      }
      if (cue.start < previous) throw new Error('字幕时间没有按顺序排列。');
      previous = cue.start;
      var result = { id: i + 1, start: cue.start, end: cue.end, text: cue.text };
      if (typeof cue.zh === 'string') result.zh = cue.zh;
      if (Number.isInteger(cue.speaker) && cue.speaker >= 0) result.speaker = cue.speaker;
      var lastWord = -1;
      result.words = (Array.isArray(cue.words) ? cue.words : []).filter(function (word) {
        var valid = word && typeof word.w === 'string' && word.w.trim() &&
          validTime(word.start, word.end) && word.start >= lastWord;
        if (!valid) { discardedWords++; return false; }
        lastWord = word.start;
        return true;
      }).map(function (word) {
        return { w: word.w, start: word.start, end: word.end };
      });
      // 逐字时间：[字符下标, 起, 止]，用于把光斑跟到 App 自己的分词
      if (Array.isArray(cue.chars)) {
        var lastChar = -1;
        result.chars = cue.chars.filter(function (c) {
          var ok = Array.isArray(c) && Number.isInteger(c[0]) && c[0] > lastChar &&
            validTime(c[1], c[2]);
          if (ok) lastChar = c[0];
          return ok;
        });
        if (!result.chars.length) delete result.chars;
      }
      return result;
    });
    return {
      version: 1,
      title: typeof input.title === 'string' ? input.title : '学习视频',
      lang: typeof input.lang === 'string' ? input.lang : 'ja',
      duration: Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 0,
      cues: cues,
      word_timestamps: cues.some(function (cue) { return cue.words.length > 0; }),
      discardedWords: discardedWords
    };
  }

  function parseSrt(text) {
    var cues = [];
    var timestamp = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})(?:\s.*)?$/;
    String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split('\n');
      var at = lines[0].indexOf('-->') >= 0 ? 0 : 1;
      var match = timestamp.exec((lines[at] || '').trim());
      if (!match) throw new Error('字幕格式无法识别，请导入有效的 SRT 文件。');
      function seconds(offset) {
        if (+match[offset + 1] > 59 || +match[offset + 2] > 59) throw new Error('字幕时间格式无效。');
        return +match[offset] * 3600 + +match[offset + 1] * 60 + +match[offset + 2] + +match[offset + 3] / 1000;
      }
      cues.push({ start: seconds(1), end: seconds(5), text: lines.slice(at + 1).join('\n').replace(/<[^>]*>/g, '').trim() });
    });
    return normalizeStudy({ version: 1, cues: cues });
  }

  function timeKey(cue) {
    return Math.round(cue.start * 1000) + ':' + Math.round(cue.end * 1000);
  }

  function mergeTranslation(study, translation) {
    if (study.cues.length !== translation.cues.length) throw new Error('译文段数与原字幕不一致，原字幕未被替换。');
    var byTime = new Map();
    translation.cues.forEach(function (cue) {
      var key = timeKey(cue);
      if (byTime.has(key)) throw new Error('译文含重复时间段，无法可靠匹配。');
      byTime.set(key, cue.text);
    });
    var used = new Set();
    var cues = study.cues.map(function (cue) {
      var key = timeKey(cue);
      if (!byTime.has(key) || used.has(key)) throw new Error('译文时间轴与原字幕不一致，原字幕未被替换。');
      used.add(key);
      return Object.assign({}, cue, { zh: byTime.get(key) });
    });
    return Object.assign({}, study, { cues: cues });
  }

  var api = { normalizeStudy: normalizeStudy, parseSrt: parseSrt, mergeTranslation: mergeTranslation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoStudyData = api;
})(typeof window !== 'undefined' ? window : globalThis);
