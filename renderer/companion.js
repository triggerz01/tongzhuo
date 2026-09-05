/* companion.js — 同行模式的界面：角色页 / 剧情页 / 共同相册
 *
 * 数据和规则在 bond.js，这里只管画。
 *
 * 三个界面的关系：
 *   设置页点她      → 角色页（立绘 + 简介 + 一起坐过多久 + 剧情时间轴）
 *   点"选择与她同行" → 存下选择，回主界面
 *   进入自习室之前   → 有没读的章节就先播剧情页，播完出 CG，再进房间
 *   主界面「共同相册」→ 画廊，按角色分区，只放已解锁的
 */
'use strict';

import * as bond from './bond.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let show = null;              // home.js 的界面切换
let current = 'yining';       // 当前在看谁

/* ---------------- 共同相册 ---------------- */
function renderGallery() {
  const box = $('galBody');
  box.innerHTML = '';
  let total = 0;

  for (const key in bond.CAST_BOND) {
    const who = bond.CAST_BOND[key];
    const got = bond.unlockedCGs(key);
    total += got.length;

    const head = document.createElement('div');
    head.className = 'galWho';
    head.innerHTML = `<b>${who.name}</b><small>${got.length} / ${bond.CHAPTERS.length}</small>`;
    box.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'galGrid';
    if (!got.length) {
      // 没解锁的不显示 —— 露出一排锁反而像在催你
      grid.innerHTML = '<div class="galEmpty">还没有和她一起走到任何一段。<br>'
                     + '在同行模式下和她自习，剧情会自己往前走。</div>';
    } else {
      got.forEach((c, i) => {
        const n = bond.CHAPTERS.findIndex(x => x.id === c.id) + 1;
        const b = document.createElement('button');
        b.className = 'cgCard';
        b.style.animationDelay = (i * 55) + 'ms';
        b.innerHTML = `<img src="../assets/cg/${c.cg}.jpg" alt="">
                       <span class="no">${String(n).padStart(2, '0')}</span>
                       <span class="nm">${c.title}</span>`;
        b.addEventListener('click', () => openCG(c, n));
        grid.appendChild(b);
      });
    }
    box.appendChild(grid);
  }
  $('galCount').textContent = total;
}

function openCG(c, n) {
  $('cgViewImg').src = `../assets/cg/${c.cg}.jpg`;
  $('cgViewCap').innerHTML = `<b>${String(n).padStart(2, '0')}</b>${c.title}`;
  $('cgView').classList.add('on');
}
const closeCG = () => $('cgView').classList.remove('on');

/* ---------------- 角色页 ---------------- */
export function openPersona(key) {
  current = key;
  const who = bond.CAST_BOND[key];
  if (!who) return;
  const b = bond.get(key);
  const stage = bond.stageOf(b.focusMin);
  const gap = bond.nextGap(b.focusMin);

  $('personaMo').textContent = '同行';
  $('personaImg').src = who.portrait;

  const hours = Math.floor(b.focusMin / 60);
  const mins = b.focusMin % 60;
  const timeText = hours ? `${hours} 小时 ${mins} 分` : `${mins} 分钟`;

  $('personaInfo').innerHTML = `
    <h3>${who.name}</h3>
    <span class="tag">${who.tag}</span>
    <p>${who.intro}</p>
    <p class="why">${who.why}</p>

    <div class="pStats">
      <div class="q"><span class="v">${b.focusMin}</span><span class="u">分钟</span>
        <span class="k">一起专注过</span></div>
      <div class="q"><span class="v">${stage}</span><span class="u">/ ${bond.CHAPTERS.length}</span>
        <span class="k">剧情进度</span></div>
      <div class="q"><span class="v">${b.cgs.length}</span><span class="u">张</span>
        <span class="k">共同回忆</span></div>
    </div>

    <h5>你们走到哪儿了</h5>
    <div class="tlineWrap">
      ${timeline(b, stage)}
      <p id="tlineNow">${
        gap ? `再一起专注 <b>${gap.need}</b> 分钟，第 ${bond.CHAPTERS.indexOf(gap.chapter) + 1} 章会开始。`
            : '第一季已经走完了。<b>' + timeText + '</b>，都是真的坐出来的。'
      }</p>
    </div>
  `;
  if (show) show('persona');
}

