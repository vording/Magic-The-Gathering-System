// 旧枠モダン（モダンでリーガルかつ第8版より前に印刷されたことがあるカード）の一覧を Scryfall から取得して
// data/oldframe-modern.json に保存する。
//   node tools/fetch-oldframe-modern.js
// 保存する形は app.js の slimCard と同じ（デッキに入れたカードと同じ形。ルールエンジンにそのまま渡せる）。
// Scryfall の API の決まりに従い、リクエストの間を 100ms 空け、User-Agent と Accept を付ける。

const fs = require('fs');
const path = require('path');

const QUERY = 'legal:modern date<8ed -st:memorabilia';
const OUT = path.join(__dirname, '..', 'data', 'oldframe-modern.json');
const HEADERS = { 'User-Agent': 'MTGSystem-CardList/1.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slim(c) {
  const face = c.card_faces?.[0] ?? c;
  return {
    name: c.name,
    oracleId: c.oracle_id ?? face.oracle_id,
    cmc: c.cmc ?? 0,
    typeLine: c.type_line ?? face.type_line ?? '',
    manaCost: c.mana_cost ?? face.mana_cost ?? '',
    colors: c.colors ?? face.colors ?? [],
    oracleText: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).join('\n') ?? '',
    power: c.power ?? face.power ?? null,
    toughness: c.toughness ?? face.toughness ?? null,
    keywords: c.keywords ?? [],
    produced: c.produced_mana ?? [],
    image: c.image_uris?.normal ?? face.image_uris?.normal ?? null,
    set: c.set,
    released: c.released_at,
  };
}

async function main() {
  // 一番古い印刷の絵で取る
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(QUERY)}&unique=cards&order=name&prefer=oldest`;
  const cards = [];
  while (url) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const page = await res.json();
    cards.push(...page.data.map(slim));
    process.stderr.write(`\r${cards.length}/${page.total_cards}`);
    url = page.has_more ? page.next_page : null;
    await sleep(120);
  }
  process.stderr.write('\n');
  cards.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ query: QUERY, fetched: new Date().toISOString().slice(0, 10), cards }));
  console.log(`${cards.length} cards → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
