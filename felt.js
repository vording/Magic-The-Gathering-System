// 戦場（フェルト）の色：赤・青・緑・白・黒から選択。選んだ色はこのブラウザに記憶する
(function () {
  const KEY = 'mtg-deckmaker-felt';
  const COLORS = [
    ['white', '白'],
    ['blue', '青'],
    ['black', '黒'],
    ['red', '赤'],
    ['green', '緑'],
  ];
  const valid = (c) => COLORS.some(([id]) => id === c);
  let current = 'green';
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) current = saved;
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
      b.setAttribute('aria-label', `戦場の色：${name}`);
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
