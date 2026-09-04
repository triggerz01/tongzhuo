/* panel.js — 控制台窗
 * 只发消息、只显示状态；所有逻辑住在角色窗里。
 */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const post = (m) => { if (window.tz) window.tz.post(m); };

  /* ---------- 会话 ---------- */
  function pushConfig() {
    post({ type: 'session-config', config: {
      plannedMin: Number($('fPlanned').value) || 90,
      breakAtMin: Number($('fBreakAt').value) || 0,
      breakLenMin: Number($('fBreakLen').value) || 8
    }});
  }
  ['fPlanned', 'fBreakAt', 'fBreakLen'].forEach(id => $(id).addEventListener('change', pushConfig));

  $('btnCalib').addEventListener('click', () => { post({ type: 'calibrate' }); addLog('请求基线标定'); });
  $('btnStart').addEventListener('click', () => { pushConfig(); post({ type: 'session-start' }); });
  $('btnBreak').addEventListener('click', () => post({ type: 'session-break' }));
  $('btnEnd').addEventListener('click',   () => post({ type: 'session-end' }));
  $('btnReset').addEventListener('click', () => post({ type: 'session-reset' }));
  $('btnClose').addEventListener('click', () => { if (window.tz) window.tz.closePanel(); });

  /* ---------- 人格 ---------- */
  group('[data-persona]', 'data-persona', v => post({ type: 'set-persona', persona: v }));

  /* ---------- 外观 ---------- */
  group('[data-tpl]', 'data-tpl', v => {
    post({ type: 'set-outfit', outfit: v });
    const hair = { suit: 'short', teacher: 'bun', school: 'twin' }[v];
    document.querySelectorAll('[data-hair]').forEach(b => b.classList.toggle('on', b.getAttribute('data-hair') === hair));
  });
  group('[data-hair]', 'data-hair', v => post({ type: 'set-hair', hair: v }));

  let faceOn = true;
  $('btnFace').addEventListener('click', function () {
    faceOn = !faceOn;
    this.classList.toggle('on', faceOn);
    this.textContent = faceOn ? '有脸' : '出厂状态';
    post({ type: 'set-face', on: faceOn });
  });

  const SLIDERS = [
    ['pEyeSize', 'eyeSize', 'oEyeSize'], ['pEyeDist', 'eyeDist', 'oEyeDist'],
    ['pEyeY', 'eyeY', 'oEyeY'], ['pBrow', 'brow', 'oBrow'],
    ['pBrowW', 'browW', 'oBrowW'], ['pFaceW', 'faceW', 'oFaceW'],
    ['pBlush', 'blush', 'oBlush']
  ];
  SLIDERS.forEach(([id, key, out]) => {
    const el = $(id);
    const sync = () => {
      if (out && $(out)) $(out).textContent = el.value;
      post({ type: 'set-params', params: { [key]: parseFloat(el.value) } });
    };
    el.addEventListener('input', sync);
    if (out && $(out)) $(out).textContent = el.value;
  });
  [['pSkin', 'skin'], ['pHair', 'hair'], ['pAcc', 'acc']].forEach(([id, key]) => {
    $(id).addEventListener('input', () => post({ type: 'set-params', params: { [key]: $(id).value } }));
  });

  /* ---------- 待机 ---------- */
  let fast = false;
  $('btnFast').addEventListener('click', function () {
    fast = !fast;
    this.classList.toggle('on', fast);
    this.textContent = fast ? '切回真实节奏' : '切到演示节奏';
    post({ type: 'idle-fast', on: fast });
  });

  const ACT = [
    ['write', '低头写字'], ['stretch', '伸懒腰'], ['yawn', '打哈欠'], ['daze', '发呆'],
    ['drink', '喝水'], ['rub', '揉眼睛'], ['glance', '看你一眼'], ['lie', '趴一会儿'],
    ['tidy', '整理桌面'], ['rare', '笔掉了']
  ];
  const box = $('actBtns');
  ACT.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => post({ type: 'idle-trigger', id }));
    box.appendChild(b);
  });

  /* ---------- 演示通道 ---------- */
  document.querySelectorAll('[data-sim]').forEach(b => {
    b.addEventListener('click', () => post({ type: 'simulate', kind: b.getAttribute('data-sim') }));
  });
  document.querySelectorAll('[data-appeal]').forEach(b => {
    b.addEventListener('click', () => post({ type: 'appeal', kind: b.getAttribute('data-appeal') }));
  });

  /* ---------- 接收 ---------- */
  const STATE_CN = { idle: '未开始', running: '陪伴中', resting: '休息中', ended: '已结束' };
  if (window.tz) window.tz.onBus((m) => {
    if (!m || !m.type) return;
    if (m.type === 'log') addLog(m.text);
    if (m.type === 'intervention') addLog(`干预 L${m.level} · ${m.kind}`);
    if (m.type === 'idle-fire') addLog('待机 · ' + m.label);
    if (m.type === 'user-state') addLog('状态 → ' + m.label);
    if (m.type === 'session-summary') {
      addLog(`本场结束：专注 ${m.focusMin}′ · 离席 ${m.awayCount} 次 · 走神 ${m.distractCount} 次`);
    }
    if (m.type === 'perception-status') {
      $('connDot').classList.toggle('on', !!m.connected);
      $('connDot').classList.toggle('off', !m.connected);
      addLog(m.connected ? '感知层已连接' : '感知层未连接（降级为纯陪伴模式）');
    }
    if (m.type === 'stats') {
      $('stState').textContent = STATE_CN[m.state] || m.state;
      $('stFocus').textContent = m.focusMin;
      $('stAway').textContent = m.awayCount;
      $('stDist').textContent = m.distractCount;
    }
  });

  function group(sel, attr, fn) {
    const nodes = document.querySelectorAll(sel);
    nodes.forEach(b => b.addEventListener('click', () => {
      nodes.forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      fn(b.getAttribute(attr));
    }));
  }

  function addLog(text) {
    const box = $('log');
    const first = box.firstElementChild;
    if (first && first.textContent.indexOf('等待事件') > -1) first.remove();
    const d = new Date(), p = (n) => (n < 10 ? '0' : '') + n;
    const row = document.createElement('div');
    row.innerHTML = `<span class="t">${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</span><span></span>`;
    row.lastElementChild.textContent = text;
    box.insertBefore(row, box.firstChild);
    while (box.children.length > 80) box.removeChild(box.lastChild);
  }
})();
