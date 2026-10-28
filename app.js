// Magic: The Gathering System — Scryfall API を使ったフォーマット別デッキ作成ツール

// ---------- 非公式フォーマットの定義 ----------
// Scryfall に判定がないフォーマットは、使用可能セット・禁止・制限をここで定義する。
// ルールは主催者や時期で変わるため、必要に応じてこのリストを編集する。

// ミドルスクール（MTG Wiki 準拠: 第4版〜スカージ、1995〜2003年のカードプール）
// Scryfall のクエリ長制限（約1000文字）があるため、セット列挙ではなく印刷時期で絞る
const MS_PROMOS = ['Arena', 'Sewers of Estark', 'Nalathni Dragon', 'Giant Badger', 'Windseeker Centaur'];
const MS_BANNED = [
  'Amulet of Quoz', 'Balance', 'Brainstorm', 'Bronze Tablet', 'Channel', 'Dark Ritual',
  'Demonic Consultation', 'Flash', 'Goblin Recruiter', 'Imperial Seal', 'Jeweled Bird',
  'Mana Crypt', 'Mana Vault', 'Memory Jar', "Mind's Desire", 'Mind Twist', 'Rebirth',
  'Strip Mine', 'Tempest Efreet', 'Timmerian Fiends', 'Tolarian Academy', 'Vampiric Tutor',
  'Windfall', "Yawgmoth's Bargain", "Yawgmoth's Will",
];

// オールドスクール 93/94（Eternal Central ルール、アンティなし）
const OS_SETS = ['lea', 'leb', '2ed', '3ed', 'arn', 'atq', 'leg', 'drk', 'fem'];
const OS_PROMOS = ['Arena', 'Sewers of Estark', 'Windseeker Centaur'];
const OS_BANNED = [
  'Bronze Tablet', 'Contract from Below', 'Darkpact', 'Demonic Attorney',
  'Jeweled Bird', 'Rebirth', 'Tempest Efreet',
];
const OS_RESTRICTED = [
  'Ancestral Recall', 'Balance', 'Black Lotus', 'Braingeyser', 'Channel', 'Chaos Orb',
  'Demonic Tutor', 'Library of Alexandria', 'Mana Drain', 'Mind Twist',
  'Mox Emerald', 'Mox Jet', 'Mox Pearl', 'Mox Ruby', 'Mox Sapphire',
  'Recall', 'Regrowth', 'Sol Ring', 'Time Vault', 'Time Walk', 'Timetwister', 'Wheel of Fortune',
];

// 大判カードや金枠の記念品は、時期の条件を満たしても初出扱いにしない
const NOT_MEMORABILIA = '-st:memorabilia';
const anyOf =(terms, names) => `(${[...terms, ...names.map((n) => `!"${n}"`)].join(' or ')})`;

// base: カード単位の条件（リーガリティ）、pool: 印刷単位の条件（セット・年代）
// banned / restricted はクエリ長を抑えるためアプリ側で判定する
const FORMATS = [
  { id: 'standard', name: 'スタンダード', size: 60, copies: 4 },
  { id: 'pioneer', name: 'パイオニア', size: 60, copies: 4 },
  { id: 'modern', name: 'モダン', size: 60, copies: 4 },
  { id: 'legacy', name: 'レガシー', size: 60, copies: 4 },
  { id: 'vintage', name: 'ヴィンテージ', size: 60, copies: 4 },
  { id: 'pauper', name: 'パウパー', size: 60, copies: 4 },
  { id: 'commander', name: '統率者', size: 100, copies: 1, exact: true },
  // 初出が旧枠（〜スカージ）のモダンリーガルカード
  { id: 'oldframe-modern', name: '旧枠モダン', size: 60, copies: 4, base: 'legal:modern', pool: `(date<8ed ${NOT_MEMORABILIA})` },
  // legal:vintage でアンティ・銀枠などの非トーナメントカードを除外
  { id: 'middleschool', name: 'ミドルスクール', size: 60, copies: 4, base: 'legal:vintage', pool: anyOf([`(date>=4ed date<8ed ${NOT_MEMORABILIA})`], MS_PROMOS), banned: MS_BANNED },
  { id: 'oldschool', name: 'オールドスクール', size: 60, copies: 4, base: '', pool: anyOf(OS_SETS.map((s) => `s:${s}`), OS_PROMOS), banned: OS_BANNED, restricted: OS_RESTRICTED },
].map((f) => ({ base: `legal:${f.id}`, ...f }));

const TYPE_GROUPS = [
  ['Creature', 'クリーチャー'],
  ['Planeswalker', 'プレインズウォーカー'],
  ['Battle', 'バトル'],
  ['Instant', 'インスタント'],
  ['Sorcery', 'ソーサリー'],
  ['Artifact', 'アーティファクト'],
  ['Enchantment', 'エンチャント'],
  ['Land', '土地'],
];

const NUMBER_WORDS = { seven: 7, nine: 9 };
const STORAGE_KEY = 'mtg-deckmaker-v1';
const JA_POOL_LIMIT = 100;
const MAX_QUERY_LENGTH = 950;

const $ = (id) => document.getElementById(id);
// 保存するデータ（デッキ名など）を作るときは、今の表示言語で名前を付ける
const L = (ja, en) => (document.documentElement.lang === 'en' ? en : ja);

let state = loadState();
let nextPage = null;
let lastResults = [];
let searchId = 0;
// 非公式フォーマットのリーガリティ判定結果 { formatId: Map<カード名, boolean> }
const poolLegal = {};

// ---------- 状態の保存 ----------

