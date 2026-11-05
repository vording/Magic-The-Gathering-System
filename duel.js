// Magic: The Gathering System — ルール対戦の画面（engine.js のゲームを表示・操作する）
// ゲームの状態はすべて engine の G にあり、この画面は G を描き、クリックを Engine.perform の行動に変えるだけ。
// 何もできないステップは自動でパスする（MTGO の「ストップ」と同じ考え方）。
// ・CPU／練習相手：自分は players[0]、相手は players[1]。相手の判断は ai.js
// ・ネット対戦：部屋を作った側（host）がエンジンを動かす。入った側（guest）は players[1] で、
//   行動を host に送り、host から隠すべき情報を除いた状態（Engine.view）を受け取って描く

const STORAGE_KEY = 'mtg-deckmaker-v1';
const DUEL_KEY = 'mtg-deckmaker-duel';
const NAME_KEY = 'mtg-deckmaker-name';
const AVATAR_KEY = 'mtg-deckmaker-avatar';
const CPU_DECK_KEY = 'mtg-deckmaker-cpu-deck';
const STOPS_KEY = 'mtg-deckmaker-duel-stops';
let ME = 0;
let OPP = 1;
const PHASE_ICON = { attackers: 'attack', blockers: 'block', firststrike: 'damage' };
const STEP_HINTS = {
  untap: 'アンタップ・ステップ。', upkeep: 'アップキープ・ステップ。', draw: 'ドロー・ステップ。',
  main1: '第1メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。「パス」で戦闘へ。',
  begincombat: '戦闘開始ステップ。', attackers: '攻撃クリーチャー指定ステップ。', blockers: 'ブロック・クリーチャー指定ステップ。',
  firststrike: '先制攻撃の戦闘ダメージ・ステップ。', damage: '戦闘ダメージ・ステップ。', endcombat: '戦闘終了ステップ。',
  main2: '第2メイン・フェイズ。「パス」でターンを終えます。', end: '終了ステップ。', cleanup: 'クリーンアップ・ステップ。',
};

const $ = (id) => document.getElementById(id);
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; } })();
const decks = saved.decks ?? [];
const useJa = saved.ja ?? true;
const phone = () => window.isPhone?.() ?? false;

// 保存しているもの { G, mode: 'cpu' | 'goldfish' | 'host' | 'guest', deckId, cpuDeckId, avatars: [players[0], players[1]],
//   code: 部屋コード, guest: 入った側の { name, deck, avatar }（host のみ） }
let duel = load();
let G = duel?.G ?? null;
const online = () => duel?.mode === 'host' || duel?.mode === 'guest';
const isGuest = () => duel?.mode === 'guest';
let awaiting = false; // guest：host の返事を待っている

// 画面だけの状態（保存しない）
const ui = {
  attackers: new Set(),
  blocks: {}, // 自分のブロック { blocker: attacker }
  blockSel: null,
  picks: new Set(), // 手札から選ぶ（ボトム・捨てる）
  targeting: null, // { kind: 'cast' | 'activate', id, index, specs, i, targets, x, srcColors }
  autoTurn: null, // 「ターン終了まで」：このターンが終わるまで自動でパス
  stopsAll: (() => { try { return localStorage.getItem(STOPS_KEY) === 'on'; } catch { return false; } })(),
};
let timer = null;
let shownResult = null;

function load() {
  try { return JSON.parse(sessionStorage.getItem(DUEL_KEY)); } catch { return null; }
}
function save() {
  if (!duel) return;
  duel.G = G;
  try { sessionStorage.setItem(DUEL_KEY, JSON.stringify(duel)); } catch {}
}

const myName = () => {
  try { return sessionStorage.getItem(NAME_KEY) || localStorage.getItem(NAME_KEY) || 'あなた'; } catch { return 'あなた'; }
};
const myAvatar = () => { try { return localStorage.getItem(AVATAR_KEY) || '1'; } catch { return '1'; } };
const avatarImage = (a) => `url("img/avatar/${a}.jpg")`;

// デッキのカード → エンジンに渡す形（表示名・絵・日本語の効果テキストは view に）
function deckFor(deck) {
  return Object.values(deck.cards).map(({ card, qty }) => {
    const ja = useJa ? card.ja : null;
    return {
      card,
      qty,
      view: {
        name: ja?.name ?? (useJa ? card.displayName : card.name) ?? card.name,
        image: card.pick?.image ?? ja?.image ?? card.image ?? null,
        text: (useJa && card.ja?.text) || card.oracleText || '',
      },
    };
  });
}

// ---------- 行動 ----------

function act(p, action) {
  if (!G) return;
  if (isGuest()) {
    // 入った側：行動は部屋を作った側で処理する
    if (awaiting) return;
    awaiting = true;
    Net.send({ type: 'duelAction', action });
    ui.attackers.clear();
    ui.blocks = {};
    ui.blockSel = null;
    ui.picks.clear();
    render();
    return;
  }
  const r = Engine.perform(G, p, action);
  if (!r.ok) {
    if (p === ME) toast(r.error);
    else console.warn('CPU:', r.error, action);
  }
  if (p === ME) {
    ui.attackers.clear();
    ui.blocks = {};
    ui.blockSel = null;
    ui.picks.clear();
  }
  const sounds = playSfx();
  save();
  sendState(sounds, p === OPP && !r.ok ? r.error : null);
  tick();
}

// 部屋を作った側：入った側に今の状態を送る（入った側の手札以外の隠れた情報は除く）
function sendState(sounds = [], error = null) {
  if (duel?.mode !== 'host' || !G) return;
  Net.send({ type: 'duelState', G: Engine.view(G, 1), sfx: sounds, error, avatars: duel.avatars, deckName: duel.guest?.deckName });
}

function playSfx(list = null) {
  const sounds = list ?? G.sfx.splice(0);
  for (const s of sounds) {
    if (s.startsWith('land:')) Sound.play(Sound.landName(s.slice(5).split('')));
    else Sound.play(s);
  }
  return sounds;
}

// 次に誰が何をするかを見て、CPU を動かす・自動でパスする
function tick() {
  clearTimeout(timer);
  render();
  if (!G || G.winner != null) return;
  const n = Engine.needs(G);
  if (!n) return;
  if (n.player !== ME) {
    if (online()) return; // 相手の操作を待つ
    const delay = n.type === 'priority' && !G.stack.length ? 220 : 650;
    timer = setTimeout(() => act(n.player, opponentDecide(n)), delay);
    return;
  }
  if (n.type === 'priority' && !ui.targeting && !awaiting && !shouldStop()) {
    timer = setTimeout(() => act(ME, { type: 'pass' }), 160);
  }
}

// 相手の判断：CPU は ai.js、練習相手は何もしない（選択は ai.js の既定のまま）
function opponentDecide(n) {
  if (duel.mode === 'goldfish') {
    if (n.type === 'priority') return { type: 'pass' };
    if (n.type === 'attackers') return { type: 'attackers', ids: [] };
    if (n.type === 'blockers') return { type: 'blockers', blocks: {} };
    if (n.type === 'mulligan') return { type: 'keep' };
  }
  return AI.decide(G, n.player);
}

