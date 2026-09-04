/* room.js — 自习室窗口（B 形态）
 * three.js + VRM 角色 + 程序化待机生命。
 *
 * 待机生命这里不靠动作文件，先用程序化的：呼吸、眨眼、头部微动、偶发大动作。
 * 这样没有任何 .vrma / Mixamo 资源也能立刻"活"起来；后面接上动作文件是叠加，不是替换。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- 渲染基础 ---------------- */
const canvas = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// 相机取上半身：桌子挡住腿，站姿也读成"坐在桌前"
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
camera.position.set(0, 1.36, 1.62);
const lookTarget = new THREE.Vector3(0, 1.30, 0);
camera.lookAt(lookTarget);

// 灯光：一盏主光偏暖（台灯感），一盏冷补光，一点环境
scene.add(new THREE.AmbientLight(0xffffff, 1.25));
const key = new THREE.DirectionalLight(0xffe9c9, 1.5);
key.position.set(1.2, 2.0, 1.6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc9dcff, 0.55);
fill.position.set(-1.6, 1.2, 0.8);
scene.add(fill);

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* ---------------- 模型加载 ---------------- */
let vrm = null;
let bones = null;
let rest = null;   // 初始骨骼旋转，所有程序化动作在它之上叠加

const CANDIDATES = [
  '../assets/models/model2.vrm',
  '../assets/models/model1.vrm',
  '../assets/models/character.vrm',
  '../assets/models/avatar.vrm'
];

async function findModel() {
  // 优先问主进程要目录清单：丢任何 .vrm 进 assets/models 都能被认出来
  try {
    if (window.tz && window.tz.listModels) {
      const found = await window.tz.listModels();
      if (found && found.length) return found[0];
    }
  } catch (e) { /* 落到下面的固定候选 */ }

  for (const p of CANDIDATES) {
    try {
      const r = await fetch(p, { method: 'HEAD' });
      if (r.ok) return p;
    } catch (e) { /* file:// 下 HEAD 可能失败，落到 GET 兜底 */ }
    try {
      const r = await fetch(p);
      if (r.ok) return p;
    } catch (e) { /* 继续找 */ }
  }
  return null;
}

async function loadModel() {
  const path = await findModel();
  if (!path) { $('hint').style.display = ''; return false; }
  $('hint').textContent = '正在加载角色…';

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync(path);
    const v = gltf.userData.vrm;
    if (!v) throw new Error('这个文件里没有 VRM 数据');

    if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(v);                    // VRM 0.x 朝向修正，1.0 无副作用
    v.scene.traverse((o) => { o.frustumCulled = false; });

    scene.add(v.scene);
    vrm = v;

    const g = (n) => v.humanoid && v.humanoid.getNormalizedBoneNode(n);
    bones = {
      head: g('head'), neck: g('neck'), chest: g('chest') || g('upperChest'),
      spine: g('spine'), hips: g('hips'),
      lShoulder: g('leftUpperArm'), rShoulder: g('rightUpperArm'),
      lElbow: g('leftLowerArm'), rElbow: g('rightLowerArm')
    };
    // VRM 的静止姿势是 T-pose（手臂平举）。先摆成坐在桌前的姿势，
    // 再把它作为 rest 记下来——之后所有呼吸/动作都叠加在这个姿势上。
    applyDeskPose();

    rest = {};
    for (const k in bones) if (bones[k]) rest[k] = bones[k].rotation.clone();

    // 把相机对准头部，保证不同身高的模型都框得住
    if (bones.head) {
      const wp = new THREE.Vector3();
      bones.head.getWorldPosition(wp);
      lookTarget.set(0, wp.y - 0.30, 0);
      camera.position.set(0, wp.y - 0.14, 2.35);
      camera.lookAt(lookTarget);
    }

    $('hint').style.display = 'none';
    console.log('[room] 已加载', path, '表情:',
      v.expressionManager ? Object.keys(v.expressionManager.expressionMap || {}) : '无');
    return true;
  } catch (e) {
    $('hint').style.display = '';
    $('hint').innerHTML = '加载失败：' + e.message +
      '<br><br>如果是 VRM 1.0 导出的，试试改用 VRM 0.0 再导一次。';
    console.error(e);
    return false;
  }
}

/** 把 T-pose 掰成"坐在桌前"的静止姿势 */
function applyDeskPose() {
  const h = vrm.humanoid;
  const set = (name, x, y, z) => {
    const b = h.getNormalizedBoneNode(name);
    if (b) b.rotation.set(x || 0, y || 0, z || 0);
  };
  // 上臂放下并略微前送
  set('leftUpperArm',  0.10, 0, -1.28);
  set('rightUpperArm', 0.10, 0,  1.28);
  // 小臂向内收，像搭在桌面上
  set('leftLowerArm',  0, -0.42, -0.12);
  set('rightLowerArm', 0,  0.42,  0.12);
  // 手腕放平
  set('leftHand',  0, 0, -0.10);
  set('rightHand', 0, 0,  0.10);
  // 上身略微前倾，读起来像伏案
  set('spine', 0.06, 0, 0);
  set('chest', 0.04, 0, 0);
  set('neck', -0.04, 0, 0);
}

