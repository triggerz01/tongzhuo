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
  /** 整月的记录摊平成一条条，做月度总结用 */
  monthList(y, m) {
    const data = this.all(); const out = [];
    for (const k in data) {
      const [yy, mm] = k.split('-').map(Number);
      if (yy === y && mm === m + 1) out.push(...data[k].map(r => ({ ...r, day: k })));
    }
    return out.sort((a, b) => a.endedAt - b.endedAt);
  },
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
      row.addEventListener('click', () => showSession(r));
      box.appendChild(row);
    });
  }
  panel.classList.add('on');
}


/* ---------------- 单场详情 ----------------
 * 一场自习里"发生过什么"，比"学了多久"更有说服力：
 * 手机被提醒了三次，这条信息用户是记得住的。
 */
const KIND = {
  phone:   { cn: '玩手机',    cls: 'bad' },
  away:    { cn: '离席过久',  cls: 'bad' },
  drowsy:  { cn: '犯困',      cls: 'warn' },
  covered: { cn: '看不清你',  cls: 'warn' },
  backturn:{ cn: '背对镜头',  cls: 'warn' },
  praise:  { cn: '专注达标',  cls: 'good' },
  back:    { cn: '回到座位',  cls: 'good' }
};

const mmss = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

const countKind = (list, k) =>
  list.reduce((s, r) => s + (r.events || []).filter(e => e.kind === k).length, 0);

function showSession(r) {
  const t = new Date(r.endedAt);
  const elapsed = r.elapsedMin || r.focusMin || 0;
  const pct = (v) => elapsed ? Math.min(100, Math.round(v / elapsed * 100)) : 0;
  const evs = (r.events || []).filter(e => KIND[e.kind]);
  const n = (k) => countKind([r], k);

  document.getElementById('recSessionTitle').innerHTML =
    `<b>${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</b>` +
    `<small>${r.scene || '自习室'} · 计划 ${r.plannedMin || '—'} 分钟 · ` +
    `${r.reason === 'planned' ? '完成' : '提前结束'}</small>`;

  document.getElementById('recSessionBody').innerHTML = `
    <div class="p5big">
      <span class="v">${r.focusMin || 0}</span><span class="u">分钟专注</span>
      <span class="sub">这一场从开始到结束共 ${elapsed} 分钟</span>
    </div>

    <div class="p5bars">
      <div class="bar"><span class="lb">专注</span>
        <span class="tr"><i class="f-focus" style="width:${pct(r.focusMin || 0)}%"></i></span>
        <span class="vv">${r.focusMin || 0}&prime;</span></div>
      <div class="bar"><span class="lb">离席</span>
        <span class="tr"><i class="f-away" style="width:${pct(r.awayMin || 0)}%"></i></span>
        <span class="vv">${r.awayMin || 0}&prime;</span></div>
      <div class="bar"><span class="lb">手机</span>
        <span class="tr"><i class="f-phone" style="width:${pct(r.phoneMin || 0)}%"></i></span>
        <span class="vv">${r.phoneMin || 0}&prime;</span></div>
    </div>

    <h5>被提醒了几次</h5>
    <div class="p5chips">
      <span class="chip ${n('phone') ? 'bad' : ''}">玩手机 <b>${n('phone')}</b></span>
      <span class="chip ${n('away') ? 'bad' : ''}">离席过久 <b>${n('away')}</b></span>
      <span class="chip ${n('drowsy') ? 'warn' : ''}">犯困 <b>${n('drowsy')}</b></span>
      <span class="chip ${n('praise') ? 'good' : ''}">被夸 <b>${n('praise')}</b></span>
    </div>

    <h5>发生了什么</h5>
    ${evs.length ? `<div class="p5tl">${evs.map((e, i) => `
      <div class="ev ${KIND[e.kind].cls}" style="animation-delay:${i * 45}ms">
        <span class="at">${mmss(e.t)}</span>
        <span class="wh">${KIND[e.kind].cn}</span>
        <span class="dr">${e.dur ? '持续 ' + e.dur + 's' : ''}</span>
      </div>`).join('')}</div>`
    : '<p class="empty">这一场很安稳，一次都没被打断。</p>'}
  `;
  document.getElementById('recSession').classList.add('on');
}

