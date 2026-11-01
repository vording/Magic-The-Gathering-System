// Magic: The Gathering System — CPU対戦の相手（CPU）
// ネット対戦と同じメッセージ（hello / state / pass / combat / priority / effect …）でやり取りする「同じページの中の相手」。
// net.js の Net.cpu(Cpu) でつなぐと、play.js からはネット対戦の相手と同じに見える。
// CPU は自分のゲーム状態を持ち、rules.js の自動処理でカードを使う（土地を出す・マナを払って唱える・攻撃・ブロック）。
// 読み取れない効果のカード（オーラ・装備品・プレインズウォーカー・効果を読めない呪文）は唱えない。

const Cpu = (() => {
  const SAVE_KEY = 'mtg-deckmaker-cpu';
  const STEP_MS = 450;
  const ACT_MS = 750;
  const MAX_HAND = 7;
  const NAME = 'CPU';

  let deck = null; // { name, cards: { key: { card, qty } } }
  let g = null; // CPU のゲーム
  let human = null; // 相手（人）の最新の snapshot
  let avatar = String(1 + Math.floor(Math.random() * 18));
  let send = () => {};
  let makeCard = null; // play.js の cardFrom
  let running = false;
  let pending = null; // 人の承認待ち { id, resolve }
  let started = false; // 接続中か

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = Rules;

  // ---------- 保存 ----------

  function save() {
    try { sessionStorage.setItem(SAVE_KEY, JSON.stringify({ deck, g, human, avatar })); } catch {}
  }
  function restore() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SAVE_KEY));
      if (!s) return false;
      ({ deck, g, human } = s);
      avatar = s.avatar ?? avatar;
      return true;
    } catch { return false; }
  }
  function clear() {
    deck = null; g = null; human = null;
    try { sessionStorage.removeItem(SAVE_KEY); } catch {}
  }

  // ---------- 状態 ----------

  const cardsIn = (z) => g.zones[z].map((i) => g.cards[i]);
  const bf = () => cardsIn('battlefield');
  const humanBf = () => human?.battlefield ?? [];
  const isSick = (c) => R.isCreature(c) && c.enteredTurn != null && c.enteredTurn >= g.turn && !R.hasKw(c, 'haste');
  const zoneOf = (iid) => Object.keys(g.zones).find((z) => g.zones[z].includes(iid));
  const value = (c) => {
    const v = R.pt(c);
    return (v ? v.p * 1.5 + v.t : 1) + (c.cmc || 0) * 0.5 + R.kwOf(c).length * 0.5 - (c.token ? 1 : 0);
  };

  function log(text) {
    g.log.push({ turn: g.turn, text, ts: Date.now() });
    if (g.log.length > 300) g.log.splice(0, g.log.length - 300);
  }

  function snapshot() {
    R.applyStatics(g);
    const pub = (iid) => R.pub(g.cards[iid], g.blocks?.[iid] ?? null);
    return {
      deckName: g.deckName,
      life: g.life,
      turn: g.turn,
      phase: g.phase,
      waiting: !!g.waiting,
      hand: g.zones.hand.length,
      library: g.zones.library.length,
      battlefield: g.zones.battlefield.map(pub),
      graveyard: g.zones.graveyard.map(pub),
      exile: g.zones.exile.map(pub),
      log: g.log.slice(-150),
      result: g.result ?? null,
    };
  }

  // 状態を相手に送る（表示の更新）
  function sync() {
    if (!g) return;
    send({ type: 'state', state: snapshot() });
    save();
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newGame(onDraw, matchId) {
    const cards = {};
    const library = [];
    let iid = 0;
    for (const { card, qty } of Object.values(deck.cards)) {
      for (let i = 0; i < qty; i++) {
        iid++;
        cards[iid] = makeCard(card, iid);
        library.push(iid);
      }
    }
    g = {
      deckName: deck.name, onDraw, matchId, turn: 0, phase: 'mulligan', life: deck.format === 'commander' ? 40 : 20,
      nextIid: iid + 1, cards, zones: { library: shuffle(library), hand: [], battlefield: [], graveyard: [], exile: [] },
      log: [], waiting: true, blocks: {}, landsPlayed: 0, result: null,
    };
    log(`「${deck.name}」で開始（${onDraw ? '後手' : '先手'}）`);
    mulligan();
    g.phase = 'ready';
    sync();
    send({ type: 'chat', text: 'よろしくお願いします！' });
  }

  // 土地が2〜5枚ならキープ。マリガンは2回まで（ロンドン・マリガン）
  function mulligan() {
    let m = 0;
    for (;;) {
      g.zones.hand.push(...g.zones.library.splice(0, 7));
      const lands = cardsIn('hand').filter((c) => c.isLand).length;
      if ((lands >= 2 && lands <= 5) || m >= 2) break;
      g.zones.library.push(...g.zones.hand.splice(0));
      shuffle(g.zones.library);
      m++;
    }
    for (let i = 0; i < m; i++) {
      const hand = cardsIn('hand');
      const lands = hand.filter((c) => c.isLand);
      const pickBy = lands.length > 3 ? lands : hand.filter((c) => !c.isLand).sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
      const out = (pickBy[0] ?? hand[0]).iid;
      g.zones.hand = g.zones.hand.filter((x) => x !== out);
      g.zones.library.push(out);
    }
    log(`キープ（マリガン${m}回）`);
  }

  // ---------- 基本の操作 ----------

  function move(iid, to, { bottom = false } = {}) {
    const from = zoneOf(iid);
    if (!from) return;
    const c = g.cards[iid];
    g.zones[from] = g.zones[from].filter((x) => x !== iid);
    if (c.token && to !== 'battlefield') {
      delete g.cards[iid];
      return;
    }
    if (to !== 'battlefield') {
      c.tapped = false;
      c.counters = 0;
      c.attacking = false;
      delete c.ptMod;
      delete c.damage;
      delete c.tempKw;
      delete g.blocks?.[iid];
    } else if (from !== 'battlefield') {
      c.enteredTurn = g.turn;
      if (R.parse(c).entersTapped) c.tapped = true;
    }
    if (to === 'library' && !bottom) g.zones.library.unshift(iid);
    else g.zones[to].push(iid);
    if (from === 'battlefield' && to === 'graveyard') window.Sound?.play('destroy');
  }

  function draw(n) {
    let drawn = 0;
    for (; drawn < n && g.zones.library.length; drawn++) g.zones.hand.push(g.zones.library.shift());
    if (drawn) log(`${drawn}枚引いた`);
    if (drawn < n) lose('deck');
  }

  function setLife(v) {
    g.life = v;
    log(`ライフ ${v}`);
    if (v <= 0) lose('life');
  }

  function lose(reason) {
    if (g.result) return;
    g.result = { reason };
    log(`敗北：${{ life: 'ライフが0になりました', deck: 'ライブラリーが空の状態でカードを引こうとしました', concede: '投了しました' }[reason]}`);
    send({ type: 'chat', text: 'GG！' });
  }

  function token(spec) {
    const iid = g.nextIid++;
    g.cards[iid] = {
      iid, name: `${spec.p}/${spec.t} ${spec.name}`, image: null, isLand: false, isCreature: true, kind: 'creature', token: true,
      typeLine: `Token ${spec.artifact ? 'Artifact ' : ''}Creature — ${spec.name}`, text: '', oracle: '', power: spec.p, toughness: spec.t,
      keywords: spec.kw ?? [], colors: spec.colors ?? [], tapped: false, counters: 0, enteredTurn: g.turn, cmc: 0,
    };
    g.zones.battlefield.push(iid);
    log(`${g.cards[iid].name}（トークン）を生成`);
  }

  // 捨てる：余った土地 → 重い呪文の順
  function discard(n) {
    for (let i = 0; i < n && g.zones.hand.length; i++) {
      const hand = cardsIn('hand');
      const lands = hand.filter((c) => c.isLand);
      const landsOnBf = bf().filter((c) => c.isLand).length;
      const pickFrom = lands.length && landsOnBf + lands.length > 5 ? lands : hand.filter((c) => !c.isLand).length ? hand.filter((c) => !c.isLand) : hand;
      const c = pickFrom.sort((a, b) => (b.cmc || 0) - (a.cmc || 0))[0];
      move(c.iid, 'graveyard');
      log(`${c.name}を捨てた`);
    }
  }

  // 基本土地を探す：手札の呪文に必要な色で、まだ出せない色を優先
  function searchLand(n, to, tapped) {
    for (let i = 0; i < n; i++) {
      const basics = cardsIn('library').filter((c) => c.isLand && /\bBasic\b/.test(c.typeLine ?? ''));
      if (!basics.length) break;
      const have = new Set(bf().flatMap((c) => R.manaOf(c) ?? []));
      const need = new Set(cardsIn('hand').flatMap((c) => R.COLORS.filter((x) => (c.manaCost ?? '').includes(x))));
      const pickC = basics.find((c) => (R.manaOf(c) ?? []).some((x) => need.has(x) && !have.has(x))) ?? basics[0];
      move(pickC.iid, to);
      if (to === 'battlefield' && tapped) pickC.tapped = true;
      log(`ライブラリーから${pickC.name}を${to === 'hand' ? '手札に加えた' : '戦場に出した'}`);
    }
    shuffle(g.zones.library);
  }

  const hooks = (src) => ({
    move: (iid, to) => { const c = g.cards[iid]; move(iid, to); if (c && to === 'graveyard') log(`${c.name}：戦場 → 墓地`); },
    setLife,
    draw,
    log,
    token,
    discard,
    searchLand,
    src,
  });

  function sba() {
    R.applyStatics(g);
    for (const name of R.checkDeaths(g, (iid, to) => move(iid, to))) log(`${name}：戦場 → 墓地`);
  }

  // 自分のターンの終わり・相手のターンの終わり：このターンの修整とダメージが消える
  function endOfTurn() {
    for (const c of bf()) {
      delete c.ptMod;
      delete c.damage;
      delete c.tempKw;
    }
  }

  // ---------- 呪文を選ぶ ----------

  const sources = () => R.manaSources(bf(), isSick);
  const hexproof = (c) => R.hasKw(c, 'shroud') || R.hasKw(c, 'hexproof');

  // 効果の対象を選ぶ → chosen（対象不要なら undefined、よい対象がなければ null）
  // mode: 'main'（自分のメイン）/ 'etb'（必ず出す）/ 'combat'（相手の攻撃中）/ 'end'（相手の終了ステップ）
  function chooseTarget(fx, x, mode, sourceIid) {
    const t = fx.target;
    if (!t || t.auto) return undefined;
    const n = fx.n === 'X' ? x : fx.n;
    const theirs = humanBf().filter((c) => t.kind !== 'player' && R.matches(c, t.filter) && t.filter?.side !== 'me' && !hexproof(c));
    const mine = bf().filter((c) => t.kind !== 'player' && R.matches(c, t.filter) && t.filter?.side !== 'opp' && c.iid !== sourceIid);
    const best = (list) => [...list].sort((a, b) => value(b) - value(a))[0];
    const opp = (c) => ({ side: 'opp', iid: c.iid });
    const face = t.kind !== 'card' && (t.players ?? ['me', 'opp']).includes('opp') ? { side: 'opp', player: true } : null;
    switch (fx.type) {
      case 'damage': {
        if (face && human && human.life <= n) return face;
        const killable = theirs.filter((c) => {
          const v = R.pt(c);
          return R.isCreature(c) && v && !R.hasKw(c, 'indestructible') && v.t - (c.damage || 0) <= n;
        });
        // 相手の攻撃中は攻撃クリーチャーを優先
        const pref = mode === 'combat' ? killable.filter((c) => c.attacking) : killable;
        const target = best(pref.length ? pref : killable);
        if (target && (value(target) >= 2.5 || !face || mode === 'etb')) return opp(target);
        if (mode === 'combat') return null;
        return face ?? (mode === 'etb' && theirs.length ? opp(best(theirs)) : null);
      }
      case 'destroy':
      case 'exile': {
        const pref = mode === 'combat' ? theirs.filter((c) => c.attacking) : theirs;
        const target = best(pref.filter((c) => !(fx.type === 'destroy' && R.hasKw(c, 'indestructible'))));
        return target ? opp(target) : null;
      }
      case 'bounce': {
        const target = theirs.find((c) => c.token) ?? best(theirs.filter((c) => !c.isLand));
        return target && (target.token || value(target) >= 3 || mode === 'etb') ? opp(target) : null;
      }
      case 'tap': {
        if (mode !== 'main' && mode !== 'etb') return null;
        const target = best(theirs.filter((c) => !c.tapped && R.isCreature(c)));
        return target ? opp(target) : null;
      }
      case 'pump':
      case 'counters': {
        if (mode === 'main' && fx.type === 'pump') return null; // 修整は戦闘で使う（今は使わない）
        const target = best(mine.filter((c) => R.isCreature(c)));
        return target ? { side: 'me', iid: target.iid } : null;
      }
      case 'lose':
        return face ?? null;
      default:
        return null;
    }
  }

  // 対象を取らない効果の価値（使うかどうか）
  function worth(fx, x) {
    const n = fx.n === 'X' ? x : fx.n;
    switch (fx.type) {
      case 'destroyAll':
      case 'bounceAll': {
        const score = (list) => list.filter((c) => R.matches(c, fx.filter) && !R.hasKw(c, 'indestructible')).reduce((s, c) => s + value(c), 0);
        return score(humanBf()) - score(bf()) >= 4;
      }
      case 'damageAll': {
        const kills = (list) => list.filter((c) => {
          const v = R.pt(c);
          return R.isCreature(c) && v && R.matchesKw(c, fx.filter) && v.t - (c.damage || 0) <= n && !R.hasKw(c, 'indestructible');
        }).reduce((s, c) => s + value(c), 0);
        const selfHit = fx.players.includes('me') ? n : 0;
        return kills(fx.filter.side === 'opp' ? [] : humanBf()) - kills(fx.filter.side === 'opp' ? [] : bf()) >= 3 && g.life - selfHit > 3;
      }
      case 'damagePlayers': return !fx.players.includes('me') || g.life - n > 5 || (human && human.life <= n);
      case 'pumpAll': return false;
      case 'discard': return (human?.hand ?? 0) > 0;
      default: return true;
    }
  }

  // 唱える候補 → { card, pay, x, effects, chosen, score }（よい候補がなければ null）
  function planFor(c, mode) {
    if (c.isLand) return null;
    const instant = R.isType(c, 'Instant') || R.hasKw(c, 'flash');
    if ((mode === 'combat' || mode === 'end') && !instant) return null;
    if (/\b(Aura|Equipment|Planeswalker|Saga)\b/.test(c.typeLine ?? '')) return null;
    const fx = R.parse(c);
    const permanent = R.isPermanentCard(c);
    if (!permanent && !fx.spell.length) return null;
    const cost = R.parseCost(c.manaCost, c.cmc);
    const src = sources();
    const x = cost.x ? R.maxX(src, cost) : 0;
    if (cost.x && x < 1) return null;
    const pay = R.findPayment(src, cost, x);
    if (!pay) return null;
    const effects = permanent ? fx.etb : fx.spell;
    const chosen = [];
    for (const f of effects) {
      const t = chooseTarget(f, x, permanent ? 'etb' : mode, c.iid);
      if (t === null && !permanent) return null;
      if (t === undefined && !permanent && !worth(f, x)) return null;
      chosen.push(t ?? null);
    }
    // 重いもの・クリーチャーを優先（マナを無駄にしない）
    const score = R.costTotal(cost, x) * 10 + (R.isCreature(c) ? 5 : 0) + (permanent ? 0 : 3);
    return { card: c, pay, x, effects, chosen, score };
  }

  function bestPlan(mode) {
    let best = null;
    for (const c of cardsIn('hand')) {
      const p = planFor(c, mode);
      if (p && (!best || p.score > best.score)) best = p;
    }
    return best;
  }

  function cast(plan) {
    const { card: c, pay, x, effects, chosen } = plan;
    for (const iid of pay) g.cards[iid].tapped = true;
    const permanent = R.isPermanentCard(c);
    log(`${c.name}を唱えた${x ? `（X=${x}）` : ''}`);
    window.Sound?.play(permanent ? ({ artifact: 'artifact', enchantment: 'enchant' }[c.kind] ?? 'summon') : c.kind === 'instant' ? 'instant' : 'sorcery');
    if (permanent) move(c.iid, 'battlefield');
    else g.zones.hand = g.zones.hand.filter((i) => i !== c.iid);
    resolve(c, effects, chosen, x);
    if (!permanent) g.zones.graveyard.push(c.iid);
    sba();
  }

  // 効果を解決：自分への操作はここで、相手（人）への操作は effect メッセージで送る
  function resolve(c, effects, chosen, x) {
    const remote = [];
    effects.forEach((fx, i) => {
      if (R.needsTarget(fx) && !chosen[i]) return;
      for (const { side, op } of R.opsFor(fx, chosen[i], { x, sourceIid: c.iid })) {
        if (side === 'me') R.applyOp(g, op, hooks(c.name), c.name);
        else remote.push(op);
      }
    });
    if (remote.length) send({ type: 'effect', matchId: g.matchId, source: c.name, ops: remote });
  }

  function playLand() {
    if (g.landsPlayed >= 1) return false;
    const lands = cardsIn('hand').filter((c) => c.isLand);
    if (!lands.length) return false;
    const have = new Set(bf().flatMap((c) => R.manaOf(c) ?? []));
    const need = new Set(cardsIn('hand').filter((c) => !c.isLand).flatMap((c) => R.colorsOf(c)));
    const score = (c) => (R.manaOf(c) ?? []).filter((x) => need.has(x) && !have.has(x)).length * 2
      + (R.manaOf(c) ?? []).length - (R.parse(c).entersTapped ? 1 : 0);
    const land = lands.sort((a, b) => score(b) - score(a))[0];
    move(land.iid, 'battlefield');
    g.landsPlayed++;
    log(`${land.name}：手札 → 戦場`);
    window.Sound?.play(window.Sound?.landName?.(R.manaOf(land) ?? []) ?? 'summon');
    return true;
  }

  async function playMain(mode) {
    const mid = g.matchId;
    if (playLand()) { sync(); await sleep(ACT_MS); }
    for (let i = 0; i < 12 && g?.matchId === mid && !g.result; i++) {
      const plan = bestPlan(mode);
      if (!plan) break;
      cast(plan);
      sync();
      await sleep(ACT_MS);
    }
  }

  // ---------- 攻撃 ----------

  function chooseAttackers() {
    const mine = bf().filter((c) => R.isCreature(c) && !c.tapped && !isSick(c) && !R.hasKw(c, 'defender') && (R.pt(c)?.p ?? 0) > 0);
    const blockers = humanBf().filter((c) => R.isCreature(c) && !c.tapped);
    const lifeLeft = human?.life ?? 20;
    // 全員で攻撃すれば勝てるか（ブロックされる分は強い方から引く）
    const powers = mine.map((c) => R.pt(c).p).sort((a, b) => b - a);
    if (powers.slice(blockers.length).reduce((s, p) => s + p, 0) >= lifeLeft) return mine;
    let attackers = mine.filter((a) => {
      for (const b of blockers.filter((x) => R.canBlock(a, x))) {
        const r = R.combat([a], [{ card: b, attacker: a.iid }]);
        const aDies = !r.units[0].alive;
        const bDies = !r.units[1].alive;
        if (aDies && !bDies) return false;
        if (aDies && bDies && value(b) < value(a) - 0.5) return false;
      }
      return true;
    });
    // 返しのターンに負けそうなら、警戒のないクリーチャーは守りに残す
    const crack = humanBf().filter((c) => R.isCreature(c)).reduce((s, c) => s + Math.max(0, R.pt(c)?.p ?? 0), 0);
    if (crack >= g.life) attackers = attackers.filter((c) => R.hasKw(c, 'vigilance'));
    return attackers;
  }

  async function doCombat() {
    const attackers = bf().filter((c) => c.attacking);
    if (!attackers.length) return;
    const blocks = humanBf().filter((b) => b.block != null).map((b) => ({ card: b, attacker: b.block }));
    const r = R.combat(attackers, blocks);
    for (const u of r.units) {
      if (u.side !== 'me' || zoneOf(u.card.iid) !== 'battlefield') continue;
      if (!u.alive) { move(u.card.iid, 'graveyard'); log(`${u.name}：戦場 → 墓地`); }
      else if (u.dmg) g.cards[u.card.iid].damage = u.dmg;
    }
    if (r.gain.me) setLife(g.life + r.gain.me);
    log(`戦闘ダメージ：相手に${r.toOpp}点`);
    send({
      type: 'combat', matchId: g.matchId, damage: r.toOpp, gain: r.gain.opp,
      creatures: r.units.filter((u) => u.side === 'opp').map((u) => ({ iid: u.card.iid, damage: u.dmg, dead: !u.alive })),
    });
    for (const c of bf()) c.attacking = false;
  }

  // ---------- ブロック（人の攻撃） ----------

  function chooseBlocks() {
    g.blocks = {};
    const attackers = humanBf().filter((c) => c.attacking).sort((a, b) => (R.pt(b)?.p ?? 0) - (R.pt(a)?.p ?? 0));
    const avail = bf().filter((c) => R.isCreature(c) && !c.tapped);
    const used = new Set();
    const unblocked = [];
    for (const a of attackers) {
      if (R.hasKw(a, 'menace')) { unblocked.push(a); continue; }
      let best = null;
      let bestScore = -Infinity;
      for (const b of avail) {
        if (used.has(b.iid) || !R.canBlock(a, b)) continue;
        const r = R.combat([a], [{ card: b, attacker: a.iid }]);
        const aDies = !r.units[0].alive;
        const bDies = !r.units[1].alive;
        let score = -Infinity;
        if (aDies && !bDies) score = 100 + value(a);
        else if (!bDies) score = 50 - value(b);
        else if (aDies && value(a) >= value(b)) score = 10 + value(a) - value(b);
        if (score > bestScore) { best = b; bestScore = score; }
      }
      if (best) { g.blocks[best.iid] = a.iid; used.add(best.iid); }
      else unblocked.push(a);
    }
    // このままだと負ける：小さいクリーチャーで大きい攻撃を止める（チャンプ・ブロック）
    let incoming = unblocked.reduce((s, a) => s + Math.max(0, R.pt(a)?.p ?? 0), 0);
    for (const a of unblocked) {
      if (incoming < g.life) break;
      if (R.hasKw(a, 'menace')) continue;
      const b = avail.filter((x) => !used.has(x.iid) && R.canBlock(a, x)).sort((x, y) => value(x) - value(y))[0];
      if (!b) continue;
      g.blocks[b.iid] = a.iid;
      used.add(b.iid);
      if (!R.hasKw(a, 'trample')) incoming -= Math.max(0, R.pt(a)?.p ?? 0);
    }
    for (const [b, a] of Object.entries(g.blocks)) {
      log(`${g.cards[b].name}で${humanBf().find((c) => c.iid === a)?.name ?? ''}をブロック`);
    }
  }

  // ---------- ターンの進行 ----------

  function startTurn() {
    endOfTurn(); // 相手のターンが終わった
    g.turn++;
    g.waiting = false;
    g.landsPlayed = 0;
    g.blocks = {};
    for (const c of bf()) c.tapped = false;
    g.phase = 'upkeep';
    log(`ターン${g.turn}開始`);
    sync();
    run();
  }

  // 人に「次へ進んでよいか」を聞く（人が OK を押すと進む）
  function ask(from, to, end = false) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      pending = { id, resolve };
      send({ type: 'priority', id, from, to, end });
    });
  }

  async function step() {
    const mid = g.matchId;
    switch (g.phase) {
      case 'upkeep':
        await sleep(STEP_MS);
        g.phase = 'draw';
        if (!(g.turn === 1 && !g.onDraw)) draw(1);
        sync();
        return true;
      case 'draw':
        await sleep(STEP_MS);
        g.phase = 'main1';
        sync();
        return true;
      case 'main1': {
        await sleep(STEP_MS);
        await playMain('main');
        if (g?.matchId !== mid || g.result) return false;
        const attackers = chooseAttackers();
        if (attackers.length) {
          g.phase = 'attack';
          for (const c of attackers) {
            c.attacking = true;
            if (!R.hasKw(c, 'vigilance')) c.tapped = true;
            log(`${c.name}で攻撃`);
          }
          window.Sound?.play('attack');
        } else {
          g.phase = 'main2';
        }
        sync();
        return true;
      }
      case 'attack': {
        // 人がブロックを指定して OK を押すまで待つ
        if (!(await ask('attack', 'damage'))) return false;
        if (g?.matchId !== mid) return false;
        g.phase = 'damage';
        await doCombat();
        sba();
        g.phase = 'main2';
        sync();
        await sleep(ACT_MS);
        return true;
      }
      case 'main2':
        await playMain('main2');
        if (g?.matchId !== mid || g.result) return false;
        g.phase = 'end';
        sync();
        return true;
      case 'end': {
        if (!(await ask('end', 'cleanup', true))) return false;
        if (g?.matchId !== mid) return false;
        g.phase = 'cleanup';
        const over = g.zones.hand.length - MAX_HAND;
        if (over > 0) discard(over);
        endOfTurn();
        g.waiting = true;
        log('ターン終了（相手のターンへ）');
        sync();
        send({ type: 'pass', matchId: g.matchId });
        return false;
      }
      default:
        return false;
    }
  }

  async function run() {
    if (running || !g) return;
    running = true;
    try {
      while (g && started && !g.waiting && !g.result && !human?.result) {
        const mid = g.matchId;
        const go = await step();
        if (!go || !g || g.matchId !== mid) break;
      }
    } finally {
      running = false;
    }
  }

  // 1ターン目：CPU が先手なら、人がキープしたら始める
  function maybeStartFirstTurn() {
    if (!g || g.turn !== 0 || g.onDraw || !human) return;
    if (['mulligan', 'keep'].includes(human.phase) && !human.turn) return;
    startTurn();
  }

  // ---------- 人の行動への反応 ----------

  // 人が次のステップへ進もうとしている：攻撃ならブロックを決め、インスタントを使ってから OK
  async function onPriority(msg) {
    const mid = g?.matchId;
    await sleep(150);
    if (!g || g.matchId !== mid) return;
    if (msg.from === 'attack' && humanBf().some((c) => c.attacking)) {
      chooseBlocks();
      sync();
      await instantWindow('combat');
    } else if (msg.from === 'end' || msg.end) {
      await instantWindow('end');
    }
    send({ type: 'state', state: snapshot() });
    send({ type: 'priorityOk', id: msg.id });
  }

  async function instantWindow(mode) {
    for (let i = 0; i < 4; i++) {
      const plan = bestPlan(mode);
      if (!plan) return;
      cast(plan);
      sync();
      await sleep(ACT_MS);
    }
  }

  function onCombat(msg) {
    if (msg.matchId && msg.matchId !== g.matchId) return;
    for (const x of msg.creatures ?? []) {
      if (zoneOf(x.iid) !== 'battlefield') continue;
      if (x.dead) { log(`${g.cards[x.iid].name}：戦場 → 墓地`); move(x.iid, 'graveyard'); }
      else if (x.damage) g.cards[x.iid].damage = x.damage;
    }
    if (msg.damage) log(`相手の攻撃で${msg.damage}点のダメージ`);
    const life = g.life - (msg.damage || 0) + (msg.gain || 0);
    if (life !== g.life) setLife(life);
    g.blocks = {};
    sync();
  }

  function onEffect(msg) {
    if (msg.matchId && msg.matchId !== g.matchId) return;
    for (const op of msg.ops ?? []) R.applyOp(g, op, hooks(msg.source), `相手の${msg.source}`);
    sba();
    sync();
  }

  function receive(msg) {
    switch (msg.type) {
      case 'hello':
        send({ type: 'hello', name: NAME, avatar, hostOnDraw: null, matchId: null, needOrder: !g });
        // 人が新しいゲームを始めた：先手後手は人の逆
        if (deck && msg.hostOnDraw != null && msg.matchId && msg.matchId !== g?.matchId) {
          pending?.resolve(false);
          pending = null;
          newGame(!msg.hostOnDraw, msg.matchId);
        } else if (g) sync();
        break;
      case 'state':
        human = msg.state;
        if (!g) break;
        save();
        maybeStartFirstTurn();
        break;
      case 'pass':
        if (!g || (msg.matchId && msg.matchId !== g.matchId) || !g.waiting) break;
        startTurn();
        break;
      case 'priority':
        if (g) onPriority(msg);
        break;
      case 'priorityOk':
        if (pending?.id === msg.id) {
          const p = pending;
          pending = null;
          p.resolve(true);
        }
        break;
      case 'combat':
        if (g) onCombat(msg);
        break;
      case 'effect':
        if (g) onEffect(msg);
        break;
      default:
        break;
    }
  }

  return {
    // play.js から：使うデッキとカードの作り方を設定
    setup({ deck: d, cardFrom, fresh = false }) {
      makeCard = cardFrom;
      if (fresh) clear();
      if (d) deck = d;
      else restore();
    },
    connect(fn) {
      send = fn;
      started = true;
      // 再読み込み：途中だった自分のターンを続ける
      if (g && !g.waiting) setTimeout(run, 300);
    },
    disconnect() {
      started = false;
      pending?.resolve(false);
      pending = null;
    },
    receive,
    clear,
    get deckName() { return deck?.name ?? null; },
  };
})();
