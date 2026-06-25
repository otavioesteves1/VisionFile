'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  shell, dialog, screen, nativeImage, Notification,
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Paths ──────────────────────────────────────────────────────
const APP_DIR = app.isPackaged
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..');

const CONFIG_PATH   = path.join(APP_DIR, 'visionfile_config.json');
const SNAPSHOT_PATH = path.join(APP_DIR, 'visionfile_snap.json');
const LOG_PATH      = path.join(APP_DIR, 'visionfile.log');
const ICON_PATH     = path.join(APP_DIR, 'assets', 'icone.png');

const CONFIG_DEFAULT = {
  pastas: [], intervalo_min: 5, modo: 'intervalo', hora_check: 8, extensoes: [],
};

let win        = null;
let notifWin   = null;
let tray       = null;
let monitorTimer = null;
let isQuitting = false;
let cleanIcon  = null;
let badgeIcon  = null;

// ── Config ────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...CONFIG_DEFAULT };
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(cfg.pastas))
      cfg.pastas = cfg.pastas.map(p => typeof p === 'string' ? { caminho: p, apelido: '' } : p);
    return { ...CONFIG_DEFAULT, ...cfg };
  } catch { return { ...CONFIG_DEFAULT }; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Log (com rotação em 2 MB) ─────────────────────────────────
const LOG_MAX = 2 * 1024 * 1024;

function log(msg) {
  const line = `[${new Date().toLocaleString('pt-BR')}] ${msg}\n`;
  process.stdout.write(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > LOG_MAX) {
      try { fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch {}
    }
    fs.appendFileSync(LOG_PATH, line, 'utf8');
  } catch {}
}

// ── Snapshot ──────────────────────────────────────────────────
function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw))
      out[k] = typeof v === 'object' ? v : { size: v, mtime: 0 };
    return out;
  } catch { return {}; }
}
function saveSnapshot(snap) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2), 'utf8');
}

// ── Scan ──────────────────────────────────────────────────────
function scanDir(dir, exts, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scanDir(full, exts, out); continue; }
    if (!e.isFile()) continue;
    if (exts.length && !exts.includes(path.extname(e.name).toLowerCase())) continue;
    try { const st = fs.statSync(full); out[full] = { size: st.size, mtime: st.mtimeMs }; } catch {}
  }
}
function scan(cfg) {
  const out = {}, exts = (cfg.extensoes || []).map(e => e.toLowerCase());
  for (const item of (cfg.pastas || [])) {
    const dir = typeof item === 'string' ? item : item.caminho;
    if (dir && fs.existsSync(dir)) scanDir(dir, exts, out);
    else if (dir) log(`AVISO: pasta não encontrada → ${dir}`);
  }
  return out;
}

// ── Check ─────────────────────────────────────────────────────
function doCheck() {
  send('status', { msg: 'Verificando...', type: 'checking' });
  log('--- Check iniciado ---');

  const cfg      = loadConfig();
  const anterior = loadSnapshot();
  const atual    = scan(cfg);

  const perdidos    = Object.keys(anterior).filter(p => !(p in atual));
  const adicionados = Object.keys(atual).filter(p => !(p in anterior));
  const modificados = Object.keys(atual).filter(p =>
    p in anterior &&
    (atual[p].size !== anterior[p].size || atual[p].mtime !== anterior[p].mtime)
  );

  const fpPerd = {}, fpAdic = {};
  for (const p of perdidos)    { const k = `${anterior[p].size}:${anterior[p].mtime}`; (fpPerd[k] = fpPerd[k] || []).push(p); }
  for (const p of adicionados) { const k = `${atual[p].size}:${atual[p].mtime}`;      (fpAdic[k] = fpAdic[k] || []).push(p); }

  const renomeados = [], matchedP = new Set(), matchedA = new Set();
  for (const [fp, ol] of Object.entries(fpPerd)) {
    const nl = fpAdic[fp] || [];
    if (ol.length === 1 && nl.length === 1) {
      renomeados.push({ antigo: ol[0], novo: nl[0] });
      matchedP.add(ol[0]); matchedA.add(nl[0]);
    }
  }

  const novos     = adicionados.filter(p => !matchedA.has(p));
  const excluidos = perdidos.filter(p => !matchedP.has(p));
  const total     = renomeados.length + novos.length + modificados.length + excluidos.length;

  for (const { antigo, novo } of renomeados) { log(`  > ${path.basename(antigo)} → ${path.basename(novo)}`); send('file-event', { tipo: 'renomeado', caminho: novo, antigo }); }
  for (const p of novos)       { log(`  + ${path.basename(p)}`); send('file-event', { tipo: 'novo',       caminho: p }); }
  for (const p of modificados) { log(`  ~ ${path.basename(p)}`); send('file-event', { tipo: 'modificado', caminho: p }); }
  for (const p of excluidos)   { log(`  - ${path.basename(p)}`); send('file-event', { tipo: 'excluido',   caminho: p }); }

  if (total > 0) {
    const todos  = [...renomeados.map(r => r.novo), ...novos, ...modificados, ...excluidos];
    const partes = [];
    if (renomeados.length) partes.push(`${renomeados.length} renomeado(s)`);
    if (novos.length)      partes.push(`${novos.length} novo(s)`);
    if (modificados.length) partes.push(`${modificados.length} modificado(s)`);
    if (excluidos.length)  partes.push(`${excluidos.length} excluído(s)`);

    const detail = todos.slice(0, 3).map(p => path.basename(p)).join(' · ')
      + (total > 3 ? `  +${total - 3}` : '');

    showNotificationPopup(`VisionFile — ${partes.join(', ')}`, detail);
  }

  saveSnapshot(atual);
  log('--- Check finalizado ---\n');

  const next = nextCheckTime(cfg);
  send('status', {
    msg: 'Ativo', type: 'idle',
    proximo: next.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  });
}

