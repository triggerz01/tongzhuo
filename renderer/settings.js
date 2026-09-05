/* settings.js — 陪伴模式与人物选择
 *
 * 两件事：
 *   模式   学生陪伴（现在这套）/ 老师监督（做了模型，行为还没做）
 *   同桌   学生陪伴模式下换人。动作和表情配方三个模型完全通用 ——
 *          都是 VRoid 导出的，Fcl_* 细分 morph 齐全，验过。
 *
 * 换人要重新加载 VRM，两三秒起步，不能干等。所以做了一层对切转场：
 * 红板合上 → 换模型 → 拉开。合上的时间正好把加载盖掉。
 */
'use strict';

const KEY = 'tongzhuo.settings.v1';
const $ = (id) => document.getElementById(id);

/* 人物登记表。按文件名认，丢新的 .vrm 进 assets/models 也能被扫到（见 mergeFound）。 */
const CAST = [
  { file: 'AvatarSample_A.vrm', name: '女生', desc: '安静，偶尔抬头看你一眼',
    thumb: '../assets/models/thumbs/girl.jpg', role: 'student' },
  { file: 'boy1.vrm', name: '男生', desc: '话不多，但一直在写',
    thumb: '../assets/models/thumbs/boy1.jpg', role: 'student' },
  { file: 'teacher.vrm', name: '老师', desc: '严肃，说到做到',
    thumb: '../assets/models/thumbs/teacher.jpg', role: 'teacher' }
];

const MODES = [
  { id: 'student', name: '学生陪伴', desc: '一个同龄人坐在对面。她不查你，只是一直在。' },
  { id: 'teacher', name: '老师监督', desc: '老师站在讲台上看着你。语气更硬，但不羞辱人。' },
  { id: 'bond',    name: '同行',
    desc: '她有自己的名字、来历和想去的地方。你们一起坐过的时间，会变成故事。' }
];

/* 每种模式的默认人物。切模式时自动换成对应角色 ——
   总不能让老师坐在你对面写作业。 */
const MODE_DEFAULT = { student: 'AvatarSample_A.vrm', teacher: 'teacher.vrm',
                       bond: 'AvatarSample_A.vrm' };

const DEFAULTS = { mode: 'student', model: 'AvatarSample_A.vrm',
                   lastStudent: 'AvatarSample_A.vrm' };

export const settings = {
  get() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (e) { return { ...DEFAULTS }; }
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* 隐私模式 */ }
    return next;
  },
  /** 当前该加载哪个 VRM，给 room.js 启动时用 */
  modelPath() { return '../assets/models/' + this.get().model; }
};

/* 目录里多出来的 .vrm 也列出来，保持"丢进去就能用" */
let cast = CAST.slice();
let onPersona = null;          // 同行模式点人物卡时打开角色页
async function mergeFound() {
  try {
    if (!(window.tz && window.tz.listModels)) return;
    const found = await window.tz.listModels();     // ['../assets/models/x.vrm', ...]
    for (const url of found || []) {
      const file = url.split('/').pop();
      if (cast.some(c => c.file === file)) continue;
      cast.push({ file, name: file.replace(/\.vrm$/i, ''), desc: '你自己放进来的',
                  thumb: null, role: 'student' });
    }
  } catch (e) { /* 用内置表 */ }
}

/* ---------------- 转场 ---------------- */
/** 红板合上 → 跑 job() → 拉开。加载多久都盖得住。 */
async function withSwap(job, label) {
  const el = $('swap');
  el.querySelector('b').textContent = label || 'SWITCHING';
  el.classList.add('act');
  // 先上一帧 display:block，再加 shut，否则 transition 不触发
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  el.classList.add('shut');
  await sleep(360);                       // 等板子合拢
  try { await job(); } catch (e) { console.warn('[settings] 切换失败', e); }
  await sleep(260);                       // 合着多停一下，别一换完就闪开
  el.classList.remove('shut');
  await sleep(380);
  el.classList.remove('act');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------- 渲染 ---------------- */
function renderModes() {
  const cur = settings.get().mode;
  const box = $('modeList');
  box.innerHTML = '';
  MODES.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'modeCard' + (m.id === cur ? ' on' : '') + (m.locked ? ' lock' : '');
    b.innerHTML = `${m.locked ? '<span class="soon">敬请期待</span>' : ''}
                   <b>${m.name}</b><small>${m.desc}</small>`;
    if (!m.locked) b.addEventListener('click', () => switchMode(m.id));
    box.appendChild(b);
  });
}

