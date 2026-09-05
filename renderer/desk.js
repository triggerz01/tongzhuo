/* desk.js — 桌面布置
 *
 * 桌子是一张 2D 前景图（#fg，场景照片底部那条放大后的桌面），
 * 所以摆件也是 2D 的：贴在 #fg 之上的一层 <img>。
 * 3D 摆件放不进来 —— 三维场景整个在 canvas 里，而 canvas 在 #fg 底下，
 * 摆上去会被桌面盖住；就算硬渲染到上层，也要跟一张照片对透视和光线，
 * 那是费力不讨好的事。
 *
 * 格子是规整的（等高等宽），透视只体现在物件缩放上 ——
 * 格子歪七扭八很难瞄准，摆东西会很烦。
 * 一件东西可以占多格：cells:[列数, 排数]。显示框就是它占的那几格，
 * 图片在框里贴底居中缩放，所以画布比例决定实际大小 ——
 * 台灯画成 1:3 的窄高比，就真的占满三排。
 *
 * 存的是格子坐标（列/行）不是像素，所以换背景、改窗口大小、
 * 甚至以后调 deskTop，摆好的东西都还在原来的位置上。
 */
'use strict';

const KEY = 'tongzhuo.desk.v1';
const $ = (id) => document.getElementById(id);

/* 格子是规整的：桌沿（0.72）到画面底边平分成三排，每排等高、通栏，
   六列等宽。透视只体现在物件的缩放上，不体现在格子形状上 ——
   格子歪七扭八的话很难瞄准，摆东西会很烦。 */
const DESK_TOP = 0.72;
// 底下留一条边：最近那排要是贴着画面底边，摆上去的东西会被切掉脚
const DESK_BOTTOM = 0.965;
export const COLS = 6;
export const ROW_N = 3;
const ROW_H = (DESK_BOTTOM - DESK_TOP) / ROW_N;
/* 每排的透视缩放。近的一排是基准，越靠里越小一点。 */
const ROW_SCALE = [1.00, 0.91, 0.82];

export const ROWS = ROW_SCALE.map((scale, i) => ({
  bottom: DESK_BOTTOM - ROW_H * i,
  top: DESK_BOTTOM - ROW_H * (i + 1),
  scale
}));

let catalog = [];          // 商品表，用来查图和尺寸
let placed = [];           // [{ id, col, row }]
let saved = '[]';          // 上次保存时的快照，用来判断脏没脏

/* ---------------- 存储 ---------------- */
export function loadDesk() {
  try {
    const raw = localStorage.getItem(KEY);
    placed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(placed)) placed = [];
  } catch (e) { placed = []; }
  saved = JSON.stringify(placed);
  return placed;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(placed)); } catch (e) { /* 隐私模式 */ }
  saved = JSON.stringify(placed);
}

export const isDirty = () => JSON.stringify(placed) !== saved;

/* ---------------- 几何 ---------------- */
/** 一个格子在画面上的位置，全部是百分比，跟窗口大小无关 */
export function cellBox(col, row) {
  const r = ROWS[row];
  const w = 1 / COLS;
  return {
    left: w * col * 100,
    width: w * 100,
    top: r.top * 100,
    height: (r.bottom - r.top) * 100,
    scale: r.scale
  };
}

/** 一件东西占几格。没写就当 1×1。 */
const cellsOf = (item) => {
  const c = (item && item.cells) || [1, 1];
  return [Math.max(1, c[0] | 0), Math.max(1, c[1] | 0)];
};

/** 摆件的显示框：以点中的那一格为底，向上长 h 排、左右铺开 w 列。
 *  图片在框里 object-fit:contain + 底部对齐，所以画布比例决定实际大小 ——
 *  台灯画得高，就会真的占满三排。 */
export function itemBox(item, col, row) {
  const [w, h] = cellsOf(item);
  const base = cellBox(col, row);
  const bw = base.width * w * base.scale;
  const bh = base.height * h * base.scale;
  return {
    // 以点中格子的中心对齐，左右铺开
    left: base.left + base.width / 2 - bw / 2,
    width: bw,
    height: bh,
    bottom: 100 - base.top - base.height
  };
}

/** 这件东西放在 (col,row) 时，底排会压住哪几列 */
function footprint(item, col, row) {
  const [w] = cellsOf(item);
  const start = col - Math.floor((w - 1) / 2);
  const cols = [];
  for (let i = 0; i < w; i++) cols.push(start + i);
  return { row, cols };
}

const byId = (id) => catalog.find(c => c.id === id);

/* ---------------- 渲染 ---------------- */
/** 把摆件画到 layer 里。editable=true 时每件可以点起来拿走。 */
function paint(layer, onPick) {
  layer.innerHTML = '';
  placed.forEach((p, i) => {
    const item = byId(p.id);
    if (!item) return;                       // 商品表里没有了就跳过，不留残影
    const box = itemBox(item, p.col, p.row);
    const el = document.createElement('img');
    el.className = 'deskItem';
    el.src = '../' + item.asset;
    el.draggable = false;
    // 框就是它占的那几格；图片在框里贴底居中缩放
    el.style.left = box.left + '%';
    el.style.width = box.width + '%';
    el.style.height = box.height + '%';
    el.style.bottom = box.bottom + '%';
    el.style.zIndex = String(10 - p.row);     // 近的压住远的
    if (onPick) {
      el.classList.add('pickable');
      el.addEventListener('click', (e) => { e.stopPropagation(); onPick(i); });
    }
    layer.appendChild(el);
  });
}

