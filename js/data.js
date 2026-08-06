/**
 * 日语50音数据文件
 * 共 104 个假名：清音 46 + 浊音 20 + 半浊音 5 + 拗音 33
 * 罗马音采用 Hepburn 式（し=shi, ち=chi, つ=tsu, ふ=fu, じ=ji, ぢ=ji, づ=zu, を=o）
 * 无任何外部依赖，直接在浏览器中引入即可使用
 */

// 兼容 Node 环境验证（浏览器中 window 天然存在）
if (typeof window === 'undefined') { globalThis.window = globalThis; }

window.KANA_DATA = [
  // ===== 清音 46 =====
  { hiragana: 'あ', katakana: 'ア', romaji: 'a',   row: 'a',  type: 'seion' },
  { hiragana: 'い', katakana: 'イ', romaji: 'i',   row: 'a',  type: 'seion' },
  { hiragana: 'う', katakana: 'ウ', romaji: 'u',   row: 'a',  type: 'seion' },
  { hiragana: 'え', katakana: 'エ', romaji: 'e',   row: 'a',  type: 'seion' },
  { hiragana: 'お', katakana: 'オ', romaji: 'o',   row: 'a',  type: 'seion' },

  { hiragana: 'か', katakana: 'カ', romaji: 'ka',  row: 'ka', type: 'seion' },
  { hiragana: 'き', katakana: 'キ', romaji: 'ki',  row: 'ka', type: 'seion' },
  { hiragana: 'く', katakana: 'ク', romaji: 'ku',  row: 'ka', type: 'seion' },
  { hiragana: 'け', katakana: 'ケ', romaji: 'ke',  row: 'ka', type: 'seion' },
  { hiragana: 'こ', katakana: 'コ', romaji: 'ko',  row: 'ka', type: 'seion' },

  { hiragana: 'さ', katakana: 'サ', romaji: 'sa',  row: 'sa', type: 'seion' },
  { hiragana: 'し', katakana: 'シ', romaji: 'shi', row: 'sa', type: 'seion' },
  { hiragana: 'す', katakana: 'ス', romaji: 'su',  row: 'sa', type: 'seion' },
  { hiragana: 'せ', katakana: 'セ', romaji: 'se',  row: 'sa', type: 'seion' },
  { hiragana: 'そ', katakana: 'ソ', romaji: 'so',  row: 'sa', type: 'seion' },

  { hiragana: 'た', katakana: 'タ', romaji: 'ta',  row: 'ta', type: 'seion' },
  { hiragana: 'ち', katakana: 'チ', romaji: 'chi', row: 'ta', type: 'seion' },
  { hiragana: 'つ', katakana: 'ツ', romaji: 'tsu', row: 'ta', type: 'seion' },
  { hiragana: 'て', katakana: 'テ', romaji: 'te',  row: 'ta', type: 'seion' },
  { hiragana: 'と', katakana: 'ト', romaji: 'to',  row: 'ta', type: 'seion' },

  { hiragana: 'な', katakana: 'ナ', romaji: 'na',  row: 'na', type: 'seion' },
  { hiragana: 'に', katakana: 'ニ', romaji: 'ni',  row: 'na', type: 'seion' },
  { hiragana: 'ぬ', katakana: 'ヌ', romaji: 'nu',  row: 'na', type: 'seion' },
  { hiragana: 'ね', katakana: 'ネ', romaji: 'ne',  row: 'na', type: 'seion' },
  { hiragana: 'の', katakana: 'ノ', romaji: 'no',  row: 'na', type: 'seion' },

  { hiragana: 'は', katakana: 'ハ', romaji: 'ha',  row: 'ha', type: 'seion' },
  { hiragana: 'ひ', katakana: 'ヒ', romaji: 'hi',  row: 'ha', type: 'seion' },
  { hiragana: 'ふ', katakana: 'フ', romaji: 'fu',  row: 'ha', type: 'seion' },
  { hiragana: 'へ', katakana: 'ヘ', romaji: 'he',  row: 'ha', type: 'seion' },
  { hiragana: 'ほ', katakana: 'ホ', romaji: 'ho',  row: 'ha', type: 'seion' },

  { hiragana: 'ま', katakana: 'マ', romaji: 'ma',  row: 'ma', type: 'seion' },
  { hiragana: 'み', katakana: 'ミ', romaji: 'mi',  row: 'ma', type: 'seion' },
  { hiragana: 'む', katakana: 'ム', romaji: 'mu',  row: 'ma', type: 'seion' },
  { hiragana: 'め', katakana: 'メ', romaji: 'me',  row: 'ma', type: 'seion' },
  { hiragana: 'も', katakana: 'モ', romaji: 'mo',  row: 'ma', type: 'seion' },

  { hiragana: 'や', katakana: 'ヤ', romaji: 'ya',  row: 'ya', type: 'seion' },
  { hiragana: 'ゆ', katakana: 'ユ', romaji: 'yu',  row: 'ya', type: 'seion' },
  { hiragana: 'よ', katakana: 'ヨ', romaji: 'yo',  row: 'ya', type: 'seion' },

  { hiragana: 'ら', katakana: 'ラ', romaji: 'ra',  row: 'ra', type: 'seion' },
  { hiragana: 'り', katakana: 'リ', romaji: 'ri',  row: 'ra', type: 'seion' },
  { hiragana: 'る', katakana: 'ル', romaji: 'ru',  row: 'ra', type: 'seion' },
  { hiragana: 'れ', katakana: 'レ', romaji: 're',  row: 'ra', type: 'seion' },
  { hiragana: 'ろ', katakana: 'ロ', romaji: 'ro',  row: 'ra', type: 'seion' },

  { hiragana: 'わ', katakana: 'ワ', romaji: 'wa',  row: 'wa', type: 'seion' },
  { hiragana: 'を', katakana: 'ヲ', romaji: 'o',   row: 'wa', type: 'seion' },

  { hiragana: 'ん', katakana: 'ン', romaji: 'n',   row: 'n',  type: 'seion' },

  // ===== 浊音 20 =====
  { hiragana: 'が', katakana: 'ガ', romaji: 'ga',  row: 'ga', type: 'dakuon' },
  { hiragana: 'ぎ', katakana: 'ギ', romaji: 'gi',  row: 'ga', type: 'dakuon' },
  { hiragana: 'ぐ', katakana: 'グ', romaji: 'gu',  row: 'ga', type: 'dakuon' },
  { hiragana: 'げ', katakana: 'ゲ', romaji: 'ge',  row: 'ga', type: 'dakuon' },
  { hiragana: 'ご', katakana: 'ゴ', romaji: 'go',  row: 'ga', type: 'dakuon' },

  { hiragana: 'ざ', katakana: 'ザ', romaji: 'za',  row: 'za', type: 'dakuon' },
  { hiragana: 'じ', katakana: 'ジ', romaji: 'ji',  row: 'za', type: 'dakuon' },
  { hiragana: 'ず', katakana: 'ズ', romaji: 'zu',  row: 'za', type: 'dakuon' },
  { hiragana: 'ぜ', katakana: 'ゼ', romaji: 'ze',  row: 'za', type: 'dakuon' },
  { hiragana: 'ぞ', katakana: 'ゾ', romaji: 'zo',  row: 'za', type: 'dakuon' },

  { hiragana: 'だ', katakana: 'ダ', romaji: 'da',  row: 'da', type: 'dakuon' },
  { hiragana: 'ぢ', katakana: 'ヂ', romaji: 'ji',  row: 'da', type: 'dakuon' },
  { hiragana: 'づ', katakana: 'ヅ', romaji: 'zu',  row: 'da', type: 'dakuon' },
  { hiragana: 'で', katakana: 'デ', romaji: 'de',  row: 'da', type: 'dakuon' },
  { hiragana: 'ど', katakana: 'ド', romaji: 'do',  row: 'da', type: 'dakuon' },

  { hiragana: 'ば', katakana: 'バ', romaji: 'ba',  row: 'ba', type: 'dakuon' },
  { hiragana: 'び', katakana: 'ビ', romaji: 'bi',  row: 'ba', type: 'dakuon' },
  { hiragana: 'ぶ', katakana: 'ブ', romaji: 'bu',  row: 'ba', type: 'dakuon' },
  { hiragana: 'べ', katakana: 'ベ', romaji: 'be',  row: 'ba', type: 'dakuon' },
  { hiragana: 'ぼ', katakana: 'ボ', romaji: 'bo',  row: 'ba', type: 'dakuon' },

  // ===== 半浊音 5 =====
  { hiragana: 'ぱ', katakana: 'パ', romaji: 'pa',  row: 'pa', type: 'handakuon' },
  { hiragana: 'ぴ', katakana: 'ピ', romaji: 'pi',  row: 'pa', type: 'handakuon' },
  { hiragana: 'ぷ', katakana: 'プ', romaji: 'pu',  row: 'pa', type: 'handakuon' },
  { hiragana: 'ぺ', katakana: 'ペ', romaji: 'pe',  row: 'pa', type: 'handakuon' },
  { hiragana: 'ぽ', katakana: 'ポ', romaji: 'po',  row: 'pa', type: 'handakuon' },

  // ===== 拗音 33 =====
  { hiragana: 'きゃ', katakana: 'キャ', romaji: 'kya', row: 'kya', type: 'yoon' },
  { hiragana: 'きゅ', katakana: 'キュ', romaji: 'kyu', row: 'kya', type: 'yoon' },
  { hiragana: 'きょ', katakana: 'キョ', romaji: 'kyo', row: 'kya', type: 'yoon' },

  { hiragana: 'しゃ', katakana: 'シャ', romaji: 'sha', row: 'sha', type: 'yoon' },
  { hiragana: 'しゅ', katakana: 'シュ', romaji: 'shu', row: 'sha', type: 'yoon' },
  { hiragana: 'しょ', katakana: 'ショ', romaji: 'sho', row: 'sha', type: 'yoon' },

  { hiragana: 'ちゃ', katakana: 'チャ', romaji: 'cha', row: 'cha', type: 'yoon' },
  { hiragana: 'ちゅ', katakana: 'チュ', romaji: 'chu', row: 'cha', type: 'yoon' },
  { hiragana: 'ちょ', katakana: 'チョ', romaji: 'cho', row: 'cha', type: 'yoon' },

  { hiragana: 'にゃ', katakana: 'ニャ', romaji: 'nya', row: 'nya', type: 'yoon' },
  { hiragana: 'にゅ', katakana: 'ニュ', romaji: 'nyu', row: 'nya', type: 'yoon' },
  { hiragana: 'にょ', katakana: 'ニョ', romaji: 'nyo', row: 'nya', type: 'yoon' },

  { hiragana: 'ひゃ', katakana: 'ヒャ', romaji: 'hya', row: 'hya', type: 'yoon' },
  { hiragana: 'ひゅ', katakana: 'ヒュ', romaji: 'hyu', row: 'hya', type: 'yoon' },
  { hiragana: 'ひょ', katakana: 'ヒョ', romaji: 'hyo', row: 'hya', type: 'yoon' },

  { hiragana: 'みゃ', katakana: 'ミャ', romaji: 'mya', row: 'mya', type: 'yoon' },
  { hiragana: 'みゅ', katakana: 'ミュ', romaji: 'myu', row: 'mya', type: 'yoon' },
  { hiragana: 'みょ', katakana: 'ミョ', romaji: 'myo', row: 'mya', type: 'yoon' },

  { hiragana: 'りゃ', katakana: 'リャ', romaji: 'rya', row: 'rya', type: 'yoon' },
  { hiragana: 'りゅ', katakana: 'リュ', romaji: 'ryu', row: 'rya', type: 'yoon' },
  { hiragana: 'りょ', katakana: 'リョ', romaji: 'ryo', row: 'rya', type: 'yoon' },

  { hiragana: 'ぎゃ', katakana: 'ギャ', romaji: 'gya', row: 'gya', type: 'yoon' },
  { hiragana: 'ぎゅ', katakana: 'ギュ', romaji: 'gyu', row: 'gya', type: 'yoon' },
  { hiragana: 'ぎょ', katakana: 'ギョ', romaji: 'gyo', row: 'gya', type: 'yoon' },

  { hiragana: 'じゃ', katakana: 'ジャ', romaji: 'ja',  row: 'ja',  type: 'yoon' },
  { hiragana: 'じゅ', katakana: 'ジュ', romaji: 'ju',  row: 'ja',  type: 'yoon' },
  { hiragana: 'じょ', katakana: 'ジョ', romaji: 'jo',  row: 'ja',  type: 'yoon' },

  { hiragana: 'びゃ', katakana: 'ビャ', romaji: 'bya', row: 'bya', type: 'yoon' },
  { hiragana: 'びゅ', katakana: 'ビュ', romaji: 'byu', row: 'bya', type: 'yoon' },
  { hiragana: 'びょ', katakana: 'ビョ', romaji: 'byo', row: 'bya', type: 'yoon' },

  { hiragana: 'ぴゃ', katakana: 'ピャ', romaji: 'pya', row: 'pya', type: 'yoon' },
  { hiragana: 'ぴゅ', katakana: 'ピュ', romaji: 'pyu', row: 'pya', type: 'yoon' },
  { hiragana: 'ぴょ', katakana: 'ピョ', romaji: 'pyo', row: 'pya', type: 'yoon' },
];

