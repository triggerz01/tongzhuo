'use strict';
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let petWin = null;
let panelWin = null;

/** 角色窗：透明、无边框、置顶、默认鼠标穿透 */
function createPetWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 340, H = 470;

  petWin = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 24,
    y: workArea.y + workArea.height - H - 12,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    // 不抢焦点：点它不会把你正在写的东西挤到后台
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 默认整窗穿透，forward:true 让 renderer 仍能收到 mousemove 以便判断悬停
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  petWin.on('closed', () => { petWin = null; });
}

/** 控制台窗：会话设置、标定、捏脸、日志 */
function createPanelWindow() {
  if (panelWin) { panelWin.show(); panelWin.focus(); return; }
  panelWin = new BrowserWindow({
    width: 460,
    height: 640,
    frame: false,
    resizable: true,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#00000000',
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  panelWin.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
  panelWin.on('closed', () => { panelWin = null; });
}

/** 自习室窗：B 形态，场景 + 3D 角色 + 计时器 */
let roomWin = null;
function createRoomWindow() {
  if (roomWin) { roomWin.show(); roomWin.focus(); return; }
  roomWin = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#12161a',
    title: '自习室',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  roomWin.setMenuBarVisibility(false);
  roomWin.loadFile(path.join(__dirname, '..', 'renderer', 'room.html'));
  roomWin.on('closed', () => { roomWin = null; });
}

const wantRoom = process.argv.includes('--room');

app.whenReady().then(() => {
  if (wantRoom) createRoomWindow(); else createPetWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (wantRoom) createRoomWindow(); else createPetWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------- IPC ---------------- */

// renderer 告诉主进程：鼠标现在是不是压在角色/可交互区域上
ipcMain.on('pet:interactive', (_e, interactive) => {
  if (!petWin) return;
  petWin.setIgnoreMouseEvents(!interactive, { forward: true });
  // 需要点击时才允许获取焦点，避免平时抢焦点
  petWin.setFocusable(!!interactive);
});

ipcMain.on('panel:open', () => createPanelWindow());
ipcMain.on('panel:close', () => { if (panelWin) panelWin.close(); });

// 控制台 → 角色窗 的状态广播
ipcMain.on('bus', (_e, msg) => {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('bus', msg);
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('bus', msg);
});

ipcMain.handle('app:quit', () => app.quit());
ipcMain.on('open-external', (_e, url) => shell.openExternal(url));

ipcMain.on('room:open', () => createRoomWindow());

// 列出 assets/models 下所有 .vrm，让用户丢进去就能用，不必改文件名
ipcMain.handle('models:list', () => {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'assets', 'models');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.vrm'))
      .map(f => '../assets/models/' + f);
  } catch (e) { return []; }
});

// 列出 assets/scenes 下的背景图，丢进去即可被识别
ipcMain.handle('scenes:list', () => {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'assets', 'scenes');
  try {
    return fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort()
      .map(f => ({ name: f.replace(/\.[^.]+$/, ''), url: '../assets/scenes/' + f }));
  } catch (e) { return []; }
});

// 列出 assets/animations 下的 Mixamo 动作
ipcMain.handle('anims:list', () => {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'assets', 'animations');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.fbx'))
      .sort()
      .map(f => ({ name: f.replace(/\.fbx$/i, ''), url: '../assets/animations/' + encodeURIComponent(f) }));
  } catch (e) { return []; }
});

/* ---------------- 感知层子进程 ----------------
 * 用户不该为了用摄像头去手动开一个 Python 进程。
 * Electron 自己把它拉起来、自己收尸；界面上只留开关和重连。
 */
let percProc = null;
let percLog = [];

function perceptionPython() {
  const win = process.platform === 'win32';
  const venv = path.join(__dirname, '..', 'perception', '.venv',
                         win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python');
  if (fs.existsSync(venv)) return { path: venv, kind: 'venv' };
  return { path: win ? 'python' : 'python3', kind: 'system' };
}

function perceptionStatus() {
  return {
    running: !!percProc,
    pid: percProc ? percProc.pid : null,
    python: perceptionPython(),
    log: percLog.slice(-12)
  };
}

function notifyPerception() {
  const msg = { type: 'perception-proc', ...perceptionStatus() };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('bus', msg);
  }
}

function startPerception() {
  if (percProc) return perceptionStatus();
  const py = perceptionPython();
  const cwd = path.join(__dirname, '..', 'perception');
  if (!fs.existsSync(path.join(cwd, 'server.py'))) {
    percLog.push('找不到 perception/server.py');
    notifyPerception();
    return perceptionStatus();
  }
  let proc;
  try {
    proc = spawn(py.path, ['server.py'], { cwd, windowsHide: true });
    percProc = proc;
  } catch (e) {
    percLog.push('启动失败：' + e.message);
    percProc = null;
    notifyPerception();
    return perceptionStatus();
  }
  percLog.push(`已启动（${py.kind}）pid=${proc.pid}`);

  const onOut = (d) => {
    const t = String(d).trim();
    if (t) percLog.push(t.replace(/\s+/g, ' ').slice(-160));
    if (percLog.length > 60) percLog = percLog.slice(-40);
  };
  proc.stdout.on('data', onOut);
  proc.stderr.on('data', onOut);
  // 旧进程的 exit 是异步来的，可能晚于新进程启动。不判断一下就会把
  // 新进程的引用清掉——重启后显示"感知层未启动"就是这么来的。
  proc.on('exit', (code) => {
    if (percProc !== proc) return;
    percLog.push('感知层退出，code=' + code);
    percProc = null;
    notifyPerception();
  });
  proc.on('error', (e) => {
    if (percProc !== proc) return;
    percLog.push('感知层出错：' + e.message);
    percProc = null;
    notifyPerception();
  });

  notifyPerception();
  return perceptionStatus();
}

function stopPerception() {
  if (!percProc) return perceptionStatus();
  try { percProc.kill(); } catch (e) { /* 已经没了 */ }
  percProc = null;
  percLog.push('已停止');
  notifyPerception();
  return perceptionStatus();
}

ipcMain.handle('perception:start', () => startPerception());
ipcMain.handle('perception:stop', () => stopPerception());
ipcMain.handle('perception:restart', () => { stopPerception(); return startPerception(); });
ipcMain.handle('perception:status', () => perceptionStatus());

app.on('before-quit', stopPerception);
app.on('will-quit', stopPerception);
