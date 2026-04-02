let ncSessionId = null;
let ncMySpId = null;
let ncState = null;
let ncSse = null;
let ncSelectedBet = 10;
let ncCustomVal = 10;

// ─── Entry / Cleanup ───────────────────────────────────────────────────────

async function openNoChipsGame(sessionId) {
  ncCleanup();
  document.documentElement.classList.add('nc-active');
  document.body.classList.add('game-active');
  ncSessionId = sessionId;
  ncMySpId = ncGetStoredSeat(sessionId);

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-no-chips-game').classList.add('active');

  // Fetch initial state then decide which screen to show
  const res = await fetch(`/api/sessions/${sessionId}/no-chips-state`);
  ncState = await res.json();

  if (!ncMySpId || !ncState.players.find(p => p.session_player_id === ncMySpId)) {
    await ncShowJoinScreen();
    ncStartSse();  // keep join screen fresh (host adding players on another device)
  } else {
    ncShowGameScreen();
    ncStartSse();
  }
}

function ncCleanup() {
  document.documentElement.classList.remove('nc-active');
  if (ncSse) { ncSse.close(); ncSse = null; }
  ncSessionId = null;
  ncMySpId = null;
  ncState = null;
}

// ─── SSE ───────────────────────────────────────────────────────────────────

function ncStartSse() {
  if (ncSse) { ncSse.close(); }
  ncSse = new EventSource(`/api/sessions/${ncSessionId}/stream`);
  ncSse.onmessage = (e) => {
    ncState = JSON.parse(e.data);
    // If we're on the join screen, just refresh the list (player may have been added by host)
    if (document.getElementById('nc-join-screen').style.display !== 'none') {
      ncRenderJoinList();
    } else {
      ncRenderGameScreen();
    }
  };
  ncSse.onerror = () => {};
}

// ─── LocalStorage seat ─────────────────────────────────────────────────────

function ncGetStoredSeat(sessionId) {
  try {
    const val = localStorage.getItem(`nc_seat_${sessionId}`);
    return val ? parseInt(val) : null;
  } catch { return null; }
}

function ncStoreSeat(sessionId, spId) {
  try { localStorage.setItem(`nc_seat_${sessionId}`, spId); } catch {}
}

// ─── Join screen ───────────────────────────────────────────────────────────

async function ncShowJoinScreen() {
  document.getElementById('nc-join-screen').style.display = '';
  document.getElementById('nc-game-screen').style.display = 'none';

  ncRenderJoinList();
  await ncLoadAddPlayerDropdown();
}

function ncRenderJoinList() {
  const list = document.getElementById('nc-join-list');
  if (!ncState || !ncState.players.length) {
    list.innerHTML = '<p style="color:#888; text-align:center; padding:20px 0;">No players yet — add players below.</p>';
    return;
  }
  const canReorder = ncState.hand_number === 0;
  list.innerHTML = ncState.players.map((p, i) => `
    <div class="nc-join-card">
      ${canReorder ? `<div class="nc-reorder-btns">
        <button class="nc-reorder-btn" onclick="ncMovePlayer(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="nc-reorder-btn" onclick="ncMovePlayer(${i}, 1)" ${i === ncState.players.length - 1 ? 'disabled' : ''}>↓</button>
      </div>` : ''}
      <span class="nc-join-name">${p.player_name}</span>
      <span class="btn btn-ghost" style="font-size:0.82rem; padding:6px 14px;" onclick="ncJoinAs(${p.session_player_id}, '${p.player_name}')">Join</span>
    </div>
  `).join('');
}

