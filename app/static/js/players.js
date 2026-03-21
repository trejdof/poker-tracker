async function loadPlayers() {
  const res = await fetch('/api/players');
  const players = await res.json();
  players.sort((a, b) => {
    const effA = a.total_balance + a.pending_receivable - a.pending_debt;
    const effB = b.total_balance + b.pending_receivable - b.pending_debt;
    return effB - effA;
  });
  const list = document.getElementById('players-list');

  if (players.length === 0) {
    list.innerHTML = '<p class="empty">No players yet. Add one above.</p>';
    return;
  }

  list.innerHTML = players.map(p => `
    <div class="card">
      <div class="info">
        <div class="name" onclick="openPlayerProfile('${p.name.replace(/'/g, "\\'")}')" style="cursor:pointer;">${p.name}</div>
        ${p.pending_debt > 0 ? `<div class="sub" style="color:#e05c5c;">owes ${p.pending_debt.toLocaleString()}</div>` : ''}
        ${p.pending_receivable > 0 ? `<div class="sub" style="color:#4caf82;">expects ${p.pending_receivable.toLocaleString()}</div>` : ''}
      </div>
      <div class="balance ${balanceClass(p.total_balance)}">${balanceLabel(p.total_balance)}</div>
      <div class="actions">
        <button class="btn btn-ghost" onclick="openQR(${p.id}, '${p.name}')">QR</button>
        <button class="btn btn-ghost" onclick="openEdit(${p.id}, '${p.name}', '${p.bank_account}')">Edit</button>
        <button class="btn btn-danger" onclick="deletePlayer(${p.id}, '${p.name}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function addPlayer() {
  const name = document.getElementById('add-name').value.trim();
  const bank = document.getElementById('add-bank').value.trim();
  if (!name || !bank) { showToast('Fill in all fields'); return; }
  if (!/^\d{18}$/.test(bank)) { showToast('Bank account must be exactly 18 digits'); return; }

  const res = await fetch('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, bank_account: bank })
  });

  if (res.ok) {
    document.getElementById('add-name').value = '';
    document.getElementById('add-bank').value = '';
    showToast('Player added');
    loadPlayers();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

function openEdit(id, name, bank) {
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-name').value = name;
  document.getElementById('edit-bank').value = bank;
  document.getElementById('edit-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('edit-modal').classList.remove('open');
}

async function saveEdit() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('edit-name').value.trim();
  const bank = document.getElementById('edit-bank').value.trim();
  if (!/^\d{18}$/.test(bank)) { showToast('Bank account must be exactly 18 digits'); return; }

  const res = await fetch(`/api/players/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, bank_account: bank })
  });

  if (res.ok) {
    closeModal();
    showToast('Player updated');
    loadPlayers();
  } else {
    const err = await res.json();
    showToast(err.error);
  }
}

async function deletePlayer(id, name) {
  if (!confirm(`Delete ${name}?`)) return;
  const res = await fetch(`/api/players/${id}`, { method: 'DELETE' });
  if (res.ok) { showToast('Player deleted'); loadPlayers(); }
}

let qrPlayerId = null;

function openQR(id, name) {
  qrPlayerId = id;
  document.getElementById('qr-title').textContent = `Pay to ${name}`;
  document.getElementById('qr-amount').value = '';
  document.getElementById('qr-image-wrap').style.display = 'none';
  document.getElementById('qr-modal').classList.add('open');
}

function closeQRModal() {
  document.getElementById('qr-modal').classList.remove('open');
}

function generateQR() {
  const amount = document.getElementById('qr-amount').value.trim();
  if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }
  const img = document.getElementById('qr-image');
  img.src = `/api/players/${qrPlayerId}/qr/${amount}`;
  document.getElementById('qr-image-wrap').style.display = 'block';
}

function showQRForTransaction(toPlayerId, amount, toPlayerName) {
  document.getElementById('qr-title').textContent = `Pay to ${toPlayerName}`;
  document.getElementById('qr-amount').value = amount;
  document.getElementById('qr-image-wrap').style.display = 'block';
  document.getElementById('qr-image').src = `/api/players/${toPlayerId}/qr/${amount}`;
  document.getElementById('qr-modal').classList.add('open');
}