function send(channel, data) {
  try { win?.webContents?.send(channel, data); } catch {}
}

// ── Scheduler ─────────────────────────────────────────────────
function nextCheckTime(cfg) {
  const now = new Date();
  if (cfg.modo === 'diario') {
    const t = new Date(now); t.setHours(cfg.hora_check || 8, 0, 0, 0);
    if (now >= t) t.setDate(t.getDate() + 1);
    return t;
  }
  return new Date(Date.now() + Math.max(1, cfg.intervalo_min) * 60_000);
}

function scheduleNext() {
  clearTimeout(monitorTimer);
  const delay = Math.max(5000, nextCheckTime(loadConfig()) - Date.now());
  monitorTimer = setTimeout(() => { doCheck(); scheduleNext(); }, delay);
}

// ── Tray icon ─────────────────────────────────────────────────
function updateTrayIcon(count) {
  if (!tray) return;
  if (count > 0 && badgeIcon) {
    tray.setImage(badgeIcon);
    tray.setToolTip(`VisionFile — ${count} pendente(s)`);
  } else {
    tray.setImage(cleanIcon || nativeImage.createEmpty());
    tray.setToolTip('VisionFile');
  }
}

// ── Notification popup (persistent) ───────────────────────────
function showNotificationPopup(titulo, msg) {
  if (notifWin && !notifWin.isDestroyed()) { notifWin.close(); notifWin = null; }

  const { workArea } = screen.getPrimaryDisplay();
  const W = 360, H = 120;
  const tx = workArea.x + workArea.width - W - 14;
  const ty = workArea.y + workArea.height - H - 14;

  notifWin = new BrowserWindow({
    width: W, height: H,
    x: tx, y: ty,
    frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    show: false,
    backgroundColor: '#161b22',
    webPreferences: {
      preload: path.join(__dirname, 'notif-preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  notifWin.loadFile(
    path.join(__dirname, 'notification', 'index.html'),
    { query: { titulo, msg } }
  );

  notifWin.once('ready-to-show', () => {
    notifWin.show();
    // Animate slide-up from below the screen
    let cur = workArea.y + workArea.height + 10;
    const tick = setInterval(() => {
      if (!notifWin || notifWin.isDestroyed()) { clearInterval(tick); return; }
      const diff = cur - ty;
      if (diff <= 1) { try { notifWin.setPosition(tx, ty); } catch {} clearInterval(tick); return; }
      cur -= Math.max(2, Math.round(diff * 0.28));
      try { notifWin.setPosition(tx, Math.round(cur)); } catch { clearInterval(tick); }
    }, 12);
  });

  notifWin.on('closed', () => { notifWin = null; });
}

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 580, H = 680;

  win = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width  - W - 18,
    y: workArea.y + workArea.height - H - 8,
    frame: false, resizable: true, minimizable: true, maximizable: false,
    show: false,
    skipTaskbar: true,      // acesso exclusivo via tray
    backgroundColor: '#0d1117',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => { win.show(); setTimeout(startup, 600); });

  // Minimizar → ir para tray (não fica na barra de tarefas)
  win.on('minimize', e => { e.preventDefault(); win.hide(); });

  win.on('close', e => { if (!isQuitting) { e.preventDefault(); win.hide(); } });
}

function startup() {
  const cfg = loadConfig();
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    log('Primeiro uso — criando snapshot inicial...');
    saveSnapshot(scan(cfg)); log('Snapshot criado.\n');
    send('status', { msg: 'Ativo', type: 'idle' });
  } else {
    doCheck();
  }
  scheduleNext();
}

// ── Tray ──────────────────────────────────────────────────────
function createTray() {
  cleanIcon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(cleanIcon);
  tray.setToolTip('VisionFile');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir VisionFile', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Verificar agora', click: () => { doCheck(); scheduleNext(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

// ── IPC ───────────────────────────────────────────────────────
function registerIPC() {
  ipcMain.handle('config:get',         ()      => loadConfig());
  ipcMain.handle('config:save',        (_, c)  => { saveConfig(c); scheduleNext(); return true; });
  ipcMain.handle('config:pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Selecionar pasta', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('check:now',   ()     => { doCheck(); scheduleNext(); return true; });
  ipcMain.handle('shell:open',  (_, p) => { shell.openPath(p); return true; });

  ipcMain.on('window:hide',     ()     => win.hide());
  ipcMain.on('window:minimize', ()     => win.hide());

  // Badge icon gerado pelo renderer via canvas
  ipcMain.on('badge-icon:register', (_, dataURL) => {
    try { badgeIcon = nativeImage.createFromDataURL(dataURL).resize({ width: 16, height: 16 }); } catch {}
  });

  // Renderer informa contagem atual para atualizar ícone do tray
  ipcMain.on('tray:count', (_, n) => updateTrayIcon(n));

  // Popup de notificação
  ipcMain.on('notif:view', () => {
    if (notifWin && !notifWin.isDestroyed()) { notifWin.close(); notifWin = null; }
    win.show(); win.focus();
  });
  ipcMain.on('notif:close', () => {
    if (notifWin && !notifWin.isDestroyed()) { notifWin.close(); notifWin = null; }
  });
}

// ── Bootstrap ─────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(() => { createWindow(); createTray(); registerIPC(); });
  app.on('before-quit',       () => { isQuitting = true; });
  app.on('window-all-closed', () => { /* manter vivo no tray */ });
}