// state: { ja, current: 選択中のデッキID, decks: [{ id, name, format, cards: { カード名: { card, qty } } }] }
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.decks?.length) return { ja: true, oldest: true, ...saved };
    // 旧形式（デッキ1つ）からの移行
    if (saved?.deck) return { ja: saved.ja ?? true, oldest: true, current: 1, decks: [newDeck(1, L('デッキ1', 'Deck 1'), saved.format, saved.deck)] };
  } catch {}
  return { ja: true, oldest: true, current: 1, decks: [newDeck(1, L('デッキ1', 'Deck 1'))] };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function newDeck(id, name, format = 'standard', cards = {}) {
  return { id, name, format: FORMATS.some((f) => f.id === format) ? format : 'standard', cards };
}

const nextDeckId = () => Math.max(0, ...state.decks.map((d) => d.id)) + 1;
const activeDeck = () => state.decks.find((d) => d.id === state.current) ?? state.decks[0];
const currentFormat = () => FORMATS.find((f) => f.id === activeDeck().format);
const formatQuery = (fmt) => [fmt.base, fmt.pool].filter(Boolean).join(' ');

// ---------- カードデータ ----------

const oracleIdOf = (c) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;

function slimCard(c) {
  const face = c.card_faces?.[0] ?? c;
  const oracle = c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).join('\n') ?? '';
  return {
    name: c.name,
    oracleId: oracleIdOf(c),
    displayName: c.printed_name ?? c.card_faces?.[0]?.printed_name ?? c.name,
    cmc: c.cmc ?? 0,
    typeLine: c.type_line ?? face.type_line ?? '',
    image: c.image_uris?.normal ?? face.image_uris?.normal ?? null,
    legalities: c.legalities,
    // 土地を出したときの効果音（マナの色）に使う
    produced: c.produced_mana ?? [],
    // 一人回し・対戦で使う効果テキスト・パワー／タフネス・キーワード能力（表面）
    oracleText: oracle,
    power: c.power ?? face.power ?? null,
    toughness: c.toughness ?? face.toughness ?? null,
    keywords: c.keywords ?? [],
    copyRule: copyRule(c.type_line ?? '', oracle),
    art: artMode(),
  };
}

// 枚数制限なし（デッキは JSON で保存するため、保存すると null になる Infinity は使わない）
const UNLIMITED = 9999;
const isBasicLand = (typeLine) => /\bBasic\b.*\bLand\b/.test(typeLine ?? '');

// 基本土地や「好きな枚数入れてよい」カードの例外を判定
function copyRule(typeLine, oracle) {
  if (isBasicLand(typeLine)) return UNLIMITED;
  if (/any number of cards named/i.test(oracle)) return UNLIMITED;
  const m = oracle.match(/up to (\w+) cards named/i);
  if (m) return NUMBER_WORDS[m[1].toLowerCase()] ?? (Number(m[1]) || null);
  return null;
}

function maxCopies(card, fmt = currentFormat()) {
  if (card.copyRule != null) return card.copyRule;
  // 以前のデータは基本土地の copyRule が null で保存されている
  if (isBasicLand(card.typeLine)) return UNLIMITED;
  if (fmt.restricted?.includes(card.name)) return 1;
  if (card.legalities?.[fmt.id] === 'restricted') return 1;
  return fmt.copies;
}

// 非公式フォーマットは未判定なら警告を出さない（判定は validateDeck で非同期に行う）
function isLegal(card, fmt = currentFormat()) {
  if (fmt.banned?.includes(card.name)) return false;
  if (fmt.pool) return poolLegal[fmt.id]?.get(card.name) !== false;
  return ['legal', 'restricted'].includes(card.legalities?.[fmt.id]);
}

function markLegal(fmt, cards, legalIds) {
  if (!fmt.pool) return;
  const cache = (poolLegal[fmt.id] ??= new Map());
  for (const c of cards) cache.set(c.name, legalIds ? legalIds.has(c.oracleId) : true);
}

// ---------- 日本語版 ----------

// oracle_id → { name, image }。日本語版が存在しないカードは null
const jaCache = new Map();

// 画像の質: 2=スキャンあり / 1=仮画像 / 0=画像なし
const imageScore = (c, image) => (!image || c.image_status === 'missing' ? 0 : c.image_status === 'placeholder' ? 1 : 2);

// 古い順に渡された印刷のうち、画像の質が最も良い最初の版を採用する
// （古い日本語版には画像が未登録のものがあるため、その場合は次に古い日本語版を使う）
function rememberJa(c) {
  if (c.lang !== 'ja') return;
  const id = oracleIdOf(c);
  const face = c.card_faces?.[0] ?? c;
  const url = c.image_uris?.normal ?? face.image_uris?.normal ?? null;
  const score = imageScore(c, url);
  const prev = jaCache.get(id);
  if (prev && (prev.score ?? 0) >= score) return;
  jaCache.set(id, {
    name: c.printed_name ?? face.printed_name ?? c.name,
    image: score ? url : null,
    // 日本語の効果テキスト（両面カードは面ごとに改行でつなぐ）
    text: c.printed_text ?? c.card_faces?.map((f) => f.printed_text).filter(Boolean).join('\n') ?? '',
    score,
  });
}

// 日本語版の全印刷を調べ終えた oracle_id（画像のある版が見つからなくても再問い合わせしない）
const jaChecked = new Set();
const jaDone = (id) => jaCache.get(id) === null || jaCache.get(id)?.score === 2 || jaChecked.has(id);

const nameOf = (card) => (state.ja ? jaCache.get(card.oracleId)?.name ?? card.ja?.name ?? card.displayName : card.name);
const imageOf = (card) => card.pick?.image ?? (state.ja ? jaCache.get(card.oracleId)?.image ?? card.ja?.image ?? card.image : card.image);