/* ---------------- 程序化待机生命 ---------------- */
// 与 2D 版本同一套哲学：从不完全静止 + 间隔非周期 + 动作有冷却
const idle = {
  t: 0,
  blinkNext: 2 + Math.random() * 4,
  blinkPhase: -1,           // -1 = 没在眨
  action: null,             // {name, t, dur}
  nextAction: 8 + Math.random() * 10,
  headTargetX: 0, headTargetY: 0,
  headX: 0, headY: 0
};

const ACTIONS = [
  { name: 'lookAway',  w: 4, dur: 2.6 },
  { name: 'headTilt',  w: 3, dur: 3.0 },
  { name: 'stretch',   w: 2, dur: 3.2 },
  { name: 'yawn',      w: 1.5, dur: 2.4 },
  { name: 'lookDown',  w: 4, dur: 4.0 },   // 低头看书
  { name: 'shift',     w: 3, dur: 2.0 }    // 换个坐姿
];

function pickAction() {
  const total = ACTIONS.reduce((s, a) => s + a.w, 0);
  let r = Math.random() * total;
  for (const a of ACTIONS) { r -= a.w; if (r <= 0) return a; }
  return ACTIONS[0];
}

function expr(name, value) {
  if (vrm && vrm.expressionManager) {
    try { vrm.expressionManager.setValue(name, value); } catch (e) { /* 该模型没这个表情 */ }
  }
}

function updateIdle(dt) {
  if (!vrm || !bones) return;
  idle.t += dt;

  /* 眨眼：随机间隔 + 28% 概率连眨两下 */
  if (idle.blinkPhase < 0) {
    idle.blinkNext -= dt;
    if (idle.blinkNext <= 0) {
      idle.blinkPhase = 0;
      idle.blinkNext = 2.2 + Math.random() * 4.2;
      idle.blinkDouble = Math.random() < 0.28;
    }
  } else {
    idle.blinkPhase += dt;
    const d = 0.13;
    const v = idle.blinkPhase < d / 2
      ? idle.blinkPhase / (d / 2)
      : 1 - (idle.blinkPhase - d / 2) / (d / 2);
    expr('blink', clamp(v, 0, 1));
    if (idle.blinkPhase >= d) {
      expr('blink', 0);
      if (idle.blinkDouble) { idle.blinkDouble = false; idle.blinkPhase = 0; }
      else idle.blinkPhase = -1;
    }
  }

  /* 呼吸：胸腔和肩膀的低频起伏，永不静止 */
  const br = Math.sin(idle.t * 1.05) * 0.5 + 0.5;
  if (bones.chest) bones.chest.rotation.x = rest.chest.x + (br - 0.5) * 0.030;
  if (bones.spine) bones.spine.rotation.x = rest.spine.x + (br - 0.5) * 0.016;
  if (bones.lShoulder) bones.lShoulder.rotation.z = rest.lShoulder.z - (br - 0.5) * 0.024;
  if (bones.rShoulder) bones.rShoulder.rotation.z = rest.rShoulder.z + (br - 0.5) * 0.024;

  /* 头部微动：缓慢趋近一个随机目标，永远在动但幅度极小 */
  idle.headX += (idle.headTargetX - idle.headX) * dt * 1.6;
  idle.headY += (idle.headTargetY - idle.headY) * dt * 1.6;

  /* 大动作调度：非周期 */
  if (!idle.action) {
    idle.nextAction -= dt;
    if (idle.nextAction <= 0) {
      idle.action = { def: pickAction(), t: 0 };
      idle.nextAction = 9 + Math.random() * 14;
    } else if (Math.random() < dt * 0.25) {
      // 平时也让视线飘一点点
      idle.headTargetX = (Math.random() - 0.5) * 0.10;
      idle.headTargetY = (Math.random() - 0.5) * 0.07;
    }
  } else {
    const a = idle.action;
    a.t += dt;
    const p = clamp(a.t / a.def.dur, 0, 1);
    const ease = Math.sin(p * Math.PI);            // 起-收，没有瞬切

    switch (a.def.name) {
      case 'lookAway':
        idle.headTargetX = 0.34 * ease * (a.seed || (a.seed = Math.random() < .5 ? -1 : 1));
        break;
      case 'headTilt':
        if (bones.neck) bones.neck.rotation.z = rest.neck.z + 0.16 * ease;
        break;
      case 'lookDown':
        idle.headTargetY = 0.30 * ease;
        break;
      case 'stretch':
        // 静止姿势是手臂向下（z = ∓1.28），向 0 靠拢才是抬起来
        if (bones.lShoulder) bones.lShoulder.rotation.z = rest.lShoulder.z + 0.80 * ease;
        if (bones.rShoulder) bones.rShoulder.rotation.z = rest.rShoulder.z - 0.80 * ease;
        if (bones.lElbow) bones.lElbow.rotation.y = rest.lElbow.y + 0.30 * ease;
        if (bones.rElbow) bones.rElbow.rotation.y = rest.rElbow.y - 0.30 * ease;
        if (bones.chest) bones.chest.rotation.x = rest.chest.x - 0.14 * ease;
        idle.headTargetY = -0.18 * ease;
        break;
      case 'yawn':
        expr('aa', ease * 0.85);
        expr('blink', ease * 0.9);
        idle.headTargetY = -0.12 * ease;
        break;
      case 'shift':
        if (bones.hips) bones.hips.rotation.y = rest.hips.y + 0.10 * ease;
        if (bones.spine) bones.spine.rotation.y = rest.spine.y - 0.06 * ease;
        break;
    }

    if (p >= 1) {
      if (a.def.name === 'yawn') { expr('aa', 0); expr('blink', 0); }
      if (bones.neck) bones.neck.rotation.z = rest.neck.z;
      if (bones.hips) bones.hips.rotation.y = rest.hips.y;
      idle.headTargetX = 0; idle.headTargetY = 0;
      idle.action = null;
    }
  }

  if (bones.head) {
    bones.head.rotation.y = rest.head.y + idle.headX;
    bones.head.rotation.x = rest.head.x + idle.headY;
  }
  if (bones.neck) {
    bones.neck.rotation.y = rest.neck.y + idle.headX * 0.45;
    bones.neck.rotation.x = rest.neck.x + idle.headY * 0.35;
  }
}

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);
  updateIdle(dt);
  if (vrm) vrm.update(dt);
  renderer.render(scene, camera);
}

