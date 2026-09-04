/* gate.js — 干预阶梯 + 频率闸门
 * "检测到了却不说话"不是 bug，是主张。所有反馈必须过这道闸。
 *
 * 硬约束（见 PRD §6）：
 *   1) 任意干预：10 分钟内最多 1 次
 *   2) 同一行为类型：30 分钟内最多 2 次
 *   3) 两次干预之间至少要有一次待机行为或正向反馈
 *   4) 用户点"我在看书"后，该类型静默 30 分钟
 */
'use strict';
window.TZ = window.TZ || {};

TZ.Gate = (function () {
  const MIN = 60 * 1000;
  const COOLDOWN_ANY  = 10 * MIN;
  const WINDOW_KIND   = 30 * MIN;
  const MAX_PER_KIND  = 2;
  const MUTE_MS       = 30 * MIN;

  let lastAny = 0;
  let neutralSince = true;          // 上次干预之后是否发生过中性/正向事件
  const fired = [];                 // {ts, kind, level}
  const muted = {};                 // kind -> 静默截止时间
  const listeners = [];

  function recent(kind, span) {
    const now = Date.now();
    return fired.filter(f => f.kind === kind && now - f.ts < span);
  }

  function emit(rec) { listeners.forEach(fn => { try { fn(rec); } catch (e) { console.error(e); } }); }

  return {
    onDecision(fn) { listeners.push(fn); },

    /**
     * 请求一次干预。
     * @returns {{allowed:boolean, level:number, reason:string}}
     */
    request(kind) {
      const now = Date.now();

      if (muted[kind] && now < muted[kind]) {
        const rec = { ts: now, kind, allowed: false, level: 0, reason: 'muted' };
        emit(rec); return rec;
      }
      if (now - lastAny < COOLDOWN_ANY) {
        const rec = { ts: now, kind, allowed: false, level: 0, reason: 'cooldown' };
        emit(rec); return rec;
      }
      const hits = recent(kind, WINDOW_KIND);
      if (hits.length >= MAX_PER_KIND) {
        const rec = { ts: now, kind, allowed: false, level: 0, reason: 'kind_limit' };
        emit(rec); return rec;
      }
      if (!neutralSince) {
        const rec = { ts: now, kind, allowed: false, level: 0, reason: 'need_neutral' };
        emit(rec); return rec;
      }

      // 首次 → L1 静默；再次 → L2；仅严格人格可升到 L3
      let level = hits.length === 0 ? 1 : 2;
      if (level === 2 && TZ.Persona && TZ.Persona.maxLevel() >= 3) level = 3;

      lastAny = now;
      neutralSince = false;
      fired.push({ ts: now, kind, level });

      const rec = { ts: now, kind, allowed: true, level, reason: 'ok' };
      emit(rec); return rec;
    },

    /** 待机行为或正向反馈发生时调用，解开"两次干预之间必须有中性事件"的锁 */
    noteNeutral() { neutralSince = true; },

    /** 用户申诉：我在看书 */
    mute(kind, ms) { muted[kind] = Date.now() + (ms || MUTE_MS); },
    isMuted(kind) { return !!(muted[kind] && Date.now() < muted[kind]); },

    reset() {
      lastAny = 0; neutralSince = true;
      fired.length = 0;
      Object.keys(muted).forEach(k => delete muted[k]);
    },

    stats() {
      const now = Date.now();
      return {
        total: fired.length,
        last10min: fired.filter(f => now - f.ts < COOLDOWN_ANY).length,
        nextAllowedIn: Math.max(0, COOLDOWN_ANY - (now - lastAny))
      };
    },
    history() { return fired.slice(); }
  };
})();