// 自分に優先権があるとき、止まって待つか（false なら自動でパス）
function shouldStop() {
  const playable = (opts) => Engine.hasPlayable(G, ME, opts);
  const top = G.stack.at(-1);
  if (ui.autoTurn != null) {
    if (G.turn !== ui.autoTurn) ui.autoTurn = null;
    else if (!(top && top.controller !== ME)) return false;
    else ui.autoTurn = null; // 相手が何かした
  }
  if (ui.stopsAll) return true;
  if (top) return top.controller !== ME && playable({ instantOnly: true });
  const mine = G.active === ME;
  if (mine && ['main1', 'main2'].includes(G.step)) return true;
  if (mine && G.step === 'blockers' && G.combat) return playable({ instantOnly: true });
  if (!mine && ['attackers', 'blockers', 'end'].includes(G.step)) return playable({ instantOnly: true });
  return false;
}

// ---------- 唱える・起動する（対象を選んでから行動にする） ----------

function onHandClick(id) {
  if (!G) return;
  const n = Engine.needs(G);
  if (n?.player === ME && ['bottom', 'discard'].includes(n.type)) return togglePick(id, n.pending.n);
  if (n?.type !== 'priority' || n.player !== ME) return toast('今は唱えられません');
  const o = G.objects[id];
  if (o.def.types.includes('land')) return act(ME, { type: 'playLand', id });
  startCast(id);
}

function startCast(id, { flashback = false, mode = null } = {}) {
  let info = Engine.castInfo(G, ME, id, { flashback, mode });
  if (!info.ok) return toast(info.reason);
  const o = G.objects[id];
  // モードを選ぶ呪文
  if (info.needMode) {
    const labels = modeLabels(o);
    return showMenu(o.def.modes.map((_, i) => [`${labels[i] ?? `モード${i + 1}`}${info.okModes[i] ? '' : '（唱えられません）'}`,
      () => (info.okModes[i] ? startCast(id, { flashback, mode: i }) : toast('このモードでは唱えられません'))]), lastPoint.x, lastPoint.y, o);
  }
  // キッカー
  let kicked = false;
  if (info.canKick && confirm(`キッカー（${info.kicker}）を支払いますか？`)) {
    kicked = true;
    info = Engine.castInfo(G, ME, id, { flashback, mode, kicked });
  }
  // 追加のコスト：生け贄に捧げるもの・捨てるカード
  const extra = {};
  const ac = info.addCost;
  if (ac?.sacType && !ui.costPick) {
    const opts = G.battlefield.filter((b) => G.objects[b].controller === ME && (G.objects[b].def.types.includes(ac.sacType) || G.objects[b].def.subtypes.some((t) => t.toLowerCase() === ac.sacType)));
    if (opts.length > 1) {
      return showMenu(opts.map((b) => [`生け贄：${G.objects[b].card.name}`, () => { ui.costPick = { sacrifice: b }; startCast(id, { flashback, mode }); }]), lastPoint.x, lastPoint.y, o);
    }
  }
  if (ac?.discard && !ui.costPick) {
    const opts = G.players[ME].hand.filter((h) => h !== id);
    if (opts.length > 1) {
      return showMenu(opts.map((h) => [`捨てる：${G.objects[h].card.name}`, () => { ui.costPick = { discard: h }; startCast(id, { flashback, mode }); }]), lastPoint.x, lastPoint.y, o);
    }
  }
  Object.assign(extra, ui.costPick ?? {});
  ui.costPick = null;
  let x = 0;
  if (info.x) {
    const v = prompt(`X の値（最大 ${info.maxX}）`, String(info.maxX));
    if (v === null) return;
    x = Math.max(0, Math.min(info.maxX, Number.parseInt(v, 10) || 0));
  }
  beginTargeting({ kind: 'cast', id, specs: info.specs, x, flashback, mode, kicked, ...extra, srcColors: G.objects[id].def.colors });
}

// モードの説明（日本語の効果テキストの「•」の行。なければ英語）
function modeLabels(o) {
  const ja = (o.card.text ?? '').split('\n').filter((l) => l.trim().startsWith('•')).map((l) => l.replace(/^\s*•\s*/, ''));
  return ja.length === o.def.modes.length ? ja : o.def.modes.map((m, i) => `モード${i + 1}`);
}

function startActivate(id, index) {
  const a = Engine.activations(G, ME, id).find((x) => x.index === index);
  if (!a?.ok) return toast(a?.reason ?? 'できません');
  const ab = Engine.abilitiesOf(G, id)[index];
  if (a.mana) {
    const m = ab.mana;
    if (m.choices?.length > 1) {
      return showMenu(m.choices.map((c) => [`{${c}} を出す`, () => act(ME, { type: 'activate', id, index, color: c })]), lastPoint.x, lastPoint.y);
    }
    return act(ME, { type: 'activate', id, index });
  }
  let x = 0;
  if (a.x) {
    const v = prompt(`X の値（最大 ${a.maxX}）`, String(a.maxX));
    if (v === null) return;
    x = Math.max(0, Math.min(a.maxX, Number.parseInt(v, 10) || 0));
  }
  const extra = {};
  if (ab.cost.discard) {
    const pick = G.players[ME].hand.find((h) => h !== id);
    extra.discard = pick;
  }
  beginTargeting({ kind: 'activate', id, index, specs: a.specs, x, srcColors: G.objects[id].def.colors, ...extra });
}

function beginTargeting(t) {
  ui.targeting = { ...t, i: -1, targets: [] };
  nextTarget();
}

// 割り振るダメージの合計
function divideTotal(t) {
  const o = G.objects[t.id];
  const fx = (o.def.modes?.length ? o.def.modes[t.mode ?? 0] : o.def.spell).find((f) => f.target?.divided);
  return fx?.n === 'X' ? t.x : fx?.n ?? 0;
}

function nextTarget() {
  const t = ui.targeting;
  for (t.i++; t.i < t.specs.length; t.i++) {
    if (!t.specs[t.i]) { t.targets[t.i] = null; continue; }
    const cands = Engine.targetsFor(G, ME, t.specs[t.i], t.kind === 'activate' ? t.id : null, t.srcColors);
    if (!cands.length) { t.targets[t.i] = null; continue; }
    t.cands = cands;
    render();
    return;
  }
  ui.targeting = null;
  if (t.kind === 'cast') act(ME, { type: 'cast', id: t.id, targets: t.targets, x: t.x, flashback: t.flashback, mode: t.mode, kicked: t.kicked, sacrifice: t.sacrifice, discard: t.discard });
  else act(ME, { type: 'activate', id: t.id, index: t.index, targets: t.targets, x: t.x, discard: t.discard });
}

function pickTarget(target) {
  if (ui.targeting) {
    const t = ui.targeting;
    const spec = t.specs[t.i];
    Sound.play('button');
    // 複数の対象：選び終わったら「完了」（最大の数で自動で次へ）
    if (spec?.multi) {
      const list = t.targets[t.i]?.multi ?? [];
      if (list.some((x) => sameT(x, target))) return toast('同じ対象は1回だけ選べます');
      t.targets[t.i] = { multi: [...list, target] };
      const max = spec.multi.max === 'X' ? t.x : spec.multi.max;
      if (list.length + 1 >= max) return nextTarget();
      return render();
    }
    // 割り振るダメージ：対象ごとに点数を決める
    if (spec?.divided) {
      const total = divideTotal(t);
      const parts = t.targets[t.i]?.divide ?? [];
      const rest = total - parts.reduce((a, x) => a + x.n, 0);
      if (parts.some((x) => sameT(x, target))) return toast('同じ対象は1回だけ選べます');
      const v = parts.length + 1 >= spec.divided.max ? rest : Number.parseInt(prompt(`この対象に与えるダメージ（残り ${rest}）`, String(rest)) ?? '', 10);
      if (!Number.isFinite(v) || v < 1) return;
      const n = Math.min(v, rest);
      t.targets[t.i] = { divide: [...parts, { ...target, n }] };
      if (rest - n > 0) return render();
      return nextTarget();
    }
    t.targets[t.i] = target;
    return nextTarget();
  }
  const n = Engine.needs(G);
  if (n?.type === 'triggerTarget' && n.player === ME) {
    // 複数の対象を取る誘発：選び終わったら「完了」
    if (n.pending.spec.multi) {
      ui.trigMulti = [...(ui.trigMulti ?? []), target];
      const max = n.pending.spec.multi.max === 'X' ? 99 : n.pending.spec.multi.max;
      if (ui.trigMulti.length >= max) { const list = ui.trigMulti; ui.trigMulti = null; return act(ME, { type: 'target', target: { multi: list } }); }
      return render();
    }
    act(ME, { type: 'target', target });
  }
}

