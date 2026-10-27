// Magic: The Gathering System — 一人回し／ネット対戦（MTGO風・ルール処理は手動）
// 自分のゲーム状態はすべて `game` に持ち、変更は act() を通して行う（元に戻すのため）。
// ネット対戦では、描画のたびに自分の公開情報（snapshot）を相手に送り、相手の公開情報を `opp` に受け取る。
// 手札の中身とライブラリーの順番は送らない（MTGO と同じ公開範囲）。

const STORAGE_KEY = 'mtg-deckmaker-v1';
const GAME_KEY = 'mtg-deckmaker-game';
const HISTORY_LIMIT = 200;
const MAX_HAND = 7;
const LANDS_PER_TURN = 1;
const NET_KEY = 'mtg-deckmaker-net';
const CHAT_KEY = 'mtg-deckmaker-chat';
const NAME_KEY = 'mtg-deckmaker-name';
const PHASE_NAMES = {
  mulligan: 'マリガン', keep: 'マリガン', ready: '開始待ち',
};

const PHASES = [
  ['untap', 'アンタップ'],
  ['upkeep', 'アップキープ'],
  ['draw', 'ドロー'],
  ['main1', 'メイン1'],
  ['begincombat', '戦闘開始'],
  ['attack', '攻撃'],
  ['block', 'ブロック'],
  ['damage', 'ダメージ'],
  ['endcombat', '戦闘終了'],
  ['main2', 'メイン2'],
  ['end', '終了'],
  ['cleanup', 'クリンナップ'],
];

const PHASE_HINTS = {
  ready: '相手を待っています。',
  mulligan: '初手を確認して、キープかマリガンを選んでください。',
  keep: 'ライブラリーの一番下に置くカードを手札から選んでください。',
  untap: 'アンタップ・ステップ。',
  upkeep: 'アップキープ・ステップ。インスタントを唱えたり、能力を起動したりできます。',
  draw: 'ドロー・ステップ。インスタントを唱えたり、能力を起動したりできます。',
  main1: '第1メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。',
  begincombat: '戦闘開始ステップ。',
  attack: '攻撃クリーチャー指定ステップ。攻撃するクリーチャーをクリックしてください。',
  block: 'ブロック・クリーチャー指定ステップ。',
  damage: '戦闘ダメージ・ステップ。',
  endcombat: '戦闘終了ステップ。',
  main2: '第2メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。',
  end: '終了ステップ。インスタントを唱えたり、能力を起動したりできます。',
  cleanup: 'クリンナップ・ステップ。',
};

const ZONES = { library: 'ライブラリー', hand: '手札', battlefield: '戦場', graveyard: '墓地', exile: '追放' };

const $ = (id) => document.getElementById(id);

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
})();
const decks = saved.decks ?? [];
const useJa = saved.ja ?? true;

let game = loadGame();
let history = [];
// 表示中の一覧ダイアログ { zone, title, ids: 表示対象のカード（null なら領域全体） } / 相手の領域なら { opp: zone, title }
let viewer = null;

// ---------- ネット対戦の状態 ----------

// 対戦相手 { name, state: 相手の snapshot, connected }
let opp = null;
// チャット [{ ts, who: 'me' | 'opp' | 'system', name, text }]
let chat = loadJson(sessionStorage, CHAT_KEY) ?? [];
// 接続情報 { role: 'host' | 'guest', code }（再読み込みしても同じ部屋に戻る）
let netInfo = loadJson(sessionStorage, NET_KEY);
// 部屋に入る側が、先手後手を受け取る前にゲームを始めた場合の保留
let pendingHostOnDraw = null;
let clearHistoryAfterAct = false;

function loadJson(store, key) {
  try { return JSON.parse(store.getItem(key)); } catch { return null; }
}
function saveJson(store, key, value) {
  try {
    if (value == null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {}
}
// 名前はタブごと（同じPCの2つのタブで対戦しても混ざらない）→ なければ前回使った名前
const defaultName = () => (document.documentElement.lang === 'en' ? 'Player' : 'プレイヤー');
const myName = () => {
  try { return sessionStorage.getItem(NAME_KEY) || localStorage.getItem(NAME_KEY) || defaultName(); } catch { return defaultName(); }
};
const oppName = () => opp?.name || '相手';
const online = () => Net.active;

// ---------- スマホ（タッチ操作） ----------

// device.js が判定する（読み込まれていなければ PC 扱い）
const phone = () => window.isPhone?.() ?? false;

// 長押し（タッチのみ）。長押し後に続けて起きる click は無視する
function onLongPress(el, fn) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    // 端末によっては長押しの後に click が起きないので、次に触れたときに印を消す
    delete el.dataset.longpress;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      el.dataset.longpress = '1';
      fn(e);
    }, 450);
  });
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => {
    if (!el.dataset.longpress) return;
    delete el.dataset.longpress;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

// スマホでは長押しで出すので、ブラウザ標準の長押しメニューは止める
function onContextMenu(el, fn) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone()) fn(e);
  });
  onLongPress(el, fn);
}

// ---------- ゲーム状態 ----------

function loadGame() {
  try { return JSON.parse(sessionStorage.getItem(GAME_KEY)); } catch { return null; }
}

