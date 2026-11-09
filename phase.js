// ルール対戦（phase.rs のルールエンジン）
// エンジン：vendor/phase/（phase.rs を WASM にしたもの。MIT / Apache-2.0。作り方は tools/phase/build.sh）
// 画面は duel.html と同じ配置・見た目。ゲームの状態・できる行動・CPU の手はすべてエンジンに聞く
import init, * as E from './vendor/phase/engine_wasm.js';

const VERSION = 1;
const STORAGE_KEY = 'mtg-deckmaker-v1';
const CPU_DECK_KEY = 'mtg-deckmaker-phase-cpu-deck';
const STOPS_KEY = 'mtg-deckmaker-stops';
const AVATAR_KEY = 'mtg-deckmaker-avatar';
const NAME_KEY = 'mtg-deckmaker-name';
const ME = 0;
const OPP = 1;

const $ = (id) => document.getElementById(id);
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; } })();
const decks = saved.decks ?? [];
const useJa = saved.ja ?? true;
const phone = () => window.isPhone?.() ?? false;
const myName = () => { try { return localStorage.getItem(NAME_KEY) || 'あなた'; } catch { return 'あなた'; } };
const myAvatar = () => { try { return localStorage.getItem(AVATAR_KEY) || '1'; } catch { return '1'; } };
const avatarImage = (a) => `url("img/avatar/${a}.jpg")`;

// フェイズ（エンジンの名前 → 表示・アイコン）
const PHASES = [
  ['Untap', 'アンタップ', 'untap'], ['Upkeep', 'アップキープ', 'upkeep'], ['Draw', 'ドロー', 'draw'],
  ['PreCombatMain', 'メイン1', 'main1'], ['BeginCombat', '戦闘開始', 'begincombat'], ['DeclareAttackers', '攻撃', 'attack'],
  ['DeclareBlockers', 'ブロック', 'block'], ['FirstStrikeDamage', '先制攻撃ダメージ', 'damage'], ['CombatDamage', 'ダメージ', 'damage'],
  ['EndCombat', '戦闘終了', 'endcombat'], ['PostCombatMain', 'メイン2', 'main2'], ['End', '終了', 'end'], ['Cleanup', 'クリーンアップ', 'cleanup'],
];
const PHASE_NAME = Object.fromEntries(PHASES.map(([k, n]) => [k, n]));
const COLOR_JA = { White: '白', Blue: '青', Black: '黒', Red: '赤', Green: '緑', Colorless: '無色' };
const COLOR_SYM = { White: 'W', Blue: 'U', Black: 'B', Red: 'R', Green: 'G', Colorless: 'C' };

// ---------- 状態 ----------
let engineReady = null; // Promise
let knownCards = new Set(); // エンジンのカードデータにある名前（小文字）
let coverage = { unsupported: {} };
let game = null; // { level, names: [自分, CPU], cards: 名前 → { image, ja } , avatars }
let timer = null;
let logLines = [];
const ui = {
  attackers: new Set(),
  blocks: {}, // blocker → attacker
  blockSel: null,
  picks: new Set(),
  wHeld: false,
  stopsAll: (() => { try { return localStorage.getItem(STOPS_KEY) === 'on'; } catch { return false; } })(),
  autoTurn: null, // 「ターン終了まで」
  tapped: [], // 手で出したマナ（Ctrl+Z で戻す）：土地の id
};

// ---------- エンジンの読み込み ----------
async function gunzip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
function loadEngine() {
  engineReady ??= (async () => {
    await init({ module_or_path: await gunzip(`vendor/phase/engine_wasm_bg.wasm.gz?v=${VERSION}`) });
    const text = new TextDecoder().decode(await gunzip(`vendor/phase/card-data.json.gz?v=${VERSION}`));
    knownCards = new Set(Object.keys(JSON.parse(text)));
    E.load_card_database(text);
    try { coverage = await (await fetch(`vendor/phase/coverage.json?v=${VERSION}`)).json(); } catch {}
  })();
  return engineReady;
}

// ---------- エンジンへの問い合わせ ----------
const state = () => E.get_filtered_game_state(ME)?.state ?? null;
const legal = () => E.get_legal_actions_for_viewer_js(ME) ?? { actions: [] };
const waiting = () => state()?.waiting_for ?? null;

function submit(action) {
  const r = E.submit_action(ME, action);
  if (typeof r === 'string') { toast(r); return false; }
  if (r?.status !== 'applied') { toast(r?.rejection?.message ?? 'その行動はできません'); return false; }
  noteResult(r.result);
  return true;
}
function noteResult(result) {
  for (const e of result?.log_entries ?? []) {
    // 細かい記録（タップ・アンタップ・マナが出た・領域の移動など）は出さない
    if (e.presentation?.importance === 'Detail') continue;
    logLines.push({ turn: e.turn, text: logText(e.segments) });
  }
  if (logLines.length > 400) logLines = logLines.slice(-300);
  for (const ev of result?.events ?? []) soundFor(ev);
}
function soundFor(ev) {
  const t = ev.type;
  if (t === 'SpellCast') Sound.play('cast');
  else if (t === 'LifeChanged' || t === 'DamageDealt') Sound.play('lifeloss');
  else if (t === 'ZoneChanged' && ev.data?.to === 'Graveyard') Sound.play('cancel');
}
const logText = (segs) => (segs ?? []).map((s) => {
  if (s.type === 'PlayerName') return game?.names[s.value.player_id] ?? s.value.name;
  if (s.type === 'Text') return s.value;
  if (typeof s.value === 'string' || typeof s.value === 'number') return showName(String(s.value));
  return showName(s.value?.name ?? '');
}).join('');

// ---------- 名前・画像 ----------
const cardInfo = (name) => game?.cards[name] ?? game?.cards[name?.toLowerCase()] ?? {};
const showName = (name) => (useJa ? cardInfo(name).ja ?? name : name);
const objName = (o) => showName(o?.name ?? '');
const imageOf = (o) => cardInfo(o?.name).image ?? null;
function faceText(name) {
  try { const f = E.get_card_face_data(name); return f?.oracle_text ?? ''; } catch { return ''; }
}

