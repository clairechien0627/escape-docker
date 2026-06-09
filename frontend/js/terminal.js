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
  }

  init() {
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.3,
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
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);

    const el = document.getElementById(this.containerId);
    this.term.open(el);
    this.fitAddon.fit();

    window.addEventListener('resize', () => this._onResize());
    this._connect();
    return this;
  }

  _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${location.host}/ws?room=${this.roomId}`;

    this.term.writeln('\x1b[33mConnecting to container...\x1b[0m');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this._onResize();
    };

    this.ws.onmessage = (ev) => {
      this.term.write(ev.data);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.term.writeln('\r\n\x1b[33m[Connection closed. Press any key to reconnect.]\x1b[0m');
      this.term.onKey(() => this._connect());
    };

    this.ws.onerror = () => {
      this.term.writeln('\r\n\x1b[31m[Connection error. Is the container running?]\x1b[0m');
    };

    // Forward keystrokes to server
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      }
    });
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