const sameT = (a, b) => a.player === b.player && a.obj === b.obj && a.stack === b.stack && a.grave === b.grave;

// 今選べる対象（呪文・能力の対象選び、または誘発型能力の対象）
function currentCands() {
  if (ui.targeting) return ui.targeting.cands ?? [];
  const n = Engine.needs(G);
  if (n?.type === 'triggerTarget' && n.player === ME) return Engine.targetsFor(G, ME, n.pending.spec, n.pending.source, G.triggers[0]?.colors ?? []);
  return [];
}
const isCand = (t) => currentCands().some((c) => sameT(c, t));

function cancelTargeting() {
  if (!ui.targeting) return;
  ui.targeting = null;
  Sound.play('cancel');
  tick();
}

// ---------- 戦場のクリック ----------

function onPermanentClick(id, e) {
  const n = Engine.needs(G);
  if (isCand({ obj: id })) return pickTarget({ obj: id });
  if (n?.player === ME && n.type === 'sacrifice' && n.pending.options.includes(id)) return togglePick(id, n.pending.n);
  const o = G.objects[id];
  if (n?.player === ME && n.type === 'attackers' && o.controller === ME) {
    if (!Engine.canAttack(G, id)) return toast(Engine.isSick(G, id) ? `${o.card.name}は召喚酔いです` : `${o.card.name}は攻撃できません`);
    if (ui.attackers.has(id)) ui.attackers.delete(id); else ui.attackers.add(id);
    Sound.play(ui.attackers.has(id) ? 'attack' : 'cancel');
    return render();
  }
  if (n?.player === ME && n.type === 'blockers') {
    if (o.controller === ME) {
      if (ui.blocks[id] != null) { delete ui.blocks[id]; ui.blockSel = null; return render(); }
      if (o.tapped) return toast('タップしているクリーチャーはブロックできません');
      ui.blockSel = ui.blockSel === id ? null : id;
      return render();
    }
    if (o.attacking && ui.blockSel != null) {
      if (!Engine.canBlock(G, ui.blockSel, id)) return toast(`${G.objects[ui.blockSel].card.name}は${o.card.name}をブロックできません`);
      ui.blocks[ui.blockSel] = id;
      ui.blockSel = null;
      Sound.play('button');
      return render();
    }
    return;
  }
  if (o.controller !== ME) return phone() ? showDetail(id) : null;
  const acts = Engine.activations(G, ME, id).filter((a) => !a.cycling);
  const usable = acts.filter((a) => a.ok);
  if (!acts.length) return phone() ? showDetail(id) : null;
  if (usable.length === 1 && !phone()) return startActivate(id, usable[0].index);
  openCardMenu(id, e.clientX, e.clientY);
}

function openCardMenu(id, x, y) {
  const o = G.objects[id];
  const items = [];
  if (o.zone === 'hand' && o.owner === ME) {
    if (o.def.types.includes('land')) items.push(['土地をプレイする', () => act(ME, { type: 'playLand', id })]);
    else items.push(['唱える', () => startCast(id)]);
  }
  if (o.zone === 'graveyard' && o.owner === ME && o.def.flashback) items.push([`フラッシュバック（${o.def.flashback}）`, () => { closeViewer(); startCast(id, { flashback: true }); }]);
  for (const a of Engine.activations(G, ME, id)) {
    const label = a.cycling ? `サイクリング（${o.def.cycling}）` : a.mana ? `マナを出す：${abilityText(a.text)}` : `起動：${abilityText(a.text)}`;
    items.push([a.ok ? label : `${label}（${a.reason}）`, a.ok ? () => startActivate(id, a.index) : () => toast(a.reason)]);
  }
  items.push(['詳しく見る', () => showDetail(id)]);
  showMenu(items, x, y, o);
}

const abilityText = (t) => t.replace(/\bthis\b/g, '〜');

function showDetail(id) {
  const o = G.objects[id];
  if (!o || o.hidden) return;
  showCardDetail({ name: o.card.name, image: o.card.image, text: detailText(id) });
}

function detailText(id) {
  const o = G.objects[id];
  const lines = [o.def.typeLine, o.card.text];
  if (o.zone === 'battlefield' && o.def.power != null) {
    const c = Engine.ch(G, id);
    lines.push(`${c.p}/${c.t}${o.damage ? `（ダメージ ${o.damage}）` : ''}`);
    const extra = [...c.kw].filter((k) => !o.def.keywords.includes(k));
    if (extra.length) lines.push(`得ている能力：${extra.join('、')}`);
  }
  if (o.def.manual.length) lines.push(`※自動で処理できない効果：${o.def.manual.join(' / ')}`);
  return lines.filter(Boolean).join('\n');
}

// ---------- 描画 ----------

function render() {
  renderWaiting();
  if (!G) return;
  const n = Engine.needs(G);
  const me = G.players[ME];
  const opp = G.players[OPP];
  $('deck-name').textContent = duel.deckName ?? '';
  $('turn-label').textContent = G.turn ? `ターン ${G.turn}（${G.active === ME ? 'あなた' : opp.name}）` : '初手';
  $('land-count').textContent = G.turn && G.active === ME ? `土地 ${me.landsPlayed}/1` : '';
  $('phase-hint').textContent = hintText(n);
  $('phases').replaceChildren(...Engine.STEPS.map((s) => {
    const b = document.createElement('button');
    b.textContent = Engine.STEP_NAMES[s];
    b.dataset.phase = PHASE_ICON[s] ?? s;
    b.className = s === G.step && G.turn ? 'current' : '';
    b.disabled = true;
    return b;
  }));
  $('phase-current').textContent = G.turn ? `${Engine.STEP_NAMES[G.step]}` : 'マリガン';
  $('phase-current').dataset.phase = PHASE_ICON[G.step] ?? G.step;
  const myPriority = n?.player === ME && n.type === 'priority' && !ui.targeting;
  $('next-phase').disabled = !myPriority;
  $('next-phase').textContent = passLabel();
  $('end-turn').disabled = !myPriority;
  $('stops-toggle').textContent = `すべてのステップで止まる：${ui.stopsAll ? 'オン' : 'オフ'}`;

  // プレイヤー
  $('my-player-name').textContent = me.name;
  $('opp-player-name').textContent = opp.name;
  $('my-avatar').style.backgroundImage = avatarImage(duel.avatars?.[0] ?? '1');
  $('opp-avatar').style.backgroundImage = avatarImage(duel.avatars?.[1] ?? '2');
  $('life').textContent = me.life;
  $('opp-life').textContent = opp.life;
  $('library-count').textContent = me.library.length;
  $('opp-library-count').textContent = opp.library.length;
  $('opp-hand-count').textContent = opp.hand.length;
  for (const [pl, pre] of [[me, ''], [opp, 'opp-']]) {
    for (const z of ['graveyard', 'exile']) {
      $(`${pre}${z}-count`).textContent = pl[z].length;
      const top = G.objects[pl[z].at(-1)];
      $(`${pre}pile-${z}`).style.backgroundImage = top?.card.image ? `url("${top.card.image}")` : '';
    }
  }
  $('my-pool').replaceChildren(...poolEls(me.pool));
  $('opp-pool').replaceChildren(...poolEls(opp.pool));
  $('opp-status').textContent = oppStatus(n);
  $('opp-area').classList.toggle('active-turn', G.active === OPP && G.turn > 0);

  // 戦場・手札
  const row = (p, lands) => G.battlefield.filter((id) => G.objects[id].controller === p && G.objects[id].def.types.includes('land') === lands);
  $('bf-main').replaceChildren(...row(ME, false).map((id) => cardEl(id)));
  $('bf-lands').replaceChildren(...row(ME, true).map((id) => cardEl(id)));
  $('opp-main').replaceChildren(...row(OPP, false).map((id) => cardEl(id)));
  $('opp-lands').replaceChildren(...row(OPP, true).map((id) => cardEl(id)));
  $('hand').replaceChildren(...me.hand.map((id) => cardEl(id, 'hand')));
  $('hand-count').textContent = `(${me.hand.length})`;
  renderStack();
  renderBanner(n);
  renderLog();
  renderViewer();
  showResultIfNew();
}

