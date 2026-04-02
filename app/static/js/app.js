function showHome(pushHistory = true) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-players').classList.add('active');
  loadPlayers();
  loadSidebarSessions();
  if (pushHistory) history.pushState({ type: 'home' }, '', '/');
}

function backToSessions() {
  clearInterval(timerInterval);
  stopSystemClock();
  currentSession = null;
  if (typeof ncCleanup === 'function') ncCleanup();
  showHome();
}

window.addEventListener('popstate', function(e) {
  const state = e.state;
  if (!state || state.type === 'home') {
    clearInterval(timerInterval);
    stopSystemClock();
    currentSession = null;
    showHome(false);
  } else if (state.type === 'game') {
    openSession(state.id, false, false);
  } else if (state.type === 'settlement') {
    openHistorySettlement(state.id, state.title, false);
  } else if (state.type === 'player') {
    openPlayerProfile(state.name, false);
  }
});

(async function() {
  const path = window.location.pathname;
  const gameMatch = path.match(/^\/game\/(\d+)$/);
  const settlementMatch = path.match(/^\/settlement\/(\d+)$/);
  const playerMatch = path.match(/^\/player\/(.+)$/);
  if (gameMatch) {
    history.replaceState({ type: 'game', id: parseInt(gameMatch[1]) }, '', path);
    await openSession(parseInt(gameMatch[1]), false, false);
  } else if (settlementMatch) {
    const id = parseInt(settlementMatch[1]);
    history.replaceState({ type: 'settlement', id, title: `Game #${id}` }, '', path);
    await openHistorySettlement(id, `Game #${id}`, false);
  } else if (playerMatch) {
    const name = decodeURIComponent(playerMatch[1]);
    history.replaceState({ type: 'player', name }, '', path);
    await openPlayerProfile(name, false);
  } else {
    history.replaceState({ type: 'home' }, '', '/');
    showHome(false);
  }
})();