// ---------- 進行：CPU・自動のパス ----------
function myTurnToAct(la = legal()) {
  return !!la.viewerInteraction?.canSubmit || (la.actions?.length ?? 0) > 0;
}
function floating() {
  const pool = state()?.players[ME].mana_pool?.mana ?? [];
  return pool.length > 0;
}
function tick() {
  clearTimeout(timer);
  render();
  const s = state();
  if (!s) return;
  const w = s.waiting_for;
  if (w.type === 'GameOver') return showResult(w.data?.winner);
  const la = legal();
  if (!myTurnToAct(la)) {
    timer = setTimeout(cpuStep, w.type === 'Priority' && !s.stack.length ? 250 : 650);
    return;
  }
  // 手で払い終わったら（浮いたマナで足りたら）唱える
  if (w.type === 'ManaPayment' && poolCovers(s)) { if (submit({ type: 'PassPriority' })) tick(); return; }
  if (w.type === 'Priority' && !floating() && !shouldStop(s, la)) timer = setTimeout(() => { if (submit({ type: 'PassPriority' })) tick(); }, 160);
}
function cpuStep() {
  const p = E.get_ai_action_proposal(game.level, OPP);
  if (!p) { render(); return; }
  const r = E.submit_ai_action_proposal(p.token, p.actor, p.action);
  if (r?.status === 'applied') noteResult(r.result);
  tick();
}
// 支払い中の呪文のコストを、マナ・プールのマナで払えるか
function poolCovers(s) {
  const cost = s.pending_cast?.cost;
  if (!cost || cost.type !== 'Cost') return false;
  const pool = (s.players[ME].mana_pool?.mana ?? []).map((u) => u.color);
  let generic = cost.generic ?? 0;
  for (const shard of cost.shards ?? []) {
    if (COLOR_SYM[shard]) {
      const i = pool.indexOf(shard);
      if (i < 0) return false;
      pool.splice(i, 1);
    } else if (shard === 'X') continue;
    else generic++;
  }
  return pool.length >= generic;
}

// 自分に優先権があるとき、止まって待つか
function shouldStop(s, la) {
  const top = s.stack.at(-1);
  if (ui.autoTurn != null) {
    if (s.turn_number !== ui.autoTurn) ui.autoTurn = null;
    else if (!(top && top.controller !== ME)) return false;
    else ui.autoTurn = null;
  }
  if (ui.stopsAll) return true;
  const can = la.actions.some((a) => a.type !== 'PassPriority');
  if (top) return top.controller !== ME && can;
  if (s.active_player === ME && ['PreCombatMain', 'PostCombatMain'].includes(s.phase)) return true;
  if (la.autoPassRecommended) return false;
  return can && (s.active_player !== ME ? ['DeclareAttackers', 'DeclareBlockers', 'End'].includes(s.phase) : s.phase === 'DeclareBlockers');
}

// ---------- 操作 ----------
const actionsFor = (id, la = legal()) => la.legalActionsByObject?.[id] ?? la.legalActionsByObject?.[String(id)] ?? [];
const strip = (a) => { const { interactionActionId, ...rest } = a; return rest; };
const isMana = (a) => ['TapLandForMana', 'ActivateManaSource'].includes(a.type);

function actionLabel(a, o) {
  const d = a.data ?? {};
  switch (a.type) {
    case 'PlayLand': return '土地をプレイする';
    case 'CastSpell': return '唱える';
    case 'TapLandForMana': case 'ActivateManaSource': {
      const c = d.selection?.mana_type;
      return `{${COLOR_SYM[c] ?? c ?? '?'}} を出す${d.selection?.penalty && d.selection.penalty !== 'None' ? '（ダメージなど）' : ''}`;
    }
    case 'UntapLandForMana': return '元に戻す：マナのタップ（Ctrl+Z）';
    case 'ActivateAbility': {
      const ab = o?.abilities?.[d.ability_index];
      return `起動：${ab?.description ?? ab?.text ?? `能力${(d.ability_index ?? 0) + 1}`}`;
    }
    default: return a.type;
  }
}

function onHandClick(id) {
  const s = state();
  const w = s.waiting_for;
  const la = legal();
  if (w.type === 'ManaPayment') return toast('マナを支払うか、キャンセル（Esc）してください');
  if (handPickMode(w)) return togglePick(id, handPickMode(w).count);
  const acts = actionsFor(id, la);
  if (!acts.length) return toast('今は使えません');
  if (acts.length === 1) return doAct(acts[0]);
  showMenu(acts.map((a) => [actionLabel(a, s.objects[id]), () => doAct(a)]), lastPoint.x, lastPoint.y);
}
function doAct(a) {
  let act = strip(a);
  // 呪文は「マナを支払ってください」になってから土地で払う（浮いたマナで足りればそのまま）
  if (act.type === 'CastSpell') act = { ...act, data: { ...act.data, payment_mode: { type: 'Manual' } } };
  if (isMana(act)) ui.tapped.push(act.data.selection.source.object_id);
  if (submit(act)) tick();
}

