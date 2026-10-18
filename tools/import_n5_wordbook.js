// Source: 5mdld/anki-jlpt-decks, CC BY-NC 4.0. See THIRD_PARTY.md.
// Usage: node tools/import_n5_wordbook.js <downloaded notes.csv>
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function parseTsv(text) {
  const rows = [], row = [];
  let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || field === '') quoted = !quoted;
      else field += c;
    } else if (!quoted && (c === '\t' || c === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (c === '\n') { rows.push(row.splice(0)); }
    } else field += c;
  }
  assert(!quoted, 'Unclosed TSV field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function plain(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/<br\s*\/?\s*>/gi, '；').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
      if (code[0] !== '#') return entities[code.toLowerCase()];
      return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    }).trim();
}

function partOfSpeech(value) {
  const first = value.split('・')[0];
  if (/動/.test(first)) return '动词';
  return ({ 名: '名词', イ形: '形容词', ナ形: '形容动词', 副: '副词' })[first] || '其他';
}

const source = process.argv[2];
assert(source, 'Pass the downloaded deck-source/notes.csv path');
const rows = parseTsv(fs.readFileSync(source, 'utf8')).filter(r => r[1] === 'eggrolls-JLPT10k-v3.5::1-N5');
assert(rows.length > 0, 'No N5 notes found');
const words = rows.map(r => {
  assert(r.length === 39, 'Unexpected source columns');
  const spelling = plain(r[3]);
  const kanaSpelling = spelling.replace(/^[〜～~]/, '');
  const reading = /^[ぁ-ゖァ-ヺー]+$/.test(kanaSpelling) ? kanaSpelling : plain(r[6]).replace(/^[〜～~]/, '');
  const word = { id: r[2], kana: reading, kanji: spelling === reading ? '' : spelling, zh: plain(r[7]), pos: partOfSpeech(r[5]) };
  assert(/^[ぁ-ゖァ-ヺー]+$/.test(reading), 'Invalid kana for ' + spelling);
  assert(word.id && word.zh, 'Missing ID or meaning for ' + spelling);
  const ja = plain(r[12]), zh = plain(r[14]);
  if (ja && zh) word.ex = { ja, zh };
  return word;
});
assert(new Set(words.map(w => w.id)).size === words.length, 'Duplicate source IDs');
const book = { title: 'N5 单词', level: 'N5', source: 'https://github.com/5mdld/anki-jlpt-decks', license: 'CC BY-NC 4.0', words };
const output = path.join(__dirname, '..', 'js', 'n5-wordbook.js');
fs.writeFileSync(output, '// Adapted from 5mdld/anki-jlpt-decks (CC BY-NC 4.0). See THIRD_PARTY.md.\nwindow.WORDBOOKS.push(' + JSON.stringify(book, null, 2) + ');\n');
console.log('Imported ' + words.length + ' N5 words, ' + words.filter(w => w.ex).length + ' examples');