const poolEls = (pool) => Object.entries(pool).filter(([, k]) => k > 0).map(([c, k]) => Object.assign(document.createElement('span'), { className: `mana mana-${c}`, textContent: k > 1 ? `${c}×${k}` : c }));

function passLabel() {
  if (!G?.turn) return 'パス';
  if (G.stack.length) return '解決する（パス）';
  if (G.active === ME && G.step === 'main1') return '戦闘へ（パス）';
  if (G.active === ME && G.step === 'main2') return 'ターン終了（パス）';
  return 'パス';
}

function hintText(n) {
  if (G.winner != null) return G.winner === ME ? '勝利しました。' : '敗北しました。';
  if (ui.targeting) return '対象を選んでください（Esc で取り消し）。';
  if (!n) return '';
  if (n.player !== ME) return online() ? `${G.players[OPP].name}の操作を待っています…` : `${G.players[OPP].name}が考えています…`;
  switch (n.type) {
    case 'mulligan': return '初手を確認して、キープかマリガンを選んでください。';
    case 'bottom': return `ライブラリーの一番下に置くカードを手札から${n.pending.n}枚選んでください。`;
    case 'attackers': return '攻撃するクリーチャーをクリックして「攻撃を確定」を押してください。';
    case 'blockers': return 'ブロック：自分のクリーチャー → 相手の攻撃クリーチャーの順にクリックしてください。';
    case 'triggerTarget': return `${n.pending.name}の誘発型能力の対象を選んでください。`;
    case 'discard': return `捨てるカードを手札から${n.pending.n}枚選んでください（${n.pending.reason}）。`;
    case 'search': return 'ライブラリーから探すカードを選んでください。';
    case 'chooseWord': return `${n.pending.reason}：${n.pending.what === 'color' ? '色' : 'クリーチャー・タイプ'}を選んでください。`;
    case 'sacrifice': return `生け贄に捧げるものを${n.pending.n}つ選んでください（${n.pending.reason}）。`;
    case 'chooseHand': return `${n.pending.reason}：捨てさせるカードを選んでください。`;
    case 'scry': return '占術：ライブラリーの一番下に置くカードを選んで「決定」（選ばなかったものは上に残る）。';
    case 'lookPick': return '手札に加えるカードを1枚選んでください。';
    case 'reorder': return 'ライブラリーの一番上から並べる順にカードを選んで「決定」。';
    case 'payOrNot': return `${n.pending.reason}：${n.pending.cost}を支払いますか？`;
    default: {
      const top = G.stack.at(-1);
      if (top && top.controller !== ME) return `${top.name}がスタックにあります。対応するならインスタントや能力を使い、しないなら「パス」。`;
      return STEP_HINTS[G.step] ?? '';
    }
  }
}

function oppStatus(n) {
  const opp = G.players[OPP];
  if (!G.turn) return `${opp.name}：マリガン`;
  const think = n && n.player === OPP ? (online() ? '（操作中）' : '（考え中）') : '';
  return `${opp.name}：${G.active === OPP ? `ターン${G.turn}・${Engine.STEP_NAMES[G.step]}` : '待機中'}${think}`;
}

function cardEl(id, zone = 'battlefield') {
  const o = G.objects[id];
  const el = document.createElement('div');
  el.className = 'card';
  if (o.tapped) el.classList.add('tapped');
  if (o.token) el.classList.add('token');
  const face = () => {
    if (o.card.image) {
      const img = document.createElement('img');
      img.src = o.card.image;
      img.alt = o.card.name;
      el.append(img);
    } else {
      el.append(Object.assign(document.createElement('div'), { className: 'text', textContent: o.card.name }));
    }
  };
  if (o.hidden) { el.classList.add('back'); return el; }
  face();
  el.title = detailText(id);
  const badge = (cls, text) => el.append(Object.assign(document.createElement('span'), { className: cls, textContent: text }));
  if (zone === 'battlefield') {
    const c = Engine.ch(G, id);
    if (o.counters.p1) badge('counter', `+${o.counters.p1}`);
    if (o.def.power != null && o.def.types.includes('creature')) {
      const mod = c.p !== Number.parseInt(o.def.power, 10) || c.t !== Number.parseInt(o.def.toughness, 10);
      badge(`pt${o.damage ? ' damaged' : ''}${mod ? ' modified' : ''}`, o.damage ? `${c.p}/${c.t}(-${o.damage})` : `${c.p}/${c.t}`);
    }
    const blockingNow = o.blocking != null ? o.blocking : ui.blocks[id];
    const attackingNow = o.attacking || ui.attackers.has(id);
    if (attackingNow) {
      const blockers = Object.entries({ ...(G.combat?.blocks ?? {}), ...ui.blocks }).filter(([, a]) => a === id).length;
      badge('atk', blockers ? `攻撃（ブロック×${blockers}）` : '攻撃');
      el.classList.add('attacking');
    } else if (blockingNow != null) badge('atk blk', 'ブロック');
    if (o.attachedTo != null) badge('attached', `→ ${G.objects[o.attachedTo]?.card.name ?? ''}`);
    if (o.regen) badge('regen', `再生×${o.regen}`);
    if (G.active === o.controller && Engine.isSick(G, id)) el.classList.add('sick');
    if (o.def.manual.length) el.classList.add('manual');
    const n = Engine.needs(G);
    if (n?.player === ME && n.type === 'attackers' && o.controller === ME && Engine.canAttack(G, id)) el.classList.add('can-attack');
    if (ui.blockSel === id) el.classList.add('block-select');
    if (ui.blockSel != null && o.attacking && Engine.canBlock(G, ui.blockSel, id)) el.classList.add('block-target');
    if (isCand({ obj: id })) el.classList.add('targetable');
    if (n?.player === ME && n.type === 'sacrifice' && n.pending.options.includes(id)) el.classList.add(ui.picks.has(id) ? 'picked' : 'selectable');
    el.addEventListener('click', (e) => onPermanentClick(id, e));
  } else if (zone === 'hand') {
    const n = Engine.needs(G);
    if (ui.picks.has(id)) el.classList.add('picked');
    if (n?.player === ME && ['bottom', 'discard'].includes(n.type)) el.classList.add('selectable');
    else if (n?.player === ME && n.type === 'priority' && canUse(id)) el.classList.add('can-attack');
    if (o.def.manual.length) el.classList.add('manual');
    el.addEventListener('click', () => (phone() && n?.type === 'priority' ? openCardMenu(id, 0, 0) : onHandClick(id)));
  } else {
    if (isCand({ grave: id })) el.classList.add('targetable');
    if (viewerState?.multi && ui.picks.has(id)) {
      el.classList.add('picked');
      badge('counter', String([...ui.picks].indexOf(id) + 1));
    }
    el.addEventListener('click', (e) => {
      if (isCand({ grave: id })) { closeViewer(); return pickTarget({ grave: id }); }
      if (viewerState?.choose) return chooseFromViewer(id);
      if (viewerState?.multi) { if (ui.picks.has(id)) ui.picks.delete(id); else ui.picks.add(id); Sound.play('button'); return render(); }
      if (o.owner === ME && o.def.flashback) openCardMenu(id, e.clientX, e.clientY);
      else if (phone()) showDetail(id);
    });
  }
  el.addEventListener('mouseenter', () => showPreview(o));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!phone()) openCardMenu(id, e.clientX, e.clientY);
  });
  onLongPress(el, () => showCardDetail({ name: o.card.name, image: o.card.image, text: detailText(id) }, [['操作メニュー', () => openCardMenu(id, 0, 0)]]));
  return el;
}