async function ncMovePlayer(index, direction) {
  const players = ncState.players;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= players.length) return;

  // Swap in local array
  [players[index], players[newIndex]] = [players[newIndex], players[index]];

  // Send new order to server
  const res = await fetch(`/api/sessions/${ncSessionId}/reorder-players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_ids: players.map(p => p.session_player_id) })
  });

  if (res.ok) {
    ncRenderJoinList();
  } else {
    // Revert local swap on error
    [players[index], players[newIndex]] = [players[newIndex], players[index]];
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncLoadAddPlayerDropdown() {
  const [allRes] = await Promise.all([fetch('/api/players')]);
  const allPlayers = await allRes.json();
  const inSession = ncState ? ncState.players.map(p => p.player_id) : [];
  const available = allPlayers.filter(p => !inSession.includes(p.id));
  const sel = document.getElementById('nc-add-player-select');
  sel.innerHTML = '<option value="">Select player…</option>' +
    available.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function ncAddPlayer() {
  const sel = document.getElementById('nc-add-player-select');
  const playerId = sel.value;
  if (!playerId) { showToast('Select a player'); return; }

  const res = await fetch(`/api/sessions/${ncSessionId}/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_id: parseInt(playerId) })
  });

  if (res.ok) {
    const stateRes = await fetch(`/api/sessions/${ncSessionId}/no-chips-state`);
    ncState = await stateRes.json();
    ncRenderJoinList();
    await ncLoadAddPlayerDropdown();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncSwitchSeat() {
  ncMySpId = null;
  ncStoreSeat(ncSessionId, null);
  await ncShowJoinScreen();
}

async function ncJoinAs(spId, playerName) {
  ncMySpId = spId;
  ncStoreSeat(ncSessionId, spId);
  document.getElementById('nc-join-screen').style.display = 'none';
  // Refresh state before showing game screen
  const res = await fetch(`/api/sessions/${ncSessionId}/no-chips-state`);
  ncState = await res.json();
  ncShowGameScreen();
  ncStartSse();
}

// ─── Game screen ───────────────────────────────────────────────────────────

function ncShowGameScreen() {
  document.getElementById('nc-join-screen').style.display = 'none';
  document.getElementById('nc-game-screen').style.display = 'flex';
  ncResetBetSelection();
  ncRenderGameScreen();
}

function ncRenderGameScreen() {
  if (!ncState || !ncMySpId) return;

  const me = ncState.players.find(p => p.session_player_id === ncMySpId);
  if (!me) return;

  const hand = ncState.current_hand;
  const isButtonHolder = hand && hand.button_sp_id === ncMySpId;
  const isOpen = hand && hand.status === 'open';
  const isBetweenHands = !hand || hand.status === 'closed';

  // Playing as label (tappable to switch seat)
  document.getElementById('nc-playing-as').textContent = `Playing as: ${me.player_name} ✎`;

  // Pot
  const pot = hand ? hand.pot : 0;
  document.getElementById('nc-pot-value').textContent = pot.toLocaleString();
  document.getElementById('nc-hand-number').textContent =
    ncState.hand_number > 0 ? `Hand #${ncState.hand_number}` : '';

  // Role banner
  const roleEl = document.getElementById('nc-role-badge');
  const roleBanner = (cls, dot, label) =>
    `<div class="nc-role-banner ${cls}"><span class="nc-role-dot" style="background:currentColor;"></span>${label}</div>`;
  if (isOpen) {
    if (hand.button_sp_id === ncMySpId)      roleEl.innerHTML = roleBanner('nc-role-banner-btn', '#c9a84c', 'BUTTON');
    else if (hand.sb_sp_id === ncMySpId)     roleEl.innerHTML = roleBanner('nc-role-banner-sb',  '#4caf82', 'SMALL BLIND');
    else if (hand.bb_sp_id === ncMySpId)     roleEl.innerHTML = roleBanner('nc-role-banner-bb',  '#7aa8f0', 'BIG BLIND');
    else roleEl.innerHTML = '';
  } else if (isBetweenHands && hand) {
    if (hand.next_button_sp_id === ncMySpId) roleEl.innerHTML = roleBanner('nc-role-banner-btn', '#c9a84c', 'BUTTON — next hand');
    else if (hand.next_sb_sp_id === ncMySpId) roleEl.innerHTML = roleBanner('nc-role-banner-sb', '#4caf82', 'SMALL BLIND — next hand');
    else if (hand.next_bb_sp_id === ncMySpId) roleEl.innerHTML = roleBanner('nc-role-banner-bb', '#7aa8f0', 'BIG BLIND — next hand');
    else roleEl.innerHTML = '';
  } else {
    roleEl.innerHTML = '';
  }

  // Stack
  const stackVal = me.stack;
  const stackEl = document.getElementById('nc-stack-value');
  stackEl.textContent = (stackVal >= 0 ? '+' : '') + stackVal.toLocaleString();
  stackEl.className = 'nc-stack-value ' + balanceClass(stackVal);

  // Bets row (current hand only)
  const betsRow = document.getElementById('nc-bets-row');
  if (isOpen && me.current_hand_bets.length > 0) {
    betsRow.innerHTML = me.current_hand_bets.map(b => {
      const label = b.type === 'blind_sb' ? `SB` : b.type === 'blind_bb' ? `BB` : '';
      const display = b.amount.toLocaleString() + (label ? ` (${label})` : '');
      return `<span class="nc-bet-pill">${display}</span>`;
    }).join('<span class="nc-bet-sep">·</span>');
    betsRow.scrollLeft = betsRow.scrollWidth;
  } else {
    betsRow.innerHTML = '';
  }

  // Call button — show when player hasn't matched the highest bet this hand
  const callBtn = document.getElementById('nc-call-btn');
  const callAmountEl = document.getElementById('nc-call-amount');
  if (callBtn) {
    let callAmount = 0;
    if (isOpen) {
      const playerTotals = ncState.players.map(p =>
        p.current_hand_bets.filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0)
      );
      const maxBet = Math.max(...playerTotals, 0);
      const myBet = (me.current_hand_bets || []).filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0);
      callAmount = Math.max(0, maxBet - myBet);
    }
    callBtn.style.display = (isOpen && callAmount > 0) ? '' : 'none';
    if (callAmountEl) callAmountEl.textContent = callAmount;
  }

  // END HAND button (button holder only, hand open) — shown at bottom of numpad
  const endBtn = document.getElementById('nc-end-hand-btn');
  endBtn.style.display = (isOpen && isButtonHolder) ? '' : 'none';

  // Numpad vs waiting area
  const numpad = document.getElementById('nc-numpad');
  const waiting = document.getElementById('nc-waiting-area');

  if (isOpen) {
    numpad.style.display = '';
    waiting.style.display = 'none';
  } else {
    numpad.style.display = 'none';
    waiting.style.display = '';
    ncRenderWaiting(hand);
  }
}

