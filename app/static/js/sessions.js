let selectedType = null;
let activeFilter = 'all';
let allSessions = [];
let sidebarFilter = 'all';
let sidebarDeletedVisible = false;
let allSidebarSessions = [];

function openNewSession() {
  selectedType = null;
  document.getElementById('type-cash').classList.remove('btn-primary');
  document.getElementById('type-cash').classList.add('btn-ghost');
  document.getElementById('type-tournament').classList.remove('btn-primary');
  document.getElementById('type-tournament').classList.add('btn-ghost');
  document.getElementById('new-session-buyin').value = '';
  document.getElementById('new-session-modal').classList.add('open');
}

function closeNewSession() {
  document.getElementById('new-session-modal').classList.remove('open');
}

function selectType(type) {
  selectedType = type;
  document.getElementById('type-cash').classList.toggle('btn-primary', type === 'cash');
  document.getElementById('type-cash').classList.toggle('btn-ghost', type !== 'cash');
  document.getElementById('type-tournament').classList.toggle('btn-primary', type === 'tournament');
  document.getElementById('type-tournament').classList.toggle('btn-ghost', type !== 'tournament');
}

async function createSession() {
  if (!selectedType) { showToast('Select a game type'); return; }
  const default_buyin = parseInt(document.getElementById('new-session-buyin').value) || 0;
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: selectedType, default_buyin })
  });
  if (res.ok) {
    const session = await res.json();
    closeNewSession();
    await openSession(session.id);
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

function setFilter(filter) {
  activeFilter = filter;
  ['all','live','unsettled','closed'].forEach(f => {
    const btn = document.getElementById(`filter-${f}`);
    btn.classList.toggle('btn-primary', f === filter);
    btn.classList.toggle('btn-ghost', f !== filter);
  });
  renderSessionsList();
}

function setSidebarFilter(filter) {
  sidebarFilter = filter;
  ['all','live','unsettled','closed'].forEach(f => {
    const btn = document.getElementById('sf-' + f);
    if (btn) btn.classList.toggle('sf-active', f === filter);
  });
  renderSidebarList();
}

function renderSidebarList() {
  const list = document.getElementById('sidebar-sessions-list');
  if (!list) return;
  let filtered = allSidebarSessions;
  if (sidebarFilter === 'live') filtered = allSidebarSessions.filter(s => s.status === 'open' || s.status === 'waiting');
  if (sidebarFilter === 'unsettled') filtered = allSidebarSessions.filter(s => s.status === 'closed' && s.unconfirmed_count > 0);
  if (sidebarFilter === 'closed') filtered = allSidebarSessions.filter(s => s.status === 'closed');
  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:#555; font-size:0.82rem; padding:4px 0;">No games.</p>';
    return;
  }
  list.innerHTML = filtered.map(s => renderSidebarSession(s)).join('');
}

function renderSidebarSession(s) {
  const typeLabel = s.type === 'cash' ? 'Cash' : 'Tournament';
  const startedRaw = s.started_at ? (s.started_at.endsWith('Z') ? s.started_at : s.started_at + 'Z') : null;
  const dateStr = startedRaw ? new Date(startedRaw).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '—';
  let dot, action;
  if (s.status === 'open') { dot = '<span style="color:#4caf82; font-size:0.6rem;">●</span>'; action = `openSession(${s.id})`; }
  else if (s.status === 'waiting') { dot = '<span style="color:#c9a84c; font-size:0.6rem;">●</span>'; action = `openSession(${s.id})`; }
  else if (s.unconfirmed_count > 0) { dot = '<span style="color:#e05c5c; font-size:0.6rem;">●</span>'; action = `openHistorySettlement(${s.id}, '${typeLabel} #${s.id}')`; }
  else { dot = '<span style="color:#2a2d3a; font-size:0.6rem;">●</span>'; action = `openHistorySettlement(${s.id}, '${typeLabel} #${s.id}')`; }
  return `
    <div onclick="${action}" style="
      display:flex; align-items:center; gap:10px; padding:9px 10px; margin-bottom:4px;
      border-radius:8px; cursor:pointer; background:#12141e; border:1px solid #1e2130;
    " onmouseover="this.style.borderColor='#2a2d3a'" onmouseout="this.style.borderColor='#1e2130'">
      ${dot}
      <div style="flex:1; min-width:0;">
        <div style="font-size:0.88rem; font-weight:600; color:#ccc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${typeLabel} #${s.id}</div>
        <div style="font-size:0.72rem; color:#555;">${dateStr}</div>
      </div>
      ${s.status === 'closed' ? `<button class="btn btn-danger" style="padding:3px 8px; font-size:0.72rem;" onclick="event.stopPropagation(); deleteGame(${s.id})">✕</button>` : ''}
    </div>`;
}

async function toggleSidebarDeleted() {
  sidebarDeletedVisible = !sidebarDeletedVisible;
  document.getElementById('sidebar-deleted-icon').textContent = sidebarDeletedVisible ? '▼' : '▶';
  const container = document.getElementById('sidebar-deleted-list');
  container.style.display = sidebarDeletedVisible ? 'block' : 'none';
  if (sidebarDeletedVisible) {
    const res = await fetch('/api/sessions/deleted');
    const sessions = await res.json();
    if (sessions.length === 0) {
      container.innerHTML = '<p style="color:#555; font-size:0.78rem; padding:4px 0;">No deleted games.</p>';
    } else {
      container.innerHTML = sessions.map(s => {
        const typeLabel = s.type === 'cash' ? 'Cash' : 'Tournament';
        return `<div style="display:flex; align-items:center; gap:8px; padding:7px 10px; margin-bottom:4px; border-radius:8px; background:#12141e; border:1px solid #1e2130; opacity:0.6;">
          <div style="flex:1; font-size:0.85rem; color:#888;">${typeLabel} #${s.id}</div>
          <button class="btn btn-ghost" style="padding:3px 8px; font-size:0.72rem;" onclick="restoreGame(${s.id})">Restore</button>
        </div>`;
      }).join('');
    }
  }
}