// 手札のカードを今使えるか（光らせる）
function canUse(id) {
  const o = G.objects[id];
  if (o.def.types.includes('land')) return Engine.sorceryTiming(G, ME) && G.players[ME].landsPlayed < 1;
  if (Engine.castInfo(G, ME, id).ok) return true;
  return Engine.activations(G, ME, id).some((a) => a.ok);
}

function renderStack() {
  $('stack').hidden = !G.stack.length;
  $('stack-items').replaceChildren(...[...G.stack].reverse().map((s, i) => {
    const el = document.createElement('div');
    el.className = `stack-item ${s.controller === ME ? 'mine' : 'theirs'}${i === 0 ? ' top' : ''}`;
    const src = G.objects[s.objId ?? s.source];
    if (src?.card.image) {
      const img = document.createElement('img');
      img.src = src.card.image;
      img.alt = s.name;
      el.append(img);
    }
    const label = document.createElement('div');
    label.className = 'stack-text';
    const what = s.kind === 'spell' ? '' : s.kind === 'trigger' ? '（誘発）' : '（能力）';
    const targets = s.targets.filter(Boolean).map((t) => (t.player != null ? G.players[t.player].name : t.obj != null ? G.objects[t.obj]?.card.name : t.stack != null ? G.stack.find((x) => x.sid === t.stack)?.name : G.objects[t.grave]?.card.name));
    label.textContent = `${s.name}${what}${targets.length ? ` → ${targets.join('、')}` : ''}`;
    el.append(label);
    el.title = s.text ?? src?.card.text ?? '';
    if (isCand({ stack: s.sid })) {
      el.classList.add('targetable');
      el.addEventListener('click', () => pickTarget({ stack: s.sid }));
    }
    if (src) el.addEventListener('mouseenter', () => showPreview(src));
    return el;
  }));
}

