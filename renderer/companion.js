/* companion.js — 同行模式的界面：角色页 / 剧情页 / 共同相册
 *
 * 数据和规则在 bond.js，这里只管画。
 *
 * 三个界面的关系：
 *   设置页点她      → 角色页（立绘 + 简介 + 一起坐过多久 + 剧情时间轴）
 *   点"选择与她同行" → 存下选择，回主界面
 *   进入自习室之前   → 把所有欠着的章节连着播完，再进房间
 *   点时间轴上亮着的节点 → 问一句，然后重看那一段
 *   主界面「共同相册」→ 画廊，按角色分区，只放已解锁的
 */
'use strict';

import * as bond from './bond.js';

const $ = (id) => document.getElementById(id);

let show = null;              // home.js 的界面切换
let current = 'yining';       // 当前在看谁

/* ---------------- 可打断的等待 ----------------
 * 剧情靠一串 sleep 推进。跳过按钮要立刻生效，就不能用普通的 setTimeout ——
 * 那样最长要等一句话念完（两秒）才反应，按下去没动静的两秒足够让人再按一次。
 */
let skipping = false;
let waiters = [];

function nap(ms) {
  return new Promise((res) => {
    if (skipping) return res();
    const done = () => { clearTimeout(t); pull(); res(); };
    const t = setTimeout(() => { pull(); res(); }, ms);
    const pull = () => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); };
    waiters.push(done);
  });
}

/** 等一次点击，跳过也算结束 */
function waitClick(el) {
  return new Promise((res) => {
    if (skipping) return res();
    const fin = () => { el.removeEventListener('click', fin); pull(); res(); };
    const pull = () => { const i = waiters.indexOf(fin); if (i >= 0) waiters.splice(i, 1); };
    el.addEventListener('click', fin);
    waiters.push(fin);
  });
}

