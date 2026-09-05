/* settle.js — 一场自习的结算页
 *
 * 收工之后先看这个，再回主界面。原来那个 #homeSummary 只有三个数字，
 * 撑不起"这一场值不值"这句话。
 *
 * 动画分三拍，刻意有先后：
 *   1 专注时长的大数字从 0 滚上去
 *   2 三根柱子从零长出来（专注 / 离席 / 手机）
 *   3 点数明细一行一行落，最后合计数字滚动
 * 一次性全出来就没有"结算"的感觉了，像张静态报表。
 */
'use strict';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MISS_TEXT = {
  early: '提前结束了，这次没有完成奖励。',
  phone: '手机被提醒超过 3 次，完成奖励没拿到。',
  away:  '离席过久超过 3 次，完成奖励没拿到。',
  other: '这次没有拿到完成奖励。'
};

/** 数字滚动。时长短一点，别让人等 */
function rollNumber(el, to, ms) {
  const from = 0;
  const t0 = performance.now();
  return new Promise((done) => {
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = (to < 0 ? '-' : '') + Math.round(Math.abs(from + (to - from) * ease));
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

let onDone = null;

export function initSettle(next) {
  onDone = next;
  $('btnSettleOk').addEventListener('click', () => {
    $('settle').classList.remove('on');
    if (onDone) onDone();
  });
}

export async function showSettle(s) {
  // 调参用：控制台里 __settle(假数据) 就能直接看构图，不用真跑一场
  if (typeof window !== 'undefined') window.__settle = showSettle;
  const pts = s.points;
  const el = $('settle');

  $('settleTitle').textContent =
    s.reason === 'planned' ? '今天的量完成了' : '这一场结束了';
  $('settleSub').textContent =
    `计划 ${s.plannedMin} 分钟 · 实际 ${s.elapsedMin} 分钟`;
  // 收工那句话在这儿显示 —— 语音正在放，字幕得跟上
  const q = $('settleLine');
  q.textContent = s.line || '';
  q.style.display = s.line ? '' : 'none';

  // --- 归零，等下一拍一拍放 ---
  $('settleMin').textContent = '0';
  $('settleAway').textContent = '0';
  $('settlePhone').textContent = '0';
  $('settleTotal').textContent = '0';
  $('settleTotal').className = '';
  $('settleLines').innerHTML = '';
  $('settleNote').textContent = '';
  $('settleNote').style.display = 'none';
  document.querySelectorAll('#settleBars i').forEach(b => { b.style.width = '0%'; });
  el.classList.add('on');

  await sleep(320);

  // 1 大数字
  await rollNumber($('settleMin'), s.focusMin || 0, 620);
  $('settleAway').textContent = s.awayCount || 0;
  $('settlePhone').textContent = (pts ? pts.counts.phone : s.distractCount) || 0;

  // 2 柱子
  await sleep(120);
  const whole = Math.max(1, (s.focusMin || 0) + (s.awayMin || 0) + (s.phoneMin || 0));
  const pct = (v) => Math.round((v || 0) / whole * 100);
  $('barFocus').style.width = pct(s.focusMin) + '%';
  $('barAway').style.width  = pct(s.awayMin) + '%';
  $('barPhone').style.width = pct(s.phoneMin) + '%';
  $('barFocusV').textContent = (s.focusMin || 0) + '′';
  $('barAwayV').textContent  = (s.awayMin || 0) + '′';
  $('barPhoneV').textContent = (s.phoneMin || 0) + '′';

  if (!pts) return;

  // 3 点数明细，一行一行落
  await sleep(520);
  const box = $('settleLines');
  for (const line of pts.lines) {
    if (!line.n && !line.amount) continue;          // 没发生的事不占一行
    const row = document.createElement('div');
    row.className = 'sline ' + (line.amount >= 0 ? 'plus' : 'minus');
    row.innerHTML =
      `<span class="lb">${line.label}</span>` +
      `<span class="n">${line.key === 'complete' ? '' : '× ' + line.n}</span>` +
      `<span class="amt">${line.amount >= 0 ? '+' : ''}${line.amount}</span>`;
    box.appendChild(row);
    await sleep(170);
  }

  if (pts.missed && MISS_TEXT[pts.missed]) {
    $('settleNote').textContent = MISS_TEXT[pts.missed];
    $('settleNote').style.display = '';
  }

  await sleep(200);
  const total = $('settleTotal');
  total.className = pts.total >= 0 ? 'plus' : 'minus';
  await rollNumber(total, pts.total, 700);
  $('settleBalance').textContent = pts.balance;

  // 实际扣的比账面少（扣到 0 停了），得说一声，不然用户以为算错了
  if (pts.applied !== pts.total) {
    $('settleNote').textContent =
      (pts.missed && MISS_TEXT[pts.missed] ? MISS_TEXT[pts.missed] + ' ' : '') +
      `余额不够扣，实际只扣了 ${Math.abs(pts.applied)} 点。`;
    $('settleNote').style.display = '';
  }
}
