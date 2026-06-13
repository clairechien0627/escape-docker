/* ══ Escape Docker — xterm.js Terminal ══ */

// xterm.js 從 CDN 載入，使用前確保已引入：
// <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
// <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
// <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">

class EscapeTerminal {
  constructor(containerId, roomId) {
    this.roomId = roomId;
    this.containerId = containerId;
    this.ws = null;
    this.term = null;
    this.fitAddon = null;
    this.connected = false;
    this.reconnecting = false;
  }

  init() {
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1,
      theme: {
        background:    '#0d1117',
        foreground:    '#e6edf3',
        cursor:        '#39ff14',
        cursorAccent:  '#0d1117',
        black:         '#484f58',
        red:           '#f85149',
        green:         '#39ff14',
        yellow:        '#f0c40e',
        blue:          '#58a6ff',
        magenta:       '#bc8cff',
        cyan:          '#56d4dd',
        white:         '#e6edf3',
        brightBlack:   '#6e7681',
        brightRed:     '#ffa198',
        brightGreen:   '#56d364',
        brightYellow:  '#e3b341',
        brightBlue:    '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan:    '#76e3ea',
        brightWhite:   '#f0f6fc',
        selectionBackground: '#264f78',
      },
      scrollback: 5000,
      allowTransparency: false,
      copyOnSelect: true,
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);

    const el = document.getElementById(this.containerId);
    this.term.open(el);
    this.fitAddon.fit();

    // Ctrl+C：有選取文字時複製到剪貼簿，否則照常送出 SIGINT
    // Ctrl+Shift+V：從剪貼簿貼上到終端機
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      if (e.ctrlKey && !e.shiftKey && e.key === 'c') {
        if (this.term.hasSelection()) {
          navigator.clipboard.writeText(this.term.getSelection()).catch(() => {});
          return false;
        }
        return true;
      }

      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        navigator.clipboard.readText().then((text) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(text);
          }
        }).catch(() => {});
        return false;
      }

      return true;
    });

    // Forward keystrokes to server（註冊一次，內部動態取用 this.ws，避免重連後重複註冊）
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    });

    window.addEventListener('resize', () => this._onResize());
    this._connect();
    return this;
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws?room=${this.roomId}`;

    this.term.writeln('\x1b[33mConnecting to container...\x1b[0m');
    this._showLoadingOverlay('正在啟動房間環境，請稍候（約 5-10 秒）...');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnecting = false;
      this._hideDisconnectBanner();
      // 重置終端機狀態（alternate screen / scroll region / 游標等），避免上一個
      // session（可能斷線在 vim/less 等全螢幕程式的 escape sequence 中途）的殘留
      // 狀態污染新 pty session 的畫面，造成滾動時的疊圖/破圖
      this.term.reset();
      this._onResize();
    };

    this.ws.onmessage = (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        // 非 JSON：原始終端機輸出
      }

      if (msg && msg.type === 'status' && msg.message === 'starting') {
        this._showLoadingOverlay('正在啟動房間環境，請稍候（約 5-10 秒）...');
        return;
      }
      if (msg && msg.type === 'ready') {
        this._hideLoadingOverlay();
        return;
      }
      if (msg && msg.type === 'error') {
        this._hideLoadingOverlay();
        this.term.writeln(`\r\n\x1b[31m[ERROR] ${msg.message}\x1b[0m\r\n`);
        return;
      }

      this._hideLoadingOverlay();
      this.term.write(ev.data);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._hideLoadingOverlay();
      this.term.writeln('\r\n\x1b[33m[Connection closed.]\x1b[0m');
      this._showDisconnectBanner('⚠️ 連線中斷，正在重新連線...');

      if (!this.reconnecting) {
        this.reconnecting = true;
        setTimeout(() => this._connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      this._hideLoadingOverlay();
      this.term.writeln('\r\n\x1b[31m[Connection error. Is the container running?]\x1b[0m');
    };
  }

  _showLoadingOverlay(text) {
    const overlay = document.getElementById('terminal-loading-overlay');
    if (!overlay) return;
    if (text) document.getElementById('terminal-loading-text').textContent = text;
    overlay.classList.remove('hidden');
  }

  _hideLoadingOverlay() {
    const overlay = document.getElementById('terminal-loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  _showDisconnectBanner(text) {
    const banner = document.getElementById('terminal-disconnect-banner');
    if (!banner) return;
    if (text) banner.textContent = text;
    banner.classList.remove('hidden');
  }

  _hideDisconnectBanner() {
    const banner = document.getElementById('terminal-disconnect-banner');
    if (banner) banner.classList.add('hidden');
  }

  _onResize() {
    this.fitAddon.fit();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.term.cols,
        rows: this.term.rows,
      }));
    }
  }

  dispose() {
    if (this.ws) this.ws.close();
    if (this.term) this.term.dispose();
  }
}
