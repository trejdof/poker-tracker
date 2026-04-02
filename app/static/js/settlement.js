async function confirmTransaction(txId) {
  const res = await fetch(`/api/transactions/${txId}/confirm`, { method: 'POST' });
  if (res.ok) {
    const t = await res.json();
    updateTxCard(t);
    loadPlayers();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function unconfirmTransaction(txId) {
  const res = await fetch(`/api/transactions/${txId}/unconfirm`, { method: 'POST' });
  if (res.ok) {
    const t = await res.json();
    updateTxCard(t);
    loadPlayers();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

function updateTxCard(t) {
  const card = document.getElementById(`tx-card-${t.id}`);
  const btn = document.getElementById(`tx-confirm-${t.id}`);
  if (!card || !btn) return;
  card.style.borderTopColor = t.confirmed ? '#4caf82' : '#c9a84c';
  card.style.opacity = t.confirmed ? '0.55' : '1';
  if (t.confirmed) {
    btn.textContent = '↩ Undo';
    btn.style.background = 'transparent';
    btn.style.borderColor = '#555';
    btn.style.color = '#666';
    btn.onclick = () => unconfirmTransaction(t.id);
  } else {
    btn.textContent = '✓ Confirm payment';
    btn.style.background = 'transparent';
    btn.style.borderColor = '#4caf82';
    btn.style.color = '#4caf82';
    btn.onclick = () => confirmTransaction(t.id);
  }
}

function renderSettlementContent(containerId, transactions, net_balances) {
  const container = document.getElementById(containerId);

  const sortedNet = [...net_balances].sort((a, b) => b.net - a.net);
  const netHtml = sortedNet.map(p => {
    const color = p.net > 0 ? '#4caf82' : p.net < 0 ? '#e05c5c' : '#888';
    const label = p.net > 0 ? `+${p.net.toLocaleString()}` : p.net.toLocaleString();
    return `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #1e2130;">
        <span style="font-weight:600;">${p.player_name}</span>
        <span style="font-weight:700; color:${color};">${label}</span>
      </div>
    `;
  }).join('');

  const txHtml = transactions.length === 0
    ? '<p style="color:#888; text-align:center; padding:16px 0;">No payments needed — everyone is settled!</p>'
    : `<div class="tx-grid">` +
      transactions.map(t => `
        <div id="tx-card-${t.id}" style="
          background: #1a1d27;
          border: 1px solid #2e3347;
          border-top: 4px solid ${t.confirmed ? '#4caf82' : '#c9a84c'};
          border-radius: 12px;
          padding: 18px;
          opacity: ${t.confirmed ? '0.55' : '1'};
          transition: opacity 0.3s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        ">
          <div style="text-align:center;">
            <div style="font-size:1rem; font-weight:700; color:#fff; white-space:nowrap;">
              ${t.from_player_name} <span style="color:#555; font-weight:400;">→</span> ${t.to_player_name}
            </div>
            <div style="font-size:1.6rem; font-weight:800; color:#c9a84c; margin-top:6px;">${t.amount.toLocaleString()}</div>
          </div>
          <img src="/api/players/${t.to_player_id}/qr/${t.amount}" style="width:100%; max-width:160px; height:auto; aspect-ratio:1; border-radius:8px; background:#fff;" />
          ${t.confirmed
            ? `<button id="tx-confirm-${t.id}" onclick="unconfirmTransaction(${t.id})" style="
                width:100%; background:transparent; border:1px solid #555; color:#666;
                border-radius:8px; padding:10px; font-size:0.9rem; font-weight:600; cursor:pointer;
              ">↩ Undo</button>`
            : `<button id="tx-confirm-${t.id}" onclick="confirmTransaction(${t.id})" style="
                width:100%; background:transparent; border:1px solid #4caf82; color:#4caf82;
                border-radius:8px; padding:10px; font-size:0.9rem; font-weight:600; cursor:pointer;
              ">✓ Confirm payment</button>`
          }
        </div>
      `).join('') + `</div>`;

  container.innerHTML = `
    <div style="margin-bottom:24px;">
      <div style="font-size:0.8rem; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:1px;">Results</div>
      ${netHtml}
    </div>
    <div>
      <div style="font-size:0.8rem; color:#888; margin-bottom:12px; text-transform:uppercase; letter-spacing:1px;">Payments</div>
      ${txHtml}
    </div>
  `;
}

function showSettlement(result) {
  renderSettlementContent('settlement-content', result.transactions, result.net_balances);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-settlement').classList.add('active');
}

async function unfinalizeGame(sessionId) {
  if (!confirm('Reopen this game? Settlements will be cleared and you can re-enter final stacks.')) return;
  const res = await fetch(`/api/sessions/${sessionId}/unfinalize`, { method: 'POST' });
  if (res.ok) {
    showToast('Game reopened');
    await openSession(sessionId);
    loadSessions();
    loadSidebarSessions();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

let currentHistorySessionId = null;

async function openHistorySettlement(sessionId, title, pushHistory = true) {
  const res = await fetch(`/api/sessions/${sessionId}/settlement`);
  const data = await res.json();
  currentHistorySessionId = sessionId;
  document.getElementById('history-settlement-title').textContent = title;
  renderSettlementContent('history-settlement-content', data.transactions, data.net_balances);
  const hasConfirmed = data.transactions.some(t => t.confirmed);
  const reopenBtn = document.getElementById('history-settlement-reopen-btn');
  reopenBtn.style.display = hasConfirmed ? 'none' : '';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-history-settlement').classList.add('active');
  if (pushHistory) history.pushState({ type: 'settlement', id: sessionId, title }, '', `/settlement/${sessionId}`);
}
