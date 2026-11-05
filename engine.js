// Magic: The Gathering System — ルールエンジン（2人対戦）
// 2人分のゲームを1つの状態 G に持ち、行動（action）を受け付けてルールどおりに進める。
//   ・ターンの進行（ステップ）と優先権、スタック（呪文・起動型能力・誘発型能力）と解決
//   ・マナの支払い（マナ・プールと、土地・マナ能力の自動タップ）
//   ・戦闘（攻撃・ブロックの制限、先制攻撃、トランプル、接死、絆魂、霧）
//   ・状況起因処理、継続的効果（ロード・オーラ・装備品・「このターン」の修整・カウンター）
//   ・打ち消し（「〜を支払わないかぎり」を含む）、再生、エコー、サイクリング、フラッシュバック、装備
// G は JSON にそのまま保存できる（関数・Set を入れない）。カードの定義は cardtext.js、判断は ai.js。
//
// 使い方:
//   const G = Engine.create({ players: [{ name, deck }, { name, deck }], first: 0, seed })
//   Engine.needs(G)               → { player, type }（いま行動するプレイヤーと、何を決めるか）
//   Engine.perform(G, p, action)  → { ok, error }（行動して、次に誰かが決めるところまで進める）

const Engine = (() => {
  const R = () => Rules;
  const T = () => CardText;

  const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'begincombat', 'attackers', 'blockers', 'firststrike', 'damage', 'endcombat', 'main2', 'end', 'cleanup'];
  const STEP_NAMES = {
    untap: 'アンタップ', upkeep: 'アップキープ', draw: 'ドロー', main1: 'メイン1', begincombat: '戦闘開始', attackers: '攻撃',
    blockers: 'ブロック', firststrike: '先制攻撃ダメージ', damage: 'ダメージ', endcombat: '戦闘終了', main2: 'メイン2', end: '終了', cleanup: 'クリーンアップ',
  };
  const MAX_HAND = 7;
  const COLOR_WORD = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

  class RuleError extends Error {}
  const fail = (msg) => { throw new RuleError(msg); };

  // ---------- 乱数（保存・再現できるように状態を G に持つ） ----------

  function rand(G) {
    G.rng = (G.rng + 0x6d2b79f5) >>> 0;
    let t = G.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(G, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(G) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- 作成 ----------

  // players: [{ name, deck: [{ card, qty }], life? , view?: (card) => { name, image, text } }]
  function create({ players, first = 0, seed = Math.floor(Math.random() * 2 ** 32), life = 20 }) {
    const G = {
      v: 1, rng: seed >>> 0, nextId: 1, nextSid: 1, turn: 0, active: first, first, step: 'untap', stepBegun: false,
      priority: null, passes: 0, stack: [], objects: {}, battlefield: [], effects: [], triggers: [], choices: [],
      pending: null, combat: null, fog: false, winner: null, log: [], sfx: [], lastPlayer: null,
      players: players.map((p, i) => ({
        index: i, name: p.name, life: p.life ?? life, library: [], hand: [], graveyard: [], exile: [],
        pool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, landsPlayed: 0, mulligans: 0, kept: false, lost: null, drewEmpty: false,
      })),
    };
    players.forEach((p, i) => {
      for (const { card, qty, view } of p.deck) {
        for (let k = 0; k < qty; k++) {
          const id = G.nextId++;
          G.objects[id] = newObject(id, i, card, view ?? p.view?.(card));
          G.players[i].library.push(id);
        }
      }
      shuffle(G, G.players[i].library);
      draw(G, i, 7, { silent: true });
    });
    G.pending = { type: 'mulligan', player: first };
    log(G, null, `ゲーム開始（${G.players[first].name}が先手）`);
    return G;
  }

  function newObject(id, owner, card, view = null) {
    return {
      id, owner, controller: owner, zone: 'library',
      card: { name: view?.name ?? card.displayName ?? card.name, image: view?.image ?? card.image ?? null, text: view?.text ?? card.oracleText ?? '' },
      def: T().compile(card),
      tapped: false, counters: { p1: 0, m1: 0 }, damage: 0, deathtouched: false, since: null, attacking: false, blocking: null,
      attachedTo: null, regen: 0, token: false, echoDue: false, used: {},
    };
  }

  // ---------- 基本の参照 ----------

  const obj = (G, id) => G.objects[id];
  const other = (p) => 1 - p;
  const nameOf = (G, id) => obj(G, id)?.card.name ?? '?';
  const onBf = (G, id) => obj(G, id)?.zone === 'battlefield';
  const bf = (G, p = null) => G.battlefield.filter((id) => p == null || obj(G, id).controller === p);
  const isType = (o, t) => o.def.types.includes(t);
  // サブタイプ（「Goblins」「Elves」のような複数形も）
  const singular = (w) => w.toLowerCase().replace(/ves$/, 'f').replace(/(?<!s)s$/, '');
  const hasSub = (o, w) => o.def.subtypes.some((s) => s.toLowerCase() === w.toLowerCase() || s.toLowerCase() === singular(w));
  const isCreatureObj = (G, id) => isType(obj(G, id), 'creature');
  const log = (G, p, text) => {
    G.log.push({ turn: G.turn, p, text });
    if (G.log.length > 400) G.log.splice(0, G.log.length - 400);
  };
  const sfx = (G, name) => G.sfx.push(name);
  const toNum = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

  // 召喚酔い：コントロールし始めてから、そのプレイヤーのターンが始まっていない
  const isSick = (G, id) => {
    const o = obj(G, id);
    return isType(o, 'creature') && o.since === G.turn && !ch(G, id).kw.has('haste');
  };

  // ---------- 特性（継続的効果を当てた今の値） ----------

  // → { p, t, kw: Set, colors, cantAttack, cantBlock, unblockable, noUntap }
  function ch(G, id) {
    const o = obj(G, id);
    const d = o.def;
    const c = { p: toNum(d.power), t: toNum(d.toughness), hasPT: d.power != null && d.toughness != null, kw: new Set(d.keywords), colors: [...d.colors],
      cantAttack: false, cantBlock: false, unblockable: false, noUntap: false, mustAttack: false };
    if (o.zone !== 'battlefield') return c;
    const add = (s) => {
      c.p += s.p || 0;
      c.t += s.t || 0;
      for (const k of s.kw ?? []) c.kw.add(k);
      for (const f of ['cantAttack', 'cantBlock', 'unblockable', 'noUntap', 'mustAttack']) if (s[f]) c[f] = true;
    };
    for (const s of d.statics) {
      if (s.kind !== 'self') continue;
      if (s.ifControl && !bf(G, o.controller).some((x) => hasSub(obj(G, x), s.ifControl) || obj(G, x).def.name.toLowerCase() === s.ifControl)) continue;
      if (s.ifMyTurn && G.active !== o.controller) continue;
      add(s);
    }
    for (const sid of G.battlefield) {
      const src = obj(G, sid);
      for (const s of src.def.statics) {
        if (s.kind === 'attached' && src.attachedTo === id) add(s);
        if (s.kind === 'lord' && isType(o, 'creature')) {
          if (s.other && sid === id) continue;
          if (s.scope === 'you' && src.controller !== o.controller) continue;
          if (s.word && s.word !== 'all') {
            const cw = Object.entries(COLOR_WORD).find(([, w]) => w === s.word)?.[0];
            if (cw ? !d.colors.includes(cw) : !hasSub(o, s.word) && !(s.word === 'nonblack' && !d.colors.includes('B'))) continue;
          }
          add(s);
        }
      }
    }
    for (const e of G.effects) {
      if (e.id === id) add(e);
    }
    c.p += o.counters.p1 - o.counters.m1;
    c.t += o.counters.p1 - o.counters.m1;
    return c;
  }

  // rules.js の matches に渡すカードの形
  function cv(G, id) {
    const o = obj(G, id);
    const c = ch(G, id);
    return {
      iid: id, name: o.card.name, typeLine: o.def.typeLine, isLand: isType(o, 'land'), isCreature: isType(o, 'creature'), token: o.token,
      colors: c.colors, tapped: o.tapped, attacking: o.attacking, block: o.blocking, keywords: [...c.kw],
      power: c.hasPT ? String(c.p) : null, toughness: c.hasPT ? String(c.t) : null, cmc: o.def.cmc, manaCost: o.def.manaCost,
    };
  }

  const protectedFrom = (G, id, colors) => {
    const kw = ch(G, id).kw;
    return colors.some((x) => kw.has(`protection from ${COLOR_WORD[x]}`));
  };

  // ---------- 領域の移動 ----------

  function zoneList(G, o, zone) {
    if (zone === 'battlefield') return G.battlefield;
    if (zone === 'stack') return null;
    return G.players[o.owner][zone];
  }

  // to: 'hand' | 'library' | 'graveyard' | 'exile' | 'battlefield'
  function move(G, id, to, { bottom = false, controller = null, tapped = false, silent = false } = {}) {
    const o = obj(G, id);
    if (!o) return;
    const from = o.zone;
    const fromList = zoneList(G, o, from);
    if (fromList) {
      const i = fromList.indexOf(id);
      if (i >= 0) fromList.splice(i, 1);
    }
    if (from === 'battlefield') {
      // 戦場を離れる：死亡したときの誘発（最後の情報で）・状態のリセット
      if (to === 'graveyard' && isType(o, 'creature')) queueTrigger(G, id, 'dies');
      removeFromCombat(G, id);
      G.effects = G.effects.filter((e) => e.id !== id);
      Object.assign(o, { tapped: false, damage: 0, deathtouched: false, attachedTo: null, regen: 0, counters: { p1: 0, m1: 0 }, echoDue: false, used: {} });
      o.controller = o.owner;
      if (to === 'graveyard') sfx(G, 'destroy');
      if (to === 'exile') sfx(G, 'exile');
    }
    o.zone = to;
    if (o.token && to !== 'battlefield') {
      delete G.objects[id];
      return;
    }
    if (to === 'battlefield') {
      if (controller != null) o.controller = controller;
      o.since = G.turn;
      o.tapped = tapped || o.def.entersTapped;
      if (o.def.echo) o.echoDue = true;
      G.battlefield.push(id);
      queueTrigger(G, id, 'etb');
    } else if (to === 'library') {
      if (bottom) G.players[o.owner].library.push(id);
      else G.players[o.owner].library.unshift(id);
    } else {
      G.players[o.owner][to].push(id);
    }
    if (!silent && from !== 'stack' && from !== 'library') {
      const Z = { hand: '手札', battlefield: '戦場', graveyard: '墓地', exile: '追放', library: 'ライブラリー' };
      log(G, o.controller, `${o.card.name}：${Z[from] ?? from} → ${Z[to] ?? to}`);
    }
  }

  function removeFromCombat(G, id) {
    const o = obj(G, id);
    if (!o) return;
    o.attacking = false;
    o.blocking = null;
    if (G.combat) {
      delete G.combat.attackers[id];
      for (const [b, a] of Object.entries(G.combat.blocks)) if (Number(b) === id || a === id) delete G.combat.blocks[b];
    }
  }

  function draw(G, p, n = 1, { silent = false } = {}) {
    const pl = G.players[p];
    let k = 0;
    for (; k < n; k++) {
      if (!pl.library.length) { pl.drewEmpty = true; break; }
      const id = pl.library.shift();
      obj(G, id).zone = 'hand';
      pl.hand.push(id);
    }
    if (!silent && k) { log(G, p, `${k}枚引いた`); sfx(G, 'draw'); }
  }

  function setLife(G, p, v) {
    const pl = G.players[p];
    if (v === pl.life) return;
    sfx(G, v < pl.life ? 'lifeloss' : 'lifegain');
    pl.life = v;
    log(G, p, `ライフ ${v}`);
  }

  // 破壊（破壊不能・再生）。→ 墓地に置いたか
  function destroy(G, id, { noRegen = false } = {}) {
    if (!onBf(G, id)) return false;
    const o = obj(G, id);
    if (ch(G, id).kw.has('indestructible')) return false;
    if (o.regen > 0 && !noRegen) {
      o.regen--;
      o.tapped = true;
      o.damage = 0;
      o.deathtouched = false;
      removeFromCombat(G, id);
      log(G, o.controller, `${o.card.name}は再生した`);
      sfx(G, 'regen');
      return false;
    }
    move(G, id, 'graveyard');
    return true;
  }

  function createToken(G, p, spec) {
    const id = G.nextId++;
    const name = `${spec.p}/${spec.t} ${spec.name}`;
    const card = {
      name, typeLine: `Token ${spec.artifact ? 'Artifact ' : ''}Creature — ${spec.name}`, manaCost: '', cmc: 0, oracleText: '',
      power: String(spec.p), toughness: String(spec.t), keywords: spec.kw ?? [], colors: spec.colors ?? [],
    };
    G.objects[id] = newObject(id, p, card);
    G.objects[id].token = true;
    G.objects[id].def.keywords.push(...(spec.kw ?? []).map((k) => k.toLowerCase()));
    G.objects[id].zone = 'none';
    move(G, id, 'battlefield', { controller: p, silent: true });
    log(G, p, `${name}（トークン）を生成`);
    sfx(G, 'summon');
  }

  // ---------- マナ ----------

  // p がマナを出せるもの → [{ id, choices: 色, amount, abilityIndex }]（アンタップ・召喚酔いでない・コストが {T} だけ）
  function manaSources(G, p) {
    const out = [];
    for (const id of bf(G, p)) {
      const o = obj(G, id);
      if (o.tapped) continue;
      if (isType(o, 'creature') && isSick(G, id)) continue;
      o.def.activated.forEach((a, i) => {
        if (!a.mana || !a.cost.tap || a.cost.mana || a.cost.sacSelf || a.cost.life || a.cost.discard || a.cost.sacType) return;
        const m = a.mana;
        out.push({ id, index: i, choices: m.fixed ?? m.choices, amount: m.amount, fixed: !!m.fixed, land: isType(o, 'land') });
      });
    }
    // 1つのものに複数のマナ能力があっても、使えるのは1つ（どれもタップするため）
    const seen = new Map();
    for (const s of out) {
      const cur = seen.get(s.id);
      if (!cur || s.amount > cur.amount || (s.amount === cur.amount && s.choices.length > cur.choices.length)) seen.set(s.id, s);
    }
    return [...seen.values()];
  }

  // コストの支払い方を探す → { pool: { 色: 数 }, tap: [{ id, colors: 使う色 }] }（払えなければ null）
  function planPayment(G, p, costStr, x = 0, { extraGeneric = 0, exclude = null } = {}) {
    const cost = R().parseCost(costStr ?? '', 0);
    const reqs = [];
    for (const k of ['W', 'U', 'B', 'R', 'G', 'C']) for (let i = 0; i < cost[k]; i++) reqs.push([k]);
    for (const h of cost.hybrid) reqs.push(h);
    const generic = cost.generic + cost.x * x + extraGeneric;
    // マナの単位：プールのマナ → 土地 → ほか（1つのものから複数のマナが出るなら、その数だけ）
    const units = [];
    const pool = G.players[p].pool;
    for (const k of Object.keys(pool)) for (let i = 0; i < pool[k]; i++) units.push({ pool: k, colors: [k] });
    const srcs = manaSources(G, p).sort((a, b) => a.choices.length - b.choices.length || Number(b.land) - Number(a.land));
    for (const s of srcs) {
      if (s.fixed) s.choices.forEach((c) => units.push({ src: s, colors: [c] }));
      else for (let i = 0; i < s.amount; i++) units.push({ src: s, colors: s.choices });
    }
    if (reqs.length + generic > units.length) return null;
    reqs.sort((a, b) => units.filter((u) => u.colors.some((c) => a.includes(c))).length - units.filter((u) => u.colors.some((c) => b.includes(c))).length);
    const used = new Array(units.length).fill(null);
    const assign = (i) => {
      if (i === reqs.length) return true;
      for (let u = 0; u < units.length; u++) {
        if (used[u] || !units[u].colors.some((c) => reqs[i].includes(c))) continue;
        used[u] = units[u].colors.find((c) => reqs[i].includes(c));
        if (assign(i + 1)) return true;
        used[u] = null;
      }
      return false;
    };
    if (!assign(0)) return null;
    // 不特定マナ：プール → すでに使うことにしたものの残り → 土地 → ほか
    const tappedSrc = new Set(units.filter((u, i) => used[i] && u.src).map((u) => u.src.id));
    const demand = colorDemand(G, p, exclude);
    const order = units.map((u, i) => i).filter((i) => !used[i])
      .sort((a, b) => rank(units[a], tappedSrc, demand) - rank(units[b], tappedSrc, demand));
    let need = generic;
    for (const i of order) {
      if (!need) break;
      used[i] = units[i].colors[0];
      if (units[i].src) tappedSrc.add(units[i].src.id);
      need--;
    }
    if (need) return null;
    return { units, used };
  }
  // 不特定マナに使う順：プール → タップ済みの残り → 手札・起動型能力でまだ必要な色を出さないもの → 土地を先に
  const rank = (u, tapped, demand) => {
    if (u.pool) return 0;
    if (tapped.has(u.src.id)) return 1;
    const need = Math.min(...u.src.choices.map((c) => demand[c] ?? 0));
    return 2 + need * 2 + (u.src.land ? 0 : 1) + u.src.choices.length / 10;
  };
  // 手札の呪文と、戦場のもののマナ能力以外の起動コストに出てくる色の数
  function colorDemand(G, p, exclude) {
    const d = {};
    const addCost = (cost) => { for (const m of String(cost ?? '').matchAll(/\{([WUBRG])\}/g)) d[m[1]] = (d[m[1]] ?? 0) + 1; };
    for (const id of G.players[p].hand) if (id !== exclude) addCost(obj(G, id).def.manaCost);
    for (const id of bf(G, p)) for (const a of obj(G, id).def.activated) if (!a.mana) addCost(a.cost.mana);
    return d;
  }

  const canPay = (G, p, cost, x = 0) => !!planPayment(G, p, cost, x);

  // 支払う：プールから引き、使うものをタップする。タップしたものから出て使わなかったマナはプールに残る
  function pay(G, p, costStr, x = 0, opts = {}) {
    const plan = planPayment(G, p, costStr, x, opts);
    if (!plan) fail('マナが足りません');
    const pl = G.players[p];
    const { units, used } = plan;
    const tapped = new Map(); // id → { src, produced: [色], spent: 数 }
    units.forEach((u, i) => {
      if (u.pool) { if (used[i]) pl.pool[u.pool]--; return; }
      if (!used[i] && !tapped.has(u.src.id)) return;
      const t = tapped.get(u.src.id) ?? { src: u.src, spent: 0, colors: [] };
      if (used[i]) { t.spent++; t.colors.push(used[i]); }
      tapped.set(u.src.id, t);
    });
    for (const { src, spent, colors } of tapped.values()) {
      obj(G, src.id).tapped = true;
      // 出たマナのうち、使わなかった分
      const produced = src.fixed ? [...src.choices] : Array(src.amount).fill(colors[0] ?? src.choices[0]);
      for (const c of colors) { const k = produced.indexOf(c); if (k >= 0) produced.splice(k, 1); else produced.pop(); }
      void spent;
      for (const c of produced) pl.pool[c]++;
    }
    if (tapped.size) sfx(G, 'tap');
    return plan;
  }

  const emptyPools = (G) => { for (const pl of G.players) for (const k of Object.keys(pl.pool)) pl.pool[k] = 0; };

  // ---------- 対象 ----------

  // 効果の対象の候補 → [{ player } | { obj } | { stack } | { grave }]
  function targetsFor(G, p, spec, srcId = null, srcColors = []) {
    const out = [];
    const rel = (q) => (q === p ? 'me' : 'opp');
    if (spec.kind === 'player' || spec.kind === 'any') {
      for (const q of [0, 1]) if ((spec.players ?? ['me', 'opp']).includes(rel(q))) out.push({ player: q });
    }
    if (spec.kind === 'card' || spec.kind === 'any') {
      for (const id of G.battlefield) if (legalCard(G, p, spec, id, srcId, srcColors)) out.push({ obj: id });
    }
    if (spec.kind === 'spell') {
      for (const s of G.stack) if (s.kind === 'spell' && legalSpell(G, spec, s)) out.push({ stack: s.sid });
    }
    if (spec.kind === 'grave') {
      for (const id of G.players[p].graveyard) if (!spec.filter || R().matches(cvLoose(G, id), spec.filter)) out.push({ grave: id });
    }
    return out;
  }

  // 戦場以外のカード（墓地など）の形
  const cvLoose = (G, id) => {
    const o = obj(G, id);
    return { iid: id, name: o.card.name, typeLine: o.def.typeLine, isLand: isType(o, 'land'), isCreature: isType(o, 'creature'), colors: o.def.colors, keywords: o.def.keywords };
  };

  function legalCard(G, p, spec, id, srcId, srcColors) {
    if (!onBf(G, id)) return false;
    if (id === srcId && spec.notSelf) return false;
    const o = obj(G, id);
    const f = spec.filter;
    if (f?.side === 'me' && o.controller !== p) return false;
    if (f?.side === 'opp' && o.controller === p) return false;
    if (f && !R().matches(cv(G, id), f)) return false;
    const kw = ch(G, id).kw;
    if (kw.has('shroud')) return false;
    if (kw.has('hexproof') && o.controller !== p) return false;
    if (protectedFrom(G, id, srcColors)) return false;
    return true;
  }

  function legalSpell(G, spec, s) {
    const f = spec.filter ?? {};
    const o = obj(G, s.objId);
    if (!o) return false;
    if (f.types?.length && !f.types.some((t) => isType(o, t))) return false;
    if (f.non?.some((t) => isType(o, t))) return false;
    if (f.colors?.length && !f.colors.some((c) => o.def.colors.includes(c))) return false;
    return true;
  }

  function stillLegal(G, item, spec, t) {
    if (!t) return false;
    if (t.player != null) {
      const who = t.player === item.controller ? 'me' : 'opp';
      return !G.players[t.player].lost && (spec.kind === 'player' || spec.kind === 'any') && (spec.players ?? ['me', 'opp']).includes(who);
    }
    if (t.obj != null) return legalCard(G, item.controller, spec, t.obj, item.source, item.colors ?? []);
    if (t.stack != null) { const s = G.stack.find((x) => x.sid === t.stack); return !!s && legalSpell(G, spec, s); }
    if (t.grave != null) return G.players[item.controller].graveyard.includes(t.grave);
    return false;
  }

  // 効果の対象の仕様（対象を取らない効果は null）
  const specOf = (fx) => (fx.target && !fx.target.auto ? fx.target : null);

  // ---------- 誘発型能力 ----------

  function queueTrigger(G, id, event, extra = {}) {
    const o = obj(G, id);
    if (!o) return;
    for (const tr of o.def.triggers) {
      if (tr.event !== event && !(tr.event === 'attacksOrBlocks' && (event === 'attacks' || event === 'blocks'))) continue;
      G.triggers.push({ controller: o.controller, source: id, name: o.card.name, effects: tr.effects, text: tr.text, colors: o.def.colors, optional: tr.optional, ...extra });
    }
  }

  // 待っている誘発をスタックに置く（アクティブ・プレイヤーの分から）。対象を選ぶ必要があれば止める
  function putTriggers(G) {
    G.triggers.sort((a, b) => Number(a.controller !== G.active) - Number(b.controller !== G.active));
    while (G.triggers.length) {
      const tr = G.triggers[0];
      const specs = tr.effects.map(specOf);
      const need = specs.findIndex((s, i) => s && tr.targets?.[i] === undefined);
      if (need >= 0) {
        const cands = targetsFor(G, tr.controller, specs[need], tr.source, tr.colors);
        if (!cands.length) {
          tr.targets = tr.targets ?? [];
          tr.targets[need] = null;
          continue;
        }
        G.pending = { type: 'triggerTarget', player: tr.controller, name: tr.name, text: tr.text, index: need, spec: specs[need], source: tr.source };
        return;
      }
      G.triggers.shift();
      // 対象を取る効果すべてに対象がない誘発は、スタックに置かない
      if (specs.some(Boolean) && specs.every((s, i) => !s || !tr.targets?.[i])) {
        log(G, tr.controller, `${tr.name}の誘発型能力：対象がないので何もしない`);
        continue;
      }
      G.stack.push({ sid: G.nextSid++, kind: 'trigger', controller: tr.controller, source: tr.source, name: tr.name, text: tr.text,
        effects: tr.effects, targets: tr.targets ?? [], x: 0, colors: tr.colors });
      log(G, tr.controller, `${tr.name}の誘発型能力`);
    }
  }

  // ---------- 状況起因処理 ----------

  function sba(G) {
    let changed = false;
    for (const pl of G.players) {
      if (pl.lost) continue;
      if (pl.life <= 0) lose(G, pl.index, 'life');
      else if (pl.drewEmpty) lose(G, pl.index, 'deck');
    }
    if (G.winner != null) return false;
    for (const id of [...G.battlefield]) {
      const o = obj(G, id);
      if (!o || o.zone !== 'battlefield') continue;
      // +1/+1 と -1/-1 カウンターは相殺
      const k = Math.min(o.counters.p1, o.counters.m1);
      if (k) { o.counters.p1 -= k; o.counters.m1 -= k; changed = true; }
      if (isType(o, 'creature')) {
        const c = ch(G, id);
        if (c.hasPT && c.t <= 0) { move(G, id, 'graveyard'); changed = true; continue; }
        if (c.hasPT && (o.damage >= c.t || (o.deathtouched && o.damage > 0))) {
          // 破壊不能なら何も変わらない（同じ判定を繰り返さない）。再生したらダメージが消える
          if (destroy(G, id) || (onBf(G, id) && o.damage === 0)) changed = true;
          continue;
        }
      }
      // オーラ：つけるものがない・つけられない
      if (o.def.enchant) {
        const host = o.attachedTo;
        const spec = o.def.auraTarget;
        if (host == null || !onBf(G, host) || (spec?.filter && !R().matches(cv(G, host), spec.filter)) || protectedFrom(G, host, o.def.colors)) {
          move(G, id, 'graveyard');
          changed = true;
          continue;
        }
      }
      // 装備品：クリーチャーでなくなったら外れる
      if (o.def.equip && o.attachedTo != null && (!onBf(G, o.attachedTo) || !isCreatureObj(G, o.attachedTo))) {
        o.attachedTo = null;
        changed = true;
      }
    }
    // レジェンド・ルール
    for (const p of [0, 1]) {
      const legends = bf(G, p).filter((id) => obj(G, id).def.supertypes.includes('legendary'));
      const byName = new Map();
      for (const id of legends) {
        const n = obj(G, id).def.name;
        if (byName.has(n)) { move(G, byName.get(n), 'graveyard'); changed = true; }
        byName.set(n, id);
      }
    }
    return changed;
  }

  function lose(G, p, reason) {
    const pl = G.players[p];
    if (pl.lost) return;
    pl.lost = reason;
    const text = { life: 'ライフが0になりました', deck: 'ライブラリーが空の状態でカードを引こうとしました', concede: '投了しました' }[reason];
    log(G, p, `敗北：${text}`);
    G.winner = other(p);
    G.pending = null;
    G.priority = null;
  }

  // ---------- ターンの進行 ----------

  const hasFirstStrike = (G) => G.combat && [...Object.keys(G.combat.attackers), ...Object.keys(G.combat.blocks)].some((id) => {
    const kw = onBf(G, Number(id)) ? ch(G, Number(id)).kw : new Set();
    return kw.has('first strike') || kw.has('double strike');
  });

  function givePriority(G) {
    G.priority = G.active;
    G.passes = 0;
  }

  function beginStep(G) {
    G.stepBegun = true;
    const p = G.active;
    switch (G.step) {
      case 'untap': {
        G.players[p].landsPlayed = 0;
        log(G, p, `ターン${G.turn}開始`);
        let any = false;
        for (const id of bf(G, p)) {
          const o = obj(G, id);
          if (o.tapped && !ch(G, id).noUntap) { o.tapped = false; any = true; }
        }
        if (any) sfx(G, 'untap');
        return;
      }
      case 'upkeep':
        for (const id of G.battlefield) {
          const o = obj(G, id);
          if (o.controller === p) queueTrigger(G, id, 'upkeep');
          queueTrigger(G, id, 'eachUpkeep');
          if (o.controller === p && o.echoDue) {
            o.echoDue = false;
            G.choices.push({ type: 'payOrNot', player: p, cost: o.def.echo, reason: `${o.card.name}のエコー`, onDecline: { kind: 'sacrifice', id } });
          }
        }
        return givePriority(G);
      case 'draw':
        if (!(G.turn === 1)) draw(G, p, 1);
        return givePriority(G);
      case 'attackers': {
        const can = bf(G, p).filter((id) => canAttack(G, id));
        if (!can.length) { G.combat = null; return; }
        G.pending = { type: 'attackers', player: p };
        return;
      }
      case 'blockers': {
        if (!G.combat || !Object.keys(G.combat.attackers).length) return;
        const attackers = Object.keys(G.combat.attackers).map(Number);
        // ブロックできるクリーチャーがいなければ聞かない
        if (!bf(G, other(p)).some((b) => attackers.some((a) => canBlock(G, b, a)))) return givePriority(G);
        G.pending = { type: 'blockers', player: other(p) };
        return;
      }
      case 'firststrike':
        if (!G.combat || !hasFirstStrike(G)) return;
        combatDamage(G, true);
        return givePriority(G);
      case 'damage':
        if (!G.combat || !Object.keys(G.combat.attackers).length) return;
        combatDamage(G, false);
        return givePriority(G);
      case 'end':
        for (const id of bf(G, p)) queueTrigger(G, id, 'endstep');
        return givePriority(G);
      case 'cleanup': {
        const over = G.players[p].hand.length - MAX_HAND;
        if (over > 0) G.choices.push({ type: 'discard', player: p, n: over, reason: '手札の上限' });
        return;
      }
      default:
        return givePriority(G);
    }
  }

  function endStep(G) {
    emptyPools(G);
    if (G.step === 'endcombat' || (G.step === 'attackers' && !G.combat)) {
      for (const id of G.battlefield) { obj(G, id).attacking = false; obj(G, id).blocking = null; }
    }
    if (G.step === 'cleanup') {
      for (const id of G.battlefield) { const o = obj(G, id); o.damage = 0; o.deathtouched = false; o.regen = 0; }
      G.effects = G.effects.filter((e) => e.until !== 'eot');
      G.fog = false;
      G.combat = null;
    }
  }

  function nextStep(G) {
    endStep(G);
    let i = STEPS.indexOf(G.step);
    for (;;) {
      i++;
      if (i >= STEPS.length) {
        G.turn++;
        G.active = other(G.active);
        G.step = 'untap';
        sfx(G, 'endturn');
        break;
      }
      const s = STEPS[i];
      // 攻撃しなかったら、ブロック・ダメージのステップは飛ばす
      if (['blockers', 'firststrike', 'damage'].includes(s) && !(G.combat && Object.keys(G.combat.attackers).length)) continue;
      if (s === 'firststrike' && !hasFirstStrike(G)) continue;
      G.step = s;
      break;
    }
    G.stepBegun = false;
    G.priority = null;
    G.passes = 0;
    if (!['untap', 'cleanup'].includes(G.step)) sfx(G, 'phase');
  }

  // 次にだれかが決めるところまで進める
  function run(G) {
    for (let guard = 0; guard < 2000; guard++) {
      if (G.winner != null) return;
      if (sba(G)) continue;
      if (G.winner != null) return;
      if (G.pending) return;
      if (G.choices.length) { startChoice(G); continue; }
      if (G.triggers.length) { putTriggers(G); if (G.pending) return; continue; }
      if (G.priority != null) return;
      if (G.turn === 0) return;
      if (!G.stepBegun) beginStep(G);
      else nextStep(G);
    }
    throw new Error('engine: run did not settle');
  }

  // 解決中などに後回しにした選択（捨てる・支払う）を、プレイヤーに聞く
  function startChoice(G) {
    const c = G.choices.shift();
    if (c.type === 'discard') {
      const n = Math.min(c.n, G.players[c.player].hand.length);
      if (!n) return;
      G.pending = { ...c, n, options: [...G.players[c.player].hand] };
    } else if (c.type === 'payOrNot') {
      if (c.onDecline.kind === 'counter' && !G.stack.some((s) => s.sid === c.onDecline.sid)) return;
      if (c.onDecline.kind === 'sacrifice' && !onBf(G, c.onDecline.id)) return;
      G.pending = { ...c, canPay: canPay(G, c.player, c.cost) };
    } else if (c.type === 'search') {
      const options = G.players[c.player].library.filter((id) => matchSearch(G, id, c.what));
      if (!options.length) { log(G, c.player, '探したが見つからなかった'); shuffle(G, G.players[c.player].library); return; }
      G.pending = { ...c, options };
    }
  }

  const matchSearch = (G, id, what) => (what === 'basicLand' ? isType(obj(G, id), 'land') && obj(G, id).def.supertypes.includes('basic') : true);

  // ---------- 戦闘 ----------

  function canAttack(G, id) {
    const o = obj(G, id);
    if (!onBf(G, id) || !isType(o, 'creature') || o.tapped || o.controller !== G.active) return false;
    const c = ch(G, id);
    if (c.kw.has('defender') || c.cantAttack || isSick(G, id)) return false;
    return true;
  }

  function canBlock(G, blocker, attacker) {
    const b = obj(G, blocker);
    const a = obj(G, attacker);
    if (!onBf(G, blocker) || !isType(b, 'creature') || b.tapped || !a?.attacking) return false;
    if (b.controller === a.controller) return false;
    const bc = ch(G, blocker);
    const ac = ch(G, attacker);
    if (bc.cantBlock || ac.unblockable) return false;
    if (ac.kw.has('flying') && !bc.kw.has('flying') && !bc.kw.has('reach')) return false;
    if (ac.kw.has('shadow') !== bc.kw.has('shadow')) return false;
    if (ac.kw.has('fear') && !isType(b, 'artifact') && !bc.colors.includes('B')) return false;
    if (ac.kw.has('intimidate') && !isType(b, 'artifact') && !bc.colors.some((x) => ac.colors.includes(x))) return false;
    if (protectedFrom(G, attacker, bc.colors)) return false;
    for (const t of ['plains', 'island', 'swamp', 'mountain', 'forest']) {
      if (ac.kw.has(`${t}walk`) && bf(G, b.controller).some((x) => hasSub(obj(G, x), t))) return false;
    }
    return true;
  }

  function declareAttackers(G, p, ids) {
    const uniq = [...new Set(ids.map(Number))];
    for (const id of uniq) if (!canAttack(G, id)) fail(`${nameOf(G, id)}は攻撃できません`);
    G.combat = { attackers: {}, blocks: {}, blocked: {} };
    for (const id of uniq) {
      const o = obj(G, id);
      G.combat.attackers[id] = other(p);
      o.attacking = true;
      if (!ch(G, id).kw.has('vigilance')) o.tapped = true;
      log(G, p, `${o.card.name}で攻撃`);
    }
    if (uniq.length) sfx(G, 'attack');
    else { G.combat = null; log(G, p, '攻撃しない'); }
    for (const id of uniq) queueTrigger(G, id, 'attacks');
  }

  function declareBlockers(G, p, blocks) {
    const pairs = Object.entries(blocks ?? {}).map(([b, a]) => [Number(b), Number(a)]);
    for (const [b, a] of pairs) {
      if (obj(G, b)?.controller !== p) fail('自分のクリーチャーでブロックしてください');
      if (!canBlock(G, b, a)) fail(`${nameOf(G, b)}は${nameOf(G, a)}をブロックできません`);
    }
    for (const a of Object.keys(G.combat.attackers).map(Number)) {
      const n = pairs.filter(([, x]) => x === a).length;
      if (n === 1 && ch(G, a).kw.has('menace')) fail(`${nameOf(G, a)}は威迫を持っています（2体以上でブロック）`);
    }
    for (const [b, a] of pairs) {
      G.combat.blocks[b] = a;
      G.combat.blocked[a] = true;
      obj(G, b).blocking = a;
      log(G, p, `${nameOf(G, b)}で${nameOf(G, a)}をブロック`);
      queueTrigger(G, b, 'blocks');
    }
    for (const a of new Set(pairs.map(([, x]) => x))) queueTrigger(G, a, 'becomesBlocked');
    if (!pairs.length) log(G, p, 'ブロックしない');
  }

  // 戦闘ダメージ（first: 先制攻撃のステップ）
  function combatDamage(G, first) {
    const c = G.combat;
    // 先制攻撃は最初のステップだけ、二段攻撃は両方、ほかは通常のステップだけ
    const deals = (id) => {
      if (!onBf(G, id)) return false;
      const kw = ch(G, id).kw;
      const fs = kw.has('first strike');
      const ds = kw.has('double strike');
      return first ? fs || ds : !fs || ds;
    };
    const events = []; // { to: { player } | { obj }, n, src }
    for (const a of Object.keys(c.attackers).map(Number)) {
      if (!deals(a)) continue;
      const ac = ch(G, a);
      if (ac.p <= 0) continue;
      const blockers = Object.entries(c.blocks).filter(([, x]) => x === a).map(([b]) => Number(b)).filter((b) => onBf(G, b));
      if (!c.blocked[a]) { events.push({ to: { player: c.attackers[a] }, n: ac.p, src: a }); continue; }
      if (!blockers.length) {
        if (ac.kw.has('trample')) events.push({ to: { player: c.attackers[a] }, n: ac.p, src: a });
        continue;
      }
      let rest = ac.p;
      blockers.forEach((b, i) => {
        const bc = ch(G, b);
        const lethal = ac.kw.has('deathtouch') ? 1 : Math.max(0, bc.t - obj(G, b).damage);
        const amount = i === blockers.length - 1 && !ac.kw.has('trample') ? rest : Math.min(rest, lethal);
        if (amount > 0) events.push({ to: { obj: b }, n: amount, src: a });
        rest -= amount;
      });
      if (rest > 0 && ac.kw.has('trample')) events.push({ to: { player: c.attackers[a] }, n: rest, src: a });
    }
    for (const [b, a] of Object.entries(c.blocks)) {
      const bid = Number(b);
      if (!deals(bid) || !onBf(G, a)) continue;
      const p = ch(G, bid).p;
      if (p > 0) events.push({ to: { obj: a }, n: p, src: bid });
    }
    if (G.fog) {
      if (events.length) log(G, null, '戦闘ダメージはすべて軽減された');
      return;
    }
    let total = [0, 0];
    for (const e of events) {
      const src = obj(G, e.src);
      const sc = ch(G, e.src);
      if (e.to.obj != null && protectedFrom(G, e.to.obj, sc.colors)) continue;
      if (e.to.player != null) {
        G.players[e.to.player].life -= e.n;
        total[e.to.player] += e.n;
        queueTrigger(G, e.src, 'combatDamagePlayer');
      } else {
        const t = obj(G, e.to.obj);
        t.damage += e.n;
        if (sc.kw.has('deathtouch')) t.deathtouched = true;
      }
      if (sc.kw.has('lifelink')) G.players[src.controller].life += e.n;
    }
    for (const q of [0, 1]) if (total[q]) { log(G, q, `戦闘で${total[q]}点のダメージを受けた（ライフ ${G.players[q].life}）`); sfx(G, 'lifeloss'); }
  }

  // ---------- 呪文・能力 ----------

  const isInstantSpeed = (o) => isType(o, 'instant') || o.def.keywords.includes('flash');
  const sorceryTiming = (G, p) => G.active === p && ['main1', 'main2'].includes(G.step) && !G.stack.length && G.priority === p;

  // 唱えられるか → { ok, reason, specs: 対象の仕様の配列, x: X があるか, cost, from }
  function castInfo(G, p, id, { flashback = false } = {}) {
    const o = obj(G, id);
    if (!o || o.owner !== p) return { ok: false, reason: '自分のカードではありません' };
    const from = o.zone;
    if (from !== 'hand' && !(from === 'graveyard' && o.def.flashback)) return { ok: false, reason: '手札にありません' };
    if (from === 'graveyard') flashback = true;
    if (isType(o, 'land')) return { ok: false, reason: '土地は唱えられません' };
    if (G.priority !== p) return { ok: false, reason: '優先権がありません' };
    if (!isInstantSpeed(o) && !sorceryTiming(G, p)) return { ok: false, reason: `${o.card.name}は自分のメイン・フェイズ（スタックが空のとき）にしか唱えられません` };
    const cost = flashback ? o.def.flashback : o.def.manaCost ?? `{${o.def.cmc}}`;
    const x = /\{X\}/.test(cost ?? '');
    const specs = spellSpecs(o);
    const srcColors = o.def.colors;
    for (const s of specs) if (s && !s.optional && !targetsFor(G, p, s, null, srcColors).length) return { ok: false, reason: `${o.card.name}の対象がありません` };
    if (!canPay(G, p, cost, 0)) return { ok: false, reason: `マナが足りません（${cost || '0'}）`, specs, x, cost, from };
    return { ok: true, specs, x, cost, from, maxX: x ? maxX(G, p, cost) : 0, flashback };
  }

  // 呪文の対象（オーラはつけるもの）
  function spellSpecs(o) {
    if (o.def.enchant) return [o.def.auraTarget];
    if (isType(o, 'instant') || isType(o, 'sorcery')) return o.def.spell.map(specOf);
    return [];
  }

  function maxX(G, p, cost) {
    let x = 0;
    while (x < 30 && canPay(G, p, cost, x + 1)) x++;
    return x;
  }

  function checkTargets(G, p, specs, targets, srcId, srcColors) {
    specs.forEach((s, i) => {
      if (!s) return;
      const t = targets?.[i];
      if (!t) fail('対象を選んでください');
      const ok = targetsFor(G, p, s, srcId, srcColors).some((c) => sameTarget(c, t));
      if (!ok) fail('その対象は選べません');
    });
  }
  const sameTarget = (a, b) => a.player === b.player && a.obj === b.obj && a.stack === b.stack && a.grave === b.grave;

  function cast(G, p, { id, targets = [], x = 0, flashback = false }) {
    const info = castInfo(G, p, id, { flashback });
    if (!info.ok) fail(info.reason);
    const o = obj(G, id);
    x = info.x ? Math.max(0, Math.min(Number(x) || 0, info.maxX)) : 0;
    checkTargets(G, p, info.specs, targets, null, o.def.colors);
    pay(G, p, info.cost, x, { exclude: id });
    const list = zoneList(G, o, o.zone);
    list.splice(list.indexOf(id), 1);
    o.zone = 'stack';
    G.stack.push({ sid: G.nextSid++, kind: 'spell', controller: p, objId: id, source: id, name: o.card.name, effects: spellEffects(o),
      targets, x, colors: o.def.colors, flashback: info.flashback });
    log(G, p, `${o.card.name}を唱えた${x ? `（X=${x}）` : ''}${info.flashback ? '（フラッシュバック）' : ''}${targetText(G, targets)}`);
    sfx(G, isType(o, 'instant') ? 'instant' : isType(o, 'sorcery') ? 'sorcery' : 'button');
    if (o.def.manual.length) log(G, p, `${o.card.name}：読み取れない効果は手動で処理してください`);
  }

  const spellEffects = (o) => (isType(o, 'instant') || isType(o, 'sorcery') ? o.def.spell : []);

  function targetText(G, targets) {
    const names = (targets ?? []).filter(Boolean).map((t) => (t.player != null ? G.players[t.player].name : t.obj != null ? nameOf(G, t.obj)
      : t.stack != null ? G.stack.find((s) => s.sid === t.stack)?.name ?? '?' : nameOf(G, t.grave)));
    return names.length ? `（対象：${names.join('、')}）` : '';
  }

  // 起動型能力の一覧 → [{ index, text, ok, reason, specs, mana }]
  function activations(G, p, id) {
    const o = obj(G, id);
    if (!o) return [];
    return o.def.activated.map((a, index) => {
      const r = activationInfo(G, p, id, index);
      return { index, text: a.text, mana: !!a.mana, cycling: !!a.cycling, ...r };
    });
  }

  function activationInfo(G, p, id, index) {
    const o = obj(G, id);
    const a = o?.def.activated[index];
    if (!a) return { ok: false, reason: '能力がありません' };
    if (a.fromHand ? !(o.zone === 'hand' && o.owner === p) : !(onBf(G, id) && o.controller === p)) return { ok: false, reason: a.fromHand ? '手札から起動します' : '戦場にありません' };
    if (G.priority !== p && !(a.mana && G.pending?.player === p)) return { ok: false, reason: '優先権がありません' };
    if ((a.sorcery || a.text.startsWith('Equip')) && !sorceryTiming(G, p)) return { ok: false, reason: 'ソーサリーを唱えられるときだけ起動できます' };
    if (a.once && o.used[index] === G.turn) return { ok: false, reason: 'このターンはもう起動しました' };
    const c = a.cost;
    if (c.tap && (o.tapped || (isType(o, 'creature') && isSick(G, id)))) return { ok: false, reason: o.tapped ? 'タップしています' : '召喚酔いです' };
    if (c.life && G.players[p].life < c.life) return { ok: false, reason: 'ライフが足りません' };
    if (c.discard && G.players[p].hand.filter((h) => h !== id).length < c.discard) return { ok: false, reason: '捨てるカードがありません' };
    if (c.removeCounter && o.counters.p1 < c.removeCounter) return { ok: false, reason: 'カウンターがありません' };
    if (c.sacType && !sacOptions(G, p, c.sacType).length) return { ok: false, reason: '生け贄に捧げるものがありません' };
    const specs = a.effects.map((f) => (f.type === 'equip' ? { ...f.target, notSelf: true } : specOf(f)));
    for (const s of specs) if (s && !targetsFor(G, p, s, id, o.def.colors).length) return { ok: false, reason: '対象がありません' };
    // マナ能力のコストを払うためにそのものをタップする場合（{T} を含む）は、そのもの以外で払う
    if (c.mana && !canPayExcluding(G, p, c.mana, c.tap ? id : null)) return { ok: false, reason: `マナが足りません（${c.mana}）` };
    const x = /\{X\}/.test(c.mana);
    return { ok: true, specs, x, maxX: x ? maxX(G, p, c.mana) : 0 };
  }

  function canPayExcluding(G, p, cost, id) {
    if (id == null) return canPay(G, p, cost);
    const o = obj(G, id);
    const was = o.tapped;
    o.tapped = true;
    const ok = canPay(G, p, cost);
    o.tapped = was;
    return ok;
  }

  const sacOptions = (G, p, type) => bf(G, p).filter((x) => isType(obj(G, x), type) || hasSub(obj(G, x), type));

  function activate(G, p, { id, index, targets = [], x = 0, sacrifice = null, discard = null, color = null }) {
    const info = activationInfo(G, p, id, index);
    if (!info.ok) fail(info.reason);
    const o = obj(G, id);
    const a = o.def.activated[index];
    const c = a.cost;
    checkTargets(G, p, info.specs, targets, id, o.def.colors);
    x = info.x ? Math.max(0, Math.min(Number(x) || 0, info.maxX)) : 0;
    // コスト
    if (c.tap) o.tapped = true;
    if (c.mana) {
      if (c.tap) { o.tapped = true; pay(G, p, c.mana, x); }
      else pay(G, p, c.mana, x);
    }
    if (c.life) setLife(G, p, G.players[p].life - c.life);
    if (c.removeCounter) o.counters.p1 -= c.removeCounter;
    if (c.discard) {
      const d = discard ?? G.players[p].hand.find((h) => h !== id);
      if (!G.players[p].hand.includes(d) || d === id) fail('捨てるカードを選んでください');
      move(G, d, 'graveyard');
    }
    if (c.sacType) {
      const s = sacrifice ?? sacOptions(G, p, c.sacType)[0];
      if (!sacOptions(G, p, c.sacType).includes(s)) fail('生け贄に捧げるものを選んでください');
      move(G, s, 'graveyard');
    }
    const lki = { name: o.card.name, colors: o.def.colors };
    if (c.sacSelf) move(G, id, 'graveyard');
    if (c.discardSelf) move(G, id, 'graveyard', { silent: true });
    o.used[index] = G.turn;
    if (a.cycling) log(G, p, `${o.card.name}をサイクリングした`);
    // マナ能力はスタックを使わない
    if (a.mana) {
      addMana(G, p, a.mana, color);
      return;
    }
    G.stack.push({ sid: G.nextSid++, kind: 'ability', controller: p, source: id, name: lki.name, text: a.text, effects: a.effects, targets, x, colors: lki.colors });
    log(G, p, `${lki.name}の能力を起動${targetText(G, targets)}`);
    if (a.cycling) queueTrigger(G, id, 'cycled');
  }

  function addMana(G, p, m, color = null) {
    const pool = G.players[p].pool;
    if (m.fixed) for (const k of m.fixed) pool[k]++;
    else {
      const k = m.choices.includes(color) ? color : m.choices[0];
      pool[k] += m.amount;
    }
  }

  function playLand(G, p, id) {
    const o = obj(G, id);
    if (!o || o.zone !== 'hand' || o.owner !== p || !isType(o, 'land')) fail('手札の土地を選んでください');
    if (!sorceryTiming(G, p)) fail('土地は自分のメイン・フェイズ（スタックが空のとき）にプレイできます');
    if (G.players[p].landsPlayed >= 1) fail('このターンはもう土地をプレイしました');
    G.players[p].landsPlayed++;
    move(G, id, 'battlefield', { controller: p, silent: true });
    log(G, p, `${o.card.name}をプレイした`);
    sfx(G, `land:${(o.def.activated.find((a) => a.mana)?.mana.choices ?? []).join('')}`);
  }

  // ---------- 解決 ----------

  function resolveTop(G) {
    const item = G.stack.pop();
    const o = item.objId != null ? obj(G, item.objId) : null;
    const specs = item.kind === 'spell' && o ? spellSpecs(o) : item.effects.map((f) => (f.type === 'equip' ? { ...f.target, notSelf: true } : specOf(f)));
    const legal = specs.map((s, i) => !s || stillLegal(G, item, s, item.targets[i]));
    const targeted = specs.some(Boolean);
    // 対象がすべて不適正になった呪文・能力は打ち消される
    if (targeted && specs.every((s, i) => !s || !legal[i])) {
      log(G, item.controller, `${item.name}は対象が不適正になったので打ち消された`);
      if (o) finishSpell(G, item, o, { countered: true });
      return;
    }
    if (o && item.kind === 'spell' && !isType(o, 'instant') && !isType(o, 'sorcery')) {
      // パーマネント呪文
      o.zone = 'none';
      move(G, item.objId, 'battlefield', { controller: item.controller, silent: true });
      if (o.def.enchant) o.attachedTo = item.targets[0]?.obj ?? null;
      log(G, item.controller, `${o.card.name}が戦場に出た${o.def.enchant ? `（${nameOf(G, o.attachedTo)}につけた）` : ''}`);
      sfx(G, isType(o, 'creature') ? 'summon' : isType(o, 'artifact') ? 'artifact' : isType(o, 'enchantment') ? 'enchant' : 'summon');
      return;
    }
    item.effects.forEach((fx, i) => {
      if (specs[i] && !legal[i]) return;
      resolveEffect(G, item, fx, specs[i] ? item.targets[i] : null);
    });
    if (o) finishSpell(G, item, o, {});
  }

  function finishSpell(G, item, o, { countered = false }) {
    o.zone = 'none';
    if (isType(o, 'instant') || isType(o, 'sorcery') || countered) {
      o.zone = 'stackgone';
      const to = item.flashback ? 'exile' : 'graveyard';
      G.players[o.owner][to].push(o.id);
      o.zone = to;
    }
  }

  // 効果1つを解決する
  function resolveEffect(G, item, fx, t) {
    const p = item.controller;
    const q = other(p);
    const x = item.x ?? 0;
    const val = (n) => (n === 'X' ? x : n);
    const signed = (v) => (typeof v === 'number' ? v : /x$/.test(v) ? (v.startsWith('-') ? -x : x) : Number(v));
    const srcColors = item.colors ?? [];
    const src = item.source;
    const by = item.name;
    const rel = (who) => (who === 'me' ? p : q);
    const damageTo = (target, n) => {
      if (n <= 0) return;
      if (target.player != null) {
        log(G, target.player, `${by}：${n}点のダメージを受けた`);
        setLife(G, target.player, G.players[target.player].life - n);
      } else if (onBf(G, target.obj)) {
        if (protectedFrom(G, target.obj, srcColors)) return;
        const o = obj(G, target.obj);
        if (isType(o, 'creature')) {
          o.damage += n;
          if (onBf(G, src) && ch(G, src).kw.has('deathtouch')) o.deathtouched = true;
          log(G, o.controller, `${by}：${o.card.name}に${n}点のダメージ`);
        }
      }
    };
    switch (fx.type) {
      case 'damage':
        if (fx.target.auto) for (const w of fx.target.players) damageTo({ player: rel(w) }, val(fx.n));
        else if (t) damageTo(t, val(fx.n));
        break;
      case 'damagePlayers':
        for (const w of fx.players) damageTo({ player: rel(w) }, val(fx.n));
        break;
      case 'damageAll':
        for (const id of [...G.battlefield]) {
          const o = obj(G, id);
          if (!isType(o, 'creature')) continue;
          if (fx.filter.side && (fx.filter.side === 'opp') !== (o.controller !== p)) continue;
          if (fx.filter.other && id === src) continue;
          if (!R().matchesKw(cv(G, id), fx.filter)) continue;
          damageTo({ obj: id }, val(fx.n));
        }
        for (const w of fx.players ?? []) damageTo({ player: rel(w) }, val(fx.n));
        break;
      case 'destroy':
        if (t?.obj != null) {
          log(G, p, `${by}：${nameOf(G, t.obj)}を破壊`);
          destroy(G, t.obj, { noRegen: fx.noRegen });
        }
        break;
      case 'destroyAll':
        for (const id of [...G.battlefield]) if (onBf(G, id) && R().matches(cv(G, id), fx.filter)) destroy(G, id, { noRegen: fx.noRegen });
        log(G, p, `${by}：すべて破壊`);
        break;
      case 'exile':
        if (t?.obj != null) { log(G, p, `${by}：${nameOf(G, t.obj)}を追放`); move(G, t.obj, 'exile', { silent: true }); }
        break;
      case 'bounce':
        if (t?.obj != null) { log(G, p, `${by}：${nameOf(G, t.obj)}を手札に戻した`); move(G, t.obj, 'hand', { silent: true }); }
        break;
      case 'bounceAll':
        for (const id of [...G.battlefield]) if (R().matches(cv(G, id), fx.filter)) move(G, id, 'hand', { silent: true });
        log(G, p, `${by}：すべて手札に戻した`);
        break;
      case 'tap':
        if (t?.obj != null) { obj(G, t.obj).tapped = true; log(G, p, `${by}：${nameOf(G, t.obj)}をタップ`); }
        break;
      case 'untap':
        if (t?.obj != null) { obj(G, t.obj).tapped = false; log(G, p, `${by}：${nameOf(G, t.obj)}をアンタップ`); }
        break;
      case 'pump':
        if (t?.obj != null) pumpObj(G, t.obj, signed(fx.p), signed(fx.t), fx.kw, by);
        break;
      case 'selfPump':
        if (onBf(G, src)) pumpObj(G, src, fx.p, fx.t, fx.kw, by);
        break;
      case 'pumpAll': {
        const who = fx.both ? null : fx.opp ? q : p;
        for (const id of bf(G, who)) if (isCreatureObj(G, id)) G.effects.push({ id, p: signed(fx.p), t: signed(fx.t), kw: fx.kw ?? [], until: 'eot' });
        log(G, p, `${by}：クリーチャーはこのターン${fmt(signed(fx.p))}/${fmt(signed(fx.t))}`);
        break;
      }
      case 'cantBlock':
        if (t?.obj != null) G.effects.push({ id: t.obj, cantBlock: true, until: 'eot' });
        break;
      case 'counters':
        if (t?.obj != null) { obj(G, t.obj).counters.p1 += val(fx.n); log(G, p, `${by}：${nameOf(G, t.obj)}に+1/+1カウンター（${obj(G, t.obj).counters.p1}）`); }
        break;
      case 'selfCounters':
        if (onBf(G, src)) obj(G, src).counters.p1 += val(fx.n);
        break;
      case 'countersAll':
        for (const id of bf(G, p)) if (isCreatureObj(G, id)) obj(G, id).counters.p1 += val(fx.n);
        break;
      case 'draw': draw(G, p, val(fx.n)); break;
      case 'drawEach': draw(G, G.active, val(fx.n)); draw(G, other(G.active), val(fx.n)); break;
      case 'gain': log(G, p, `${by}：${val(fx.n)}点のライフを得た`); setLife(G, p, G.players[p].life + val(fx.n)); break;
      case 'lose': {
        const who = fx.target.auto ? fx.target.players.map(rel) : t?.player != null ? [t.player] : [];
        for (const w of who) { log(G, w, `${by}：${val(fx.n)}点のライフを失った`); setLife(G, w, G.players[w].life - val(fx.n)); }
        break;
      }
      case 'loseSelf': log(G, p, `${by}：${val(fx.n)}点のライフを失った`); setLife(G, p, G.players[p].life - val(fx.n)); break;
      case 'discard': {
        const who = fx.target.auto ? fx.target.players.map(rel) : t?.player != null ? [t.player] : [q];
        for (const w of who) G.choices.push({ type: 'discard', player: w, n: val(fx.n), reason: by });
        break;
      }
      case 'discardSelf': G.choices.push({ type: 'discard', player: p, n: val(fx.n), reason: by }); break;
      case 'loot': draw(G, p, fx.draw); G.choices.push({ type: 'discard', player: p, n: fx.discard, reason: by }); break;
      case 'mill': {
        const who = fx.target.auto ? fx.target.players.map(rel) : t?.player != null ? [t.player] : [];
        for (const w of who) for (const id of G.players[w].library.slice(0, val(fx.n))) move(G, id, 'graveyard');
        break;
      }
      case 'token': for (let i = 0; i < val(fx.n); i++) createToken(G, p, { ...fx, p: fx.p, t: fx.t }); break;
      case 'searchLand':
        for (let i = 0; i < val(fx.n); i++) G.choices.push({ type: 'search', player: p, what: 'basicLand', to: fx.to, tapped: fx.tapped, reason: by });
        break;
      case 'counter': {
        const s = G.stack.find((x) => x.sid === t?.stack);
        if (!s) break;
        if (fx.unless) {
          G.choices.push({ type: 'payOrNot', player: s.controller, cost: `{${fx.unless}}`, reason: `${by}（支払わなければ${s.name}は打ち消される）`, onDecline: { kind: 'counter', sid: s.sid, by } });
        } else counterSpell(G, s, by);
        break;
      }
      case 'regen': {
        const id = fx.self ? src : t?.obj;
        if (onBf(G, id)) { obj(G, id).regen++; log(G, p, `${by}：${nameOf(G, id)}に再生の盾`); }
        break;
      }
      case 'addMana': addMana(G, p, fx.mana); break;
      case 'sacSelf': if (onBf(G, src)) move(G, src, 'graveyard'); break;
      case 'sacUnless':
        if (onBf(G, src)) G.choices.push({ type: 'payOrNot', player: p, cost: fx.cost, reason: by, onDecline: { kind: 'sacrifice', id: src } });
        break;
      case 'fog': G.fog = true; log(G, p, `${by}：このターンの戦闘ダメージをすべて軽減する`); break;
      case 'regrow': if (t?.grave != null && obj(G, t.grave)?.zone === 'graveyard') move(G, t.grave, 'hand'); break;
      case 'untapLands': for (const id of bf(G, p)) if (isType(obj(G, id), 'land')) obj(G, id).tapped = false; break;
      case 'tapAllOpp': for (const id of bf(G, q)) if (isCreatureObj(G, id)) obj(G, id).tapped = true; break;
      case 'equip':
        if (onBf(G, src) && t?.obj != null) { obj(G, src).attachedTo = t.obj; log(G, p, `${by}を${nameOf(G, t.obj)}につけた`); }
        break;
      default:
        break;
    }
  }

  const fmt = (n) => (n >= 0 ? `+${n}` : String(n));

  function pumpObj(G, id, p, t, kw, by) {
    G.effects.push({ id, p, t, kw: kw ?? [], until: 'eot' });
    log(G, obj(G, id).controller, `${by}：${nameOf(G, id)}はこのターン${fmt(p)}/${fmt(t)}${kw?.length ? `・${kw.join('、')}` : ''}`);
  }

  function counterSpell(G, s, by) {
    const i = G.stack.indexOf(s);
    if (i < 0) return;
    G.stack.splice(i, 1);
    log(G, s.controller, `${s.name}は${by}で打ち消された`);
    sfx(G, 'cancel');
    const o = s.objId != null ? obj(G, s.objId) : null;
    if (o) finishSpell(G, s, o, { countered: true });
  }

  // ---------- 行動 ----------

  // いま行動するプレイヤーと、何を決めるか
  function needs(G) {
    if (G.winner != null) return null;
    if (G.pending) return { player: G.pending.player, type: G.pending.type, pending: G.pending };
    if (G.priority != null) return { player: G.priority, type: 'priority' };
    return null;
  }

  function perform(G, p, action) {
    try {
      doAction(G, p, action);
      run(G);
      return { ok: true };
    } catch (e) {
      if (e instanceof RuleError) return { ok: false, error: e.message };
      throw e;
    }
  }

  function doAction(G, p, a) {
    if (G.winner != null) fail('ゲームは終わっています');
    if (a.type === 'concede') { lose(G, p, 'concede'); return; }
    const pend = G.pending;
    // マナ能力は、優先権がなくても支払いの前に起動できる
    if (pend && a.type !== 'activate') {
      if (pend.player !== p) fail('相手の選択を待っています');
      return answerPending(G, p, pend, a);
    }
    if (pend && a.type === 'activate' && !obj(G, a.id)?.def.activated[a.index]?.mana) fail('先に選択をしてください');
    if (!pend && G.priority !== p && a.type !== 'activate') fail('優先権がありません');
    switch (a.type) {
      case 'pass': {
        G.passes++;
        G.lastPlayer = p;
        if (G.passes >= 2) {
          G.passes = 0;
          if (G.stack.length) {
            resolveTop(G);
            givePriority(G);
          } else {
            G.priority = null; // このステップを終える
          }
        } else {
          G.priority = other(p);
        }
        return;
      }
      case 'playLand': playLand(G, p, a.id); break;
      case 'cast': cast(G, p, a); break;
      case 'activate': {
        const isMana = obj(G, a.id)?.def.activated[a.index]?.mana;
        activate(G, p, a);
        if (isMana) return; // 優先権は動かない
        break;
      }
      default: fail(`できない行動です（${a.type}）`);
    }
    // 行動したプレイヤーが優先権を持ち続ける
    G.priority = p;
    G.passes = 0;
  }

  function answerPending(G, p, pend, a) {
    switch (pend.type) {
      case 'mulligan': {
        const pl = G.players[p];
        if (a.type === 'mulligan') {
          if (pl.mulligans >= 6) fail('これ以上マリガンできません');
          pl.library.push(...pl.hand.splice(0));
          for (const id of pl.library) obj(G, id).zone = 'library';
          shuffle(G, pl.library);
          pl.mulligans++;
          draw(G, p, 7, { silent: true });
          log(G, p, `マリガン（${pl.mulligans}回目）`);
          sfx(G, 'shuffle');
          return;
        }
        if (a.type !== 'keep') fail('キープかマリガンを選んでください');
        log(G, p, `キープ（マリガン${pl.mulligans}回）`);
        if (pl.mulligans) { G.pending = { type: 'bottom', player: p, n: Math.min(pl.mulligans, pl.hand.length) }; return; }
        return keepDone(G, p);
      }
      case 'bottom': {
        const ids = (a.ids ?? []).map(Number);
        const pl = G.players[p];
        if (a.type !== 'bottom' || ids.length !== pend.n || new Set(ids).size !== ids.length || !ids.every((id) => pl.hand.includes(id))) fail(`手札から${pend.n}枚選んでください`);
        for (const id of ids) move(G, id, 'library', { bottom: true, silent: true });
        log(G, p, `手札から${ids.length}枚をライブラリーの一番下へ`);
        return keepDone(G, p);
      }
      case 'attackers':
        if (a.type !== 'attackers') fail('攻撃するクリーチャーを決めてください');
        G.pending = null;
        declareAttackers(G, p, a.ids ?? []);
        if (G.combat) givePriority(G);
        return;
      case 'blockers':
        if (a.type !== 'blockers') fail('ブロックを決めてください');
        declareBlockers(G, p, a.blocks ?? {});
        G.pending = null;
        givePriority(G);
        return;
      case 'triggerTarget': {
        const tr = G.triggers[0];
        if (a.type === 'skip') {
          tr.targets = tr.targets ?? [];
          tr.targets[pend.index] = null;
          G.pending = null;
          return;
        }
        if (a.type !== 'target' || !targetsFor(G, p, pend.spec, pend.source, tr.colors).some((c) => sameTarget(c, a.target))) fail('その対象は選べません');
        tr.targets = tr.targets ?? [];
        tr.targets[pend.index] = a.target;
        G.pending = null;
        return;
      }
      case 'discard': {
        const ids = (a.ids ?? []).map(Number);
        if (a.type !== 'choose' || ids.length !== pend.n || new Set(ids).size !== ids.length || !ids.every((id) => G.players[p].hand.includes(id))) fail(`手札から${pend.n}枚選んでください`);
        G.pending = null;
        for (const id of ids) { move(G, id, 'graveyard', { silent: true }); log(G, p, `${nameOf(G, id)}を捨てた`); }
        sfx(G, 'discard');
        return;
      }
      case 'search': {
        const id = Number(a.ids?.[0]);
        if (a.type !== 'choose' || !pend.options.includes(id)) fail('カードを選んでください');
        G.pending = null;
        const o = obj(G, id);
        G.players[p].library.splice(G.players[p].library.indexOf(id), 1);
        o.zone = 'library-out';
        if (pend.to === 'battlefield') { o.zone = 'none'; move(G, id, 'battlefield', { controller: p, tapped: pend.tapped, silent: true }); }
        else { o.zone = 'hand'; G.players[p].hand.push(id); }
        log(G, p, `ライブラリーから${o.card.name}を${pend.to === 'hand' ? '手札に加えた' : '戦場に出した'}`);
        shuffle(G, G.players[p].library);
        sfx(G, 'shuffle');
        return;
      }
      case 'payOrNot': {
        if (a.type !== 'pay') fail('支払うかどうかを選んでください');
        G.pending = null;
        if (a.yes) {
          if (!canPay(G, p, pend.cost)) fail('マナが足りません');
          pay(G, p, pend.cost);
          log(G, p, `${pend.reason}：${pend.cost}を支払った`);
          return;
        }
        if (pend.onDecline.kind === 'counter') {
          const s = G.stack.find((x) => x.sid === pend.onDecline.sid);
          if (s) counterSpell(G, s, pend.onDecline.by);
        } else if (pend.onDecline.kind === 'sacrifice' && onBf(G, pend.onDecline.id)) {
          log(G, p, `${pend.reason}：支払わなかったので生け贄に捧げた`);
          move(G, pend.onDecline.id, 'graveyard', { silent: true });
        }
        return;
      }
      default:
        fail('いまはできません');
    }
  }

  function keepDone(G, p) {
    G.players[p].kept = true;
    const q = other(p);
    if (!G.players[q].kept) { G.pending = { type: 'mulligan', player: q }; return; }
    G.pending = null;
    G.turn = 1;
    G.active = G.first;
    G.step = 'untap';
    G.stepBegun = false;
  }

  // ---------- 判断・表示のための問い合わせ ----------

  // 優先権があるときにできること（パス以外）があるか。instantOnly: インスタント・タイミングのものだけ
  function hasPlayable(G, p, { instantOnly = false } = {}) {
    if (G.priority !== p) return false;
    const pl = G.players[p];
    if (!instantOnly && sorceryTiming(G, p) && pl.landsPlayed < 1 && pl.hand.some((id) => isType(obj(G, id), 'land'))) return true;
    for (const id of [...pl.hand, ...pl.graveyard]) {
      const o = obj(G, id);
      if (instantOnly && !isInstantSpeed(o)) continue;
      if (castInfo(G, p, id).ok) return true;
    }
    for (const id of [...bf(G, p), ...pl.hand]) {
      for (const a of activations(G, p, id)) {
        if (a.ok && !a.mana && (!instantOnly || !obj(G, id).def.activated[a.index].sorcery)) return true;
      }
    }
    return false;
  }

  // オンライン対戦などで相手に見せる形（相手の手札とライブラリーの中身を隠す）
  function view(G, p) {
    const v = JSON.parse(JSON.stringify(G));
    const hide = (id) => {
      v.objects[id] = { id, owner: v.objects[id].owner, controller: v.objects[id].controller, zone: v.objects[id].zone, hidden: true,
        card: { name: '', image: null, text: '' }, def: { types: [], subtypes: [], supertypes: [], keywords: [], colors: [], statics: [], triggers: [], activated: [], spell: [], manual: [] },
        counters: { p1: 0, m1: 0 }, used: {} };
    };
    // ライブラリーから探している最中のカードは、探しているプレイヤーには見せる
    const shown = new Set(G.pending?.player === p && G.pending.type === 'search' ? G.pending.options : []);
    for (const pl of v.players) for (const id of pl.library) if (!shown.has(id)) hide(id);
    for (const id of v.players[other(p)].hand) hide(id);
    v.sfx = [];
    v.rng = 0;
    return v;
  }

  return {
    STEPS, STEP_NAMES, create, perform, needs, run,
    ch, cv, isSick, canAttack, canBlock, castInfo, activations, targetsFor, hasPlayable, planPayment, canPay, manaSources, maxX,
    sorceryTiming, isType: (G, id, t) => isType(obj(G, id), t), view, specOf, spellSpecs,
  };
})();

if (typeof module !== 'undefined') module.exports = Engine;
