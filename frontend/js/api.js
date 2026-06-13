/* ══ Escape Docker API Client ══ */

const API_BASE = '/api';
const TOKEN_KEY = 'edgerange_token';

let _profileCache = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  _profileCache = null;
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  _profileCache = null;
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const error = new Error(err.detail || err.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getProfile() {
  if (_profileCache) return _profileCache;
  if (!getToken()) return null;
  try {
    _profileCache = await apiFetch('/auth/me');
    return _profileCache;
  } catch (e) {
    clearToken();
    return null;
  }
}

const API = {
  register: (student_id, name, avatar = '🐳') =>
    apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ student_id, name, avatar }) }),

  me: () => apiFetch('/auth/me'),

  submit: (flag) =>
    apiFetch('/submit', { method: 'POST', body: JSON.stringify({ flag }) }),

  scoreboard: () => apiFetch('/scoreboard'),

  player: () => apiFetch('/player/me'),

  rooms: () => apiFetch('/rooms'),

  roomsStatus: () => apiFetch('/rooms/status'),

  hints: (room_id) => apiFetch(`/hints/${room_id}`),

  useHint: (room_id, level) =>
    apiFetch('/hint', { method: 'POST', body: JSON.stringify({ room_id, level }) }),

  enter: (room_id) =>
    apiFetch('/enter', { method: 'POST', body: JSON.stringify({ room_id }) }),

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

/* ── Auth gate ── */
async function requirePlayer() {
  const profile = await getProfile();
  if (!profile) {
    window.location.href = 'index.html';
    return null;
  }
  return profile;
}