function saveGame() {
  try { sessionStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch {}
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardFrom(card, iid) {
  const ja = useJa ? card.ja : null;
  return {
    iid,
    name: ja?.name ?? (useJa ? card.displayName : card.name) ?? card.name,
    image: card.pick?.image ?? ja?.image ?? card.image,
    isLand: /\bLand\b/.test((card.typeLine ?? '').split('//')[0]),
    isCreature: /\bCreature\b/.test(card.typeLine ?? ''),
    tapped: false,
    counters: 0,
  };
}

function newGame(deck, onDraw, random = false) {
  const cards = {};
  const library = [];
  let iid = 0;
  for (const { card, qty } of Object.values(deck.cards)) {
    for (let i = 0; i < qty; i++) {
      iid++;
      cards[iid] = cardFrom(card, iid);
      library.push(iid);
    }
  }
  game = {
    deckId: deck.id,
    deckName: deck.name,
    onDraw,
    turn: 0,
    phase: 'mulligan',
    mulligans: 0,
    toBottom: 0,
    life: deck.format === 'commander' ? 40 : 20,
    nextIid: iid + 1,
    cards,
    // ライブラリーは先頭が一番上
    zones: { library: shuffle(library), hand: [], battlefield: [], graveyard: [], exile: [] },
    log: [],
    // ネット対戦：相手のターン中は true。先手後手が確定したら orderFixed
    waiting: false,
    orderFixed: !online() || Net.role === 'host',
    passReceived: false,
  };
  if (online() && Net.role === 'guest' && pendingHostOnDraw !== null) {
    game.onDraw = !pendingHostOnDraw;
    game.orderFixed = true;
  }
  history = [];
  log(`「${deck.name}」で開始${game.orderFixed ? `（${random ? 'ランダムで' : ''}${game.onDraw ? '後手' : '先手'}）` : ''}`);
  drawCards(7, false);
  render();
  if (Net.connected()) sendHello();
}

// 状態を変更する操作はすべてここを通す
function act(fn) {
  if (!game) return;
  history.push(JSON.stringify(game));
  if (history.length > HISTORY_LIMIT) history.shift();
  fn();
  // ターンを渡した・受け取った操作は元に戻せない（相手の画面と食い違うため）
  if (clearHistoryAfterAct) {
    history = [];
    clearHistoryAfterAct = false;
  }
  render();
}

// 相手からのメッセージによる変更（元に戻す対象にしない）
function netUpdate(fn) {
  if (!game) return;
  fn();
  history = [];
  render();
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  game = JSON.parse(prev);
  render();
}

function log(text) {
  game.log.push({ turn: game.turn, text, ts: Date.now() });
}

const zoneOf = (iid) => Object.keys(game.zones).find((z) => game.zones[z].includes(iid));
const started = () => game && game.turn > 0;
// 自分のターン中か（一人回しでは常に自分のターン）
const myTurn = () => started() && !game.waiting;

// ---------- 基本操作（act の中で呼ぶ） ----------

function moveCard(iid, to, { bottom = false, silent = false } = {}) {
  const from = zoneOf(iid);
  if (!from) return;
  const card = game.cards[iid];
  game.zones[from] = game.zones[from].filter((x) => x !== iid);
  if (card.token && to !== 'battlefield') {
    delete game.cards[iid];
    if (!silent) log(`${card.name}（トークン）が消滅`);
    return;
  }
  if (to !== 'battlefield') {
    card.tapped = false;
    card.counters = 0;
    card.attacking = false;
  }
  if (card.isLand && from === 'hand' && to === 'battlefield' && started()) game.landsPlayed = (game.landsPlayed ?? 0) + 1;
  if (to === 'library' && !bottom) game.zones.library.unshift(iid);
  else game.zones[to].push(iid);
  if (!silent) {
    const where = to === 'library' ? `ライブラリーの一番${bottom ? '下' : '上'}` : ZONES[to];
    log(`${card.name}：${ZONES[from]} → ${where}`);
  }
}

function drawCards(n, withLog = true) {
  let drawn = 0;
  for (; drawn < n && game.zones.library.length; drawn++) game.zones.hand.push(game.zones.library.shift());
  if (withLog) log(drawn ? `${drawn}枚引いた` : 'ライブラリーが空で引けない');
}

function untapAll() {
  for (const iid of game.zones.battlefield) game.cards[iid].tapped = false;
}

function startTurnOne() {
  game.turn = 1;
  game.landsPlayed = 0;
  game.phase = 'main1';
  log('ターン1開始');
  if (game.onDraw) drawCards(1);
}

function beginTurn() {
  game.turn++;
  game.landsPlayed = 0;
  game.pendingEndTurn = false;
  log(`ターン${game.turn}開始`);
  clearAttackers();
  untapAll();
  game.phase = 'upkeep';
}

function stepPhase() {
  if (game.toDiscard > 0) return; // 手札を捨て終わるまで進めない
  const i = PHASES.findIndex(([id]) => id === game.phase);
  if (i === PHASES.length - 1) return online() ? passTurn() : beginTurn();
  game.phase = PHASES[i + 1][0];
  if (game.phase === 'draw') drawCards(1);
  if (game.phase === 'endcombat') clearAttackers();
  if (game.phase === 'cleanup') checkHandSize();
}

// クリンナップ・ステップ：手札が上限を超えていたら捨てるカードを選ばせる
function checkHandSize() {
  const over = game.zones.hand.length - MAX_HAND;
  game.toDiscard = Math.max(0, over);
  if (over > 0) log(`手札が${game.zones.hand.length}枚：${over}枚捨ててください`);
}

function clearAttackers() {
  for (const iid of game.zones.battlefield) game.cards[iid].attacking = false;
}

function createToken(name, image = null) {
  const iid = game.nextIid++;
  game.cards[iid] = { iid, name, image, isLand: false, isCreature: true, tapped: false, counters: 0, token: true };
  game.zones.battlefield.push(iid);
  log(`${name}（トークン）を生成`);
}

// ---------- ユーザー操作 ----------

function mulligan() {
  act(() => {
    game.zones.library.push(...game.zones.hand);
    game.zones.hand = [];
    shuffle(game.zones.library);
    game.mulligans++;
    drawCards(7, false);
    log(`マリガン（${game.mulligans}回目）`);
  });
}

function keep() {
  act(() => {
    log(`キープ（マリガン${game.mulligans}回）`);
    game.toBottom = Math.min(game.mulligans, game.zones.hand.length);
    game.phase = 'keep';
    if (!game.toBottom) beginFirstTurn();
  });
}

function bottomFromHand(iid) {
  act(() => {
    moveCard(iid, 'library', { bottom: true, silent: true });
    log('手札から1枚をライブラリーの一番下へ');
    game.toBottom--;
    if (!game.toBottom) beginFirstTurn();
  });
}

function discardFromHand(iid) {
  act(() => {
    moveCard(iid, 'graveyard', { silent: true });
    log(`${game.cards[iid].name}を捨てた（手札調整）`);
    game.toDiscard--;
    if (!game.toDiscard && game.pendingEndTurn) finishTurn();
  });
}

// 手札上限を無視して続ける（「手札の上限がない」効果など）
function skipDiscard() {
  act(() => {
    log(`手札調整をスキップ（手札${game.zones.hand.length}枚）`);
    game.toDiscard = 0;
    if (game.pendingEndTurn) finishTurn();
  });
}

function startNextTurn() {
  beginTurn();
  stepPhase(); // ドロー
  stepPhase(); // メイン1
}

// ---------- ターンの受け渡し（ネット対戦） ----------

// キープ後：一人回しはすぐ1ターン目。ネット対戦は先手後手の確定を待つ
function beginFirstTurn() {
  if (!online()) return startTurnOne();
  game.phase = 'ready';
  tryFirstTurn();
}

function tryFirstTurn() {
  if (game.phase !== 'ready' || !game.orderFixed) return;
  if (!game.onDraw || game.passReceived) {
    game.waiting = false;
    startTurnOne();
  } else {
    game.waiting = true;
  }
}

// ターン終了：一人回しは次の自分のターン、ネット対戦は相手に渡す
function finishTurn() {
  if (online()) passTurn();
  else startNextTurn();
}

function passTurn() {
  game.phase = 'cleanup';
  game.pendingEndTurn = false;
  clearAttackers();
  game.waiting = true;
  log('ターン終了（相手のターンへ）');
  game.passSent = Net.send({ type: 'pass' });
  clearHistoryAfterAct = true;
}

function receivePass() {
  netUpdate(() => {
    if (game.turn === 0) {
      game.passReceived = true;
      tryFirstTurn();
    } else if (game.waiting) {
      game.waiting = false;
      game.passSent = false;
      startNextTurn();
    }
  });
}

// 通信の不具合などで止まったときに、自分のターンを強制的に始める
function forceMyTurn() {
  if (!game) return;
  act(() => {
    game.waiting = false;
    log('自分のターンを開始（手動）');
    if (game.turn === 0) startTurnOne();
    else startNextTurn();
    clearHistoryAfterAct = true;
  });
}

// 攻撃ステップでクリーチャーをクリック：タップして攻撃（もう一度クリックで取り消し）
function toggleAttack(iid, { vigilance = false } = {}) {
  act(() => {
    const c = game.cards[iid];
    if (c.attacking) {
      c.attacking = false;
      if (!c.vigilance) c.tapped = false;
      c.vigilance = false;
      log(`${c.name}の攻撃を取り消し`);
      return;
    }
    c.attacking = true;
    c.vigilance = vigilance;
    if (!vigilance) c.tapped = true;
    log(`${c.name}で攻撃${vigilance ? '（タップしない）' : ''}`);
  });
}

const canAttack = (c) => game.phase === 'attack' && !c.isLand && c.isCreature !== false && (c.attacking || !c.tapped);

function onBattlefieldClick(iid) {
  if (canAttack(game.cards[iid])) toggleAttack(iid);
  else toggleTap(iid);
}

// 手からの土地は1ターン1枚まで（超える場合は確認してから出す）
function moveByUser(iid, to, opts) {
  const c = game.cards[iid];
  if (c.isLand && to === 'battlefield' && zoneOf(iid) === 'hand' && started()
      && (game.landsPlayed ?? 0) >= LANDS_PER_TURN
      && !confirm(`このターンはすでに土地を${game.landsPlayed}枚プレイしています。それでも出しますか？`)) return;
  act(() => moveCard(iid, to, opts));
}

// スマホ：フェイズの一覧を画面下のシートで出して、押したフェイズまで進める
function openPhaseMenu() {
  if (!myTurn()) return;
  const i = PHASES.findIndex(([id]) => id === game.phase);
  const items = [];
  PHASES.forEach(([id, name], j) => {
    // 対戦中は前のフェイズに戻れない（ターンの終わりを越えると相手にターンが渡るため）
    if (online() && j < i) return;
    items.push([`${j === i ? '▶ ' : ''}${name}${j === i ? '（今）' : j < i ? '（次のターン）' : ''}`, () => { if (j !== i) goToPhase(id); }]);
  });
  showMenu(items, 0, 0);
}

function goToPhase(target) {
  if (!myTurn()) return;
  if (target === 'untap') target = 'upkeep'; // アンタップ・ステップは自動で通過する
  // 対戦中は今より前のフェイズには進めない（ターンの終わりを越えると相手にターンが渡るため）
  const index = (id) => PHASES.findIndex(([p]) => p === id);
  if (online() && index(target) <= index(game.phase)) return;
  act(() => {
    let guard = 0;
    do stepPhase(); while (game.phase !== target && ++guard < PHASES.length + 1);
  });
}

function nextPhase() {
  if (myTurn()) act(stepPhase);
}

function endTurn() {
  if (!myTurn() || game.toDiscard > 0) return;
  act(() => {
    if (game.phase !== 'cleanup') {
      game.phase = 'cleanup';
      clearAttackers();
      checkHandSize();
    }
    if (game.toDiscard > 0) game.pendingEndTurn = true;
    else finishTurn();
  });
}

function toggleTap(iid) {
  act(() => {
    const c = game.cards[iid];
    c.tapped = !c.tapped;
    log(`${c.name}を${c.tapped ? 'タップ' : 'アンタップ'}`);
  });
}

function askNumber(message, initial = '1') {
  const v = prompt(message, initial);
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- 描画 ----------

function render() {
  saveGame();
  if (!game) return;
  $('deck-name').textContent = game.deckName;
  $('turn-label').textContent = game.turn ? `ターン ${game.turn}` : '初手';
  $('phase-hint').textContent = game.toDiscard > 0
    ? `手札が多すぎます。${game.toDiscard}枚捨ててください。`
    : game.waiting ? '相手プレイヤーのターンです。インスタントを唱えたり、能力を起動したりできます。' : PHASE_HINTS[game.phase] ?? '';
  $('land-count').textContent = started() ? `土地 ${game.landsPlayed ?? 0}/${LANDS_PER_TURN}` : '';
  $('land-count').classList.toggle('over', (game.landsPlayed ?? 0) > LANDS_PER_TURN);

  $('phases').replaceChildren(...PHASES.map(([id, name]) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.className = id === game.phase ? 'current' : '';
    b.disabled = !myTurn();
    b.addEventListener('click', () => goToPhase(id));
    return b;
  }));
  for (const id of ['next-phase', 'end-turn']) $(id).disabled = !myTurn() || game.toDiscard > 0;
  $('phase-current').textContent = `${phaseName(game.phase) || '—'} ▼`;
  $('phase-current').disabled = !myTurn() || game.toDiscard > 0;
  $('undo').disabled = !history.length;

  renderBanner();

  const bf = game.zones.battlefield;
  fillZone('bf-main', bf.filter((i) => !game.cards[i].isLand), 'battlefield');
  fillZone('bf-lands', bf.filter((i) => game.cards[i].isLand), 'battlefield');
  fillZone('hand', game.zones.hand, 'hand');
  $('hand-count').textContent = `(${game.zones.hand.length})`;

  $('life').textContent = game.life;
  for (const z of ['library', 'graveyard', 'exile']) $(`${z}-count`).textContent = game.zones[z].length;
  for (const z of ['graveyard', 'exile']) {
    const top = game.cards[game.zones[z].at(-1)];
    $(`pile-${z}`).style.backgroundImage = top?.image ? `url("${top.image}")` : '';
  }

  renderLog();
  renderOpp();
  if (viewer) renderViewer();
  scheduleSync();
}

// 自分のログ・相手のログ・チャットを時刻順にまとめて表示
function renderLog() {
  const entries = (game?.log ?? []).map((e) => ({ ...e, who: 'me' }));
  if (online()) {
    entries.push(...(opp?.state?.log ?? []).map((e) => ({ ...e, who: 'opp' })), ...chat);
    entries.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  }
  const el = $('log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.replaceChildren(...entries.slice(-400).map((e) => {
    const li = document.createElement('li');
    li.className = e.who;
    if (e.text !== undefined && (e.who === 'me' || e.who === 'opp') && e.turn !== undefined) {
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = e.turn ? `T${e.turn}` : '—';
      li.append(t);
      if (e.who === 'opp' && !e.chat) {
        const n = document.createElement('span');
        n.className = 'who';
        n.textContent = `${oppName()}：`;
        li.append(n);
      }
      li.append(e.text);
    } else if (e.who === 'system') {
      li.className = 'system';
      li.textContent = e.text;
    } else {
      // チャット
      li.className = `chat-line ${e.who}`;
      const n = document.createElement('span');
      n.className = 'who';
      n.textContent = `${e.name}：`;
      li.append(n, e.text);
    }
    return li;
  }));
  if (atBottom || entries.at(-1)?.who === 'me') el.scrollTop = el.scrollHeight;
  markUnread(entries.filter((e) => e.who !== 'me').length);
}

