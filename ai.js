// Magic: The Gathering System — CPU の判断（ルールエンジン engine.js 用）
// AI.decide(G, p) → p が今とる行動（必ずルール上できる行動を返す。迷ったらパス）。
// 状態を持たないので、保存したゲームを読み込んでもそのまま続けられる。
//
// 考え方（簡単な読み）:
//   ・マリガン：土地が2〜5枚ならキープ
//   ・自分のメイン：土地 → 重い呪文・クリーチャー優先で唱える。オーラ・装備は良い相手につける
//   ・攻撃：ブロックされて一方的に負けない／全員で攻撃すれば勝てる。返しで負けそうなら守る
//   ・ブロック：相打ち以上か、壁になれるとき。負けそうならチャンプ・ブロック
//   ・相手の呪文：価値があれば打ち消す。自分のクリーチャーが狙われたら再生する
//   ・戦闘中：攻撃・ブロック後に修整（巨大化など）で勝てるなら使う。大きなダメージは霧で防ぐ
//   ・相手の終了ステップ：残ったマナでインスタント・ドロー・ピンガー

const AI = (() => {
  const E = () => Engine;
  const R = () => Rules;
  const o = (G, id) => G.objects[id];
  const other = (p) => 1 - p;
  const isT = (G, id, t) => o(G, id)?.def.types.includes(t);
  const bfOf = (G, p) => G.battlefield.filter((id) => o(G, id).controller === p);
  const creatures = (G, p) => bfOf(G, p).filter((id) => isT(G, id, 'creature'));

  // 戦闘の計算に使うカードの形（rules.js の combat 用）
  const card = (G, id) => ({ ...E().cv(G, id), damage: o(G, id).damage, oracle: '' });

  function value(G, id) {
    const x = o(G, id);
    if (!x) return 0;
    if (x.zone !== 'battlefield') return (x.def.cmc || 0) + 1;
    const c = E().ch(G, id);
    let v = c.hasPT ? c.p * 1.5 + c.t : 1.5;
    v += (x.def.cmc || 0) * 0.5 + c.kw.size * 0.6 + x.def.activated.filter((a) => !a.mana).length;
    if (x.token) v -= 1;
    if (isT(G, id, 'land')) v = 1;
    return v;
  }

  const couldBlock = (G, b, a) => {
    const x = o(G, a);
    const was = x.attacking;
    x.attacking = true;
    const ok = E().canBlock(G, b, a);
    x.attacking = was;
    return ok;
  };

  const fight = (G, a, b) => {
    const r = R().combat([card(G, a)], [{ card: card(G, b), attacker: a }]);
    return { aDies: !r.units[0].alive, bDies: !r.units[1].alive };
  };

  // ---------- 対象を選ぶ ----------

  // mode: 'main' | 'etb' | 'combat' | 'end' | 'respond'。良い対象がなければ null
  function chooseTarget(G, p, fx, spec, x, mode, srcId) {
    const cands = E().targetsFor(G, p, spec, srcId, srcId ? o(G, srcId)?.def.colors ?? [] : []);
    if (!cands.length) return null;
    const q = other(p);
    const theirs = cands.filter((t) => t.obj != null && o(G, t.obj).controller === q);
    const mine = cands.filter((t) => t.obj != null && o(G, t.obj).controller === p);
    const face = cands.find((t) => t.player === q);
    const best = (list, f = (t) => value(G, t.obj)) => [...list].sort((a, b) => f(b) - f(a))[0] ?? null;
    const n = fx.n === 'X' ? x : fx.n;
    const crt = (t) => isT(G, t.obj, 'creature');
    switch (fx.type) {
      case 'damage': {
        if (face && G.players[q].life <= n) return face;
        const killable = theirs.filter((t) => {
          if (!crt(t)) return false;
          const c = E().ch(G, t.obj);
          return c.hasPT && !c.kw.has('indestructible') && c.t - o(G, t.obj).damage <= n && !o(G, t.obj).regen;
        });
        const pref = mode === 'combat' ? killable.filter((t) => o(G, t.obj).attacking || o(G, t.obj).blocking != null) : killable;
        const target = best(pref.length ? pref : killable);
        if (target && (value(G, target.obj) >= 2.5 || !face || mode === 'etb')) return target;
        if (mode === 'combat' || mode === 'respond') return null;
        if (face) return face;
        if (mode === 'etb') return best(theirs.filter(crt)) ?? best(mine.filter(crt), (t) => -value(G, t.obj)) ?? cands[0];
        return null;
      }
      case 'destroy':
      case 'exile':
      case 'bounce': {
        const pref = mode === 'combat' ? theirs.filter((t) => o(G, t.obj).attacking) : theirs;
        const pick = best((pref.length ? pref : theirs).filter((t) => !isT(G, t.obj, 'land') || fx.target.filter?.types?.includes('land')));
        if (pick && (fx.type !== 'bounce' || o(G, pick.obj).token || value(G, pick.obj) >= 3 || mode === 'etb')) return pick;
        return mode === 'etb' ? best(theirs) ?? cands.find((t) => t.player == null && t.obj != null && o(G, t.obj).token) ?? null : null;
      }
      case 'tap': {
        if (mode !== 'main' && mode !== 'etb') return null;
        return best(theirs.filter((t) => crt(t) && !o(G, t.obj).tapped));
      }
      case 'untap': return mode === 'etb' ? cands[0] : null;
      case 'pump':
      case 'counters':
      case 'regen':
      case 'cantBlock': {
        if (fx.type === 'cantBlock') return best(theirs.filter(crt)) ?? null;
        if (fx.type === 'pump' && mode === 'main') return null;
        const pick = best(mine.filter(crt));
        return pick ?? (mode === 'etb' ? cands[0] : null);
      }
      case 'lose':
      case 'discard':
      case 'mill':
        return face ?? null;
      case 'counter': {
        const s = cands.map((t) => G.stack.find((x) => x.sid === t.stack)).filter((s) => s && s.controller === q).at(-1);
        return s ? { stack: s.sid } : null;
      }
      case 'regrow': {
        const list = cands.filter((t) => t.grave != null);
        return best(list, (t) => (o(G, t.grave).def.cmc || 0) + (isT(G, t.grave, 'creature') ? 2 : 0)) ?? null;
      }
      case 'equip': {
        const free = mine.filter((t) => crt(t) && !G.battlefield.some((e) => o(G, e).attachedTo === t.obj));
        return best(free.length ? free : mine.filter(crt));
      }
      default:
        return cands[0];
    }
  }

  // オーラの相手：「攻撃・ブロックできない」などは相手のクリーチャー、修整は自分のクリーチャー
  function auraTarget(G, p, id) {
    const def = o(G, id).def;
    const spec = def.auraTarget;
    const cands = E().targetsFor(G, p, spec, null, def.colors).filter((t) => t.obj != null);
    const bad = def.statics.some((s) => s.cantAttack || s.cantBlock || s.noUntap || (s.p ?? 0) < 0);
    const side = bad ? other(p) : p;
    const list = cands.filter((t) => o(G, t.obj).controller === side && isT(G, t.obj, 'creature'));
    return [...list].sort((a, b) => value(G, b.obj) - value(G, a.obj))[0] ?? null;
  }

  // 対象を取らない効果を使う価値があるか
  function worth(G, p, fx, x) {
    const q = other(p);
    const n = fx.n === 'X' ? x : fx.n;
    const sum = (ids) => ids.reduce((s, id) => s + value(G, id), 0);
    switch (fx.type) {
      case 'destroyAll':
      case 'bounceAll': {
        const hit = (side) => bfOf(G, side).filter((id) => R().matches(E().cv(G, id), fx.filter) && !E().ch(G, id).kw.has('indestructible'));
        return sum(hit(q)) - sum(hit(p)) >= 4;
      }
      case 'damageAll': {
        const kills = (side) => creatures(G, side).filter((id) => {
          const c = E().ch(G, id);
          return c.hasPT && c.t - o(G, id).damage <= n && R().matchesKw(E().cv(G, id), fx.filter) && !(fx.filter.side === 'opp' && side === p);
        });
        return sum(kills(q)) - sum(kills(p)) >= 3 && G.players[p].life > (fx.players?.includes('me') ? n + 3 : 0);
      }
      case 'damagePlayers': return !fx.players.includes('me') || G.players[p].life - n > 5 || G.players[q].life <= n;
      case 'pumpAll': return false;
      case 'discard': return G.players[q].hand.length > 0;
      case 'tapAllOpp': return creatures(G, q).some((id) => !o(G, id).tapped) && G.active === p;
      case 'fog': return false;
      case 'drawEach': return G.players[p].hand.length <= G.players[q].hand.length;
      default: return true;
    }
  }

  // ---------- 唱える計画 ----------

  // → { action, score }（唱えないなら null）
  function castPlan(G, p, id, mode) {
    const info = E().castInfo(G, p, id);
    if (!info.ok) return null;
    const x = o(G, id);
    const def = x.def;
    if (def.types.includes('planeswalker')) return null;
    const spell = def.types.includes('instant') || def.types.includes('sorcery');
    if (spell && !def.spell.length) return null;
    if ((mode === 'combat' || mode === 'end' || mode === 'respond') && !(def.types.includes('instant') || def.keywords.includes('flash'))) return null;
    if (spell && def.spell.some((f) => f.type === 'fog')) return null; // 霧は戦闘中に別に判断
    if (spell && def.spell.some((f) => f.type === 'counter') && mode !== 'respond') return null;
    if (def.equip && !creatures(G, p).length) return null;
    const X = info.x ? info.maxX : 0;
    if (info.x && X < 1) return null;
    const targets = [];
    if (def.enchant) {
      const t = auraTarget(G, p, id);
      if (!t) return null;
      targets.push(t);
    } else if (spell) {
      for (const fx of def.spell) {
        const spec = E().specOf(fx);
        if (spec) {
          const t = chooseTarget(G, p, fx, spec, X, mode, null);
          if (!t) return null;
          targets.push(t);
        } else {
          if (!worth(G, p, fx, X)) return null;
          targets.push(null);
        }
      }
    }
    const total = (def.cmc || 0) + X;
    const score = total * 10 + (def.types.includes('creature') ? 5 : 0) + (spell ? 3 : 0);
    return { action: { type: 'cast', id, targets, x: X, flashback: x.zone === 'graveyard' }, score };
  }

  function bestCast(G, p, mode) {
    let best = null;
    const pl = G.players[p];
    for (const id of [...pl.hand, ...pl.graveyard]) {
      const plan = castPlan(G, p, id, mode);
      if (plan && (!best || plan.score > best.score)) best = plan;
    }
    return best?.action ?? null;
  }

  // ---------- 起動型能力 ----------

  function abilityPlan(G, p, mode) {
    for (const id of [...bfOf(G, p), ...G.players[p].hand]) {
      for (const a of E().activations(G, p, id)) {
        if (!a.ok || a.mana) continue;
        const ab = o(G, id).def.activated[a.index];
        const fx = ab.effects;
        const kinds = fx.map((f) => f.type);
        // 自分のメインで使うもの
        if (kinds.includes('equip')) {
          if (mode !== 'main') continue;
          if (o(G, id).attachedTo != null && onBfCreature(G, o(G, id).attachedTo)) continue;
        } else if (kinds.includes('regen') || kinds.includes('selfPump') || kinds.includes('pump')) {
          continue; // 戦闘・対応で別に判断
        } else if (ab.cycling) {
          if (mode !== 'end') continue;
        } else if (kinds.includes('draw') || kinds.includes('damage') || kinds.includes('lose') || kinds.includes('gain') || kinds.includes('token') || kinds.includes('counters')) {
          // ピンガー・ドロー：相手の終了ステップ（または自分の第2メイン）
          if (!(mode === 'end' || mode === 'main2')) continue;
          if (ab.cost.sacSelf && !kinds.includes('damage')) continue;
        } else if (kinds.includes('tap')) {
          if (mode !== 'main') continue;
        } else continue;
        const targets = [];
        let okT = true;
        fx.forEach((f, i) => {
          const spec = a.specs?.[i];
          if (!spec) { targets.push(null); return; }
          const t = chooseTarget(G, p, f, spec, 0, f.type === 'damage' ? 'end' : mode === 'main2' ? 'main' : mode, id);
          if (!t) okT = false;
          targets.push(t);
        });
        if (!okT) continue;
        // 生け贄が必要なピンガー（モグの狂信者など）は、クリーチャーを倒せるか、とどめのときだけ
        if (ab.cost.sacSelf && fx[0]?.type === 'damage' && targets[0]?.player != null && G.players[other(p)].life > fx[0].n) continue;
        return { type: 'activate', id, index: a.index, targets };
      }
    }
    return null;
  }

  const onBfCreature = (G, id) => o(G, id)?.zone === 'battlefield' && isT(G, id, 'creature');

  // ---------- 戦闘 ----------

  function chooseAttackers(G, p) {
    const q = other(p);
    const mine = creatures(G, p).filter((id) => E().canAttack(G, id) && E().ch(G, id).p > 0);
    const blockers = creatures(G, q).filter((id) => !o(G, id).tapped);
    const life = G.players[q].life;
    const powers = mine.map((id) => E().ch(G, id).p).sort((a, b) => b - a);
    if (powers.slice(blockers.length).reduce((s, n) => s + n, 0) >= life) return mine;
    let attackers = mine.filter((a) => {
      for (const b of blockers) {
        if (!couldBlock(G, b, a)) continue;
        const r = fight(G, a, b);
        if (r.aDies && !r.bDies) return false;
        if (r.aDies && r.bDies && value(G, b) < value(G, a) - 0.5) return false;
      }
      return true;
    });
    // 返しのターンに負けそうなら、警戒のないものは守りに残す
    const crack = creatures(G, q).reduce((s, id) => s + Math.max(0, E().ch(G, id).p), 0);
    if (crack >= G.players[p].life) attackers = attackers.filter((id) => E().ch(G, id).kw.has('vigilance'));
    // 「可能なら攻撃する」
    for (const id of mine) if (E().ch(G, id).mustAttack && !attackers.includes(id)) attackers.push(id);
    return attackers;
  }

  function chooseBlocks(G, p) {
    const attackers = Object.keys(G.combat?.attackers ?? {}).map(Number).sort((a, b) => E().ch(G, b).p - E().ch(G, a).p);
    const avail = creatures(G, p).filter((id) => !o(G, id).tapped);
    const blocks = {};
    const used = new Set();
    const unblocked = [];
    for (const a of attackers) {
      if (E().ch(G, a).kw.has('menace')) { unblocked.push(a); continue; }
      let best = null;
      let bestScore = -Infinity;
      for (const b of avail) {
        if (used.has(b) || !E().canBlock(G, b, a)) continue;
        const r = fight(G, a, b);
        let score = -Infinity;
        if (r.aDies && !r.bDies) score = 100 + value(G, a);
        else if (!r.bDies) score = 50 - value(G, b);
        else if (r.aDies && value(G, a) >= value(G, b)) score = 10 + value(G, a) - value(G, b);
        if (score > bestScore) { best = b; bestScore = score; }
      }
      if (best != null) { blocks[best] = a; used.add(best); } else unblocked.push(a);
    }
    let incoming = unblocked.reduce((s, a) => s + Math.max(0, E().ch(G, a).p), 0);
    for (const a of unblocked) {
      if (incoming < G.players[p].life) break;
      if (E().ch(G, a).kw.has('menace')) continue;
      const b = avail.filter((x) => !used.has(x) && E().canBlock(G, x, a)).sort((x, y) => value(G, x) - value(G, y))[0];
      if (b == null) continue;
      blocks[b] = a;
      used.add(b);
      if (!E().ch(G, a).kw.has('trample')) incoming -= Math.max(0, E().ch(G, a).p);
    }
    return blocks;
  }

  // 今の戦闘の結果を計算（自分のクリーチャーが死ぬか・受けるダメージ）
  function combatOutcome(G) {
    if (!G.combat) return null;
    const attackers = Object.keys(G.combat.attackers).map(Number).filter((id) => o(G, id)?.zone === 'battlefield');
    const blocks = Object.entries(G.combat.blocks).map(([b, a]) => ({ card: card(G, Number(b)), attacker: a })).filter((x) => o(G, x.card.iid)?.zone === 'battlefield');
    return R().combat(attackers.map((id) => card(G, id)), blocks);
  }

  // 戦闘中の判断：修整・再生・霧
  function combatTrick(G, p) {
    if (!G.combat || !['blockers', 'firststrike'].includes(G.step) || G.stack.length) return null;
    const r = combatOutcome(G);
    if (!r) return null;
    const q = other(p);
    const defending = G.active === q;
    // 霧：大きなダメージ・致死を防ぐ
    if (defending && (r.toOpp >= G.players[p].life || r.toOpp >= 6)) {
      for (const id of G.players[p].hand) {
        if (o(G, id).def.spell.some((f) => f.type === 'fog') && E().castInfo(G, p, id).ok) return { type: 'cast', id, targets: [] };
      }
    }
    // 再生：死ぬ自分のクリーチャー
    for (const u of r.units) {
      const id = u.card.iid;
      if (u.alive || o(G, id).controller !== p || o(G, id).regen) continue;
      for (const a of E().activations(G, p, id)) {
        if (a.ok && o(G, id).def.activated[a.index].effects.some((f) => f.type === 'regen' && f.self)) return { type: 'activate', id, index: a.index, targets: [] };
      }
    }
    // 修整：自分のクリーチャーが生き残る・相手を倒せる
    for (const u of r.units) {
      const id = u.card.iid;
      if (o(G, id).controller !== p) continue;
      const enemy = u.side === 'me' ? u.blockers : r.units.filter((x) => x.side === 'me' && x.blockers.includes(u));
      const fightNow = enemy.length > 0;
      // 火吹き：ブロックされていない攻撃クリーチャーにマナを注ぐ
      if (!fightNow && u.side === 'me' && !defending) {
        for (const a of E().activations(G, p, id)) {
          const ab = o(G, id).def.activated[a.index];
          if (a.ok && !a.mana && ab.effects.every((f) => f.type === 'selfPump' && f.p > 0)) return { type: 'activate', id, index: a.index, targets: [] };
        }
        continue;
      }
      if (!fightNow) continue;
      const enemyDies = enemy.every((e) => !e.alive);
      if (u.alive && enemyDies) continue;
      for (const h of G.players[p].hand) {
        const def = o(G, h).def;
        const fx = def.spell[0];
        if (!fx || fx.type !== 'pump' || def.spell.length !== 1 || !E().castInfo(G, p, h).ok) continue;
        const targets = E().targetsFor(G, p, E().specOf(fx), null, def.colors);
        if (!targets.some((t) => t.obj === id)) continue;
        return { type: 'cast', id: h, targets: [{ obj: id }] };
      }
      for (const a of E().activations(G, p, id)) {
        const ab = o(G, id).def.activated[a.index];
        if (a.ok && !a.mana && ab.effects.every((f) => f.type === 'selfPump')) return { type: 'activate', id, index: a.index, targets: [] };
      }
    }
    return null;
  }

  // 相手の呪文・能力への対応：打ち消し・再生・除去への対応
  function respond(G, p) {
    const top = G.stack.at(-1);
    if (!top || top.controller === p) return null;
    const q = other(p);
    // 打ち消し
    const src = top.objId != null ? o(G, top.objId) : null;
    const dangerous = top.kind === 'spell' && src && ((src.def.cmc || 0) >= 3
      || top.targets.some((t) => t && (t.player === p || (t.obj != null && o(G, t.obj)?.controller === p && value(G, t.obj) >= 3)))
      || src.def.spell.some((f) => ['destroyAll', 'damageAll'].includes(f.type)));
    if (dangerous) {
      for (const id of G.players[p].hand) {
        const fx = o(G, id).def.spell.find((f) => f.type === 'counter');
        if (!fx) continue;
        const info = E().castInfo(G, p, id);
        if (!info.ok) continue;
        if (!E().targetsFor(G, p, fx.target, null, []).some((t) => t.stack === top.sid)) continue;
        return { type: 'cast', id, targets: [{ stack: top.sid }] };
      }
    }
    // 自分のクリーチャーが狙われた：再生
    const threatened = new Set();
    for (const [i, fx] of top.effects.entries()) {
      const t = top.targets[i];
      if (['destroy', 'damage'].includes(fx.type) && t?.obj != null && o(G, t.obj)?.controller === p && !fx.noRegen) threatened.add(t.obj);
      if (fx.type === 'destroyAll' && !fx.noRegen) for (const id of creatures(G, p)) threatened.add(id);
    }
    for (const id of threatened) {
      if (o(G, id).regen) continue;
      for (const a of E().activations(G, p, id)) {
        if (a.ok && o(G, id).def.activated[a.index].effects.some((f) => f.type === 'regen' && f.self)) return { type: 'activate', id, index: a.index, targets: [] };
      }
    }
    void q;
    return null;
  }

  // ---------- 選択 ----------

  function chooseDiscard(G, p, n, options) {
    const hand = [...options];
    const lands = hand.filter((id) => isT(G, id, 'land'));
    const landsOnBf = bfOf(G, p).filter((id) => isT(G, id, 'land')).length;
    const score = (id) => (isT(G, id, 'land') ? (landsOnBf + lands.length > 5 ? -10 : 5) : -(o(G, id).def.cmc || 0));
    return hand.sort((a, b) => score(a) - score(b)).slice(0, n);
  }

  function chooseSearch(G, p, options) {
    const have = new Set(bfOf(G, p).flatMap((id) => o(G, id).def.activated.filter((a) => a.mana).flatMap((a) => a.mana.choices ?? a.mana.fixed ?? [])));
    const need = new Set(G.players[p].hand.flatMap((id) => o(G, id).def.colors));
    const pick = options.find((id) => o(G, id).def.activated.some((a) => a.mana && (a.mana.choices ?? []).some((c) => need.has(c) && !have.has(c))));
    return pick ?? options[0];
  }

  function chooseBottom(G, p, n) {
    const hand = [...G.players[p].hand];
    const lands = hand.filter((id) => isT(G, id, 'land'));
    const spells = hand.filter((id) => !isT(G, id, 'land')).sort((a, b) => (o(G, b).def.cmc || 0) - (o(G, a).def.cmc || 0));
    const out = [];
    while (out.length < n) {
      const restLands = lands.filter((x) => !out.includes(x)).length;
      const pickFrom = restLands > 3 ? lands.filter((x) => !out.includes(x)) : spells.filter((x) => !out.includes(x));
      out.push((pickFrom.length ? pickFrom : hand.filter((x) => !out.includes(x)))[0]);
    }
    return out;
  }

  // ---------- 決める ----------

  function decide(G, p) {
    const need = E().needs(G);
    if (!need || need.player !== p) return { type: 'pass' };
    const pend = G.pending;
    switch (need.type) {
      case 'mulligan': {
        const lands = G.players[p].hand.filter((id) => isT(G, id, 'land')).length;
        return (lands >= 2 && lands <= 5) || G.players[p].mulligans >= 2 ? { type: 'keep' } : { type: 'mulligan' };
      }
      case 'bottom': return { type: 'bottom', ids: chooseBottom(G, p, pend.n) };
      case 'attackers': return { type: 'attackers', ids: chooseAttackers(G, p) };
      case 'blockers': return { type: 'blockers', blocks: chooseBlocks(G, p) };
      case 'triggerTarget': {
        const tr = G.triggers[0];
        const fx = tr.effects[pend.index];
        const t = chooseTarget(G, p, fx, pend.spec, 0, 'etb', pend.source);
        const cands = E().targetsFor(G, p, pend.spec, pend.source, tr.colors);
        // 自分に不利な対象しかないときは、任意（「してもよい」）なら選ばない
        if (!t && tr.optional) return { type: 'skip' };
        return { type: 'target', target: t ?? cands[0] };
      }
      case 'discard': return { type: 'choose', ids: chooseDiscard(G, p, pend.n, pend.options) };
      case 'search': return { type: 'choose', ids: [chooseSearch(G, p, pend.options)] };
      case 'payOrNot': {
        if (!pend.canPay) return { type: 'pay', yes: false };
        // エコー：小さいクリーチャーのために重いマナを払わない
        if (pend.onDecline.kind === 'sacrifice' && value(G, pend.onDecline.id) < 3) return { type: 'pay', yes: false };
        return { type: 'pay', yes: true };
      }
      case 'priority': return priority(G, p);
      default: return { type: 'pass' };
    }
  }

  function priority(G, p) {
    const q = other(p);
    const mine = G.active === p;
    // 相手の呪文・能力に対応
    if (G.stack.length) return respond(G, p) ?? { type: 'pass' };
    // 戦闘中
    const trick = combatTrick(G, p);
    if (trick) return trick;
    if (mine && ['main1', 'main2'].includes(G.step)) {
      // 土地
      if (G.players[p].landsPlayed < 1) {
        const lands = G.players[p].hand.filter((id) => isT(G, id, 'land'));
        if (lands.length) {
          const need = new Set(G.players[p].hand.flatMap((id) => o(G, id).def.colors));
          const score = (id) => (o(G, id).def.activated.find((a) => a.mana)?.mana.choices ?? []).filter((c) => need.has(c)).length - (o(G, id).def.entersTapped ? 1 : 0);
          return { type: 'playLand', id: lands.sort((a, b) => score(b) - score(a))[0] };
        }
      }
      const cast = bestCast(G, p, 'main');
      if (cast) return cast;
      const ab = abilityPlan(G, p, G.step === 'main2' ? 'main2' : 'main');
      if (ab) return ab;
      return { type: 'pass' };
    }
    // 相手の終了ステップ・自分の終了ステップ：インスタント・能力
    if (G.step === 'end' && !mine) {
      const cast = bestCast(G, p, 'end');
      if (cast) return cast;
      const ab = abilityPlan(G, p, 'end');
      if (ab) return ab;
    }
    // 相手の攻撃中：攻撃クリーチャーを除去
    if (!mine && G.combat && ['attackers', 'blockers'].includes(G.step)) {
      const cast = bestCast(G, p, 'combat');
      if (cast) return cast;
    }
    void q;
    return { type: 'pass' };
  }

  return { decide, value, chooseAttackers, chooseBlocks };
})();

if (typeof module !== 'undefined') module.exports = AI;
