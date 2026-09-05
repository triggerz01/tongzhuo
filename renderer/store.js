/* store.js — 专注星商店
 * 商品数据来自 assets/catalog.json；本文件不包含最终美术或商品价格表。
 */
(function () {
  'use strict';
  const TYPES = [
    ['all', '全部'], ['item', '物件'], ['scene', '场景'],
    ['outfit', '服装'], ['character', '人物']
  ];
  let products = [];
  let activeType = 'all';
  let pendingProduct = null;
  const $ = (id) => document.getElementById(id);

  function addStyle() {
    const style = document.createElement('style');
    style.textContent = `
      #store{position:absolute;inset:0;z-index:45;display:none;background:rgba(8,11,14,.96);
        color:#e8edf1;font-family:var(--sans);overflow:auto}
      #store.on{display:block}.storeShell{width:min(920px,calc(100% - 48px));margin:0 auto;padding:28px 0 48px}
      .storeHead{display:flex;align-items:flex-start;gap:20px}.storeHead h2{margin:0;font-size:24px}
      .storeHead p{margin:6px 0 0;color:#818c96;font-size:13px}.storeBalance{margin-left:auto;
        padding:8px 13px;border:1px solid #554a35;background:#211d16;color:#eac66f;font:13px var(--mono)}
      .storeClose{margin-left:4px;width:34px;height:34px;border:1px solid #38424b;background:#1c2228;
        color:#cbd3da;font-size:20px;cursor:pointer}.storeTabs{display:flex;gap:8px;margin:24px 0 18px}
      .storeTabs button{padding:7px 15px;border:1px solid #303943;background:#171d22;color:#939ea7;cursor:pointer}
      .storeTabs button.on{border-color:#9E1B25;color:#fff;background:#25171b}
      .storeGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}
      .productCard{border:1px solid #2c353e;background:#151a20;overflow:hidden;display:flex;flex-direction:column}
      .productPreview{height:132px;display:flex;align-items:center;justify-content:center;position:relative;
        background:radial-gradient(circle at 55% 65%,rgba(245,197,112,.28),transparent 35%),linear-gradient(#252a2f,#161b20)}
      .lampIcon{position:relative;width:76px;height:86px}.lampIcon:before{content:'';position:absolute;left:34px;
        top:25px;width:8px;height:48px;background:#d2b067;border-radius:5px}.lampIcon:after{content:'';
        position:absolute;left:12px;bottom:4px;width:54px;height:12px;border-radius:50%;background:#ad8a4a;
        box-shadow:0 -58px 0 -8px #e5c879}.productType{position:absolute;top:9px;left:9px;padding:3px 7px;
        background:rgba(0,0,0,.55);color:#aeb7bf;font:10px var(--mono)}
      .productBody{padding:13px;display:flex;flex-direction:column;gap:7px;flex:1}.productBody h3{margin:0;font-size:15px}
      .productBody p{margin:0;color:#87929b;font-size:12px;line-height:1.55;min-height:38px}
      .productFoot{display:flex;align-items:center;gap:8px;margin-top:auto}.price{color:#f0c86f;font:13px var(--mono)}
      .productFoot button{margin-left:auto;padding:6px 11px;background:#9E1B25;color:#fff;border:1px solid #9E1B25;cursor:pointer}
      .productFoot button:disabled{background:#22282e;border-color:#303942;color:#68727b;cursor:default}
      .ownedTag{margin-left:auto;color:#83b997;font:12px var(--mono)}.deliveryTag{color:#d0ad66}
      .storeEmpty{grid-column:1/-1;padding:60px;text-align:center;border:1px dashed #303942;color:#75808a}
      #storeConfirm{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.62)}
      #storeConfirm.on{display:flex}.confirmCard{width:min(380px,calc(100% - 40px));padding:22px;background:#171c22;
        border:1px solid #3a444e;box-shadow:0 18px 55px rgba(0,0,0,.55)}.confirmCard h3{margin:0 0 8px}
      .confirmCard p{color:#939ea7;line-height:1.65;font-size:13px}.confirmActions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}
      .confirmActions button{padding:8px 15px;border:1px solid #38434c;background:#20262d;color:#d7dee4;cursor:pointer}
      .confirmActions .buy{background:#9E1B25;border-color:#9E1B25;color:#fff}
    `;
    document.head.appendChild(style);
  }

  async function loadProducts() {
    try { products = await window.tz.listCatalog(); }
    catch (e) { console.error('[store] 商品清单读取失败', e); products = []; }
  }

  function mount() {
    addStyle();
    const homeActions = document.querySelector('#home .acts');
    if (homeActions) {
      const openButton = document.createElement('button');
      openButton.id = 'btnStore';
      openButton.className = 'ghostBtn';
      openButton.textContent = '专注星商店';
      homeActions.appendChild(openButton);
      openButton.addEventListener('click', open);
    }

    const store = document.createElement('div');
    store.id = 'store';
    store.innerHTML = `
      <div class="storeShell">
        <div class="storeHead"><div><h2>专注星商店</h2><p>认真坐下来的时间，会慢慢把房间变成你的样子。</p></div>
          <div class="storeBalance">余额 <b id="storeBalance">0</b> 颗</div>
          <button class="storeClose" id="storeClose" aria-label="关闭">×</button>
        </div>
        <div class="storeTabs" id="storeTabs"></div><div class="storeGrid" id="storeGrid"></div>
      </div>`;
    document.body.appendChild(store);

    const confirm = document.createElement('div');
    confirm.id = 'storeConfirm';
    confirm.innerHTML = `<div class="confirmCard"><h3 id="confirmTitle"></h3><p id="confirmText"></p>
      <div class="confirmActions"><button id="confirmCancel">再想想</button><button id="confirmBuy" class="buy">确认购买</button></div></div>`;
    document.body.appendChild(confirm);
    $('storeClose').addEventListener('click', close);
    $('confirmCancel').addEventListener('click', closeConfirm);
    $('confirmBuy').addEventListener('click', buyConfirmed);
    TYPES.forEach(([type, label]) => {
      const b = document.createElement('button');
      b.textContent = label; b.dataset.type = type;
      b.addEventListener('click', () => { activeType = type; render(); });
      $('storeTabs').appendChild(b);
    });
    window.TZPoints.subscribe((e) => { if (e.type === 'balance' || e.type === 'purchase') render(); });
  }

  function typeName(type) { return (TYPES.find((x) => x[0] === type) || ['', type])[1]; }
  function render() {
    if (!$('storeGrid')) return;
    const snap = window.TZPoints.snapshot();
    $('storeBalance').textContent = snap.balance;
    document.querySelectorAll('#storeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.type === activeType));
    const rows = products.filter((p) => activeType === 'all' || p.type === activeType);
    $('storeGrid').innerHTML = '';
    if (!rows.length) {
      $('storeGrid').innerHTML = '<div class="storeEmpty">这一类内容还在制作中。</div>';
      return;
    }
    rows.forEach((p) => {
      const owned = snap.owned.includes(p.id);
      const delivered = snap.delivered.includes(p.id);
      const unlocked = (p.unlockMinutes || 0) <= snap.totalFocusMinutes;
      const affordable = snap.balance >= p.price;
      const card = document.createElement('article');
      card.className = 'productCard';
      const preview = p.preview
        ? `<div class="productPreview" style="background-image:url('../${p.preview}');background-size:cover"><span class="productType">${typeName(p.type)}</span></div>`
        : `<div class="productPreview"><span class="productType">${typeName(p.type)}</span><i class="lampIcon"></i></div>`;
      let action = `<button data-buy="${p.id}" ${(!p.available || !unlocked || !affordable) ? 'disabled' : ''}>购买</button>`;
      if (owned) action = `<span class="ownedTag ${delivered ? '' : 'deliveryTag'}">${delivered ? '已拥有' : '下次开场送达'}</span>`;
      const hint = !unlocked ? `累计专注 ${p.unlockMinutes} 分钟后出现` : (!affordable && !owned ? `还差 ${p.price - snap.balance} 颗` : '');
      card.innerHTML = `${preview}<div class="productBody"><h3>${p.name}</h3><p>${p.description || ''}</p>
        <div class="productFoot"><span class="price">✦ ${p.price}</span>${hint ? `<small>${hint}</small>` : ''}${action}</div></div>`;
      $('storeGrid').appendChild(card);
    });
    document.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => askBuy(b.dataset.buy)));
  }

  async function open() {
    await loadProducts();
    render();
    $('store').classList.add('on');
  }
  function close() { $('store').classList.remove('on'); closeConfirm(); }
  function askBuy(id) {
    pendingProduct = products.find((p) => p.id === id);
    if (!pendingProduct || !window.TZPoints.canPurchase(pendingProduct)) return;
    $('confirmTitle').textContent = `购买「${pendingProduct.name}」？`;
    $('confirmText').textContent = `将花费 ${pendingProduct.price} 颗专注星。购买后永久拥有，不会因之后扣分而收回。`;
    $('storeConfirm').classList.add('on');
  }
  function closeConfirm() { pendingProduct = null; if ($('storeConfirm')) $('storeConfirm').classList.remove('on'); }
  function buyConfirmed() {
    if (!pendingProduct) return;
    window.TZPoints.purchase(pendingProduct);
    closeConfirm(); render();
  }

  window.TZStore = { open, close, render, products: () => products.slice() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