// スマホ：ログを閉じている間に相手の行動・チャットが届いたら、ボタンに印を付ける
let seenOthers = null;
function markUnread(others) {
  const btn = $('sheet-log-btn');
  if (!btn) return;
  if (seenOthers === null || document.body.dataset.sheet === 'log' || !phone()) seenOthers = others;
  btn.classList.toggle('unread', others > seenOthers);
}

function renderBanner() {
  const bar = $('mulligan-bar');
  if (game.toDiscard > 0) {
    bar.hidden = false;
    const label = document.createElement('span');
    label.textContent = `クリンナップ：手札が${MAX_HAND}枚になるまで、捨てるカードを手札からあと${game.toDiscard}枚クリックしてください`;
    const skip = document.createElement('button');
    skip.textContent = '捨てずに続ける';
    skip.addEventListener('click', skipDiscard);
    bar.replaceChildren(label, skip);
    return;
  }
  if (game.waiting || game.phase === 'ready') {
    bar.hidden = false;
    const label = document.createElement('span');
    label.textContent = !game.orderFixed
      ? '相手の接続を待っています（先手・後手は部屋を作った人が決めます）'
      : game.waiting ? '相手プレイヤーのターンです' : '相手を待っています';
    const force = document.createElement('button');
    force.textContent = '自分のターンを始める';
    force.title = '通信が止まったときなどに使います';
    force.addEventListener('click', () => {
      if (confirm('相手のターンを待たずに、自分のターンを始めますか？')) forceMyTurn();
    });
    bar.replaceChildren(label, ...(game.orderFixed ? [force] : []));
    return;
  }
  bar.hidden = game.turn > 0;
  if (bar.hidden) return;
  if (game.phase === 'mulligan') {
    const label = document.createElement('span');
    label.textContent = game.mulligans ? `マリガン${game.mulligans}回目の手札` : '初手';
    const m = document.createElement('button');
    m.textContent = 'マリガン';
    m.addEventListener('click', mulligan);
    const k = document.createElement('button');
    k.className = 'primary';
    k.textContent = 'キープ';
    k.addEventListener('click', keep);
    bar.replaceChildren(label, m, k);
  } else {
    bar.textContent = `ライブラリーの一番下に置くカードを、手札からあと${game.toBottom}枚クリックしてください`;
  }
}

