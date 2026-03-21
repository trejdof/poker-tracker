function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function balanceClass(val) {
  if (val > 0) return 'pos';
  if (val < 0) return 'neg';
  return 'zero';
}

function balanceLabel(val) {
  if (val > 0) return '+' + val;
  return val;
}