// 一人回し画面でも日本語版を使えるよう、デッキ内カードに日本語版の情報を保存する
function persistJa() {
  let changed = false;
  for (const d of state.decks) {
    for (const { card } of Object.values(d.cards)) {
      const ja = jaCache.get(card.oracleId);
      // 以前に保存した日本語版には効果テキストがないので、取得できたら入れ直す
      if (ja && (!card.ja || (card.ja.score ?? 0) < ja.score || (card.ja.text === undefined && ja.text !== undefined))) {
        card.ja = ja;
        changed = true;
      }
    }
  }
  if (changed) saveState();
}

// 日本語版を未取得のカードについて、日本語版の印刷をまとめて問い合わせる
async function localize(cards, isCurrent = () => true, force = false) {
  if (!state.ja && !force) return;
  const missing = cards.filter((c) => c.oracleId && !jaDone(c.oracleId));
  const opts = state.oldest
    ? { ja: true, oldestFirst: true, prints: true, done: (ids) => ids.every((id) => jaCache.get(id)?.score === 2) }
    : { ja: true };
  try {
    await searchByOracleIds(missing, ' lang:ja', (found, ids) => {
      found.forEach(rememberJa);
      for (const id of ids) {
        if (!jaCache.has(id)) jaCache.set(id, null);
        jaChecked.add(id);
      }
      persistJa();
      renderResults();
      renderDeck();
      return (state.ja || force) && isCurrent();
    }, opts);
  } catch {}
}

// ---------- 初版の絵柄 ----------

const artMode = () => (state.oldest ? 'oldest' : 'default');
const allDeckCards = () => state.decks.flatMap((d) => Object.values(d.cards).map((e) => e.card));

// デッキ内カードの画像を、現在の絵柄設定（初版／通常）の印刷に差し替える
async function refreshArt(cards) {
  const mode = artMode();
  const stale = cards.filter((c) => c.oracleId && (c.art ?? 'default') !== mode);
  if (!stale.length) return;
  try {
    await searchByOracleIds(stale, '', (found) => {
      if (artMode() !== mode) return false;
      const byId = new Map(found.map((c) => [oracleIdOf(c), slimCard(c)]));
      for (const card of allDeckCards()) {
        const f = byId.get(card.oracleId);
        if (!f || card.art === mode) continue;
        card.image = f.image;
        card.art = mode;
        delete card.ja; // 日本語版も同じ設定で取り直す
      }
      persistJa();
      saveState();
      renderDeck();
    });
    if (artMode() === mode) await localize(stale);
  } catch {}
}

// 以前に保存したデッキのカードに、あとから増やした情報（マナの色・効果テキスト・P/T・キーワード）を補う
const INFO_FIELDS = ['produced', 'oracleText', 'power', 'toughness', 'keywords'];
async function fillCardInfo() {
  const missing = allDeckCards().filter((c) => c.oracleId && c.oracleText === undefined);
  if (!missing.length) return;
  try {
    await searchByOracleIds(missing, '', (found) => {
      const byId = new Map(found.map((c) => [oracleIdOf(c), slimCard(c)]));
      for (const card of allDeckCards()) {
        const info = card.oracleText === undefined && byId.get(card.oracleId);
        if (info) for (const k of INFO_FIELDS) card[k] = info[k];
      }
      saveState();
    });
  } catch {}
}

// 以前に保存したデッキは「好きな枚数入れてよい」カード（執拗なネズミなど）の制限が消えているので、
// テキストを取り直して判定し直す（一度だけ）
async function fixCopyRules() {
  if (state.copyRulesFixed) return;
  const cards = allDeckCards().filter((c) => c.oracleId && c.copyRule == null);
  try {
    await searchByOracleIds(cards, '', (found) => {
      const byId = new Map(found.map((c) => [oracleIdOf(c), slimCard(c).copyRule]));
      for (const card of allDeckCards()) {
        if (card.copyRule == null && byId.has(card.oracleId)) card.copyRule = byId.get(card.oracleId);
      }
    });
    state.copyRulesFixed = true;
    saveState();
    renderDeck();
    renderResults();
  } catch {}
}

// ---------- 絵柄の選択（カードごと） ----------

// 選択中のカード名と、印刷一覧の次ページ
let artTarget = null;
let artNext = null;

function openArtPicker(card) {
  artTarget = card.name;
  artNext = null;
  $('art-title').textContent = `絵柄を選ぶ - ${nameOf(card)}`;
  $('art-list').replaceChildren();
  $('art-more').hidden = true;
  $('art-reset').disabled = !card.pick;
  $('art-status').textContent = '読み込み中…';
  $('art-dialog').showModal();
  const langs = state.ja ? '(lang:ja or lang:en)' : 'lang:en';
  const q = card.oracleId ? `oracleid:${card.oracleId} ${langs}` : `!"${card.name}" ${langs}`;
  loadArtPage(searchUrl(q, { ja: state.ja, oldestFirst: true, prints: true, prefer: false }), card.name);
}

async function loadArtPage(url, name) {
  try {
    const data = await fetchJson(url);
    if (artTarget !== name) return;
    const current = activeDeck().cards[name]?.card;
    const currentImage = current ? imageOf(current) : null;
    $('art-list').append(...data.data.map((c) => artOption(c, currentImage)));
    artNext = data.has_more ? data.next_page : null;
    $('art-more').hidden = !artNext;
    $('art-status').textContent = data.total_cards
      ? `${data.total_cards} 種類（古い順）。クリックで決定`
      : '印刷が見つかりませんでした。';
  } catch (err) {
    if (artTarget === name) $('art-status').textContent = `エラー: ${err.message}`;
  }
}

