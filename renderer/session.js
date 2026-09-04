/* session.js — 会话状态机
 * 状态：idle(未开始) → running(陪伴中) ⇄ resting(休息中) → ended(已结束)
 * 关键规则：只有 running 时才请求感知；resting 时摄像头真正关闭。
 */
'use strict';
window.TZ = window.TZ || {};

TZ.Session = (function () {
  const S = {
    state: 'idle',
    plannedMin: 90,
    breakAtMin: 45,
    breakLenMin: 8,
    mode: 'peer',           // 共场默认；'strict' 由用户主动选
    startedAt: 0,
    restStartedAt: 0,
    focusMs: 0,             // 累计专注时长
    awayCount: 0,
    distractCount: 0,
    lastTick: 0,
    userState: 'unknown'    // focus|away|phone|drowsy|covered|unknown
  };

  const listeners = [];
  let tick = null;

  function emit(type, data) {
    listeners.forEach(fn => { try { fn(type, data || {}, snapshot()); } catch (e) { console.error(e); } });
  }
  function snapshot() { return Object.assign({}, S); }

  function loop() {
    const now = Date.now();
    const dt = S.lastTick ? now - S.lastTick : 0;
    S.lastTick = now;

    if (S.state === 'running') {
      if (S.userState === 'focus') S.focusMs += dt;

      const elapsedMin = (now - S.startedAt) / 60000;
      if (S.breakAtMin > 0 && elapsedMin >= S.breakAtMin && !S._breakDone) {
        S._breakDone = true;
        api.startBreak();
        return;
      }
      if (elapsedMin >= S.plannedMin) { api.end('planned'); return; }
    }

    if (S.state === 'resting') {
      const restMin = (now - S.restStartedAt) / 60000;
      // 结束前 30 秒它自己先坐直——用行为提示，不叫人
      if (!S._preEnd && restMin >= S.breakLenMin - 0.5) { S._preEnd = true; emit('break-preend'); }
      if (restMin >= S.breakLenMin) api.resume();
    }

    emit('tick');
  }

  const api = {
    on(fn) { listeners.push(fn); },
    get() { return snapshot(); },
    state() { return S.state; },

    configure(cfg) { Object.assign(S, cfg || {}); emit('config'); },

    start() {
      if (S.state === 'running') return;
      S.state = 'running';
      S.startedAt = Date.now();
      S.lastTick = Date.now();
      S.focusMs = 0; S.awayCount = 0; S.distractCount = 0;
      S._breakDone = false; S._preEnd = false;
      S.userState = 'focus';
      if (TZ.Gate) TZ.Gate.reset();
      if (!tick) tick = setInterval(loop, 1000);
      emit('start');
    },

    startBreak() {
      if (S.state !== 'running') return;
      S.state = 'resting';
      S.restStartedAt = Date.now();
      S._preEnd = false;
      emit('break-start');
    },

    resume() {
      if (S.state !== 'resting') return;
      S.state = 'running';
      S.lastTick = Date.now();
      emit('break-end');
    },

    end(why) {
      if (S.state === 'idle' || S.state === 'ended') return;
      S.state = 'ended';
      if (tick) { clearInterval(tick); tick = null; }
      emit('end', { why: why || 'manual' });
    },

    reset() {
      if (tick) { clearInterval(tick); tick = null; }
      S.state = 'idle'; S.focusMs = 0; S.awayCount = 0; S.distractCount = 0;
      S.userState = 'unknown';
      emit('reset');
    },

    /** 感知层推来的用户状态 */
    setUserState(label) {
      if (S.state !== 'running') return;
      if (label === S.userState) return;
      const prev = S.userState;
      S.userState = label;
      if (label === 'away') S.awayCount++;
      if (label === 'phone' || label === 'drowsy') S.distractCount++;
      emit('user-state', { from: prev, to: label });
    },

    focusMinutes() { return Math.floor(S.focusMs / 60000); },
    elapsedMinutes() { return S.startedAt ? Math.floor((Date.now() - S.startedAt) / 60000) : 0; },
    remainingMinutes() { return Math.max(0, S.plannedMin - this.elapsedMinutes()); }
  };

  return api;
})();
