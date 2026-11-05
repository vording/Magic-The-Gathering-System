// Magic: The Gathering System — カードの効果テキスト → ルールエンジン用の定義
// 英語の Oracle テキストを1行ずつ読み、次のものに分ける（engine.js が使う）:
//   keywords   … キーワード能力（飛行・先制攻撃・プロテクション・〜渡り など）
//   spell      … インスタント・ソーサリーの効果
//   activated  … 起動型能力（「{T}: …」「{R}: …」「Sacrifice this: …」。マナ能力を含む）
//   triggers   … 誘発型能力（戦場に出たとき・死亡したとき・アップキープ・攻撃したとき など）
//   statics    … 常在型能力（ロード・オーラ・装備品・「ブロックできない」など）
//   echo / cycling / flashback / equip / enchant … キーワードのコスト
//   manual     … 読み取れなかった行（ログに出して手で処理してもらう）
// 個別のカードの定義は cards.js（CardOverrides）で上書き・追加できる。
// 効果1つの形は rules.js の parseSentence と同じ（{ type, n, target, … }）。ここで足りない文はこのファイルで読む。

const CardText = (() => {
  const R = () => Rules;
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const N = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+)';
  const num = (s) => (s === 'x' ? 'X' : NUM[s] ?? Number.parseInt(s, 10));
  const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  const KEYWORDS = ['flying', 'first strike', 'double strike', 'trample', 'vigilance', 'haste', 'reach', 'deathtouch', 'lifelink',
    'defender', 'menace', 'flash', 'shroud', 'hexproof', 'indestructible', 'fear', 'intimidate', 'shadow',
    'plainswalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk'];

  // 名前・「this creature」などを "this" に、注釈文を消す
  function linesOf(text, name) {
    let t = String(text ?? '').replace(/\([^)]*\)/g, '');
    for (const n of [name, name?.split(',')[0]].filter((x) => x && x.length > 2)) t = t.split(n).join('this');
    t = t.replace(/\bthis (?:creature|artifact|enchantment|land|spell|permanent|aura|equipment)\b/gi, 'this');
    return t.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  const sentences = (s) => s.split(/\.(?:\s+|$)/).map((x) => x.trim()).filter(Boolean);

  // ---------- コスト ----------

  // "{2}{R}, {T}, Sacrifice this, Pay 2 life, Discard a card" → { mana, tap, sacSelf, life, discard, sacType, removeCounter }
  function parseCost(text) {
    const cost = { mana: '', tap: false, untap: false, sacSelf: false, life: 0, discard: 0, discardSelf: false, sacType: null, removeCounter: 0, exileSelfFromGrave: false };
    for (const part of text.split(/,\s*/)) {
      const p = part.trim();
      const l = p.toLowerCase();
      if (/^(\{[^}]+\})+$/.test(p)) {
        for (const [, sym] of p.matchAll(/\{([^}]+)\}/g)) {
          if (sym === 'T') cost.tap = true;
          else if (sym === 'Q') cost.untap = true;
          else cost.mana += `{${sym}}`;
        }
      } else if (l === 'sacrifice this') cost.sacSelf = true;
      else if (l === 'discard this') cost.discardSelf = true;
      else if (l === 'discard a card') cost.discard = 1;
      else if (/^pay (\d+) life$/.test(l)) cost.life = Number(/^pay (\d+) life$/.exec(l)[1]);
      else if (/^sacrifice an? (creature|land|artifact|enchantment|goblin|forest|mountain|island|swamp|plains)$/.test(l)) cost.sacType = /^sacrifice an? (\w+)$/.exec(l)[1];
      else if (/^remove an? \+1\/\+1 counter from this$/.test(l)) cost.removeCounter = 1;
      else return null;
    }
    return cost;
  }
  const isCostText = (t) => parseCost(t) !== null;

  // ---------- 効果の文 ----------

  const TGT_SPELL = '(spell|creature spell|noncreature spell|instant spell|sorcery spell|instant or sorcery spell|artifact spell|enchantment spell|artifact or enchantment spell|(?:white|blue|black|red|green) spell)';
  function spellFilter(s) {
    if (s === 'spell') return {};
    if (s === 'creature spell') return { types: ['creature'] };
    if (s === 'noncreature spell') return { non: ['creature'] };
    if (s === 'instant spell') return { types: ['instant'] };
    if (s === 'sorcery spell') return { types: ['sorcery'] };
    if (s === 'instant or sorcery spell') return { types: ['instant', 'sorcery'] };
    if (s === 'artifact spell') return { types: ['artifact'] };
    if (s === 'enchantment spell') return { types: ['enchantment'] };
    if (s === 'artifact or enchantment spell') return { types: ['artifact', 'enchantment'] };
    const c = /^(\w+) spell$/.exec(s);
    return c && COLOR_WORDS[c[1]] ? { colors: [COLOR_WORDS[c[1]]] } : {};
  }

  // 「{R}{R}」「{R} or {G}」「one mana of any color」「{C}{C}」 → { colors: 選べる色, amount }
  function parseMana(s) {
    if (/^one mana of any color$/.test(s)) return { choices: ['W', 'U', 'B', 'R', 'G'], amount: 1 };
    if (/^two mana of any one color$/.test(s)) return { choices: ['W', 'U', 'B', 'R', 'G'], amount: 2 };
    const or = /^((?:\{[wubrgc]\})(?:, \{[wubrgc]\})*,? or \{[wubrgc]\})$/.exec(s);
    if (or) return { choices: [...or[1].matchAll(/\{([wubrgc])\}/g)].map((m) => m[1].toUpperCase()), amount: 1 };
    const all = /^((?:\{[wubrgc]\})+)$/.exec(s);
    if (all) {
      const syms = [...all[1].matchAll(/\{([wubrgc])\}/g)].map((m) => m[1].toUpperCase());
      return { fixed: syms, amount: syms.length };
    }
    return null;
  }

  // 1つの文（小文字、自分の名前は this）→ 効果。読めなければ null
  function effect(s, card) {
    let m;
    s = s.toLowerCase().replace(/^then /, '');
    // 打ち消し
    if ((m = new RegExp(`^counter target ${TGT_SPELL}(?: unless its controller pays \\{(\\d+)\\})?$`).exec(s))) {
      return { type: 'counter', target: { kind: 'spell', filter: spellFilter(m[1]) }, unless: m[2] ? Number(m[2]) : 0 };
    }
    // 再生
    if (s === 'regenerate this') return { type: 'regen', self: true };
    if (s === 'regenerate target creature') return { type: 'regen', target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: [] } } };
    // 自分の修整
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z ,]+?))? until end of turn$/.exec(s))) {
      return { type: 'selfPump', p: Number(m[1]), t: Number(m[2]), kw: kwList(m[3]) };
    }
    if ((m = /^this gains ([a-z ,]+?) until end of turn$/.exec(s))) return { type: 'selfPump', p: 0, t: 0, kw: kwList(m[1]) };
    // マナ
    if ((m = /^add (.+)$/.exec(s)) && parseMana(m[1])) return { type: 'addMana', mana: parseMana(m[1]) };
    if (s === 'sacrifice this') return { type: 'sacSelf' };
    if ((m = /^sacrifice this unless you pay (\{[^.]+\})$/.exec(s))) return { type: 'sacUnless', cost: m[1].toUpperCase() };
    if (s === 'prevent all combat damage that would be dealt this turn') return { type: 'fog' };
    if ((m = /^return target (creature )?card from your graveyard to your hand$/.exec(s))) {
      return { type: 'regrow', target: { kind: 'grave', filter: m[1] ? { types: ['creature'], non: [], colors: [], state: [] } : null } };
    }
    if ((m = new RegExp(`^each player draws ${N} cards?$`).exec(s))) return { type: 'drawEach', n: num(m[1]) };
    if ((m = new RegExp(`^you lose ${N} life$`).exec(s))) return { type: 'loseSelf', n: num(m[1]) };
    if ((m = new RegExp(`^this deals ${N} damage to you$`).exec(s))) return { type: 'loseSelf', n: num(m[1]), damage: true };
    if ((m = new RegExp(`^target player gains ${N} life$`).exec(s))) return { type: 'gain', n: num(m[1]) };
    if (s === 'target creature can\'t block this turn') return { type: 'cantBlock', target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: [] } } };
    if (/^(it|they) can't be regenerated$/.test(s)) return { type: 'noRegen' };
    if ((m = /^put a \+1\/\+1 counter on each creature you control$/.exec(s))) return { type: 'countersAll', n: 1 };
    if (s === 'untap all lands you control') return { type: 'untapLands' };
    if (s === 'tap all creatures your opponents control' || s === 'tap all creatures you don\'t control') return { type: 'tapAllOpp' };
    if ((m = /^creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn$/.exec(s))) return { type: 'pumpAll', p: m[1], t: m[2], kw: [], opp: true };
    if ((m = new RegExp(`^draw ${N} cards?, then discard ${N} cards?$`).exec(s))) return { type: 'loot', draw: num(m[1]), discard: num(m[2]) };
    if ((m = new RegExp(`^(?:you )?discard ${N} cards?$`).exec(s))) return { type: 'discardSelf', n: num(m[1]) };
    if ((m = new RegExp(`^(target player|target opponent|each opponent) mills ${N} cards?$`).exec(s))) return { type: 'mill', n: num(m[2]), target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'], auto: m[1] === 'each opponent' } };
    return R().parseSentence(s, card);
  }

  function effects(text, card) {
    const out = [];
    const ss = sentences(text);
    for (const s of ss) {
      const fx = effect(s, card);
      if (!fx) return null;
      if (fx.type === 'noRegen') {
        for (const f of out) if (f.type === 'destroy' || f.type === 'destroyAll') f.noRegen = true;
        continue;
      }
      if (fx.type !== 'none') out.push(fx);
    }
    return out;
  }

  const kwList = (s) => (s ? s.split(/,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean) : []);

  // ---------- 誘発条件 ----------

  const TRIGGERS = [
    [/^when this enters(?: the battlefield)?$/, 'etb'],
    [/^when this dies$|^when this is put into a graveyard from the battlefield$/, 'dies'],
    [/^at the beginning of your upkeep$/, 'upkeep'],
    [/^at the beginning of each upkeep$/, 'eachUpkeep'],
    [/^at the beginning of your end step$/, 'endstep'],
    [/^whenever this attacks$/, 'attacks'],
    [/^whenever this blocks$/, 'blocks'],
    [/^whenever this attacks or blocks$/, 'attacksOrBlocks'],
    [/^whenever this becomes blocked$/, 'becomesBlocked'],
    [/^whenever this deals combat damage to a player$/, 'combatDamagePlayer'],
    [/^whenever this deals damage to a player$/, 'combatDamagePlayer'],
    [/^when you cycle this$/, 'cycled'],
  ];

  // ---------- 常在型能力 ----------

  function staticOf(s) {
    let m;
    s = s.toLowerCase();
    // ロード
    if ((m = /^(other )?(?:([a-z]+?) )?creatures( you control)? get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))?$/.exec(s))) {
      return { kind: 'lord', other: !!m[1], word: m[2] ?? null, scope: m[3] ? 'you' : 'all', p: Number(m[4]), t: Number(m[5]), kw: kwList(m[6]) };
    }
    if ((m = /^(other )?([a-z]+?)s get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))?$/.exec(s)) && m[2] !== 'creature') {
      return { kind: 'lord', other: !!m[1], word: m[2], scope: 'all', p: Number(m[3]), t: Number(m[4]), kw: kwList(m[5]) };
    }
    if ((m = /^(other )?creatures you control have ([a-z ,]+)$/.exec(s))) return { kind: 'lord', other: !!m[1], word: null, scope: 'you', p: 0, t: 0, kw: kwList(m[2]) };
    // オーラ・装備品
    if ((m = /^(enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))?$/.exec(s))) {
      return { kind: 'attached', p: Number(m[2]), t: Number(m[3]), kw: kwList(m[4]) };
    }
    if ((m = /^(enchanted|equipped) creature has ([a-z ,]+)$/.exec(s))) return { kind: 'attached', p: 0, t: 0, kw: kwList(m[2]) };
    if (/^enchanted creature can't attack or block$/.test(s)) return { kind: 'attached', p: 0, t: 0, kw: [], cantAttack: true, cantBlock: true };
    if (/^enchanted creature can't attack$/.test(s)) return { kind: 'attached', p: 0, t: 0, kw: [], cantAttack: true };
    if (/^enchanted creature can't block$/.test(s)) return { kind: 'attached', p: 0, t: 0, kw: [], cantBlock: true };
    if (/^enchanted (creature|permanent|land) doesn't untap during its controller's untap step$/.test(s)) return { kind: 'attached', p: 0, t: 0, kw: [], noUntap: true };
    // 自分
    if (s === 'this can\'t block') return { kind: 'self', cantBlock: true };
    if (s === 'this can\'t attack') return { kind: 'self', cantAttack: true };
    if (s === 'this can\'t attack or block') return { kind: 'self', cantAttack: true, cantBlock: true };
    if (s === 'this can\'t be blocked' || s === 'unblockable') return { kind: 'self', unblockable: true };
    if (s === 'this doesn\'t untap during your untap step') return { kind: 'self', noUntap: true };
    if (s === 'this attacks each combat if able' || s === 'this attacks each turn if able') return { kind: 'self', mustAttack: true };
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+) as long as you control an? (\w+)$/.exec(s))) {
      return { kind: 'self', p: Number(m[1]), t: Number(m[2]), ifControl: m[3] };
    }
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+) as long as it's your turn$/.exec(s))) return { kind: 'self', p: Number(m[1]), t: Number(m[2]), ifMyTurn: true };
    if ((m = /^this has ([a-z ,]+) as long as you control an? (\w+)$/.exec(s))) return { kind: 'self', p: 0, t: 0, kw: kwList(m[1]), ifControl: m[2] };
    return null;
  }

  // ---------- キーワードの行 ----------

  // 「Flying, first strike」「Protection from red」「Echo {2}{G}」など → 読めた内容をカードに足す。読めなければ false
  function keywordLine(line, def) {
    const parts = line.split(/[,;]\s*/);
    const got = [];
    for (const part of parts) {
      const p = part.trim();
      const l = p.toLowerCase();
      let m;
      if (!p) continue;
      if (KEYWORDS.includes(l)) got.push(['kw', l]);
      else if ((m = /^protection from (white|blue|black|red|green|artifacts|creatures)$/.exec(l))) got.push(['kw', `protection from ${m[1]}`]);
      else if ((m = /^protection from (white|blue|black|red|green) and from (white|blue|black|red|green)$/.exec(l))) got.push(['kw', `protection from ${m[1]}`], ['kw', `protection from ${m[2]}`]);
      else if ((m = /^echo (\{[^ ]+\})$/i.exec(p))) got.push(['echo', m[1].toUpperCase()]);
      else if ((m = /^cycling (\{[^ ]+\})$/i.exec(p))) got.push(['cycling', m[1].toUpperCase()]);
      else if ((m = /^flashback (\{[^ ]+\})$/i.exec(p))) got.push(['flashback', m[1].toUpperCase()]);
      else if ((m = /^equip (\{[^ ]+\})$/i.exec(p))) got.push(['equip', m[1].toUpperCase()]);
      else if ((m = /^enchant (creature|land|artifact|enchantment|permanent|creature you control)$/.exec(l))) got.push(['enchant', m[1]]);
      else if ((m = /^(kicker|buyback|madness|morph|entwine|fading|vanishing|storm|affinity for \w+|bushido \d+|ninjutsu|splice onto arcane|landwalk|banding|rampage \d+|flanking|horsemanship|cumulative upkeep|phasing)\b/.exec(l))) got.push(['ignore', m[1]]);
      else if (/^(\{[^}]+\})+$/.test(p)) return false;
      else return false;
    }
    for (const [k, v] of got) {
      if (k === 'kw') def.keywords.push(v);
      else if (k === 'ignore') def.ignored.push(v);
      else if (k === 'enchant') def.enchant = v;
      else def[k] = v;
    }
    return got.length > 0;
  }

  // ---------- カード全体 ----------

  const cache = new Map();

  // card: デッキに保存したカード（name, typeLine, manaCost, cmc, oracleText, power, toughness, keywords, produced, colors）
  function compile(card) {
    const key = `${card.name}\u0000${card.oracleText ?? card.oracle ?? ''}\u0000${card.typeLine ?? ''}`;
    if (cache.has(key)) return structuredCloneSafe(cache.get(key));
    const typeLine = card.typeLine ?? '';
    const front = typeLine.split('//')[0];
    const types = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker'].filter((t) => new RegExp(`\\b${t}\\b`).test(front)).map((t) => t.toLowerCase());
    const def = {
      name: card.name,
      typeLine,
      types,
      subtypes: (front.split(/—|-/)[1] ?? '').trim().split(/\s+/).filter(Boolean),
      supertypes: ['Legendary', 'Basic', 'Snow'].filter((t) => new RegExp(`\\b${t}\\b`).test(front)).map((t) => t.toLowerCase()),
      manaCost: card.manaCost ?? null,
      cmc: card.cmc ?? 0,
      colors: Array.isArray(card.colors) ? card.colors : R().COLORS.filter((x) => (card.manaCost ?? '').includes(x)),
      power: card.power ?? null,
      toughness: card.toughness ?? null,
      keywords: [],
      produces: Array.isArray(card.produced) ? card.produced : null,
      spell: [],
      activated: [],
      triggers: [],
      statics: [],
      entersTapped: false,
      enchant: null,
      echo: null, cycling: null, flashback: null, equip: null,
      ignored: [],
      manual: [],
    };
    const lines = linesOf(card.oracleText ?? card.oracle ?? '', card.name);
    const permanent = !types.includes('instant') && !types.includes('sorcery');
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywordLine(line, def)) continue;
      if (/^this enters(?: the battlefield)? tapped\.?$/.test(lower)) { def.entersTapped = true; continue; }
      if (/^\(?\{t\}: add /i.test(line) && def.types.includes('land') && !/,/.test(line.split(':')[0])) {
        // 土地の基本的なマナ能力（下の起動型能力としても読む）
      }
      // 誘発型能力
      const trig = /^((?:when|whenever|at) [^,]+), (.+)$/i.exec(line);
      if (trig) {
        const cond = trig[1].toLowerCase();
        const kind = TRIGGERS.find(([re]) => re.test(cond))?.[1];
        const fx = kind ? effects(trig[2].replace(/^you may /i, ''), def) : null;
        if (kind && fx) {
          def.triggers.push({ event: kind, effects: fx, optional: /^you may /i.test(trig[2]), text: line });
          continue;
        }
        def.manual.push(line);
        continue;
      }
      // 起動型能力（「コスト: 効果」）
      const colon = line.indexOf(':');
      if (colon > 0 && isCostText(line.slice(0, colon))) {
        const cost = parseCost(line.slice(0, colon));
        let body = line.slice(colon + 1).trim();
        const sorcery = /activate only as a sorcery\.?/i.test(body);
        const once = /activate only once each turn\.?/i.test(body);
        body = body.replace(/\s*activate only as a sorcery\.?/i, '').replace(/\s*activate only once each turn\.?/i, '').trim();
        const fx = effects(body, def);
        if (fx && fx.length) {
          const mana = fx.length === 1 && fx[0].type === 'addMana' ? fx[0].mana : null;
          def.activated.push({ cost, effects: fx, mana, sorcery, once, text: line, fromHand: cost.discardSelf });
          continue;
        }
        def.manual.push(line);
        continue;
      }
      if (permanent) {
        const st = sentences(line).map(staticOf);
        if (st.length && st.every(Boolean)) { def.statics.push(...st); continue; }
        def.manual.push(line);
        continue;
      }
      // インスタント・ソーサリー
      if (/^choose /i.test(line) || line.startsWith('•')) { def.manual.push(line); continue; }
      const fx = effects(line, def);
      if (fx) def.spell.push(...fx);
      else def.manual.push(line);
    }
    // Scryfall のキーワード（Oracle の行で読めなかったものも）
    for (const k of card.keywords ?? []) {
      const l = k.toLowerCase();
      if (KEYWORDS.includes(l) && !def.keywords.includes(l)) def.keywords.push(l);
    }
    // 基本土地：マナ能力が注釈文だけなので足す
    if (def.types.includes('land') && !def.activated.some((a) => a.mana)) {
      const produced = (def.produces ?? []).filter((x) => 'WUBRGC'.includes(x));
      const basic = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
      const fromType = Object.entries(basic).filter(([t]) => new RegExp(`\\b${t}\\b`).test(front)).map(([, c]) => c);
      const choices = fromType.length ? fromType : produced;
      if (choices.length) def.activated.push({ cost: parseCost('{T}'), effects: [{ type: 'addMana', mana: { choices, amount: 1 } }], mana: { choices, amount: 1 }, text: '{T}: Add mana.' });
    }
    // サイクリング：手札から起動する能力として足す
    if (def.cycling) {
      const cost = parseCost(def.cycling) ?? parseCost('{2}');
      cost.discardSelf = true;
      def.activated.push({ cost, effects: [{ type: 'draw', n: 1 }], fromHand: true, cycling: true, text: `Cycling ${def.cycling}` });
    }
    if (def.equip) {
      def.activated.push({ cost: parseCost(def.equip), effects: [{ type: 'equip', target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: [], side: 'me' } } }], sorcery: true, text: `Equip ${def.equip}` });
    }
    // オーラは「対象を取る呪文」として唱える
    if (def.enchant) {
      const types = def.enchant === 'creature you control' ? ['creature'] : [def.enchant];
      def.auraTarget = { kind: 'card', filter: { types, non: [], colors: [], state: [], ...(def.enchant === 'creature you control' ? { side: 'me' } : {}) } };
    }
    const override = typeof CardOverrides !== 'undefined' ? CardOverrides[card.name] : null;
    if (override) override(def);
    def.support = def.manual.length ? (lines.length > def.manual.length ? 'partial' : 'none') : 'full';
    cache.set(key, def);
    return structuredCloneSafe(def);
  }

  const structuredCloneSafe = (x) => JSON.parse(JSON.stringify(x));

  return { compile, effects, effect, parseCost, parseMana, staticOf, linesOf };
})();

if (typeof module !== 'undefined') module.exports = CardText;
