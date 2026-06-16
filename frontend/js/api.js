/* ══ Escape Docker API Client ══ */

const API_BASE = '/api';

function getPlayer() {
  return localStorage.getItem('escape_docker_player') || null;
}

function setPlayer(name) {
  localStorage.setItem('escape_docker_player', name);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const API = {
  register: (name, avatar = '🐳') =>
    apiFetch('/register', { method: 'POST', body: JSON.stringify({ name, avatar }) }),

  submit: (flag) => {
    const player_name = getPlayer();
    if (!player_name) throw new Error('未登入，請先輸入名字');
    return apiFetch('/submit', { method: 'POST', body: JSON.stringify({ player_name, flag }) });
  },

  scoreboard: () => apiFetch('/scoreboard'),

  player: (name) => apiFetch(`/player/${encodeURIComponent(name || getPlayer())}`),

  rooms: () => apiFetch('/rooms'),

  roomsStatus: () => apiFetch('/rooms/status'),

  hints: (room_id) => apiFetch(`/hints/${room_id}`),

  useHint: (room_id, level) => {
    const player_name = getPlayer();
    return apiFetch('/hint', { method: 'POST', body: JSON.stringify({ player_name, room_id, level }) });
  },

  enter: (room_id) => {
    const player_name = getPlayer();
    if (!player_name) return Promise.resolve();
    return apiFetch('/enter', { method: 'POST', body: JSON.stringify({ player_name, room_id }) });
  },

  achievements: () => apiFetch('/achievements'),
};

/* ── Toast helper ── */
function toast(msg, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-fade');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

/* ── Clipboard helper ── */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => toast('已複製到剪貼簿', 'success', 1500))
    .catch(() => toast('複製失敗', 'error'));
}

/* ── Inline prompt modal (replaces window.prompt which is blocked in some envs) ── */
function showPromptModal(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,.65);',
      'display:flex;align-items:center;justify-content:center;z-index:9999',
    ].join('');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;',
      'padding:1.5rem 1.8rem;min-width:320px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.5)',
    ].join('');

    const label = document.createElement('p');
    label.style.cssText = 'margin:0 0 1rem;color:var(--text-main);font-size:0.95rem';
    label.textContent = msg;

    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = '輸入名字…';
    input.style.cssText = [
      'width:100%;box-sizing:border-box;padding:.55rem .75rem;',
      'background:var(--bg-hover);border:1px solid var(--border);',
      'border-radius:6px;color:var(--text-main);font-size:0.9rem;outline:none',
    ].join('');

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:.6rem;justify-content:flex-end;margin-top:1rem';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = [
      'padding:.4rem .9rem;background:transparent;border:1px solid var(--border);',
      'border-radius:6px;color:var(--text-dim);cursor:pointer;font-size:0.85rem',
    ].join('');

    const okBtn = document.createElement('button');
    okBtn.textContent = '確認';
    okBtn.style.cssText = [
      'padding:.4rem .9rem;background:var(--blue);border:none;',
      'border-radius:6px;color:#0d1117;font-weight:700;cursor:pointer;font-size:0.85rem',
    ].join('');

    btnRow.append(cancelBtn, okBtn);
    box.append(label, input, btnRow);
    overlay.appendChild(box);

    document.body.appendChild(overlay);
    input.focus();

    const finish = (val) => { overlay.remove(); resolve(val); };

    okBtn.addEventListener('click', () => finish(input.value));
    cancelBtn.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(input.value);
      if (e.key === 'Escape') finish(null);
    });
  });
}

/* ── Player name gate ── */
async function requirePlayer(promptMsg = '請輸入你的名字（英文或中文）：') {
  let name = getPlayer();
  if (!name) {
    name = await showPromptModal(promptMsg);
    if (!name || !name.trim()) { toast('需要輸入名字才能繼續', 'error'); return null; }
    name = name.trim();
    try {
      await API.register(name);
      setPlayer(name);
      toast(`歡迎，${name}！`, 'success');
    } catch (e) {
      toast(`註冊失敗：${e.message}`, 'error');
      return null;
    }
  }
  return name;
}