function onPermanentClick(id, e) {
  const s = state();
  const w = s.waiting_for;
  const o = s.objects[id];
  const la = legal();
  // 対象
  const t = targetAction(la, { Object: id });
  if (t) return doAct(t);
  // 攻撃・ブロック
  if (w.type === 'DeclareAttackers' && o.controller === ME) {
    if (!w.data.valid_attacker_ids.includes(id)) return toast(`${objName(o)}は攻撃できません`);
    if (ui.attackers.has(id)) ui.attackers.delete(id); else ui.attackers.add(id);
    Sound.play(ui.attackers.has(id) ? 'attack' : 'cancel');
    return render();
  }
  if (w.type === 'DeclareBlockers') {
    if (o.controller === ME) {
      if (ui.blocks[id] != null) { delete ui.blocks[id]; ui.blockSel = null; return render(); }
      if (!w.data.valid_blocker_ids.includes(id)) return toast(`${objName(o)}はブロックできません`);
      ui.blockSel = ui.blockSel === id ? null : id;
      return render();
    }
    if (ui.blockSel != null) {
      const ok = (w.data.valid_block_targets[ui.blockSel] ?? w.data.valid_block_targets[String(ui.blockSel)] ?? []).includes(id);
      if (!ok) return toast(`${objName(s.objects[ui.blockSel])}は${objName(o)}をブロックできません`);
      ui.blocks[ui.blockSel] = id;
      ui.blockSel = null;
      Sound.play('button');
      return render();
    }
    return;
  }
  if (handPickMode(w)?.cards.includes(id)) return togglePick(id, handPickMode(w).count);
  if (o.controller !== ME) return phone() ? showDetail(id) : null;
  // マナ（支払い中は支払いの候補から）
  const pay = w.type === 'ManaPayment' ? (la.manaPaymentShortcutActions ?? []).filter((a) => (a.data?.selection?.source?.object_id ?? a.data?.object_id) === id) : [];
  const acts = [...pay, ...actionsFor(id, la).filter((a) => !pay.length || !isMana(a))];
  if (!acts.length) return phone() ? showDetail(id) : toast(o.tapped ? 'タップしています' : '今は使えません');
  const mana = acts.filter(isMana);
  const other = acts.filter((a) => !isMana(a));
  if (mana.length && !other.length) {
    if (mana.length === 1 || ui.wHeld) return doAct(mana[0]);
  } else if (acts.length === 1 && !phone()) return doAct(acts[0]);
  showMenu(acts.map((a) => [actionLabel(a, o), () => doAct(a)]), e?.clientX ?? lastPoint.x, e?.clientY ?? lastPoint.y);
}

// 巻き戻せるタップ：エンジンが覚えている「マナのためにタップした土地」（マナがまだ使われていないもの）
const undoable = () => {
  const s = state();
  const ids = s?.lands_tapped_for_mana?.[ME] ?? s?.lands_tapped_for_mana?.[String(ME)] ?? [];
  return ids.filter((id) => s.objects[id]?.tapped);
};
const canUndo = () => undoable().length > 0 && ['Priority', 'ManaPayment'].includes(waiting()?.type);
function undoMana() {
  const ids = undoable();
  // 最後に手で出したものから
  const order = [...ui.tapped.filter((id) => ids.includes(id)).reverse(), ...ids.reverse()];
  for (const id of order) {
    const r = E.submit_action(ME, { type: 'UntapLandForMana', data: { object_id: id } });
    if (r?.status === 'applied') {
      noteResult(r.result);
      ui.tapped = ui.tapped.filter((x) => x !== id);
      Sound.play('button');
      return tick();
    }
  }
  toast('元に戻せるマナのタップがありません');
}

// 対象を選ぶ行動（ChooseTarget）の中から、この対象のもの
function targetAction(la, target) {
  const key = JSON.stringify(target);
  return la.actions.find((a) => a.type === 'ChooseTarget' && JSON.stringify(a.data?.target) === key) ?? null;
}
// 手札・一覧から選ぶ場面（捨てる・探す・選ぶ）
function handPickMode(w) {
  if (['DiscardChoice', 'SearchChoice', 'ChooseFromZoneChoice', 'RevealChoice', 'DigChoice', 'ScryChoice', 'SurveilChoice'].includes(w.type) && Array.isArray(w.data?.cards)) {
    return { cards: w.data.cards, count: w.data.count ?? 1 };
  }
  return null;
}
function togglePick(id, n) {
  if (ui.picks.has(id)) ui.picks.delete(id);
  else if (ui.picks.size < n) ui.picks.add(id);
  else if (n === 1) { ui.picks.clear(); ui.picks.add(id); }
  Sound.play('button');
  render();
}
function submitPicks() {
  const cards = [...ui.picks];
  ui.picks.clear();
  if (submit({ type: 'SelectCards', data: { cards } })) tick();
}

function declareAttacks() {
  const w = waiting();
  const attacks = [...ui.attackers].map((id) => [id, (w.data.valid_attack_targets_by_attacker?.[id] ?? w.data.valid_attack_targets)[0]]);
  ui.attackers.clear();
  if (submit({ type: 'DeclareAttackers', data: { attacks, bands: [] } })) tick();
}
function declareBlocks() {
  const assignments = Object.entries(ui.blocks).map(([b, a]) => [Number(b), a]);
  ui.blocks = {};
  ui.blockSel = null;
  if (submit({ type: 'DeclareBlockers', data: { assignments } })) tick();
}

