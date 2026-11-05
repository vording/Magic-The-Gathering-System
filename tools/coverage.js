// 旧枠モダンの全カードを cardtext.js で読み、自動で処理できる割合と、読めなかった文を集計する
//   node tools/coverage.js            … 集計と、読めなかった文の多い書式
//   node tools/coverage.js --list     … 読めなかったカードと文の一覧
//   node tools/coverage.js --write    … docs/coverage.md に書き出す
global.Rules = require('../rules.js');
global.CardOverrides = require('../cards.js');
global.CardText = require('../cardtext.js');
global.Engine = require('../engine.js');
const fs = require('fs');
const path = require('path');
const { cards } = require('../data/oldframe-modern.json');

// エンジンが扱えない効果があれば、読めなかった文として数える
const rows = cards.map((card) => {
  const def = CardText.compile(card);
  const bad = Engine.unsupported(def);
  if (bad.length) { def.manual.push(`（エンジン未対応：${bad.join(', ')}）`); def.support = 'partial'; }
  return { card, def };
});
const by = (s) => rows.filter((r) => r.def.support === s);
const pct = (n) => `${((n / rows.length) * 100).toFixed(1)}%`;
const summary = `全${rows.length}種類：すべて自動 ${by('full').length}（${pct(by('full').length)}）・一部だけ ${by('partial').length}・できない ${by('none').length}`;

// 読めなかった文を、カード名・数字・マナ記号をならして数える
const shape = (line) => line.toLowerCase().replace(/\{[^}]+\}/g, '{M}').replace(/\b\d+\b/g, 'N').replace(/[+-]n\/[+-]n/g, '±N/±N').slice(0, 90);
const counts = new Map();
for (const r of rows) for (const l of r.def.manual) counts.set(shape(l), (counts.get(shape(l)) ?? 0) + 1);
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);

if (process.argv.includes('--write')) {
  const lines = [`# 旧枠モダンの自動処理の対応状況`, '', `${summary}（${new Date().toISOString().slice(0, 10)} 時点。\`node tools/coverage.js --write\` で更新）`, '',
    '## 読み取れない文があるカード', '', '| カード | 読み取れない文 |', '|---|---|',
    ...rows.filter((r) => r.def.manual.length).map((r) => `| ${r.card.name} | ${r.def.manual.map((l) => l.replace(/\|/g, '\\|')).join('<br>')} |`)];
  fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'coverage.md'), `${lines.join('\n')}\n`);
}
console.log(summary);
if (process.argv.includes('--list')) {
  for (const r of rows) if (r.def.manual.length) console.log(`${r.card.name}: ${r.def.manual.join(' / ')}`);
} else console.log(top.slice(0, Number(process.env.TOP ?? 60)).map(([s, n]) => `${String(n).padStart(4)}  ${s}`).join('\n'));
