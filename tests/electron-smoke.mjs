import assert from 'node:assert/strict';

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find((t) => t.type === 'page' && t.title === '自习室');
assert.ok(page, '找不到自习室调试页面');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 1800));

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const initial = await evaluate(`(() => ({
  engine: !!window.TZPoints,
  ui: !!window.TZPointsUI,
  balanceText: document.getElementById('coinText')?.textContent,
  pendingText: document.getElementById('pendingPointText')?.textContent,
  modeCards: document.querySelectorAll('[data-point-mode]').length,
  storeButton: !!document.getElementById('btnStore'),
  session: window.TZRoom?.sessionInfo(),
  duplicateIds: [...document.querySelectorAll('[id]')]
    .map(x => x.id).filter((id, i, a) => a.indexOf(id) !== i)
}))()`);
assert.equal(initial.engine, true);
assert.equal(initial.ui, true);
assert.equal(initial.pendingText, '0');
assert.equal(initial.modeCards, 2);
assert.equal(initial.storeButton, true);
assert.deepEqual(initial.duplicateIds, []);
assert.equal(initial.session, null);

await evaluate(`document.getElementById('btnStore').click()`);
await new Promise((resolve) => setTimeout(resolve, 250));
const storeOpen = await evaluate(`(() => ({
  visible: document.getElementById('store').classList.contains('on'),
  tabs: document.querySelectorAll('#storeTabs button').length,
  cards: document.querySelectorAll('.productCard').length,
  name: document.querySelector('.productCard h3')?.textContent,
  buyDisabled: document.querySelector('[data-buy]')?.disabled,
  lampHidden: getComputedStyle(document.getElementById('deskLampItem')).display === 'none'
}))()`);
assert.equal(storeOpen.visible, true);
assert.equal(storeOpen.tabs, 5);
assert.equal(storeOpen.cards, 1);
assert.equal(storeOpen.name, '暖光台灯');
assert.equal(storeOpen.buyDisabled, true);
assert.equal(storeOpen.lampHidden, true);

const confirmOpen = await evaluate(`(() => {
  window.__economySmokeBackup = localStorage.getItem('tongzhuo.economy.v1');
  window.TZPoints.state.balance = 60;
  window.TZStore.render();
  document.querySelector('[data-buy]').click();
  return {
    visible: document.getElementById('storeConfirm').classList.contains('on'),
    title: document.getElementById('confirmTitle').textContent
  };
})()`);
assert.equal(confirmOpen.visible, true);
assert.match(confirmOpen.title, /暖光台灯/);
const afterPurchase = await evaluate(`(() => {
  document.getElementById('confirmBuy').click();
  const snapshot = window.TZPoints.snapshot();
  window.TZStore.close();
  return {
    owned: snapshot.owned.includes('item_desk_lamp_01'),
    pendingDelivery: window.TZPoints.pendingDeliveries().includes('item_desk_lamp_01'),
    balance: snapshot.balance
  };
})()`);
assert.equal(afterPurchase.owned, true);
assert.equal(afterPurchase.pendingDelivery, true);
assert.equal(afterPurchase.balance, 0);

const afterHomeStart = await evaluate(`(() => {
  document.getElementById('btnStart').click();
  return {
    setupVisible: document.getElementById('setup').classList.contains('on'),
    session: window.TZRoom.sessionInfo()
  };
})()`);
assert.equal(afterHomeStart.setupVisible, true);
assert.equal(afterHomeStart.session, null, '首页按钮不应提前启动会话');

const afterBegin = await evaluate(`(() => {
  document.getElementById('durCustom').value = '1';
  document.getElementById('btnEnter').click();
  return {
    inSession: document.body.classList.contains('in-session'),
    roomMode: window.TZRoom.sessionInfo()?.mode,
    pointsMode: window.TZPoints.snapshot().session?.mode,
    delivered: window.TZPoints.snapshot().delivered.includes('item_desk_lamp_01'),
    lampVisible: getComputedStyle(document.getElementById('deskLampItem')).display !== 'none'
  };
})()`);
assert.equal(afterBegin.inSession, true);
assert.equal(afterBegin.roomMode, 'companion');
assert.equal(afterBegin.pointsMode, 'companion');
assert.equal(afterBegin.delivered, true);
assert.equal(afterBegin.lampVisible, true);

const afterEnd = await evaluate(`(() => {
  window.TZRoom.endSession('manual');
  return {
    homeVisible: document.getElementById('home').classList.contains('on'),
    summaryVisible: document.getElementById('homeSummary').classList.contains('on'),
    points: document.getElementById('sumPoints')?.textContent,
    note: document.getElementById('sumPointsNote')?.textContent
  };
})()`);
assert.equal(afterEnd.homeVisible, true);
assert.equal(afterEnd.summaryVisible, true);
assert.equal(afterEnd.points, '0');
assert.match(afterEnd.note, /未满10分钟/);

await evaluate(`(() => {
  if (window.__economySmokeBackup === null) localStorage.removeItem('tongzhuo.economy.v1');
  else localStorage.setItem('tongzhuo.economy.v1', window.__economySmokeBackup);
})()`);

console.log(JSON.stringify({ initial, storeOpen, confirmOpen, afterPurchase, afterHomeStart, afterBegin, afterEnd }, null, 2));
ws.close();