function fillZone(elId, ids, zone) {
  $(elId).replaceChildren(...ids.map((iid) => cardEl(iid, zone)));
}

function cardEl(iid, zone) {
  const c = game.cards[iid];
  const el = document.createElement('div');
  el.className = 'card' + (c.tapped ? ' tapped' : '') + (c.token ? ' token' : '') + (c.attacking ? ' attacking' : '');
  el.draggable = !phone();
  el.title = c.name;
  if (c.image) {
    const img = document.createElement('img');
    img.src = c.image;
    img.alt = c.name;
    el.append(img);
  } else {
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = c.name;
    el.append(text);
  }
  if (c.counters) {
    const badge = document.createElement('span');
    badge.className = 'counter';
    badge.textContent = c.counters;
    el.append(badge);
  }

  if (c.attacking) {
    const atk = document.createElement('span');
    atk.className = 'atk';
    atk.textContent = '攻撃';
    el.append(atk);
  }

  if (zone === 'hand' && game.phase === 'keep') {
    el.classList.add('selectable');
    el.addEventListener('click', () => bottomFromHand(iid));
  } else if (zone === 'hand' && game.toDiscard > 0) {
    el.classList.add('selectable');
    el.addEventListener('click', () => discardFromHand(iid));
  } else if (zone === 'hand') {
    el.addEventListener('dblclick', () => moveByUser(iid, 'battlefield'));
    // スマホ：タップでカードの拡大とメニュー（「戦場へ」など）
    el.addEventListener('click', (e) => { if (phone()) openCardMenu(iid, e.clientX, e.clientY); });
  } else if (zone === 'battlefield') {
    if (canAttack(c)) el.classList.add('can-attack');
    el.addEventListener('click', () => onBattlefieldClick(iid));
  } else {
    el.addEventListener('click', (e) => openCardMenu(iid, e.clientX, e.clientY));
  }
  el.addEventListener('mouseenter', () => showPreview(c));
  onContextMenu(el, (e) => openCardMenu(iid, e.clientX, e.clientY));
  el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(iid)));
  return el;
}

