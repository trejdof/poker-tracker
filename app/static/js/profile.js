let profileData = null;
let profilePeriod = 'all';

async function openPlayerProfile(name, pushHistory = true) {
  const res = await fetch(`/api/players/${encodeURIComponent(name)}/profile`);
  if (!res.ok) { showToast('Player not found'); return; }
  profileData = await res.json();
  profilePeriod = 'all';
  document.querySelectorAll('.prof-filter').forEach(b => {
    b.classList.toggle('active', b.textContent === 'All');
  });
  renderProfilePage();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-player-profile').classList.add('active');
  if (pushHistory) history.pushState({ type: 'player', name }, '', `/player/${encodeURIComponent(name)}`);
}

function setProfileFilter(period, btn) {
  profilePeriod = period;
  document.querySelectorAll('.prof-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = getFilteredGames();
  renderProfileStats(filtered);
  renderProfileChart(filtered);
  renderProfileHistory(filtered);
}

function getFilteredGames() {
  if (!profileData) return [];
  if (profilePeriod === 'all') return profileData.games;
  const cutoff = Date.now() - parseInt(profilePeriod) * 86400000;
  return profileData.games.filter(g => g.ended_at && new Date(g.ended_at).getTime() >= cutoff);
}

function renderProfilePage() {
  const p = profileData.player;
  document.getElementById('profile-avatar').textContent = p.name[0].toUpperCase();
  document.getElementById('profile-name').textContent = p.name;
  let sub = [];
  if (p.pending_debt > 0) sub.push(`owes ${p.pending_debt.toLocaleString()}`);
  if (p.pending_receivable > 0) sub.push(`expects ${p.pending_receivable.toLocaleString()}`);
  document.getElementById('profile-subline').textContent = sub.join(' · ') || 'All settled';
  const tot = p.total_balance;
  const totEl = document.getElementById('profile-total-val');
  totEl.textContent = tot > 0 ? `+${tot.toLocaleString()}` : tot.toLocaleString();
  totEl.style.color = tot > 0 ? '#4caf82' : tot < 0 ? '#e05c5c' : '#888';
  const filtered = getFilteredGames();
  renderProfileStats(filtered);
  renderProfileChart(filtered);
  renderProfileHistory(filtered);
}

function renderProfileStats(games) {
  const wins   = games.filter(g => g.net > 0).length;
  const losses = games.filter(g => g.net < 0).length;
  const total  = games.length;
  const winRate  = total > 0 ? Math.round(wins / total * 100) : 0;
  const totalNet = games.reduce((s, g) => s + g.net, 0);
  const best     = total > 0 ? Math.max(...games.map(g => g.net)) : 0;
  const avg      = total > 0 ? Math.round(totalNet / total) : 0;
  const fmtSigned = v => v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
  const stats = [
    { label: 'Games',     val: total,               color: '#e2e4ef' },
    { label: 'Wins',      val: wins,                color: wins   > 0 ? '#4caf82' : '#888' },
    { label: 'Losses',    val: losses,              color: losses > 0 ? '#e05c5c' : '#888' },
    { label: 'Win Rate',  val: `${winRate}%`,       color: total === 0 ? '#888' : winRate >= 50 ? '#4caf82' : '#e05c5c' },
    { label: 'Best Game', val: fmtSigned(best),     color: best > 0 ? '#4caf82' : best < 0 ? '#e05c5c' : '#888' },
    { label: 'Avg / Game',val: fmtSigned(avg),      color: avg  > 0 ? '#4caf82' : avg  < 0 ? '#e05c5c' : '#888' },
  ];
  document.getElementById('profile-stats').innerHTML = stats.map(s => `
    <div class="prof-stat-card">
      <div class="prof-stat-label">${s.label}</div>
      <div class="prof-stat-val" style="color:${s.color}">${s.val}</div>
    </div>`).join('');
}

function renderProfileChart(games) {
  const svg = document.getElementById('profile-chart');
  if (games.length === 0) {
    svg.innerHTML = '<text x="400" y="106" text-anchor="middle" fill="#666" font-size="15" font-family="Segoe UI,sans-serif">No games in this period</text>';
    return;
  }
  const W = 800, H = 200;
  const pL = 72, pR = 20, pT = 18, pB = 36;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  let cum = 0;
  const pts = games.map(g => { cum += g.net; return { date: new Date(g.ended_at), cum, net: g.net }; });
  const vals = pts.map(p => p.cum);
  const minY = Math.min(0, ...vals), maxY = Math.max(0, ...vals);
  const rangeY = maxY - minY || 1;
  const toX = i => pL + (pts.length === 1 ? plotW / 2 : i / (pts.length - 1) * plotW);
  const toY = v => pT + (1 - (v - minY) / rangeY) * plotH;
  const zeroY = toY(0);
  const ptsStr = pts.map((p, i) => `${toX(i)},${toY(p.cum)}`).join(' ');
  const areaPath = `M${toX(0)},${zeroY} ${pts.map((p, i) => `L${toX(i)},${toY(p.cum)}`).join(' ')} L${toX(pts.length - 1)},${zeroY} Z`;
  const finalCum = pts[pts.length - 1].cum;
  const lineColor = finalCum >= 0 ? '#4caf82' : '#e05c5c';
  const ySet = [...new Set([maxY, 0, minY])];
  const yLabels = ySet.map(v => {
    const label = v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
    return `<text x="${pL - 6}" y="${toY(v) + 4}" fill="${v === 0 ? '#999' : '#777'}" font-size="11" text-anchor="end" font-family="Segoe UI,sans-serif">${label}</text>`;
  }).join('');
  const step = Math.max(1, Math.floor(pts.length / 5));
  const xIdxs = [];
  for (let i = 0; i < pts.length; i += step) xIdxs.push(i);
  if (!xIdxs.includes(pts.length - 1)) xIdxs.push(pts.length - 1);
  const xLabels = xIdxs.map(i => {
    const d = pts[i].date;
    const lbl = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `<text x="${toX(i)}" y="${H - 4}" fill="#777" font-size="11" text-anchor="middle" font-family="Segoe UI,sans-serif">${lbl}</text>`;
  }).join('');
  const gridLines = ySet.map(v => {
    const y = toY(v);
    return `<line x1="${pL}" y1="${y}" x2="${W - pR}" y2="${y}" stroke="${v === 0 ? '#3a3d4e' : '#1e2130'}" stroke-width="1" ${v === 0 ? 'stroke-dasharray="4,4"' : ''}/>`;
  }).join('');
  const dotR = pts.length > 30 ? 2 : pts.length > 15 ? 2.5 : 3.5;
  const dots = pts.map((p, i) => `<circle cx="${toX(i)}" cy="${toY(p.cum)}" r="${dotR}" fill="${p.net > 0 ? '#4caf82' : p.net < 0 ? '#e05c5c' : '#888'}" stroke="#12141f" stroke-width="1.5"/>`).join('');
  svg.innerHTML = `
    <defs>
      <linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${areaPath}" fill="url(#pcg)"/>
    <polyline points="${ptsStr}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${yLabels}${xLabels}`;
}

function renderProfileHistory(games) {
  const el = document.getElementById('profile-history');
  if (games.length === 0) {
    el.innerHTML = '<p style="color:#444;font-size:0.88rem;text-align:center;padding:20px 0;">No games in this period</p>';
    return;
  }
  el.innerHTML = [...games].reverse().map(g => {
    const date = g.ended_at ? new Date(g.ended_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
    const type = g.type === 'cash' ? 'Cash' : 'Tournament';
    const netStr = g.net > 0 ? `+${g.net.toLocaleString()}` : g.net.toLocaleString();
    const netColor = g.net > 0 ? '#4caf82' : g.net < 0 ? '#e05c5c' : '#888';
    const badge = g.net > 0 ? '<span class="prof-history-badge badge-win">WIN</span>'
                : g.net < 0 ? '<span class="prof-history-badge badge-loss">LOSS</span>'
                : '<span class="prof-history-badge badge-even">EVEN</span>';
    return `<div class="prof-history-row" onclick="openHistorySettlement(${g.session_id}, '${type} #${g.session_id}')">
      <span class="prof-history-date">${date}</span>
      <span class="prof-history-type">${type} #${g.session_id}</span>
      <span class="prof-history-buyin">${g.total_buyin.toLocaleString()}</span>
      <span class="prof-history-net" style="color:${netColor}">${netStr}</span>
      ${badge}
    </div>`;
  }).join('');
}
