// Magic: The Gathering System — カードの自動処理（ルールエンジン）
// 一人回し・ネット対戦・CPU対戦で共有する、状態を持たない関数の集まり。
// ・マナ・コストの解析と、土地・マナ能力から払う組み合わせの自動選択
// ・効果テキスト（英語の Oracle テキスト）から、よくある効果を読み取る
//   （ダメージ・破壊・追放・バウンス・ドロー・ライフ・修整・カウンター・トークン・捨てる・土地サーチ・ETB）
// ・効果の適用（「操作」= op を自分の盤面に当てる）と状況起因処理（死亡）
// ・戦闘ダメージの計算、ロード（「〜は +1/+1 の修整を受ける」）の計算
// 旧枠モダン（〜スカージ初出）のカードでよく見る書式を中心に対応している。読み取れない文は手動で処理する。
//
// カードの形（play.js の cardFrom / cpu.js が作る）:
//   { iid, name, oracle, manaCost, cmc, colors, typeLine, isLand, isCreature, kind, power, toughness,
//     keywords, tapped, counters, ptMod, damage, tempKw, smod, enteredTurn, token, produces, mana }

const Rules = (() => {
  const COLORS = ['W', 'U', 'B', 'R', 'G'];
  const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const N = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+)';
  const num = (s) => (s === 'x' ? 'X' : NUM_WORDS[s] ?? Number.parseInt(s, 10));
  const toNum = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

  // ---------- カードの基本情報 ----------

  const front = (typeLine = '') => typeLine.split('//')[0];
  const isType = (c, t) => new RegExp(`\\b${t}\\b`, 'i').test(front(c.typeLine ?? ''));
  const isCreature = (c) => !!c && !c.isLand && c.isCreature !== false && (c.typeLine ? isType(c, 'Creature') || c.token : true);
  const isPermanentCard = (c) => !isType(c, 'Instant') && !isType(c, 'Sorcery');

  // キーワード（印刷されたもの・このターン得たもの・ロードで得たもの）
  const kwOf = (c) => [...(c.keywords ?? []), ...(c.tempKw ?? []), ...(c.smod?.kw ?? [])];
  const hasKw = (c, k) => kwOf(c).includes(k);

  // 今のパワー／タフネス（+1/+1 カウンター・このターンの修整・ロードの修整を足す）。P/T のないカードは null
  function pt(c) {
    if (c.power == null || c.toughness == null) return null;
    const m = c.ptMod ?? { p: 0, t: 0 };
    const s = c.smod ?? { p: 0, t: 0 };
    const k = c.counters || 0;
    return { p: toNum(c.power) + k + m.p + (s.p || 0), t: toNum(c.toughness) + k + m.t + (s.t || 0) };
  }

  // カードの色（Scryfall の colors。なければマナ・コストの記号から）
  function colorsOf(c) {
    if (Array.isArray(c.colors)) return c.colors;
    return COLORS.filter((x) => (c.manaCost ?? '').includes(x));
  }

  // ---------- マナ・コスト ----------

  // "{2}{R}{R}" → { generic: 2, W: 0, U: 0, B: 0, R: 2, G: 0, C: 0, x: 0, hybrid: [] }
  // マナ・コストが分からない古いデータは、点数で見たマナ・コストを不特定マナとして扱う
  function parseCost(manaCost, cmc = 0) {
    const cost = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, x: 0, hybrid: [], known: manaCost != null };
    if (manaCost == null) {
      cost.generic = Math.floor(cmc || 0);
      return cost;
    }
    for (const [, sym] of String(manaCost).split('//')[0].matchAll(/\{([^}]+)\}/g)) {
      if (/^\d+$/.test(sym)) cost.generic += Number(sym);
      else if (sym === 'X') cost.x++;
      else if (COLORS.includes(sym) || sym === 'C') cost[sym]++;
      else if (/^[WUBRG]\/P$/.test(sym)) cost[sym[0]]++;
      else if (/^2\/[WUBRG]$/.test(sym)) cost[sym[2]]++;
      else if (/^[WUBRG]\/[WUBRG]$/.test(sym)) cost.hybrid.push(sym.split('/'));
      else if (sym === 'S') cost.generic++;
    }
    return cost;
  }

  const costTotal = (cost, x = 0) => cost.generic + cost.C + COLORS.reduce((s, k) => s + cost[k], 0) + cost.hybrid.length + cost.x * x;

  // マナを出せるもの → 出せる色の配列（'C' は無色）。出せなければ null
  // 土地は Scryfall の produced_mana（なければ基本土地タイプ）、ほかは「{T}: Add …」の文から
  function manaOf(c) {
    if (c.isLand) {
      const p = (c.produces ?? c.mana ?? []).filter((x) => x === 'C' || COLORS.includes(x));
      if (p.length) return p;
      const basic = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
      const t = Object.entries(basic).filter(([k]) => isType(c, k)).map(([, v]) => v);
      return t.length ? t : ['C'];
    }
    const m = /(?:^|\n)\{T\}: Add ([^.\n]+)\./.exec(c.oracle ?? '');
    if (!m) return null;
    const s = m[1];
    if (/any color/i.test(s)) return [...COLORS];
    const syms = [...s.matchAll(/\{([WUBRGC])\}/g)].map((x) => x[1]);
    return syms.length ? [...new Set(syms)] : null;
  }

  // 今マナを出せる（アンタップ状態で、クリーチャーなら召喚酔いしていない）もの
  // sick: (card) => 召喚酔いか
  function manaSources(cards, sick = () => false) {
    const out = [];
    for (const c of cards) {
      if (c.tapped) continue;
      const colors = manaOf(c);
      if (!colors) continue;
      if (!c.isLand && isCreature(c) && sick(c)) continue;
      out.push({ iid: c.iid, colors, land: !!c.isLand });
    }
    return out;
  }

  // コストを払える組み合わせを探す → タップするものの iid の配列（払えなければ null）
  // 色の決まったマナから順に、出せる色が少ないものを優先して割り当てる（多色土地はなるべく残す）
  function findPayment(sources, cost, x = 0) {
    const reqs = [];
    for (const k of [...COLORS, 'C']) for (let i = 0; i < cost[k]; i++) reqs.push([k]);
    for (const h of cost.hybrid) reqs.push(h);
    const generic = cost.generic + cost.x * x;
    if (reqs.length + generic > sources.length) return null;
    // 出せる色が少ないもの・土地を先に使う（マナ・クリーチャーはなるべく残す）
    const pool = [...sources].sort((a, b) => a.colors.length - b.colors.length || Number(b.land) - Number(a.land));
    reqs.sort((a, b) => pool.filter((s) => s.colors.some((c) => a.includes(c))).length - pool.filter((s) => s.colors.some((c) => b.includes(c))).length);
    const used = new Set();
    const assign = (i) => {
      if (i === reqs.length) return true;
      for (const s of pool) {
        if (used.has(s.iid) || !s.colors.some((c) => reqs[i].includes(c))) continue;
        used.add(s.iid);
        if (assign(i + 1)) return true;
        used.delete(s.iid);
      }
      return false;
    };
    if (!assign(0)) return null;
    const rest = pool.filter((s) => !used.has(s.iid)).sort((a, b) => Number(b.land) - Number(a.land) || a.colors.length - b.colors.length);
    if (rest.length < generic) return null;
    return [...used, ...rest.slice(0, generic).map((s) => s.iid)];
  }

  // 払えるうちで一番大きい X
  function maxX(sources, cost) {
    if (!cost.x) return 0;
    let x = 0;
    while (findPayment(sources, cost, x + 1)) x++;
    return x;
  }

  // ---------- 効果テキストの読み取り ----------

  // 自分の名前・「this creature」などを "this" に置き換え、注釈文（かっこ書き）を消して、小文字の文に分ける
  function sentencesOf(text, name) {
    let t = String(text ?? '').replace(/\([^)]*\)/g, '');
    const names = [name, name?.split(',')[0]].filter((n) => n && n.length > 2);
    for (const n of names) t = t.split(n).join('this');
    t = t.replace(/\bthis (?:creature|artifact|enchantment|land|spell|permanent)\b/gi, 'this');
    return t.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  const splitSentences = (line) => line.split(/\.(?:\s+|$)/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  // 「Flying, first strike」「Kicker {R}」のようなキーワードだけの行か
  function isKeywordLine(line, keywords) {
    if (/[.:]/.test(line.replace(/\{[^}]*\}/g, ''))) return false;
    const kws = keywords.map((k) => k.toLowerCase());
    return line.split(/[,;]/).every((part) => {
      const p = part.trim().toLowerCase();
      return !p || kws.some((k) => p.startsWith(k)) || /^(flying|first strike|double strike|trample|vigilance|haste|reach|deathtouch|lifelink|defender|menace|flash|shroud|hexproof|indestructible|fear|intimidate|shadow|banding|protection from|landwalk|\w+walk|cycling|echo|kicker|flashback|madness|morph|buyback|entwine|fading|vanishing|storm|affinity|equip|enchant)\b/.test(p);
    });
  }

  // 対象の条件: "nonblack creature" / "artifact or enchantment" / "tapped creature" など
  const TARGET_RE = '((?:(?:non[a-z]+|tapped|untapped|attacking|blocking|white|blue|black|red|green|attacking or blocking)[ ,]+)*)'
    + '(creature or player|creature or planeswalker|creature you control|creature an opponent controls|creature you don\'t control|creature|artifact or enchantment|artifact or creature|artifact|enchantment|nonland permanent|permanent|land|planeswalker)';

  function parseFilter(adjs, base) {
    const f = { types: [], non: [], colors: [], state: [] };
    if (base === 'creature or player' || base === 'creature or planeswalker') f.types = ['creature'];
    else if (base === 'creature you control') { f.types = ['creature']; f.side = 'me'; }
    else if (base === 'creature an opponent controls' || base === "creature you don't control") { f.types = ['creature']; f.side = 'opp'; }
    else if (base === 'artifact or enchantment') f.types = ['artifact', 'enchantment'];
    else if (base === 'artifact or creature') f.types = ['artifact', 'creature'];
    else if (base === 'nonland permanent') { f.types = ['permanent']; f.non.push('land'); }
    else f.types = [base];
    for (const w of adjs.split(/[ ,]+/).filter(Boolean)) {
      if (w.startsWith('non')) f.non.push(w.slice(3));
      else if (COLOR_WORDS[w]) f.colors.push(COLOR_WORDS[w]);
      else if (w !== 'or') f.state.push(w);
    }
    return f;
  }

  // カードが対象の条件を満たすか（盤面のカード・相手の snapshot のカードどちらでも）
  function matches(c, f) {
    if (!f) return true;
    if (!matchesKw(c, f)) return false;
    const typeOk = f.types.some((t) => (t === 'permanent' ? true : t === 'creature' ? isCreature(c) : isType(c, t)));
    if (!typeOk) return false;
    const cols = colorsOf(c);
    for (const n of f.non) {
      if (COLOR_WORDS[n] && cols.includes(COLOR_WORDS[n])) return false;
      if (n === 'land' && c.isLand) return false;
      if (['artifact', 'creature', 'enchantment'].includes(n) && (n === 'creature' ? isCreature(c) : isType(c, n))) return false;
    }
    if (f.colors.length && !f.colors.some((x) => cols.includes(x))) return false;
    for (const s of f.state) {
      if (s === 'tapped' && !c.tapped) return false;
      if (s === 'untapped' && c.tapped) return false;
      if (s === 'attacking' && !c.attacking) return false;
      if (s === 'blocking' && c.block == null && !c.blocking) return false;
      if (s === 'combat' && !c.attacking && c.block == null && !c.blocking) return false;
    }
    return true;
  }

  // 効果の対象の種類 → { kind: 'card' | 'player' | 'any', filter, players: ['me','opp'] }
  function damageTarget(s) {
    switch (s) {
      case 'any target':
      case 'target creature or player':
      case 'target creature or planeswalker or player': return { kind: 'any', filter: parseFilter('', 'creature') };
      case 'target creature':
      case 'target creature or planeswalker': return { kind: 'card', filter: parseFilter('', 'creature') };
      case 'target attacking creature': return { kind: 'card', filter: parseFilter('attacking ', 'creature') };
      case 'target attacking or blocking creature': return { kind: 'card', filter: { ...parseFilter('', 'creature'), state: [] } };
      case 'target creature with flying': return { kind: 'card', filter: { ...parseFilter('', 'creature'), kw: 'flying' } };
      case 'target creature without flying': return { kind: 'card', filter: { ...parseFilter('', 'creature'), nokw: 'flying' } };
      case 'target player':
      case 'target player or planeswalker': return { kind: 'player', players: ['me', 'opp'] };
      case 'target opponent':
      case 'target opponent or planeswalker':
      case 'each opponent': return { kind: 'player', players: ['opp'], auto: s.startsWith('each') };
      default: return null;
    }
  }

  const MASS = {
    'each creature': { types: ['creature'] },
    'each creature without flying': { types: ['creature'], nokw: 'flying' },
    'each creature with flying': { types: ['creature'], kw: 'flying' },
    'each other creature': { types: ['creature'], other: true },
    'each creature you don\'t control': { types: ['creature'], side: 'opp' },
    'each creature your opponents control': { types: ['creature'], side: 'opp' },
  };

  const PLURAL = { creatures: 'creature', artifacts: 'artifact', enchantments: 'enchantment', lands: 'land', 'nonland permanents': 'nonland permanent', 'artifacts and enchantments': 'artifact or enchantment' };

  // 1つの文 → 効果（読めなければ null）
  function parseSentence(s, card) {
    let m;
    // 唱えたあとで読む必要のない文
    if (/^(it|they) can't be regenerated$/.test(s)) return { type: 'none' };
    s = s.replace(/^(?:then )?you may /, '').replace(/^it /, 'this ');
    if (/^this deals damage equal to/.test(s)) return null;

    // ダメージ
    if ((m = new RegExp(`^this deals ${N} damage to (.+)$`).exec(s))) {
      const n = num(m[1]);
      const rest = m[2];
      if ((m = /^each creature and each player$|^each creature and each opponent$/.exec(rest))) {
        return { type: 'damageAll', n, filter: { types: ['creature'] }, players: rest.endsWith('player') ? ['me', 'opp'] : ['opp'] };
      }
      if ((m = /^each player$/.exec(rest))) return { type: 'damagePlayers', n, players: ['me', 'opp'] };
      if ((m = /^each opponent$|^target opponent$|^target opponent or planeswalker$/.exec(rest)) && rest.startsWith('each')) return { type: 'damagePlayers', n, players: ['opp'] };
      if (MASS[rest]) return { type: 'damageAll', n, filter: MASS[rest], players: [] };
      const t = damageTarget(rest);
      if (t) return { type: 'damage', n, target: t };
      return null;
    }

    // 破壊・追放・バウンス・タップ
    const tgt = (verb, tail = '') => new RegExp(`^${verb} target ${TARGET_RE}${tail}$`);
    if ((m = tgt('destroy').exec(s))) return { type: 'destroy', target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    if ((m = tgt('exile').exec(s))) return { type: 'exile', target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    if ((m = tgt('return', " to its owner's hand").exec(s))) return { type: 'bounce', target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    if ((m = tgt('tap').exec(s))) return { type: 'tap', target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    if ((m = tgt('untap').exec(s))) return { type: 'untap', target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    if ((m = /^destroy all (creatures|artifacts|enchantments|lands|nonland permanents|artifacts and enchantments)$/.exec(s))) {
      return { type: 'destroyAll', filter: parseFilter('', PLURAL[m[1]]) };
    }
    if ((m = /^destroy all (white|blue|black|red|green|non\w+) creatures$/.exec(s))) {
      return { type: 'destroyAll', filter: parseFilter(`${m[1]} `, 'creature') };
    }
    if ((m = /^return all creatures to their owners' hands$/.exec(s))) return { type: 'bounceAll', filter: parseFilter('', 'creature') };

    // ドロー・ライフ
    if ((m = new RegExp(`^(?:you )?draw ${N} cards?$`).exec(s))) return { type: 'draw', n: num(m[1]) };
    if ((m = new RegExp(`^target player draws ${N} cards?$`).exec(s))) return { type: 'draw', n: num(m[1]) };
    if ((m = new RegExp(`^(?:you )?gain ${N} life$`).exec(s))) return { type: 'gain', n: num(m[1]) };
    if ((m = new RegExp(`^(target player|target opponent|each opponent) loses ${N} life$`).exec(s))) {
      return { type: 'lose', n: num(m[2]), target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'], auto: m[1] === 'each opponent' } };
    }
    if ((m = new RegExp(`^(target player|target opponent|each opponent) discards ${N} cards?$`).exec(s))) {
      return { type: 'discard', n: num(m[2]), target: { kind: 'player', players: ['opp'], auto: true } };
    }

    // 修整・カウンター
    const KW = '(?: and gains? ([a-z ,]+?))?';
    if ((m = new RegExp(`^target ${TARGET_RE} gets ([+-]\\d+|[+-]x)/([+-]\\d+|[+-]x)${KW} until end of turn$`).exec(s))) {
      return { type: 'pump', p: m[3], t: m[4], kw: kwList(m[5]), target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    }
    if ((m = new RegExp(`^target ${TARGET_RE} gains ([a-z ,]+?) until end of turn$`).exec(s))) {
      return { type: 'pump', p: '+0', t: '+0', kw: kwList(m[3]), target: { kind: 'card', filter: parseFilter(m[1], m[2]) } };
    }
    if ((m = new RegExp(`^creatures you control get ([+-]\\d+)/([+-]\\d+)${KW} until end of turn$`).exec(s))) {
      return { type: 'pumpAll', p: m[1], t: m[2], kw: kwList(m[3]) };
    }
    if ((m = new RegExp(`^all creatures get ([+-]\\d+)/([+-]\\d+) until end of turn$`).exec(s))) {
      return { type: 'pumpAll', p: m[1], t: m[2], kw: [], both: true };
    }
    if ((m = new RegExp(`^put ${N} \\+1/\\+1 counters? on (target creature|this|target creature you control)$`).exec(s))) {
      const n = num(m[1]);
      return m[2] === 'this' ? { type: 'selfCounters', n } : { type: 'counters', n, target: { kind: 'card', filter: parseFilter('', m[2] === 'target creature' ? 'creature' : 'creature you control') } };
    }

    // トークン
    if ((m = new RegExp(`^create ${N} (\\d+)/(\\d+) ([a-z ]+?) creature tokens?(?: with ([a-z ,]+?))?$`).exec(s))) {
      const words = m[4].split(' ');
      const colors = words.filter((w) => COLOR_WORDS[w]).map((w) => COLOR_WORDS[w]);
      const subtypes = words.filter((w) => !COLOR_WORDS[w] && w !== 'and' && w !== 'colorless' && w !== 'artifact');
      const name = subtypes.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Token';
      return { type: 'token', n: num(m[1]), p: m[2], t: m[3], name, colors, artifact: words.includes('artifact'), kw: kwList(m[5]) };
    }

    // 土地を探す
    if ((m = new RegExp(`^search your library for (?:a|up to ${N}) basic land cards?(?:, reveal (?:it|them|those cards))?,? (?:and )?put (?:it|them|that card|those cards) (onto the battlefield(?: tapped)?|into your hand),? then shuffle(?: your library)?$`).exec(s))) {
      return { type: 'searchLand', n: m[1] ? num(m[1]) : 1, to: m[2].startsWith('onto') ? 'battlefield' : 'hand', tapped: m[2].endsWith('tapped') };
    }
    if (/^shuffle your library$/.test(s)) return { type: 'none' };
    return null;
  }

  const kwList = (s) => (s ? s.split(/,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean) : []);

  // カード → { spell: 呪文の効果, etb: 戦場に出たときの効果, manual: 読めなかった文, entersTapped }
  // 結果はカードの oracle ごとに覚えておく
  const cache = new Map();
  function parse(card) {
    const key = `${card.name}\u0000${card.oracle ?? ''}`;
    if (cache.has(key)) return cache.get(key);
    const out = { spell: [], etb: [], manual: [], entersTapped: false };
    const lines = sentencesOf(card.oracle, card.name);
    const permanent = isPermanentCard(card);
    for (const line of lines) {
      if (isKeywordLine(line, card.keywords ?? [])) continue;
      const lower = line.toLowerCase();
      if (/^this enters(?: the battlefield)? tapped\.?$/.test(lower)) { out.entersTapped = true; continue; }
      if (permanent) {
        // 戦場に出たとき
        const m = /^when(?:ever)? this enters(?: the battlefield)?(?: or [^,]+)?, (.+)$/.exec(lower);
        if (!m) continue; // 起動型能力・常在型能力などは対象外（手動 or ロードの計算）
        addParsed(out.etb, out.manual, splitSentences(m[1]), card, line);
        continue;
      }
      // インスタント・ソーサリー（「Choose one —」などの選択肢は読まない）
      if (/^choose /i.test(line) || line.startsWith('•')) { out.manual.push(line); continue; }
      addParsed(out.spell, out.manual, splitSentences(line), card, line);
    }
    cache.set(key, out);
    return out;
  }

  // 読めた文は効果に、読めなかった文は手動で処理する文に（読めない文の後ろの文は意味が変わることがあるので読まない）
  function addParsed(list, manual, sentences, card, line) {
    for (let i = 0; i < sentences.length; i++) {
      const fx = parseSentence(sentences[i], card);
      if (!fx) { manual.push(line); return; }
      if (fx.type !== 'none') list.push(fx);
    }
  }

  // 効果の対象として選べるか（プレイヤー or カード）
  const needsTarget = (fx) => !!fx.target && !fx.target.auto;

  // ---------- 効果 → 操作（op） ----------
  // 選んだ対象 chosen: { side: 'me' | 'opp', iid } または { side, player: true }
  // 戻り値: [{ side: 'me' | 'opp', op }]。op は applyOp で各プレイヤーの盤面に当てる

  function opsFor(fx, chosen, ctx) {
    const x = ctx.x ?? 0;
    const val = (n) => (n === 'X' ? x : n);
    const signed = (v) => (/x$/.test(v) ? (v.startsWith('-') ? -x : x) : Number(v));
    const out = [];
    const to = (side, op) => out.push({ side, op });
    switch (fx.type) {
      case 'damage':
      case 'lose':
        if (fx.target.auto) for (const p of fx.target.players) to(p, { op: fx.type === 'damage' ? 'damage' : 'lose', player: true, n: val(fx.n) });
        else if (chosen) to(chosen.side, chosen.player ? { op: fx.type === 'damage' ? 'damage' : 'lose', player: true, n: val(fx.n) } : { op: 'damage', iid: chosen.iid, n: val(fx.n) });
        break;
      case 'damagePlayers':
        for (const p of fx.players) to(p, { op: 'damage', player: true, n: val(fx.n) });
        break;
      case 'damageAll':
        for (const p of ['me', 'opp']) {
          if (fx.filter.side && fx.filter.side !== p) continue;
          to(p, { op: 'damageAll', n: val(fx.n), filter: fx.filter, except: fx.filter.other ? ctx.sourceIid : null });
        }
        for (const p of fx.players) to(p, { op: 'damage', player: true, n: val(fx.n) });
        break;
      case 'destroy':
      case 'exile':
      case 'bounce':
      case 'tap':
      case 'untap':
        if (chosen && !chosen.player) to(chosen.side, { op: fx.type, iid: chosen.iid });
        break;
      case 'destroyAll':
        to('me', { op: 'destroyAll', filter: fx.filter });
        to('opp', { op: 'destroyAll', filter: fx.filter });
        break;
      case 'bounceAll':
        to('me', { op: 'bounceAll', filter: fx.filter });
        to('opp', { op: 'bounceAll', filter: fx.filter });
        break;
      case 'pump':
        if (chosen && !chosen.player) to(chosen.side, { op: 'pump', iid: chosen.iid, p: signed(fx.p), t: signed(fx.t), kw: fx.kw });
        break;
      case 'pumpAll':
        to('me', { op: 'pumpAll', p: signed(fx.p), t: signed(fx.t), kw: fx.kw });
        if (fx.both) to('opp', { op: 'pumpAll', p: signed(fx.p), t: signed(fx.t), kw: fx.kw });
        break;
      case 'counters':
        if (chosen && !chosen.player) to(chosen.side, { op: 'counters', iid: chosen.iid, n: val(fx.n) });
        break;
      case 'selfCounters':
        if (ctx.sourceIid != null) to('me', { op: 'counters', iid: ctx.sourceIid, n: val(fx.n) });
        break;
      case 'draw': to('me', { op: 'draw', n: val(fx.n) }); break;
      case 'gain': to('me', { op: 'gain', n: val(fx.n) }); break;
      case 'discard': for (const p of fx.target.players) to(p, { op: 'discard', n: val(fx.n) }); break;
      case 'token': to('me', { op: 'token', n: val(fx.n), p: fx.p, t: fx.t, name: fx.name, colors: fx.colors, kw: fx.kw, artifact: fx.artifact }); break;
      case 'searchLand': to('me', { op: 'searchLand', n: val(fx.n), to: fx.to, tapped: fx.tapped }); break;
      default: break;
    }
    return out;
  }

  // ---------- 操作の適用 ----------
  // st: { cards, zones, life }、h: そのプレイヤーの処理
  //   h.move(iid, to)、h.setLife(v)、h.draw(n)、h.log(text)、h.token(spec)、h.discard(n)、h.searchLand(n, to, tapped)、h.sound(name)
  // カードの名前の表示用に、効果を起こしたカードの名前 src を受け取る

  const onBf = (st, iid) => st.zones.battlefield.includes(iid);

  function applyOp(st, op, h, src = '') {
    const c = op.iid != null ? st.cards[op.iid] : null;
    if (op.iid != null && (!c || !onBf(st, op.iid))) return; // 対象がもういない
    const by = src ? `${src}：` : '';
    switch (op.op) {
      case 'damage':
        if (op.player) {
          h.log(`${by}${op.n}点のダメージを受けた`);
          h.setLife(st.life - op.n);
        } else {
          c.damage = (c.damage || 0) + op.n;
          h.log(`${by}${c.name}に${op.n}点のダメージ`);
        }
        break;
      case 'lose':
        h.log(`${by}${op.n}点のライフを失った`);
        h.setLife(st.life - op.n);
        break;
      case 'damageAll':
        for (const iid of [...st.zones.battlefield]) {
          const x = st.cards[iid];
          if (iid === op.except || !isCreature(x) || !matchesKw(x, op.filter)) continue;
          x.damage = (x.damage || 0) + op.n;
        }
        h.log(`${by}クリーチャーに${op.n}点ずつダメージ`);
        break;
      case 'destroy':
        if (hasKw(c, 'indestructible')) { h.log(`${by}${c.name}は破壊されない（破壊不能）`); break; }
        h.log(`${by}${c.name}を破壊`);
        h.move(op.iid, 'graveyard');
        break;
      case 'destroyAll':
        for (const iid of [...st.zones.battlefield]) {
          const x = st.cards[iid];
          if (matches(x, op.filter) && !hasKw(x, 'indestructible')) h.move(iid, 'graveyard');
        }
        h.log(`${by}すべて破壊`);
        break;
      case 'exile':
        h.log(`${by}${c.name}を追放`);
        h.move(op.iid, 'exile');
        break;
      case 'bounce':
        h.log(`${by}${c.name}を手札に戻した`);
        h.move(op.iid, 'hand');
        break;
      case 'bounceAll':
        for (const iid of [...st.zones.battlefield]) if (matches(st.cards[iid], op.filter)) h.move(iid, 'hand');
        h.log(`${by}すべて手札に戻した`);
        break;
      case 'tap':
        c.tapped = true;
        h.log(`${by}${c.name}をタップ`);
        break;
      case 'untap':
        c.tapped = false;
        h.log(`${by}${c.name}をアンタップ`);
        break;
      case 'pump': {
        const m = c.ptMod ?? { p: 0, t: 0 };
        c.ptMod = { p: m.p + op.p, t: m.t + op.t };
        if (op.kw?.length) c.tempKw = [...new Set([...(c.tempKw ?? []), ...op.kw])];
        h.log(`${by}${c.name}はこのターン${fmt(op.p)}/${fmt(op.t)}${op.kw?.length ? `・${op.kw.join('、')}` : ''}`);
        break;
      }
      case 'pumpAll':
        for (const iid of st.zones.battlefield) {
          const x = st.cards[iid];
          if (!isCreature(x)) continue;
          const m = x.ptMod ?? { p: 0, t: 0 };
          x.ptMod = { p: m.p + op.p, t: m.t + op.t };
          if (op.kw?.length) x.tempKw = [...new Set([...(x.tempKw ?? []), ...op.kw])];
        }
        h.log(`${by}クリーチャーはこのターン${fmt(op.p)}/${fmt(op.t)}`);
        break;
      case 'counters':
        c.counters = (c.counters || 0) + op.n;
        h.log(`${by}${c.name}に+1/+1カウンター（${c.counters}）`);
        break;
      case 'draw':
        h.draw(op.n);
        break;
      case 'gain':
        h.log(`${by}${op.n}点のライフを得た`);
        h.setLife(st.life + op.n);
        break;
      case 'discard':
        h.discard(op.n, src);
        break;
      case 'token':
        for (let i = 0; i < op.n; i++) h.token(op);
        break;
      case 'searchLand':
        h.searchLand(op.n, op.to, op.tapped);
        break;
      default: break;
    }
  }

  const fmt = (n) => (n >= 0 ? `+${n}` : String(n));
  const matchesKw = (c, f) => (!f.kw || hasKw(c, f.kw)) && (!f.nokw || !hasKw(c, f.nokw));

  // 状況起因処理：致死ダメージを負った・タフネスが0以下のクリーチャーを墓地へ → 墓地へ置いたカードの名前
  function checkDeaths(st, move) {
    const dead = [];
    for (const iid of [...st.zones.battlefield]) {
      const c = st.cards[iid];
      if (!isCreature(c)) continue;
      const v = pt(c);
      if (!v) continue;
      if (v.t <= 0 || ((c.damage || 0) >= v.t && !hasKw(c, 'indestructible'))) {
        dead.push(c.name);
        move(iid, 'graveyard');
      }
    }
    return dead;
  }

  // ---------- ロード（常在型の修整） ----------
  // 「Creatures you control get +1/+1」「Other Goblin creatures you control get +1/+1」「Other Goblins get +1/+1 and have mountainwalk」
  // 「White creatures get +1/+1」など。自分の戦場のクリーチャーにだけ当てる（相手の分は相手が計算して送る）
  function applyStatics(st) {
    const bf = st.zones.battlefield.map((i) => st.cards[i]);
    for (const c of bf) c.smod = null;
    for (const src of bf) {
      for (const line of sentencesOf(src.oracle, src.name)) {
        for (const s of splitSentences(line)) {
          const m = /^(other )?(?:([a-z]+?) )?creatures(?: you control)? get \+(\d+)\/\+(\d+)(?: and have ([a-z ,]+))?$/.exec(s)
            ?? /^(other )?([a-z]+?)s get \+(\d+)\/\+(\d+)(?: and have ([a-z ,]+))?$/.exec(s);
          if (!m) continue;
          const [, other, word, p, t, kws] = m;
          for (const c of bf) {
            if (!isCreature(c) || (other && c === src)) continue;
            if (word && word !== 'all' && !(COLOR_WORDS[word] ? colorsOf(c).includes(COLOR_WORDS[word]) : new RegExp(`\\b${word}\\b`, 'i').test(c.typeLine ?? ''))) continue;
            const cur = c.smod ?? { p: 0, t: 0, kw: [] };
            c.smod = { p: cur.p + Number(p), t: cur.t + Number(t), kw: [...cur.kw, ...kwList(kws)] };
          }
        }
      }
    }
  }

  // ---------- 戦闘ダメージ ----------
  // attackers: 攻撃側のカード、blockers: [{ card, attacker: 攻撃クリーチャーの iid }]
  // 先制攻撃 → 通常の順に計算する。扱うキーワード：先制攻撃・二段攻撃・トランプル・接死・絆魂・破壊不能
  // 戻り値: { attackers, units, notes, toOpp, gain: { me, opp } }（me = 攻撃側、opp = 守る側）
  function combat(attackerCards, blockers) {
    const units = [];
    const notes = [];
    const unit = (side, c) => {
      const v = pt(c);
      if (!v) notes.push(`${c.name}はパワー／タフネスが分からないため、計算に入れていません`);
      const u = { side, card: c, name: c.name, p: v?.p ?? 0, t: v?.t ?? 0, known: !!v, dmg: c.damage || 0, hit: 0,
        deathtouched: false, alive: true, kw: new Set(kwOf(c)), blockers: [] };
      units.push(u);
      return u;
    };
    const attackers = attackerCards.map((c) => unit('me', c));
    for (const { card, attacker } of blockers) {
      const a = attackers.find((x) => x.card.iid === attacker);
      if (a) a.blockers.push(unit('opp', card));
    }
    for (const a of attackers) {
      a.blocked = a.blockers.length > 0;
      if (a.kw.has('menace') && a.blockers.length === 1) notes.push(`${a.name}は威迫を持っているので、1体ではブロックできません（このまま計算しています）`);
    }
    const r = { attackers, units, notes, toOpp: 0, gain: { me: 0, opp: 0 } };
    for (const firstStrike of [true, false]) {
      const deals = (u) => u.alive && u.known && u.p > 0 && (firstStrike
        ? u.kw.has('first strike') || u.kw.has('double strike')
        : !u.kw.has('first strike') || u.kw.has('double strike'));
      const events = [];
      for (const a of attackers) {
        if (!deals(a)) continue;
        if (!a.blocked) { events.push([null, a.p, a]); continue; }
        const alive = a.blockers.filter((b) => b.alive);
        let rest = a.p;
        alive.forEach((b, i) => {
          const lethal = !b.known ? 0 : a.kw.has('deathtouch') ? 1 : Math.max(0, b.t - b.dmg);
          const amount = i === alive.length - 1 && !a.kw.has('trample') ? rest : Math.min(rest, lethal);
          if (amount > 0) events.push([b, amount, a]);
          rest -= amount;
        });
        if (rest > 0 && a.kw.has('trample')) events.push([null, rest, a]);
      }
      for (const a of attackers) for (const b of a.blockers) if (a.alive && deals(b)) events.push([a, b.p, b]);
      for (const [target, amount, src] of events) {
        if (src.kw.has('lifelink')) r.gain[src.side] += amount;
        if (!target) { r.toOpp += amount; continue; }
        if (!target.known) continue;
        target.dmg += amount;
        target.hit += amount;
        if (src.kw.has('deathtouch')) target.deathtouched = true;
      }
      for (const u of units) {
        if (u.alive && u.known && !u.kw.has('indestructible') && (u.dmg >= u.t || (u.deathtouched && u.hit > 0))) u.alive = false;
      }
    }
    return r;
  }

  // ブロックできるか（飛行・到達、「ブロックされない」、シャドー、防衛は攻撃のみ）
  function canBlock(attacker, blocker) {
    if (!isCreature(blocker) || blocker.tapped) return false;
    const lines = sentencesOf(attacker.oracle, attacker.name).map((l) => l.toLowerCase());
    if (lines.includes("this can't be blocked.") || lines.includes('unblockable')) return false;
    if (hasKw(attacker, 'flying') && !hasKw(blocker, 'flying') && !hasKw(blocker, 'reach')) return false;
    if (hasKw(attacker, 'shadow') !== hasKw(blocker, 'shadow')) return false;
    if (hasKw(attacker, 'fear') && !isType(blocker, 'Artifact') && !colorsOf(blocker).includes('B')) return false;
    return true;
  }

  // 効果を日本語で短く説明（ログ・対象選択の表示用）
  function describe(fx) {
    const n = (v) => (v === 'X' ? 'X' : v);
    switch (fx.type) {
      case 'damage': return `${n(fx.n)}点のダメージ`;
      case 'damagePlayers':
      case 'damageAll': return `${n(fx.n)}点のダメージ（全体）`;
      case 'destroy': return '破壊';
      case 'exile': return '追放';
      case 'bounce': return '手札に戻す';
      case 'tap': return 'タップ';
      case 'untap': return 'アンタップ';
      case 'pump': return `${fx.p}/${fx.t}${fx.kw.length ? `・${fx.kw.join('、')}` : ''}`;
      case 'counters': return `+1/+1カウンター${n(fx.n)}個`;
      case 'lose': return `${n(fx.n)}点のライフを失う`;
      default: return '';
    }
  }

  // 相手に送る公開情報（ネット対戦・CPU対戦の snapshot の1枚分）
  function pub(c, block = null) {
    return {
      iid: c.iid, name: c.name, image: c.image, tapped: !!c.tapped, counters: c.counters || 0, attacking: !!c.attacking,
      isLand: !!c.isLand, isCreature: c.isCreature !== false, token: !!c.token,
      // 効果テキスト・P/T・キーワード（相手の画面での表示と、戦闘ダメージ・自動処理の計算に使う）
      typeLine: c.typeLine ?? '', text: c.text ?? '', oracle: c.oracle ?? '', power: c.power ?? null, toughness: c.toughness ?? null,
      keywords: c.keywords ?? [], tempKw: c.tempKw ?? [], smod: c.smod ?? null, ptMod: c.ptMod ?? null, damage: c.damage || 0,
      colors: colorsOf(c), cmc: c.cmc ?? 0, manaCost: c.manaCost ?? null,
      block,
    };
  }

  return {
    COLORS, pub, toNum, isType, isCreature, isPermanentCard, kwOf, hasKw, pt, colorsOf,
    parseCost, costTotal, manaOf, manaSources, findPayment, maxX,
    parse, parseSentence, needsTarget, matches, matchesKw, opsFor, applyOp, checkDeaths, applyStatics,
    combat, canBlock, describe,
  };
})();

if (typeof module !== 'undefined') module.exports = Rules;
