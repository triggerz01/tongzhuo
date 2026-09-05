/* economy.js — 专注星规则引擎
 *
 * 只负责记账和规则，不依赖页面结构。商品系统以后只需调用 purchase()。
 * 浏览器中暴露 window.TZEconomy；Node 中导出，便于跑单元测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TZEconomy = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION = 1;
  const STORAGE_KEY = 'tongzhuo.economy.v1';
  const MIN_SETTLE_MS = 10 * 60 * 1000;
  const RECOVERY_MS = 10 * 60 * 1000;
  const CONTRACT_ACCOUNT_CAP = 15;
  const DAILY_ACCOUNT_CAP = 30;
  const VIOLATIONS = {
    phone:  { seconds: 15, amount: 5, label: '持续使用手机' },
    away:   { seconds: 120, amount: 3, label: '非计划离席' },
    drowsy: { seconds: 30, amount: 3, label: '持续困倦' }
  };

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const pad = (n) => String(n).padStart(2, '0');
  function localDateKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function localWeekKey(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return localDateKey(d.getTime());
  }
  function uid(now) {
    return `${now}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function emptyState() {
    return {
      version: VERSION,
      balance: 0,
      totalFocusMinutes: 0,
      owned: [],
      delivered: [],
      daily: {},
      weeks: {},
      ledger: []
    };
  }
  function completionBonus(plannedMin) {
    if (plannedMin >= 60) return 10;
    if (plannedMin >= 45) return 8;
    if (plannedMin >= 25) return 5;
    if (plannedMin >= 10) return 3;
    return 0;
  }

  class Economy {
    constructor(options) {
      const o = options || {};
      this.clock = o.clock || (() => Date.now());
      this.storage = o.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      this.listeners = new Set();
      this.state = this._load();
      this.session = null;
      this.claimDailyOpen();
    }

    _load() {
      if (!this.storage) return emptyState();
      try {
        const parsed = JSON.parse(this.storage.getItem(STORAGE_KEY));
        return parsed && parsed.version === VERSION
          ? Object.assign(emptyState(), parsed)
          : emptyState();
      } catch (_) { return emptyState(); }
    }

    _save() {
      if (!this.storage) return;
      this.state.ledger = this.state.ledger.slice(-500);
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }

    _emit(type, detail) {
      const event = Object.assign({ type, snapshot: this.snapshot() }, detail || {});
      this.listeners.forEach((fn) => { try { fn(event); } catch (e) { console.error(e); } });
      return event;
    }

    _ledger(type, amount, reason, extra) {
      const now = this.clock();
      const row = Object.assign({
        id: uid(now), type, amount, reason,
        sessionId: this.session ? this.session.id : null,
        createdAt: new Date(now).toISOString()
      }, extra || {});
      this.state.ledger.push(row);
      return row;
    }

    _credit(amount, reason, extra) {
      const n = Math.max(0, Math.floor(amount));
      if (!n) return null;
      this.state.balance += n;
      const row = this._ledger('credit', n, reason, extra);
      this._save();
      this._emit('balance', { amount: n, reason, row });
      return row;
    }

    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    snapshot() {
      const pendingPenalty = this.session
        ? this.session.penalties.reduce((n, p) => n + (p.recovered ? 0 : p.pendingAmount), 0)
        : 0;
      return {
        balance: this.state.balance,
        totalFocusMinutes: this.state.totalFocusMinutes,
        owned: this.state.owned.slice(),
        delivered: this.state.delivered.slice(),
        session: this.session ? {
          id: this.session.id,
          mode: this.session.mode,
          plannedMin: this.session.plannedMin,
          elapsedMs: Math.max(0, this.clock() - this.session.startedAt),
          effectiveMs: this.session.effectiveMs,
          pending: Math.max(0, Math.floor(this.session.effectiveMs / 60000) - pendingPenalty),
          recoveryMs: this.session.recovery ? this.session.recovery.focusMs : 0,
          contractActive: this.clock() - this.session.startedAt >= MIN_SETTLE_MS
        } : null
      };
    }

    claimDailyOpen() {
      const now = this.clock();
      const key = localDateKey(now);
      const d = this.state.daily[key] || (this.state.daily[key] = {});
      if (d.openClaimed) return false;
      d.openClaimed = true;
      this._credit(2, 'daily_open', { date: key });
      return true;
    }

    startSession(options) {
      if (this.session) return this.snapshot().session;
      // 应用跨午夜保持打开时，也在当天第一次开场补领见面礼。
      this.claimDailyOpen();
      const now = this.clock();
      const o = options || {};
      this.session = {
        id: uid(now),
        startedAt: now,
        lastTickAt: now,
        plannedMin: Math.max(1, Number(o.plannedMin) || 25),
        mode: o.mode === 'contract' ? 'contract' : 'companion',
        currentLabel: 'focus',
        effectiveMs: 0,
        occurrences: { phone: 0, away: 0, drowsy: 0 },
        episodeHandled: {},
        silentUntil: {},
        penalties: [],
        accountDeducted: 0,
        recovery: null
      };
      this._emit('session-start');
      return this.snapshot().session;
    }

    tick() {
      const s = this.session;
      if (!s) return null;
      const now = this.clock();
      const dt = Math.max(0, Math.min(5000, now - s.lastTickAt));
      s.lastTickAt = now;
      if (s.currentLabel === 'focus') {
        s.effectiveMs += dt;
        if (s.recovery) {
          s.recovery.focusMs += dt;
          if (s.recovery.focusMs >= RECOVERY_MS) this._recover(s.recovery.penaltyId, 'focus_recovery');
        }
      }
      this._emit('tick');
      return this.snapshot().session;
    }

    noteState(label, durationSeconds) {
      const s = this.session;
      if (!s) return null;
      this.tick();
      const previous = s.currentLabel;
      s.currentLabel = label || 'unknown';
      if (previous !== s.currentLabel) s.episodeHandled = {};

      const rule = VIOLATIONS[label];
      if (!rule || Number(durationSeconds) < rule.seconds || s.episodeHandled[label]) return null;
      s.episodeHandled[label] = true;
      s.occurrences[label] += 1;
      if (s.recovery) s.recovery.focusMs = 0;

      if (this.clock() < (s.silentUntil[label] || 0)) return this._emit('violation-silent', { kind: label });
      if (s.occurrences[label] === 1) {
        return this._emit('violation-warning', { kind: label, label: rule.label });
      }
      if (s.mode !== 'contract') return this._emit('violation-paused', { kind: label });
      if (this.clock() - s.startedAt < MIN_SETTLE_MS) {
        return this._emit('penalty-not-active', { kind: label });
      }
      return this._emit('penalty-proposed', { kind: label, amount: rule.amount, label: rule.label });
    }

    applyPenalty(kind) {
      const s = this.session;
      const rule = VIOLATIONS[kind];
      if (!s || !rule || s.mode !== 'contract') return null;
      if (this.clock() - s.startedAt < MIN_SETTLE_MS) return null;

      const day = localDateKey(this.clock());
      const daily = this.state.daily[day] || (this.state.daily[day] = {});
      const dailyLeft = Math.max(0, DAILY_ACCOUNT_CAP - (daily.accountDeducted || 0));
      const sessionLeft = Math.max(0, CONTRACT_ACCOUNT_CAP - s.accountDeducted);
      const pendingMinutes = Math.floor(s.effectiveMs / 60000);
      const alreadyPendingDeducted = s.penalties.reduce((n, p) => n + (p.recovered ? 0 : p.pendingAmount), 0);
      const pendingAvailable = Math.max(0, pendingMinutes - alreadyPendingDeducted);
      const pendingAmount = Math.min(rule.amount, pendingAvailable);
      const wantedAccount = rule.amount - pendingAmount;
      const accountAmount = Math.min(wantedAccount, this.state.balance, dailyLeft, sessionLeft);
      const total = pendingAmount + accountAmount;
      if (!total) return this._emit('penalty-capped', { kind });

      this.state.balance -= accountAmount;
      daily.accountDeducted = (daily.accountDeducted || 0) + accountAmount;
      s.accountDeducted += accountAmount;
      const row = this._ledger('penalty', -total, kind, {
        pendingAmount, accountAmount, reversible: true, recovered: false
      });
      const p = { id: row.id, kind, amount: total, pendingAmount, accountAmount, recovered: false };
      s.penalties.push(p);
      s.recovery = { penaltyId: p.id, focusMs: 0 };
      this._save();
      return this._emit('penalty-applied', { kind, amount: total, pendingAmount, accountAmount, row });
    }

    appeal(kind) {
      const s = this.session;
      if (!s) return null;
      s.silentUntil[kind] = this.clock() + 30 * 60 * 1000;
      const p = [...s.penalties].reverse().find((x) => x.kind === kind && !x.recovered);
      if (p) return this._recover(p.id, 'appeal');
      return this._emit('appeal-accepted', { kind, amount: 0 });
    }

    _recover(penaltyId, reason) {
      const s = this.session;
      if (!s) return null;
      const p = s.penalties.find((x) => x.id === penaltyId && !x.recovered);
      if (!p) return null;
      p.recovered = true;
      this.state.balance += p.accountAmount;
      const original = this.state.ledger.find((x) => x.id === p.id);
      if (original) original.recovered = true;
      const row = this._ledger('recovery', p.amount, reason, { penaltyId: p.id, kind: p.kind });
      if (s.recovery && s.recovery.penaltyId === p.id) s.recovery = null;
      this._save();
      return this._emit('penalty-recovered', { kind: p.kind, amount: p.amount, reason, row });
    }

    endSession(reason) {
      const s = this.session;
      if (!s) return null;
      this.tick();
      const effectiveMin = Math.floor(s.effectiveMs / 60000);
      const elapsedMs = this.clock() - s.startedAt;
      const completed = reason === 'planned';
      const focusGoalMet = effectiveMin >= Math.max(10, Math.floor(s.plannedMin * 0.8));
      const unrecoveredPending = s.penalties.reduce((n, p) => n + (p.recovered ? 0 : p.pendingAmount), 0);
      const base = elapsedMs >= MIN_SETTLE_MS ? Math.max(0, effectiveMin - unrecoveredPending) : 0;
      const complete = completed && focusGoalMet && elapsedMs >= MIN_SETTLE_MS ? completionBonus(s.plannedMin) : 0;
      const contract = completed && focusGoalMet && s.mode === 'contract' && elapsedMs >= MIN_SETTLE_MS
        ? Math.min(20, Math.floor(base * 0.2)) : 0;
      const total = base + complete + contract;
      const result = {
        sessionId: s.id, mode: s.mode, reason: reason || 'manual',
        elapsedMin: Math.floor(elapsedMs / 60000), effectiveMin, focusGoalMet,
        eligible: elapsedMs >= MIN_SETTLE_MS,
        base, completionBonus: complete, contractBonus: contract,
        penalty: s.penalties.reduce((n, p) => n + (p.recovered ? 0 : p.amount), 0),
        total
      };
      if (total) {
        this.state.balance += total;
        this.state.totalFocusMinutes += effectiveMin;
      }
      const milestone = elapsedMs >= MIN_SETTLE_MS && effectiveMin >= 10
        ? this._qualifyToday() : { daily: 0, weekly: 0 };
      result.dailyBonus = milestone.daily;
      result.weeklyBonus = milestone.weekly;
      result.creditedTotal = total + milestone.daily + milestone.weekly;
      if (total) this._ledger('session', total, 'session_settlement', { breakdown: clone(result) });
      this.session = null;
      this._save();
      this._emit('session-end', { result });
      return result;
    }

    _qualifyToday() {
      const now = this.clock();
      const dayKey = localDateKey(now);
      const d = this.state.daily[dayKey] || (this.state.daily[dayKey] = {});
      let dailyBonus = 0;
      let weeklyBonus = 0;
      if (!d.focusClaimed) {
        d.focusClaimed = true;
        this._credit(3, 'daily_focus', { date: dayKey });
        dailyBonus = 3;
      }
      const weekKey = localWeekKey(now);
      const week = this.state.weeks[weekKey] || (this.state.weeks[weekKey] = { days: [], three: false, five: false });
      if (!week.days.includes(dayKey)) week.days.push(dayKey);
      if (week.days.length >= 3 && !week.three) {
        week.three = true;
        this._credit(10, 'weekly_three_days', { week: weekKey });
        weeklyBonus += 10;
      }
      if (week.days.length >= 5 && !week.five) {
        week.five = true;
        this._credit(20, 'weekly_five_days', { week: weekKey });
        weeklyBonus += 20;
      }
      return { daily: dailyBonus, weekly: weeklyBonus };
    }

    canPurchase(product) {
      return !!product && !this.state.owned.includes(product.id)
        && Number(product.price) >= 0 && this.state.balance >= Number(product.price);
    }

    purchase(product) {
      if (!this.canPurchase(product)) return { ok: false, reason: 'unavailable' };
      const price = Math.floor(Number(product.price));
      this.state.balance -= price;
      this.state.owned.push(product.id);
      const row = this._ledger('purchase', -price, product.id, { productType: product.type || 'item' });
      this._save();
      this._emit('purchase', { product: clone(product), amount: price, row });
      return { ok: true, balance: this.state.balance };
    }

    pendingDeliveries() {
      return this.state.owned.filter((id) => !this.state.delivered.includes(id));
    }

    markDelivered(productId) {
      if (!this.state.owned.includes(productId)) return false;
      if (!this.state.delivered.includes(productId)) {
        this.state.delivered.push(productId);
        this._ledger('delivery', 0, productId);
        this._save();
        this._emit('delivery', { productId });
      }
      return true;
    }

    ledger() { return clone(this.state.ledger); }
  }

  return { Economy, STORAGE_KEY, VIOLATIONS, completionBonus, localDateKey, localWeekKey };
});
