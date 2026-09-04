/* app.js — 角色窗装配
 * 把 character / idle / gate / session / 感知层 接到一起。
 * 没有 Python 感知服务时，这一层仍然完整可用（PRD F14 降级路径）。
 */
'use strict';
(function () {
  const C = TZ.Character, Idle = TZ.Idle, Gate = TZ.Gate, Sess = TZ.Session, Per = TZ.Persona;

  const bubble = document.getElementById('bubble');
  const hudText = document.getElementById('hudText');
  const camDot = document.getElementById('camDot');
  const svg = document.getElementById('ch');

  let bubbleTimer = null;
  function say(text, ms) {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add('on');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('on'), ms || 3600);
  }

  /* ---------------- 干预动作 ---------------- */
  const KIND_CN = { phone: '手机', away: '离席', drowsy: '困倦', covered: '遮挡' };

  function actL1() {
    // 停下笔，看你一眼，又低头。不出声。
    C.pose({ headRot: -3, eyeDX: 5, armR: 0, armL: 0 }, 2000);
  }
  function intervene(kind) {
    const d = Gate.request(kind);
    log(d.allowed ? `干预 L${d.level} · ${KIND_CN[kind] || kind}`
                  : `拦下 · ${KIND_CN[kind] || kind} · ${d.reason}`);
    if (!d.allowed) return;

    actL1();
    if (d.level >= 2) {
      const line = Per.line(d.level, kind);
      setTimeout(() => say(line, d.level >= 3 ? 5000 : 3600), 700);
    }
    post({ type: 'intervention', kind, level: d.level, ts: d.ts });
  }

  /* ---------------- 会话联动 ---------------- */
  let lastPraise = 0;
  Sess.on((type, data, s) => {
    if (type === 'start') { setHud('陪伴中'); Idle.start(onIdleFire); }
    if (type === 'break-start') {
      setHud('休息中');
      C.pose({ figY: 30, figRot: 5, headRot: 8, eyeK: 0.1 }, 6000);
      say(Per.breakStart(), 4200);
      post({ type: 'perception', cmd: 'pause' });
    }
    if (type === 'break-preend') { C.pose({ headRot: -2 }, 1500); }
    if (type === 'break-end') {
      setHud('陪伴中');
      say(Per.breakEnd(), 3000);
      post({ type: 'perception', cmd: 'resume' });
    }
    if (type === 'end') {
      setHud('已结束');
      Idle.stop();
      say(Per.sessionEnd(), 5000);
      post({ type: 'perception', cmd: 'pause' });
      post({ type: 'session-summary', focusMin: Sess.focusMinutes(),
             awayCount: s.awayCount, distractCount: s.distractCount });
    }
    if (type === 'reset') { setHud('未开始'); }

    if (type === 'tick' && s.state === 'running') {
      // 正向反馈：连续专注满 25 分钟给一次，且至少间隔 25 分钟
      const fm = Sess.focusMinutes();
      if (fm > 0 && fm % 25 === 0 && Date.now() - lastPraise > 25 * 60000) {
        lastPraise = Date.now();
        Gate.noteNeutral();
        say(Per.praise(), 4000);
        log('正向反馈 · 专注 ' + fm + ' 分钟');
      }
      hudText.textContent = `陪伴中 ${Sess.elapsedMinutes()}′ / 专注 ${fm}′`;
    }

    if (type === 'tick' || type === 'start' || type === 'end' || type === 'reset' ||
        type === 'break-start' || type === 'break-end') {
      post({ type: 'stats', state: s.state, focusMin: Sess.focusMinutes(),
             awayCount: s.awayCount, distractCount: s.distractCount });
    }
  });

  function onIdleFire(a) {
    Gate.noteNeutral();           // 待机行为解锁"两次干预之间需有中性事件"
    post({ type: 'idle-fire', id: a.id, label: a.label });
  }

  function setHud(t) { hudText.textContent = t; }

  /* ---------------- 感知层 WebSocket ---------------- */
  const WS_URL = 'ws://127.0.0.1:8765';
  let ws = null, wsTimer = null;

  function connect() {
    try { ws = new WebSocket(WS_URL); } catch (e) { retry(); return; }

    ws.onopen = () => {
      camDot.classList.remove('off'); camDot.classList.add('on');
      log('感知层已连接');
      post({ type: 'perception-status', connected: true });
    };
    ws.onclose = () => {
      camDot.classList.add('off'); camDot.classList.remove('on');
      post({ type: 'perception-status', connected: false });
      retry();
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      handlePerception(m);
    };
  }
  function retry() { if (wsTimer) return; wsTimer = setTimeout(() => { wsTimer = null; connect(); }, 4000); }

  function sendPerception(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function handlePerception(m) {
    if (m.type === 'state') {
      Sess.setUserState(m.label);
      post({ type: 'user-state', label: m.label, duration: m.duration });
      if (Sess.state() !== 'running') return;
      if (m.label === 'focus') { Gate.noteNeutral(); return; }
      if (m.trigger) intervene(m.label);       // 感知层已判定达到阈值
    }
    if (m.type === 'calibrated') { log('基线标定完成'); post({ type: 'calibrated', data: m }); }
    if (m.type === 'error') log('感知层错误：' + m.message);
  }

  /* ---------------- 鼠标穿透与交互 ---------------- */
  function overCharacter(x, y) {
    const r = svg.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  let interactive = false;
  document.addEventListener('mousemove', (e) => {
    const want = overCharacter(e.clientX, e.clientY);
    if (want !== interactive) {
      interactive = want;
      if (window.tz) window.tz.setInteractive(want);
    }
  });
  svg.addEventListener('click', () => { if (window.tz) window.tz.openPanel(); });

  /* ---------------- 跨窗口消息 ---------------- */
  function post(msg) { if (window.tz) window.tz.post(msg); }

  if (window.tz) window.tz.onBus((msg) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'set-params':   C.setParams(msg.params); break;
      case 'set-outfit':   C.setOutfit(msg.outfit); break;
      case 'set-hair':     C.setHairStyle(msg.hair); break;
      case 'set-face':     C.setFaceVisible(msg.on); break;
      case 'set-persona':  Per.set(msg.persona); break;
      case 'idle-fast':    Idle.setFast(msg.on); break;
      case 'idle-trigger': Idle.trigger(msg.id); break;
      case 'session-config': Sess.configure(msg.config); break;
      case 'session-start': Sess.start(); sendPerception({ cmd: 'start' }); break;
      case 'session-break': Sess.startBreak(); break;
      case 'session-end':   Sess.end('manual'); sendPerception({ cmd: 'pause' }); break;
      case 'session-reset': Sess.reset(); break;
      case 'calibrate':     sendPerception({ cmd: 'calibrate' }); break;
      case 'appeal':        Gate.mute(msg.kind); log('已静默 ' + (KIND_CN[msg.kind] || msg.kind) + ' 30 分钟'); break;
      case 'simulate':      intervene(msg.kind); break;      // 无摄像头时的演示通道
      case 'perception':    sendPerception({ cmd: msg.cmd }); break;
      case 'say':           say(msg.text, msg.ms); break;
    }
  });

  function log(text) { post({ type: 'log', text, ts: Date.now() }); }

  /* ---------------- 启动 ---------------- */
  C.init();
  Idle.setFast(false);
  Idle.start(onIdleFire);   // 未开始会话时也活着——共场感不依赖会话
  setHud('未开始');
  connect();
})();
