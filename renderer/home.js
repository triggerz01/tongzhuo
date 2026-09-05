/* home.js — 主界面与准备流程
 *
 * 不做成独立页面，而是盖在自习室之上的两层遮罩：
 *   主界面   角色已经坐在那了，只是隔着一层暗色 —— 视觉上直接就有内容，
 *            而且模型和场景在你挑设置的这段时间里已经加载完了
 *   准备页   学习地点 / 今天学多久 / 摄像头
 *
 * 时长到了会自动收工并退回主界面，带一张当场的小结。
 */
'use strict';

import { initRecords, recordStore } from './records.js';
import { initSettings } from './settings.js';
import { initSettle, showSettle } from './settle.js';
import { initStore, paintBalance } from './store.js';
import { initDesk, renderDesk } from './desk.js';
import { initStory } from './story.js';   // 剧情：ban-jiang 的地盘

const $ = (id) => document.getElementById(id);

const DURATIONS = [
  { min: 25, label: '25 分钟', note: '一个番茄钟' },
  { min: 45, label: '45 分钟', note: '一节课' },
  { min: 60, label: '1 小时', note: '' },
  { min: 90, label: '90 分钟', note: '一场考试' }
];

const state = {
  scene: 0,
  minutes: 45,
  breakMin: 5
};

/* ---------------- 背景视频 ---------------- */
/* 空着的自习室。会话开始就暂停 —— 没人看的时候没必要解码。 */
async function initVideo() {
  const v = $('homeVid');
  if (!v || !(window.tz && window.tz.homeVideo)) return;
  let src = null;
  try { src = await window.tz.homeVideo(); } catch (e) { return; }
  if (!src) return;                        // 没有视频就用原来的静态背景
  v.src = src;
  v.addEventListener('canplay', () => {
    v.classList.add('ready');
    v.play().catch(() => {});
  }, { once: true });
  // Chromium 偶尔会拒掉第一次 play()，补一次兜底重试
  setTimeout(() => { if (v.classList.contains('ready') && v.paused && view !== 'session') v.play().catch(() => {}); }, 1200);
  v.addEventListener('error', () => console.warn('[home] 背景视频加载失败'));
}

// 亮度可以在运行时调，方便对着屏幕试
window.TZHome = {
  brightness: (v) => { document.getElementById('homeVid').style.filter =
    `brightness(${v}) contrast(1.04) saturate(1.06)`; return v; },
  veil: (a) => { document.getElementById('home').style.background =
    `radial-gradient(58% 46% at 50% 44%, rgba(6,8,11,${a}) 0%, rgba(6,8,11,${a*0.55}) 55%, transparent 100%)`; return a; }
};

function videoPlaying(on) {
  const v = $('homeVid');
  if (!v || !v.classList.contains('ready')) return;
  if (on) v.play().catch(() => {}); else v.pause();
}

/* ---------------- 界面切换 ---------------- */
let view = 'home';   // home | setup | calib | settings | store | session

function show(v) {
  view = v;
  $('home').classList.toggle('on', v === 'home');
  $('setup').classList.toggle('on', v === 'setup');
  $('settings').classList.toggle('on', v === 'settings');
  $('calib').classList.toggle('on', v === 'calib');
  if (v !== 'settle') $('settle').classList.remove('on');
  if (v !== 'store') $('store').classList.remove('on');
  if (v !== 'home') $('records').classList.remove('on');
  document.body.classList.toggle('in-session', v === 'session');
  videoPlaying(v !== 'session');
  // 主界面和准备页都不需要角色说话
  if (v !== 'session' && window.TZRoom) window.TZRoom.say('');
}

/* ---------------- 准备页 ---------------- */
function renderScenes() {
  const names = window.TZRoom ? window.TZRoom.scenes() : [];
  const box = $('sceneList');
  box.innerHTML = '';
  names.forEach((n, i) => {
    const card = document.createElement('button');
    card.className = 'sceneCard' + (i === state.scene ? ' on' : '');
    // 直接拿场景原图当封面，不用另做缩略图
    card.style.backgroundImage = `url("../assets/scenes/${encodeURIComponent(n)}.jpg")`;
    card.innerHTML = `<span>${n.replace(/^\d+-/, '')}</span>`;
    card.addEventListener('click', () => {
      state.scene = i;
      window.TZRoom.scene(i);
      renderScenes();
    });
    box.appendChild(card);
  });
}

