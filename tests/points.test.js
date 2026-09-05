'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Points, AWARD, COMPLETE_BONUS } = require('../renderer/points.js');

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
}

const make = (storage) => new Points({
  storage: storage || new MemoryStorage(),
  clock: () => new Date(2026, 8, 6, 10, 0, 0).getTime()
});

test('夸奖一次加 20', () => {
  const p = make();
  p.startSession({ plannedMin: 25 });
  p.award('praise');
  p.award('praise');
  const r = p.endSession('manual');
  assert.equal(r.counts.praise, 2);
  assert.equal(r.total, 40);
  assert.equal(p.snapshot().balance, 40);
});

test('玩手机和离席各扣 5', () => {
  const p = make();
  p.grant(100);
  p.startSession({ plannedMin: 25 });
  p.award('phone');
  p.award('away');
  const r = p.endSession('manual');
  assert.equal(r.total, -10);
  assert.equal(p.snapshot().balance, 90);
});

test('计划跑满且干净，拿 100 完成奖励', () => {
  const p = make();
  p.startSession({ plannedMin: 45 });
  p.award('praise');
  const r = p.endSession('planned');
  assert.equal(r.clean, true);
  assert.equal(r.total, 20 + COMPLETE_BONUS);
});

test('提前结束拿不到完成奖励', () => {
  const p = make();
  p.startSession({ plannedMin: 45 });
  p.award('praise');
  const r = p.endSession('manual');
  assert.equal(r.clean, false);
  assert.equal(r.missed, 'early');
  assert.equal(r.total, 20);
});

test('手机超过 3 次，跑满也拿不到完成奖励', () => {
  const p = make();
  p.grant(100);
  p.startSession({ plannedMin: 45 });
  for (let i = 0; i < 4; i++) p.award('phone');
  const r = p.endSession('planned');
  assert.equal(r.clean, false);
  assert.equal(r.missed, 'phone');
  assert.equal(r.total, -20);
});

test('手机正好 3 次仍算干净', () => {
  const p = make();
  p.startSession({ plannedMin: 45 });
  for (let i = 0; i < 3; i++) p.award('phone');
  const r = p.endSession('planned');
  assert.equal(r.clean, true);
  assert.equal(r.total, -15 + COMPLETE_BONUS);
});

test('离席超过 3 次也拿不到，且 missed 指出是离席', () => {
  const p = make();
  p.grant(100);
  p.startSession({ plannedMin: 45 });
  for (let i = 0; i < 4; i++) p.award('away');
  const r = p.endSession('planned');
  assert.equal(r.missed, 'away');
});

test('账户不为负：扣得比余额多时停在 0', () => {
  const p = make();
  p.grant(8);
  p.startSession({ plannedMin: 25 });
  for (let i = 0; i < 4; i++) p.award('phone');     // -20
  const r = p.endSession('manual');
  assert.equal(r.total, -20);
  assert.equal(r.applied, -8);                       // 只真的扣掉 8
  assert.equal(p.snapshot().balance, 0);
});

test('没有进行中的自习时 award 不记账', () => {
  const p = make();
  assert.equal(p.award('praise'), null);
  assert.equal(p.snapshot().balance, 0);
});

test('不认识的 kind 直接忽略，不静默记 0', () => {
  const p = make();
  p.startSession({ plannedMin: 25 });
  assert.equal(p.award('drowsy'), null);
  assert.equal(p.award('covered'), null);
  const r = p.endSession('planned');
  assert.equal(r.total, COMPLETE_BONUS);
});

test('结算明细四行齐全，金额对得上总数', () => {
  const p = make();
  p.startSession({ plannedMin: 60 });
  p.award('praise'); p.award('praise'); p.award('phone');
  const r = p.endSession('planned');
  assert.equal(r.lines.length, 4);
  assert.equal(r.lines.reduce((n, l) => n + l.amount, 0), r.total);
  assert.equal(r.total, 40 - 5 + COMPLETE_BONUS);
});

test('余额和已购在重新构造后仍在', () => {
  const storage = new MemoryStorage();
  const p = make(storage);
  p.grant(200);
  assert.equal(p.buy({ id: 'bg_x', price: 60 }).ok, true);
  const again = make(storage);
  assert.equal(again.snapshot().balance, 140);
  assert.equal(again.owns('bg_x'), true);
  assert.equal(again.buy({ id: 'bg_x', price: 60 }).ok, false);   // 不能重复买
});

test('余额不够不能买', () => {
  const p = make();
  p.grant(10);
  assert.equal(p.buy({ id: 'bg_y', price: 60 }).ok, false);
  assert.equal(p.snapshot().balance, 10);
});