function renderBanner(n) {
  const bar = $('mulligan-bar');
  bar.classList.remove('big');
  const span = (text, cls = '') => Object.assign(document.createElement('span'), { textContent: text, className: cls });
  const button = (text, fn, primary = false, disabled = false) => {
    const b = Object.assign(document.createElement('button'), { textContent: text, className: primary ? 'primary' : '', disabled });
    b.addEventListener('click', fn);
    return b;
  };
  const show = (...els) => { bar.hidden = false; bar.replaceChildren(...els); };
  bar.hidden = true;
  if (G.winner != null) return;
  // 対象の選択
  const cands = currentCands();
  if (ui.targeting || (n?.player === ME && n.type === 'triggerTarget')) {
    const name = ui.targeting ? G.objects[ui.targeting.id].card.name : n.pending.name;
    const spec = ui.targeting?.specs[ui.targeting.i];
    if (spec?.multi) {
      const list = ui.targeting.targets[ui.targeting.i]?.multi ?? [];
      const max = spec.multi.max === 'X' ? ui.targeting.x : spec.multi.max;
      const min = spec.multi.min === 'X' ? ui.targeting.x : spec.multi.min;
      const players = cands.filter((c) => c.player != null).map((c) => button(c.player === ME ? 'あなた（自分）' : `${G.players[c.player].name}（相手）`, () => pickTarget(c), c.player === OPP));
      return show(span(`「${name}」の対象を選んでください（${list.length}/${max}）`), span('光っているカードをクリック', 'block-hint'), ...players,
        button('完了', () => { if (list.length < Math.min(min, cands.length)) return toast('対象が足りません'); if (!list.length) ui.targeting.targets[ui.targeting.i] = { multi: [] }; nextTarget(); }, true),
        button('キャンセル', cancelTargeting));
    }
    if (spec?.divided) {
      const parts = ui.targeting.targets[ui.targeting.i]?.divide ?? [];
      const rest = divideTotal(ui.targeting) - parts.reduce((a, x) => a + x.n, 0);
      const players = cands.filter((c) => c.player != null).map((c) => button(c.player === ME ? 'あなた（自分）' : `${G.players[c.player].name}（相手）`, () => pickTarget(c), c.player === OPP));
      return show(span(`「${name}」：ダメージを割り振ってください（残り${rest}点）`), span('光っているカードをクリック', 'block-hint'), ...players, button('キャンセル', cancelTargeting));
    }
    const players = cands.filter((c) => c.player != null).map((c) => button(c.player === ME ? 'あなた（自分）' : `${G.players[c.player].name}（相手）`, () => pickTarget(c), c.player === OPP));
    const extra = ui.targeting ? [button('キャンセル', cancelTargeting)] : G.triggers[0]?.optional ? [button('選ばない', () => act(ME, { type: 'skip' }))] : [];
    if (!ui.targeting && n.pending.spec.multi) extra.unshift(button(`完了（${ui.trigMulti?.length ?? 0}）`, () => { const list = ui.trigMulti ?? []; ui.trigMulti = null; act(ME, { type: 'target', target: { multi: list } }); }, true));
    const graves = cands.filter((c) => c.grave != null);
    if (graves.length) openViewer({ title: '墓地から対象を選ぶ', ids: graves.map((c) => c.grave), hint: 'カードをクリックして選ぶ' });
    return show(span(`「${name}」の対象を選んでください`), ...(cands.some((c) => c.obj != null || c.stack != null) ? [span('光っているカードをクリック', 'block-hint')] : []), ...players, ...extra);
  }
  if (!n || n.player !== ME) return;
  const p = n.pending;
  switch (n.type) {
    case 'mulligan': {
      bar.classList.add('big');
      const k = G.players[ME].mulligans;
      const choices = Object.assign(document.createElement('div'), { className: 'choices' });
      choices.append(button('マリガン', () => act(ME, { type: 'mulligan' }), false, k >= 6), button('キープ', () => act(ME, { type: 'keep' }), true));
      return show(Object.assign(document.createElement('div'), { className: 'title', textContent: k ? `マリガン${k}回目の手札` : '初手' }),
        Object.assign(document.createElement('div'), { className: 'note', textContent: k ? `キープすると、手札から${k}枚をライブラリーの一番下に置きます` : 'この7枚で始めるならキープ、引き直すならマリガン' }), choices);
    }
    case 'bottom':
      return show(span(`ライブラリーの一番下に置くカードを選択（${ui.picks.size}/${p.n}）`), button('決定', () => act(ME, { type: 'bottom', ids: [...ui.picks] }), true, ui.picks.size !== p.n));
    case 'discard':
      return show(span(`${p.reason}：捨てるカードを選択（${ui.picks.size}/${p.n}）`), button('捨てる', () => act(ME, { type: 'choose', ids: [...ui.picks] }), true, ui.picks.size !== p.n));
    case 'attackers':
      return show(span(ui.attackers.size ? `攻撃：${ui.attackers.size}体` : '攻撃するクリーチャーをクリック'),
        button('攻撃しない', () => act(ME, { type: 'attackers', ids: [] })),
        button('全員で攻撃', () => { for (const id of G.battlefield) if (Engine.canAttack(G, id) && G.objects[id].controller === ME) ui.attackers.add(id); render(); }),
        button('攻撃を確定', () => act(ME, { type: 'attackers', ids: [...ui.attackers] }), true, !ui.attackers.size));
    case 'blockers':
      return show(span(ui.blockSel != null ? `${G.objects[ui.blockSel].card.name}でブロックする攻撃クリーチャーをクリック` : 'ブロック：自分のクリーチャー → 相手の攻撃クリーチャー', 'block-hint'),
        button('ブロックしない', () => act(ME, { type: 'blockers', blocks: {} })),
        button(`ブロックを確定（${Object.keys(ui.blocks).length}体）`, () => act(ME, { type: 'blockers', blocks: ui.blocks }), true));
    case 'payOrNot':
      return show(span(`${p.reason}`), button(`${p.cost}を支払う`, () => act(ME, { type: 'pay', yes: true }), true, !p.canPay), button('支払わない', () => act(ME, { type: 'pay', yes: false })));
    case 'copy':
      openViewer({ title: `${p.reason}：コピーするクリーチャー`, ids: p.options, hint: 'クリックで選ぶ', choose: true });
      return show(span(`${p.reason}：コピーするクリーチャーを選んでください`), button('一覧を開く', () => openViewer({ title: `${p.reason}：コピーするクリーチャー`, ids: p.options, hint: 'クリックで選ぶ', choose: true })), button('コピーしない', () => { closeViewer(); act(ME, { type: 'choose', ids: [] }); }));
    case 'putFromHand':
      return show(span(`${p.reason}：戦場に出すカードを手札から選んでください`), ...p.options.map((h) => button(G.objects[h].card.name, () => act(ME, { type: 'choose', ids: [h] }))), button('出さない', () => act(ME, { type: 'choose', ids: [] })));
    case 'sacUnlessOther': {
      const what = p.how === 'discard' ? '捨てる' : p.how === 'return' ? '手札に戻す' : '生け贄に捧げる';
      openViewer({ title: `${p.reason}：${what}ものを${p.n}つ`, ids: p.options, hint: 'クリックで選ぶ（もう一度で取り消し）', multi: true });
      return show(span(`${p.reason}：${what}ものを選ぶ（${ui.picks.size}/${p.n}）。選ばなければ${p.reason}を生け贄に捧げます`),
        button('決定', () => { closeViewer(); act(ME, { type: 'choose', ids: [...ui.picks] }); }, true, ui.picks.size !== p.n),
        button(`${p.reason}を生け贄に捧げる`, () => { closeViewer(); act(ME, { type: 'choose', ids: [] }); }));
    }
    case 'chooseWord': {
      const COLOR_JA = { white: '白', blue: '青', black: '黒', red: '赤', green: '緑' };
      if (p.what === 'color') return show(span(`${p.reason}：色を選んでください`), ...p.options.map((c) => button(COLOR_JA[c], () => act(ME, { type: 'word', value: c }))));
      const sel = Object.assign(document.createElement('select'), { id: 'word-select' });
      sel.append(...p.options.map((t) => new Option(t, t)));
      return show(span(`${p.reason}：クリーチャー・タイプを選んでください`), sel, button('決定', () => act(ME, { type: 'word', value: sel.value }), true));
    }
    case 'sacrifice':
      return show(span(`${p.reason}：生け贄に捧げるものをクリック（${ui.picks.size}/${p.n}）`), button('決定', () => act(ME, { type: 'choose', ids: [...ui.picks] }), true, ui.picks.size !== p.n));
    case 'chooseHand':
      openViewer({ title: `${G.players[p.from].name}の手札`, ids: p.options, hint: '捨てさせるカードをクリック', choose: true });
      return show(span(`${p.reason}：捨てさせるカードを選んでください`), button('一覧を開く', () => openViewer({ title: `${G.players[p.from].name}の手札`, ids: p.options, hint: '捨てさせるカードをクリック', choose: true })));
    case 'lookPick':
      openViewer({ title: 'ライブラリーの上のカード', ids: p.options, hint: '手札に加えるカードをクリック', choose: true });
      return show(span('手札に加えるカードを選んでください'), button('一覧を開く', () => openViewer({ title: 'ライブラリーの上のカード', ids: p.options, hint: '手札に加えるカードをクリック', choose: true })));
    case 'scry':
    case 'reorder': {
      const title = n.type === 'scry' ? '占術' : '並べ替え';
      const hint = n.type === 'scry' ? '一番下に置くカードをクリック（もう一度で取り消し）' : '一番上に置く順にクリック';
      openViewer({ title, ids: p.options, hint, multi: true });
      return show(span(`${title}：${ui.picks.size}枚選択`), button('一覧を開く', () => openViewer({ title, ids: p.options, hint, multi: true })), button('決定', () => { closeViewer(); act(ME, { type: 'choose', ids: [...ui.picks] }); }, true));
    }
    case 'search':
      openViewer({ title: 'ライブラリーから選ぶ', ids: p.options, hint: 'カードをクリックして選ぶ', choose: true });
      return show(span('ライブラリーから探すカードを選んでください'), button('一覧を開く', () => openViewer({ title: 'ライブラリーから選ぶ', ids: p.options, hint: 'カードをクリックして選ぶ', choose: true })));
    default:
      return;
  }
}

function togglePick(id, n) {
  if (ui.picks.has(id)) ui.picks.delete(id);
  else if (ui.picks.size < n) ui.picks.add(id);
  Sound.play('button');
  render();
}

function renderLog() {
  const el = $('log');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.replaceChildren(...G.log.slice(-300).map((e) => {
    const li = document.createElement('li');
    li.className = e.p === ME ? 'me' : e.p === OPP ? 'opp' : 'system';
    const t = Object.assign(document.createElement('span'), { className: 't', textContent: e.turn ? `T${e.turn}` : '—' });
    li.append(t);
    if (e.p === OPP) li.append(Object.assign(document.createElement('span'), { className: 'who', textContent: `${G.players[OPP].name}：` }));
    li.append(e.text);
    return li;
  }));
  if (atBottom || true) el.scrollTop = el.scrollHeight;
}

