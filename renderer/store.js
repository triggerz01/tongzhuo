/* store.js — 专注星商店
 *
 * 商品数据走 assets/catalog.json（主进程的 catalog:list），界面不写死商品 ——
 * 这一层沿用 ban-jiang 的做法，是对的：以后加东西只改 JSON。
 * 界面全部重画成 P5，和设置页、日历同一套语汇。
 *
 * 分类：
 *   陪伴者 / 监督者   人物，监督者要等老师模式做完才真正可用
 *   物品             只用于陪伴模式，放在桌面上（桌子挪到人物面前就是为了这个）
 *   背景             自习地点
 *
 * 现在只把 UI 和分类做出来，具体商品之后再填。买下来只记 owned，
 * 还没有接到设置页的解锁判断上 —— 免得半成品把已经能用的东西锁掉。
 */
'use strict';

const $ = (id) => document.getElementById(id);

const TABS = [
  { id: 'all',        name: '全部' },
  { id: 'companion',  name: '陪伴者' },
  { id: 'supervisor', name: '监督者' },
  { id: 'item',       name: '物品' },
  { id: 'scene',      name: '背景' }
];

const TYPE_CN = { companion: '陪伴者', supervisor: '监督者', item: '物品', scene: '背景' };

const EMPTY = {
  item: '桌面上的东西还在做。台灯、绿植、猫 —— 都会放在她面前那张桌子上。',
  supervisor: '监督者只有老师一个人，等老师模式的行为做完再上架。',
  all: '还没有可买的东西。'
};

let products = [];
let tab = 'all';
let pending = null;

async function load() {
  try {
    products = (window.tz && window.tz.listCatalog) ? await window.tz.listCatalog() : [];
  } catch (e) {
    console.warn('[store] 商品清单读取失败', e);
    products = [];
  }
}

function owned(p) {
  if (p.default) return true;                       // 初始就有的，不用买
  return window.TZPoints ? window.TZPoints.owns(p.id) : false;
}

function render() {
  const bal = window.TZPoints ? window.TZPoints.snapshot().balance : 0;
  $('storeBalance').textContent = bal;

  document.querySelectorAll('#storeTabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });

  // 剧情赠礼不在商店卖 —— 它是她给你的，不是你买的
  const rows = products.filter(p => !p.story && (tab === 'all' || p.type === tab));
  const grid = $('storeGrid');
  grid.innerHTML = '';

  if (!rows.length) {
    grid.innerHTML = `<div class="storeEmpty">${EMPTY[tab] || EMPTY.all}</div>`;
    return;
  }

  rows.forEach((p, i) => {
    const have = owned(p);
    const afford = bal >= p.price;
    const card = document.createElement('article');
    card.className = 'goodsCard' + (have ? ' have' : '');
    card.style.animationDelay = (i * 55) + 'ms';

    let action;
    if (have) action = `<span class="tag have">已拥有</span>`;
    else if (!p.available) action = `<span class="tag soon">敬请期待</span>`;
    else if (!afford) action = `<span class="tag short">还差 ${p.price - bal}</span>`;
    else action = `<button data-buy="${p.id}">兑换</button>`;

    card.innerHTML =
      `<span class="pic"${p.preview ? ` style="background-image:url('../${p.preview}')"` : ''}>
         <span class="kind">${TYPE_CN[p.type] || p.type}</span>
       </span>
       <span class="body">
         <b>${p.name}</b>
         <small>${p.description || ''}</small>
         <span class="foot">
           <span class="price">${p.default ? '初始' : '✦ ' + p.price}</span>
           ${action}
         </span>
       </span>`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-buy]').forEach((b) => {
    b.addEventListener('click', () => ask(b.dataset.buy));
  });
}

function ask(id) {
  pending = products.find(p => p.id === id);
  if (!pending || !window.TZPoints || !window.TZPoints.canBuy(pending)) return;
  $('buyTitle').textContent = `兑换「${pending.name}」`;
  $('buyText').textContent =
    `要花 ${pending.price} 点。兑换之后永久拥有，以后扣分也不会收回去。`;
  $('storeBuy').classList.add('on');
}

function closeAsk() {
  pending = null;
  $('storeBuy').classList.remove('on');
}

function confirmBuy() {
  if (!pending) return;
  const r = window.TZPoints.buy(pending);
  closeAsk();
  if (r.ok) render();
}

export async function openStore() {
  await load();
  render();
  $('store').classList.add('on');
}

export function initStore(back) {
  $('btnStore').addEventListener('click', openStore);
  $('storeBack').addEventListener('click', () => {
    $('store').classList.remove('on');
    closeAsk();
    if (back) back();
  });
  $('buyCancel').addEventListener('click', closeAsk);
  $('buyOk').addEventListener('click', confirmBuy);
  $('storeBuy').addEventListener('click', (e) => {
    if (e.target === $('storeBuy')) closeAsk();
  });

  const box = $('storeTabs');
  TABS.forEach((t) => {
    const b = document.createElement('button');
    b.textContent = t.name;
    b.dataset.tab = t.id;
    b.addEventListener('click', () => { tab = t.id; render(); });
    box.appendChild(b);
  });

  if (window.TZPoints) window.TZPoints.subscribe(() => {
    if ($('store').classList.contains('on')) render();
    paintBalance();
  });
  paintBalance();
}

/** 主界面上那行余额 */
export function paintBalance() {
  const el = $('homePoints');
  if (el && window.TZPoints) el.textContent = window.TZPoints.snapshot().balance;
}