/** 时间轴：菱形节点 + 中间连线，解锁的点亮，没解锁的挂锁 */
function timeline(b, stage) {
  const parts = [];
  bond.CHAPTERS.forEach((c, i) => {
    const on = b.seen.includes(c.id);
    const reached = b.focusMin >= c.at;
    if (i) parts.push(`<span class="seg${reached ? ' on' : ''}"></span>`);
    parts.push(
      `<span class="tnode${on ? ' on' : ''}" title="${on ? c.title : '还没解锁'}">
         <i><span>${on ? (i + 1) : '🔒'}</span></i>
         <em>${on ? c.title : c.at + '分'}</em>
       </span>`);
  });
  return `<div class="tline">${parts.join('')}</div>`;
}

/* ---------------- 剧情页 ---------------- */
/**
 * 播一章。文字逐段落下，读完出「继续」，点了之后全屏 CG 停 5 秒再淡出。
 * @returns Promise，播完才 resolve —— 调用方 await 它，然后才进自习室
 */
export async function playChapter(c) {
  const n = bond.CHAPTERS.findIndex(x => x.id === c.id) + 1;
  $('stChapter').textContent = 'CHAPTER ' + String(n).padStart(2, '0');
  $('stName').textContent = c.title;
  const box = $('stText');
  box.innerHTML = '';
  box.scrollTop = 0;
  $('stOk').classList.remove('on');
  $('stHint').textContent = '正在讲述…';
  $('storyView').classList.add('on');

  await sleep(500);
  // 一段一段落下。太长的话用户可以自己往上翻，所以不强制滚到底。
  for (let i = 0; i < c.text.length; i++) {
    const t = c.text[i];
    const p = document.createElement('p');
    if (t === '——') p.className = 'hr';
    else if (/^[「"]/.test(t)) p.className = 'q';
    p.textContent = t;
    box.appendChild(p);
    // 只有当用户没有自己往上翻时才跟着滚
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    if (atBottom) box.scrollTop = box.scrollHeight;
    await sleep(Math.min(2000, 550 + t.length * 55));
  }
  $('stHint').textContent = '读完了可以往上翻';
  $('stOk').classList.add('on');

  await new Promise((done) => {
    const ok = $('stOk');
    const fn = () => { ok.removeEventListener('click', fn); done(); };
    ok.addEventListener('click', fn);
  });

  // ---- 全屏 CG ----
  $('storyView').classList.remove('on');
  $('cgShowImg').src = `../assets/cg/${c.cg}.jpg`;
  $('cgShowName').textContent = c.title;
  $('cgShow').classList.add('on');
  await sleep(60);
  $('cgShow').classList.add('in');
  await sleep(5000);
  $('cgShow').classList.remove('in');
  await sleep(600);
  $('cgShow').classList.remove('on');

  bond.markRead(current, c.id);
}

/** 进自习室之前叫一次：有没读的章节就先播完。没有就直接过。 */
export async function playPendingBefore(key) {
  current = key || current;
  const c = bond.pendingChapter(current);
  if (!c) return null;
  await playChapter(c);
  return c;
}

/* ---------------- 装配 ---------------- */
export function initCompanion(showFn, onPick) {
  show = showFn;

  $('btnGallery').addEventListener('click', () => { renderGallery(); show('gallery'); });
  $('galBack').addEventListener('click', () => show('home'));
  $('cgClose').addEventListener('click', closeCG);
  $('cgView').addEventListener('click', (e) => { if (e.target === $('cgView')) closeCG(); });

  $('personaBack').addEventListener('click', () => show('settings'));
  $('btnBondGo').addEventListener('click', () => { if (onPick) onPick(current); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('cgView').classList.contains('on')) closeCG();
  });

  // 调试出口
  window.TZBond = {
    ...bond,
    persona: openPersona,
    play: (id) => playChapter(bond.CHAPTERS.find(c => c.id === id)),
    gallery: () => { renderGallery(); show('gallery'); }
  };
}

export { renderGallery };