function ncRenderWaiting(hand) {
  const startBtn = document.getElementById('nc-start-hand-btn');
  const waitingText = document.getElementById('nc-waiting-text');
  const sp_ids = ncState.players.map(p => p.session_player_id);
  const nextBtnHolder = hand ? hand.next_button_sp_id : (sp_ids[0] || null);

  const canStart = nextBtnHolder === ncMySpId && (ncState.status === 'open' || ncState.status === 'waiting');
  startBtn.style.display = canStart ? '' : 'none';

  const finishBtn = document.getElementById('nc-finish-game-btn');
  // Only show Finish Game between hands (not before any hand has been played) and to button holder
  const handsPlayed = ncState.hand_number > 0;
  finishBtn.style.display = (canStart && handsPlayed) ? '' : 'none';

  if (canStart) {
    waitingText.style.display = 'none';
  } else {
    waitingText.style.display = '';
    const btnPlayer = ncState.players.find(p => p.session_player_id === nextBtnHolder);
    waitingText.textContent = btnPlayer ? `Waiting for ${btnPlayer.player_name}…` : 'WAITING';
  }

  const posList = document.getElementById('nc-positions-list');
  if (sp_ids.length >= 2) {
    const btnId = hand ? hand.next_button_sp_id : sp_ids[0];
    posList.innerHTML = ncPositionsHtml(sp_ids, btnId);
  } else {
    posList.innerHTML = '';
  }
}

function ncPositionsHtml(sp_ids, btnSpId) {
  if (!sp_ids.length || !btnSpId) return '';
  const btnIdx = sp_ids.indexOf(btnSpId);
  const n = sp_ids.length;
  let sbIdx, bbIdx;
  if (n === 2) { sbIdx = btnIdx; bbIdx = (btnIdx + 1) % n; }
  else { sbIdx = (btnIdx + 1) % n; bbIdx = (sbIdx + 1) % n; }

  const getName = id => (ncState.players.find(p => p.session_player_id === id) || {}).player_name || '?';

  return [
    `<div class="nc-pos-row nc-pos-row-btn"><span class="nc-badge nc-badge-btn">BTN</span><span class="nc-pos-name">${getName(sp_ids[btnIdx])}</span></div>`,
    `<div class="nc-pos-row nc-pos-row-sb"><span class="nc-badge nc-badge-sb">SB</span><span class="nc-pos-name">${getName(sp_ids[sbIdx])}</span></div>`,
    `<div class="nc-pos-row nc-pos-row-bb"><span class="nc-badge nc-badge-bb">BB</span><span class="nc-pos-name">${getName(sp_ids[bbIdx])}</span></div>`,
  ].join('');
}

// ─── Bet selection ─────────────────────────────────────────────────────────

function ncResetBetSelection() {
  ncSelectedBet = 10;
  ncCustomVal = 10;
  const input = document.getElementById('nc-custom-val');
  if (input) input.value = 10;
  ncUpdateBetPreview();
  document.querySelectorAll('.nc-preset-btn').forEach(b => b.classList.remove('nc-active'));
}

function ncSelectPreset(amount) {
  ncSelectedBet = amount;
  ncCustomVal = amount;
  const input = document.getElementById('nc-custom-val');
  if (input) input.value = amount;
  ncUpdateBetPreview();
  document.querySelectorAll('.nc-preset-btn').forEach(b => b.classList.remove('nc-active'));
  event.currentTarget.classList.add('nc-active');
}

function ncCustomStep(delta) {
  const input = document.getElementById('nc-custom-val');
  ncCustomVal = Math.max(10, (parseInt(input.value) || 10) + delta);
  input.value = ncCustomVal;
  ncSelectedBet = ncCustomVal;
  ncUpdateBetPreview();
  document.querySelectorAll('.nc-preset-btn').forEach(b => b.classList.remove('nc-active'));
}