function renderDurations() {
  const box = $('durList');
  box.innerHTML = '';
  DURATIONS.forEach((d) => {
    const b = document.createElement('button');
    b.className = 'durCard' + (d.min === state.minutes ? ' on' : '');
    b.innerHTML = `<b>${d.label}</b>${d.note ? `<small>${d.note}</small>` : ''}`;
    b.addEventListener('click', () => { state.minutes = d.min; syncDur(); });
    box.appendChild(b);
  });
  $('durCustom').value = state.minutes;
}

function syncDur() {
  renderDurations();
  $('durCustom').value = state.minutes;
}

function paintCamStatus() {
  const t = $('camText') ? $('camText').textContent : '';
  $('setupCam').textContent = t || '未知';
  const on = $('camDot2') && $('camDot2').classList.contains('on');
  $('setupCamDot').classList.toggle('on', on);
}

/* ---------------- 开始 / 结束 ---------------- */
function begin() {
  const m = Math.max(1, Math.min(600, Number($('durCustom').value) || state.minutes));
  state.minutes = m;
  show('session');
  window.TZRoom.startSession({ minutes: m, breakMin: state.breakMin });
}

/** 时长到了或手动结束 —— 回主界面，带一张小结 */
function finish(summary) {
  show('home');
  const s = summary || {};
  // 每场自习记一条，日历就是从这儿长出来的
  try {
    const names = window.TZRoom.scenes();
    recordStore.add({
      endedAt: Date.now(),
      startedAt: s.startedAt ?? (Date.now() - (s.elapsedMin ?? 0) * 60000),
      elapsedMin: s.elapsedMin ?? 0,
      focusMin: s.focusMin ?? 0,
      awayMin: s.awayMin ?? 0,
      phoneMin: s.phoneMin ?? 0,
      drowsyMin: s.drowsyMin ?? 0,
      plannedMin: s.plannedMin ?? state.minutes,
      awayCount: s.awayCount ?? 0,
      distractCount: s.distractCount ?? 0,
      events: s.events ?? [],
      reason: s.reason || 'manual',
      scene: (names[state.scene] || '').replace(/^\d+-/, '')
    });
  } catch (e) { console.warn('[home] 记录写入失败', e); }
  // 先看结算，点"知道了"才回主界面
  showSettle(s);
}

/* ---------------- 装配 ---------------- */
function init() {
  $('btnStart').addEventListener('click', () => {
    $('homeSummary').classList.remove('on');
    renderScenes(); syncDur(); paintCamStatus();
    show('setup');
  });
  $('btnBackHome').addEventListener('click', () => show('home'));
  $('btnEnter').addEventListener('click', begin);
  $('durCustom').addEventListener('input', () => {
    state.minutes = Number($('durCustom').value) || state.minutes;
    document.querySelectorAll('.durCard').forEach(c => c.classList.remove('on'));
  });
  // 校准是准备流程里的一步：准备一下 → 校准位置 → 回到准备一下 → 进入自习室
  $('setupCalib').addEventListener('click', () => { show('calib'); window.TZRoom.calib(); });
  window.TZRoom.onCalibExit(() => { if (view === 'calib') show('setup'); });
  $('setupCamBtn').addEventListener('click', () => { $('btnCam').click(); setTimeout(paintCamStatus, 900); });
  $('btnQuitSession').addEventListener('click', () => window.TZRoom.endSession('manual'));

  // 调试条平时藏起来，按 D 才出来 —— 演示时不该看到一排测试按钮
  document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('debug');
  });

  initVideo();
  initRecords();
  initSettings(show);
  initSettle(() => { show('home'); paintBalance(); });
  window.__settle = showSettle;
  initStore(() => show('home'));
  initDesk(() => show('home'));
  initStory();
  window.TZRoom.onSessionEnd(finish);
  setInterval(() => { if (view === 'setup') paintCamStatus(); }, 1500);
  show('home');
}

function boot() {
  if (window.TZRoom && window.TZRoom.onSessionEnd) init();
  else setTimeout(boot, 200);
}
boot();