function doSkip() {
  skipping = true;
  waiters.splice(0).forEach(fn => { try { fn(); } catch (e) {} });
}

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
  current = key || current;
  const who = bond.CAST_BOND[current];
  if (!who) return;
  const b = bond.get(current);
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
      ${timeline(b)}
      <p id="tlineNow">${
        gap ? `再一起专注 <b>${gap.need}</b> 分钟，第 ${bond.CHAPTERS.indexOf(gap.chapter) + 1} 章会开始。`
            : `第一季已经走完了。<b>${timeText}</b>，都是真的坐出来的。`
      }<span class="tip">点亮着的节点可以重看那一段。</span></p>
    </div>
  `;

  // 亮着的节点可以点开重看
  $('personaInfo').querySelectorAll('.tnode.on').forEach((el) => {
    el.addEventListener('click', () => askReview(el.dataset.ch));
  });

  if (show) show('persona');
}

/** 时间轴：菱形节点 + 中间连线。标签统一用分钟数 ——
 *  解锁后换成长标题会横向撞在一起，还会压住下面那行字。 */
function timeline(b) {
  const parts = [];
  bond.CHAPTERS.forEach((c, i) => {
    const on = b.seen.includes(c.id);
    const reached = b.focusMin >= c.at;
    if (i) parts.push(`<span class="seg${reached ? ' on' : ''}"></span>`);
    parts.push(
      `<span class="tnode${on ? ' on' : ''}" data-ch="${c.id}"
             title="${on ? '第 ' + (i + 1) + ' 章 · ' + c.title + '（点击重看）' : '还没解锁'}">
         <i><span>${on ? (i + 1) : '🔒'}</span></i>
         <em>${c.at}分</em>
       </span>`);
  });
  return `<div class="tline">${parts.join('')}</div>`;
}

/* ---------------- 回顾 ---------------- */
let reviewTarget = null;

function askReview(chId) {
  const c = bond.CHAPTERS.find(x => x.id === chId);
  if (!c) return;
  reviewTarget = c;
  const n = bond.CHAPTERS.indexOf(c) + 1;
  $('reviewTitle').textContent = `第 ${n} 章 · ${c.title}`;
  $('reviewText').textContent = '要重看这一段吗？看完回到这里。';
  $('reviewAsk').classList.add('on');
}

const closeReview = () => { $('reviewAsk').classList.remove('on'); reviewTarget = null; };

async function doReview() {
  const c = reviewTarget;
  $('reviewAsk').classList.remove('on');
  reviewTarget = null;
  if (!c) return;
  await playChapters([c], { mark: false });     // 已经读过了，不用再记
  openPersona(current);                         // 回到角色页
}

/* ---------------- 剧情播放 ---------------- */
/**
 * 连着播一串章节。中途按跳过就全部略过 ——
 * 略过的章节照样记成已读、CG 照样进相册，只是不看了。
 *
 * @param list  章节数组
 * @param opts.mark  是否记为已读（回顾时不用）
 */
export async function playChapters(list, opts) {
  const o = opts || {};
  const mark = o.mark !== false;
  if (!list || !list.length) return [];

  skipping = false;
  const played = [];

  for (const c of list) {
    if (!skipping) await playOne(c);
    if (mark) bond.markRead(current, c.id);     // 跳过也解锁，只是没看
    played.push(c);
  }

  $('storyView').classList.remove('on');
  $('cgShow').classList.remove('on', 'in');
  skipping = false;
  return played;
}

async function playOne(c) {
  const n = bond.CHAPTERS.findIndex(x => x.id === c.id) + 1;
  $('stChapter').textContent = 'CHAPTER ' + String(n).padStart(2, '0');
  $('stName').textContent = c.title;
  const box = $('stText');
  box.innerHTML = '';
  box.scrollTop = 0;
  $('stOk').classList.remove('on');
  $('stHint').textContent = '正在讲述…';
  $('cgShow').classList.remove('on', 'in');
  $('storyView').classList.add('on');

  await nap(500);
  for (const t of c.text) {
    if (skipping) break;
    const p = document.createElement('p');
    if (t === '——') p.className = 'hr';
    else if (/^[「"]/.test(t)) p.className = 'q';
    p.textContent = t;
    box.appendChild(p);
    // 用户自己往上翻的时候就别跟着滚了
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 60) box.scrollTop = box.scrollHeight;
    await nap(Math.min(2000, 550 + t.length * 55));
  }
  if (skipping) return;

  $('stHint').textContent = '读完了可以往上翻';
  $('stOk').classList.add('on');
  await waitClick($('stOk'));
  if (skipping) return;

  // ---- 全屏 CG ----
  $('storyView').classList.remove('on');
  $('cgShowImg').src = `../assets/cg/${c.cg}.jpg`;
  $('cgShowName').textContent = c.title;
  $('cgShow').classList.add('on');
  await nap(60);
  $('cgShow').classList.add('in');
  await nap(5000);
  $('cgShow').classList.remove('in');
  await nap(600);
  $('cgShow').classList.remove('on');
}

/**
 * 进自习室之前叫一次。
 * 欠着几章就连着播几章 —— 一次自习跨了三个门槛，就该一口气把三段都看完，
 * 然后带着最后那个状态进房间。
 */
export async function playPendingBefore(key) {
  current = key || current;
  const b = bond.get(current);
  const queue = bond.CHAPTERS.filter(c => b.focusMin >= c.at && !b.seen.includes(c.id));
  if (!queue.length) return [];
  return playChapters(queue);
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

  $('stSkip').addEventListener('click', doSkip);
  $('cgSkip').addEventListener('click', doSkip);

  $('reviewNo').addEventListener('click', closeReview);
  $('reviewYes').addEventListener('click', doReview);
  $('reviewAsk').addEventListener('click', (e) => {
    if (e.target === $('reviewAsk')) closeReview();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('cgView').classList.contains('on')) closeCG();
    else if ($('reviewAsk').classList.contains('on')) closeReview();
    else if ($('storyView').classList.contains('on') || $('cgShow').classList.contains('on')) doSkip();
  });

  // 调试出口
  window.TZBond = {
    ...bond,
    persona: openPersona,
    play: (id) => playChapters([bond.CHAPTERS.find(c => c.id === id)], { mark: false }),
    playAll: () => playPendingBefore(current),
    gallery: () => { renderGallery(); show('gallery'); }
  };
}

export { renderGallery };