// 行顺序（学习顺序：先清音，再浊音半浊音，最后拗音）
window.ROWS = ['a','ka','sa','ta','na','ha','ma','ya','ra','wa','n','ga','za','da','ba','pa','kya','sha','cha','nya','hya','mya','rya','gya','ja','bya','pya'];

// 行信息（显示名 + 类型）
window.ROW_INFO = {
  a:   { name: 'あ行',   type: 'seion' },
  ka:  { name: 'か行',   type: 'seion' },
  sa:  { name: 'さ行',   type: 'seion' },
  ta:  { name: 'た行',   type: 'seion' },
  na:  { name: 'な行',   type: 'seion' },
  ha:  { name: 'は行',   type: 'seion' },
  ma:  { name: 'ま行',   type: 'seion' },
  ya:  { name: 'や行',   type: 'seion' },
  ra:  { name: 'ら行',   type: 'seion' },
  wa:  { name: 'わ行',   type: 'seion' },
  n:   { name: 'ん',     type: 'seion' },
  ga:  { name: 'が行',   type: 'dakuon' },
  za:  { name: 'ざ行',   type: 'dakuon' },
  da:  { name: 'だ行',   type: 'dakuon' },
  ba:  { name: 'ば行',   type: 'dakuon' },
  pa:  { name: 'ぱ行',   type: 'handakuon' },
  kya: { name: 'きゃ行', type: 'yoon' },
  sha: { name: 'しゃ行', type: 'yoon' },
  cha: { name: 'ちゃ行', type: 'yoon' },
  nya: { name: 'にゃ行', type: 'yoon' },
  hya: { name: 'ひゃ行', type: 'yoon' },
  mya: { name: 'みゃ行', type: 'yoon' },
  rya: { name: 'りゃ行', type: 'yoon' },
  gya: { name: 'ぎゃ行', type: 'yoon' },
  ja:  { name: 'じゃ行', type: 'yoon' },
  bya: { name: 'びゃ行', type: 'yoon' },
  pya: { name: 'ぴゃ行', type: 'yoon' },
};

// 返回该行的所有假名
window.getKanaByRow = function (row) {
  return window.KANA_DATA.filter(function (k) { return k.row === row; });
};

// 根据平假名查找假名对象（找不到返回 undefined）
window.getKana = function (hiragana) {
  return window.KANA_DATA.find(function (k) { return k.hiragana === hiragana; });
};
