// ルールエンジンのテスト（node tests/engine.test.js）
global.Rules = require('../rules.js');
global.CardOverrides = require('../cards.js');
global.CardText = require('../cardtext.js');
global.Engine = require('../engine.js');
global.AI = (() => { try { return require('../ai.js'); } catch { return null; } })();
const assert = require('assert');

const C = (name, typeLine, manaCost, oracleText = '', extra = {}) => ({
  name, typeLine, manaCost, cmc: (manaCost.match(/\{(\d+)\}/) ? Number(manaCost.match(/\{(\d+)\}/)[1]) : 0) + (manaCost.match(/\{[WUBRG]\}/g) ?? []).length,
  oracleText, keywords: [], colors: [...new Set(manaCost.match(/[WUBRG]/g) ?? [])], power: null, toughness: null, ...extra,
});
const cre = (name, cost, p, t, text = '', kws = [], type = 'Creature — Beast') => C(name, type, cost, text, { power: String(p), toughness: String(t), keywords: kws });
const L = {
  Mountain: C('Mountain', 'Basic Land — Mountain', '', '({T}: Add {R}.)', { produced: ['R'] }),
  Forest: C('Forest', 'Basic Land — Forest', '', '({T}: Add {G}.)', { produced: ['G'] }),
  Island: C('Island', 'Basic Land — Island', '', '({T}: Add {U}.)', { produced: ['U'] }),
  Plains: C('Plains', 'Basic Land — Plains', '', '({T}: Add {W}.)', { produced: ['W'] }),
  Swamp: C('Swamp', 'Basic Land — Swamp', '', '({T}: Add {B}.)', { produced: ['B'] }),
};
const K = {
  bolt: C('Lightning Bolt', 'Instant', '{R}', 'Lightning Bolt deals 3 damage to any target.'),
  bears: cre('Grizzly Bears', '{1}{G}', 2, 2, '', [], 'Creature — Bear'),
  giant: cre('Hill Giant', '{3}{R}', 3, 3, '', [], 'Creature — Giant'),
  counterspell: C('Counterspell', 'Instant', '{U}{U}', 'Counter target spell.'),
  leak: C('Mana Leak', 'Instant', '{1}{U}', 'Counter target spell unless its controller pays {3}.'),
  elves: cre('Llanowar Elves', '{G}', 1, 1, '{T}: Add {G}.', [], 'Creature — Elf Druid'),
  prodigal: cre('Prodigal Sorcerer', '{2}{U}', 1, 1, '{T}: Prodigal Sorcerer deals 1 damage to any target.', [], 'Creature — Human Wizard'),
  skeleton: cre('Drudge Skeletons', '{1}{B}', 1, 1, '{B}: Regenerate Drudge Skeletons.', [], 'Creature — Skeleton'),
  terror: C('Terror', 'Instant', '{1}{B}', "Destroy target nonartifact, nonblack creature. It can't be regenerated."),
  kavu: cre('Flametongue Kavu', '{3}{R}', 4, 2, 'When Flametongue Kavu enters, it deals 4 damage to target creature.', [], 'Creature — Kavu'),
  pacifism: C('Pacifism', 'Enchantment — Aura', '{1}{W}', "Enchant creature\nEnchanted creature can't attack or block."),
  rancor: C('Rancor', 'Enchantment — Aura', '{G}', 'Enchant creature\nEnchanted creature gets +2/+0 and has trample.'),
  fs: cre('Elvish Knight', '{1}{W}', 2, 2, 'First strike', ['First strike'], 'Creature — Knight'),
  king: cre('Goblin King', '{1}{R}{R}', 2, 2, 'Other Goblins get +1/+1 and have mountainwalk.', [], 'Creature — Goblin'),
  piker: cre('Goblin Piker', '{1}{R}', 2, 1, "Goblin Piker can't block.", [], 'Creature — Goblin Warrior'),
  angel: cre('Serra Angel', '{3}{W}{W}', 4, 4, 'Flying, vigilance', ['Flying', 'Vigilance'], 'Creature — Angel'),
  fog: C('Fog', 'Instant', '{G}', 'Prevent all combat damage that would be dealt this turn.'),
  wrath: C('Wrath of God', 'Sorcery', '{2}{W}{W}', "Destroy all creatures. They can't be regenerated."),
  echo: cre('Albino Troll', '{1}{G}', 3, 3, 'Echo {1}{G}\n{1}{G}: Regenerate Albino Troll.', ['Echo'], 'Creature — Troll'),
  cycler: C('Miscalculation', 'Instant', '{1}{U}', 'Counter target spell unless its controller pays {2}.\nCycling {2}'),
  rot: C('Mind Rot', 'Sorcery', '{2}{B}', 'Target player discards two cards.'),
  gravedigger: cre('Gravedigger', '{3}{B}', 2, 2, 'When Gravedigger enters, you may return target creature card from your graveyard to your hand.', [], 'Creature — Zombie'),
  ape: cre('Kird Ape', '{R}', 1, 1, 'Kird Ape gets +1/+2 as long as you control a Forest.', [], 'Creature — Ape'),
  firebreather: cre('Shivan Dragon', '{4}{R}{R}', 5, 5, 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.', ['Flying'], 'Creature — Dragon'),
  rampant: C('Rampant Growth', 'Sorcery', '{1}{G}', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.'),
  flashback: C('Firebolt', 'Sorcery', '{R}', 'Firebolt deals 2 damage to any target.\nFlashback {4}{R}'),
};

// 決まった盤面から始める：players の hand / battlefield / library をカード名で指定
function setup({ p0 = {}, p1 = {}, step = 'main1', active = 0 } = {}) {
  const deckOf = (spec) => {
    const all = [...(spec.hand ?? []), ...(spec.bf ?? []), ...(spec.library ?? []), ...(spec.grave ?? [])];
    const filler = Array(20).fill(L.Mountain);
    return [...all, ...filler].map((card) => ({ card, qty: 1 }));
  };
  const G = Engine.create({ players: [{ name: 'A', deck: deckOf(p0) }, { name: 'B', deck: deckOf(p1) }], first: 0, seed: 1 });
  // 手札・ライブラリーを並べ直す
  [p0, p1].forEach((spec, i) => {
    const pl = G.players[i];
    const ids = [...pl.hand, ...pl.library];
    for (const id of ids) G.objects[id].zone = 'library';
    pl.hand = [];
    pl.library = [];
    const take = (card) => {
      const id = ids.find((x) => G.objects[x].def.name === card.name && !G.objects[x].taken);
      G.objects[id].taken = true;
      return id;
    };
    for (const c of spec.hand ?? []) { const id = take(c); G.objects[id].zone = 'hand'; pl.hand.push(id); }
    for (const c of spec.bf ?? []) { const id = take(c); G.objects[id].zone = 'battlefield'; G.objects[id].controller = i; G.objects[id].since = -1; G.battlefield.push(id); }
    for (const c of spec.grave ?? []) { const id = take(c); G.objects[id].zone = 'graveyard'; pl.graveyard.push(id); }
    for (const id of ids) if (!G.objects[id].taken) { pl.library.push(id); } else delete G.objects[id].taken;
    for (const id of pl.library) delete G.objects[id].taken;
    pl.kept = true;
  });
  G.pending = null;
  G.turn = 3;
  G.active = active;
  G.step = step;
  G.stepBegun = true;
  G.priority = active;
  return G;
}
const id = (G, name, zone = null, p = null) => Number(Object.keys(G.objects).find((k) => {
  const o = G.objects[k];
  return o.def.name === name && (zone == null || o.zone === zone) && (p == null || o.controller === p);
}));
const ok = (r) => { assert.ok(r.ok, r.error); return r; };
const passBoth = (G) => { ok(Engine.perform(G, Engine.needs(G).player, { type: 'pass' })); ok(Engine.perform(G, Engine.needs(G).player, { type: 'pass' })); };

const tests = {
  'compile: parses common cards'() {
    const d = CardText.compile(K.skeleton);
    assert.equal(d.activated[0].effects[0].type, 'regen');
    assert.equal(CardText.compile(K.prodigal).activated[0].effects[0].type, 'damage');
    assert.equal(CardText.compile(K.leak).spell[0].unless, 3);
    assert.equal(CardText.compile(K.terror).spell[0].noRegen, true);
    assert.equal(CardText.compile(K.echo).echo, '{1}{G}');
    assert.equal(CardText.compile(K.pacifism).statics[0].cantBlock, true);
    assert.equal(CardText.compile(K.kavu).triggers[0].event, 'etb');
    assert.equal(CardText.compile(K.flashback).flashback, '{4}{R}');
    assert.equal(CardText.compile(K.cycler).activated.find((a) => a.cycling).fromHand, true);
    assert.equal(CardText.compile(L.Forest).activated[0].mana.choices[0], 'G');
    for (const c of Object.values(K)) assert.equal(CardText.compile(c).support, 'full', c.name);
  },
  'bolt to face resolves after both pass'() {
    const G = setup({ p0: { hand: [K.bolt], bf: [L.Mountain] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Lightning Bolt'), targets: [{ player: 1 }] }));
    assert.equal(G.stack.length, 1);
    assert.ok(G.objects[id(G, 'Mountain', 'battlefield')].tapped);
    passBoth(G);
    assert.equal(G.players[1].life, 17);
    assert.equal(G.stack.length, 0);
    assert.equal(G.players[0].graveyard.length, 1);
  },
  'counterspell counters'() {
    const G = setup({ p0: { hand: [K.bears], bf: [L.Forest, L.Forest] }, p1: { hand: [K.counterspell], bf: [L.Island, L.Island] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Grizzly Bears') }));
    ok(Engine.perform(G, 0, { type: 'pass' }));
    const sid = G.stack[0].sid;
    ok(Engine.perform(G, 1, { type: 'cast', id: id(G, 'Counterspell'), targets: [{ stack: sid }] }));
    passBoth(G);
    assert.equal(G.stack.length, 0);
    assert.ok(!G.battlefield.includes(id(G, 'Grizzly Bears')));
    assert.equal(G.objects[id(G, 'Grizzly Bears')].zone, 'graveyard');
  },
  'mana leak: pay or countered'() {
    const G = setup({ p0: { hand: [K.bears], bf: [L.Forest, L.Forest, L.Forest] }, p1: { hand: [K.leak], bf: [L.Island, L.Island] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Grizzly Bears') }));
    ok(Engine.perform(G, 0, { type: 'pass' }));
    ok(Engine.perform(G, 1, { type: 'cast', id: id(G, 'Mana Leak'), targets: [{ stack: G.stack[0].sid }] }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'payOrNot');
    assert.equal(G.pending.canPay, false); // only 1 forest left
    ok(Engine.perform(G, 0, { type: 'pay', yes: false }));
    assert.equal(G.objects[id(G, 'Grizzly Bears')].zone, 'graveyard');
  },
  'flametongue ETB targets creature'() {
    const G = setup({ p0: { hand: [K.kavu], bf: [L.Mountain, L.Mountain, L.Mountain, L.Mountain] }, p1: { bf: [K.giant] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Flametongue Kavu') }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'triggerTarget');
    ok(Engine.perform(G, 0, { type: 'target', target: { obj: id(G, 'Hill Giant') } }));
    passBoth(G);
    assert.equal(G.objects[id(G, 'Hill Giant')].zone, 'graveyard');
  },
  'regeneration saves from bolt, not from terror'() {
    const G = setup({ p0: { hand: [K.bolt, K.terror], bf: [L.Mountain, L.Swamp, L.Swamp] }, p1: { bf: [K.skeleton, L.Swamp, L.Swamp] } });
    const sk = id(G, 'Drudge Skeletons');
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Lightning Bolt'), targets: [{ obj: sk }] }));
    ok(Engine.perform(G, 0, { type: 'pass' }));
    ok(Engine.perform(G, 1, { type: 'activate', id: sk, index: 0 }));
    passBoth(G); // regen resolves
    passBoth(G); // bolt resolves
    assert.equal(G.objects[sk].zone, 'battlefield');
    assert.ok(G.objects[sk].tapped);
    // terror: but skeletons is black → not a legal target
    assert.equal(Engine.castInfo(G, 0, id(G, 'Terror')).ok, false);
  },
  'combat: first strike, blocks, trample-free'() {
    const G = setup({ p0: { bf: [K.fs] }, p1: { bf: [K.bears] }, step: 'begincombat' });
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'attackers');
    ok(Engine.perform(G, 0, { type: 'attackers', ids: [id(G, 'Elvish Knight')] }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'blockers');
    ok(Engine.perform(G, 1, { type: 'blockers', blocks: { [id(G, 'Grizzly Bears')]: id(G, 'Elvish Knight') } }));
    passBoth(G); // blockers step → first strike damage
    assert.equal(G.objects[id(G, 'Grizzly Bears')].zone, 'graveyard');
    passBoth(G); // firststrike → damage
    passBoth(G); // damage → endcombat
    assert.equal(G.objects[id(G, 'Elvish Knight')].damage, 0);
    assert.equal(G.players[1].life, 20);
  },
  'flying cannot be blocked by ground; pacifism stops attack'() {
    const G = setup({ p0: { bf: [K.angel, K.bears], hand: [K.pacifism], }, p1: { bf: [K.giant, L.Plains, L.Plains] } });
    const angel = id(G, 'Serra Angel');
    G.combat = { attackers: { [angel]: 1 }, blocks: {}, blocked: {} };
    G.objects[angel].attacking = true;
    assert.equal(Engine.canBlock(G, id(G, 'Hill Giant'), angel), false);
    G.combat = null; G.objects[angel].attacking = false;
    // pacifism (cast by p1 on its turn)
    G.active = 1; G.priority = 1;
    const pac = id(G, 'Pacifism');
    G.players[0].hand = G.players[0].hand.filter((x) => x !== pac); G.objects[pac].owner = 1; G.objects[pac].controller = 1; G.players[1].hand.push(pac);
    ok(Engine.perform(G, 1, { type: 'cast', id: pac, targets: [{ obj: angel }] }));
    passBoth(G);
    assert.equal(G.objects[pac].attachedTo, angel);
    G.active = 0; G.turn++;
    assert.equal(Engine.canAttack(G, angel), false);
  },
  'lords and conditional statics'() {
    const G = setup({ p0: { bf: [K.king, K.piker, K.ape, L.Forest] } });
    const pk = Engine.ch(G, id(G, 'Goblin Piker'));
    assert.equal(pk.p, 3); assert.equal(pk.t, 2); assert.ok(pk.kw.has('mountainwalk')); assert.ok(pk.cantBlock);
    assert.equal(Engine.ch(G, id(G, 'Goblin King')).p, 2);
    assert.equal(Engine.ch(G, id(G, 'Kird Ape')).t, 3);
  },
  'mana elf pays, pool leftovers, firebreathing'() {
    const G = setup({ p0: { hand: [K.bears], bf: [K.elves, L.Forest, K.firebreather, L.Mountain, L.Mountain] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Grizzly Bears') }));
    passBoth(G);
    const dragon = id(G, 'Shivan Dragon');
    const fire = Engine.activations(G, 0, dragon).find((a) => !a.mana);
    assert.ok(fire.ok, fire.reason);
    ok(Engine.perform(G, 0, { type: 'activate', id: dragon, index: fire.index }));
    ok(Engine.perform(G, 0, { type: 'activate', id: dragon, index: fire.index }));
    passBoth(G); passBoth(G);
    assert.equal(Engine.ch(G, dragon).p, 7);
  },
  'wrath kills all, fog prevents combat damage'() {
    const G = setup({ p0: { hand: [K.wrath], bf: [K.bears, L.Plains, L.Plains, L.Plains, L.Plains] }, p1: { bf: [K.skeleton, L.Swamp] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Wrath of God') }));
    ok(Engine.perform(G, 0, { type: 'pass' }));
    ok(Engine.perform(G, 1, { type: 'activate', id: id(G, 'Drudge Skeletons'), index: 0 }));
    passBoth(G); passBoth(G);
    assert.equal(G.battlefield.filter((x) => Engine.isType(G, x, 'creature')).length, 0);
  },
  'discard choice, echo, cycling, flashback, search'() {
    const G = setup({ p0: { hand: [K.rot, K.cycler], bf: [L.Swamp, L.Island, L.Island, L.Swamp, L.Island], library: [L.Forest] }, p1: { hand: [K.bears, K.giant, K.bolt] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Mind Rot'), targets: [] }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'discard');
    assert.equal(Engine.needs(G).player, 1);
    ok(Engine.perform(G, 1, { type: 'choose', ids: [id(G, 'Grizzly Bears'), id(G, 'Hill Giant')] }));
    assert.equal(G.players[1].hand.length, 1);
    const cyc = Engine.activations(G, 0, id(G, 'Miscalculation')).find((a) => a.cycling);
    assert.ok(cyc.ok, cyc.reason);
    const hand = G.players[0].hand.length;
    ok(Engine.perform(G, 0, { type: 'activate', id: id(G, 'Miscalculation'), index: cyc.index }));
    passBoth(G);
    assert.equal(G.players[0].hand.length, hand); // -1 cycled +1 drawn
  },
  'echo: decline sacrifices at upkeep'() {
    const G = setup({ p0: { bf: [K.echo] } });
    G.objects[id(G, 'Albino Troll')].echoDue = true;
    G.step = 'untap'; G.stepBegun = false; G.priority = null;
    Engine.run(G);
    assert.equal(Engine.needs(G).type, 'payOrNot');
    ok(Engine.perform(G, 0, { type: 'pay', yes: false }));
    assert.equal(G.objects[id(G, 'Albino Troll')].zone, 'graveyard');
  },
  'full turn cycle advances to opponent'() {
    const G = setup({ p0: {} });
    for (let i = 0; i < 40 && G.active === 0; i++) {
      const n = Engine.needs(G);
      if (n.type === 'attackers') ok(Engine.perform(G, n.player, { type: 'attackers', ids: [] }));
      else ok(Engine.perform(G, n.player, { type: 'pass' }));
    }
    assert.equal(G.active, 1);
    assert.equal(G.turn, 4);
  },
  'flashback from graveyard'() {
    const G = setup({ p0: { grave: [K.flashback], bf: [L.Mountain, L.Mountain, L.Mountain, L.Mountain, L.Mountain] } });
    const fb = id(G, 'Firebolt');
    assert.ok(Engine.castInfo(G, 0, fb).ok);
    ok(Engine.perform(G, 0, { type: 'cast', id: fb, targets: [{ player: 1 }] }));
    passBoth(G);
    assert.equal(G.players[1].life, 18);
    assert.equal(G.objects[fb].zone, 'exile');
  },
  'search: rampant growth'() {
    const G = setup({ p0: { hand: [K.rampant], bf: [L.Forest, L.Forest], library: [L.Island] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Rampant Growth') }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'search');
    const opt = G.pending.options;
    ok(Engine.perform(G, 0, { type: 'choose', ids: [opt[0]] }));
    assert.ok(G.objects[opt[0]].zone === 'battlefield' && G.objects[opt[0]].tapped);
  },
  'gravedigger returns creature'() {
    const G = setup({ p0: { hand: [K.gravedigger], bf: [L.Swamp, L.Swamp, L.Swamp, L.Swamp], grave: [K.bears] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Gravedigger') }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'triggerTarget');
    ok(Engine.perform(G, 0, { type: 'target', target: { grave: id(G, 'Grizzly Bears') } }));
    passBoth(G);
    assert.equal(G.objects[id(G, 'Grizzly Bears')].zone, 'hand');
  },
  'view hides opponent hand and libraries'() {
    const G = setup({ p0: { hand: [K.bolt] }, p1: { hand: [K.bears] } });
    const v = Engine.view(G, 1);
    assert.ok(v.objects[id(G, 'Lightning Bolt')].hidden);
    assert.ok(!v.objects[id(G, 'Grizzly Bears')].hidden);
    assert.ok(v.players[0].library.every((x) => v.objects[x].hidden));
    assert.ok(Engine.castInfo(v, 1, id(G, 'Grizzly Bears')).reason); // works on a view
  },
};

if (AI) tests['AI vs AI plays a full game'] = () => {
  for (let seed = 1; seed <= 6; seed++) {
    const red = [[L.Mountain, 17], [K.bolt, 4], [K.giant, 4], [K.kavu, 4], [K.king, 3], [K.piker, 4], [K.flashback, 2], [K.firebreather, 2]];
    const ug = [[L.Forest, 9], [L.Island, 8], [K.bears, 4], [K.elves, 4], [K.counterspell, 3], [K.leak, 3], [K.rancor, 2], [K.prodigal, 3], [K.fog, 2], [K.echo, 2], [K.rampant, 2]];
    const deck = (l) => l.map(([card, qty]) => ({ card, qty }));
    const G = Engine.create({ players: [{ name: 'R', deck: deck(red) }, { name: 'UG', deck: deck(ug) }], first: seed % 2, seed });
    let n = 0;
    for (; n < 5000 && G.winner == null; n++) {
      const need = Engine.needs(G);
      assert.ok(need, 'nobody to act');
      const a = AI.decide(G, need.player);
      const r = Engine.perform(G, need.player, a);
      if (!r.ok) throw new Error(`AI illegal action ${JSON.stringify(a)}: ${r.error} (step ${G.step}, pending ${JSON.stringify(G.pending?.type)})`);
    }
    assert.ok(G.winner != null, `game did not finish (seed ${seed}, turn ${G.turn})`);
    console.log(`  seed ${seed}: winner ${G.players[G.winner].name} on turn ${G.turn} in ${n} actions`);
  }
};

// 旧枠モダンの全カード：読み取りとエンジンの対応がそろっているか、ランダムなデッキで CPU 同士が最後まで遊べるか
const pool = (() => { try { return require('../data/oldframe-modern.json').cards; } catch { return null; } })();
if (pool) {
  tests['oldframe-modern: compiled effects are all supported by the engine'] = () => {
    const bad = [];
    for (const card of pool) {
      const def = CardText.compile(card);
      const u = Engine.unsupported(def);
      if (u.length) bad.push(`${card.name}: ${u.join(', ')}`);
    }
    assert.deepEqual(bad, []);
  };
  // 実際のカードの Oracle テキストで、ルールの処理を確かめる
  const P = (name) => { const c = pool.find((x) => x.name === name); assert.ok(c, `not in pool: ${name}`); return c; };
  tests['real cards: amounts, auras, threshold'] = () => {
    const G = setup({ p0: { hand: [P('Corrupt')], bf: [P('Swamp'), P('Swamp'), P('Swamp'), P('Swamp'), P('Swamp'), P('Swamp')] }, p1: {} });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Corrupt'), targets: [{ player: 1 }] }));
    passBoth(G);
    assert.equal(G.players[1].life, 14);
    assert.equal(G.players[0].life, 26);
    const H = setup({ p0: { hand: [P('Blanchwood Armor')], bf: [K.bears, P('Forest'), P('Forest'), P('Forest')] } });
    ok(Engine.perform(H, 0, { type: 'cast', id: id(H, 'Blanchwood Armor'), targets: [{ obj: id(H, 'Grizzly Bears') }] }));
    passBoth(H);
    assert.equal(Engine.ch(H, id(H, 'Grizzly Bears')).p, 5);
    const M = setup({ p0: { bf: [P('Nimble Mongoose')], grave: Array(7).fill(L.Mountain) } });
    assert.equal(Engine.ch(M, id(M, 'Nimble Mongoose')).p, 3);
    assert.ok(Engine.ch(M, id(M, 'Nimble Mongoose')).kw.has('shroud'));
    const T = setup({ p0: { bf: [P('Priest of Titania'), P('Llanowar Elves')] } });
    ok(Engine.perform(T, 0, { type: 'activate', id: id(T, 'Priest of Titania'), index: 0 }));
    assert.equal(T.players[0].pool.G, 2);
  };
  tests['real cards: modal, prevention, discard, look'] = () => {
    const G = setup({ p0: { hand: [P('Funeral Charm')], bf: [P('Swamp')] }, p1: { hand: [K.bears] } });
    const info = Engine.castInfo(G, 0, id(G, 'Funeral Charm'));
    assert.ok(info.needMode && info.modes === 3);
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Funeral Charm'), mode: 0, targets: [{ player: 1 }] }));
    passBoth(G);
    assert.equal(Engine.needs(G).type, 'discard');
    const C = setup({ p0: { bf: [P('Circle of Protection: Red'), L.Plains] }, p1: { hand: [K.bolt], bf: [L.Mountain] } });
    ok(Engine.perform(C, 0, { type: 'activate', id: id(C, 'Circle of Protection: Red'), index: 0 }));
    passBoth(C);
    ok(Engine.perform(C, 0, { type: 'pass' }));
    ok(Engine.perform(C, 1, { type: 'cast', id: id(C, 'Lightning Bolt'), targets: [{ player: 0 }] }));
    passBoth(C);
    assert.equal(C.players[0].life, 20);
    const D = setup({ p0: { hand: [P('Coercion')], bf: [L.Swamp, L.Swamp, L.Swamp] }, p1: { hand: [K.bears, K.bolt] } });
    ok(Engine.perform(D, 0, { type: 'cast', id: id(D, 'Coercion'), targets: [{ player: 1 }] }));
    passBoth(D);
    assert.equal(Engine.needs(D).type, 'chooseHand');
    ok(Engine.perform(D, 0, { type: 'choose', ids: [id(D, 'Lightning Bolt')] }));
    assert.equal(D.objects[id(D, 'Lightning Bolt')].zone, 'graveyard');
    const S = setup({ p0: { hand: [P('Sleight of Hand')], bf: [L.Island], library: [K.bolt, K.bears] } });
    ok(Engine.perform(S, 0, { type: 'cast', id: id(S, 'Sleight of Hand') }));
    passBoth(S);
    assert.equal(Engine.needs(S).type, 'lookPick');
    ok(Engine.perform(S, 0, { type: 'choose', ids: [S.pending.options[1]] }));
    assert.equal(S.players[0].hand.length, 1);
  };
  tests['real cards: triggers (Grave Pact, Megrim, Sengir Vampire, Hunting Moa)'] = () => {
    const G = setup({ p0: { hand: [K.bolt], bf: [P('Grave Pact'), K.bears, L.Mountain] }, p1: { bf: [K.giant] } });
    ok(Engine.perform(G, 0, { type: 'cast', id: id(G, 'Lightning Bolt'), targets: [{ obj: id(G, 'Grizzly Bears') }] }));
    passBoth(G); passBoth(G);
    assert.equal(G.objects[id(G, 'Hill Giant')].zone, 'graveyard');
    const M = setup({ p0: { hand: [K.rot], bf: [P('Megrim'), L.Swamp, L.Swamp, L.Swamp] }, p1: { hand: [K.bears, K.giant] } });
    ok(Engine.perform(M, 0, { type: 'cast', id: id(M, 'Mind Rot'), targets: [] }));
    passBoth(M);
    ok(Engine.perform(M, 1, { type: 'choose', ids: [id(M, 'Grizzly Bears'), id(M, 'Hill Giant')] }));
    passBoth(M); passBoth(M);
    assert.equal(M.players[1].life, 16);
    const V = setup({ p0: { bf: [P('Sengir Vampire')] }, p1: { bf: [K.bears] }, step: 'begincombat' });
    passBoth(V);
    ok(Engine.perform(V, 0, { type: 'attackers', ids: [id(V, 'Sengir Vampire')] }));
    // 飛行なのでブロックできない → 直接の確認：戦闘ダメージでベアーズを倒したことにして誘発を確かめる
    V.objects[id(V, 'Grizzly Bears')].damagedBy = [id(V, 'Sengir Vampire')];
    V.objects[id(V, 'Grizzly Bears')].damage = 2;
    passBoth(V); passBoth(V); passBoth(V);
    assert.equal(V.objects[id(V, 'Sengir Vampire')].counters.p1, 1);
    const H = setup({ p0: { hand: [P('Hunting Moa')], bf: [L.Forest, L.Forest, L.Forest] } });
    ok(Engine.perform(H, 0, { type: 'cast', id: id(H, 'Hunting Moa') }));
    passBoth(H);
    ok(Engine.perform(H, 0, { type: 'target', target: { obj: id(H, 'Hunting Moa') } }));
    passBoth(H);
    assert.equal(H.objects[id(H, 'Hunting Moa')].counters.p1, 1);
  };
  tests['real cards: manlands, control, cost, extra turns'] = () => {
    const G = setup({ p0: { bf: [P('Treetop Village'), L.Forest, L.Forest] } });
    const tv = id(G, 'Treetop Village');
    const ab = Engine.activations(G, 0, tv).find((a) => !a.mana);
    ok(Engine.perform(G, 0, { type: 'activate', id: tv, index: ab.index }));
    passBoth(G);
    assert.ok(Engine.isType(G, tv, 'creature'));
    assert.equal(Engine.ch(G, tv).p, 3);
    assert.ok(Engine.ch(G, tv).kw.has('trample'));
    const C = setup({ p0: { hand: [P('Confiscate')], bf: Array(6).fill(L.Island) }, p1: { bf: [K.giant] } });
    ok(Engine.perform(C, 0, { type: 'cast', id: id(C, 'Confiscate'), targets: [{ obj: id(C, 'Hill Giant') }] }));
    passBoth(C);
    assert.equal(C.objects[id(C, 'Hill Giant')].controller, 0);
    const T = setup({ p0: { hand: [P('Threaten')], bf: [L.Mountain, L.Mountain, L.Mountain] }, p1: { bf: [K.giant] } });
    ok(Engine.perform(T, 0, { type: 'cast', id: id(T, 'Threaten'), targets: [{ obj: id(T, 'Hill Giant') }] }));
    passBoth(T);
    assert.equal(T.objects[id(T, 'Hill Giant')].controller, 0);
    assert.ok(Engine.canAttack(T, id(T, 'Hill Giant')) || T.step !== 'main1');
    const M = setup({ p0: { hand: [K.bears], bf: [P('Emerald Medallion'), L.Forest] } });
    assert.ok(Engine.castInfo(M, 0, id(M, 'Grizzly Bears')).ok); // {1}{G} → {G}
    const W = setup({ p0: { hand: [P('Time Warp')], bf: Array(5).fill(L.Island) } });
    ok(Engine.perform(W, 0, { type: 'cast', id: id(W, 'Time Warp'), targets: [{ player: 0 }] }));
    passBoth(W);
    assert.deepEqual(W.extraTurns, [0]);
  };
  tests['real cards: end of combat, shroud, moat, howling mine'] = () => {
    const G = setup({ p0: { bf: [K.giant] }, p1: { bf: [P('Cockatrice')] }, step: 'begincombat' });
    passBoth(G);
    ok(Engine.perform(G, 0, { type: 'attackers', ids: [id(G, 'Hill Giant')] }));
    passBoth(G);
    ok(Engine.perform(G, 1, { type: 'blockers', blocks: { [id(G, 'Cockatrice')]: id(G, 'Hill Giant') } }));
    for (let i = 0; i < 8 && G.step !== 'main2'; i++) passBoth(G);
    assert.equal(G.objects[id(G, 'Hill Giant')].zone, 'graveyard');
    const S = setup({ p0: { hand: [K.bolt], bf: [L.Mountain] }, p1: { bf: [P('Ivory Mask')] } });
    assert.ok(!Engine.targetsFor(S, 0, CardText.compile(K.bolt).spell[0].target).some((t) => t.player === 1));
    const Mt = setup({ p0: { bf: [K.giant] }, p1: { bf: [P("Teferi's Moat")] } });
    Mt.objects[id(Mt, "Teferi's Moat")].chosen = 'red';
    assert.equal(Engine.canAttack(Mt, id(Mt, 'Hill Giant')), false);
    const H = setup({ p0: { bf: [P('Howling Mine')] } });
    const before = H.players[0].hand.length;
    H.step = 'upkeep'; H.stepBegun = true; H.priority = 0;
    passBoth(H); // → draw step: draw 1 + Howling Mine trigger
    passBoth(H);
    assert.equal(H.players[0].hand.length, before + 2);
  };
  tests['real cards: divided damage, granted abilities, sac unless, same name'] = () => {
    const G = setup({ p0: { hand: [P('Arc Lightning')], bf: [L.Mountain, L.Mountain, L.Mountain] }, p1: { bf: [K.bears, P('Llanowar Elves')] } });
    const arc = id(G, 'Arc Lightning');
    const bad = Engine.perform(G, 0, { type: 'cast', id: arc, targets: [{ divide: [{ obj: id(G, 'Grizzly Bears'), n: 2 }] }] });
    assert.ok(!bad.ok); // 合計が3でない
    ok(Engine.perform(G, 0, { type: 'cast', id: arc, targets: [{ divide: [{ obj: id(G, 'Grizzly Bears'), n: 2 }, { obj: id(G, 'Llanowar Elves'), n: 1 }] }] }));
    passBoth(G);
    assert.equal(G.objects[id(G, 'Grizzly Bears')].zone, 'graveyard');
    assert.equal(G.objects[id(G, 'Llanowar Elves')].zone, 'graveyard');
    const F = setup({ p0: { hand: [P('Fire Whip')], bf: [K.bears, L.Mountain, L.Mountain] } });
    ok(Engine.perform(F, 0, { type: 'cast', id: id(F, 'Fire Whip'), targets: [{ obj: id(F, 'Grizzly Bears') }] }));
    passBoth(F);
    const acts = Engine.activations(F, 0, id(F, 'Grizzly Bears'));
    const ping = acts.find((a) => a.ability.effects[0].type === 'damage');
    assert.ok(ping?.ok, ping?.reason);
    ok(Engine.perform(F, 0, { type: 'activate', id: id(F, 'Grizzly Bears'), index: ping.index, targets: [{ player: 1 }] }));
    passBoth(F);
    assert.equal(F.players[1].life, 19);
    const R = setup({ p0: { hand: [P('Rathi Dragon')], bf: [L.Mountain, L.Mountain, L.Mountain, L.Mountain, L.Mountain, L.Mountain] } });
    ok(Engine.perform(R, 0, { type: 'cast', id: id(R, 'Rathi Dragon') }));
    passBoth(R); passBoth(R);
    assert.equal(Engine.needs(R).type, 'sacUnlessOther');
    ok(Engine.perform(R, 0, { type: 'choose', ids: R.pending.options.slice(0, 2) }));
    assert.equal(R.objects[id(R, 'Rathi Dragon')].zone, 'battlefield');
    assert.equal(R.battlefield.filter((x) => R.objects[x].def.name === 'Mountain').length, 4);
    const X = setup({ p0: { hand: [P('Eradicate')], bf: [L.Swamp, L.Swamp, L.Swamp, L.Swamp] }, p1: { bf: [K.bears], hand: [K.bears], grave: [K.bears] } });
    ok(Engine.perform(X, 0, { type: 'cast', id: id(X, 'Eradicate'), targets: [{ obj: id(X, 'Grizzly Bears', 'battlefield') }] }));
    passBoth(X);
    assert.equal(Object.values(X.objects).filter((o) => o.def.name === 'Grizzly Bears' && o.zone === 'exile').length, 3);
  };
  tests['oldframe-modern: random decks play to the end'] = () => {
    const games = Number(process.env.GAMES ?? 40);
    const basics = pool.filter((c) => /Basic Land/.test(c.typeLine) && !/Snow/.test(c.typeLine));
    const spells = pool.filter((c) => !/Land/.test(c.typeLine));
    let rng = 12345;
    const r = () => { rng = (rng * 1103515245 + 12345) % 2 ** 31; return rng / 2 ** 31; };
    const deck = () => {
      const colors = ['W', 'U', 'B', 'R', 'G'].sort(() => r() - 0.5).slice(0, 2);
      const lands = basics.filter((c) => (c.produced ?? []).some((x) => colors.includes(x)));
      const ok = spells.filter((c) => (c.colors ?? []).every((x) => colors.includes(x)));
      const list = [];
      for (let i = 0; i < 36; i++) list.push({ card: ok[Math.floor(r() * ok.length)], qty: 1 });
      for (let i = 0; i < 24; i++) list.push({ card: lands[i % lands.length], qty: 1 });
      return list;
    };
    let finished = 0;
    for (let g = 0; g < games; g++) {
      const G = Engine.create({ players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }], first: g % 2, seed: g + 1 });
      let n = 0;
      for (; n < 6000 && G.winner == null && G.turn < 60; n++) {
        const need = Engine.needs(G);
        if (!need) throw new Error(`game ${g}: nobody to act (step ${G.step})`);
        const a = AI.decide(G, need.player);
        const res = Engine.perform(G, need.player, a);
        if (!res.ok) {
          const names = [a.id, ...(a.targets ?? []).map((t) => t?.obj ?? t?.grave)].filter((x) => x != null).map((x) => G.objects[x]?.def.name);
          throw new Error(`game ${g} turn ${G.turn}: AI action ${JSON.stringify(a).slice(0, 160)} [${names.join(' → ')}] failed: ${res.error} (pending ${need.type})`);
        }
      }
      if (G.winner != null || G.turn >= 60) finished++;
    }
    console.log(`  ${finished}/${games} games finished`);
    assert.equal(finished, games);
  };
}

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