// ---------- 描画 ----------
function render() {
  const s = state();
  if (!s) return;
  const la = legal();
  const w = s.waiting_for;
  const me = s.players[ME];
  const opp = s.players[OPP];
  const mine = myTurnToAct(la);
  $('deck-name').textContent = game.deckName ?? '';
  $('turn-label').textContent = `ターン ${s.turn_number}（${s.active_player === ME ? 'あなた' : game.names[OPP]}）`;
  $('land-count').textContent = s.active_player === ME ? `土地 ${me.lands_played_this_turn ?? 0}/${s.max_lands_per_turn ?? 1}` : '';
  $('phase-hint').textContent = hintText(s, w, mine);
  const turnTag = Object.assign(document.createElement('span'), { className: 'phase-turn', textContent: $('turn-label').textContent });
  $('phases').replaceChildren(turnTag, ...PHASES.filter(([k]) => k !== 'FirstStrikeDamage' || s.phase === k).map(([k, n, icon]) => {
    const b = Object.assign(document.createElement('button'), { textContent: n, className: s.phase === k ? 'current' : '', disabled: true });
    b.dataset.phase = icon;
    return b;
  }));
  $('phase-current').textContent = PHASE_NAME[s.phase] ?? s.phase;
  const canPass = mine && ['Priority', 'ManaPayment'].includes(w.type);
  $('next-phase').disabled = !(mine && w.type === 'Priority');
  $('next-phase').textContent = s.stack.length ? '解決する（パス）' : s.active_player === ME && s.phase === 'PreCombatMain' ? '戦闘へ（パス）' : s.active_player === ME && s.phase === 'PostCombatMain' ? 'ターン終了（パス）' : 'パス';
  $('end-turn').disabled = !(mine && w.type === 'Priority');
  void canPass;
  $('undo-mana').hidden = !canUndo();
  $('stops-toggle').textContent = `すべてのステップで止まる：${ui.stopsAll ? 'オン' : 'オフ'}`;

  // プレイヤー
  $('my-player-name').textContent = game.names[ME];
  $('opp-player-name').textContent = game.names[OPP];
  $('opp-player-name').title = game.cpuDeckName ? `CPUのデッキ：${game.cpuDeckName}` : '';
  $('my-avatar').style.backgroundImage = avatarImage(game.avatars[0]);
  $('opp-avatar').style.backgroundImage = avatarImage(game.avatars[1]);
  $('life').textContent = me.life;
  $('opp-life').textContent = opp.life;
  $('library-count').textContent = me.library.length;
  $('graveyard-count').textContent = me.graveyard.length;
  $('exile-count').textContent = s.exile.filter((x) => s.objects[x]?.owner === ME).length;
  $('opp-library-count').textContent = opp.library.length;
  $('opp-hand-count').textContent = opp.hand.length;
  $('opp-graveyard-count').textContent = opp.graveyard.length;
  $('opp-exile-count').textContent = s.exile.filter((x) => s.objects[x]?.owner === OPP).length;
  $('my-pool').replaceChildren(...poolEls(me.mana_pool?.mana ?? []));
  $('opp-pool').replaceChildren(...poolEls(opp.mana_pool?.mana ?? []));
  $('my-mana').replaceChildren();
  $('opp-mana').replaceChildren();
  $('opp-status').textContent = mine ? `${game.names[OPP]}：待機中` : `${game.names[OPP]}が考えています…`;
  $('opp-area').classList.toggle('active-turn', s.active_player === OPP);
  $('opp-player').classList.toggle('active', s.active_player === OPP);
  $('my-player').classList.toggle('active', s.active_player === ME);

  // 戦場・手札
  const bf = (p, lands) => s.battlefield.filter((id) => {
    const o = s.objects[id];
    if (!o || o.controller !== p || o.attached_to != null) return false;
    const isLand = o.card_types.core_types.includes('Land') && !o.card_types.core_types.includes('Creature');
    return lands === isLand;
  });
  $('bf-main').replaceChildren(...bf(ME, false).map((id) => cardEl(s, id)));
  $('bf-lands').replaceChildren(...groupLands(s, bf(ME, true)));
  $('opp-main').replaceChildren(...bf(OPP, false).map((id) => cardEl(s, id)));
  $('opp-lands').replaceChildren(...groupLands(s, bf(OPP, true)));
  $('hand').replaceChildren(...me.hand.map((id) => cardEl(s, id, 'hand')));
  $('hand-count').textContent = `(${me.hand.length})`;
  renderStack(s);
  renderBanner(s, w, la, mine);
  renderLog();
}

function hintText(s, w, mine) {
  if (w.type === 'GameOver') return w.data?.winner === ME ? '勝利しました。' : '敗北しました。';
  if (!mine) return `${game.names[OPP]}が考えています…`;
  switch (w.type) {
    case 'MulliganDecision': return '初手を確認して、キープかマリガンを選んでください。';
    case 'ManaPayment': return 'マナを支払ってください。土地をクリックしてマナを出すか、「自動で支払う」。';
    case 'DeclareAttackers': return '攻撃するクリーチャーをクリックして「攻撃する」（しないなら「攻撃しない」）。';
    case 'DeclareBlockers': return 'ブロックするクリーチャー → 攻撃しているクリーチャーの順にクリックして「ブロックする」。';
    case 'TargetSelection': case 'TriggerTargetSelection': return '対象を選んでください（光っているカード・上のボタン）。';
    case 'Priority':
      if (s.stack.length) return `${objName(s.objects[s.stack.at(-1).source_id])}がスタックにあります。対応するならインスタントや能力を使い、しないなら「パス」。`;
      return s.active_player === ME && s.phase.endsWith('Main') ? 'メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。' : 'インスタントや能力を使えます。しないなら「パス」。';
    default: return '選んでください。';
  }
}

function poolEls(mana) {
  const count = {};
  for (const u of mana) { const k = COLOR_SYM[u.color] ?? 'C'; count[k] = (count[k] ?? 0) + 1; }
  return Object.entries(count).map(([k, n]) => Object.assign(document.createElement('span'), { className: `mana mana-${k}`, textContent: n > 1 ? `${k}×${n}` : k }));
}