function artOption(c, currentImage) {
  const face = c.card_faces?.[0] ?? c;
  const uris = c.image_uris ?? face.image_uris ?? {};
  const hasImage = uris.normal && c.image_status !== 'missing';
  const b = document.createElement('button');
  b.className = 'art-option' + (hasImage && uris.normal === currentImage ? ' selected' : '');
  b.title = `${c.set_name}（${c.set.toUpperCase()}）${c.released_at}${c.lang === 'ja' ? '・日本語版' : ''}`;
  if (hasImage) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = uris.small ?? uris.normal;
    b.append(img);
  } else {
    const n = document.createElement('div');
    n.className = 'noimg';
    n.textContent = '画像なし';
    b.append(n);
    b.disabled = true;
  }
  const label = document.createElement('span');
  label.className = 'art-label';
  label.textContent = `${c.released_at.slice(0, 4)} ${c.set.toUpperCase()}${c.lang === 'ja' ? ' 日' : ''}`;
  b.append(label);
  b.addEventListener('click', () => pickArt({ image: uris.normal, set: c.set, lang: c.lang }));
  return b;
}

// pick が null なら自動（初版・日本語版の設定に従う）に戻す
function pickArt(pick) {
  const entry = activeDeck().cards[artTarget];
  if (entry) {
    // 検索結果と同じオブジェクトを共有しないよう複製してから変更する
    const { pick: _, ...rest } = entry.card;
    entry.card = pick ? { ...rest, pick } : rest;
    saveState();
    renderDeck();
    const image = imageOf(entry.card);
    if (image) {
      $('preview').src = image;
      $('preview').hidden = false;
    }
  }
  $('art-dialog').close();
}

// ---------- Scryfall API ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requestQueue = Promise.resolve();

// Scryfall のガイドラインに従い、リクエストは1件ずつ 100ms 以上空けて送る
function fetchJson(url) {
  const result = requestQueue.then(() => sleep(100)).then(() => fetchOnce(url));
  requestQueue = result.catch(() => {});
  return result;
}

async function fetchOnce(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    // レート制限（429）は CORS ヘッダーなしで返るため、ネットワークエラーとして見える
    throw new Error('Scryfall に接続できません。短時間に検索しすぎた場合は1分ほど待ってから再度お試しください');
  }
  // 障害時などは JSON でないページが返ることがある
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`Scryfall からの応答を読み取れませんでした（${res.status} ${res.statusText}）`);
  if (res.status === 404) return { data: [], total_cards: 0, has_more: false };
  if (!res.ok) throw new Error(data.details || res.statusText);
  return data;
}

function searchUrl(q, { ja = false, oldestFirst = false, prints = false, prefer = true } = {}) {
  // 初版の絵柄: 各カードの最も古い印刷を代表として返させる
  if (state.oldest && prefer) q += ' prefer:oldest';
  const params = new URLSearchParams({ q, order: oldestFirst ? 'released' : 'name' });
  if (oldestFirst) params.set('dir', 'asc');
  if (ja) params.set('include_multilingual', 'true');
  if (prints) params.set('unique', 'prints');
  return `https://api.scryfall.com/cards/search?${params}`;
}

// oracle_id の OR 条件をクエリ長の上限に収まるよう分割して検索する。
// onChunk が false を返したら残りの問い合わせを打ち切る
async function searchByOracleIds(cards, suffix, onChunk, opts) {
  const ids = [...new Set(cards.map((c) => c.oracleId).filter(Boolean))];
  const queryOf = (chunk) => `(${chunk.map((id) => `oracleid:${id}`).join(' or ')})${suffix}`;
  while (ids.length) {
    const chunk = [ids.shift()];
    while (ids.length && queryOf([...chunk, ids[0]]).length <= MAX_QUERY_LENGTH) chunk.push(ids.shift());
    let data = await fetchJson(searchUrl(queryOf(chunk), opts));
    let found = data.data;
    for (let page = 1; data.has_more && opts?.done && page < 5; page++) {
      found.forEach(rememberJa);
      if (opts.done(chunk)) break;
      data = await fetchJson(data.next_page);
      found = found.concat(data.data);
    }
    if (onChunk(found, chunk) === false) return;
  }
}

// 指定カードのうちフォーマットのプールに含まれるものの oracle_id を返す
async function legalOracleIds(fmt, cards) {
  const legal = new Set();
  await searchByOracleIds(cards, ` ${formatQuery(fmt)}`, (found) => {
    for (const c of found) legal.add(oracleIdOf(c));
  });
  return legal;
}

// ---------- 検索 ----------

async function startSearch() {
  const input = $('query').value.trim();
  if (!input) return;
  const fmt = currentFormat();
  const ja = /[぀-ヿ一-鿿]/.test(input);
  const id = ++searchId;
  lastResults = [];
  nextPage = null;
  $('search-status').textContent = '検索中…';
  try {
    if (ja && fmt.pool) await searchJapaneseInPool(id, input, fmt);
    else await loadPage(id, searchUrl(`${input} ${formatQuery(fmt)}${ja ? ' lang:ja' : ''}`, { ja }));
  } catch (err) {
    if (id === searchId) $('search-status').textContent = `エラー: ${err.message}`;
  }
}

async function loadPage(id, url) {
  const fmt = currentFormat();
  const data = await fetchJson(url);
  if (id !== searchId) return;
  data.data.forEach(rememberJa);
  const cards = data.data.map(slimCard).filter((c) => !fmt.banned?.includes(c.name));
  markLegal(fmt, cards);
  lastResults = lastResults.concat(cards);
  nextPage = data.has_more ? data.next_page : null;
  const total = data.total_cards - (data.data.length - cards.length);
  $('search-status').textContent = total
    ? `${total} 件（${fmt.name}で使用可能）`
    : '該当するカードが見つかりませんでした。';
  renderResults();
  localize(cards, () => id === searchId);
}