/* ---------------- 场景与 UI ---------------- */
const SCENES = [
  { name: '自习室（夜）', css: 'radial-gradient(120% 80% at 50% 8%, rgba(255,236,200,.20), transparent 60%), linear-gradient(#2b3138 0%, #232a31 46%, #1d232a 46.4%, #171c22 100%)' },
  { name: '图书馆', css: 'radial-gradient(130% 70% at 50% 6%, rgba(214,232,255,.16), transparent 62%), linear-gradient(#333c44 0%, #2a323a 44%, #222931 44.4%, #1a2027 100%)' },
  { name: '咖啡厅', css: 'radial-gradient(120% 80% at 60% 10%, rgba(255,206,150,.22), transparent 58%), linear-gradient(#3a3229 0%, #322a22 45%, #29221c 45.4%, #1f1a15 100%)' },
  { name: '卧室（晚）', css: 'radial-gradient(110% 70% at 40% 12%, rgba(255,190,160,.18), transparent 60%), linear-gradient(#2e2a33 0%, #26232c 46%, #201d26 46.4%, #17151c 100%)' }
];
let sceneIdx = 0;
function applyScene(i) {
  sceneIdx = (i + SCENES.length) % SCENES.length;
  const bg = $('bg');
  bg.classList.remove('placeholder');
  bg.style.background = SCENES[sceneIdx].css;
  bg.style.backgroundSize = 'cover';
  say('（' + SCENES[sceneIdx].name + '）', 1600);
}

let lineTimer = null;
function say(text, ms) {
  const el = $('line');
  el.textContent = text;
  el.classList.add('on');
  if (lineTimer) clearTimeout(lineTimer);
  lineTimer = setTimeout(() => el.classList.remove('on'), ms || 3600);
}

/* 会话计时（巡查逻辑下一步接上） */
let session = null;
function startSession() {
  const min = Number($('fMin').value) || 25;
  session = { startedAt: Date.now(), plannedMin: min, focusMs: 0 };
  $('stateText').textContent = '自习中';
  say('开始了，我也开始。', 3000);
}
function stopSession() {
  if (!session) return;
  session = null;
  $('stateText').textContent = '已结束';
  say('今天到这儿。', 3200);
}
setInterval(() => {
  if (!session) return;
  const m = Math.floor((Date.now() - session.startedAt) / 60000);
  $('focusText').textContent = m;
  $('coinText').textContent = Math.min(30, Math.floor(m / 25) * 3);
  if (m >= session.plannedMin) stopSession();
}, 1000);

$('btnStart').addEventListener('click', startSession);
$('btnStop').addEventListener('click', stopSession);
$('btnReload').addEventListener('click', () => loadModel());
$('btnScene').addEventListener('click', () => applyScene(sceneIdx + 1));
$('btnPose').addEventListener('click', () => {
  idle.action = { def: pickAction(), t: 0 };
  say('（测试动作：' + idle.action.def.name + '）', 1800);
});

/* ---------------- 启动 ---------------- */
resize();
applyScene(0);
tick();
loadModel();

// 供 CDP 调试与外部驱动
window.TZRoom = {
  reload: loadModel,
  play: (name) => { const d = ACTIONS.find(a => a.name === name); if (d) idle.action = { def: d, t: 0 }; },
  actions: ACTIONS.map(a => a.name),
  say,
  scene: applyScene,
  info: () => ({
    loaded: !!vrm,
    expressions: vrm && vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap || {}) : [],
    bones: bones ? Object.keys(bones).filter(k => bones[k]) : []
  })
};
