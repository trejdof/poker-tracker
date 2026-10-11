let ncSessionId = null;
let ncMySpId = null;
let ncState = null;
let ncSse = null;
let ncSelectedBet = 0;

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

  const title = document.getElementById('nc-join-title');
  if (title && ncState) {
    title.textContent = ncState.name || `No Chips #${ncState.session_id}`;
  }

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
  list.innerHTML = ncState.players.map((p, i) => {
    const stackLabel = p.chips_in > 0 ? p.stack.toLocaleString() : '';
    return `
    <div class="nc-join-card">
      ${canReorder ? `<div class="nc-reorder-btns">
        <button class="nc-reorder-btn" onclick="ncMovePlayer(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="nc-reorder-btn" onclick="ncMovePlayer(${i}, 1)" ${i === ncState.players.length - 1 ? 'disabled' : ''}>↓</button>
      </div>` : ''}
      <span class="nc-join-name">${p.player_name}</span>
      ${stackLabel ? `<span class="nc-join-stack">${stackLabel}</span>` : ''}
      <button class="btn btn-ghost" style="font-size:0.78rem; padding:5px 10px;" onclick="ncOpenBuyinModal(${p.session_player_id}, '${p.chips_in > 0 ? 'rebuy' : 'buyin'}', '${p.player_name}')">${p.chips_in > 0 ? '+ Stack' : 'Buy In'}</button>
      <span class="btn btn-ghost" style="font-size:0.82rem; padding:6px 14px;" onclick="ncJoinAs(${p.session_player_id}, '${p.player_name}')">Join</span>
    </div>`;
  }).join('');
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
  // Compute UTG for open hand (3+ players only)
  const spIds = ncState.players.map(p => p.session_player_id);
  const n = spIds.length;
  let utg_sp_id = null;
  if (isOpen && n >= 3) {
    const btnIdx = spIds.indexOf(hand.button_sp_id);
    const bbIdx = (btnIdx + 2) % n;
    utg_sp_id = spIds[(bbIdx + 1) % n];
  }
  let next_utg_sp_id = null;
  if (isBetweenHands && hand && n >= 3) {
    const nextBtnIdx = spIds.indexOf(hand.next_button_sp_id);
    if (nextBtnIdx >= 0) {
      const nextBbIdx = (nextBtnIdx + 2) % n;
      next_utg_sp_id = spIds[(nextBbIdx + 1) % n];
    }
  }

  if (isOpen) {
    if (hand.button_sp_id === ncMySpId)      roleEl.innerHTML = roleBanner('nc-role-banner-btn', '#c9a84c', 'BUTTON');
    else if (hand.sb_sp_id === ncMySpId)     roleEl.innerHTML = roleBanner('nc-role-banner-sb',  '#4caf82', 'SMALL BLIND');
    else if (hand.bb_sp_id === ncMySpId)     roleEl.innerHTML = roleBanner('nc-role-banner-bb',  '#7aa8f0', 'BIG BLIND');
    else if (utg_sp_id === ncMySpId)         roleEl.innerHTML = roleBanner('nc-role-banner-utg', '#c084f0', 'UTG');
    else roleEl.innerHTML = '';
  } else if (isBetweenHands && hand) {
    if (hand.next_button_sp_id === ncMySpId)   roleEl.innerHTML = roleBanner('nc-role-banner-btn', '#c9a84c', 'BUTTON — next hand');
    else if (hand.next_sb_sp_id === ncMySpId)  roleEl.innerHTML = roleBanner('nc-role-banner-sb', '#4caf82', 'SMALL BLIND — next hand');
    else if (hand.next_bb_sp_id === ncMySpId)  roleEl.innerHTML = roleBanner('nc-role-banner-bb', '#7aa8f0', 'BIG BLIND — next hand');
    else if (next_utg_sp_id === ncMySpId)      roleEl.innerHTML = roleBanner('nc-role-banner-utg', '#c084f0', 'UTG — next hand');
    else roleEl.innerHTML = '';
  } else {
    roleEl.innerHTML = '';
  }

  // Stack — show real chip count if player has bought in, otherwise show hand P&L
  const stackEl = document.getElementById('nc-stack-value');
  if (me.chips_in > 0) {
    stackEl.textContent = me.stack.toLocaleString();
    stackEl.className = 'nc-stack-value ' + balanceClass(me.hand_net);
  } else {
    const stackVal = me.hand_net;
    stackEl.textContent = (stackVal >= 0 ? '+' : '') + stackVal.toLocaleString();
    stackEl.className = 'nc-stack-value ' + balanceClass(stackVal);
  }

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

  // Shared: highest bet in current hand (used by call button + presets)
  let maxBet = 0;
  if (isOpen) {
    const playerTotals = ncState.players.map(p =>
      (p.current_hand_bets || []).filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0)
    );
    maxBet = Math.max(...playerTotals, 0);
  }

  // Call button — show when player hasn't matched the highest bet this hand
  const callBtn = document.getElementById('nc-call-btn');
  const callAmountEl = document.getElementById('nc-call-amount');
  if (callBtn) {
    let callAmount = 0;
    if (isOpen) {
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
  const activeSps = sp_ids.filter(id => !ncState.players.find(p => p.session_player_id === id)?.afk);
  const nextBtnHolder = hand ? hand.next_button_sp_id : (activeSps[0] || null);

  const canStart = nextBtnHolder === ncMySpId && (ncState.status === 'open' || ncState.status === 'waiting');
  startBtn.style.display = canStart ? '' : 'none';

  const handsPlayed = ncState.hand_number > 0;

  const finishBtn = document.getElementById('nc-finish-game-btn');
  finishBtn.style.display = (canStart && handsPlayed) ? '' : 'none';

  const revertBtn = document.getElementById('nc-revert-hand-btn');
  revertBtn.style.display = (canStart && handsPlayed) ? '' : 'none';

  if (canStart) {
    waitingText.style.display = 'none';
  } else {
    waitingText.style.display = '';
    const btnPlayer = ncState.players.find(p => p.session_player_id === nextBtnHolder);
    waitingText.textContent = btnPlayer ? `Waiting for ${btnPlayer.player_name}…` : 'WAITING';
  }

  // Undo buy-in button — show if the current player has any buyins
  const me = ncState.players.find(p => p.session_player_id === ncMySpId);
  const undoBuyinBtn = document.getElementById('nc-undo-buyin-btn');
  if (undoBuyinBtn) undoBuyinBtn.style.display = (me && me.chips_in > 0) ? '' : 'none';

  // AFK button
  const afkBtn = document.getElementById('nc-afk-btn');
  if (afkBtn && me) {
    afkBtn.classList.toggle('afk-active', !!me.afk);
    afkBtn.textContent = me.afk ? '✓ AFK — Will Skip Next Hand' : 'AFK — Skip Next Hand';
  }

  const posList = document.getElementById('nc-positions-list');
  if (activeSps.length >= 2) {
    const btnId = hand ? hand.next_button_sp_id : activeSps[0];
    posList.innerHTML = ncPositionsHtml(activeSps, btnId) + ncAfkPlayersHtml();
  } else {
    posList.innerHTML = ncAfkPlayersHtml();
  }
}

function ncAfkPlayersHtml() {
  const afkPlayers = ncState.players.filter(p => p.afk);
  return afkPlayers.map(p =>
    `<div class="nc-pos-row" style="background:#111; border:1px solid #222; color:#555;">
      <span class="nc-badge nc-badge-afk">AFK</span>
      <span class="nc-pos-name">${p.player_name}</span>
    </div>`
  ).join('');
}

function ncPositionsHtml(sp_ids, btnSpId) {
  if (!sp_ids.length || !btnSpId) return '';
  const btnIdx = sp_ids.indexOf(btnSpId);
  const n = sp_ids.length;
  let sbIdx, bbIdx, utgIdx;
  if (n === 2) { sbIdx = btnIdx; bbIdx = (btnIdx + 1) % n; utgIdx = -1; }
  else { sbIdx = (btnIdx + 1) % n; bbIdx = (sbIdx + 1) % n; utgIdx = n >= 3 ? (bbIdx + 1) % n : -1; }

  const getName = id => (ncState.players.find(p => p.session_player_id === id) || {}).player_name || '?';

  const rows = [
    `<div class="nc-pos-row nc-pos-row-btn"><span class="nc-badge nc-badge-btn">BTN</span><span class="nc-pos-name">${getName(sp_ids[btnIdx])}</span></div>`,
    `<div class="nc-pos-row nc-pos-row-sb"><span class="nc-badge nc-badge-sb">SB</span><span class="nc-pos-name">${getName(sp_ids[sbIdx])}</span></div>`,
    `<div class="nc-pos-row nc-pos-row-bb"><span class="nc-badge nc-badge-bb">BB</span><span class="nc-pos-name">${getName(sp_ids[bbIdx])}</span></div>`,
  ];
  if (utgIdx >= 0) {
    rows.push(`<div class="nc-pos-row nc-pos-row-utg"><span class="nc-badge nc-badge-utg">UTG</span><span class="nc-pos-name">${getName(sp_ids[utgIdx])}</span></div>`);
  }
  return rows.join('');
}

// ─── Bet selection ─────────────────────────────────────────────────────────

function ncResetBetSelection() {
  ncSelectedBet = 0;
  const input = document.getElementById('nc-custom-val');
  if (input) input.value = '';
  ncUpdateBetPreview();
}

function ncDigit(d) {
  const input = document.getElementById('nc-custom-val');
  const current = input.value;
  input.value = (current === '' || current === '0') && d !== '0' ? d : current === '0' && d === '0' ? '0' : current + d;
  ncSelectedBet = parseInt(input.value) || 0;
  ncUpdateBetPreview();
}

function ncBackspace() {
  const input = document.getElementById('nc-custom-val');
  input.value = input.value.slice(0, -1);
  ncSelectedBet = parseInt(input.value) || 0;
  ncUpdateBetPreview();
}

function ncClearAmount() {
  const input = document.getElementById('nc-custom-val');
  input.value = '';
  ncSelectedBet = 0;
  ncUpdateBetPreview();
}

function ncUpdateBetPreview() {
  const el = document.getElementById('nc-bet-preview');
  if (el) el.textContent = ncSelectedBet > 0 ? ncSelectedBet : '—';
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
  if (input) ncSelectedBet = parseInt(input.value) || 0;
  if (ncSelectedBet <= 0) { showToast('Enter an amount'); return; }
  const me = ncState.players.find(p => p.session_player_id === ncMySpId);
  if (me && me.chips_in > 0 && ncSelectedBet > me.stack) {
    showToast(`Exceeds your stack (${me.stack.toLocaleString()})`);
    return;
  }
  const res = await fetch(`/api/sessions/${ncSessionId}/hands/${ncState.current_hand.id}/bet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncMySpId, amount: ncSelectedBet })
  });
  if (res.ok) {
    ncClearAmount();
  } else {
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
  let callAmount = maxBet - myBet;
  if (callAmount <= 0) return;
  if (me.chips_in > 0) callAmount = Math.min(callAmount, me.stack);
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
  const gameName = (ncState && ncState.name) ? ncState.name : `No Chips #${data.session_id}`;
  await openHistorySettlement(data.session_id, gameName);
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

async function ncToggleAfk() {
  // Optimistic update — flip immediately, SSE will confirm
  const me = ncState && ncState.players.find(p => p.session_player_id === ncMySpId);
  if (!me) { showToast('No seat selected'); return; }
  const newAfk = !me.afk;
  me.afk = newAfk;
  const afkBtn = document.getElementById('nc-afk-btn');
  if (afkBtn) {
    afkBtn.classList.toggle('afk-active', newAfk);
    afkBtn.textContent = newAfk ? '✓ AFK — Will Skip Next Hand' : 'AFK — Skip Next Hand';
  }

  try {
    const res = await fetch(`/api/sessions/${ncSessionId}/set-afk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_player_id: ncMySpId })
    });
    if (!res.ok) {
      // Revert optimistic update on failure
      me.afk = !newAfk;
      if (afkBtn) {
        afkBtn.classList.toggle('afk-active', !newAfk);
        afkBtn.textContent = !newAfk ? '✓ AFK — Will Skip Next Hand' : 'AFK — Skip Next Hand';
      }
      const err = await res.json();
      showToast(err.error);
    }
  } catch {
    me.afk = !newAfk;
    if (afkBtn) {
      afkBtn.classList.toggle('afk-active', !newAfk);
      afkBtn.textContent = !newAfk ? '✓ AFK — Will Skip Next Hand' : 'AFK — Skip Next Hand';
    }
    showToast('Network error');
  }
}

async function ncUndoBuyin() {
  if (!confirm('Undo your last buy-in?')) return;
  const res = await fetch(`/api/sessions/${ncSessionId}/undo-buyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncMySpId })
  });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

async function ncRevertLastHand() {
  if (!confirm('Undo the last hand result? The previous button holder will be able to pick the winner again.')) return;
  const res = await fetch(`/api/sessions/${ncSessionId}/revert-last-hand`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    showToast(err.error);
  }
}

// ─── Buy In / Cash Out modal ────────────────────────────────────────────────

let ncBuyinTargetSpId = null;
let ncBuyinType = 'buyin';

function ncOpenBuyinModal(spId, type, playerName) {
  ncBuyinTargetSpId = spId;
  ncBuyinType = type || 'buyin';
  document.getElementById('nc-buyin-modal-title').textContent = ncBuyinType === 'rebuy' ? 'Rebuy' : 'Buy In';
  const nameEl = document.getElementById('nc-buyin-modal-player');
  if (playerName) {
    nameEl.textContent = playerName;
  } else if (ncState) {
    const p = ncState.players.find(p => p.session_player_id === spId);
    nameEl.textContent = p ? p.player_name : '';
  }
  document.getElementById('nc-buyin-display').value = '';
  document.getElementById('nc-buyin-modal').classList.add('open');
}

function ncCloseBuyinModal() {
  document.getElementById('nc-buyin-modal').classList.remove('open');
  ncBuyinTargetSpId = null;
}

function ncBuyinDigit(d) {
  const input = document.getElementById('nc-buyin-display');
  const cur = input.value;
  input.value = (cur === '' || cur === '0') && d !== '0' ? d : cur === '0' && d === '0' ? '0' : cur + d;
}

function ncBuyinBackspace() {
  const input = document.getElementById('nc-buyin-display');
  input.value = input.value.slice(0, -1);
}

async function ncSubmitBuyin() {
  const amount = parseInt(document.getElementById('nc-buyin-display').value) || 0;
  if (amount <= 0) { showToast('Enter an amount'); return; }
  if (!ncBuyinTargetSpId) return;

  const res = await fetch(`/api/sessions/${ncSessionId}/no-chips-buyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_player_id: ncBuyinTargetSpId, amount, type: ncBuyinType })
  });

  if (res.ok) {
    ncCloseBuyinModal();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