function showPreview(c) {
  $('preview').hidden = !c.image;
  $('preview-text').hidden = !!c.image;
  if (c.image) $('preview').src = c.image;
  else $('preview-text').textContent = c.name;
}

// ---------- 相手の表示（ネット対戦） ----------

function oppCardEl(c) {
  const el = document.createElement('div');
  el.className = 'card' + (c.tapped ? ' tapped' : '') + (c.token ? ' token' : '') + (c.attacking ? ' attacking' : '');
  el.title = c.name;
  if (c.image) {
    const img = document.createElement('img');
    img.src = c.image;
    img.alt = c.name;
    el.append(img);
  } else {
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = c.name;
    el.append(text);
  }
  if (c.counters) {
    const badge = document.createElement('span');
    badge.className = 'counter';
    badge.textContent = c.counters;
    el.append(badge);
  }
  if (c.attacking) {
    const atk = document.createElement('span');
    atk.className = 'atk';
    atk.textContent = '攻撃';
    el.append(atk);
  }
  el.addEventListener('mouseenter', () => showPreview(c));
  // スマホ：タップで拡大表示
  el.addEventListener('click', () => { if (phone()) showMenu([], 0, 0, c); });
  return el;
}

const phaseName = (id) => PHASES.find(([p]) => p === id)?.[1] ?? PHASE_NAMES[id] ?? '';

function renderOpp() {
  const on = online();
  document.body.classList.toggle('online', on);
  for (const id of ['opp-area', 'opp-player', 'chat-form']) $(id).hidden = !on;
  if (!on) return;
  const st = opp?.state;
  $('opp-player-name').textContent = oppName();
  $('my-player-name').textContent = myName();
  $('opp-life').textContent = st ? st.life : '–';
  // ライブラリー・手札は枚数、墓地・追放はカードの配列で届く
  const count = (z) => (Array.isArray(st[z]) ? st[z].length : st[z]);
  for (const z of ['library', 'hand', 'graveyard', 'exile']) $(`opp-${z}-count`).textContent = st ? count(z) : '–';
  const bf = st?.battlefield ?? [];
  $('opp-main').replaceChildren(...bf.filter((c) => !c.isLand).map(oppCardEl));
  $('opp-lands').replaceChildren(...bf.filter((c) => c.isLand).map(oppCardEl));
  let label;
  if (!opp?.connected) label = st ? `${oppName()}（切断中）` : '相手の参加を待っています';
  else if (!st) label = `${oppName()}：デッキを選んでいます`;
  else if (!st.turn) label = `${oppName()}：${phaseName(st.phase) || '準備中'}`;
  else label = `${oppName()}：ターン${st.turn}${st.waiting ? '（待機中）' : `・${phaseName(st.phase)}`}`;
  $('opp-status').textContent = label;
  $('opp-area').classList.toggle('active-turn', !!st && st.turn > 0 && !st.waiting);
  // 部屋を作って相手を待っている間は、部屋コードを大きく出す
  const waitingGuest = Net.role === 'host' && !opp?.connected;
  $('room-banner').hidden = !waitingGuest;
  if (waitingGuest) $('room-code-big').textContent = Net.code;
}