// 日本語版の印刷とセット条件は同じ印刷に掛かってしまうため、
// 日本語名で候補を探してから、英語側でプールに含まれるかを判定する
async function searchJapaneseInPool(id, input, fmt) {
  const data = await fetchJson(searchUrl(`${input} ${fmt.base} lang:ja`, { ja: true, oldestFirst: true }));
  data.data.forEach(rememberJa);
  const candidates = data.data.slice(0, JA_POOL_LIMIT).map(slimCard);
  const legalIds = await legalOracleIds(fmt, candidates);
  if (id !== searchId) return;
  markLegal(fmt, candidates, legalIds);
  lastResults = candidates.filter((c) => legalIds.has(c.oracleId) && isLegal(c, fmt));
  const truncated = data.total_cards > JA_POOL_LIMIT
    ? `／日本語名の候補が多いため古い順に${JA_POOL_LIMIT}件から抽出。条件を足すか英語名で検索すると確実です`
    : '';
  $('search-status').textContent = lastResults.length
    ? `${lastResults.length} 件（${fmt.name}で使用可能${truncated}）`
    : `該当するカードが見つかりませんでした${truncated ? `（${truncated.slice(1)}）` : '。'}`;
  renderResults();
  localize(lastResults, () => id === searchId);
}

// デッキ内カードのうち、非公式フォーマットで未判定のものを問い合わせる
async function validateDeck() {
  const fmt = currentFormat();
  if (!fmt.pool) return;
  const cache = poolLegal[fmt.id];
  const unknown = deckEntries().map((e) => e.card).filter((c) => !cache?.has(c.name));
  if (!unknown.length) return;
  try {
    const legalIds = await legalOracleIds(fmt, unknown);
    markLegal(fmt, unknown.filter((c) => c.oracleId), legalIds);
    if (currentFormat() === fmt) renderDeck();
  } catch {}
}

// ---------- デッキ操作 ----------

function addCard(card) {
  const { cards } = activeDeck();
  const entry = cards[card.name];
  const qty = entry?.qty ?? 0;
  if (qty >= maxCopies(card)) return;
  cards[card.name] = { card: entry?.card ?? card, qty: qty + 1 };
  update();
}

function removeCard(name) {
  const { cards } = activeDeck();
  const entry = cards[name];
  if (!entry) return;
  entry.qty -= 1;
  if (entry.qty <= 0) delete cards[name];
  update();
}

function update() {
  persistJa();
  saveState();
  renderDeck();
  renderResults();
}

const deckEntries = (d = activeDeck()) => Object.values(d.cards);
const deckTotal = (d = activeDeck()) => deckEntries(d).reduce((n, e) => n + e.qty, 0);

// ---------- デッキ管理 ----------

function switchDeck(id) {
  state.current = id;
  saveState();
  onFormatChanged();
  localize(deckEntries().map((e) => e.card));
}

function createDeck() {
  const name = prompt('新しいデッキの名前', L(`デッキ${nextDeckId()}`, `Deck ${nextDeckId()}`));
  if (name === null) return;
  const deck = newDeck(nextDeckId(), name.trim() || L(`デッキ${nextDeckId()}`, `Deck ${nextDeckId()}`), activeDeck().format);
  state.decks.push(deck);
  switchDeck(deck.id);
}

function renameDeck() {
  const deck = activeDeck();
  const name = prompt('デッキ名', deck.name);
  if (!name?.trim()) return;
  deck.name = name.trim();
  saveState();
  renderDeckList();
}

function copyDeck() {
  const src = activeDeck();
  const deck = newDeck(nextDeckId(), L(`${src.name}のコピー`, `Copy of ${src.name}`), src.format, structuredClone(src.cards));
  state.decks.push(deck);
  switchDeck(deck.id);
}

function deleteDeck() {
  const deck = activeDeck();
  if (!confirm(`「${deck.name}」を削除しますか？`)) return;
  state.decks = state.decks.filter((d) => d !== deck);
  if (!state.decks.length) state.decks.push(newDeck(1, L('デッキ1', 'Deck 1'), deck.format));
  switchDeck(state.decks[0].id);
}

function groupOf(card) {
  const front = card.typeLine.split('//')[0];
  return TYPE_GROUPS.find(([t]) => front.includes(t))?.[1] ?? 'その他';
}

function deckWarnings() {
  const fmt = currentFormat();
  const total = deckTotal();
  const warnings = [];
  if (fmt.exact && total !== fmt.size) warnings.push(`${fmt.name}はちょうど${fmt.size}枚です（現在${total}枚）`);
  if (!fmt.exact && total < fmt.size) warnings.push(`${fmt.name}は最低${fmt.size}枚必要です（現在${total}枚）`);
  for (const { card, qty } of deckEntries()) {
    if (!isLegal(card)) warnings.push(`${nameOf(card)} は${fmt.name}で使用できません`);
    else if (qty > maxCopies(card)) warnings.push(`${nameOf(card)} は${maxCopies(card)}枚までです`);
  }
  return warnings;
}

// 日本語名（日本語版がないカードは英語名）
const jaNameOf = (card) => jaCache.get(card.oracleId)?.name ?? card.ja?.name
  ?? (card.displayName && card.displayName !== card.name ? card.displayName : card.name);

function exportText(lang = 'en') {
  return deckEntries()
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
    .map((e) => `${e.qty} ${lang === 'ja' ? jaNameOf(e.card) : e.card.name}`)
    .join('\n');
}

async function copyExport(button, lang) {
  const label = button.textContent;
  button.disabled = true;
  if (lang === 'ja') {
    button.textContent = '日本語名を取得中…';
    // 日本語名をまだ取得していないカードを問い合わせる（表示設定に関係なく）
    await localize(deckEntries().map((e) => e.card), () => true, true);
    persistJa();
  }
  const text = exportText(lang);
  button.disabled = false;
  // スマホは全文を表示する画面から「コピー」「共有」する（ボタンを押してから時間がたつとコピーが許可されないため）
  if (window.isPhone?.()) {
    button.textContent = label;
    showExport(text, lang);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'コピーしました';
    setTimeout(() => (button.textContent = label), 1500);
  } catch {
    button.textContent = label;
    showExport(text, lang);
  }
}

