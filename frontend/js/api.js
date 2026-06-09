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
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
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

/* ── Player name gate ── */
async function requirePlayer(promptMsg = '請輸入你的名字（英文或中文）：') {
  let name = getPlayer();
  if (!name) {
    name = window.prompt(promptMsg);
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