function groupLands(s, ids) {
  const groups = new Map();
  const single = [];
  for (const id of ids) {
    const o = s.objects[id];
    if (Object.keys(o.counters ?? {}).length || o.attachments?.length || isCand(s, id)) { single.push([id]); continue; }
    const key = `${o.name}|${o.tapped}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  return [...groups.values(), ...single].sort((a, b) => s.objects[a[0]].name.localeCompare(s.objects[b[0]].name) || Number(s.objects[a[0]].tapped) - Number(s.objects[b[0]].tapped)).map((g) => {
    const el = cardEl(s, g[0]);
    el.dataset.ids = g.join(',');
    if (g.length > 1) {
      el.classList.add('stacked');
      el.append(Object.assign(document.createElement('span'), { className: 'stack-count', textContent: `×${g.length}` }));
    }
    return el;
  });
}

const isCand = (s, id) => !!targetAction(legal(), { Object: id });

function cardEl(s, id, zone = 'battlefield') {
  const o = s.objects[id];
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.ids = String(id);
  if (!o || o.face_down && o.controller !== ME) { el.classList.add('back'); return el; }
  if (o.tapped) el.classList.add('tapped');
  const image = imageOf(o);
  if (image) el.append(Object.assign(document.createElement('img'), { src: image, alt: objName(o) }));
  else el.append(Object.assign(document.createElement('div'), { className: 'text', textContent: objName(o) }));
  el.title = `${objName(o)}\n${faceText(o.name)}`;
  const badge = (cls, text) => el.append(Object.assign(document.createElement('span'), { className: cls, textContent: text }));
  const w = s.waiting_for;
  if (zone === 'battlefield') {
    if (o.card_types.core_types.includes('Creature')) {
      const mod = o.power !== o.base_power || o.toughness !== o.base_toughness;
      badge(`pt${o.damage_marked ? ' damaged' : ''}${mod ? ' modified' : ''}`, o.damage_marked ? `${o.power}/${o.toughness}(-${o.damage_marked})` : `${o.power}/${o.toughness}`);
      if (o.entered_battlefield_turn === s.turn_number && s.active_player === o.controller && !o.keywords?.includes('Haste')) el.classList.add('sick');
    }
    const c = o.counters ?? {};
    const cs = Object.entries(c).filter(([, n]) => n);
    if (cs.length) badge('counter', cs.map(([k, n]) => (k === 'P1P1' ? `+${n}` : k === 'M1M1' ? `-${n}` : `${k}×${n}`)).join(' '));
    if (o.attachments?.length) badge('attached', o.attachments.map((x) => objName(s.objects[x])).join('、'));
    const atk = s.combat?.attackers?.find((a) => a.object_id === id);
    const blocking = s.combat?.blocker_to_attacker?.[id];
    if (atk || ui.attackers.has(id)) { badge('atk', '攻撃'); el.classList.add('attacking'); }
    else if (blocking != null || ui.blocks[id] != null) badge('atk blk', 'ブロック');
    if (w.type === 'DeclareAttackers' && o.controller === ME && w.data.valid_attacker_ids.includes(id)) el.classList.add('can-attack');
    if (ui.blockSel === id) el.classList.add('block-select');
    if (isCand(s, id)) el.classList.add('targetable');
    if (w.type === 'ManaPayment' && o.controller === ME && (legal().manaPaymentShortcutActions ?? []).some((a) => a.data?.selection?.source?.object_id === id)) el.classList.add('selectable');
    el.addEventListener('click', (e) => onPermanentClick(id, e));
  } else if (zone === 'hand') {
    if (ui.picks.has(id)) el.classList.add('picked');
    else if (handPickMode(w)?.cards.includes(id)) el.classList.add('selectable');
    else if (actionsFor(id).length) el.classList.add('can-attack');
    el.addEventListener('click', () => (phone() && actionsFor(id).length > 0 ? openCardMenu(id) : onHandClick(id)));
  } else {
    if (viewerState?.pick && ui.picks.has(id)) el.classList.add('picked');
    else if (viewerState?.pick?.has(id)) el.classList.add('selectable');
    else if (viewerState?.pick) el.classList.add('dim');
    el.addEventListener('click', () => {
      if (!viewerState?.pick) return showDetail(id);
      if (!viewerState.pick.has(id)) return toast('このカードは選べません');
      togglePick(id, viewerState.count);
      renderViewer();
    });
  }
  el.addEventListener('mouseenter', () => showPreview(o));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!phone()) openCardMenu(id, e.clientX, e.clientY); });
  window.onLongPress?.(el, () => window.showCardDetail?.({ name: objName(o), image, text: faceText(o.name) }, [['操作メニュー', () => openCardMenu(id)]]));
  return el;
}

function openCardMenu(id, x = lastPoint.x, y = lastPoint.y) {
  const s = state();
  const o = s.objects[id];
  const la = legal();
  const items = actionsFor(id, la).map((a) => [actionLabel(a, o), () => doAct(a)]);
  if (canUndo()) items.push(['元に戻す：マナのタップ（Ctrl+Z）', undoMana]);
  items.push(['詳しく見る', () => showDetail(id)]);
  showMenu(items, x, y);
}
function showDetail(id) {
  const o = state().objects[id];
  window.showCardDetail?.({ name: objName(o), image: imageOf(o), text: faceText(o.name) });
}
function showPreview(o) {
  const image = imageOf(o);
  $('preview').hidden = !image;
  $('preview-text').hidden = !!image;
  if (image) $('preview').src = image;
  else $('preview-text').textContent = `${objName(o)}\n${faceText(o.name)}`;
}

function renderStack(s) {
  $('stack').hidden = !s.stack.length;
  $('stack-items').replaceChildren(...[...s.stack].reverse().map((it, i) => {
    const el = document.createElement('div');
    el.className = `stack-item ${it.controller === ME ? 'mine' : 'theirs'}${i === 0 ? ' top' : ''}`;
    const src = s.objects[it.source_id];
    const image = imageOf(src);
    if (image) el.append(Object.assign(document.createElement('img'), { src: image, alt: objName(src) }));
    const what = it.kind?.type === 'Spell' ? '' : it.kind?.type === 'TriggeredAbility' ? '（誘発）' : '（能力）';
    el.append(Object.assign(document.createElement('div'), { className: 'stack-text', textContent: `${objName(src)}${what}` }));
    const t = targetAction(legal(), { Object: it.id }) ?? targetAction(legal(), { StackEntry: it.id }) ?? targetAction(legal(), { Stack: it.id });
    if (t) { el.classList.add('targetable'); el.addEventListener('click', () => doAct(t)); }
    if (src) el.addEventListener('mouseenter', () => showPreview(src));
    return el;
  }));
}

// 上の案内：場面ごとのボタン。知らない場面は、できる行動をボタンにして並べる
function renderBanner(s, w, la, mine) {
  const bar = $('mulligan-bar');
  bar.classList.remove('big');
  bar.hidden = true;
  if (!mine || w.type === 'GameOver') return;
  const span = (text, cls = '') => Object.assign(document.createElement('span'), { textContent: text, className: cls });
  const button = (text, fn, primary = false, disabled = false) => {
    const b = Object.assign(document.createElement('button'), { textContent: text, className: primary ? 'primary' : '', disabled });
    b.addEventListener('click', fn);
    return b;
  };
  const show = (...els) => { bar.hidden = false; bar.replaceChildren(...els); };
  const act = (a) => () => doAct(a);
  switch (w.type) {
    case 'Priority': return;
    case 'MulliganDecision': {
      bar.classList.add('big');
      const keep = la.actions.find((a) => a.data?.choice?.type === 'Keep');
      const mull = la.actions.find((a) => a.data?.choice?.type === 'Mulligan');
      if (!keep && !mull) break;
      const choices = Object.assign(document.createElement('div'), { className: 'choices' });
      choices.append(...[mull && button('マリガン', act(mull)), keep && button('キープ', act(keep), true)].filter(Boolean));
      return show(span('初手', 'title'), span('この7枚で始めるならキープ、引き直すならマリガン', 'note'), choices);
    }
    case 'ManaPayment':
      return show(span('マナを支払ってください'), span('光っている土地をクリック（W を押しながらで色を自動で選ぶ・Ctrl+Z で取り消し）', 'block-hint'),
        button('自動で支払う', () => { if (submit({ type: 'PassPriority' })) tick(); }, true),
        button('キャンセル', () => { if (submit({ type: 'CancelCast' })) tick(); }));
    case 'DeclareAttackers':
      return show(span(`攻撃するクリーチャーを選んでください（${ui.attackers.size}体）`), button(ui.attackers.size ? '攻撃する' : '攻撃しない', declareAttacks, true));
    case 'DeclareBlockers':
      return show(span(`ブロック：${Object.keys(ui.blocks).length}体`), button(Object.keys(ui.blocks).length ? 'ブロックする' : 'ブロックしない', declareBlocks, true));
    case 'TargetSelection': case 'TriggerTargetSelection': {
      const players = la.actions.filter((a) => a.type === 'ChooseTarget' && a.data?.target?.Player != null)
        .map((a) => button(a.data.target.Player === ME ? 'あなた（自分）' : `${game.names[OPP]}（相手）`, act(a), a.data.target.Player === OPP));
      const others = la.actions.filter((a) => a.type !== 'ChooseTarget').map((a) => button(genericLabel(a), act(a)));
      return show(span('対象を選んでください'), span('光っているカードをクリック', 'block-hint'), ...players, ...others);
    }
    case 'ChooseXValue': {
      const max = w.data.max ?? 0;
      const v = Object.assign(document.createElement('input'), { type: 'number', min: w.data.min ?? 0, max, value: max, className: 'room-code' });
      return show(span(`X の値（${w.data.min ?? 0}〜${max}）`), v, button('決定', () => { if (submit({ type: 'ChooseX', data: { value: Math.max(w.data.min ?? 0, Math.min(max, Number(v.value) || 0)) } })) tick(); }, true),
        ...la.actions.filter((a) => a.type === 'CancelCast').map((a) => button('キャンセル', act(a))));
    }
    case 'OptionalEffectChoice':
      return show(span(w.data.description ?? '使いますか？'), ...la.actions.map((a) => button(a.data?.accept === true || a.data?.choice?.type === 'Accept' ? (a.type.endsWith('Remember') ? 'はい（今後も）' : 'はい') : a.type.endsWith('Remember') ? 'いいえ（今後も）' : 'いいえ', act(a), a.data?.accept === true)));
    default: break;
  }
  // カードを選ぶ場面（手札から捨てる・ライブラリーから探す など）
  const pick = handPickMode(w);
  if (pick) {
    const inHand = pick.cards.every((id) => s.players[ME].hand.includes(id));
    const open = () => openViewer({ title: '選んでください', ids: pick.cards, pick: new Set(pick.cards), count: pick.count, onOk: () => { closeViewer(); submitPicks(); } });
    if (!inHand && !viewerState) open();
    return show(span(`カードを選んでください（${ui.picks.size}/${pick.count}）`), ...(inHand ? [] : [button('一覧を開く', open)]),
      button('決定', submitPicks, true));
  }
  // そのほか：できる行動をボタンで
  return show(span(sceneLabel(w)), ...la.actions.slice(0, 12).map((a) => button(genericLabel(a), act(a))));
}
const sceneLabel = (w) => ({ SeparatePilesPartition: '束に分けてください', SeparatePilesChoice: '束を選んでください', DistributeAmong: '割り振ってください' }[w.type] ?? `選んでください（${w.type}）`);
function genericLabel(a) {
  const d = a.data ?? {};
  if (a.type === 'PassPriority') return 'パス';
  if (a.type === 'CancelCast') return 'キャンセル';
  if (a.type === 'ChoosePile') return `束${d.pile?.type ?? ''}を選ぶ`;
  if (a.type === 'SelectCards') return d.cards?.length ? `${d.cards.length}枚を選ぶ` : '選ばない';
  if (a.type === 'DecideOptionalEffect') return d.accept ? 'はい' : 'いいえ';
  if (a.type === 'ChooseTarget') return d.target?.Player != null ? game.names[d.target.Player] : '対象を選ぶ';
  if (a.type === 'DistributeAmong') return '割り振る';
  if (a.type === 'SubmitPilePartition') return '束に分ける';
  const s = JSON.stringify(d);
  return `${a.type}${s && s !== '{}' ? ` ${s.slice(0, 40)}` : ''}`;
}

function renderLog() {
  const el = $('log');
  el.replaceChildren(...logLines.slice(-250).map((e) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), { className: 't', textContent: e.turn ? `T${e.turn}` : '—' }), e.text);
    return li;
  }));
  el.scrollTop = el.scrollHeight;
}

// ---------- 一覧（墓地・追放・選ぶ） ----------
let viewerState = null;
function openViewer(st) {
  viewerState = st;
  renderViewer();
  if (!$('viewer').open) $('viewer').showModal();
}
function renderViewer() {
  if (!viewerState) return;
  const s = state();
  const ids = viewerState.zone ? (viewerState.zone === 'exile' ? s.exile.filter((x) => s.objects[x]?.owner === viewerState.player) : s.players[viewerState.player][viewerState.zone]) : viewerState.ids;
  $('viewer-title').textContent = `${viewerState.title}（${ids.length}枚）`;
  $('viewer-hint').textContent = viewerState.pick ? `クリックで選ぶ（${ui.picks.size}/${viewerState.count}）` : '';
  $('viewer-ok').hidden = !viewerState.onOk;
  $('viewer-cards').replaceChildren(...[...ids].reverse().map((id) => cardEl(s, id, 'viewer')));
}
function closeViewer() {
  viewerState = null;
  if ($('viewer').open) $('viewer').close();
}

// ---------- メニュー・お知らせ ----------
let lastPoint = { x: 0, y: 0 };
document.addEventListener('pointerdown', (e) => { lastPoint = { x: e.clientX, y: e.clientY }; }, true);
function showMenu(items, x, y) {
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
  menu.hidden = false;
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 8))}px`;
}
function hideMenu() { $('menu').hidden = true; }
function toast(text) {
  let el = $('toast');
  if (!el) { el = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' }); document.body.append(el); }
  el.textContent = text;
  el.hidden = false;
  Sound.play('cancel');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}
let shownResult = false;
function showResult(winner) {
  if (shownResult) return;
  shownResult = true;
  const win = winner === ME;
  Sound.play(win ? 'win' : 'lose');
  $('result-title').textContent = win ? '勝利' : '敗北';
  $('result-text').textContent = '';
  if (!$('result').open) $('result').showModal();
}

// ---------- 開始 ----------
// CPU のランダムなデッキ（duel.js と同じ組み方。エンジンが対応しているカードだけ）
const COLOR_NAMES = { W: '白', U: '青', B: '黒', R: '赤', G: '緑' };
const shuffled = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
let pool = null;
async function cardPool() {
  pool ??= fetch('data/oldframe-modern.json?v=1').then((r) => r.json()).then((d) => d.cards);
  return pool;
}
async function randomCpuDeck() {
  const all = await cardPool();
  const usable = (c) => knownCards.has(c.name.toLowerCase()) && !coverage.unsupported?.[c.name];
  const colors = shuffled(Object.keys(COLOR_NAMES)).slice(0, 2);
  const pips = (c) => (c.manaCost ?? '').match(/\{[^}]*\}/g) ?? [];
  const fits = (c) => (c.colors ?? []).length > 0 && c.colors.every((x) => colors.includes(x))
    && pips(c).every((p) => !/[WUBRG]/.test(p) || [...p.matchAll(/[WUBRG]/g)].some((m) => colors.includes(m[0])));
  const spells = shuffled(all.filter((c) => !/\bLand\b/.test(c.typeLine) && fits(c) && c.cmc <= 6 && usable(c)));
  const cards = {};
  let count = 0;
  const add = (c, qty) => { cards[c.name] = { card: c, qty }; count += qty; return qty; };
  const take = (list, want) => {
    let got = 0;
    for (const c of list) {
      if (got >= want) break;
      if (cards[c.name]) continue;
      got += add(c, Math.min(/\bLegendary\b/.test(c.typeLine) ? 1 : 4, want - got, 2 + Math.floor(Math.random() * 3)));
    }
    return got;
  };
  const creatures = spells.filter((c) => /\bCreature\b/.test(c.typeLine));
  let made = 0;
  for (const [lo, hi, want] of [[1, 1, 4], [2, 2, 6], [3, 3, 5], [4, 4, 3], [5, 6, 2]]) made += take(creatures.filter((c) => c.cmc >= lo && c.cmc <= hi), want);
  made += take(creatures, 20 - made);
  take(spells.filter((c) => !/\bCreature\b/.test(c.typeLine) && c.cmc <= 5), 36 - count);
  take(spells, 36 - count);
  const weight = Object.fromEntries(colors.map((k) => [k, 0]));
  for (const { card, qty } of Object.values(cards)) for (const p of pips(card)) for (const m of p.matchAll(/[WUBRG]/g)) if (m[0] in weight) weight[m[0]] += qty;
  const total = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
  const basic = (k) => all.find((c) => /\bBasic\b/.test(c.typeLine) && !/Snow/.test(c.typeLine) && (c.produced ?? []).length === 1 && c.produced[0] === k);
  const n0 = Math.min(20, Math.max(4, Math.round((24 * weight[colors[0]]) / total)));
  add(basic(colors[0]), n0);
  add(basic(colors[1]), 24 - n0);
  return { id: 'random', name: `ランダム（${colors.map((k) => COLOR_NAMES[k]).join('・')}）`, cards };
}

const deckList = (d) => Object.values(d.cards).flatMap(({ card, qty }) => Array(qty).fill(card.name));
function deckCheck(d) {
  const names = [...new Set(Object.values(d.cards).map((e) => e.card.name))];
  return {
    unknown: names.filter((n) => !knownCards.has(n.toLowerCase())),
    partial: names.filter((n) => coverage.unsupported?.[n]),
  };
}

function openSetup() {
  const options = () => decks.map((d) => new Option(`${d.name}（${Object.values(d.cards).reduce((s, e) => s + e.qty, 0)}枚）`, d.id));
  $('setup-deck').replaceChildren(...options());
  $('setup-cpu-deck').replaceChildren(new Option('ランダム（旧枠モダンのカードで毎回組む）', 'random'), ...options());
  const requested = Number(new URLSearchParams(location.search).get('deck'));
  $('setup-deck').value = String(requested || saved.current || decks[0]?.id || '');
  let cpu = null;
  try { cpu = JSON.parse(localStorage.getItem(CPU_DECK_KEY)); } catch {}
  $('setup-cpu-deck').value = decks.some((d) => d.id === cpu) ? String(cpu) : 'random';
  $('setup-error').textContent = decks.length ? '' : 'デッキがありません。デッキ作成画面で作ってください。';
  updateSupport();
  $('setup').showModal();
}
async function updateSupport() {
  const box = $('setup-support');
  box.textContent = 'エンジンを読み込んでいます…';
  $('setup-start').disabled = true;
  try { await loadEngine(); } catch (err) { box.textContent = `エンジンを読み込めませんでした：${err.message}`; return; }
  $('setup-start').disabled = false;
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  box.replaceChildren();
  if (!deck) return;
  const { unknown, partial } = deckCheck(deck);
  const head = Object.assign(document.createElement('div'), {
    textContent: unknown.length ? `このエンジンにないカード：${unknown.length}種類（このデッキでは始められません。今までのルール対戦を使ってください）` : partial.length ? `一部の効果が動かないカード：${partial.length}種類` : 'すべてのカードに対応しています',
  });
  box.append(head);
  const list = [...unknown, ...partial];
  if (list.length) {
    const ul = document.createElement('ul');
    for (const n of list.slice(0, 30)) ul.append(Object.assign(document.createElement('li'), { textContent: showNameFromDeck(deck, n) }));
    box.append(ul);
  }
}
const showNameFromDeck = (d, n) => { const e = Object.values(d.cards).find((x) => x.card.name === n); return useJa ? e?.card.ja?.name ?? n : n; };

async function startFromSetup(e) {
  e.preventDefault();
  await loadEngine();
  const deck = decks.find((d) => d.id === Number($('setup-deck').value));
  if (!deck) return;
  let cpuDeck;
  try { cpuDeck = $('setup-cpu-deck').value === 'random' ? await randomCpuDeck() : decks.find((d) => d.id === Number($('setup-cpu-deck').value)); } catch { $('setup-error').textContent = 'カードの一覧を読み込めませんでした。'; return; }
  for (const d of [deck, cpuDeck]) {
    const { unknown } = deckCheck(d);
    if (unknown.length) { $('setup-error').textContent = `「${d.name}」に、このエンジンにないカードがあります：${unknown.slice(0, 5).join('、')}${unknown.length > 5 ? ' ほか' : ''}`; return; }
  }
  try { localStorage.setItem(CPU_DECK_KEY, JSON.stringify(cpuDeck.id)); } catch {}
  const order = $('setup-form').elements.order.value;
  const first = order === 'play' ? ME : order === 'draw' ? OPP : Math.random() < 0.5 ? ME : OPP;
  const cards = {};
  for (const d of [deck, cpuDeck]) for (const { card } of Object.values(d.cards)) {
    const entry = { image: card.pick?.image ?? (useJa ? card.ja?.image : null) ?? card.image ?? null, ja: card.ja?.name ?? null };
    cards[card.name] = entry;
    cards[card.name.toLowerCase()] = entry;
  }
  game = { level: $('setup-level').value, names: [myName(), 'CPU'], cards, deckName: deck.name, cpuDeckName: cpuDeck.name, avatars: [myAvatar(), String(1 + Math.floor(Math.random() * 18))] };
  const free = E.getFormatRegistry().find((x) => x.format === 'Freeform').default_config;
  const r = E.initialize_game({ player: { main_deck: deckList(deck) }, opponent: { main_deck: deckList(cpuDeck) } }, Math.floor(Math.random() * 1e9), free, null, 2, first);
  if (r?.error) { $('setup-error').textContent = (r.reasons ?? []).join(' / '); return; }
  logLines = [];
  noteResult(r);
  ui.attackers.clear(); ui.blocks = {}; ui.picks.clear(); ui.tapped = []; ui.autoTurn = null;
  shownResult = false;
  $('setup').close();
  toast(`CPUのデッキ：${cpuDeck.name}`);
  tick();
}

// PC ではフェイズの一覧を戦場と手札の間の横長のバーに、スマホでは左列（下のバー）に置く（duel.js と同じ）
function placePhases() {
  const ph = $('phases');
  const want = phone() ? $('col-left') : document.querySelector('.board');
  if (ph.parentElement === want) return;
  if (phone()) want.insertBefore(ph, want.querySelector('.phase-actions'));
  else want.insertBefore(ph, want.querySelector('.hand-area'));
}

function init2() {
  placePhases();
  window.addEventListener('resize', placePhases);
  $('next-phase').addEventListener('click', () => { if (submit({ type: 'PassPriority' })) tick(); });
  $('end-turn').addEventListener('click', () => { ui.autoTurn = state()?.turn_number; if (submit({ type: 'PassPriority' })) tick(); });
  $('undo-mana').addEventListener('click', undoMana);
  $('stops-toggle').addEventListener('click', () => {
    ui.stopsAll = !ui.stopsAll;
    try { localStorage.setItem(STOPS_KEY, ui.stopsAll ? 'on' : 'off'); } catch {}
    render();
  });
  $('concede').addEventListener('click', () => { if (confirm('投了しますか？')) { submit({ type: 'Concede', data: { player_id: ME } }); tick(); showResult(OPP); } });
  $('restart').addEventListener('click', () => { clearTimeout(timer); openSetup(); });
  $('setup-form').addEventListener('submit', startFromSetup);
  $('setup-deck').addEventListener('change', updateSupport);
  $('viewer-close').addEventListener('click', closeViewer);
  $('viewer-ok').addEventListener('click', () => viewerState?.onOk?.());
  $('viewer').addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
  $('result-close').addEventListener('click', () => $('result').close());
  $('result-again').addEventListener('click', () => { $('result').close(); openSetup(); });
  for (const [btn, zone, player, title] of [['pile-graveyard', 'graveyard', ME, '墓地'], ['pile-exile', 'exile', ME, '追放'], ['opp-pile-graveyard', 'graveyard', OPP, '相手の墓地'], ['opp-pile-exile', 'exile', OPP, '相手の追放']]) {
    $(btn).addEventListener('click', () => state() && openViewer({ title, zone, player }));
  }
  document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) hideMenu(); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideMenu(); const w = waiting(); if (w?.type === 'ManaPayment' || w?.type === 'TargetSelection') { if (submit({ type: 'CancelCast' })) tick(); } return; }
    if (document.querySelector('dialog[open]') || e.target.matches('input, select, textarea')) return;
    if (e.key.toLowerCase() === 'w') ui.wHeld = true;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoMana(); return; }
    const w = waiting();
    if (w?.type !== 'Priority' || !myTurnToAct()) return;
    if (e.key === ' ') { e.preventDefault(); if (submit({ type: 'PassPriority' })) tick(); }
    else if (e.key === 'Enter') { e.preventDefault(); ui.autoTurn = state().turn_number; if (submit({ type: 'PassPriority' })) tick(); }
  });
  document.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'w') ui.wHeld = false; });
  window.addEventListener('blur', () => { ui.wHeld = false; });
  openSetup();
}

init2();
