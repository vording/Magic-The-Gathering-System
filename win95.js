// タスクバーの時計（見た目だけ）
(function clock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10000);
})();
