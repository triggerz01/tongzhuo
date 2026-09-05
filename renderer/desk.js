/* desk.js — 桌面布置
 *
 * 桌子是一张 2D 前景图（#fg，场景照片底部那条放大后的桌面），
 * 所以摆件也是 2D 的：贴在 #fg 之上的一层 <img>。
 * 3D 摆件放不进来 —— 三维场景整个在 canvas 里，而 canvas 在 #fg 底下，
 * 摆上去会被桌面盖住；就算硬渲染到上层，也要跟一张照片对透视和光线，
 * 那是费力不讨好的事。
 *
 * 网格是有透视的：越靠里的一排，格子越矮、越窄、物件也越小。
 * 摆件的锚点是"底边中点"——物体和桌面接触的那一点，
 * 这样换一排就只改缩放，不用重新对位。
 *
 * 存的是格子坐标（列/行）不是像素，所以换背景、改窗口大小、
 * 甚至以后调 deskTop，摆好的东西都还在原来的位置上。
 */
'use strict';

const KEY = 'tongzhuo.desk.v1';
const $ = (id) => document.getElementById(id);

/* 三排格子在画面纵向的位置。上边界就是桌沿（DESK.screenTop = 0.72）。
   越靠里越薄，这是透视。 */
export const ROWS = [
  { top: 0.885, bottom: 1.000, scale: 1.00, inset: 0.00 },   // 近（贴着你这边）
  { top: 0.790, bottom: 0.885, scale: 0.84, inset: 0.04 },   // 中
  { top: 0.720, bottom: 0.790, scale: 0.70, inset: 0.09 }    // 远（贴着桌沿）
];
export const COLS = 6;

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
  const left = r.inset, span = 1 - r.inset * 2;
  const w = span / COLS;
  return {
    left: (left + w * col) * 100,
    width: w * 100,
    top: r.top * 100,
    height: (r.bottom - r.top) * 100,
    scale: r.scale
  };
}

const byId = (id) => catalog.find(c => c.id === id);

/* ---------------- 渲染 ---------------- */
/** 把摆件画到 layer 里。editable=true 时每件可以点起来拿走。 */
function paint(layer, onPick) {
  layer.innerHTML = '';
  placed.forEach((p, i) => {
    const item = byId(p.id);
    if (!item) return;                       // 商品表里没有了就跳过，不留残影
    const box = cellBox(p.col, p.row);
    const el = document.createElement('img');
    el.className = 'deskItem';
    el.src = '../' + item.asset;
    el.draggable = false;
    // 宽度按 deskWidth（占画面宽的百分比）再乘这一排的透视缩放；
    // 底边贴在格子底部 —— 物体和桌面接触的那条线
    el.style.width = ((item.deskWidth || 10) * box.scale) + '%';
    el.style.left = (box.left + box.width / 2) + '%';
    el.style.bottom = (100 - box.top - box.height) + '%';
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
  for (let row = ROWS.length - 1; row >= 0; row--) {
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
  // 一格只放一件，重复放就替换 —— 叠在一起看不清是哪件
  placed = placed.filter(p => !(p.col === col && p.row === row));
  placed.push({ id: picked, col, row });
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
