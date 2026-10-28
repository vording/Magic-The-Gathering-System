// 戦場（フェルト）の背景の絵：神殿・川・沼地・マグマ・森から選択。選んだものはこのブラウザに記憶する
(function () {
  const KEY = 'mtg-deckmaker-felt';
  const COLORS = [
    ['temple', '神殿'],
    ['river', '川'],
    ['swamp', '沼地'],
    ['magma', 'マグマ'],
    ['forest', '森'],
  ];
  // 以前の単色の選択は、同じ色の絵に置き換える
  const OLD = { white: 'temple', blue: 'river', black: 'swamp', red: 'magma', green: 'forest' };
  const valid = (c) => COLORS.some(([id]) => id === c);
  let current = 'temple';
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) current = saved;
    else if (OLD[saved]) current = OLD[saved];
  } catch {}
  document.documentElement.dataset.felt = current;

  // 画面内のすべての .felt-picker に色の丸を並べる（スマホではコマンド欄にも置く）
  function build() {
    for (const box of document.querySelectorAll('.felt-picker')) buildBox(box);
  }
  function buildBox(box) {
    for (const [id, name] of COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `felt-swatch felt-${id}`;
      b.setAttribute('aria-label', `戦場の背景：${name}`);
      b.title = name;
      b.setAttribute('aria-pressed', String(id === current));
      b.addEventListener('click', () => {
        current = id;
        document.documentElement.dataset.felt = id;
        try { localStorage.setItem(KEY, id); } catch {}
        for (const s of document.querySelectorAll('.felt-swatch')) s.setAttribute('aria-pressed', String(s.classList.contains(`felt-${id}`)));
      });
      box.append(b);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
