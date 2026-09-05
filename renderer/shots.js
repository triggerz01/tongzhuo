/* shots.js — 抓拍留存
 *
 * 触发手机提醒时抓一张，存进当天的学习记录里。
 *
 * 单独一个 localStorage key，不跟记录混在一起：
 * 图片是 base64，一张十几 KB，混进 records 里会把那份数据撑得很大，
 * 而且删照片时还得去改记录。分开存，记录里只留一个 id。
 *
 * 七天自动删。留证是为了让你自己回看，不是建档案 ——
 * 每次启动和每次写入都顺手清一遍过期的。
 */
'use strict';

const KEY = 'tongzhuo.shots.v1';
const KEEP_DAYS = 7;
const MAX_TOTAL = 60;          // 兜底：localStorage 有配额，别撑爆

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}

function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (e) {
    // 配额满了：把最老的一天丢掉再试一次，实在不行就算了
    const days = Object.keys(data).sort();
    if (days.length > 1) { delete data[days[0]]; save(data); }
    else console.warn('[shots] 存不下，放弃这张');
  }
}

/** 删掉超过 KEEP_DAYS 天的；顺带压一下总量 */
export function prune() {
  const data = load();
  const cutoff = dayKey(Date.now() - KEEP_DAYS * 86400000);
  let changed = false;
  for (const k of Object.keys(data)) {
    if (k < cutoff) { delete data[k]; changed = true; }      // 日期串按字典序就是按时间序
  }
  let total = Object.values(data).reduce((n, a) => n + a.length, 0);
  const days = Object.keys(data).sort();
  while (total > MAX_TOTAL && days.length) {
    const d = days[0];
    const drop = data[d].length;
    delete data[d];
    days.shift();
    total -= drop;
    changed = true;
  }
  if (changed) save(data);
  return data;
}

/**
 * 存一张。
 * @param dataUrl  data:image/jpeg;base64,...
 * @param meta     { kind, at }  at 是时间戳
 * @returns 这张的 id，写进记录的事件里
 */
export function add(dataUrl, meta) {
  const at = (meta && meta.at) || Date.now();
  const day = dayKey(at);
  const id = `${at}-${Math.random().toString(36).slice(2, 7)}`;
  const data = prune();
  (data[day] || (data[day] = [])).push({
    id, at, kind: (meta && meta.kind) || 'phone', src: dataUrl
  });
  save(data);
  return id;
}

/** 按 id 取一张。过期删掉之后取不到是正常的 —— 调用方要能接受 null */
export function get(id) {
  const data = load();
  for (const day in data) {
    const hit = data[day].find(s => s.id === id);
    if (hit) return hit;
  }
  return null;
}

/** 某一天的全部抓拍 */
export function ofDay(key) { return load()[key] || []; }

export function clear() {
  try { localStorage.removeItem(KEY); } catch (e) { /* 隐私模式 */ }
}

export const stats = () => {
  const data = load();
  return { days: Object.keys(data).length,
           total: Object.values(data).reduce((n, a) => n + a.length, 0) };
};
