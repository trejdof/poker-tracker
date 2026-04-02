let currentSession = null;
let timerInterval = null;
let rebuySessionPlayerId = null;
let cashOutSessionPlayerId = null;
let clockInterval = null;

function toggleAcc(name) {
  const el = document.getElementById('acc-' + name);
  if (el) el.classList.toggle('open');
}

async function openSession(id, skipTimer = false, pushHistory = true) {
  clearInterval(timerInterval);
  timerInterval = null;
  const res = await fetch(`/api/sessions/${id}`);
  const session = await res.json();

  if (session.type === 'no_chips') {
    if (pushHistory) history.pushState({ type: 'game', id }, '', `/game/${id}`);
    await openNoChipsGame(id);
    return;
  }

  currentSession = session;
  renderSessionScreen(session, skipTimer);
  loadSessionActivity(id);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-session').classList.add('active');
  document.body.classList.add('game-active');
  startSystemClock();
  if (pushHistory) history.pushState({ type: 'game', id }, '', `/game/${id}`);
}

function renderSessionScreen(session, skipTimer = false) {
  const typeLabel = session.type === 'cash' ? 'Cash Game' : 'Tournament';

  const isWaiting = session.status === 'waiting';
  const isOpen = session.status === 'open';
  const isClosed = session.status === 'closed';

  document.getElementById('btn-close-session').style.display = isOpen ? 'inline-block' : 'none';
  document.getElementById('session-total-chips').textContent = session.total_chips.toLocaleString();
  document.getElementById('btn-add-player-session').style.display = (isOpen || isWaiting) ? 'inline-block' : 'none';
  document.getElementById('btn-transfer-chips').style.display = isOpen ? 'inline-block' : 'none';

  clearInterval(timerInterval);
  timerInterval = null;
  document.getElementById('timer-panel').style.cursor = isWaiting ? 'pointer' : 'default';

  const timerEl = document.getElementById('session-timer');
  const hintEl = document.getElementById('timer-hint');
  if (isOpen && session.started_at) {
    timerEl.style.color = '#4caf82';
    hintEl.textContent = '';
    if (!skipTimer) startTimer(session.started_at);
  } else if (isWaiting || !session.started_at) {
    timerEl.textContent = '--:--';
    timerEl.style.color = '#c9a84c';
    hintEl.innerHTML = '<span style="color:#c9a84c; font-size:0.72rem; font-weight:600;">▶ Tap to start</span>';
  } else if (isClosed && session.started_at) {
    timerEl.style.color = '#888';
    hintEl.textContent = '';
    timerEl.textContent = formatDuration(session.started_at, session.ended_at);
  }

  const sorted = [...session.players].sort((a, b) => a.total_buyin - b.total_buyin);
  const grid = document.getElementById('session-players-grid');
  if (sorted.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#555;padding:30px 0;">
      ${isWaiting ? 'No players yet — tap the timer to start, or add players first.' : 'No players in this game.'}
    </div>`;
    return;
  }

  grid.innerHTML = sorted.map((p) => {
    const net = -p.total_buyin;
    const netLabel = net === 0 ? '0' : (net > 0 ? '+' : '') + net.toLocaleString();
    const netColor = net > 0 ? '#4caf82' : net < 0 ? '#e05c5c' : '#888';

    const buyinCount = p.buyins.filter(b => b.amount > 0).length;
    const cashouts = p.buyins.filter(b => b.amount < 0).length;
    const subParts = [];
    if (buyinCount > 1) subParts.push(`${buyinCount}×`);
    if (cashouts > 0) subParts.push(`${cashouts} out`);

    const actionsHtml = isOpen ? `
      <div class="ses-actions-cell">
        <button class="ses-btn-rebuy" onclick="openRebuy(${p.id}, '${p.player_name}')">Re-buy</button>
        <button class="ses-btn-cashout" onclick="openCashOut(${p.id}, '${p.player_name}')">Cash Out</button>
      </div>` : isWaiting ? `
      <div class="ses-actions-cell">
        <button class="ses-btn-remove" onclick="removePlayerFromSession(${p.id}, '${p.player_name}')">Remove</button>
      </div>` : '';

    return `<div class="ses-player-card">
      <div class="ses-card-top">
        <div class="ses-player-name">${p.player_name}</div>
        <div class="ses-amount" style="color:${netColor};">${netLabel}</div>
      </div>
      <div class="ses-buyin-sub">${p.total_buyin.toLocaleString()} in${subParts.length ? ' · ' + subParts.join(' · ') : ''}</div>
      ${actionsHtml}
    </div>`;
  }).join('');
}

function formatDuration(startedAt, endedAt = null) {
  if (!startedAt) return '--:--';
  if (!startedAt.endsWith('Z')) startedAt += 'Z';
  const end = endedAt ? new Date((endedAt.endsWith('Z') ? endedAt : endedAt + 'Z')).getTime() : Date.now();
  const elapsed = Math.floor((end - new Date(startedAt).getTime()) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function startTimer(startedAt) {
  clearInterval(timerInterval);
  const start = typeof startedAt === 'number' ? startedAt : new Date(startedAt.endsWith('Z') ? startedAt : startedAt + 'Z').getTime();
  function tick() {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('session-timer').textContent =
      h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function startSystemClock() {
  clearInterval(clockInterval);
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('system-clock');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  clockInterval = setInterval(tick, 1000);
}

function stopSystemClock() {
  clearInterval(clockInterval);
  clockInterval = null;
}

async function handleTimerClick() {
  if (!currentSession || currentSession.status !== 'waiting') return;
  const clientStart = Date.now();
  const res = await fetch(`/api/sessions/${currentSession.id}/start`, { method: 'POST' });
  if (res.ok) {
    await openSession(currentSession.id, true);
    startTimer(clientStart);
  }
}

async function openAddPlayerToSession() {
  const res = await fetch('/api/players');
  const allPlayers = await res.json();
  const inSession = currentSession.players.map(p => p.player_id);
  const available = allPlayers.filter(p => !inSession.includes(p.id));

  const select = document.getElementById('session-player-select');
  select.innerHTML = '<option value="">Select player...</option>' +
    available.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('session-buyin-amount').value = currentSession.default_buyin || '';
  document.getElementById('add-player-session-modal').classList.add('open');
}

function closeAddPlayerToSession() {
  document.getElementById('add-player-session-modal').classList.remove('open');
}

async function addPlayerToSession() {
  const player_id = document.getElementById('session-player-select').value;
  const amount = document.getElementById('session-buyin-amount').value;
  if (!player_id) { showToast('Select a player'); return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

  const res = await fetch(`/api/sessions/${currentSession.id}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: parseInt(player_id), amount: parseInt(amount) })
  });

  if (res.ok) {
    closeAddPlayerToSession();
    showToast('Player added');
    await openSession(currentSession.id);
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

function openRebuy(sessionPlayerId, name) {
  rebuySessionPlayerId = sessionPlayerId;
  document.getElementById('rebuy-title').textContent = `Re-buy — ${name}`;
  document.getElementById('rebuy-amount').value = '';
  document.getElementById('rebuy-modal').classList.add('open');
}

function openTransfer() {
  const players = currentSession.players;
  const opts = players.map(p => `<option value="${p.id}">${p.player_name}</option>`).join('');
  document.getElementById('transfer-from').innerHTML = opts;
  document.getElementById('transfer-to').innerHTML = opts;
  if (players.length >= 2) document.getElementById('transfer-to').selectedIndex = 1;
  document.getElementById('transfer-amount').value = '';
  document.getElementById('transfer-modal').classList.add('open');
}

function closeTransfer() {
  document.getElementById('transfer-modal').classList.remove('open');
}

async function submitTransfer() {
  const fromId = document.getElementById('transfer-from').value;
  const toId = document.getElementById('transfer-to').value;
  const amount = parseInt(document.getElementById('transfer-amount').value);

  if (fromId === toId) { showToast('Select two different players'); return; }
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

  const [resFrom, resTo] = await Promise.all([
    fetch(`/api/sessions/${currentSession.id}/players/${fromId}/buyin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -amount, type: 'transfer_out' })
    }),
    fetch(`/api/sessions/${currentSession.id}/players/${toId}/buyin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount, type: 'transfer_in' })
    })
  ]);

  if (resFrom.ok && resTo.ok) {
    closeTransfer();
    showToast('Transfer recorded');
    await openSession(currentSession.id);
  } else {
    showToast('Transfer failed');
  }
}

