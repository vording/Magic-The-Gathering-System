// 効果音（sounds/ の WAV）。オン・オフはこのブラウザに記憶する
// 使い方: Sound.play('draw')。[data-sound-toggle] のボタンでオン・オフを切り替える
const Sound = (() => {
  const KEY = 'mtg-deckmaker-sound';
  const VOLUME = 0.6;
  // 同じ音が続けて鳴らないよう、この間隔（ms）より短い2回目は鳴らさない（まとめて移動したときなど）
  const GAP = 120;
  const FILES = {
    draw: 'draw', shuffle: 'shuffle', tap: 'tap', untap: 'untap', attack: 'attack2',
    summon: 'summon', artifact: 'artifact', enchant: 'enchant', instant: 'instant', sorcery: 'sorcery',
    destroy: 'destroy', exile: 'buried', discard: 'discard', counter: 'counter',
    lifeloss: 'lifeloss', lifegain: 'regen', phase: 'endphase', endturn: 'endturn', myturn: 'changet',
    button: 'button', cancel: 'cancel', win: 'shell_winduel', lose: 'shell_loseduel',
  };
  // 土地を出したときの音：出せるマナの色（WUBRG の順に並べたもの）で選ぶ。無色・3色以上は grey
  const LAND_FILES = {
    W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
    WU: 'whiteblue', WB: 'blackwhite', WR: 'whitered', WG: 'whitegreen', UB: 'blueblack',
    UR: 'redblue', UG: 'greenblue', BR: 'blackred', BG: 'greenblack', RG: 'greenred',
  };
  for (const [colors, file] of Object.entries(LAND_FILES)) FILES[`land-${colors}`] = file;
  FILES['land-'] = 'grey';

  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch {}
  const audio = {};
  const lastPlayed = {};

  // 土地の音の名前（colors: マナの色の配列。例 ['G', 'U']）
  const landName = (colors) => {
    const key = 'WUBRG'.split('').filter((c) => colors.includes(c)).join('');
    return `land-${key.length <= 2 ? key : ''}`;
  };

  function play(name) {
    const file = FILES[name];
    if (!on || !file) return;
    const now = performance.now();
    if (now - (lastPlayed[name] ?? -Infinity) < GAP) return;
    lastPlayed[name] = now;
    const base = (audio[file] ??= new Audio(`sounds/${file}.wav`));
    // 鳴っている途中なら複製して重ねて鳴らす
    const a = base.paused || base.ended ? base : base.cloneNode();
    a.volume = VOLUME;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  function render() {
    for (const b of document.querySelectorAll('[data-sound-toggle]')) {
      b.textContent = on ? '効果音：オン' : '効果音：オフ';
      b.setAttribute('aria-pressed', String(on));
    }
  }

  function toggle() {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
    render();
    play('button');
  }

  function setup() {
    for (const b of document.querySelectorAll('[data-sound-toggle]')) b.addEventListener('click', toggle);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();

  return { play, landName, get on() { return on; } };
})();
