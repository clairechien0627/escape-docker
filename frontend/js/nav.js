// Mount pattern: add <div id="global-nav"></div> where the navbar should appear,
// then <script src="js/nav.js"> (after js/api.js, which provides getProfile).
const NAV_LINKS = [
  { id: 'hub', label: 'Hub', href: 'index.html' },
  { id: 'story', label: 'Story Mode', href: 'story.html' },
  { id: 'sandbox', label: 'Sandbox', href: 'coming-soon.html?module=sandbox' },
  { id: 'forensics', label: 'Forensics Lab', href: 'coming-soon.html?module=forensics' },
  { id: 'network', label: 'Network Lab', href: 'coming-soon.html?module=network' },
  { id: 'ops', label: 'Ops Center', href: 'coming-soon.html?module=ops' },
  { id: 'maker', label: 'Maker Mode', href: 'coming-soon.html?module=maker' },
  { id: 'scoreboard', label: 'Scoreboard', href: 'scoreboard.html' },
];

function _navIsActive(link) {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const linkPath = link.href.split('?')[0];
  return current === linkPath;
}

async function renderNav() {
  const mount = document.getElementById('global-nav');
  if (!mount) return;

  const linksHtml = NAV_LINKS.map(link => {
    const activeClass = _navIsActive(link) ? ' class="active"' : '';
    return `<a href="${link.href}"${activeClass}>${link.label}</a>`;
  }).join('');

  mount.innerHTML = `
    <nav class="navbar">
      <div class="navbar-brand">▌EDGE://RANGE</div>
      <div class="navbar-links">${linksHtml}</div>
    </nav>
  `;

  const nav = mount.querySelector('.navbar');
  const playerSpan = document.createElement('span');
  playerSpan.className = 'navbar-player';

  let playerText = '未登入';
  if (typeof getProfile === 'function') {
    const profile = await getProfile();
    if (profile) {
      playerText = `${profile.avatar} ${profile.name}`;
    }
  }
  playerSpan.textContent = playerText;
  nav.appendChild(playerSpan);
}

renderNav();
