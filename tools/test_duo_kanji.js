/**
 * 汉字形补齐的回归测试（node tools/test_duo_kanji.js）
 * 只用真实数据 + 断言，不联网。
 */
var assert = require('assert');
var duo = require('../duo-sync.js');

var cases = [
  ['えん', '日元', '円'],          // N5 词表命中，同音词 園 要排除
  ['やすい', '便宜', '安い'],
  ['とし', '城市', ''],            // 都市/年 都沾边，宁可空着也不猜
  ['さん', '小姐；先生', ''],       // 〜さん 不是汉字形
  ['ここ', '这里', ''],            // 指示词只写假名
  ['はじめまして', '很高兴认识你', ''],
  ['たべます', '吃', '食べます'],   // ます 形还原
  ['まんが', '漫画', '漫画'],
  ['すし', '寿司', ''],
  ['やきゅう', '棒球', '野球'],
  ['みず', '水', '水'],
  ['日本', '日本', ''],            // 已经是汉字形，不再动
  ['ね', '啊', ''],                // 单假名助词
];

var failed = 0;
cases.forEach(function (c) {
  var got = duo.resolveKanji(c[0], c[1]).kanji;
  try {
    assert.strictEqual(got, c[2]);
    console.log('ok   ' + c[0] + ' -> ' + (got || '(不补)'));
  } catch (e) {
    failed++;
    console.log('FAIL ' + c[0] + ' 期望「' + (c[2] || '不补') + '」实际「' + (got || '不补') + '」');
  }
});

console.log(failed ? failed + ' 个失败' : '全部通过');
process.exit(failed ? 1 : 0);