// 自分の公開情報（手札の中身・ライブラリーの順番は含めない）
function snapshot() {
  if (!game) return null;
  const pub = (iid) => {
    const c = game.cards[iid];
    return { name: c.name, image: c.image, tapped: !!c.tapped, counters: c.counters || 0, attacking: !!c.attacking, isLand: !!c.isLand, token: !!c.token };
  };
  return {
    deckName: game.deckName,
    life: game.life,
    turn: game.turn,
    phase: game.phase,
    waiting: !!game.waiting,
    hand: game.zones.hand.length,
    library: game.zones.library.length,
    battlefield: game.zones.battlefield.map(pub),
    graveyard: game.zones.graveyard.map(pub),
    exile: game.zones.exile.map(pub),
    log: game.log.slice(-150),
  };
}

let syncTimer = null;
function scheduleSync() {
  if (!Net.connected()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => Net.send({ type: 'state', state: snapshot() }), 60);
}

function sendHello() {
  Net.send({
    type: 'hello',
    name: myName(),
    // 先手・後手は部屋を作った側が決める（ゲーム開始前なら null）
    hostOnDraw: Net.role === 'host' && game ? !!game.onDraw : null,
  });
}

function systemMessage(text) {
  chat.push({ ts: Date.now(), who: 'system', text });
  saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
}

function setupNet() {
  Net.on('status', ({ text, state }) => {
    $('net-status').textContent = text;
    $('net-status').dataset.state = state;
  });
  Net.on('open', () => {
    opp = { ...opp, connected: true };
    sendHello();
    if (game) {
      Net.send({ type: 'state', state: snapshot() });
      // 切断中に渡せなかったターンを渡し直す
      if (game.waiting && game.turn > 0 && !game.passSent) game.passSent = Net.send({ type: 'pass' });
    }
    if (game) render(); else renderOpp();
  });
  Net.on('close', () => {
    opp = { ...opp, connected: false };
    systemMessage(`${oppName()}との接続が切れました`);
    if (game) render(); else renderOpp();
  });
  Net.on('hello', (msg) => {
    const first = !opp?.name;
    opp = { ...opp, name: String(msg.name || '相手').slice(0, 16), connected: true };
    if (first) systemMessage(`${oppName()}が参加しました`);
    if (Net.role === 'guest' && msg.hostOnDraw !== null && msg.hostOnDraw !== undefined) {
      pendingHostOnDraw = !!msg.hostOnDraw;
      if (game && !game.orderFixed) {
        netUpdate(() => {
          game.onDraw = !pendingHostOnDraw;
          game.orderFixed = true;
          log(`先手・後手が決まりました：あなたは${game.onDraw ? '後手' : '先手'}`);
          tryFirstTurn();
        });
        return;
      }
    }
    if (game) render(); else renderOpp();
  });
  Net.on('state', (msg) => {
    opp = { ...opp, state: msg.state, connected: true };
    renderOpp();
    renderLog();
    if (viewer?.opp) renderViewer();
  });
  Net.on('pass', () => {
    if (game) receivePass();
  });
  Net.on('chat', (msg) => {
    chat.push({ ts: Date.now(), who: 'opp', name: oppName(), text: String(msg.text).slice(0, 300) });
    saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
    renderLog();
  });
}

// 部屋コードを共有（共有できなければコピー）
async function shareRoomCode() {
  const code = Net.code;
  const text = `Magic: The Gathering System の部屋コード：${code}`;
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(code);
    $('room-share').textContent = 'コピーしました';
  } catch {
    $('room-share').textContent = '長押しでコピー';
  }
  setTimeout(() => ($('room-share').textContent = '共有・コピー'), 1500);
}

function sendChat(e) {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  chat.push({ ts: Date.now(), who: 'me', name: myName(), text });
  saveJson(sessionStorage, CHAT_KEY, chat.slice(-200));
  Net.send({ type: 'chat', text });
  $('chat-input').value = '';
  renderLog();
}

// ---------- メニュー ----------

function showMenu(items, x, y, card = null) {
  const menu = $('menu');
  // モーダルダイアログ表示中は最前面レイヤーに入れないと隠れる
  (viewer ? $('viewer') : document.body).append(menu);
  // スマホ：画面下のシートにして、カードの拡大画像と「閉じる」を付ける
  if (phone()) items = [...items, ...(items.length ? ['-'] : []), ['閉じる', () => {}]];
  menu.replaceChildren(...items.map((item) => {
    if (item === '-') return document.createElement('hr');
    const [label, fn] = item;
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      hideMenu();
      fn();
    });
    return b;
  }));
  if (phone() && card) {
    let pv;
    if (card.image) {
      pv = document.createElement('img');
      pv.src = card.image;
      pv.alt = card.name;
    } else {
      pv = document.createElement('div');
      pv.classList.add('text');
      pv.textContent = card.name;
    }
    pv.classList.add('menu-preview');
    menu.prepend(pv);
  }
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
}

function hideMenu() {
  $('menu').hidden = true;
}