/* ---------------- 月度总结 ---------------- */
function showSummary() {
  const y = cur.getFullYear(), m = cur.getMonth();
  const list = store.monthList(y, m);
  const days = new Date(y, m + 1, 0).getDate();

  const sum = (f) => list.reduce((s, r) => s + (r[f] || 0), 0);
  const focus = sum('focusMin'), away = sum('awayMin'), phone = sum('phoneMin');
  const whole = focus + away + phone;
  const share = (v) => whole ? v / whole * 100 : 0;

  const dayMap = {};
  list.forEach((r) => {
    const d = Number(r.day.split('-')[2]);
    dayMap[d] = (dayMap[d] || 0) + (r.focusMin || 0);
  });
  const maxDay = Math.max(1, ...Object.values(dayMap), 1);
  const best = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('recSumTitle').innerHTML =
    `<b>${y}.${String(m + 1).padStart(2, '0')}</b><small>本月总结</small>`;

  document.getElementById('recSumBody').innerHTML = list.length ? `
    <div class="p5grid4">
      <div class="q"><span class="v">${focus}</span><span class="u">分钟</span><span class="k">总专注</span></div>
      <div class="q"><span class="v">${list.length}</span><span class="u">场</span><span class="k">自习次数</span></div>
      <div class="q"><span class="v">${Object.keys(dayMap).length}</span><span class="u">天</span><span class="k">有记录</span></div>
      <div class="q"><span class="v">${Math.round(focus / list.length)}</span><span class="u">分钟</span><span class="k">场均</span></div>
    </div>

    <h5>每天学了多久</h5>
    <div class="p5days">${Array.from({ length: days }, (_, i) => {
      const d = i + 1, v = dayMap[d] || 0;
      return `<span class="d${v ? ' on' : ''}" title="${d} 日 · ${v} 分钟">` +
             `<i style="height:${v ? Math.max(8, v / maxDay * 100) : 3}%"></i>` +
             (d % 5 === 0 ? `<em>${d}</em>` : '') + '</span>';
    }).join('')}</div>

    <h5>被打断了几次</h5>
    <div class="p5chips">
      <span class="chip ${countKind(list, 'phone') ? 'bad' : ''}">玩手机 <b>${countKind(list, 'phone')}</b></span>
      <span class="chip ${countKind(list, 'away') ? 'bad' : ''}">离席过久 <b>${countKind(list, 'away')}</b></span>
      <span class="chip ${countKind(list, 'drowsy') ? 'warn' : ''}">犯困 <b>${countKind(list, 'drowsy')}</b></span>
      <span class="chip ${countKind(list, 'praise') ? 'good' : ''}">被夸 <b>${countKind(list, 'praise')}</b></span>
    </div>

    <h5>时间都去哪了</h5>
    <div class="p5bars">
      <div class="bar"><span class="lb">专注</span>
        <span class="tr"><i class="f-focus" style="width:${share(focus)}%"></i></span>
        <span class="vv">${focus}&prime;</span></div>
      <div class="bar"><span class="lb">离席</span>
        <span class="tr"><i class="f-away" style="width:${share(away)}%"></i></span>
        <span class="vv">${away}&prime;</span></div>
      <div class="bar"><span class="lb">手机</span>
        <span class="tr"><i class="f-phone" style="width:${share(phone)}%"></i></span>
        <span class="vv">${phone}&prime;</span></div>
    </div>

    ${best ? `<p class="note">最猛的一天是 <b>${best[0]} 号</b>，专注了 <b>${best[1]}</b> 分钟。</p>` : ''}
  ` : '<p class="empty">这个月还没有记录。去开一场自习吧。</p>';

  document.getElementById('recSummary').classList.add('on');
}


