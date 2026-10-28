// Magic: The Gathering System — ネット対戦の通信部分
// PeerJS（無料の公開サーバーで仲介 → ブラウザ同士で直接通信）で2人をつなぐ。
// URL に ?local=1 を付けると、同じPCの別タブ同士を BroadcastChannel でつなぐ（動作確認用）。
//
// 使い方: Net.on('open' | 'close' | 'status' | <メッセージの type>, fn)、Net.host(code)、Net.join(code)、Net.send(msg)

const Net = (() => {
  const PREFIX = 'mtgdm-';
  const RETRY_MS = 3000;
  const handlers = {};
  const useLocal = new URLSearchParams(location.search).has('local');

  let role = null; // 'host' | 'guest'
  let code = null;
  let peer = null;
  let conn = null; // { send(msg), close(), open: boolean }
  let retryTimer = null;
  let stopped = false;

  const on = (type, fn) => { handlers[type] = fn; };
  const emit = (type, msg) => handlers[type]?.(msg);
  const status = (text, state = 'wait') => emit('status', { text, state });
  const connected = () => !!conn?.open;

  function send(msg) {
    if (!connected()) return false;
    try { conn.send(msg); return true; } catch { return false; }
  }

  function newCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => chars[n % chars.length]).join('');
  }

  function scheduleRetry(fn) {
    clearTimeout(retryTimer);
    if (!stopped) retryTimer = setTimeout(fn, RETRY_MS);
  }

  // ---------- PeerJS ----------

  // 部屋は1対1：新しい接続が開いたら古い接続と入れ替える
  // （相手が再読み込みしたとき、古い接続の切断が検知されるまで待たずに再接続できるように）
  function attach(c) {
    const entry = { raw: c, open: false, send: (m) => c.send(m), close: () => c.close() };
    if (!conn?.open) conn = entry;
    c.on('open', () => {
      const old = conn;
      conn = entry;
      entry.open = true;
      if (old && old !== entry) try { old.close(); } catch {}
      status(`対戦中（部屋 ${code}）`, 'ok');
      emit('open');
    });
    c.on('data', (msg) => conn === entry && msg && typeof msg.type === 'string' && emit(msg.type, msg));
    c.on('close', () => {
      if (conn !== entry) return;
      conn.open = false;
      status(role === 'host' ? `相手が切断しました。再接続を待っています（部屋 ${code}）` : '切断されました。再接続しています…', 'wait');
      emit('close');
      if (role === 'guest') scheduleRetry(connectToHost);
    });
    c.on('error', () => {});
  }

  function startPeerHost() {
    peer?.destroy();
    peer = new Peer(PREFIX + code);
    peer.on('open', () => status(`部屋 ${code} を作りました。相手の参加を待っています`, 'wait'));
    peer.on('connection', attach);
    peer.on('disconnected', () => { if (!stopped) peer.reconnect(); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // 再読み込み直後は同じIDがまだ解放されていないことがある
        status(`部屋 ${code} を準備しています…`, 'wait');
        scheduleRetry(startPeerHost);
      } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') {
        status('接続用サーバーにつながりません。再試行しています…', 'error');
        scheduleRetry(startPeerHost);
      } else {
        status(`通信エラー: ${e.type}`, 'error');
      }
    });
  }

  function connectToHost() {
    if (stopped) return;
    if (!peer || peer.destroyed) {
      peer = new Peer();
      peer.on('open', connectToHost);
      peer.on('disconnected', () => { if (!stopped) peer.reconnect(); });
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') status(`部屋 ${code} が見つかりません。再試行しています…`, 'error');
        else status(`通信エラー: ${e.type}。再試行しています…`, 'error');
        scheduleRetry(connectToHost);
      });
      return;
    }
    if (!peer.open) return;
    status(`部屋 ${code} に接続しています…`, 'wait');
    attach(peer.connect(PREFIX + code, { reliable: true }));
  }

  // ---------- 同じPCのタブ同士（BroadcastChannel） ----------

  function startLocal() {
    const bc = new BroadcastChannel(PREFIX + code);
    const me = Math.random().toString(36).slice(2);
    let other = null;
    const bye = () => { try { bc.postMessage({ type: '_bye', _from: me }); } catch {} };
    conn = {
      open: false,
      send: (m) => bc.postMessage({ ...m, _from: me }),
      close: () => {
        removeEventListener('pagehide', bye);
        bc.close();
      },
    };
    bc.onmessage = ({ data }) => {
      if (!data || data._from === me) return;
      if (data.type === '_ping' || data.type === '_pong') {
        if (data.type === '_ping') bc.postMessage({ type: '_pong', _from: me });
        if (other !== data._from || !conn.open) {
          other = data._from;
          conn.open = true;
          status(`対戦中（部屋 ${code}・同じPC）`, 'ok');
          emit('open');
        }
        return;
      }
      if (data.type === '_bye') {
        conn.open = false;
        status('相手が切断しました。再接続を待っています', 'wait');
        emit('close');
        return;
      }
      emit(data.type, data);
    };
    addEventListener('pagehide', bye);
    status(role === 'host' ? `部屋 ${code} を作りました（同じPC）。相手の参加を待っています` : `部屋 ${code} に接続しています…`, 'wait');
    bc.postMessage({ type: '_ping', _from: me });
  }

  // ---------- 開始・終了 ----------

  function start(r, c) {
    stop();
    stopped = false;
    role = r;
    code = c;
    if (useLocal || typeof Peer === 'undefined') {
      if (!useLocal) status('通信ライブラリを読み込めませんでした。同じPCのタブ同士でのみ対戦できます', 'error');
      startLocal();
    } else if (role === 'host') {
      startPeerHost();
    } else {
      connectToHost();
    }
    return code;
  }

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    try { conn?.close(); } catch {}
    try { peer?.destroy(); } catch {}
    conn = null;
    peer = null;
    role = null;
    code = null;
  }

  return {
    on,
    send,
    connected,
    newCode,
    host: (c = newCode()) => start('host', c),
    join: (c) => start('guest', c.trim().toUpperCase()),
    stop,
    get role() { return role; },
    get code() { return code; },
    get active() { return !!role; },
  };
})();
