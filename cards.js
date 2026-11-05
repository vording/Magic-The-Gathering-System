// Magic: The Gathering System — カードごとの個別の定義（cardtext.js の自動の読み取りを上書き・追加する）
// キーは英語のカード名。関数は cardtext.js が作った定義 def を受け取り、書き換える。
// 定義の形は cardtext.js の先頭のコメントを参照。効果の形は engine.js の resolveEffect が扱うもの。
//
// 例: 読み取れない文を、手で書いた効果に置き換える
//   'Card Name': (def) => {
//     def.spell = [{ type: 'damage', n: 2, target: { kind: 'any', filter: { types: ['creature'], non: [], colors: [], state: [] } } }];
//     def.manual = [];
//   },

const CardOverrides = {
  // 「X は、あなたがコントロールするクリーチャー1体を対象とし、それの上に +1/+1 カウンターを1個置く」などの書き換え例として、
  // 読み取りに失敗しやすい古い書式のカードをここに足していく。

  // Mogg Fanatic：「Sacrifice this: It deals 1 damage to any target.」は自動で読めるので不要（参考）
};

if (typeof module !== 'undefined') module.exports = CardOverrides;
