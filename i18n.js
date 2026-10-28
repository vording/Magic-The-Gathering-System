// 表示言語の切り替え（日本語 ⇄ 英語）。両画面の <head> で読み込む。
// 各画面のプログラムは日本語で表示を作り、ここで英語に置き換える（app.js・play.js は言語を意識しない）。
// ・画面の文字と title / placeholder / aria-label / label 属性を、表示されるたびに置き換える
// ・カード名・デッキ名・プレイヤー名・チャットなど、利用者が入れた文字はそのまま残す
// ・prompt / confirm / alert の文言も置き換える
(function () {
  const KEY = 'mtg-deckmaker-lang';
  let lang = 'ja';
  try {
    const saved = localStorage.getItem(KEY);
    lang = saved === 'en' || saved === 'ja' ? saved : (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  } catch {}
  document.documentElement.lang = lang;

  // ---------- 訳語（完全一致） ----------
  const EXACT = new Map(Object.entries({
    // 共通・上下のバー
    'デッキ作成': 'Deck Builder', '一人回し・対戦': 'Solo / Match', '一人回し': 'Solo', 'デッキ': 'Deck',
    'フォーマット': 'Format', '日本語版で表示': 'Show Japanese cards', '初版の絵柄で表示': 'Show first-print art',
    '閉じる': 'Close', 'キャンセル': 'Cancel', 'コピー': 'Copy', 'コピーしました': 'Copied', '共有…': 'Share…',
    '検索': 'Search', '検索中…': 'Searching…', '読み込み中…': 'Loading…', 'さらに表示': 'Show more',
    '非公式のファンコンテンツです。Wizards of the Coastによる承認・後援を受けたものではありません。 カードデータ・画像は':
      'Unofficial fan content. Not approved or endorsed by Wizards of the Coast. Card data and images provided by',
    '提供。': '.',
    // フォーマット
    '公式フォーマット': 'Official formats', '非公式フォーマット': 'Unofficial formats',
    'スタンダード': 'Standard', 'パイオニア': 'Pioneer', 'モダン': 'Modern', 'レガシー': 'Legacy', 'ヴィンテージ': 'Vintage',
    'パウパー': 'Pauper', '統率者': 'Commander', '旧枠モダン': 'Old-Frame Modern', 'ミドルスクール': 'Middle School', 'オールドスクール': 'Old School',
    // カードタイプ
    'クリーチャー': 'Creatures', 'プレインズウォーカー': 'Planeswalkers', 'バトル': 'Battles', 'インスタント': 'Instants',
    'ソーサリー': 'Sorceries', 'アーティファクト': 'Artifacts', 'エンチャント': 'Enchantments', '土地': 'Lands', 'その他': 'Other',
    // デッキ作成
    'カード検索': 'Card Search', 'カード名・Scryfall検索構文（例: 稲妻 / t:creature c:r）': 'Card name or Scryfall syntax (e.g. Lightning Bolt / t:creature c:r)',
    '選択中のフォーマットでリーガルなカードのみ表示されます。': 'Only cards legal in the selected format are shown.',
    '該当するカードが見つかりませんでした。': 'No matching cards found.',
    'デッキを選択': 'Select deck', '新規': 'New', '名前変更': 'Rename', '複製': 'Duplicate', '削除': 'Delete', '一人回し ▶': 'Play ▶',
    'マナカーブ': 'Mana curve', 'デッキリスト': 'Deck list', 'クリア': 'Clear',
    '英語でコピー': 'Copy (English)', '日本語でコピー': 'Copy (Japanese)', 'インポート…': 'Import…', 'インポート': 'Import',
    '「4 Lightning Bolt」形式。MTG Arena などに貼り付けられます': '"4 Lightning Bolt" format. Can be pasted into MTG Arena, etc.',
    '「4 稲妻」形式。日本語版がないカードは英語名': '"4 稲妻" format. Cards without a Japanese printing use English names',
    '検索結果のカードをクリックして追加（右クリックで1枚減らす）': 'Click a search result to add it (right-click to remove one)',
    '使用不可': 'Not legal', '絵柄を選ぶ': 'Choose art', '絵': 'Art', 'カードにマウスを乗せると表示': 'Hover over a card to preview it',
    '自動に戻す': 'Reset to automatic', '印刷が見つかりませんでした。': 'No printings found.', '画像なし': 'No image',
    'デッキ名': 'Deck name', '新しいデッキの名前': 'Name of the new deck', 'デッキを空にしますか？': 'Clear this deck?',
    'デッキ1': 'Deck 1', '日本語名を取得中…': 'Getting Japanese names…',
    'コピーできませんでした。テキストを長押しして「すべてを選択」→「コピー」してください': 'Could not copy. Long-press the text, then "Select All" → "Copy".',
    'デッキのインポート': 'Import Deck', 'デッキリスト（日本語）': 'Deck list (Japanese)', 'デッキリスト（英語）': 'Deck list (English)',
    'デッキリストを貼り付けてください。1行に1種類（例：': 'Paste a deck list, one card per line (e.g. ',
    '、': ', ',
    '）。英語名・日本語名のどちらでも、MTG Arena の形式でも読み込めます。新しいデッキとして追加され、フォーマットは今のデッキと同じになります。':
      '). English or Japanese names and the MTG Arena format are supported. It is added as a new deck in the current deck\'s format.',
    '空欄ならリスト内の名前か「インポート」': 'If empty, the name in the list or "Import"',
    'カードの行が見つかりませんでした。「4 Lightning Bolt」「4 稲妻」のように1行に1種類書いてください。': 'No card lines found. Write one card per line, like "4 Lightning Bolt" or "4 稲妻".',
    'Scryfall に接続できません。短時間に検索しすぎた場合は1分ほど待ってから再度お試しください': 'Cannot connect to Scryfall. If you searched too often, wait about a minute and try again.',
    'カード検索 ': 'Card Search ', 'デッキ（': 'Deck (', '枚）': ' cards)', '枚': 'cards',
    // 一人回し・対戦：画面
    'ランダムな名前': 'Random name',
    // 戦闘
    'このターン +X/+X…': 'This turn +X/+X…', 'ダメージを取り除く': 'Remove damage',
    'このターンの修整（例: +2/+2、-1/-1、+3/+0）': 'Modifier for this turn (e.g. +2/+2, -1/-1, +3/+0)',
    'ブロック：自分のクリーチャー → 相手の攻撃クリーチャーの順にクリック': 'Block: click your creature, then an attacking creature',
    'タップしているクリーチャーはブロックできません': "Tapped creatures can't block",
    '戦闘ダメージ': 'Combat Damage', '結果': 'Result', '適用': 'Apply', '適用しない': "Don't apply", 'ダメージはありません': 'No damage',
    'キーワード能力（先制攻撃・二段攻撃・トランプル・接死・絆魂・破壊不能）だけを計算しています。ほかの効果は「適用しない」で閉じて手で処理してください。':
      'Only keyword abilities (first strike, double strike, trample, deathtouch, lifelink, indestructible) are calculated. For other effects, close with "Don\'t apply" and handle them by hand.',
    '一人回しで相手に与えたダメージの合計': 'Total damage dealt to the opponent (solo)',
    'この7枚で始めるならキープ、引き直すならマリガン': 'Keep to start with these 7 cards, or mulligan to draw a new hand',
    '手札のカードをクリック（スマホはタップ）すると、ライブラリーの一番下に置きます': 'Click (or tap) a card in your hand to put it on the bottom of your library',
    'アバター': 'Avatar', 'クリックでアバターを変える': 'Click to change your avatar',    '神殿': 'Temple', '川': 'River', '沼地': 'Swamp', 'マグマ': 'Magma', '森': 'Forest',
    '操作メニュー': 'Actions', '1枚追加': 'Add 1', '1枚減らす': 'Remove 1',
    '効果音：オン': 'Sound: On', '効果音：オフ': 'Sound: Off',
    '元に戻す': 'Undo', 'リスタート': 'Restart', 'ターン終了': 'End Turn', '次へ': 'Next', 'フェイズを選ぶ': 'Choose phase',
    'このターンにプレイした土地の数': 'Lands played this turn', 'あなた': 'You', 'プレイヤー': 'Player', '相手': 'Opponent',
    'クリックで数値を入力': 'Click to enter a value', 'ライフ −1': 'Life −1', 'ライフ ＋1': 'Life +1', 'ライフ': 'Life',
    'ライブラリー': 'Library', '手札': 'Hand', '戦場': 'Battlefield', '墓地': 'Graveyard', '追放': 'Exile',
    'ライブラリーの枚数': 'Cards in library', '手札の枚数': 'Cards in hand', '墓地：クリックで一覧': 'Graveyard: click to view', '追放：クリックで一覧': 'Exile: click to view',
    'ライブラリー：クリックで1枚引く／右クリックでメニュー': 'Library: click to draw / right-click for menu',
    'ログ': 'Log', 'ログ・チャット': 'Log / Chat', 'コマンド': 'Commands', 'メッセージ': 'Message', '送信': 'Send',
    '1枚引く（D）': 'Draw a card (D)', 'シャッフル': 'Shuffle', '上から見る': 'Look at top', 'ライブラリーを探す': 'Search library',
    '上から墓地へ': 'Mill', 'すべてアンタップ': 'Untap all', 'トークンを出す': 'Create token',
    '手札: ダブルクリックで戦場へ': 'Hand: double-click to put onto the battlefield',
    '戦場: クリックでタップ（攻撃ステップではクリックで攻撃）': 'Battlefield: click to tap (in the attack step, click to attack)',
    '右クリックで移動メニュー／ドラッグでも移動できます': 'Right-click for the move menu / you can also drag cards',
    'カードをクリック（右クリック）で移動先を選択': 'Click (or right-click) a card to choose where it goes',
    'シャッフルして閉じる': 'Shuffle and close',
    'ゲームの開始': 'Start Game', '遊び方': 'Mode', 'ネット対戦：部屋を作る': 'Online: create a room', 'ネット対戦：部屋に入る': 'Online: join a room',
    '部屋コード': 'Room code', '名前': 'Name', '順番': 'Play order', 'ランダム': 'Random', '先手': 'On the play', '後手（1ターン目にドロー）': 'On the draw (draw on turn 1)',
    '後手': 'On the draw', '部屋に入る場合、先手・後手は部屋を作った人の選択で決まります。': 'When joining a room, the play order is decided by the room creator.',
    'デッキ作成に戻る': 'Back to Deck Builder', '開始': 'Start', 'このコードを相手に伝えてください': 'Share this code with your opponent', '共有・コピー': 'Share / Copy',
    '長押しでコピー': 'Long-press to copy', 'デッキがありません。デッキ作成画面で作ってください。': 'No decks yet. Create one in the Deck Builder.',
    'デッキに7枚以上のカードが必要です。': 'The deck needs at least 7 cards.', '部屋コードを入力してください。': 'Enter a room code.',
    // フェイズ
    'アンタップ': 'Untap', 'アップキープ': 'Upkeep', 'ドロー': 'Draw', 'メイン1': 'Main 1', '戦闘開始': 'Begin Combat', '攻撃': 'Attack',
    'ブロック': 'Block', 'ダメージ': 'Damage', '戦闘終了': 'End Combat', 'メイン2': 'Main 2', '終了': 'End', 'クリーンアップ': 'Cleanup',
    'マリガン': 'Mulligan', '開始待ち': 'Waiting to start', '準備中': 'Preparing', '初手': 'Opening hand', 'キープ': 'Keep',
    '初手を確認して、キープかマリガンを選んでください。': 'Check your opening hand and choose Keep or Mulligan.',
    'ライブラリーの一番下に置くカードを手札から選んでください。': 'Choose cards from your hand to put on the bottom of your library.',
    'アンタップ・ステップ。': 'Untap step.',
    'アップキープ・ステップ。インスタントを唱えたり、能力を起動したりできます。': 'Upkeep step. You may cast instants and activate abilities.',
    'ドロー・ステップ。インスタントを唱えたり、能力を起動したりできます。': 'Draw step. You may cast instants and activate abilities.',
    '第1メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。': 'First main phase. You may play a land and cast spells.',
    '戦闘開始ステップ。': 'Beginning of combat step.',
    '攻撃クリーチャー指定ステップ。攻撃するクリーチャーをクリックしてください。': 'Declare attackers step. Click creatures to attack.',
    'ブロック・クリーチャー指定ステップ。': 'Declare blockers step.', '戦闘ダメージ・ステップ。': 'Combat damage step.', '戦闘終了ステップ。': 'End of combat step.',
    '第2メイン・フェイズ。土地をプレイしたり、呪文を唱えたりできます。': 'Second main phase. You may play a land and cast spells.',
    '終了ステップ。インスタントを唱えたり、能力を起動したりできます。': 'End step. You may cast instants and activate abilities.',
    'クリーンアップ・ステップ。': 'Cleanup step.', '相手を待っています。': 'Waiting for the opponent.', '相手を待っています': 'Waiting for the opponent',
    '相手プレイヤーのターンです': "Opponent's turn",
    '相手プレイヤーのターンです。インスタントを唱えたり、能力を起動したりできます。': "Opponent's turn. You may cast instants and activate abilities.",
    '相手の接続を待っています（先手・後手は部屋を作った人が決めます）': 'Waiting for the opponent to connect (the room creator decides the play order)',
    '自分のターンを始める': 'Start my turn', '通信が止まったときなどに使います': 'Use this if the connection gets stuck',
    '相手のターンを待たずに、自分のターンを始めますか？': "Start your turn without waiting for the opponent's turn to end?",
    '捨てずに続ける': 'Continue without discarding',
    // 勝敗・承認
    '勝利': 'Victory', '敗北': 'Defeat', 'もう一度': 'Play again', '投了': 'Concede', '投了しますか？': 'Concede this game?',
    'ライフが0になりました': 'Your life reached 0', 'ライブラリーが空の状態でカードを引こうとしました': 'You tried to draw from an empty library',
    '投了しました': 'You conceded', '相手のライフが0になりました': "The opponent's life reached 0",
    '相手のライブラリーが空の状態でカードを引こうとしました': 'The opponent tried to draw from an empty library', '相手が投了しました': 'The opponent conceded',
    '取り消し': 'Cancel', '対応する': 'Respond', 'このステップは次から自動でOK': 'Auto-OK this step from now on',
    '相手が対応しています。終わるまでお待ちください': 'The opponent is responding. Please wait',
    '対応中：終わったら「OK」を押してください': 'Responding: press "OK" when done',
    '自動OKをすべて解除': 'Clear all auto-OK', '相手のステップを自動でOKする設定をすべて解除': "Clear all auto-OK settings for the opponent's steps", '相手の参加を待っています': 'Waiting for an opponent to join',
    // メニュー・ログ
    '戦場へ': 'To battlefield', '手札へ': 'To hand', '墓地へ': 'To graveyard', '追放へ': 'To exile',
    'ライブラリーの一番上へ': 'To top of library', 'ライブラリーの一番下へ': 'To bottom of library',
    '攻撃する': 'Attack', '攻撃する（タップしない・警戒）': 'Attack without tapping (vigilance)', '攻撃を取り消す': 'Cancel attack',
    'タップ': 'Tap', 'カウンター +1': 'Counter +1', 'カウンター −1': 'Counter −1', 'このカードのトークン・コピーを出す': 'Create a token copy of this card',
    '1枚引く': 'Draw a card', 'X枚引く…': 'Draw X cards…', '上からX枚を見る…': 'Look at top X…', '上からX枚を墓地へ…': 'Mill X…', '上からX枚を追放…': 'Exile top X…',
    '何枚引きますか？': 'How many cards to draw?', '上から何枚見ますか？': 'How many cards to look at?', 'トークン名（例: 1/1 兵士）': 'Token name (e.g. 1/1 Soldier)',
    'ライブラリーをシャッフル': 'Shuffled library', 'ライブラリーを探した': 'Searched library', 'ライブラリーが空で引けない': 'Library is empty; cannot draw',
    'ライブラリー（左が一番上）': 'Library (leftmost is top)', '手札から1枚をライブラリーの一番下へ': 'Put a card from hand on the bottom of the library',
    'ターン1開始': 'Turn 1 begins', 'ターン終了（相手のターンへ）': "Ended turn (opponent's turn)", '自分のターンを開始（手動）': 'Started my turn (manually)',
    'ライブラリーの一番上': 'the top of the library', 'ライブラリーの一番下': 'the bottom of the library',
    // 色
    '白': 'White', '青': 'Blue', '黒': 'Black', '赤': 'Red', '緑': 'Green',
    // 通信
    '切断されました。再接続しています…': 'Disconnected. Reconnecting…', '相手が切断しました。再接続を待っています': 'The opponent disconnected. Waiting for them to reconnect',
    '接続用サーバーにつながりません。再試行しています…': 'Cannot reach the connection server. Retrying…',
    '通信ライブラリを読み込めませんでした。同じPCのタブ同士でのみ対戦できます': 'Could not load the networking library. You can only play between tabs on this PC',
  }));

  const T = (s) => EXACT.get(s) ?? s;
  const list = (s) => s.split('、').join(', ');
  const cards = (n) => `${n} card${Number(n) === 1 ? '' : 's'}`;
  const PHASE_RE = '(アンタップ|アップキープ|ドロー|メイン1|戦闘開始|攻撃|ブロック|ダメージ|戦闘終了|メイン2|終了|クリーンアップ)';
  const POOL_NOTE = /^日本語名の候補が多いため古い順に(\d+)件から抽出。条件を足すか英語名で検索すると確実です$/;
  const poolNote = (s) => s.replace(POOL_NOTE, (_, n) => `many Japanese-name matches, so only the oldest ${n} were checked; add conditions or search in English to be sure`);

  // ---------- 訳語（文の形） ----------
  const PATTERNS = [
    // デッキ作成
    [/^絵柄を選ぶ - (.+)$/, (_, n) => `Choose art - ${n}`],
    [/^(\d+) 種類（古い順）。クリックで決定$/, (_, n) => `${n} printings (oldest first). Click to choose`],
    [/^エラー: (.+)$/, (_, m) => `Error: ${m}`],
    [/^(.+)（([A-Z0-9]+)）(\d{4}-\d\d-\d\d)(・日本語版)?$/, (_, s, c, d, ja) => `${s} (${c}) ${d}${ja ? ' · Japanese' : ''}`],
    [/^(\d{4}) ([A-Z0-9]+) 日$/, (_, y, c) => `${y} ${c} JP`],
    [/^(\d+) 件（(.+?)で使用可能）$/, (_, n, f) => `${n} results (legal in ${T(f)})`],
    [/^(\d+) 件（(.+?)で使用可能／(.+)）$/, (_, n, f, note) => `${n} results (legal in ${T(f)}; ${poolNote(note)})`],
    [/^該当するカードが見つかりませんでした（(.+)）$/, (_, note) => `No matching cards found (${poolNote(note)})`],
    [/^デッキ(\d+)$/, (_, n) => `Deck ${n}`],
    [/^インポート(\d+)$/, (_, n) => `Import ${n}`],
    [/^(.+)のコピー$/, (_, n) => `Copy of ${n}`],
    [/^「(.+)」を削除しますか？$/, (_, n) => `Delete "${n}"?`],
    [/^(.+)はちょうど(\d+)枚です（現在(\d+)枚）$/, (_, f, n, c) => `${T(f)} requires exactly ${n} cards (currently ${c})`],
    [/^(.+)は最低(\d+)枚必要です（現在(\d+)枚）$/, (_, f, n, c) => `${T(f)} requires at least ${n} cards (currently ${c})`],
    [/^(.+) は(.+)で使用できません$/, (_, c, f) => `${c} is not legal in ${T(f)}`],
    [/^(.+) は(\d+)枚までです$/, (_, c, n) => `${c}: up to ${cards(n)}`],
    [/^日本語名を調べています…（(\d+)\/(\d+)）$/, (_, a, b) => `Looking up Japanese names… (${a}/${b})`],
    [/^カードを検索しています…（(\d+)\/(\d+)）$/, (_, a, b) => `Searching cards… (${a}/${b})`],
    [/^カードが1枚も見つかりませんでした：(.+)$/, (_, l) => `No cards were found: ${list(l)}`],
    [/^「(.+)」に(\d+)枚を読み込みました。$/, (_, d, n) => `Imported ${cards(n)} into "${d}".`],
    [/^見つからなかったカード：(.+)$/, (_, l) => `Not found: ${list(l)}`],
    [/^サイドボード（(\d+)枚）は読み込んでいません。$/, (_, n) => `The sideboard (${cards(n)}) was not imported.`],
    [/^(.+)（クリックで追加）$/, (_, c) => `${c} (click to add)`],
    [/^(.+)（(.+)・(\d+)枚）$/, (_, d, f, n) => `${d} (${T(f)}, ${cards(n)})`],
    [/^(.+) \((\d+)\)$/, (_, g, n) => (EXACT.has(g) ? `${T(g)} (${n})` : null)],
    // 一人回し・対戦
    [new RegExp(`^(▶ )?${PHASE_RE}(（今）|（次のターン）)?$`), (_, cur, p, note) => `${cur ?? ''}${T(p)}${note === '（今）' ? ' (now)' : note ? ' (next turn)' : ''}`],
    [new RegExp(`^${PHASE_RE} ▼$`), (_, p) => `${T(p)} ▼`],
    [/^(マリガン|開始待ち|準備中) ▼$/, (_, p) => `${T(p)} ▼`],
    [/^ターン (\d+)$/, (_, n) => `Turn ${n}`],
    [/^ターン(\d+)開始$/, (_, n) => `Turn ${n} begins`],
    [/^土地 (\d+)\/(\d+)$/, (_, a, b) => `Lands ${a}/${b}`],
    [/^ライフ (-?\d+)$/, (_, n) => `Life ${n}`],
    [/^敗北：(.+)$/, (_, r) => `Defeat: ${T(r)}`],
    [new RegExp(`^相手の確認待ち（${PHASE_RE}を終えて(?:${PHASE_RE}へ|(ターンを終了))）$`), (_, f, t, end) => `Waiting for the opponent's OK (leave ${T(f)} → ${end ? 'end turn' : T(t)})`],
    [new RegExp(`^(.+)：${PHASE_RE}を終えて(?:${PHASE_RE}へ|(ターンを終了))$`), (_, p, f, t, end) => `${T(p)}: leaving ${T(f)} → ${end ? 'end turn' : T(t)}`],
    // 戦闘
    [/^(.+)はこのターンに出たので攻撃できません（召喚酔い）$/, (_, c) => `${c} entered this turn and can't attack (summoning sickness)`],
    [/^(.+)でブロックする相手の攻撃クリーチャーをクリック$/, (_, c) => `Click the attacking creature to block with ${c}`],
    [/^(.+)は飛行を持っています。飛行か到達がないとブロックできません$/, (_, c) => `${c} has flying. Only creatures with flying or reach can block it`],
    [/^(.+)のブロックを取り消し$/, (_, c) => `${c} no longer blocking`],
    [/^攻撃（ブロック×(\d+)）$/, (_, n) => `Attacking (blocked ×${n})`],
    [/^(.+) → ブロックされなかった$/, (_, a) => `${a} → unblocked`],
    [/^(.+) → ブロック：(.+)$/, (_, a, b) => `${a} → blocked by ${list(b)}`],
    [/^相手に(\d+)点のダメージ$/, (_, n) => `${n} damage to the opponent`],
    [/^相手に(\d+)点のダメージ（与えたダメージの合計に足します）$/, (_, n) => `${n} damage to the opponent (added to the total dealt)`],
    [/^死亡：(.+)（(自分|相手)）$/, (_, c, s) => `Dies: ${c} (${s === '自分' ? 'yours' : "opponent's"})`],
    [/^(.+)（(自分|相手)）に(\d+)点のダメージ$/, (_, c, s, n) => `${c} (${s === '自分' ? 'yours' : "opponent's"}) takes ${n} damage`],
    [/^あなたのライフ \+(\d+)（絆魂）$/, (_, n) => `Your life +${n} (lifelink)`],
    [/^相手のライフ \+(\d+)（絆魂）$/, (_, n) => `Opponent's life +${n} (lifelink)`],
    [/^(.+)はパワー／タフネスが分からないため、計算に入れていません$/, (_, c) => `${c} has unknown power/toughness and was left out of the calculation`],
    [/^(.+)は威迫を持っているので、1体ではブロックできません（このまま計算しています）$/, (_, c) => `${c} has menace and can't be blocked by just one creature (calculated anyway)`],
    [/^戦闘ダメージ：相手に(\d+)点$/, (_, n) => `Combat damage: ${n} to the opponent`],
    [/^(.+)の攻撃で(\d+)点のダメージ$/, (_, p, n) => `Took ${n} damage from ${T(p)}'s attack`],
    [/^(.+)にこのターン([+-]?\d+)\/([+-]?\d+)（(.+)）$/, (_, c, a, b, pt) => `${c} gets ${a}/${b} this turn (${pt})`],
    [/^(.+)のダメージを取り除いた$/, (_, c) => `Removed damage from ${c}`],
    [/^与ダメージ (\d+)$/, (_, n) => `Dealt ${n}`],
    [/^(.+)で(.+)をブロック$/, (_, a, b) => `${a} blocks ${b}`],
    [/^(\d+)枚引いた$/, (_, n) => `Drew ${cards(n)}`],
    [/^(.+)で攻撃(（タップしない）)?$/, (_, c, v) => `${c} attacks${v ? ' (without tapping)' : ''}`],
    [/^(.+)の攻撃を取り消し$/, (_, c) => `${c} no longer attacking`],
    [/^(.+)にカウンター（(-?\d+)）$/, (_, c, n) => `Counter on ${c} (${n})`],
    [/^(.+)のカウンター（(-?\d+)）$/, (_, c, n) => `Counters on ${c} (${n})`],
    [/^(.+)を(タップ|アンタップ)$/, (_, c, t) => `${t === 'タップ' ? 'Tapped' : 'Untapped'} ${c}`],
    [/^(.+)（トークン）が消滅$/, (_, c) => `${c} (token) ceased to exist`],
    [/^(.+)（トークン）を生成$/, (_, c) => `Created ${c} (token)`],
    [/^(.+)：(ライブラリー|手札|戦場|墓地|追放) → (.+)$/, (_, c, f, t) => `${c}: ${T(f)} → ${T(t)}`],
    [/^(.+)を捨てた（手札調整）$/, (_, c) => `Discarded ${c} (hand size)`],
    [/^「(.+)」で開始(?:（(ランダムで)?(先手|後手)）)?$/, (_, d, r, o) => `Started with "${d}"${o ? ` (${r ? 'random: ' : ''}${o === '先手' ? 'on the play' : 'on the draw'})` : ''}`],
    [/^先手・後手が決まりました：あなたは(先手|後手)$/, (_, o) => `Play order decided: you are ${o === '先手' ? 'on the play' : 'on the draw'}`],
    [/^キープ（マリガン(\d+)回）$/, (_, n) => `Kept (${n} mulligan${n === '1' ? '' : 's'})`],
    [/^マリガン（(\d+)回目）$/, (_, n) => `Mulligan (#${n})`],
    [/^マリガン(\d+)回目の手札$/, (_, n) => `Hand after mulligan #${n}`],
    [/^キープすると、手札から(\d+)枚をライブラリーの一番下に置きます（手札(\d+)枚で開始）$/, (_, n, h) => `If you keep, put ${cards(n)} from your hand on the bottom of your library (start with ${cards(h)})`],
    [/^ライブラリーの一番下に置くカードを選択（あと(\d+)枚）$/, (_, n) => `Choose cards to put on the bottom of your library (${n} more)`],
    [/^このターンはすでに土地を(\d+)枚プレイしています。それでも出しますか？$/, (_, n) => `You have already played ${n} land${n === '1' ? '' : 's'} this turn. Play it anyway?`],
    [/^クリーンアップ：手札が(\d+)枚になるまで、捨てるカードを手札からあと(\d+)枚クリックしてください$/, (_, h, n) => `Cleanup: click ${cards(n)} in your hand to discard down to ${h}`],
    [/^手札が(\d+)枚：(\d+)枚捨ててください$/, (_, h, n) => `${cards(h)} in hand: discard ${n}`],
    [/^手札が多すぎます。(\d+)枚捨ててください。$/, (_, n) => `Too many cards in hand. Discard ${n}.`],
    [/^手札調整をスキップ（手札(\d+)枚）$/, (_, n) => `Skipped discarding (${cards(n)} in hand)`],
    [/^ライブラリーの一番下に置くカードを、手札からあと(\d+)枚クリックしてください$/, (_, n) => `Click ${cards(n)} in your hand to put on the bottom of your library`],
    [/^ライブラリーの上から(\d+)枚を見た$/, (_, n) => `Looked at the top ${cards(n)} of the library`],
    [/^ライブラリーの上から(\d+)枚を(墓地|追放)へ：(.*)$/, (_, n, z, l) => `Put the top ${cards(n)} of the library into ${T(z).toLowerCase()}: ${list(l)}`],
    [/^ライブラリーの上から(\d+)枚（左が一番上）$/, (_, n) => `Top ${cards(n)} of the library (leftmost is top)`],
    [/^上から何枚を(墓地|追放)に置きますか？$/, (_, z) => `How many cards from the top to put into ${T(z).toLowerCase()}?`],
    [/^(.+)（(\d+)枚）$/, (_, t, n) => `${translate(t)} (${cards(n)})`],
    [/^(.+)の(墓地|追放)$/, (_, p, z) => `${T(p)}'s ${T(z).toLowerCase()}`],
    [/^(.+)が参加しました$/, (_, p) => `${T(p)} joined`],
    [/^(.+)との接続が切れました$/, (_, p) => `Lost connection with ${T(p)}`],
    [/^(.+)（切断中）$/, (_, p) => `${T(p)} (disconnected)`],
    [/^(.+)：ターン(\d+)（待機中）$/, (_, p, n) => `${T(p)}: Turn ${n} (waiting)`],
    [new RegExp(`^(.+)：ターン(\\d+)・${PHASE_RE}$`), (_, p, n, ph) => `${T(p)}: Turn ${n} · ${T(ph)}`],
    [/^(.+)：デッキを選んでいます$/, (_, p) => `${T(p)}: choosing a deck`],
    [/^(.+)：(開始待ち|準備中|マリガン)$/, (_, p, s) => `${T(p)}: ${T(s)}`],
    [/^部屋 (\S+) を作りました。この部屋コードを相手に伝えてください$/, (_, c) => `Created room ${c}. Share this room code with your opponent`],
    [/^Magic: The Gathering System の部屋コード：(.+)$/, (_, c) => `Magic: The Gathering System room code: ${c}`],
    [/^一人回し・対戦 — (.+)$/, (_, t) => `Solo / Match — ${t}`],
    [/^戦場の背景：(.+)$/, (_, c) => `Battlefield: ${T(c)}`],
    // 通信
    [/^対戦中（部屋 (\S+)・同じPC）$/, (_, c) => `In a match (room ${c}, same PC)`],
    [/^対戦中（部屋 (\S+)）$/, (_, c) => `In a match (room ${c})`],
    [/^相手が切断しました。再接続を待っています（部屋 (\S+)）$/, (_, c) => `The opponent disconnected. Waiting for them to reconnect (room ${c})`],
    [/^通信エラー: (.+)。再試行しています…$/, (_, e) => `Network error: ${e}. Retrying…`],
    [/^通信エラー: (.+)$/, (_, e) => `Network error: ${e}`],
    [/^部屋 (\S+) が見つかりません。再試行しています…$/, (_, c) => `Room ${c} not found. Retrying…`],
    [/^部屋 (\S+) に接続しています…$/, (_, c) => `Connecting to room ${c}…`],
    [/^部屋 (\S+) を作りました。相手の参加を待っています$/, (_, c) => `Created room ${c}. Waiting for an opponent to join`],
    [/^部屋 (\S+) を作りました（同じPC）。相手の参加を待っています$/, (_, c) => `Created room ${c} (same PC). Waiting for an opponent to join`],
    [/^部屋 (\S+) を準備しています…$/, (_, c) => `Preparing room ${c}…`],
    // チャットなどの名前の見出し（「アリス：」）
    [/^(.+)：$/, (_, p) => `${T(p)}: `],
  ];

  const HAS_JA = /[぀-ヿ㐀-鿿！-｠、。「」]/;
  // 英語に置き換える（訳がなければ元のまま）
  function translate(s) {
    if (lang === 'ja' || !s || !HAS_JA.test(s)) return s;
    const lead = s.match(/^\s*/)[0];
    const tail = s.match(/\s*$/)[0];
    const core = s.trim();
    if (!core) return s;
    // HTML の中で改行された文は、空白をまとめてから探す
    let out = EXACT.get(core) ?? EXACT.get(core.replace(/\s+/g, ' '));
    // 複数行の文（インポートの結果など）は1行ずつ
    if (out === undefined && core.includes('\n')) return lead + core.split('\n').map(translate).join('\n') + tail;
    if (out === undefined) {
      for (const [re, fn] of PATTERNS) {
        const m = core.match(re);
        if (!m) continue;
        const r = fn(...m);
        if (r !== null && r !== undefined) { out = r; break; }
      }
    }
    return out === undefined ? s : lead + out + tail;
  }
  window.t = translate;

  // ---------- 画面の置き換え ----------
  const ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
  // 利用者が入れた文字（カード名・チャットなど）が入る場所は置き換えない
  const SKIP = '.name, .card, .text, #preview-text, .menu-preview, .chat-line, script, style, textarea, #deck-name, .game-title';
  const textOrig = new WeakMap(); // テキストノード → { src: 元の日本語, out: 置き換えた文字 }
  const attrOrig = new WeakMap(); // 要素 → { 属性名: { src, out } }

  const skipped = (el) => !!el?.closest?.(SKIP);

  function doText(node) {
    if (skipped(node.parentElement)) return;
    let rec = textOrig.get(node);
    if (!rec || node.data !== rec.out) rec = { src: node.data };
    rec.out = lang === 'ja' ? rec.src : translate(rec.src);
    textOrig.set(node, rec);
    if (node.data !== rec.out) node.data = rec.out;
  }

  function doAttrs(el) {
    if (skipped(el)) return;
    let recs = attrOrig.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      recs ??= {};
      const cur = el.getAttribute(a);
      let rec = recs[a];
      if (!rec || cur !== rec.out) rec = { src: cur };
      rec.out = lang === 'ja' ? rec.src : translate(rec.src);
      recs[a] = rec;
      if (cur !== rec.out) el.setAttribute(a, rec.out);
    }
    if (recs) attrOrig.set(el, recs);
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return doText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) doText(n);
      else doAttrs(n);
    }
  }

  let titleSrc = null;
  let titleOut = null;
  function doTitle() {
    // 最後に自分で設定したタイトルと違えば、新しい元の文とみなす
    if (titleSrc === null || document.title !== titleOut) titleSrc = document.title;
    titleOut = lang === 'ja' ? titleSrc : translate(titleSrc);
    if (document.title !== titleOut) document.title = titleOut;
  }

  let observer = null;
  function observe() {
    observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
        else for (const n of r.addedNodes) walk(n);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---------- prompt / confirm / alert ----------
  const nativePrompt = window.prompt.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  // 初期値はデッキ名など利用者が入れた文字なので訳さない
  window.prompt = (msg, def) => nativePrompt(translate(String(msg ?? '')), def);
  window.confirm = (msg) => nativeConfirm(translate(String(msg ?? '')));
  window.alert = (msg) => nativeAlert(translate(String(msg ?? '')));

  // ---------- 国旗のボタン ----------
  // 1つの丸いボタンに今の言語の国旗を出し、押すともう一方の言語に切り替える
  const FLAGS = {
    ja: '<svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/></svg>',
    // 丸く切り抜いても星の部分が見えるよう、左寄せで切り抜く
    en: '<svg viewBox="0 0 30 20" preserveAspectRatio="xMinYMid slice" aria-hidden="true"><rect width="30" height="20" fill="#b22234"/>'
      + [1, 3, 5, 7, 9, 11].map((k) => `<rect y="${(k * 20 / 13).toFixed(2)}" width="30" height="${(20 / 13).toFixed(2)}" fill="#fff"/>`).join('')
      + '<rect width="13" height="10.77" fill="#3c3b6e"/>'
      + [2, 5, 8].flatMap((y) => [2, 5, 8, 11].map((x) => `<circle cx="${x - 0.5 + (y === 5 ? 1.5 : 0)}" cy="${y}" r="0.7" fill="#fff"/>`)).join('')
      + '</svg>',
  };

  function setLang(next) {
    lang = next;
    document.documentElement.lang = next;
    try { localStorage.setItem(KEY, next); } catch {}
    observer?.disconnect();
    walk(document.body);
    doTitle();
    renderPickers();
    observe();
  }

  // 名前は両方の言語で併記する（言語の切り替えで置き換えない）
  const LABEL = { ja: '日本語 → English', en: 'English → 日本語' };

  function renderPickers() {
    for (const b of document.querySelectorAll('.lang-btn')) {
      b.innerHTML = FLAGS[lang];
      b.title = LABEL[lang];
      b.setAttribute('aria-label', LABEL[lang]);
    }
  }

  function buildPickers() {
    for (const box of document.querySelectorAll('.lang-picker')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-btn';
      b.addEventListener('click', () => setLang(lang === 'ja' ? 'en' : 'ja'));
      box.append(b);
    }
    renderPickers();
  }

  function start() {
    buildPickers();
    walk(document.body);
    doTitle();
    observe();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