function showPreview(o) {
  $('preview').hidden = !o.card.image;
  $('preview-text').hidden = !!o.card.image;
  if (o.card.image) $('preview').src = o.card.image;
  else $('preview-text').textContent = `${o.card.name}\n${o.def.typeLine}\n${o.card.text}`;
}

// ---------- 一覧（墓地・追放・選ぶ） ----------

let viewerState = null;
function openViewer(state) {
  viewerState = state;
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}
function renderViewer() {
  if (!viewerState || !G) return;
  const ids = viewerState.zone ? G.players[viewerState.player][viewerState.zone] : viewerState.ids;
  $('viewer-title').textContent = `${viewerState.title}（${ids.length}枚）`;
  $('viewer-hint').textContent = viewerState.hint ?? '';
  // 墓地・追放は新しいものから。ライブラリーの上のカードは上から順に
  const list = viewerState.zone ? [...ids].reverse() : ids;
  $('viewer-cards').replaceChildren(...list.map((id) => cardEl(id, 'viewer')));
}
function closeViewer() {
  viewerState = null;
  hideMenu();
  document.body.append($('menu'));
  if ($('viewer').open) $('viewer').close();
}
function chooseFromViewer(id) {
  closeViewer();
  act(ME, { type: 'choose', ids: [id] });
}

// ---------- メニュー・お知らせ ----------

let lastPoint = { x: 0, y: 0 };
document.addEventListener('pointerdown', (e) => { lastPoint = { x: e.clientX, y: e.clientY }; }, true);