function openCardMenu(iid, x, y) {
  const c = game.cards[iid];
  const zone = zoneOf(iid);
  const items = [];
  if (zone === 'battlefield') {
    if (canAttack(c)) {
      items.push(c.attacking
        ? ['攻撃を取り消す', () => toggleAttack(iid)]
        : ['攻撃する', () => toggleAttack(iid)],
      ...(c.attacking ? [] : [['攻撃する（タップしない・警戒）', () => toggleAttack(iid, { vigilance: true })]]));
    }
    items.push(
      [c.tapped ? 'アンタップ' : 'タップ', () => toggleTap(iid)],
      ['カウンター +1', () => act(() => { c.counters++; log(`${c.name}にカウンター（${c.counters}）`); })],
      ['カウンター −1', () => act(() => { c.counters--; log(`${c.name}のカウンター（${c.counters}）`); })],
      ['このカードのトークン・コピーを出す', () => act(() => createToken(c.name, c.image))],
      '-',
    );
  }
  const moves = [['hand', '手札へ'], ['battlefield', '戦場へ'], ['graveyard', '墓地へ'], ['exile', '追放へ']];
  for (const [to, label] of moves) {
    if (to !== zone) items.push([label, () => moveByUser(iid, to)]);
  }
  items.push(
    ['ライブラリーの一番上へ', () => act(() => moveCard(iid, 'library'))],
    ['ライブラリーの一番下へ', () => act(() => moveCard(iid, 'library', { bottom: true }))],
  );
  showMenu(items, x, y, c);
}

function openLibraryMenu(x, y) {
  showMenu([
    ['1枚引く', drawOne],
    ['X枚引く…', () => {
      const n = askNumber('何枚引きますか？');
      if (n) act(() => drawCards(n));
    }],
    ['シャッフル', shuffleLibrary],
    '-',
    ['上からX枚を見る…', lookTop],
    ['ライブラリーを探す', searchLibrary],
    '-',
    ['上からX枚を墓地へ…', () => millTo('graveyard')],
    ['上からX枚を追放…', () => millTo('exile')],
  ], x, y);
}

function drawOne() {
  act(() => drawCards(1));
}

function shuffleLibrary() {
  act(() => {
    shuffle(game.zones.library);
    log('ライブラリーをシャッフル');
  });
}

function millTo(zone) {
  const n = askNumber(`上から何枚を${ZONES[zone]}に置きますか？`);
  if (!n) return;
  act(() => {
    const ids = game.zones.library.slice(0, n);
    for (const iid of ids) moveCard(iid, zone, { silent: true });
    log(`ライブラリーの上から${ids.length}枚を${ZONES[zone]}へ：${ids.map((i) => game.cards[i]?.name).join('、')}`);
  });
}

function lookTop() {
  const n = askNumber('上から何枚見ますか？', '3');
  if (!n) return;
  act(() => log(`ライブラリーの上から${Math.min(n, game.zones.library.length)}枚を見た`));
  openViewer('library', `ライブラリーの上から${n}枚（左が一番上）`, game.zones.library.slice(0, n));
}

function searchLibrary() {
  act(() => log('ライブラリーを探した'));
  openViewer('library', 'ライブラリー（左が一番上）', null);
}

// ---------- 一覧ダイアログ ----------

function openViewer(zone, title, ids) {
  viewer = { zone, title, ids };
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}

function renderViewer() {
  if (viewer.opp) {
    const cards = [...(opp?.state?.[viewer.opp] ?? [])].reverse();
    $('viewer-title').textContent = `${viewer.title}（${cards.length}枚）`;
    $('viewer-shuffle').hidden = true;
    $('viewer-hint').hidden = true;
    $('viewer-cards').replaceChildren(...cards.map(oppCardEl));
    return;
  }
  $('viewer-hint').hidden = false;
  const { zone, title, ids } = viewer;
  const shown = game.zones[zone].filter((iid) => !ids || ids.includes(iid));
  // 墓地・追放は新しいものから表示する
  if (zone !== 'library') shown.reverse();
  $('viewer-title').textContent = `${title}（${shown.length}枚）`;
  $('viewer-shuffle').hidden = zone !== 'library';
  $('viewer-cards').replaceChildren(...shown.map((iid) => cardEl(iid, `${zone}-viewer`)));
}

function openOppViewer(zone) {
  if (!opp?.state) return;
  viewer = { opp: zone, title: `${oppName()}の${ZONES[zone]}` };
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}

function closeViewer() {
  viewer = null;
  hideMenu();
  document.body.append($('menu'));
  $('viewer').close();
}

// ---------- 開始画面 ----------

function openSetup() {
  const select = $('setup-deck');
  select.replaceChildren(...decks.map((d) => {
    const n = Object.values(d.cards).reduce((sum, e) => sum + e.qty, 0);
    return new Option(`${d.name}（${n}枚）`, d.id);
  }));
  const requested = Number(new URLSearchParams(location.search).get('deck'));
  select.value = String(requested || game?.deckId || decks[0]?.id || '');
  $('setup-error').textContent = decks.length ? '' : 'デッキがありません。デッキ作成画面で作ってください。';
  $('player-name').value = myName();
  const mode = netInfo?.role === 'host' ? 'host' : netInfo?.role === 'guest' ? 'join' : 'solo';
  $('setup-form').elements.mode.value = mode;
  $('room-code').value = netInfo?.role === 'guest' ? netInfo.code : '';
  updateSetupMode();
  $('setup').showModal();
}

function updateSetupMode() {
  const mode = $('setup-form').elements.mode.value;
  $('room-code').disabled = mode !== 'join';
  for (const r of $('setup-form').elements.order) r.disabled = mode === 'join';
  $('order-note').hidden = mode !== 'join';
}

