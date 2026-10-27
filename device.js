// スマホ判定と、スマホ用のタブ・シートの切り替え（両画面の <head> で読み込む）
// スマホ：幅の狭い画面、またはタッチ操作で高さの低い画面（スマホの横向き）
// スマホのときは <html class="phone"> になり、CSS と JS がこのクラスを見て配置・操作を切り替える
(function () {
  const mq = matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 520px)');
  const apply = () => document.documentElement.classList.toggle('phone', mq.matches);
  apply();
  mq.addEventListener('change', apply);
  window.isPhone = () => mq.matches;

  function setTab(tab) {
    document.body.dataset.tab = tab;
    for (const b of document.querySelectorAll('[data-phone-tab]')) b.setAttribute('aria-pressed', String(b.dataset.phoneTab === tab));
  }

  // シート（下からせり上がる欄）は同じボタンをもう一度押すと閉じる
  function setSheet(sheet) {
    document.body.dataset.sheet = sheet;
    for (const b of document.querySelectorAll('[data-phone-sheet]')) b.setAttribute('aria-pressed', String(b.dataset.phoneSheet === sheet));
    window.dispatchEvent(new Event('phonesheet'));
  }
  window.setPhoneSheet = setSheet;

  document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('[data-phone-tab]');
    if (tabs.length) setTab(tabs[0].dataset.phoneTab);
    for (const b of tabs) b.addEventListener('click', () => setTab(b.dataset.phoneTab));
    for (const b of document.querySelectorAll('[data-phone-sheet]')) {
      b.addEventListener('click', () => setSheet(document.body.dataset.sheet === b.dataset.phoneSheet ? '' : b.dataset.phoneSheet));
    }
  });
})();
