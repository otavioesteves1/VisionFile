'use strict';

// ── State ──────────────────────────────────────────────────────
let cards      = [];
let config     = {};
let editTarget = null;

const CARD_LIMIT = 300; // máximo de cards no DOM

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  config = await window.api.getConfig();
  renderFolderList();
  loadConfigForm();
  syncEmpty();

  window.api.onFileEvent(onFileEvent);
  window.api.onStatus(onStatus);

  // Titlebar
  document.getElementById('btnMinimize').addEventListener('click', () => window.api.minimizeWindow());
  document.getElementById('btnClose').addEventListener('click',    () => window.api.hideWindow());
  document.getElementById('titlebarIcon').addEventListener('error', function () { this.style.display = 'none'; });

  // Tabs
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  );

  // Footer
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
  document.getElementById('btnClearSel').addEventListener('click', clearSelected);

  // Config
  document.getElementById('btnAddFolder').addEventListener('click', openAddModal);
  document.getElementById('btnApply').addEventListener('click', applyConfig);
  document.getElementById('btnCheckNow').addEventListener('click', () => window.api.checkNow());

  // Modal
  document.getElementById('btnModalCancel').addEventListener('click', closeModal);
  document.getElementById('btnModalSave').addEventListener('click', saveModal);
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.getElementById('btnBrowse').addEventListener('click', async () => {
    const p = await window.api.pickFolder();
    if (p) document.getElementById('editPath').value = p;
  });
  document.getElementById('editModal').addEventListener('keydown', e => {
    if (e.key === 'Enter')  saveModal();
    if (e.key === 'Escape') closeModal();
  });

  // Gera ícone de badge para o tray (base icon + red dot via canvas)
  generateBadgeIcon();
});

// ── Badge icon (tray) ──────────────────────────────────────────
function generateBadgeIcon() {
  const S   = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  img.onload = () => {
    // Base icon
    ctx.drawImage(img, 0, 0, S, S);
    // Red circle badge (upper-left)
    const r = 7;
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(r + 1, r + 1, r, 0, Math.PI * 2);
    ctx.fill();
    // White border ring to separate from icon
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(r + 1, r + 1, r, 0, Math.PI * 2);
    ctx.stroke();
    window.api.registerBadgeIcon(canvas.toDataURL('image/png'));
  };
  img.onerror = () => {
    // Fallback: plain red circle as badge icon
    ctx.fillStyle = '#f85149';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fill();
    window.api.registerBadgeIcon(canvas.toDataURL('image/png'));
  };
  img.src = '../../assets/icone.png';
}

// ── Tabs ───────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('tab--active', t.dataset.tab === name)
  );
  document.getElementById('panelFiles').classList.toggle('tab-panel--hidden',  name !== 'files');
  document.getElementById('panelConfig').classList.toggle('tab-panel--hidden', name !== 'config');
}

function updateTabLabel() {
  const n = cards.length;
  document.getElementById('tabFiles').textContent = n > 0 ? `Arquivos (${n})` : 'Arquivos';
}

// ── File events ────────────────────────────────────────────────
function onFileEvent({ tipo, caminho, antigo }) {
  // Descarta o mais antigo se atingiu o limite (evita vazamento de DOM)
  if (cards.length >= CARD_LIMIT) {
    const oldest = cards.shift();
    try { oldest.el.remove(); } catch {}
  }

  const card = { tipo, caminho, antigo: antigo || null, checked: false, el: null };
  card.el = buildCard(card);
  cards.push(card);
  document.getElementById('cardsList').appendChild(card.el);
  requestAnimationFrame(() => {
    const s = document.getElementById('cardsScroll');
    s.scrollTop = s.scrollHeight;
  });
  syncEmpty(); updateTabLabel(); updateFooter();
}

function buildCard({ tipo, caminho, antigo }) {
  const LABELS = { novo: 'Novo', modificado: 'Modificado', renomeado: 'Renomeado', excluido: 'Excluído' };
  const dir    = parentDir(caminho);
  const name   = antigo
    ? `${baseName(antigo)}  →  ${baseName(caminho)}`
    : baseName(caminho);

  const el = mk('div', `card card--${tipo}`);

  // Checkbox
  const checkArea = mk('div', 'card__check');
  const cb        = mk('div', 'card__checkbox');
  checkArea.appendChild(cb);
  checkArea.addEventListener('click', () => toggleCheck(el, cb));
  el.appendChild(checkArea);

  // Colour bar
  el.appendChild(mk('div', 'card__bar'));

  // Body
  const body = mk('div', 'card__body');
  const top  = mk('div', 'card__top');

  const nameEl = mk('div', 'card__name');
  nameEl.textContent = name;
  top.appendChild(nameEl);

  const badge = mk('div', 'card__badge');
  badge.textContent = LABELS[tipo] || tipo;
  top.appendChild(badge);
  body.appendChild(top);

  const pathEl = mk('div', 'card__path');
  pathEl.textContent = abbreviate(dir);
  pathEl.title = dir;
  pathEl.addEventListener('click', () => window.api.openPath(dir));
  body.appendChild(pathEl);

  el.appendChild(body);
  return el;
}

function toggleCheck(cardEl, cbEl) {
  const card = cards.find(c => c.el === cardEl);
  if (!card) return;
  card.checked = !card.checked;
  cbEl.classList.toggle('card__checkbox--checked', card.checked);
  updateFooter();
}

// ── Clear ──────────────────────────────────────────────────────
function clearAll() {
  cards.forEach(c => c.el.remove());
  cards = [];
  syncEmpty(); updateTabLabel(); updateFooter();
}

function clearSelected() {
  cards.filter(c => c.checked).forEach(c => c.el.remove());
  cards = cards.filter(c => !c.checked);
  syncEmpty(); updateTabLabel(); updateFooter();
}