function startFromSetup(e) {
  e.preventDefault();
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  const total = deck ? Object.values(deck.cards).reduce((sum, x) => sum + x.qty, 0) : 0;
  if (total < 7) {
    $('setup-error').textContent = 'デッキに7枚以上のカードが必要です。';
    return;
  }
  const form = new FormData($('setup-form'));
  const mode = form.get('mode');
  const name = String(form.get('name') ?? '').trim().slice(0, 16);
  try {
    if (name) {
      sessionStorage.setItem(NAME_KEY, name);
      localStorage.setItem(NAME_KEY, name);
    }
  } catch {}
  const code = String(form.get('room') ?? '').trim().toUpperCase();
  if (mode === 'join' && !/^[A-Z0-9]{4,12}$/.test(code)) {
    $('setup-error').textContent = '部屋コードを入力してください。';
    return;
  }

  // 接続の開始・切り替え（同じ部屋のままなら接続を保つ）
  if (mode === 'solo') {
    Net.stop();
    netInfo = null;
    opp = null;
  } else if (mode === 'host' && !(Net.role === 'host')) {
    Net.stop();
    opp = null;
    chat = [];
    netInfo = { role: 'host', code: Net.host() };
    systemMessage(`部屋 ${netInfo.code} を作りました。この部屋コードを相手に伝えてください`);
  } else if (mode === 'join' && !(Net.role === 'guest' && Net.code === code)) {
    Net.stop();
    opp = null;
    chat = [];
    pendingHostOnDraw = null;
    netInfo = { role: 'guest', code: Net.join(code) };
  }
  saveJson(sessionStorage, NET_KEY, netInfo);
  if (mode === 'solo') saveJson(sessionStorage, CHAT_KEY, null);

  // 先手・後手：ランダムなら、ここで決める（ネット対戦では部屋を作った側の結果が相手にも伝わる）
  const order = form.get('order');
  const random = order === 'random';
  const onDraw = random ? Math.random() < 0.5 : order === 'draw';
  $('setup').close();
  newGame(deck, onDraw, random && mode !== 'join');
}

// ---------- 初期化 ----------

function setupDropZones() {
  for (const el of document.querySelectorAll('[data-zone]')) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const iid = Number(e.dataTransfer.getData('text/plain'));
      if (!game?.cards[iid] || zoneOf(iid) === el.dataset.zone) return;
      moveByUser(iid, el.dataset.zone);
    });
  }
}

function init() {
  $('next-phase').addEventListener('click', nextPhase);
  $('end-turn').addEventListener('click', endTurn);
  $('undo').addEventListener('click', undo);
  $('restart').addEventListener('click', openSetup);

  for (const b of document.querySelectorAll('[data-life]')) {
    b.addEventListener('click', () => act(() => {
      game.life += Number(b.dataset.life);
      log(`ライフ ${game.life}`);
    }));
  }
  $('life').addEventListener('click', () => {
    const v = Number.parseInt(prompt('ライフ', game.life) ?? '', 10);
    if (Number.isFinite(v)) act(() => { game.life = v; log(`ライフ ${v}`); });
  });

  $('pile-library').addEventListener('click', drawOne);
  onContextMenu($('pile-library'), (e) => openLibraryMenu(e.clientX, e.clientY));
  // スマホ：コマンドのボタンを押したらシートを閉じる
  $('tools').addEventListener('click', (e) => {
    if (phone() && e.target.closest('button')) window.setPhoneSheet?.('');
  });
  // スマホ：ログを開いたら新着の印を消す
  window.addEventListener('phonesheet', () => {
    hideMenu();
    renderLog();
  });
  $('pile-graveyard').addEventListener('click', () => openViewer('graveyard', '墓地', null));
  $('pile-exile').addEventListener('click', () => openViewer('exile', '追放', null));

  $('draw').addEventListener('click', drawOne);
  $('shuffle').addEventListener('click', shuffleLibrary);
  $('look-top').addEventListener('click', lookTop);
  $('search-library').addEventListener('click', searchLibrary);
  $('mill').addEventListener('click', () => millTo('graveyard'));
  $('untap-all').addEventListener('click', () => act(() => { untapAll(); log('すべてアンタップ'); }));
  $('token').addEventListener('click', () => {
    const name = prompt('トークン名（例: 1/1 兵士）');
    if (name?.trim()) act(() => createToken(name.trim()));
  });

  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer-shuffle').addEventListener('click', () => {
    shuffleLibrary();
    closeViewer();
  });
  $('viewer').addEventListener('cancel', (e) => {
    e.preventDefault();
    closeViewer();
  });

  $('setup-form').addEventListener('submit', startFromSetup);
  for (const r of $('setup-form').elements.mode) r.addEventListener('change', updateSetupMode);
  $('chat-form').addEventListener('submit', sendChat);
  $('room-share').addEventListener('click', shareRoomCode);
  $('phase-current').addEventListener('click', openPhaseMenu);
  $('opp-pile-graveyard').addEventListener('click', () => openOppViewer('graveyard'));
  $('opp-pile-exile').addEventListener('click', () => openOppViewer('exile'));

  document.addEventListener('click', (e) => {
    // 長押しで開いた直後（指を離したときの click）では閉じない
    if (!$('menu').contains(e.target) && !e.target.closest('[data-longpress]')) hideMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hideMenu();
    if (document.querySelector('dialog[open]') || e.target.matches('input, select, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === ' ') {
      e.preventDefault();
      nextPhase();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      endTurn();
    } else if (e.key === 'd' || e.key === 'D') {
      drawOne();
    }
  });

  setupDropZones();
  setupNet();

  // 再読み込みしたら同じ部屋に戻る
  if (netInfo?.role === 'host') Net.host(netInfo.code);
  else if (netInfo?.role === 'guest') Net.join(netInfo.code);

  const requested = Number(new URLSearchParams(location.search).get('deck'));
  if (game && (!requested || requested === game.deckId)) render();
  else {
    game = null;
    renderOpp();
    renderLog();
    openSetup();
  }
}

init();