/** 自习室里那一层（只显示，不能点） */
export function renderDesk() {
  const layer = $('deskLayer');
  if (layer) paint(layer, null);
}

/* ---------------- 编辑器 ---------------- */
let picked = null;         // 当前选中的商品 id
let onExit = null;

function renderTray() {
  const owned = catalog.filter(c =>
    c.type === 'item' && window.TZPoints && window.TZPoints.owns(c.id));
  const box = $('deskTray');
  box.innerHTML = '';
  if (!owned.length) {
    box.innerHTML = '<p class="empty">还没有可以摆的东西。去专注星商店里换几件。</p>';
    return;
  }
  owned.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'trayItem' + (picked === c.id ? ' on' : '');
    b.innerHTML = `<img src="../${c.preview}" alt=""><span>${c.name}</span>`;
    b.addEventListener('click', () => {
      picked = (picked === c.id) ? null : c.id;
      renderTray();
      $('deskGrid').classList.toggle('picking', !!picked);
    });
    box.appendChild(b);
  });
}

function renderGrid() {
  const grid = $('deskGrid');
  grid.innerHTML = '';
  for (let row = ROW_N - 1; row >= 0; row--) {
    for (let col = 0; col < COLS; col++) {
      const box = cellBox(col, row);
      const cell = document.createElement('button');
      cell.className = 'deskCell';
      cell.style.left = box.left + '%';
      cell.style.width = box.width + '%';
      cell.style.top = box.top + '%';
      cell.style.height = box.height + '%';
      cell.addEventListener('click', () => place(col, row));
      grid.appendChild(cell);
    }
  }
}

function place(col, row) {
  if (!picked) return;
  const item = byId(picked);
  if (!item) return;
  const want = footprint(item, col, row);
  // 超出桌面就往里推，别让东西半个身子飘在桌子外面
  const [w] = cellsOf(item);
  const c0 = Math.min(Math.max(0, want.cols[0]), COLS - w);
  const cols = [];
  for (let i = 0; i < w; i++) cols.push(c0 + i);
  const center = c0 + Math.floor((w - 1) / 2);

  // 底排压住的格子有重叠就先把原来的挪走 —— 叠在一起看不清是哪件
  placed = placed.filter((p) => {
    const other = byId(p.id);
    if (!other || p.row !== row) return true;
    const f = footprint(other, p.col, p.row);
    return !f.cols.some(c => cols.includes(c));
  });
  placed.push({ id: picked, col: center, row });
  refreshEditor();
}

function pickUp(index) {
  placed.splice(index, 1);
  refreshEditor();
}

function refreshEditor() {
  paint($('deskEditLayer'), pickUp);
  $('deskCount').textContent = placed.length;
  $('btnDeskSave').classList.toggle('dirty', isDirty());
}

async function openEditor() {
  try {
    catalog = (window.tz && window.tz.listCatalog) ? await window.tz.listCatalog() : [];
  } catch (e) { catalog = []; }
  loadDesk();
  picked = null;
  renderTray();
  renderGrid();
  refreshEditor();
  $('deskGrid').classList.remove('picking');
  document.body.classList.add('deskedit');
  $('deskEdit').classList.add('on');
}

function closeEditor(force) {
  if (!force && isDirty()) { $('deskAsk').classList.add('on'); return; }
  $('deskEdit').classList.remove('on');
  $('deskAsk').classList.remove('on');
  document.body.classList.remove('deskedit');
  renderDesk();
  if (onExit) onExit();
}

/* ---------------- 装配 ---------------- */
export function initDesk(back) {
  onExit = back;
  loadDesk();

  $('btnDesk').addEventListener('click', openEditor);
  $('btnDeskBack').addEventListener('click', () => closeEditor(false));

  $('btnDeskSave').addEventListener('click', () => {
    persist();
    refreshEditor();
    closeEditor(true);
  });

  $('btnDeskClear').addEventListener('click', () => {
    placed = [];
    picked = null;
    renderTray();
    refreshEditor();
  });

  // 未保存就退出时问一句
  $('deskAskSave').addEventListener('click', () => { persist(); closeEditor(true); });
  $('deskAskDrop').addEventListener('click', () => { loadDesk(); closeEditor(true); });
  $('deskAskStay').addEventListener('click', () => $('deskAsk').classList.remove('on'));

  // 先把商品表读进来，自习室那层才画得出
  (async () => {
    try {
      catalog = (window.tz && window.tz.listCatalog) ? await window.tz.listCatalog() : [];
    } catch (e) { catalog = []; }
    renderDesk();
  })();
}
