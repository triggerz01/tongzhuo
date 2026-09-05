/* records.js — 学习记录（日历）
 *
 * 视觉走 Persona 5 那一路：斜切、锯齿边、半调网点、重字重、错峰飞入。
 * 全部是 CSS 几何 —— 没有用任何图片素材，也没碰 Atlus 的字体。
 * 恰好我们的主色 #9E1B25 本来就是深红，这套风格不是硬套皮肤，
 * 是把已有的视觉基因放大。
 *
 * 数据先存 localStorage。一场自习结束就记一条，够用；
 * 以后要换 SQLite，只要替换 store 这一层。
 */
'use strict';

const KEY = 'tongzhuo.records.v1';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/* ---------------- 存储 ---------------- */
const store = {
  all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch (e) { return {}; }
  },
  save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式等 */ }
  },
  /** 记一场自习。date 用本地日期，不用 UTC，跨天才不会错 */
  add(rec) {
    const d = new Date(rec.endedAt || Date.now());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const data = this.all();
    (data[key] || (data[key] = [])).push(rec);
    this.save(data);
    return key;
  },
  ofDay(key) { return this.all()[key] || []; },
  monthStats(y, m) {
    const data = this.all();
    const out = {};
    for (const k in data) {
      const [yy, mm] = k.split('-').map(Number);
      if (yy === y && mm === m + 1) {
        const list = data[k];
        out[k] = {
          count: list.length,
          minutes: list.reduce((s, r) => s + (r.focusMin || 0), 0)
        };
      }
    }
    return out;
  }
};

/* ---------------- 日历 ---------------- */
let cur = new Date();
let selected = null;

const dayKey = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function renderCalendar() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const stats = store.monthStats(y, m);
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === y && today.getMonth() === m;

  document.getElementById('recMonth').textContent = `${y}.${String(m + 1).padStart(2, '0')}`;

  const total = Object.values(stats).reduce((s, v) => s + v.minutes, 0);
  const times = Object.values(stats).reduce((s, v) => s + v.count, 0);
  document.getElementById('recTotalMin').textContent = total;
  document.getElementById('recTotalTimes').textContent = times;
  document.getElementById('recTotalDays').textContent = Object.keys(stats).length;

  const grid = document.getElementById('recGrid');
  grid.innerHTML = '';

  WEEK.forEach((w, i) => {
    const el = document.createElement('div');
    el.className = 'p5-wd' + (i === 0 || i === 6 ? ' end' : '');
    el.textContent = w;
    grid.appendChild(el);
  });

  for (let i = 0; i < first; i++) {
    const pad = document.createElement('div');
    pad.className = 'p5-cell pad';
    grid.appendChild(pad);
  }

  for (let d = 1; d <= days; d++) {
    const key = dayKey(y, m, d);
    const st = stats[key];
    const cell = document.createElement('button');
    cell.className = 'p5-cell'
      + (st ? ' has' : '')
      + (isThisMonth && d === today.getDate() ? ' today' : '')
      + (key === selected ? ' sel' : '');
    // 每格给一点随机的斜度，整齐里带点手作感 —— 全都一样反而假
    cell.style.setProperty('--tilt', (Math.random() * 1.6 - 0.8).toFixed(2) + 'deg');
    cell.style.animationDelay = (d * 12) + 'ms';
    cell.innerHTML = `<span class="n">${d}</span>` +
      (st ? `<span class="badge">${st.count}</span><span class="min">${st.minutes}′</span>` : '');
    cell.addEventListener('click', () => selectDay(key));
    grid.appendChild(cell);
  }
}

function selectDay(key) {
  selected = key;
  renderCalendar();
  const list = store.ofDay(key);
  const panel = document.getElementById('recDetail');
  const [y, m, d] = key.split('-').map(Number);
  document.getElementById('recDayTitle').innerHTML =
    `<b>${m}.${String(d).padStart(2, '0')}</b><small>星期${WEEK[new Date(y, m - 1, d).getDay()]}</small>`;

  const box = document.getElementById('recDayList');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="empty">这天没有记录。</p>';
  } else {
    list.forEach((r, i) => {
      const t = new Date(r.endedAt);
      const row = document.createElement('div');
      row.className = 'p5-rec';
      row.style.animationDelay = (i * 60) + 'ms';
      row.innerHTML = `
        <span class="tm">${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span>
        <span class="mi"><b>${r.focusMin || 0}</b>分钟</span>
        <span class="pl">${r.scene || '自习室'}</span>
        <span class="tag ${r.reason === 'planned' ? 'ok' : 'mid'}">${r.reason === 'planned' ? '完成' : '提前结束'}</span>`;
      box.appendChild(row);
    });
  }
  panel.classList.add('on');
}

/* ---------------- 装配 ---------------- */
function open() {
  selected = null;
  cur = new Date();
  renderCalendar();
  document.getElementById('recDetail').classList.remove('on');
  document.getElementById('records').classList.add('on');
  document.getElementById('home').classList.remove('on');
}

function close() {
  document.getElementById('records').classList.remove('on');
  document.getElementById('home').classList.add('on');
}

function shiftMonth(n) {
  cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
  selected = null;
  document.getElementById('recDetail').classList.remove('on');
  renderCalendar();
}

export function initRecords() {
  document.getElementById('btnRecords').addEventListener('click', open);
  document.getElementById('recBack').addEventListener('click', close);
  document.getElementById('recPrev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('recNext').addEventListener('click', () => shiftMonth(1));
  document.getElementById('recDetailClose').addEventListener('click',
    () => document.getElementById('recDetail').classList.remove('on'));
}

export { store as recordStore };
