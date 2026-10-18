/* Run: node tools/test_video_study.js — no media, models, network or user data. */
const assert = require('node:assert/strict');
const data = require('../js/video-study-data.js');

const raw = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<b>日本語</b>\r\nを学ぶ。\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n次です。\r\n';
const srt = data.parseSrt(raw);
assert.equal(srt.cues[0].text, '日本語\nを学ぶ。');
assert.equal(srt.cues[0].start, 1);
assert.equal(srt.cues[0].end, 2.5);
assert.equal(srt.word_timestamps, false);
assert.throws(() => data.parseSrt('not a subtitle'));
assert.throws(() => data.parseSrt('1\n00:00:02,000 --> 00:00:01,000\ntext'));
assert.throws(() => data.parseSrt('1\n00:60:02,000 --> 01:00:04,000\ntext'));
assert.throws(() => data.normalizeStudy({ version: 2, cues: srt.cues }));
assert.throws(() => data.normalizeStudy({ version: 1, cues: [srt.cues[1], srt.cues[0]] }));
const study = data.normalizeStudy({ version: 1, cues: [{
  start: 1, end: 2.5, text: '日本語', words: [
    { w: '日本語', start: 0.9, end: 2.6 },
    { w: 'bad', start: NaN, end: 3 },
    { w: 'zero', start: 2, end: 2 }
  ]
}] });
assert.equal(study.discardedWords, 2);
assert.equal(study.cues[0].words[0].start, 0.9); // Source words may cross cue bounds.
const translated = data.parseSrt('1\n00:00:01,000 --> 00:00:02,500\n日语');
const merged = data.mergeTranslation(study, translated);
assert.equal(merged.cues[0].text, '日本語');
assert.equal(merged.cues[0].zh, '日语');
assert.equal(merged.cues[0].words[0].start, 0.9);
assert.equal(study.cues[0].zh, undefined);
assert.throws(() => data.mergeTranslation(study, srt));
assert.throws(() => data.mergeTranslation(study, data.parseSrt('1\n00:00:01,100 --> 00:00:02,500\n日语')));
assert.throws(() => data.mergeTranslation(srt, { cues: [translated.cues[0], translated.cues[0]] }));
console.log('PASS: subtitle parsing, validation, word-time preservation and translation matching');