function showExport(text, lang) {
  $('export-title').textContent = `デッキリスト（${lang === 'ja' ? '日本語' : '英語'}）`;
  $('export-text').value = text;
  $('export-status').textContent = '';
  $('export-share').hidden = !navigator.share;
  $('export-dialog').showModal();
}

async function copyFromDialog() {
  const box = $('export-text');
  const status = (t) => ($('export-status').textContent = t);
  try {
    await navigator.clipboard.writeText(box.value);
    status('コピーしました');
    return;
  } catch {}
  // クリップボードの機能が使えないブラウザ向け
  box.focus();
  box.setSelectionRange(0, box.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  status(ok ? 'コピーしました' : 'コピーできませんでした。テキストを長押しして「すべてを選択」→「コピー」してください');
}

function shareExport() {
  navigator.share?.({ title: activeDeck().name, text: $('export-text').value }).catch(() => {});
}

// ---------- インポート ----------

const JA_CHARS = /[\u3040-\u30ff\u3400-\u9fff]/;
const SECTION_WORDS = /^(deck|main ?deck|maindeck|commander|companion|about|creatures?|lands?|spells?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|battles?|other|メイン(デッキ)?|デッキ|統率者|相棒|クリーチャー|土地|呪文|インスタント|ソーサリー|アーティファクト|エンチャント|プレインズウォーカー|バトル)\s*(\(\d+\))?:?$/i;
const SIDEBOARD_WORDS = /^(sideboard|side ?board|sb|サイドボード|サイド)\s*(\(\d+\))?:?$/i;

// デッキリストのテキストを { name, main: [{ name, qty }], sideboard: 枚数 } にする
function parseDeckList(text) {
  const main = [];
  let deckName = '';
  let sideboard = 0;
  let inSide = false;
  // 空行の後ろ（MTGO 形式のサイドボード）は、後でサイドボードか判定する
  let afterBlank = [];
  let sawBlank = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (main.length) sawBlank = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;
    const named = line.match(/^name\s+(.+)$/i);
    if (named) { deckName = named[1].trim(); continue; }
    if (SIDEBOARD_WORDS.test(line)) { inSide = true; continue; }
    if (SECTION_WORDS.test(line)) {
      // 見出しがある形式では、空行はただの区切り
      sawBlank = false;
      main.push(...afterBlank.splice(0));
      continue;
    }
    const m = line.match(/^(SB:\s*)?(?:(\d+)\s*[xX×]?\s+)?(.+)$/);
    if (!m) continue;
    const qty = Number(m[2] ?? 1);
    const name = m[3]
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '') // MTG Arena の (セット) 番号
      .replace(/\s+\*[A-Z]+\*\s*$/, '') // *F* など
      .replace(/\s+\[[^\]]*\]\s*$/, '') // [セット]
      .trim();
    if (!name || !qty) continue;
    if (inSide || m[1]) { sideboard += qty; continue; }
    if (sawBlank) afterBlank.push({ name, qty });
    else main.push({ name, qty });
  }
  // 空行の後ろが15枚以下で、メインが40枚以上ならサイドボードとみなす（MTGO 形式）
  const total = (list) => list.reduce((n, e) => n + e.qty, 0);
  if (afterBlank.length && total(afterBlank) <= 15 && total(main) >= 40) sideboard += total(afterBlank);
  else main.push(...afterBlank);
  // 同じカードの行はまとめる
  const merged = new Map();
  for (const e of main) {
    const key = e.name.toLowerCase();
    if (merged.has(key)) merged.get(key).qty += e.qty;
    else merged.set(key, { ...e });
  }
  return { name: deckName, main: [...merged.values()], sideboard };
}

const nameKey = (s) => s.toLowerCase().replace(/[’`]/g, "'").trim();

// 英語名 → Scryfall のカード（完全一致の名前を OR でまとめて検索）
async function findEnglish(names, onProgress) {
  const found = new Map();
  const queue = [...new Set(names)];
  const term = (n) => `!"${n.split(' // ')[0].replace(/"/g, '')}"`;
  const queryOf = (chunk) => `(${chunk.map(term).join(' or ')})`;
  let done = 0;
  while (queue.length) {
    const chunk = [queue.shift()];
    while (queue.length && queryOf([...chunk, queue[0]]).length <= MAX_QUERY_LENGTH) chunk.push(queue.shift());
    let data = await fetchJson(searchUrl(queryOf(chunk)));
    let cards = data.data;
    while (data.has_more) {
      data = await fetchJson(data.next_page);
      cards = cards.concat(data.data);
    }
    for (const n of chunk) {
      const k = nameKey(n.split(' // ')[0]);
      const c = cards.find((x) => nameKey(x.name) === nameKey(n) || nameKey(x.name.split(' // ')[0]) === k
        || x.card_faces?.some((f) => nameKey(f.name) === k));
      if (c) found.set(n, c);
    }
    done += chunk.length;
    onProgress?.(done);
  }
  return found;
}

// 日本語名 → 英語名（日本語版の印刷名で検索し、完全一致を優先）
async function findJapanese(name) {
  const data = await fetchJson(searchUrl(`"${name.replace(/"/g, '')}" lang:ja`, { ja: true, prefer: false }));
  const printed = (c) => [c.printed_name, ...(c.card_faces ?? []).map((f) => f.printed_name)].filter(Boolean);
  const c = data.data.find((x) => printed(x).includes(name))
    ?? data.data.find((x) => printed(x).some((p) => p.replace(/\s/g, '') === name.replace(/\s/g, '')))
    ?? (data.data.length === 1 ? data.data[0] : null);
  if (c) rememberJa(c);
  return c;
}