async function loadSidebarSessions() {
  const res = await fetch('/api/sessions');
  allSidebarSessions = await res.json();
  const list = document.getElementById('sidebar-sessions-list');
  if (!list) return;

  const preview = document.getElementById('games-preview');
  if (preview) {
    if (allSidebarSessions.length === 0) {
      preview.textContent = 'No games yet';
    } else {
      const s = allSidebarSessions[0];
      const typeLabel = s.type === 'cash' ? 'Cash' : 'Tournament';
      let statusDot = '';
      if (s.status === 'open') statusDot = '🟢 ';
      else if (s.status === 'waiting') statusDot = '🟡 ';
      else if (s.unconfirmed_count > 0) statusDot = '🔴 ';
      preview.textContent = statusDot + typeLabel + ' #' + s.id;
    }
  }

  renderSidebarList();
}

async function loadSessions() {
  const res = await fetch('/api/sessions');
  allSessions = await res.json();
  setFilter(activeFilter);
}

function renderSessionsList() {
  const list = document.getElementById('sessions-list');

  let filtered = allSessions;
  if (activeFilter === 'live') filtered = allSessions.filter(s => s.status === 'open' || s.status === 'waiting');
  if (activeFilter === 'unsettled') filtered = allSessions.filter(s => s.status === 'closed' && s.unconfirmed_count > 0);
  if (activeFilter === 'closed') filtered = allSessions.filter(s => s.status === 'closed');

  if (filtered.length === 0) {
    list.innerHTML = '<p class="empty">No games found.</p>';
    return;
  }

  list.innerHTML = filtered.map(s => {
    const typeLabel = s.type === 'cash' ? 'Cash Game' : 'Tournament';
    const startedRaw = s.started_at ? (s.started_at.endsWith('Z') ? s.started_at : s.started_at + 'Z') : null;
    const dateStr = startedRaw
      ? new Date(startedRaw).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      : 'Not started';

    let badge = '';
    if (s.status === 'open') badge = '<span style="color:#4caf82;font-size:0.8rem;font-weight:600;">● LIVE</span>';
    else if (s.status === 'waiting') badge = '<span style="color:#c9a84c;font-size:0.8rem;font-weight:600;">● WAITING</span>';
    else if (s.unconfirmed_count > 0) badge = `<span style="color:#e05c5c;font-size:0.8rem;font-weight:600;">⚠ ${s.unconfirmed_count} unsettled</span>`;
    else badge = '<span style="color:#4caf82;font-size:0.8rem;">✓ Settled</span>';

    const onclick = s.status === 'closed'
      ? `openHistorySettlement(${s.id}, '${typeLabel} #${s.id}')`
      : `openSession(${s.id})`;

    return `
      <div class="card" style="cursor:pointer;" onclick="${onclick}">
        <div class="info">
          <div class="name">${typeLabel} #${s.id}</div>
          <div class="sub">${dateStr}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${badge}
          ${s.status === 'closed' ? `<button class="btn btn-danger" style="padding:5px 10px; font-size:0.78rem;" onclick="event.stopPropagation(); deleteGame(${s.id})">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

let deletedGamesVisible = false;

async function toggleDeletedGames() {
  deletedGamesVisible = !deletedGamesVisible;
  document.getElementById('deleted-toggle-icon').textContent = deletedGamesVisible ? '▼' : '▶';
  const container = document.getElementById('deleted-games-list');
  container.style.display = deletedGamesVisible ? 'block' : 'none';
  if (deletedGamesVisible) await loadDeletedGames();
}

async function loadDeletedGames() {
  const res = await fetch('/api/sessions/deleted');
  const sessions = await res.json();
  const container = document.getElementById('deleted-games-list');

  if (sessions.length === 0) {
    container.innerHTML = '<p class="empty" style="padding:16px 0;">No deleted games.</p>';
    return;
  }

  container.innerHTML = sessions.map(s => {
    const typeLabel = s.type === 'cash' ? 'Cash Game' : 'Tournament';
    const date = s.started_at
      ? new Date(s.started_at + 'Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'Unknown date';
    return `
      <div class="card" style="opacity:0.6;">
        <div class="info">
          <div class="name">${typeLabel} #${s.id}</div>
          <div class="sub">${date}</div>
        </div>
        <button class="btn btn-ghost" style="padding:6px 12px; font-size:0.82rem;" onclick="restoreGame(${s.id})">Restore</button>
      </div>
    `;
  }).join('');
}

async function restoreGame(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/restore`, { method: 'POST' });
  if (res.ok) {
    showToast('Game restored');
    loadSessions();
    loadDeletedGames();
    loadPlayers();
  }
}

async function deleteGame(sessionId) {
  if (!confirm('Delete this game? All data and balance changes will be reversed.')) return;
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Game deleted');
    loadSessions();
    loadPlayers();
    loadSidebarSessions();
  }
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (name === 'sessions') loadSessions();
  if (name === 'players') { loadPlayers(); loadSidebarSessions(); }
}