function ncOnCustomInput() {
  const input = document.getElementById('nc-custom-val');
  const val = Math.max(1, parseInt(input.value) || 1);
  ncCustomVal = val;
  ncSelectedBet = val;
  ncUpdateBetPreview();
  document.querySelectorAll('.nc-preset-btn').forEach(b => b.classList.remove('nc-active'));
}

function ncUpdateBetPreview() {
  document.getElementById('nc-bet-preview').textContent = ncSelectedBet;
}

// ─── Actions ───────────────────────────────────────────────────────────────

async function ncStartHand() {
  if (ncState && ncState.status === 'waiting') {
    // Start session first
    await fetch(`/api/sessions/${ncSessionId}/start-no-chips`, { method: 'POST' });
  }
  const res = await fetch(`/api/sessions/${ncSessionId}/hands`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncPlaceBet() {
  if (!ncState || !ncState.current_hand || ncState.current_hand.status !== 'open') {
    showToast('No active hand');
    return;
  }
  const input = document.getElementById('nc-custom-val');
  if (input) ncSelectedBet = Math.max(1, parseInt(input.value) || 1);
  const res = await fetch(`/api/sessions/${ncSessionId}/hands/${ncState.current_hand.id}/bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncMySpId, amount: ncSelectedBet })
  });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncRevertBet() {
  if (!ncState || !ncState.current_hand || ncState.current_hand.status !== 'open') return;
  if (!confirm('Revert your last bet?')) return;
  const res = await fetch(`/api/sessions/${ncSessionId}/hands/${ncState.current_hand.id}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncMySpId })
  });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncCall() {
  if (!ncState || !ncState.current_hand || ncState.current_hand.status !== 'open') return;
  const me = ncState.players.find(p => p.session_player_id === ncMySpId);
  if (!me) return;
  const playerTotals = ncState.players.map(p =>
    p.current_hand_bets.filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0)
  );
  const maxBet = Math.max(...playerTotals, 0);
  const myBet = (me.current_hand_bets || []).filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0);
  const callAmount = maxBet - myBet;
  if (callAmount <= 0) return;
  const res = await fetch(`/api/sessions/${ncSessionId}/hands/${ncState.current_hand.id}/bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncMySpId, amount: callAmount })
  });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

function ncConfirmEndHand() {
  if (!confirm('End this hand and select winner?')) return;
  ncOpenWinnerModal();
}

function ncOpenWinnerModal() {
  if (!ncState || !ncState.current_hand) return;
  const pot = ncState.current_hand.pot;
  document.getElementById('nc-winner-pot-label').textContent = `Pot: ${pot.toLocaleString()}`;

  const list = document.getElementById('nc-winner-list');
  list.innerHTML = ncState.players.map(p => `
    <label class="nc-winner-row">
      <input type="checkbox" class="nc-winner-cb" value="${p.session_player_id}" onchange="ncUpdateSplitPreview(${pot})">
      <span>${p.player_name}</span>
    </label>
  `).join('');

  document.getElementById('nc-split-preview').textContent = '';
  document.getElementById('nc-winner-modal').classList.add('open');
}

function ncUpdateSplitPreview(pot) {
  const checked = [...document.querySelectorAll('.nc-winner-cb:checked')];
  const n = checked.length;
  if (n === 0) {
    document.getElementById('nc-split-preview').textContent = '';
    return;
  }
  const perWinner = Math.floor(pot / n);
  const remainder = pot % n;
  let text = n === 1
    ? `Winner takes ${perWinner.toLocaleString()}`
    : `Split: ${perWinner.toLocaleString()} each`;
  if (remainder > 0) text += ` · ${remainder} carries to next hand`;
  document.getElementById('nc-split-preview').textContent = text;
}

function ncCloseWinnerModal() {
  document.getElementById('nc-winner-modal').classList.remove('open');
}

async function ncFinishGame() {
  if (!confirm('Finish the game? This will calculate settlements and show payment QR codes.')) return;
  const res = await fetch(`/api/sessions/${ncSessionId}/finalize-no-chips`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
    return;
  }
  const data = await res.json();
  ncCleanup();
  document.body.classList.remove('game-active');
  await openHistorySettlement(data.session_id, `No Chips Game #${data.session_id}`);
}

async function ncSubmitEndHand() {
  const checked = [...document.querySelectorAll('.nc-winner-cb:checked')];
  if (checked.length === 0) { showToast('Select at least one winner'); return; }

  const winnerIds = checked.map(cb => parseInt(cb.value));
  const res = await fetch(`/api/sessions/${ncSessionId}/hands/${ncState.current_hand.id}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner_session_player_ids: winnerIds })
  });

  if (res.ok) {
    ncCloseWinnerModal();
    ncResetBetSelection();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

// Clear custom input on focus (setTimeout defers past browser's own focus handling)
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('nc-custom-val');
  if (input) {
    input.addEventListener('focus', () => setTimeout(() => { input.value = ''; }, 10));
  }
});
