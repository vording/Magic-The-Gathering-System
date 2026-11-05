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
    const short = /^(\w+) the /.exec(name ?? '')?.[1];
    for (const n of [name, name?.split(',')[0], short].filter((x) => x && x.length > 2)) t = t.split(n).join('this');
    t = t.replace(/\bthis (?:creature|artifact|enchantment|land|spell|permanent|aura|equipment|card)\b/gi, 'this');
    return t.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  const sentences = (s) => s.split(/\.(?:\s+|$)|,? then (?=discard|draw|you |sacrifice|return|untap)/).map((x) => x?.trim()).filter(Boolean);

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
      else if (/^discard (two|three) cards$/.test(l)) cost.discard = num(/^discard (\w+) cards$/.exec(l)[1]);
      else if (l === 'discard a land card') { cost.discard = 1; cost.discardType = 'land'; }
      else if (l === 'discard a card at random') { cost.discard = 1; cost.discardRandom = true; }
      else if (/^pay (\d+) life$/.test(l)) cost.life = Number(/^pay (\d+) life$/.exec(l)[1]);
      else if (/^sacrifice an? ([a-z]+)$/.test(l)) cost.sacType = /^sacrifice an? (\w+)$/.exec(l)[1];
      else if (/^sacrifice a permanent$/.test(l)) cost.sacType = 'permanent';
      else if (/^remove an? \+1\/\+1 counter from this$/.test(l)) cost.removeCounter = 1;
      else if (/^remove (two|three) \+1\/\+1 counters from this$/.test(l)) cost.removeCounter = num(/^remove (\w+) /.exec(l)[1]);
      else if (/^remove an? (\w+) counter from this$/.test(l)) cost.removeNamed = /^remove an? (\w+) counter from this$/.exec(l)[1];
      else if (/^remove (\w+) (\w+) counters from this$/.test(l)) { const m2 = /^remove (\w+) (\w+) counters from this$/.exec(l); cost.removeNamed = m2[2]; cost.removeNamedN = num(m2[1]); }
      else if (/^tap an untapped (creature|artifact|\w+) you control$/.test(l)) cost.tapOther = /^tap an untapped (\w+) you control$/.exec(l)[1];
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

  // ---------- 数（「〜の数に等しい」「〜1つにつき」） ----------

  const SUBJECTS = 'creatures?|lands?|artifacts?|enchantments?|permanents?|cards?|[a-z]+';
  // 「creatures you control」「Mountains you control」「creature cards in all graveyards」「cards in your hand」→ 数え方
  function parseCount(t) {
    let m;
    t = t.trim().replace(/^the number of /, '').replace(/^an? /, '');
    if (t === 'its power' || t === 'that creature\'s power' || t === 'the sacrificed creature\'s power') return { ref: t.startsWith('the sacrificed') ? 'sacPower' : 'targetPower' };
    if (t === 'its toughness' || t === 'that creature\'s toughness') return { ref: 'targetToughness' };
    if (t === 'your life total') return { ref: 'life' };
    if ((m = /^cards in (your|target player's|that player's|their|each player's) hand$/.exec(t))) return { zone: 'hand', who: m[1] === 'your' ? 'you' : m[1] === 'each player\'s' ? 'all' : 'target' };
    if ((m = /^cards in your hand$/.exec(t))) return { zone: 'hand', who: 'you' };
    if ((m = /^creatures? attacking you$/.exec(t))) return { zone: 'battlefield', who: 'opp', what: 'creature', adj: 'attacking' };
    if ((m = /^(?:(\w+) )?cards? in (your|all|target player's|that player's) graveyards?$/.exec(t))) {
      return { zone: 'graveyard', who: m[2] === 'your' ? 'you' : m[2] === 'all' ? 'all' : 'target', type: m[1] ?? null };
    }
    if ((m = new RegExp(`^(other )?(?:(untapped|tapped|attacking|white|blue|black|red|green|basic|artifact|nonblack) )?(${SUBJECTS})(?: (you control|on the battlefield|your opponents control|target opponent controls|that player controls|target player controls|defending player controls|they control))?$`).exec(t))) {
      const who = { 'you control': 'you', 'on the battlefield': 'all', 'your opponents control': 'opp', 'target opponent controls': 'opp', 'that player controls': 'target', 'target player controls': 'target', 'defending player controls': 'opp', 'they control': 'target' }[m[4]] ?? 'all';
      let what = m[3] === 'plains' ? 'plains' : m[3].replace(/(ies)$/, 'y').replace(/ves$/, 'f').replace(/s$/, '');
      return { zone: 'battlefield', who, what, adj: m[2] ?? null, other: !!m[1] };
    }
    if ((m = /^(?:basic )?land types among lands you control$/.exec(t))) return { ref: 'domain' };
    return null;
  }

  // 「damage equal to …」「X, where X is …」「N life for each …」を X にして、数え方を返す
  function normalizeAmount(s) {
    let m;
    let amount = null;
    if ((m = /^(.*?),? where x is (.+)$/.exec(s))) {
      const c = parseCount(m[2]);
      if (!c) return null;
      return { s: m[1], amount: { count: c } };
    }
    if ((m = /^(.*?)\bdamage to (.+?) equal to (the number of .+|its power|that creature's power)$/.exec(s))) {
      const c = parseCount(m[3]);
      if (!c) return null;
      return { s: `${m[1]}x damage to ${m[2]}`, amount: { count: c } };
    }
    if (/^you gain life equal to the damage dealt this way$/.test(s)) return { s: 'you gain x life', amount: { count: { ref: 'lastDamage' } } };
    if ((m = /^(.*?)\b(damage|life|cards?) equal to (the number of [^,]+?|its power|its toughness|that creature's power|the sacrificed creature's power|your life total)( to .+)?$/.exec(s))) {
      const c = parseCount(m[3]);
      if (!c) return null;
      return { s: `${m[1]}x ${m[2]}${m[4] ?? ''}`.replace(/draw x card$/, 'draw x cards'), amount: { count: c } };
    }
    if ((m = /^(.*?)\b(\w+) (damage|life|cards?) for each (.+?)( to .+)?$/.exec(s))) {
      const c = parseCount(m[4]);
      const k = num(m[2]);
      if (!c || !Number.isFinite(k)) return null;
      return { s: `${m[1]}x ${m[3]}${m[5] ?? ''}`.replace(/draw x card$/, 'draw x cards'), amount: { count: c, mult: k } };
    }
    if ((m = /^(.*?)gets \+(\d+)\/\+(\d+) (until end of turn )?for each (.+)$/.exec(s))) {
      const c = parseCount(m[5]);
      if (!c) return null;
      return { s: `${m[1]}gets +x/+x ${m[4] ?? ''}`.trim(), amount: { count: c, mult: Number(m[2]) } };
    }
    return amount;
  }

  // 1つの文（小文字、自分の名前は this）→ 効果。読めなければ null
  function effect(s, card) {
    s = s.toLowerCase().replace(/^then /, '').replace(/^domain — /, '');
    const n = normalizeAmount(s);
    if (n) {
      const fx = effect1(n.s, card);
      if (!fx) return null;
      if (Array.isArray(fx)) { for (const f of fx) f.amount = n.amount; return fx; }
      fx.amount = n.amount;
      return fx;
    }
    return effect1(s, card);
  }

  const T_CREATURE = () => ({ types: ['creature'], non: [], colors: [], state: [] });

  const SUBTYPE_WORDS = ['wall', 'goblin', 'elf', 'zombie', 'merfolk', 'dragon', 'sliver', 'island', 'swamp', 'forest', 'mountain', 'plains', 'knight', 'soldier', 'wizard', 'cleric', 'beast', 'bird'];

  // 「target …」の後ろ：「artifact, enchantment, or land」「blue or red creature」「creature with islandwalk」「creature you control」
  function targetPhrase(t) {
    let m;
    const f = { types: [], non: [], colors: [], state: [] };
    t = t.trim();
    if ((m = / you control$/.exec(t))) { f.side = 'me'; t = t.slice(0, m.index); }
    else if ((m = / (?:an opponent controls|you don't control)$/.exec(t))) { f.side = 'opp'; t = t.slice(0, m.index); }
    if ((m = / with (flying|islandwalk|swampwalk|forestwalk|mountainwalk|plainswalk|shadow|trample|first strike|defender)$/.exec(t))) { f.kw = m[1]; t = t.slice(0, m.index); }
    if ((m = / without flying$/.exec(t))) { f.nokw = 'flying'; t = t.slice(0, m.index); }
    if ((m = / with power (\d+) or (greater|less)$/.exec(t))) { f.power = { n: Number(m[1]), ge: m[2] === 'greater' }; t = t.slice(0, m.index); }
    if ((m = / blocking this$/.exec(t))) { f.state.push('blocking'); t = t.slice(0, m.index); }
    if ((m = / with mana value (\d+) or (greater|less)$/.exec(t))) { f.cmc = { n: Number(m[1]), ge: m[2] === 'greater' }; t = t.slice(0, m.index); }
    if ((m = /^blocked /.exec(t))) { f.state.push('blocked'); t = t.slice(m[0].length); }
    if ((m = /^(?:non-)?([a-z]+)$/.exec(t)) && SUBTYPE_WORDS.includes(m[1])) return { kind: 'card', filter: { ...f, types: ['permanent'], subtypes: [m[1]] } };
    const words = t.replace(/,? or |, /g, ' | ').split(' | ').map((x) => x.trim()).filter(Boolean);
    const BASE = ['creature', 'artifact', 'enchantment', 'land', 'permanent', 'planeswalker'];
    const last = words.at(-1)?.split(' ') ?? [];
    for (const w of words) {
      const parts = w.split(' ');
      const base = parts.at(-1);
      for (const a of parts.slice(0, -1)) {
        if (a.startsWith('non')) f.non.push(a.slice(3));
        else if (COLOR_WORDS[a]) f.colors.push(COLOR_WORDS[a]);
        else if (['tapped', 'untapped', 'attacking', 'blocking'].includes(a)) f.state.push(a);
        else return null;
      }
      if (COLOR_WORDS[base]) { f.colors.push(COLOR_WORDS[base]); continue; } // 「blue or red creature」の blue
      if (base === 'player' || base === 'opponent') return null;
      if (!BASE.includes(base)) return null;
      if (base === 'permanent' && parts.includes('nonland')) { f.types.push('permanent'); continue; }
      f.types.push(base);
    }
    if (!f.types.length && last.length) f.types.push('creature');
    return { kind: 'card', filter: f };
  }

  function effect1(s, card) {
    let m;
    // 「〜 and you gain N life」「〜 and you lose N life」
    if ((m = /^(.+?) and you (gain|lose) (\w+) life$/.exec(s)) && !/^you /.test(s)) {
      const a = effect1(m[1], card);
      return a ? [...(Array.isArray(a) ? a : [a]), { type: m[2] === 'gain' ? 'gain' : 'loseSelf', n: num(m[3]) }] : null;
    }
    if ((m = /^(that creature|it) can't be regenerated$/.exec(s))) return { type: 'noRegen' };
    if ((m = new RegExp(`^each player loses ${N} life$`).exec(s))) return { type: 'lose', n: num(m[1]), target: { kind: 'player', players: ['me', 'opp'], auto: true } };
    if ((m = /^you lose life equal to (?:that creature's|its) (toughness|power)$/.exec(s))) return { type: 'loseSelf', n: 'X', amount: { count: { ref: m[1] === 'power' ? 'targetPower' : 'targetToughness' } } };
    if ((m = new RegExp(`^its controller gains ${N} life$`).exec(s))) return { type: 'gainTargetController', n: num(m[1]) };
    if ((m = /^destroy all ((?:artifacts|creatures|enchantments|lands)(?:, (?:artifacts|creatures|enchantments|lands))*,? and (?:artifacts|creatures|enchantments|lands))$/.exec(s))) {
      return { type: 'destroyAll', filter: { types: m[1].replace(/,? and |, /g, ' ').split(' ').map((w) => w.replace(/s$/, '')), non: [], colors: [], state: [] } };
    }
    if (s === 'destroy all creatures you don\'t control') return { type: 'destroyAll', filter: { types: ['creature'], non: [], colors: [], state: [], side: 'opp' } };
    if ((m = /^return all (permanents|artifacts|creatures|enchantments|lands) to their owners' hands$/.exec(s))) return { type: 'bounceAll', filter: { types: [m[1].replace(/s$/, '')], non: [], colors: [], state: [] } };
    if ((m = /^attacking creatures( you control)? get ([+-]\d+)\/([+-]\d+) until end of turn$/.exec(s))) return { type: 'pumpAll', p: m[2], t: m[3], kw: [], attacking: true, both: !m[1] };
    if (s === 'tap all other creatures') return { type: 'tapAll', filter: { types: ['creature'], non: [], colors: [], state: [] }, other: true };
    if ((m = /^put target (.+?) on top of its owner's library$/.exec(s))) {
      const t = targetPhrase(m[1]);
      return t ? { type: 'topdeck', target: t } : null;
    }
    if ((m = /^put target card from your graveyard on top of your library$/.exec(s))) return { type: 'regrow', to: 'top', target: { kind: 'grave', filter: null } };
    if ((m = /^return target (white|blue|black|red|green) card from your graveyard to your hand$/.exec(s))) return { type: 'regrow', to: 'hand', target: { kind: 'grave', filter: { types: ['permanent', 'instant', 'sorcery'], non: [], colors: [COLOR_WORDS[m[1]]], state: [] } } };
    if ((m = /^return target (goblin|zombie|elf|wizard|sliver|knight|soldier|beast|basic land) card from your graveyard to your hand$/.exec(s))) {
      return { type: 'regrow', to: 'hand', target: { kind: 'grave', filter: m[1] === 'basic land' ? { types: ['land'], non: [], colors: [], state: [], basic: true } : { types: ['permanent'], non: [], colors: [], state: [], subtypes: [m[1]] } } };
    }
    if ((m = /^return target creature card with mana value (\d+) or less from your graveyard to (the battlefield|your hand)$/.exec(s))) {
      return { type: 'regrow', to: m[2] === 'the battlefield' ? 'battlefield' : 'hand', target: { kind: 'grave', filter: { types: ['creature'], non: [], colors: [], state: [], cmc: { n: Number(m[1]), ge: false } } } };
    }
    if ((m = /^return (a|an) (creature|land|elf|forest) you control to its owner's hand$/.exec(s))) return { type: 'returnOwn', what: m[2] };
    if ((m = /^(target player|target opponent) sacrifices an attacking creature(?: of their choice)?$/.exec(s))) return { type: 'sacrifice', n: 1, what: 'attacking creature', target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'] } };
    // 「It gets …」：前の文の対象（Inspirit など）
    if ((m = /^it gets ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and gains ([a-z ,]+?))? until end of turn$/.exec(s))) return { type: 'pump', p: m[1], t: m[2], kw: kwList(m[3]), sameTarget: true };
    if ((m = /^(?:it|this) gets ([+-]\d+)\/([+-]\d+) until end of turn$/.exec(s))) return { type: 'selfPump', p: Number(m[1]), t: Number(m[2]), kw: [] };
    if (s === 'put a +1/+1 counter on it' || s === 'put a +1/+1 counter on this') return { type: 'selfCounters', n: 1 };
    // すべての〜（土地タイプ・色）
    if ((m = /^destroy all (islands|plains|swamps|mountains|forests|walls)$/.exec(s))) return { type: 'destroyAll', filter: { types: ['permanent'], non: [], colors: [], state: [], subtypes: [m[1].replace(/s$/, '')] } };
    if ((m = /^return all (white|blue|black|red|green) permanents to their owners' hands$/.exec(s))) return { type: 'bounceAll', filter: { types: ['permanent'], non: [], colors: [COLOR_WORDS[m[1]]], state: [] } };
    if ((m = /^tap all creatures( without flying| with flying)?$/.exec(s))) return { type: 'tapAll', filter: { types: ['creature'], non: [], colors: [], state: [], ...(m[1] === ' without flying' ? { nokw: 'flying' } : m[1] ? { kw: 'flying' } : {}) } };
    if ((m = /^all creatures get ([+-]x|[+-]\d+)\/([+-]x|[+-]\d+) until end of turn$/.exec(s))) return { type: 'pumpAll', p: m[1], t: m[2], kw: [], both: true };
    if ((m = new RegExp(`^(?:you )?discard ${N} cards? at random$`).exec(s))) return { type: 'discardRandom', n: num(m[1]), target: { kind: 'player', players: ['me'], auto: true } };
    if ((m = new RegExp(`^this deals ${N} damage to you unless you pay (\\{[^.]+\\})$`).exec(s))) return { type: 'payOr', cost: m[2].toUpperCase(), effects: [{ type: 'loseSelf', n: num(m[1]), damage: true }] };
    if ((m = /^target creature with power (\d+) or less can't be blocked this turn$/.exec(s))) return { type: 'unblockable', target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: [], power: { n: Number(m[1]), ge: false } } } };
    if (s === 'target creature can\'t be blocked this turn') return { type: 'unblockable', target: { kind: 'card', filter: T_CREATURE() } };
    if ((m = /^the next time an? (white|blue|black|red|green|artifact) source of your choice would deal damage to you this turn, prevent that damage$/.exec(s))) return { type: 'cop', what: m[1] };
    if (s === 'spend only black mana on x' || s === 'spend only red mana on x') return { type: 'none' };
    if ((m = /^you gain life equal to its mana value$/.exec(s))) return { type: 'gain', n: 'X', amount: { count: { ref: 'targetCmc' } } };
    // 「つけている」クリーチャーへの効果（オーラ・装備品の起動型能力）
    if (s === 'regenerate enchanted creature' || s === 'regenerate equipped creature') return { type: 'regen', attached: true };
    if ((m = /^(?:enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?: and gains ([a-z ,]+?))? until end of turn$/.exec(s))) return { type: 'pumpAttached', p: Number(m[1]), t: Number(m[2]), kw: kwList(m[3]) };
    if ((m = /^(?:enchanted|equipped) creature gains ([a-z ,]+?) until end of turn$/.exec(s))) return { type: 'pumpAttached', p: 0, t: 0, kw: kwList(m[1]) };
    if (s === 'return enchanted creature to its owner\'s hand') return { type: 'bounceAttached' };
    // カウンター（+1/+1 以外の名前のあるもの）
    if ((m = /^put an? (\w+) counter on this$/.exec(s)) && m[1] !== '+1/+1') return { type: 'addNamed', name: m[1], n: 1 };
    if ((m = /^if there are no (\w+) counters on this, sacrifice (?:it|this)$/.exec(s))) return { type: 'sacIfNoCounters', name: m[1] };
    // 占術・上から見る
    if ((m = new RegExp(`^scry ${N}$`).exec(s))) return { type: 'scry', n: num(m[1]) };
    if ((m = new RegExp(`^look at the top ${N} cards of your library$`).exec(s))) return { type: 'look', n: num(m[1]) };
    if ((m = /^put (?:one|a card) of them into your hand and the (?:other|rest) (on the bottom of your library(?: in any order)?|into your graveyard)$/.exec(s))) {
      return { type: 'lookPick', rest: m[1].startsWith('on the bottom') ? 'bottom' : 'graveyard' };
    }
    if ((m = new RegExp(`^look at the top ${N} cards of your library, then put them back in any order$`).exec(s))) return { type: 'reorder', n: num(m[1]) };
    if (s === 'put them back in any order') return { type: 'reorderLooked' };
    if (s === 'sacrifice all creatures you control') return { type: 'sacAll', what: 'creature' };
    if ((m = new RegExp(`^untap up to ${N} lands$`).exec(s))) return { type: 'untapLandsN', n: num(m[1]) };
    if ((m = /^add \{([wubrgc])\} for each (.+)$/.exec(s))) {
      const c = parseCount(m[2]);
      return c ? { type: 'addMana', mana: { fixed: [m[1].toUpperCase()], amount: 1 }, amount: { count: c } } : null;
    }
    if (s === 'exile target card from a graveyard') return { type: 'exileGrave', target: { kind: 'anyGrave', filter: null } };
    if (s === 'exile all cards from target player\'s graveyard') return { type: 'exileGraveAll', target: { kind: 'player', players: ['me', 'opp'] } };
    if ((m = new RegExp(`^(target player|target opponent) loses ${N} life$`).exec(s))) return { type: 'lose', n: num(m[2]), target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'] } };
    // 複合の文：「〜にNダメージと、あなたにMダメージ」「〜にNダメージを与え、あなたはMライフを得る」
    if ((m = /^this deals (\w+) damage to (.+?) and (\w+) damage to you$/.exec(s))) {
      const a = effect1(`this deals ${m[1]} damage to ${m[2]}`, card);
      return a ? [a, { type: 'loseSelf', n: num(m[3]), damage: true }] : null;
    }
    if ((m = /^this deals (\w+) damage to (.+?) and you gain (\w+) life$/.exec(s))) {
      const a = effect1(`this deals ${m[1]} damage to ${m[2]}`, card);
      return a ? [a, { type: 'gain', n: num(m[3]) }] : null;
    }
    if ((m = /^this deals (\w+) damage to (each creature(?: with flying| without flying)?) and each (player|opponent)$/.exec(s))) {
      const a = effect1(`this deals ${m[1]} damage to ${m[2]}`, card);
      if (!a) return null;
      a.players = m[3] === 'player' ? ['me', 'opp'] : ['opp'];
      return a;
    }
    if ((m = new RegExp(`^you draw ${N} cards? and (?:you )?lose ${N} life$`).exec(s))) return [{ type: 'draw', n: num(m[1]) }, { type: 'loseSelf', n: num(m[2]) }];
    if ((m = new RegExp(`^draw ${N} cards? and (?:you )?lose ${N} life$`).exec(s))) return [{ type: 'draw', n: num(m[1]) }, { type: 'loseSelf', n: num(m[2]) }];
    if (/^an? creature dealt damage this way can't be regenerated this turn$/.test(s)) return { type: 'none' };
    // 生け贄
    if ((m = new RegExp(`^(each player|each opponent|each other player|target player|target opponent) sacrifices ${N} (creatures?|lands?|artifacts?|enchantments?|permanents?)(?: of their choice)?$`).exec(s))) {
      const who = m[1].startsWith('each') ? (m[1] === 'each player' ? ['me', 'opp'] : ['opp']) : null;
      return { type: 'sacrifice', n: num(m[2]), what: m[3].replace(/s$/, ''), target: who ? { kind: 'player', players: who, auto: true } : { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'] } };
    }
    if ((m = /^sacrifice an? (creature|land|artifact|enchantment|permanent)$/.exec(s))) return { type: 'sacrifice', n: 1, what: m[1], target: { kind: 'player', players: ['me'], auto: true } };
    // 探す（「Goblin card」「creature card with mana value 6 or greater」「Swamp or Mountain card」「card」）
    if ((m = /^search your library for (a|an|up to (?:one|two|three|four))(?: (.+?))? cards?(?:, reveal (?:it|that card|them|those cards))?,? (?:and )?put (?:it|that card|them|those cards) (into your hand|onto the battlefield(?: tapped)?|on top of your library|into your graveyard),? (?:then shuffle(?: your library)?|and shuffle)(?: afterward)?$/.exec(s))) {
      const nmax = m[1].startsWith('up to') ? num(m[1].split(' ')[2]) : 1;
      const filter = searchFilter(m[2] ?? '');
      if (!filter) return null;
      const dest = m[3].startsWith('into your hand') ? 'hand' : m[3].startsWith('onto') ? 'battlefield' : m[3].startsWith('on top') ? 'top' : 'graveyard';
      return { type: 'search', n: nmax, filter, to: dest, tapped: m[3].endsWith('tapped') };
    }
    // 墓地から戻す
    if ((m = /^return target (creature |artifact |enchantment |instant |sorcery |land |instant or sorcery |artifact or enchantment )?card from your graveyard to (your hand|the battlefield|the top of your library)$/.exec(s))) {
      const t = m[1]?.trim();
      const types = t ? t.split(' or ') : null;
      return { type: 'regrow', to: m[2] === 'your hand' ? 'hand' : m[2] === 'the battlefield' ? 'battlefield' : 'top', target: { kind: 'grave', filter: types ? { types, non: [], colors: [], state: [] } : null } };
    }
    if (s === 'return this to its owner\'s hand') return { type: 'bounceSelf' };
    if (s === 'return it to its owner\'s hand' || s === 'return this from your graveyard to your hand' || s === 'return this card from your graveyard to your hand') return { type: 'regrowSelf' };
    if (s === 'untap this') return { type: 'untapSelf' };
    if (s === 'tap this') return { type: 'tapSelf' };
    if ((m = /^(?:you may )?tap or untap target (.+)$/.exec(s))) return { type: 'tapOrUntap', target: { kind: 'card', filter: { types: m[1].replace(/,? or /g, ', ').split(/,\s*/).map((x) => x.trim()), non: [], colors: [], state: [] } } };
    if ((m = new RegExp(`^prevent the next ${N} damage that would be dealt to (any target|target creature|target creature or player|you) this turn$`).exec(s))) {
      return { type: 'prevent', n: num(m[1]), target: m[2] === 'you' ? { kind: 'player', players: ['me'], auto: true } : { kind: m[2] === 'target creature' ? 'card' : 'any', filter: T_CREATURE() } };
    }
    if (s === 'prevent all combat damage that would be dealt by target creature this turn') return { type: 'preventBy', target: { kind: 'card', filter: T_CREATURE() } };
    if ((m = /^destroy target (attacking|blocking|attacking or blocking) creature$/.exec(s))) return { type: 'destroy', target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: m[1] === 'attacking or blocking' ? ['combat'] : [m[1]] } } };
    if ((m = /^this deals (\w+) damage to target (attacking|blocking|attacking or blocking) creature$/.exec(s))) return { type: 'damage', n: num(m[1]), target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: m[2] === 'attacking or blocking' ? ['combat'] : [m[2]] } } };
    if ((m = /^this deals (\w+) damage to target (attacking )?creature with flying$/.exec(s))) return { type: 'damage', n: num(m[1]), target: { kind: 'card', filter: { types: ['creature'], non: [], colors: [], state: m[2] ? ['attacking'] : [], kw: 'flying' } } };
    if ((m = /^this deals (\w+) damage to each (attacking|blocking) creature$/.exec(s))) return { type: 'damageAll', n: num(m[1]), filter: { types: ['creature'], state: [m[2]] }, players: [] };
    if ((m = /^(?:you )?gain life equal to (?:its|that creature's) (power|toughness)$/.exec(s))) return { type: 'gain', n: 'X', amount: { count: { ref: m[1] === 'power' ? 'targetPower' : 'targetToughness' } } };
    if ((m = /^its controller gains life equal to its (power|toughness)$/.exec(s))) return { type: 'gainTargetController', n: 'X', amount: { count: { ref: m[1] === 'power' ? 'targetPower' : 'targetToughness' } } };
    if (s === 'each player discards their hand') return { type: 'discardHand', target: { kind: 'player', players: ['me', 'opp'], auto: true } };
    if ((m = /^(target player|target opponent|that player|each opponent) discards a card at random$/.exec(s))) return { type: 'discardRandom', n: 1, target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'], auto: m[1] === 'each opponent' } };
    if ((m = /^(target opponent|target player) reveals their hand$/.exec(s))) return { type: 'reveal', target: { kind: 'player', players: m[1] === 'target player' ? ['me', 'opp'] : ['opp'] } };
    if ((m = /^you choose an?(?: (.+?))? card from it$/.exec(s))) return { type: 'chooseFromHand', filter: handFilter(m[1] ?? '') };
    if (s === 'that player discards that card') return { type: 'none' };
    if ((m = new RegExp(`^put ${N} \\+1/\\+1 counters? on each creature you control$`).exec(s))) return { type: 'countersAll', n: num(m[1]) };
    if ((m = new RegExp(`^put ${N} -1/-1 counters? on target creature$`).exec(s))) return { type: 'counters', n: num(m[1]), minus: true, target: { kind: 'card', filter: T_CREATURE() } };
    if ((m = /^(?:you may )?untap target (creature|permanent|land|artifact)$/.exec(s))) return { type: 'untap', target: { kind: 'card', filter: { types: [m[1]], non: [], colors: [], state: [] } } };
    if ((m = new RegExp(`^tap up to ${N} target creatures$`).exec(s))) return { type: 'tap', target: { kind: 'card', filter: T_CREATURE() }, upTo: num(m[1]) };
    return effect0(s, card);
  }

  // 探すカードの条件
  function searchFilter(t) {
    let m;
    if (t === 'basic land') return { types: ['land'], basic: true };
    if (t === '') return {};
    if (t === 'creature' || t === 'artifact' || t === 'enchantment' || t === 'land' || t === 'instant' || t === 'sorcery') return { types: [t] };
    if ((m = /^(white|blue|black|red|green) (instant|sorcery|creature|enchantment|artifact)$/.exec(t))) return { types: [m[2]], colors: [COLOR_WORDS[m[1]]] };
    if ((m = /^(creature|artifact) with mana value (\d+) or (greater|less)$/.exec(t))) return { types: [m[1]], cmc: Number(m[2]), cmpGE: m[3] === 'greater' };
    if ((m = /^creature with power (\d+) or (greater|less)$/.exec(t))) return { types: ['creature'], power: Number(m[1]), powerGE: m[2] === 'greater' };
    if ((m = /^(\w+) permanent$/.exec(t))) return { subtypes: [m[1]] };
    if ((m = /^(\w+) or (\w+)$/.exec(t)) && !['creature', 'artifact'].includes(m[1])) return { subtypes: [m[1], m[2]] };
    if ((m = /^(\w+)$/.exec(t))) return { subtypes: [m[1]] };
    if ((m = /^basic (plains|island|swamp|mountain|forest)$/.exec(t))) return { types: ['land'], basic: true, subtypes: [m[1]] };
    return null;
  }

  // 手札から選ぶカードの条件（「noncreature, nonland」「nonland」など）
  function handFilter(t) {
    const f = { types: [], non: [] };
    for (const w of t.split(/[ ,]+/).filter(Boolean)) {
      if (w.startsWith('non')) f.non.push(w.slice(3));
      else if (w !== 'or' && w !== 'card') f.types.push(w);
    }
    return f;
  }

  function effect0(s, card) {
    let m;
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
    const r = R().parseSentence(s, card);
    if (r) return r;
    return generic(s);
  }

  // 対象を取るよくある文（rules.js で読めなかった対象の書き方）
  function generic(s) {
    let m;
    if ((m = /^(destroy|exile|tap|untap) target (.+)$/.exec(s))) {
      const t = targetPhrase(m[2]);
      return t ? { type: m[1], target: t } : null;
    }
    if ((m = /^return target (.+?) to its owner's hand$/.exec(s))) {
      const t = targetPhrase(m[1]);
      return t ? { type: 'bounce', target: t } : null;
    }
    if ((m = /^target (.+?) gets ([+-]\d+|[+-]x)\/([+-]\d+|[+-]x)(?: and gains ([a-z ,]+?))? until end of turn$/.exec(s))) {
      const t = targetPhrase(m[1]);
      return t ? { type: 'pump', p: m[2], t: m[3], kw: kwList(m[4]), target: t } : null;
    }
    if ((m = /^target (.+?) gains ([a-z ,]+?) until end of turn$/.exec(s))) {
      const t = targetPhrase(m[1]);
      return t ? { type: 'pump', p: '+0', t: '+0', kw: kwList(m[2]), target: t } : null;
    }
    if ((m = new RegExp(`^this deals ${N} damage to target (.+)$`).exec(s))) {
      const t = targetPhrase(m[2]);
      return t ? { type: 'damage', n: num(m[1]), target: t } : null;
    }
    if ((m = new RegExp(`^put ${N} \\+1/\\+1 counters? on target (.+)$`).exec(s))) {
      const t = targetPhrase(m[2]);
      return t ? { type: 'counters', n: num(m[1]), target: t } : null;
    }
    return null;
  }

  function effects(text, card) {
    const out = [];
    const ss = sentences(text);
    for (let i = 0; i < ss.length; i++) {
      let s = ss[i];
      // 「You may pay {1}. If you do, …」
      const pay = /^you may pay (\{[^.]+\})$/i.exec(s);
      const then = pay && /^if you do, (.+)$/i.exec(ss[i + 1] ?? '');
      if (then) {
        const fx = effects(then[1], card);
        if (!fx) return null;
        out.push({ type: 'payThen', cost: pay[1].toUpperCase(), effects: fx });
        i++;
        continue;
      }
      // キッカー：「If this was kicked, …」の効果は、キッカーを払ったときだけ
      let kicked = false;
      const k = /^if this was kicked, (.+)$/i.exec(s);
      if (k) {
        if (/^instead /i.test(k[1])) return null;
        kicked = true;
        s = k[1];
      }
      let fx = effect(s, card);
      if (!fx) return null;
      for (const f of Array.isArray(fx) ? fx : [fx]) {
        if (f.type === 'noRegen') {
          for (const g of out) if (g.type === 'destroy' || g.type === 'destroyAll') g.noRegen = true;
          continue;
        }
        if (kicked) f.kicked = true;
        if (f.type !== 'none') out.push(f);
      }
    }
    // 「上からN枚を見る」＋「1枚を手札に、残りを〜」はまとめて1つの効果に
    for (let i = 0; i < out.length; i++) {
      if (out[i].type !== 'look') continue;
      const next = out[i + 1];
      if (next?.type === 'lookPick') { out.splice(i, 2, { type: 'lookPick', n: out[i].n, rest: next.rest }); continue; }
      if (next?.type === 'reorderLooked') { out.splice(i, 2, { type: 'reorder', n: out[i].n }); continue; }
      return null; // 見るだけ（相手のライブラリーなど）は読まない
    }
    if (out.some((f) => f.type === 'lookPick' && f.n == null || f.type === 'reorderLooked')) return null;
    return out;
  }

  // 誘発型能力の「that player」「that creature」「it」を、誘発したときのプレイヤー・クリーチャーにする
  function bindTrigger(text, bind) {
    let t = text;
    const marks = [];
    if (bind === 'player') t = t.replace(/\bthat player\b/gi, () => { marks.push('player'); return 'target player'; }).replace(/\bthe damaged player\b/gi, 'target player');
    if (bind === 'obj') t = t.replace(/\b(that creature|that card)\b/gi, () => { marks.push('obj'); return 'target creature'; });
    return { text: t, bound: marks.length ? bind : null };
  }

  const kwList = (s) => (s ? s.split(/,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean) : []);

  // ---------- 誘発条件 ----------

  // 条件 → [イベント, 追加の条件, 「that player / that creature」が指すもの]
  const TRIGGERS = [
    [/^when this enters(?: the battlefield)?$/, 'etb'],
    [/^when this leaves the battlefield$/, 'leaves'],
    [/^whenever (another|a) (nontoken )?creature( you control| an opponent controls)? enters(?: the battlefield)?(?: under your control)?$/, 'creatureEnters', (m) => ({ other: m[1] === 'another', who: m[3] === ' you control' ? 'you' : m[3] ? 'opp' : 'all' }), 'obj'],
    [/^whenever (another|a) (nontoken )?creature( you control| an opponent controls)? (?:dies|is put into (?:a|your) graveyard from the battlefield)$/, 'creatureDies', (m) => ({ other: m[1] === 'another', who: m[3] === ' you control' ? 'you' : m[3] ? 'opp' : 'all' }), 'obj'],
    [/^whenever a creature is put into your graveyard from the battlefield$/, 'creatureDies', () => ({ who: 'owner' }), 'obj'],
    [/^at the beginning of (?:the|each) end step$/, 'eachEndstep'],
    [/^at the beginning of each player's upkeep$/, 'eachUpkeep', null, 'player'],
    [/^at the beginning of your draw step$/, 'drawstep'],
    [/^at the beginning of each of your draw steps$/, 'drawstep'],
    [/^whenever this deals damage to (a player|an opponent)$/, 'dealsDamagePlayer', (m) => ({ opp: m[1] === 'an opponent' }), 'player'],
    [/^whenever this deals combat damage to (a player|an opponent)$/, 'combatDamagePlayer', null, 'player'],
    [/^whenever this is dealt damage$/, 'dealtDamage'],
    [/^whenever (an opponent|a player) draws a card$/, 'drawCard', (m) => ({ opp: m[1] === 'an opponent' }), 'player'],
    [/^whenever (an opponent|a player) discards a card$/, 'discard', (m) => ({ opp: m[1] === 'an opponent' }), 'player'],
    [/^whenever a creature dealt damage by this this turn dies$/, 'damagedDies', null, 'obj'],
    [/^whenever (a player|an opponent|you) casts? an? (white|blue|black|red|green|artifact|creature|instant|sorcery|enchantment)? ?spell$/, 'cast', (m) => ({ who: m[1] === 'a player' ? 'all' : m[1] === 'you' ? 'you' : 'opp', what: m[2] ?? null }), 'player'],
    [/^whenever (a player|an opponent|you) casts? a spell$/, 'cast', (m) => ({ who: m[1] === 'a player' ? 'all' : m[1] === 'you' ? 'you' : 'opp', what: null }), 'player'],
    [/^when this dies$|^when this is put into a graveyard from the battlefield$/, 'dies'],
    [/^at the beginning of your upkeep$/, 'upkeep'],
    [/^at the beginning of each upkeep$/, 'eachUpkeep'],
    [/^at the beginning of your end step$/, 'endstep'],
    [/^whenever this attacks$/, 'attacks'],
    [/^whenever this blocks$/, 'blocks'],
    [/^whenever this attacks or blocks$/, 'attacksOrBlocks'],
    [/^whenever this becomes blocked$/, 'becomesBlocked'],
    [/^whenever this blocks or becomes blocked$/, 'blocksOrBlocked'],
    [/^when this enters or dies$/, 'etbOrDies'],
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
    if ((m = /^(other )?(merfolk|elves|dwarves|wolves|slivers?|zombies|goblins|soldiers|knights|wizards|clerics|beasts|birds|dragons|walls) get ([+-]\d+)\/([+-]\d+)(?: and have ([a-z ,]+))?$/.exec(s))) {
      return { kind: 'lord', other: !!m[1], word: m[2], scope: 'all', p: Number(m[3]), t: Number(m[4]), kw: kwList(m[5]) };
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
    if ((m = /^(enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+) and can't block$/.exec(s))) return { kind: 'attached', p: Number(m[2]), t: Number(m[3]), kw: [], cantBlock: true };
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
    // 条件が先に来る形：「As long as you control a Forest, …」「Threshold — As long as seven or more cards are in your graveyard, …」
    if ((m = /^(?:threshold — )?(.+?) as long as (?:there are )?seven or more cards are in your graveyard$/.exec(s)) || (m = /^(?:threshold — )?(.+?) as long as there are seven or more cards in your graveyard$/.exec(s))) {
      const inner = staticOf(m[1].replace(/^threshold — /, ''));
      return inner ? { ...inner, ifGrave: 7 } : null;
    }
    if ((m = /^(?:threshold — )?as long as (?:there are )?seven or more cards (?:are )?in your graveyard, (.+)$/.exec(s))) {
      const inner = staticOf(m[1]);
      return inner ? { ...inner, ifGrave: 7 } : null;
    }
    if ((m = /^as long as you control an? (\w+), (.+)$/.exec(s))) {
      const inner = staticOf(m[2]);
      return inner ? { ...inner, ifControl: m[1] } : null;
    }
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+) and (?:has|gains) ([a-z ,]+)$/.exec(s))) return { kind: 'self', p: Number(m[1]), t: Number(m[2]), kw: kwList(m[3]) };
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+) and can't block$/.exec(s))) return { kind: 'self', p: Number(m[1]), t: Number(m[2]), cantBlock: true };
    if ((m = /^this gets ([+-]\d+)\/([+-]\d+)$/.exec(s))) return { kind: 'self', p: Number(m[1]), t: Number(m[2]) };
    if ((m = /^this has ([a-z ,]+)$/.exec(s))) return { kind: 'self', p: 0, t: 0, kw: kwList(m[1]) };
    // P/T が数で決まる
    if ((m = /^this's power and toughness are each equal to (.+)$/.exec(s))) {
      const c = parseCount(m[1]);
      return c ? { kind: 'self', setPT: c } : null;
    }
    if ((m = /^this's power is equal to (.+?)(?: and its toughness is equal to that number plus (\d+))?$/.exec(s))) {
      const c = parseCount(m[1]);
      return c ? { kind: 'self', setP: c, plusT: m[2] != null ? Number(m[2]) : null } : null;
    }
    if ((m = /^(this|enchanted creature|equipped creature) gets \+(\d+)\/\+(\d+) for each (.+)$/.exec(s))) {
      const c = parseCount(m[4]);
      return c ? { kind: m[1] === 'this' ? 'self' : 'attached', p: 0, t: 0, per: { count: c, p: Number(m[2]), t: Number(m[3]) } } : null;
    }
    // 攻撃・ブロックの制限
    if (s === 'this can\'t be blocked except by walls') return { kind: 'self', blockOnly: 'wall' };
    if (s === 'this can\'t be blocked by walls') return { kind: 'self', notBlockedBy: 'wall' };
    if (s === 'this can\'t be blocked by more than one creature') return { kind: 'self', maxBlockers: 1 };
    if ((m = /^this can't be blocked except by (two|three) or more creatures$/.exec(s))) return { kind: 'self', minBlockers: num(m[1]) };
    if (s === 'this can block only creatures with flying') return { kind: 'self', blockOnlyFlying: true };
    if ((m = /^this can't block creatures with power (\d+) or (greater|less)$/.exec(s))) return { kind: 'self', cantBlockPower: { n: Number(m[1]), ge: m[2] === 'greater' } };
    if ((m = /^this can't attack unless defending player controls an? (\w+)$/.exec(s))) return { kind: 'self', attackNeeds: m[1] };
    if ((m = /^this can't be blocked except by creatures with (flying|horsemanship|shadow)$/.exec(s))) return { kind: 'self', blockOnlyKw: m[1] };
    if (s === 'this can block any number of creatures') return { kind: 'self' };
    if (s === 'this can\'t be countered' || s === 'this spell can\'t be countered') return { kind: 'uncounterable' };
    if (s === 'prevent all damage that would be dealt to this') return { kind: 'self', preventAll: true };
    if (s === 'prevent all combat damage that would be dealt to and dealt by this') return { kind: 'self', preventCombatAll: true };
    if (s === 'enchanted creature can\'t be blocked except by walls') return { kind: 'attached', p: 0, t: 0, kw: [], blockOnly: 'wall' };
    if (s === 'enchanted creature can\'t be blocked') return { kind: 'attached', p: 0, t: 0, kw: [], unblockable: true };
    if ((m = /^this enters(?: the battlefield)? with (\w+) \+1\/\+1 counters? on it$/.exec(s))) return { kind: 'etbCounters', n: num(m[1]) };
    if ((m = /^this enters(?: the battlefield)? with (\w+) (\w+) counters? on it$/.exec(s))) return { kind: 'etbNamed', n: num(m[1]), name: m[2] };
    if ((m = /^when you control no (\w+), sacrifice this$/.exec(s))) return { kind: 'sacIfNo', what: m[1].replace(/s$/, '') };
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
      else if ((m = /^(plains|island|swamp|mountain|forest)cycling (\{[^ ]+\})$/i.exec(p))) { got.push(['cycling', m[2].toUpperCase()]); got.push(['landcycling', m[1].toLowerCase()]); }
      else if ((m = /^flashback (\{[^ ]+\})$/i.exec(p))) got.push(['flashback', m[1].toUpperCase()]);
      else if ((m = /^equip (\{[^ ]+\})$/i.exec(p))) got.push(['equip', m[1].toUpperCase()]);
      else if ((m = /^kicker (\{[^ ]+\})$/i.exec(p))) got.push(['kicker', m[1].toUpperCase()]);
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
      echo: null, cycling: null, flashback: null, equip: null, kicker: null, modes: null, addCost: null, uncounterable: false, etbCounters: 0, sacIfNo: null,
      ignored: [],
      manual: [],
    };
    const lines = linesOf(card.oracleText ?? card.oracle ?? '', card.name);
    const permanent = !types.includes('instant') && !types.includes('sorcery');
    let modal = null; // 「Choose one —」の後の選択肢
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (modal && line.startsWith('•')) {
        const fx = effects(line.replace(/^•\s*/, ''), def);
        if (fx) modal.push(fx);
        else def.manual.push(line);
        continue;
      }
      modal = null;
      if (/^choose one —$/i.test(line)) { def.modes = []; modal = def.modes; continue; }
      if (keywordLine(line, def)) continue;
      // 追加のコスト
      const ac = /^as an additional cost to cast this(?: spell)?, (sacrifice a creature|sacrifice a land|discard a card|pay (\d+) life)\.?$/i.exec(line);
      if (ac) { def.addCost = parseCost(ac[1]); continue; }
      if (/^this (?:spell )?can't be countered\.?$/i.test(line)) { def.uncounterable = true; continue; }
      if (/^this enters(?: the battlefield)? tapped\.?$/.test(lower)) { def.entersTapped = true; continue; }
      if (/^\(?\{t\}: add /i.test(line) && def.types.includes('land') && !/,/.test(line.split(':')[0])) {
        // 土地の基本的なマナ能力（下の起動型能力としても読む）
      }
      // 誘発型能力
      const trig = /^((?:when|whenever|at) [^,]+), (.+)$/i.exec(line);
      if (trig) {
        const cond = trig[1].toLowerCase();
        const hit = TRIGGERS.map((t) => [t, t[0].exec(cond)]).find(([, m]) => m);
        let body = trig[2].replace(/^it /i, 'this ').replace(/ on it\.?$/i, ' on this.');
        // 「if 〜」で始まる条件付きの誘発（ソーサリー・タイミングの確認など）は読まない
        const bound = hit ? bindTrigger(body.replace(/^you may (?!pay)/i, ''), hit[0][3]) : null;
        const fx = hit && (!/^if /i.test(body) || /^if there are no \w+ counters on this/i.test(body)) ? effects(bound.text, def) : null;
        if (hit && fx) {
          if (bound.bound) for (const f of fx) if (f.target && !f.target.auto) f.target = { ...f.target, bound: bound.bound };
          def.triggers.push({ event: hit[0][1], cond: hit[0][2] ? hit[0][2](hit[1]) : null, effects: fx, optional: /^you may /i.test(body), text: line });
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
        const upkeep = /activate only during your upkeep\.?/i.test(body);
        const twice = /activate no more than twice each turn\.?/i.test(body);
        body = body.replace(/\s*activate no more than twice each turn\.?/i, '');
        body = body.replace(/\s*activate only as a sorcery\.?/i, '').replace(/\s*activate only once each turn\.?/i, '').replace(/\s*activate only during your upkeep\.?/i, '').trim();
        const fx = effects(body, def);
        if (fx && fx.length) {
          const mana = fx.length === 1 && fx[0].type === 'addMana' && !fx[0].amount ? fx[0].mana : null;
          // 「数だけマナを出す」もマナ能力（スタックを使わない）。自動の支払いには使わない
          const manaLike = !mana && fx.every((f) => f.type === 'addMana');
          def.activated.push({ cost, effects: fx, mana, manaLike, sorcery, once, limit: twice ? 2 : null, upkeep, text: line, fromHand: cost.discardSelf });
          continue;
        }
        def.manual.push(line);
        continue;
      }
      if (permanent) {
        const st = sentences(line).map(staticOf);
        if (st.length && st.every(Boolean)) {
          for (const x of st) {
            if (x.kind === 'uncounterable') def.uncounterable = true;
            else if (x.kind === 'etbCounters') def.etbCounters += x.n;
            else if (x.kind === 'etbNamed') def.etbNamed = { ...(def.etbNamed ?? {}), [x.name]: x.n };
            else if (x.kind === 'sacIfNo') def.sacIfNo = x.what;
            else def.statics.push(x);
          }
          continue;
        }
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
      const fx = def.landcycling ? [{ type: 'search', n: 1, filter: { subtypes: [def.landcycling] }, to: 'hand' }] : [{ type: 'draw', n: 1 }];
      def.activated.push({ cost, effects: fx, fromHand: true, cycling: true, text: `${def.landcycling ? `${def.landcycling[0].toUpperCase()}${def.landcycling.slice(1)}cycling` : 'Cycling'} ${def.cycling}` });
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

  return { compile, effects, effect, parseCost, parseMana, staticOf, linesOf, parseCount };
})();

if (typeof module !== 'undefined') module.exports = CardText;