// ── Status ─────────────────────────────────────────────────────
function onStatus({ msg, type, proximo }) {
  document.getElementById('statusLabel').textContent = msg;
  document.getElementById('statusDot').className =
    type === 'checking' ? 'status-dot status-dot--checking' : 'status-dot';
  if (proximo && cards.length === 0)
    document.getElementById('footerInfo').textContent = `Próximo check: ${proximo}`;
}

// ── Sync ───────────────────────────────────────────────────────
function syncEmpty() {
  document.getElementById('emptyState').classList.toggle('empty-state--hidden', cards.length > 0);
  window.api.setTrayCount(cards.length);
}

function updateFooter() {
  const n    = cards.length;
  const nSel = cards.filter(c => c.checked).length;
  if (n > 0) document.getElementById('footerInfo').textContent = `${n} item(ns) aguardando revisão`;
  document.getElementById('btnClearAll').disabled = n === 0;
  document.getElementById('btnClearSel').disabled = nSel === 0;
}

// ── Config form ────────────────────────────────────────────────
function loadConfigForm() {
  document.getElementById('intervalMin').value = config.intervalo_min ?? 5;
  document.getElementById('horaCheck').value   = config.hora_check    ?? 8;
  const modo = config.modo || 'intervalo';
  document.getElementById('modoIntervalo').checked = modo === 'intervalo';
  document.getElementById('modoDiario').checked    = modo === 'diario';
}

async function applyConfig() {
  if (!(config.pastas || []).length) { alert('Adicione ao menos uma pasta.'); return; }
  const min  = parseInt(document.getElementById('intervalMin').value, 10);
  const hora = parseInt(document.getElementById('horaCheck').value, 10);
  if (isNaN(min)  || min  < 1)  { alert('Intervalo inválido (mínimo: 1 minuto).'); return; }
  if (isNaN(hora) || hora < 0 || hora > 23) { alert('Hora inválida (0–23).'); return; }
  config.modo          = document.querySelector('input[name="modo"]:checked').value;
  config.intervalo_min = min;
  config.hora_check    = hora;
  await window.api.saveConfig(config);
  alert('Configurações salvas. Monitor atualizado.');
}

// ── Folder list ────────────────────────────────────────────────
function renderFolderList() {
  const list = document.getElementById('folderList');
  list.innerHTML = '';
  const pastas = config.pastas || [];
  if (!pastas.length) {
    list.innerHTML = '<div class="folder-list--empty">Nenhuma pasta configurada</div>';
    return;
  }
  for (const item of pastas) list.appendChild(buildFolderRow(item));
}

function buildFolderRow(item) {
  const caminho = typeof item === 'string' ? item : item.caminho;
  const apelido = typeof item === 'object' ? (item.apelido || '') : '';
  const display = apelido || abbreviate(caminho);

  const row  = mk('div', 'folder-row');
  const name = mk('div', `folder-row__name ${apelido ? 'folder-row__name--alias' : 'folder-row__name--path'}`);
  name.textContent = display;
  name.title = caminho;
  name.addEventListener('click', () => window.api.openPath(caminho));
  row.appendChild(name);

  row.append(
    rowBtn('Abrir', () => window.api.openPath(caminho)),
    rowBtn('✏',    () => openEditModal(caminho)),
    rowBtn('×',    () => { removeFolder(caminho); }, 'folder-row__btn--danger'),
  );
  return row;
}

function rowBtn(text, onclick, extraClass = '') {
  const b = mk('button', `folder-row__btn ${extraClass}`.trim());
  b.textContent = text;
  b.addEventListener('click', onclick);
  return b;
}

function removeFolder(caminho) {
  config.pastas = (config.pastas || []).filter(p => (p.caminho || p) !== caminho);
  renderFolderList();
}

// ── Modal ──────────────────────────────────────────────────────
function openAddModal() {
  editTarget = null;
  document.getElementById('editAlias').value = '';
  document.getElementById('editPath').value  = '';
  showModal();
}

function openEditModal(caminho) {
  editTarget = caminho;
  const item = (config.pastas || []).find(p => (p.caminho || p) === caminho);
  document.getElementById('editAlias').value = item?.apelido || '';
  document.getElementById('editPath').value  = caminho;
  showModal();
}

function showModal() {
  document.getElementById('modalBackdrop').classList.add('modal-backdrop--visible');
  document.getElementById('editModal').classList.add('modal--visible');
  document.getElementById('editModal').querySelector('input').focus();
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('modal-backdrop--visible');
  document.getElementById('editModal').classList.remove('modal--visible');
}

function saveModal() {
  const caminho = document.getElementById('editPath').value.trim();
  const apelido = document.getElementById('editAlias').value.trim();
  if (!caminho) { alert('Informe o caminho da pasta.'); return; }
  if (editTarget) {
    const idx = (config.pastas || []).findIndex(p => (p.caminho || p) === editTarget);
    if (idx >= 0) config.pastas[idx] = { caminho, apelido };
  } else {
    if (!(config.pastas || []).find(p => (p.caminho || p) === caminho))
      config.pastas = [...(config.pastas || []), { caminho, apelido }];
  }
  renderFolderList();
  closeModal();
}

// ── Utils ──────────────────────────────────────────────────────
function mk(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function baseName(p) {
  return String(p).replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

function parentDir(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('\\') || p;
}

function abbreviate(p, max = 55) {
  if (!p || p.length <= max) return p;
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return '…' + p.slice(-(max - 1));
  const c = `${parts[0]}\\…\\${parts[parts.length - 1]}`;
  return c.length <= max ? c : '…' + p.slice(-(max - 1));
}