function showMenu(items, x, y, o = null) {
  const menu = $('menu');
  ($('viewer').open ? $('viewer') : document.body).append(menu);
  if (phone()) items = [...items, '-', ['閉じる', () => {}]];
  menu.replaceChildren(...items.map((item) => {
    if (item === '-') return document.createElement('hr');
    const [label, fn] = item;
    const b = Object.assign(document.createElement('button'), { textContent: label });
    b.addEventListener('click', () => { hideMenu(); fn(); });
    return b;
  }));
  if (phone() && o?.card.image) {
    const pv = Object.assign(document.createElement('img'), { src: o.card.image, alt: o.card.name, className: 'menu-preview' });
    menu.prepend(pv);
  }
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 8))}px`;
}
function hideMenu() { $('menu').hidden = true; }

function toast(text) {
  let el = $('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  Sound.play('cancel');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

function showResultIfNew() {
  const key = G.winner == null ? null : `${G.winner}`;
  if (key === shownResult) return;
  shownResult = key;
  if (key == null) return;
  const win = G.winner === ME;
  const loser = G.players[win ? OPP : ME];
  const reason = { life: 'ライフが0になりました', deck: 'ライブラリーが空の状態でカードを引こうとしました', concede: '投了しました' }[loser.lost] ?? '';
  Sound.play(win ? 'win' : 'lose');
  $('result-title').textContent = win ? '勝利' : '敗北';
  $('result-text').textContent = win ? `${loser.name}：${reason}` : reason;
  $('result').dataset.win = String(win);
  if (!$('result').open) $('result').showModal();
}

// ---------- 開始 ----------

function openSetup() {
  const options = () => decks.map((d) => new Option(`${d.name}（${Object.values(d.cards).reduce((s, e) => s + e.qty, 0)}枚）`, d.id));
  $('setup-deck').replaceChildren(...options());
  $('setup-cpu-deck').replaceChildren(...options());
  const requested = Number(new URLSearchParams(location.search).get('deck'));
  $('setup-deck').value = String(requested || duel?.deckId || decks[0]?.id || '');
  let cpuDeck = null;
  try { cpuDeck = JSON.parse(localStorage.getItem(CPU_DECK_KEY)); } catch {}
  $('setup-cpu-deck').value = String(decks.some((d) => d.id === cpuDeck) ? cpuDeck : $('setup-deck').value);
  $('player-name').value = myName();
  $('setup-error').textContent = decks.length ? '' : 'デッキがありません。デッキ作成画面で作ってください。';
  if (duel?.mode) $('setup-form').elements.mode.value = duel.mode === 'guest' ? 'join' : duel.mode;
  $('room-code').value = duel?.mode === 'guest' ? duel.code : '';
  updateMode();
  updateSupport();
  $('setup').showModal();
}

// 選んだデッキのカードが、どこまで自動で処理できるか
function updateSupport() {
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  const box = $('setup-support');
  box.replaceChildren();
  if (!deck) return;
  const rows = Object.values(deck.cards).map(({ card, qty }) => {
    const def = CardText.compile(card);
    if (Engine.unsupported(def).length && def.support === 'full') def.support = 'partial';
    return { card, qty, def };
  });
  const count = (s) => rows.filter((r) => r.def.support === s).reduce((n, r) => n + r.qty, 0);
  const total = rows.reduce((n, r) => n + r.qty, 0);
  const head = Object.assign(document.createElement('div'), {
    textContent: `自動で処理できるカード：${count('full')}/${total}枚（一部だけ ${count('partial')}枚・できない ${count('none')}枚）`,
  });
  box.append(head);
  const bad = rows.filter((r) => r.def.support !== 'full');
  if (bad.length) {
    const list = document.createElement('ul');
    for (const r of bad) {
      const li = document.createElement('li');
      const name = useJa ? r.card.ja?.name ?? r.card.displayName ?? r.card.name : r.card.name;
      li.textContent = `${name}：${r.def.manual.join(' / ')}`;
      list.append(li);
    }
    box.append(list);
  }
}

function updateMode() {
  const mode = $('setup-form').elements.mode.value;
  $('cpu-deck-field').hidden = mode !== 'cpu';
  $('room-code').disabled = mode !== 'join';
  for (const r of $('setup-form').elements.order) r.disabled = mode === 'join';
}

function startFromSetup(e) {
  e.preventDefault();
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  const mode = $('setup-form').elements.mode.value;
  if (mode === 'host' || mode === 'join') return startOnline(mode, deck);
  const cpuDeck = mode === 'cpu' ? decks.find((d) => d.id === Number($('setup-cpu-deck').value)) : deck;
  const size = (d) => (d ? Object.values(d.cards).reduce((s, x) => s + x.qty, 0) : 0);
  if (size(deck) < 7 || size(cpuDeck) < 7) { $('setup-error').textContent = 'デッキに7枚以上のカードが必要です。'; return; }
  const name = $('player-name').value.trim().slice(0, 16) || myName();
  try { localStorage.setItem(NAME_KEY, name); localStorage.setItem(CPU_DECK_KEY, JSON.stringify(cpuDeck.id)); } catch {}
  const order = $('setup-form').elements.order.value;
  const first = order === 'play' ? ME : order === 'draw' ? OPP : Math.random() < 0.5 ? ME : OPP;
  const life = deck.format === 'commander' ? 40 : 20;
  if (Net.active) Net.stop();
  ME = 0;
  OPP = 1;
  G = Engine.create({
    players: [{ name, deck: deckFor(deck) }, { name: mode === 'cpu' ? 'CPU' : '練習相手', deck: deckFor(cpuDeck) }],
    first, life,
  });
  duel = { G, mode, deckId: deck.id, cpuDeckId: cpuDeck.id, deckName: deck.name, avatars: [myAvatar(), String(1 + Math.floor(Math.random() * 18))] };
  ui.autoTurn = null;
  ui.targeting = null;
  shownResult = null;
  $('setup').close();
  save();
  tick();
}

function init() {
  $('next-phase').addEventListener('click', () => act(ME, { type: 'pass' }));
  $('end-turn').addEventListener('click', () => { ui.autoTurn = G.turn; act(ME, { type: 'pass' }); });
  $('restart').addEventListener('click', openSetup);
  $('concede').addEventListener('click', () => { if (G && G.winner == null && confirm('投了しますか？')) act(ME, { type: 'concede' }); });
  $('stops-toggle').addEventListener('click', () => {
    ui.stopsAll = !ui.stopsAll;
    try { localStorage.setItem(STOPS_KEY, ui.stopsAll ? 'on' : 'off'); } catch {}
    tick();
  });
  $('pile-graveyard').addEventListener('click', () => openViewer({ title: '墓地', player: ME, zone: 'graveyard', hint: 'フラッシュバックを持つカードはクリックで唱えられます' }));
  $('pile-exile').addEventListener('click', () => openViewer({ title: '追放', player: ME, zone: 'exile' }));
  $('opp-pile-graveyard').addEventListener('click', () => openViewer({ title: `${G.players[OPP].name}の墓地`, player: OPP, zone: 'graveyard' }));
  $('opp-pile-exile').addEventListener('click', () => openViewer({ title: `${G.players[OPP].name}の追放`, player: OPP, zone: 'exile' }));
  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer').addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
  $('setup-form').addEventListener('submit', startFromSetup);
  $('setup-deck').addEventListener('change', updateSupport);
  for (const r of $('setup-form').elements.mode) r.addEventListener('change', updateMode);
  $('setup').addEventListener('cancel', (e) => { if (!G && !online()) e.preventDefault(); });
  $('setup').addEventListener('close', () => { if (!G && !online()) $('setup').showModal(); });
  $('room-share').addEventListener('click', shareRoom);
  setupNet();
  $('result-close').addEventListener('click', () => $('result').close());
  $('result-again').addEventListener('click', () => { $('result').close(); openSetup(); });
  document.addEventListener('click', (e) => { if (!$('menu').contains(e.target) && !e.target.closest('[data-longpress]')) hideMenu(); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancelTargeting(); hideMenu(); return; }
    if (document.querySelector('dialog[open]') || e.target.matches('input, select, textarea')) return;
    const n = G && Engine.needs(G);
    if (n?.player !== ME || n.type !== 'priority' || ui.targeting) return;
    if (e.key === ' ') { e.preventDefault(); act(ME, { type: 'pass' }); }
    else if (e.key === 'Enter') { e.preventDefault(); ui.autoTurn = G.turn; act(ME, { type: 'pass' }); }
  });
  window.addEventListener('phonesheet', () => { hideMenu(); if (G) renderLog(); });
  const requested = Number(new URLSearchParams(location.search).get('deck'));
  if (online() && duel.code) {
    // 再読み込み：同じ部屋に戻る
    if (isGuest()) { ME = 1; OPP = 0; Net.join(duel.code); } else Net.host(duel.code);
    tick();
  } else if (G && (!requested || requested === duel.deckId)) tick();
  else { G = null; duel = null; openSetup(); }
}

// ---------- ネット対戦 ----------

function startOnline(mode, deck) {
  const size = deck ? Object.values(deck.cards).reduce((s, x) => s + x.qty, 0) : 0;
  if (size < 7) { $('setup-error').textContent = 'デッキに7枚以上のカードが必要です。'; return; }
  const name = $('player-name').value.trim().slice(0, 16) || myName();
  try { localStorage.setItem(NAME_KEY, name); } catch {}
  const order = $('setup-form').elements.order.value;
  if (mode === 'join') {
    const code = $('room-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) { $('setup-error').textContent = '部屋コードを入力してください。'; return; }
    const same = isGuest() && duel.code === code && Net.active;
    duel = { mode: 'guest', code, deckId: deck.id, deckName: deck.name, name, avatar: myAvatar() };
    ME = 1; OPP = 0;
    G = null;
    $('setup').close();
    save();
    if (same) sendJoin(); else Net.join(code);
    render();
    return;
  }
  // 部屋を作る：同じ部屋のままなら、入った側のデッキで新しいゲームを始める
  const keep = duel?.mode === 'host' && Net.active && duel.guest;
  duel = { mode: 'host', code: keep ? duel.code : null, deckId: deck.id, deckName: deck.name, name, order, avatars: [myAvatar(), keep?.avatar ?? '2'], guest: keep ? duel.guest : null };
  ME = 0; OPP = 1;
  G = null;
  $('setup').close();
  if (!duel.code) duel.code = Net.host();
  if (duel.guest) createOnlineGame();
  save();
  render();
}

function createOnlineGame() {
  const deck = decks.find((d) => d.id === duel.deckId);
  const g = duel.guest;
  const first = duel.order === 'play' ? 0 : duel.order === 'draw' ? 1 : Math.random() < 0.5 ? 0 : 1;
  G = Engine.create({ players: [{ name: duel.name, deck: deckFor(deck) }, { name: g.name, deck: g.deck }], first, life: deck.format === 'commander' ? 40 : 20 });
  duel.avatars = [myAvatar(), g.avatar ?? '2'];
  shownResult = null;
  save();
  sendState(playSfx());
  tick();
}

function sendJoin() {
  const deck = decks.find((d) => d.id === duel.deckId);
  if (!deck) return;
  Net.send({ type: 'duelJoin', name: duel.name, avatar: duel.avatar, deckName: deck.name, deck: deckFor(deck), restart: G?.winner != null || !G });
}

function setupNet() {
  Net.on('status', ({ text, state }) => {
    $('net-status').textContent = text;
    $('net-status').dataset.state = state;
    if (duel?.mode === 'host') render();
  });
  Net.on('open', () => {
    if (isGuest()) sendJoin();
    else if (duel?.mode === 'host') sendState();
    render();
  });
  Net.on('close', () => render());
  // 部屋を作った側：入った側が来た（デッキを受け取る）。ゲームがなければ始める
  Net.on('duelJoin', (msg) => {
    if (duel?.mode !== 'host') return;
    const card = (x) => ({ card: x.card, qty: Math.max(0, Math.min(99, Number(x.qty) || 0)), view: x.view });
    duel.guest = { name: String(msg.name || '相手').slice(0, 16), avatar: String(msg.avatar ?? '2'), deckName: String(msg.deckName ?? ''), deck: (msg.deck ?? []).map(card) };
    save();
    if (!G || (G.winner != null && msg.restart)) createOnlineGame();
    else sendState();
  });
  Net.on('duelAction', (msg) => {
    if (duel?.mode !== 'host' || !G) return;
    act(1, msg.action ?? {});
  });
  // 入った側：状態を受け取って描く
  Net.on('duelState', (msg) => {
    if (!isGuest()) return;
    awaiting = false;
    G = msg.G;
    duel.avatars = msg.avatars ?? duel.avatars;
    if (msg.error) toast(msg.error);
    playSfx(msg.sfx ?? []);
    save();
    tick();
  });
}

// 部屋を作って相手を待っている間：部屋コードを大きく出す
function renderWaiting() {
  const waiting = online() && !G;
  $('room-banner').hidden = !waiting;
  if (!waiting) return;
  $('room-code-big').textContent = duel.code ?? '';
  $('room-note').textContent = isGuest() ? '部屋を作った人の開始を待っています' : 'このコードを相手に伝えてください';
}

async function shareRoom() {
  const text = `Magic: The Gathering System のルール対戦の部屋コード：${duel.code}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(duel.code); toast('コピーしました'); } catch { toast(duel.code); }
}

init();