function openImport() {
  $('import-text').value = '';
  $('import-name').value = '';
  $('import-status').textContent = '';
  $('import-run').disabled = false;
  $('import-dialog').showModal();
  $('import-text').focus();
}

async function runImport(e) {
  e.preventDefault();
  const parsed = parseDeckList($('import-text').value);
  if (!parsed.main.length) {
    $('import-status').textContent = 'カードの行が見つかりませんでした。「4 Lightning Bolt」「4 稲妻」のように1行に1種類書いてください。';
    return;
  }
  const status = (t) => ($('import-status').textContent = t);
  $('import-run').disabled = true;
  try {
    // 日本語名は1枚ずつ英語名に変換
    const jaLines = parsed.main.filter((l) => JA_CHARS.test(l.name));
    const english = new Map(); // 行の名前 → 英語名
    let i = 0;
    for (const l of jaLines) {
      status(`日本語名を調べています…（${++i}/${jaLines.length}）`);
      const c = await findJapanese(l.name);
      if (c) english.set(l.name, c.name);
    }
    for (const l of parsed.main) if (!JA_CHARS.test(l.name)) english.set(l.name, l.name);

    const names = [...new Set(english.values())];
    status(`カードを検索しています…（0/${names.length}）`);
    const found = await findEnglish(names, (n) => status(`カードを検索しています…（${n}/${names.length}）`));

    const cards = {};
    const missing = [];
    for (const l of parsed.main) {
      const raw = found.get(english.get(l.name));
      if (!raw) { missing.push(l.name); continue; }
      const card = slimCard(raw);
      if (cards[card.name]) cards[card.name].qty += l.qty;
      else cards[card.name] = { card, qty: l.qty };
    }
    if (!Object.keys(cards).length) {
      status(`カードが1枚も見つかりませんでした：${missing.join('、')}`);
      $('import-run').disabled = false;
      return;
    }
    const name = $('import-name').value.trim() || parsed.name || L(`インポート${nextDeckId()}`, `Import ${nextDeckId()}`);
    const deck = newDeck(nextDeckId(), name, activeDeck().format, cards);
    state.decks.push(deck);
    switchDeck(deck.id);
    persistJa();
    saveState();
    localize(deckEntries().map((x) => x.card));

    const total = Object.values(cards).reduce((n, x) => n + x.qty, 0);
    const notes = [`「${name}」に${total}枚を読み込みました。`];
    if (missing.length) notes.push(`見つからなかったカード：${missing.join('、')}`);
    if (parsed.sideboard) notes.push(`サイドボード（${parsed.sideboard}枚）は読み込んでいません。`);
    if (missing.length || parsed.sideboard) {
      // 読み込み済みなので、もう一度押して二重に取り込まないよう「インポート」は押せないままにする
      status(notes.join('\n'));
    } else {
      $('import-dialog').close();
      alert(notes[0]);
    }
  } catch (err) {
    status(`エラー: ${err.message}`);
    $('import-run').disabled = false;
  }
}

// ---------- 描画 ----------

// 拡大表示に渡すカード（表示中の名前・画像）
const detailOf = (card) => {
  const ja = state.ja ? jaCache.get(card.oracleId) ?? card.ja : null;
  const pt = card.power != null ? `${card.power}/${card.toughness}` : '';
  return { name: nameOf(card), image: imageOf(card), text: [card.typeLine, ja?.text || card.oracleText, pt].filter(Boolean).join('\n') };
};

function renderResults() {
  const box = $('results');
  box.replaceChildren(...lastResults.map((card) => {
    const qty = activeDeck().cards[card.name]?.qty ?? 0;
    const btn = document.createElement('button');
    btn.className = 'result' + (qty >= maxCopies(card) ? ' maxed' : '');
    const image = imageOf(card);
    btn.title = `${nameOf(card)}（クリックで追加）`;
    btn.innerHTML = image
      ? `<img loading="lazy" alt="">`
      : `<div class="noimg"></div>`;
    if (image) btn.querySelector('img').src = image;
    else btn.querySelector('.noimg').textContent = nameOf(card);
    if (qty) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = qty;
      btn.append(badge);
    }
    btn.addEventListener('click', () => addCard(card));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // スマホの長押しは拡大表示（減らすのは拡大表示のボタンから）
      if (!window.isPhone?.()) removeCard(card.name);
    });
    onLongPress(btn, () => showCardDetail(detailOf(card), [
      ['1枚追加', () => addCard(card)],
      ['1枚減らす', () => removeCard(card.name)],
    ]));
    return btn;
  }));
  $('more').hidden = !nextPage;
}

function renderDeckList() {
  $('deck-select').replaceChildren(...state.decks.map((d) => {
    const fmt = FORMATS.find((f) => f.id === d.format);
    return new Option(`${d.name}（${fmt.name}・${deckTotal(d)}枚）`, d.id);
  }));
  $('deck-select').value = activeDeck().id;
  $('format').value = activeDeck().format;
}

