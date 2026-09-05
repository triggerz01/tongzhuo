'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Economy } = require('../renderer/economy.js');

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
}

function harness(start = new Date(2026, 8, 5, 9, 0, 0).getTime()) {
  let now = start;
  const economy = new Economy({ storage: new MemoryStorage(), clock: () => now });
  const advance = (seconds, label) => {
    if (label) economy.noteState(label, 0);
    for (let i = 0; i < seconds; i += 1) {
      now += 1000;
      economy.tick();
    }
  };
  return { economy, advance, now: () => now, setNow: (v) => { now = v; } };
}

test('每日首次打开只领取一次2颗专注星', () => {
  const storage = new MemoryStorage();
  const clock = () => new Date(2026, 8, 5, 9, 0, 0).getTime();
  const first = new Economy({ storage, clock });
  const second = new Economy({ storage, clock });
  assert.equal(first.snapshot().balance, 2);
  assert.equal(second.snapshot().balance, 2);
});

test('未满10分钟完全不结算', () => {
  const h = harness();
  h.economy.startSession({ plannedMin: 25, mode: 'companion' });
  h.advance(9 * 60 + 59, 'focus');
  const result = h.economy.endSession('manual');
  assert.equal(result.eligible, false);
  assert.equal(result.total, 0);
  assert.equal(h.economy.snapshot().balance, 2);
});

test('60分钟共场按分钟 加完成奖励和今日奖励结算', () => {
  const h = harness();
  h.economy.startSession({ plannedMin: 60, mode: 'companion' });
  h.advance(60 * 60, 'focus');
  const result = h.economy.endSession('planned');
  assert.equal(result.base, 60);
  assert.equal(result.completionBonus, 10);
  assert.equal(result.contractBonus, 0);
  assert.equal(result.dailyBonus, 3);
  assert.equal(result.creditedTotal, 73);
  assert.equal(h.economy.snapshot().balance, 75); // 含每日打开2颗
});

test('契约未满10分钟只提醒 不允许扣历史账户', () => {
  const h = harness();
  h.economy.state.balance = 20;
  h.economy.startSession({ plannedMin: 25, mode: 'contract' });
  h.advance(5 * 60, 'focus');
  h.economy.noteState('phone', 15); // 第一次仅提醒
  h.economy.noteState('focus', 0);
  const event = h.economy.noteState('phone', 15);
  assert.equal(event.type, 'penalty-not-active');
  assert.equal(h.economy.applyPenalty('phone'), null);
  assert.equal(h.economy.snapshot().balance, 20);
});

test('契约处罚先扣暂存积分 连续专注10分钟后全额追回', () => {
  const h = harness();
  h.economy.startSession({ plannedMin: 25, mode: 'contract' });
  h.advance(10 * 60, 'focus');
  h.economy.noteState('phone', 15);
  h.economy.noteState('focus', 0);
  const proposed = h.economy.noteState('phone', 15);
  assert.equal(proposed.type, 'penalty-proposed');
  const applied = h.economy.applyPenalty('phone');
  assert.equal(applied.pendingAmount, 5);
  assert.equal(h.economy.snapshot().session.pending, 5);
  h.advance(10 * 60, 'focus');
  assert.equal(h.economy.snapshot().session.pending, 20);
  const penalty = h.economy.ledger().find((r) => r.type === 'penalty');
  assert.equal(penalty.recovered, true);
});

test('60分钟契约完成获得20%契约奖励', () => {
  const h = harness();
  h.economy.startSession({ plannedMin: 60, mode: 'contract' });
  h.advance(60 * 60, 'focus');
  const result = h.economy.endSession('planned');
  assert.equal(result.base, 60);
  assert.equal(result.completionBonus, 10);
  assert.equal(result.contractBonus, 12);
  assert.equal(result.creditedTotal, 85); // 含当天首次有效专注3颗
});

test('申诉立即返还账户扣款并静默同类判断30分钟', () => {
  const h = harness();
  h.economy.state.balance = 20;
  h.economy.startSession({ plannedMin: 25, mode: 'contract' });
  h.advance(10 * 60, 'unknown');
  h.economy.noteState('phone', 15);
  h.economy.noteState('unknown', 0);
  h.economy.noteState('phone', 15);
  const applied = h.economy.applyPenalty('phone');
  assert.equal(applied.accountAmount, 5);
  assert.equal(h.economy.snapshot().balance, 15);
  const recovered = h.economy.appeal('phone');
  assert.equal(recovered.reason, 'appeal');
  assert.equal(h.economy.snapshot().balance, 20);
  h.economy.noteState('unknown', 0);
  assert.equal(h.economy.noteState('phone', 15).type, 'violation-silent');
});

test('处罚可扣账户但受单场15颗上限约束', () => {
  const h = harness();
  h.economy.state.balance = 100;
  h.economy.startSession({ plannedMin: 25, mode: 'contract' });
  h.advance(10 * 60, 'unknown');
  const kinds = ['phone', 'away', 'drowsy'];
  for (let round = 0; round < 4; round += 1) {
    const kind = kinds[round % kinds.length];
    h.economy.noteState(kind, 999);
    h.economy.noteState('unknown', 0);
    h.economy.noteState(kind, 999);
    h.economy.applyPenalty(kind);
    h.economy.noteState('unknown', 0);
  }
  assert.equal(h.economy.session.accountDeducted, 15);
  assert.equal(h.economy.snapshot().balance, 85);
});

test('商品购买使用稳定ID并持久保存所有权', () => {
  const storage = new MemoryStorage();
  const clock = () => new Date(2026, 8, 5, 9, 0, 0).getTime();
  const economy = new Economy({ storage, clock });
  economy.state.balance = 60;
  assert.deepEqual(economy.purchase({ id: 'item_desk_lamp_01', type: 'item', price: 60 }), { ok: true, balance: 0 });
  const restored = new Economy({ storage, clock });
  assert.equal(restored.snapshot().owned.includes('item_desk_lamp_01'), true);
  assert.deepEqual(restored.pendingDeliveries(), ['item_desk_lamp_01']);
  assert.equal(restored.markDelivered('item_desk_lamp_01'), true);
  assert.equal(restored.snapshot().delivered.includes('item_desk_lamp_01'), true);
  assert.equal(restored.purchase({ id: 'item_desk_lamp_01', type: 'item', price: 60 }).ok, false);
});

test('每周第3个和第5个有效学习日发放阶段奖励且漏签不清零', () => {
  const monday = new Date(2026, 8, 7, 9, 0, 0).getTime();
  const h = harness(monday);
  for (let day = 0; day < 5; day += 1) {
    if (day > 0) h.setNow(monday + day * 24 * 60 * 60 * 1000);
    h.economy.startSession({ plannedMin: 10, mode: 'companion' });
    h.advance(10 * 60, 'focus');
    h.economy.endSession('planned');
  }
  const reasons = h.economy.ledger().map((r) => r.reason);
  assert.equal(reasons.filter((x) => x === 'weekly_three_days').length, 1);
  assert.equal(reasons.filter((x) => x === 'weekly_five_days').length, 1);
  assert.equal(reasons.filter((x) => x === 'daily_focus').length, 5);
});