function closeRebuyModal() {
  document.getElementById('rebuy-modal').classList.remove('open');
}

function openCashOut(sessionPlayerId, name) {
  cashOutSessionPlayerId = sessionPlayerId;
  document.getElementById('cashout-title').textContent = `Cash Out — ${name}`;
  document.getElementById('cashout-amount').value = '';
  document.getElementById('cashout-modal').classList.add('open');
}

function closeCashOutModal() {
  document.getElementById('cashout-modal').classList.remove('open');
}

async function submitCashOut() {
  const amount = document.getElementById('cashout-amount').value;
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

  const res = await fetch(`/api/sessions/${currentSession.id}/players/${cashOutSessionPlayerId}/buyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: -parseInt(amount), type: 'cashout' })
  });

  if (res.ok) {
    closeCashOutModal();
    showToast('Cash out recorded');
    await openSession(currentSession.id);
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function submitRebuy() {
  const amount = document.getElementById('rebuy-amount').value;
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }

  const res = await fetch(`/api/sessions/${currentSession.id}/players/${rebuySessionPlayerId}/buyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: parseInt(amount), type: 'rebuy' })
  });

  if (res.ok) {
    closeRebuyModal();
    showToast('Re-buy recorded');
    await openSession(currentSession.id);
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function removePlayerFromSession(sessionPlayerId, name) {
  if (!confirm(`Remove ${name} from this game?`)) return;
  const res = await fetch(`/api/sessions/${currentSession.id}/players/${sessionPlayerId}`, { method: 'DELETE' });
  if (res.ok) {
    showToast(`${name} removed`);
    await openSession(currentSession.id);
  }
}

function closeSession() {
  const players = currentSession.players;
  const totalBuyins = players.reduce((s, p) => s + p.total_buyin, 0);
  document.getElementById('end-game-total-buyins').textContent = totalBuyins.toLocaleString();

  const form = document.getElementById('final-stacks-form');
  form.innerHTML = players.map(p => `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
      <div style="flex:1; font-weight:600;">${p.player_name}</div>
      <div style="font-size:0.8rem; color:#888;">${p.total_buyin.toLocaleString()} in</div>
      <input type="number" min="0" step="100"
        id="final-${p.id}"
        placeholder="Final chips"
        style="width:140px; background:#12141e; border:1px solid #2a2d3a; border-radius:6px; padding:8px 10px; color:#e0e0e0; font-size:0.95rem; outline:none;"
        oninput="updateChipMismatch()"
      />
    </div>
  `).join('');

  document.getElementById('chip-mismatch').style.display = 'none';
  document.getElementById('end-game-modal').classList.add('open');
}

function updateChipMismatch() {
  const players = currentSession.players;
  const totalBuyins = players.reduce((s, p) => s + p.total_buyin, 0);
  const finalValues = players.map(p => ({
    ...p,
    final: parseInt(document.getElementById(`final-${p.id}`)?.value) || 0
  }));
  const totalFinal = finalValues.reduce((s, p) => s + p.final, 0);
  const mismatch = document.getElementById('chip-mismatch');

  if (totalFinal === 0 || totalFinal === totalBuyins) {
    mismatch.style.display = 'none';
    return;
  }

  const diff = totalFinal - totalBuyins;

  if (diff > 0) {
    mismatch.style.display = 'block';
    mismatch.style.borderColor = '#c9a84c';
    mismatch.style.color = '#c9a84c';
    mismatch.style.background = '#1e1a0f';
    mismatch.innerHTML = `⚠ ${diff.toLocaleString()} extra chips counted — no adjustment needed, proceed as-is.`;
    return;
  }

  const missing = -diff;
  const winners = finalValues.filter(p => p.final - p.total_buyin > 0);
  const totalWinnings = winners.reduce((s, p) => s + (p.final - p.total_buyin), 0);

  let absorptionHtml = '';
  if (winners.length === 0) {
    absorptionHtml = '<div style="margin-top:6px; color:#aaa; font-size:0.82rem;">No winners to absorb the difference.</div>';
  } else {
    absorptionHtml = '<div style="margin-top:8px; font-size:0.82rem; color:#aaa;">Winners absorb the missing chips:</div>' +
      winners.map(p => {
        const share = Math.round(missing * (p.final - p.total_buyin) / totalWinnings);
        return `<div style="display:flex; justify-content:space-between; margin-top:4px;">
          <span>${p.player_name}</span>
          <span style="color:#e05c5c; font-weight:600;">-${share.toLocaleString()}</span>
        </div>`;
      }).join('');
  }

  mismatch.style.display = 'block';
  mismatch.style.borderColor = '#e05c5c';
  mismatch.style.color = '#e05c5c';
  mismatch.style.background = '#2a1f1f';
  mismatch.innerHTML = `⚠ ${missing.toLocaleString()} missing from the pot.${absorptionHtml}`;
}

async function submitEndGame() {
  const players = currentSession.players;
  const totalBuyins = players.reduce((s, p) => s + p.total_buyin, 0);

  const finalStacks = players.map(p => ({
    session_player_id: p.id,
    final_chips: parseInt(document.getElementById(`final-${p.id}`)?.value) || 0
  }));

  const totalFinal = finalStacks.reduce((s, e) => s + e.final_chips, 0);
  const mismatch = totalFinal !== totalBuyins;

  if (mismatch && totalFinal - totalBuyins < 0) {
    const missing = totalBuyins - totalFinal;
    const winners = finalStacks.filter(f => {
      const p = players.find(p => p.id === f.session_player_id);
      return f.final_chips - p.total_buyin > 0;
    });
    const totalWinnings = winners.reduce((s, f) => {
      const p = players.find(p => p.id === f.session_player_id);
      return s + (f.final_chips - p.total_buyin);
    }, 0);

    let remainder = missing;
    winners.forEach((f, i) => {
      const p = players.find(p => p.id === f.session_player_id);
      const share = i === winners.length - 1
        ? remainder
        : Math.round(missing * (f.final_chips - p.total_buyin) / totalWinnings);
      f.final_chips -= share;
      remainder -= share;
    });
  }

  const res = await fetch(`/api/sessions/${currentSession.id}/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ final_stacks: finalStacks })
  });

  if (res.ok) {
    const result = await res.json();
    document.getElementById('end-game-modal').classList.remove('open');
    showSettlement(result);
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function loadSessionActivity(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/activity`);
  const entries = await res.json();
  const feed = document.getElementById('ses-activity-feed');
  if (!feed) return;
  if (entries.length === 0) {
    feed.innerHTML = '<div class="ses-activity-empty">No activity yet</div>';
    return;
  }
  const colorMap = { buyin: '#e05c5c', rebuy: '#e05c5c', cashout: '#4caf82', transfer: '#c9a84c' };
  feed.innerHTML = entries.map(e => {
    if (e.type === 'transfer') {
      return `<div class="ses-activity-item">
        <div class="ses-activity-player">${e.from_player} <span style="color:#555;">→</span> ${e.to_player}</div>
        <div class="ses-activity-amount" style="color:#c9a84c;">${e.amount.toLocaleString()}</div>
      </div>`;
    }
    const sign = e.amount > 0 ? '+' : '';
    const color = colorMap[e.type] || '#888';
    return `<div class="ses-activity-item">
      <div class="ses-activity-player">${e.player_name}</div>
      <div class="ses-activity-label">${e.label}</div>
      <div class="ses-activity-amount" style="color:${color};">${sign}${e.amount.toLocaleString()}</div>
    </div>`;
  }).join('');
}