function renderDeck() {
  renderDeckList();
  const fmt = currentFormat();
  $('deck-count').textContent = deckTotal();
  const phoneCount = document.getElementById('phone-deck-count');
  if (phoneCount) phoneCount.textContent = deckTotal();
  $('deck-target').textContent = ` / ${fmt.size}`;

  $('warnings').replaceChildren(...deckWarnings().map((w) => {
    const li = document.createElement('li');
    li.textContent = w;
    return li;
  }));

  renderCurve();

  const groups = new Map();
  for (const e of deckEntries()) {
    const g = groupOf(e.card);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const order = [...TYPE_GROUPS.map(([, ja]) => ja), 'その他'];
  const deck = $('deck');
  if (!groups.size) {
    deck.innerHTML = '<p class="empty">検索結果のカードをクリックして追加（右クリックで1枚減らす）</p>';
    return;
  }
  deck.replaceChildren(...order.filter((g) => groups.has(g)).flatMap((g) => {
    const entries = groups.get(g).sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
    const h = document.createElement('h3');
    h.textContent = `${g} (${entries.reduce((n, e) => n + e.qty, 0)})`;
    return [h, ...entries.map(renderRow)];
  }));
}

function renderRow({ card, qty }) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="qty"></span><span class="name"></span><button class="art" title="絵柄を選ぶ">絵</button><button class="minus">−</button><button class="plus">＋</button>`;
  row.querySelector('.qty').textContent = qty;
  row.querySelector('.name').textContent = nameOf(card);
  if (!isLegal(card)) {
    const tag = document.createElement('span');
    tag.className = 'illegal';
    tag.textContent = '使用不可';
    row.querySelector('.name').after(tag);
  }
  if (card.pick) row.querySelector('.art').classList.add('picked');
  row.querySelector('.art').addEventListener('click', () => openArtPicker(card));
  row.querySelector('.minus').addEventListener('click', () => removeCard(card.name));
  row.querySelector('.plus').addEventListener('click', () => addCard(card));
  // スマホ：カード名の長押しで拡大表示
  onLongPress(row.querySelector('.name'), () => showCardDetail(detailOf(card), [
    ['1枚追加', () => addCard(card)],
    ['1枚減らす', () => removeCard(card.name)],
  ]));
  row.addEventListener('mouseenter', () => {
    const image = imageOf(card);
    if (!image) return;
    $('preview').src = image;
    $('preview').hidden = false;
  });
  return row;
}

function renderCurve() {
  const buckets = Array(8).fill(0); // 0..6, 7+
  for (const { card, qty } of deckEntries()) {
    if (groupOf(card) === '土地') continue;
    buckets[Math.min(Math.floor(card.cmc), 7)] += qty;
  }
  const max = Math.max(1, ...buckets);
  $('curve').replaceChildren(...buckets.map((n, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `<span class="n">${n || ''}</span><div class="fill" style="height:${(n / max) * 100}%"></div><span class="label">${i === 7 ? '7+' : i}</span>`;
    return bar;
  }));
}

// ---------- 初期化 ----------

// フォーマットが変わったとき（フォーマット選択・デッキ切り替え）の再判定と再検索
function onFormatChanged() {
  renderDeck();
  validateDeck();
  if ($('query').value.trim()) startSearch();
  else renderResults();
}

function init() {
  const select = $('format');
  const official = document.createElement('optgroup');
  official.label = '公式フォーマット';
  const custom = document.createElement('optgroup');
  custom.label = '非公式フォーマット';
  for (const f of FORMATS) (f.pool ? custom : official).append(new Option(f.name, f.id));
  select.replaceChildren(official, custom);
  select.addEventListener('change', () => {
    activeDeck().format = select.value;
    saveState();
    onFormatChanged();
  });

  $('deck-select').addEventListener('change', (e) => switchDeck(Number(e.target.value)));
  $('deck-new').addEventListener('click', createDeck);
  $('deck-rename').addEventListener('click', renameDeck);
  $('deck-copy').addEventListener('click', copyDeck);
  $('deck-delete').addEventListener('click', deleteDeck);
  $('deck-play').addEventListener('click', () => {
    location.href = `play.html?deck=${activeDeck().id}`;
  });

  const jaToggle = $('ja');
  jaToggle.checked = state.ja;
  jaToggle.addEventListener('change', () => {
    state.ja = jaToggle.checked;
    saveState();
    renderResults();
    renderDeck();
    localize([...deckEntries().map((e) => e.card), ...lastResults]);
  });

  const oldestToggle = $('oldest');
  oldestToggle.checked = state.oldest;
  oldestToggle.addEventListener('change', () => {
    state.oldest = oldestToggle.checked;
    jaCache.clear();
    jaChecked.clear();
    saveState();
    if ($('query').value.trim()) startSearch();
    else renderResults();
    renderDeck();
    refreshArt(allDeckCards());
  });

  $('art-more').addEventListener('click', () => {
    if (artNext) loadArtPage(artNext, artTarget);
    $('art-more').hidden = true;
  });
  $('art-reset').addEventListener('click', () => pickArt(null));
  $('art-cancel').addEventListener('click', () => $('art-dialog').close());
  $('art-dialog').addEventListener('close', () => (artTarget = null));

  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); startSearch(); });
  $('more').addEventListener('click', () => {
    if (!nextPage) return;
    // 読み込み中にもう一度押されても同じページを二重に追加しないよう、先に消しておく
    const url = nextPage;
    nextPage = null;
    $('more').hidden = true;
    const id = searchId;
    loadPage(id, url).catch((err) => {
      if (id !== searchId) return;
      $('search-status').textContent = `エラー: ${err.message}`;
      // 失敗したページはもう一度押して読み込み直せるようにする
      nextPage = url;
      $('more').hidden = false;
    });
  });

  $('export').addEventListener('click', () => copyExport($('export'), 'en'));
  $('export-ja').addEventListener('click', () => copyExport($('export-ja'), 'ja'));
  $('import').addEventListener('click', openImport);
  $('import-form').addEventListener('submit', runImport);
  $('import-cancel').addEventListener('click', () => $('import-dialog').close());
  $('export-copy').addEventListener('click', copyFromDialog);
  $('export-share').addEventListener('click', shareExport);
  $('export-close').addEventListener('click', () => $('export-dialog').close());

  $('clear').addEventListener('click', () => {
    if (!deckTotal() || confirm('デッキを空にしますか？')) {
      activeDeck().cards = {};
      update();
    }
  });

  renderDeck();
  validateDeck();
  localize(deckEntries().map((e) => e.card));
  refreshArt(allDeckCards());
  fillCardInfo();
  fixCopyRules();
}

init();
