/* story.js — 陪伴剧情
 *
 * 这个文件归 ban-jiang。除了 home.js 里那一行 import，
 * 剧情相关的东西都写在这儿，不要去改 room.js / room.html ——
 * 那两个文件另一个人正在改，同时动一定冲突。
 *
 * 能用的东西只有三样，都从别的模块 import，不用改它们：
 *   TZRoom.on(事件, 回调)   订阅：session-start / session-end / react / state-change
 *   TZRoom.tell(文字, 选项)  让她说一句自定义台词（带口型和表情）
 *   recordStore / TZPoints  历史记录和点数
 *
 * 下面留了一个能跑的例子（久别重逢）和三个 TODO。
 * 详细说明见 docs/剧情开发对接.md
 */
'use strict';

import { recordStore } from './records.js';

const KEY = 'tongzhuo.story.v1';

/* 剧情自己的存档。别塞进 records 或 points 里 —— 各存各的，互不牵连。 */
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式 */ }
}

/** 距离上一次自习过了几天。没有记录就返回 null。 */
function daysSinceLast() {
  const all = recordStore.all();
  const days = Object.keys(all).sort();
  if (!days.length) return null;
  const last = days[days.length - 1];
  const [y, m, d] = last.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - then) / 86400000);
}

/** 累计自习了多少分钟 */
function totalMinutes() {
  const all = recordStore.all();
  let n = 0;
  for (const day in all) for (const r of all[day]) n += r.focusMin || 0;
  return n;
}

/* ---------------- 剧情条目 ----------------
 * 每条剧情就是一个 { id, when, play }：
 *   when()  返回 true 就该演
 *   play()  演出来
 * once: true 表示一辈子只演一次，演过就记在存档里。
 */
const BEATS = [
  {
    id: 'first_meet',
    once: true,
    when: (ctx) => ctx.evt === 'session-start' && totalMinutes() === 0,
    play: () => {
      // 延后一点，别和开场那句语音抢
      setTimeout(() => window.TZRoom.tell('第一次见，我叫……算了，你想怎么叫都行。',
        { recipe: 'gentleSmile', level: 0.6 }), 4200);
    }
  },
  {
    id: 'long_time_no_see',
    once: false,
    when: (ctx) => ctx.evt === 'session-start' && (daysSinceLast() ?? 0) >= 3,
    play: () => {
      const n = daysSinceLast();
      setTimeout(() => window.TZRoom.tell(`${n} 天没见了。桌子我一直没收。`,
        { recipe: 'gentleSmile', level: 0.5 }), 4200);
    }
  }

  // TODO(ban-jiang) 三个可以往下做的方向，详见 docs/剧情开发对接.md：
  //   1. 里程碑：累计专注满 60 / 300 / 1000 分钟各说一句
  //   2. 时段：深夜（23 点后）开场换一套更轻的台词
  //   3. 送东西：商店买了某件摆件后，下一场开场她"带来"并说一句
];

/* ---------------- 调度 ---------------- */
function fire(ctx) {
  const seen = load();
  for (const b of BEATS) {
    if (b.once && seen[b.id]) continue;
    let ok = false;
    try { ok = b.when(ctx); } catch (e) { console.error('[story]', b.id, e); }
    if (!ok) continue;
    if (b.once) { seen[b.id] = Date.now(); save(seen); }
    try { b.play(ctx); } catch (e) { console.error('[story]', b.id, e); }
    return;                  // 一次只演一条，别叠在一起说话
  }
}

export function initStory() {
  const R = window.TZRoom;
  if (!R || !R.on) { console.warn('[story] TZRoom 还没准备好'); return; }
  R.on('session-start', (d) => fire({ evt: 'session-start', ...d }));
  R.on('session-end', (d) => fire({ evt: 'session-end', ...d }));
  R.on('react', (d) => fire({ evt: 'react', ...d }));
  R.on('state-change', (d) => fire({ evt: 'state-change', ...d }));

  // 调试用：控制台里 TZStory.test('first_meet') 直接演一条
  window.TZStory = {
    beats: () => BEATS.map(b => b.id),
    seen: load,
    reset: () => { save({}); return '剧情存档已清空'; },
    test: (id) => {
      const b = BEATS.find(x => x.id === id);
      if (!b) return '没有这条：' + BEATS.map(x => x.id).join(', ');
      b.play({ evt: 'manual' });
      return '演了 ' + id;
    }
  };
}
