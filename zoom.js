// スマホ：カードの長押しで拡大表示（両画面の <head> で読み込む）
// onLongPress(el, fn)：タッチの長押し。showCardDetail({ name, image }, [[ボタン名, fn], ...])：拡大表示
(function () {
  // 長押し（タッチのみ）。長押し後に続けて起きる click は無視する
  function onLongPress(el, fn) {
    let timer = null;
    let sx = 0;
    let sy = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      // 端末によっては長押しの後に click が起きないので、次に触れたときに印を消す
      delete el.dataset.longpress;
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        el.dataset.longpress = '1';
        fn(e);
      }, 450);
    });
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', (e) => {
      if (!el.dataset.longpress) return;
      delete el.dataset.longpress;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  }

  let dialog = null;

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'card-detail';
    dialog.innerHTML = '<div class="card-detail-body"><div class="card-detail-card"></div><div class="name card-detail-name"></div><div class="card-detail-actions"></div></div>';
    // ボタン以外のどこを押しても閉じる
    dialog.addEventListener('click', (e) => {
      if (!e.target.closest('.card-detail-actions button')) dialog.close();
    });
    document.body.append(dialog);
  }

  function showCardDetail(card, actions = []) {
    if (!dialog) build();
    const box = dialog.querySelector('.card-detail-card');
    if (card.image) {
      const img = document.createElement('img');
      img.alt = card.name;
      // Scryfall の画像は大きいサイズに差し替える（なければ元の画像）
      const large = card.image.replace('/normal/', '/large/');
      img.src = large;
      if (large !== card.image) img.addEventListener('error', () => { img.src = card.image; }, { once: true });
      box.replaceChildren(img);
    } else {
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = card.name;
      box.replaceChildren(text);
    }
    dialog.querySelector('.card-detail-name').textContent = card.name;
    dialog.querySelector('.card-detail-actions').replaceChildren(...actions.map(([label, fn]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        dialog.close();
        fn();
      });
      return b;
    }));
    if (!dialog.open) dialog.showModal();
  }

  window.onLongPress = onLongPress;
  window.showCardDetail = showCardDetail;
})();
