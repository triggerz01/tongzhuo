/* points.js — 专注点数规则引擎
 *
 * 只管记账，不碰页面。浏览器里挂 window.TZPoints，Node 里能 require 出来跑测试。
 * 这个结构学的是 ban-jiang 的 economy.js —— 规则集中在一处、界面只消费事件，
 * 是对的。规则本身是我们自己的。
 *
 * 和他最大的不同：不另起一套状态机。
 * room.js 的 fire() 每触发一次角色反应就调 award() ——
 * 「玩手机被提醒」这件事，用户看见的和账上扣的，是同一个事件，
 * 不可能对不上。他那版是平行地数同一串信号，两本账迟早分家。
 *
 * 规则（一次自习之内，签到/连续天数这类先不做）：
 *   夸赞一次            +20    专注够久触发的那个开心反应
 *   玩手机被提醒一次     -5
 *   长时间离席一次       -5
 *   完整且专注地完成      +100  计划时长跑满 + 手机≤3次 + 离席≤3次
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TZPointsAPI = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'tongzhuo.points.v1';

  /* 一次自习里各种事件的分值。key 就是 room.js 里 EVENT_KIND 的取值，
     两边必须对得上 —— 对不上的 kind 直接忽略，不静默记 0。 */
  const AWARD = {
    praise: 20,     // 专注够久，被夸
    phone: -5,      // 玩手机被提醒
    away: -5        // 离席过久，她担心了
  };

  const COMPLETE_BONUS = 100;
  const LIMIT = { phone: 3, away: 3 };   // 超过这个次数就算不上"专注地完成"

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = (now) => `${now}-${Math.random().toString(36).slice(2, 8)}`;

  function emptyState() {
    return { version: VERSION, balance: 0, owned: [], ledger: [] };
  }

  class Points {
    constructor(options) {
      const o = options || {};
      this.clock = o.clock || (() => Date.now());
      this.storage = o.storage ||
        (typeof localStorage !== 'undefined' ? localStorage : null);
      this.listeners = new Set();
      this.state = this._load();
      this.session = null;
    }

    /* ---------------- 存储 ---------------- */
    _load() {
      if (!this.storage) return emptyState();
      try {
        const parsed = JSON.parse(this.storage.getItem(STORAGE_KEY));
        return parsed && parsed.version === VERSION
          ? Object.assign(emptyState(), parsed) : emptyState();
      } catch (e) { return emptyState(); }
    }

    _save() {
      if (!this.storage) return;
      this.state.ledger = this.state.ledger.slice(-500);   // 流水不留成史书
      try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
      catch (e) { /* 隐私模式 */ }
    }

    _emit(type, detail) {
      const e = Object.assign({ type, snapshot: this.snapshot() }, detail || {});
      this.listeners.forEach((fn) => { try { fn(e); } catch (err) { console.error(err); } });
      return e;
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    snapshot() {
      return {
        balance: this.state.balance,
        owned: this.state.owned.slice(),
        session: this.session ? {
          plannedMin: this.session.plannedMin,
          counts: Object.assign({}, this.session.counts),
          delta: this.session.delta            // 本场到此为止的净得失
        } : null
      };
    }

    /* ---------------- 一场自习 ---------------- */
    startSession(opts) {
      const o = opts || {};
      this.session = {
        id: uid(this.clock()),
        startedAt: this.clock(),
        plannedMin: Math.max(1, Number(o.plannedMin) || 25),
        counts: { praise: 0, phone: 0, away: 0 },
        delta: 0
      };
      return this._emit('session-start');
    }

    /** room.js 的 fire() 每触发一次角色反应就叫一次这里 */
    award(kind) {
      const s = this.session;
      if (!s || !(kind in AWARD)) return null;
      s.counts[kind] += 1;
      s.delta += AWARD[kind];
      return this._emit('award', { kind, amount: AWARD[kind], counts: Object.assign({}, s.counts) });
    }

    /** 这一场算不算"完整且专注地完成" */
    static judgeClean(reason, counts) {
      return reason === 'planned'
        && (counts.phone || 0) <= LIMIT.phone
        && (counts.away || 0) <= LIMIT.away;
    }

    endSession(reason, extra) {
      const s = this.session;
      if (!s) return null;
      const x = extra || {};
      const counts = s.counts;
      const clean = Points.judgeClean(reason, counts);
      const bonus = clean ? COMPLETE_BONUS : 0;
      const total = s.delta + bonus;

      // 账户不为负。扣到 0 就停 —— 让人欠债不是我们要的关系。
      const before = this.state.balance;
      this.state.balance = Math.max(0, before + total);
      const applied = this.state.balance - before;

      const result = {
        sessionId: s.id,
        reason: reason || 'manual',
        plannedMin: s.plannedMin,
        focusMin: x.focusMin ?? 0,
        elapsedMin: x.elapsedMin ?? 0,
        counts: Object.assign({}, counts),
        lines: [
          { key: 'praise', label: '被夸奖', n: counts.praise, each: AWARD.praise,
            amount: counts.praise * AWARD.praise },
          { key: 'phone', label: '玩手机被提醒', n: counts.phone, each: AWARD.phone,
            amount: counts.phone * AWARD.phone },
          { key: 'away', label: '离席过久', n: counts.away, each: AWARD.away,
            amount: counts.away * AWARD.away },
          { key: 'complete', label: '完整完成', n: clean ? 1 : 0, each: COMPLETE_BONUS,
            amount: bonus }
        ],
        clean,
        // 没拿到完成奖励时，说清楚是卡在哪一条
        missed: clean ? null : (reason !== 'planned' ? 'early'
                 : counts.phone > LIMIT.phone ? 'phone'
                 : counts.away > LIMIT.away ? 'away' : 'other'),
        total,
        applied,                                  // 真正记到账上的（扣到 0 就停）
        balance: this.state.balance
      };

      this.state.ledger.push({
        id: s.id, at: new Date(this.clock()).toISOString(),
        total, applied, counts: Object.assign({}, counts), reason: result.reason
      });
      this.session = null;
      this._save();
      this._emit('session-end', { result });
      return result;
    }

    /* ---------------- 商店 ---------------- */
    owns(id) { return this.state.owned.includes(id); }

    canBuy(product) {
      return !!product && !this.owns(product.id)
        && Number(product.price) >= 0 && this.state.balance >= Number(product.price);
    }

    buy(product) {
      if (!this.canBuy(product)) return { ok: false, reason: 'unavailable' };
      const price = Math.floor(Number(product.price));
      this.state.balance -= price;
      this.state.owned.push(product.id);
      this.state.ledger.push({ id: uid(this.clock()), at: new Date(this.clock()).toISOString(),
                               total: -price, applied: -price, purchase: product.id });
      this._save();
      this._emit('purchase', { product: clone(product), amount: price });
      return { ok: true, balance: this.state.balance };
    }

    /* 调试/演示用 */
    grant(n) {
      this.state.balance = Math.max(0, this.state.balance + Math.floor(n));
      this._save();
      return this._emit('balance');
    }
    reset() {
      this.state = emptyState();
      this.session = null;
      this._save();
      return this._emit('balance');
    }
    ledger() { return clone(this.state.ledger); }
  }

  return { Points, AWARD, COMPLETE_BONUS, LIMIT, STORAGE_KEY };
});