function renderPeers() {
  const st = settings.get();
  const box = $('peerList');
  box.innerHTML = '';
  // 老师模式只有老师，学生模式不列老师
  const want = st.mode === 'teacher' ? 'teacher' : 'student';
  // 同行模式目前只有周以宁（女生模型）。以后加男生线就把它也标成 bond 可选。
  const rows = st.mode === 'bond'
    ? cast.filter(c => c.file === 'AvatarSample_A.vrm')
    : cast.filter(c => c.role === want);
  $('peerTitle').textContent =
    st.mode === 'teacher' ? '选择监督者' : (st.mode === 'bond' ? '选择同行的人' : '选择同桌');
  rows.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'peerCard' + (c.file === st.model ? ' on' : '');
    b.innerHTML =
      (c.thumb ? `<img class="pic" src="${c.thumb}" alt="">`
               : `<span class="pic" style="background:#1b2027;display:block"></span>`) +
      `<span class="cap"><b>${c.name}</b><small>${c.desc}</small></span>`;
    b.addEventListener('click', () => {
      // 同行模式先看资料页，那里才有"选择与她同行"。
      // 直接换人会跳过你们之间的进度和剧情，那是这个模式的全部意义。
      if (settings.get().mode === 'bond' && onPersona) onPersona('yining');
      else pick(c);
    });
    box.appendChild(b);
  });
  $('peerSec').style.display = box.children.length ? '' : 'none';
  const tip = $('peerTip');
  if (tip) {
    const bondMode = st.mode === 'bond';
    tip.style.display = (want === 'teacher' || bondMode) ? '' : 'none';
    tip.textContent = bondMode
      ? '同行模式目前只有周以宁一条线。点她可以先看看她是谁、你们走到哪儿了。'
      : '监督者目前只有一位。以后可以放更多的 .vrm 进 assets/models，'
        + '在 settings.js 的 CAST 里登记 role: "teacher" 就会出现在这里。';
  }
}

/** 换模式：模式本身、对应人物、房间三样一起换，走同一个转场 */
async function switchMode(id) {
  const st = settings.get();
  if (st.mode === id) return;

  // 离开学生模式前记住你选的是男生还是女生，切回来要还原
  const patch = { mode: id };
  if (st.mode === 'student') patch.lastStudent = st.model;
  // 每种模式有自己的默认人物。同行模式用的是学生那批，不是老师 ——
  // 这里以前写死成 MODE_DEFAULT.teacher，切同行会把老师搬进自习室。
  const want = (id === 'student')
    ? (st.lastStudent || MODE_DEFAULT.student)
    : (MODE_DEFAULT[id] || MODE_DEFAULT.student);
  patch.model = want;
  settings.set(patch);
  render();

  await withSwap(async () => {
    if (window.TZRoom) {
      // 顺序要紧：先切模式（决定坐姿还是站姿、哪套动作和台词），
      // 再加载模型，最后取景 —— 反过来会按错误的模式取一次景
      window.TZRoom.mode(id);
      if (window.TZRoom.reload) await window.TZRoom.reload('../assets/models/' + want);
      if (window.TZRoom.voice) window.TZRoom.voice.setCharacter(want);
    }
  }, id === 'teacher' ? '老师监督' : (id === 'bond' ? '同行' : '学生陪伴'));
  // 切完模式不再自动播"选中这个人"的亮相 —— 那是点人物卡才该有的反馈。
  // 换模式只是换了个抽屉，还没挑东西。
}

async function pick(c) {
  if (settings.get().model === c.file) return;
  settings.set({ model: c.file });
  renderPeers();
  // 立刻换给你看 —— 选完还要猜长什么样，那这个选择就没意义
  // 在学生模式里换人，记下来；切去老师再切回来要还原
  if (c.role === 'student') settings.set({ lastStudent: c.file });
  await withSwap(async () => {
    if (window.TZRoom && window.TZRoom.reload) {
      await window.TZRoom.reload('../assets/models/' + c.file);
      // 音频包跟着人走。男生和老师还没有包，会退化成只出字幕。
      if (window.TZRoom.voice) window.TZRoom.voice.setCharacter(c.file);
    }
  }, c.name);
  await reveal(c);
}

/** 亮相：设置页和主界面视频都让开一会儿，让人真看见换的是谁 */
async function reveal(c) {
  const tip = $('revealTip');
  tip.querySelector('span').textContent = c.name + ' · ' + c.desc;
  document.body.classList.add('reveal');
  await sleep(1900);
  document.body.classList.remove('reveal');
}

function render() { renderModes(); renderPeers(); }

/* ---------------- 装配 ---------------- */
export function initSettings(show, personaFn) {
  onPersona = personaFn;
  $('btnSettings').addEventListener('click', async () => {
    await mergeFound();
    render();
    show('settings');
  });
  $('btnSetBack').addEventListener('click', () => {
    show('home');
    // 模式可能变了，主界面上"布置桌面"该不该在得重算
    if (window.TZHomeUI) window.TZHomeUI.paintModeUI();
  });
}