/* ---------------- 演示数据 ----------------
 * 空日历没法讲故事，但也不该把假记录混进真数据里。
 * 所以放在控制台手动调用，且用固定种子——每次演示长得一样。
 *   TZRecords.demo()   铺一个月
 *   TZRecords.clear()  清干净
 */
function demoData() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const scenes = ['自习室夜', '图书馆', '咖啡馆', '书房'];
  const kinds = ['phone', 'away', 'drowsy', 'praise', 'back', 'covered'];
  let seed = 42;
  const R = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const data = {};
  [2, 3, 5, 6, 9, 10, 12, 13, 16, 17, 19, 20, 23, 24, 26, 27].forEach((d) => {
    if (d > now.getDate()) return;
    const key = dayKey(y, m, d);
    data[key] = [];
    for (let i = 0, n = 1 + Math.floor(R() * 2); i < n; i++) {
      const planned = [25, 45, 60, 90][Math.floor(R() * 4)];
      const elapsed = Math.round(planned * (0.6 + R() * 0.4));
      const away = Math.round(R() * 6), phone = Math.round(R() * 8), drowsy = Math.round(R() * 3);
      const events = [];
      for (let e = 0, c = Math.floor(R() * 6); e < c; e++) {
        events.push({ t: Math.round(R() * elapsed * 60),
                      kind: kinds[Math.floor(R() * kinds.length)],
                      dur: Math.round(30 + R() * 180) });
      }
      events.sort((a, b) => a.t - b.t);
      const end = new Date(y, m, d, 9 + Math.floor(R() * 11), Math.floor(R() * 60)).getTime();
      data[key].push({
        endedAt: end, startedAt: end - elapsed * 60000,
        elapsedMin: elapsed, focusMin: Math.max(1, elapsed - away - phone),
        awayMin: away, phoneMin: phone, drowsyMin: drowsy, plannedMin: planned,
        awayCount: events.filter(e => e.kind === 'away').length,
        distractCount: events.filter(e => e.kind === 'phone').length,
        events, reason: elapsed >= planned ? 'planned' : 'manual',
        scene: scenes[Math.floor(R() * 4)]
      });
    }
  });
  return data;
}

window.TZRecords = {
  demo() { store.save(demoData()); renderCalendar(); return '已铺演示数据'; },
  clear() { store.save({}); selected = null;
            document.getElementById('recDetail').classList.remove('on');
            renderCalendar(); return '已清空'; }
};

/* ---------------- 装配 ---------------- */
function open() {
  selected = null;
  cur = new Date();
  renderCalendar();
  document.getElementById('recDetail').classList.remove('on');
  document.getElementById('recSession').classList.remove('on');
  document.getElementById('recSummary').classList.remove('on');
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
  document.getElementById('recSummary').classList.remove('on');
  renderCalendar();
}

export function initRecords() {
  document.getElementById('btnRecords').addEventListener('click', open);
  document.getElementById('recBack').addEventListener('click', close);
  document.getElementById('recPrev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('recNext').addEventListener('click', () => shiftMonth(1));
  document.getElementById('recDetailClose').addEventListener('click',
    () => document.getElementById('recDetail').classList.remove('on'));
  document.getElementById('recSumBtn').addEventListener('click', showSummary);
  // 弹层：点关闭、点背景、按 Esc 都能退出
  ['recSession', 'recSummary'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('on'); });
  });
  document.getElementById('recSessionClose').addEventListener('click',
    () => document.getElementById('recSession').classList.remove('on'));
  document.getElementById('recSumClose').addEventListener('click',
    () => document.getElementById('recSummary').classList.remove('on'));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.getElementById('recSession').classList.remove('on');
    document.getElementById('recSummary').classList.remove('on');
  });
}

export { store as recordStore };
