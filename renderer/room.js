/* room.js — 自习室窗口（B 形态）
 * three.js + VRM 角色 + 程序化待机生命。
 *
 * 待机生命这里不靠动作文件，先用程序化的：呼吸、眨眼、头部微动、偶发大动作。
 * 这样没有任何 .vrma / Mixamo 资源也能立刻"活"起来；后面接上动作文件是叠加，不是替换。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadMixamoAnimation } from './mixamo.js';

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

// Mixamo 动作。有动作文件时由它接管身体，程序化的那套只保留眨眼和表情。
let mixer = null;
const clips = {};
let baseAction = null;
let oneShot = null;
let useMixamo = false;

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
    // 有 Mixamo 动作就让动作定义姿势；没有才手动把 T-pose 掰成伏案坐姿
    const gotAnims = await loadAnimations();
    if (!gotAnims) applyDeskPose();

    rest = {};
    for (const k in bones) if (bones[k]) rest[k] = bones[k].rotation.clone();

    // 先推进一帧，让姿势真正生效，再按实际的胯/头位置取景
    if (mixer) mixer.update(0.033);
    v.update(0.033);
    frameCamera();

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

async function loadAnimations() {
  if (!(window.tz && window.tz.listAnims)) return false;
  let list = [];
  try { list = await window.tz.listAnims(); } catch (e) { return false; }
  if (!list.length) return false;

  for (const a of list) {
    try {
      clips[a.name] = await loadMixamoAnimation(a.url, vrm);
    } catch (e) {
      console.warn('[room] 动作加载失败', a.name, e.message);
    }
  }
  const names = Object.keys(clips);
  if (!names.length) return false;

  mixer = new THREE.AnimationMixer(vrm.scene);
  const baseName = clips['Sitting-Idle'] ? 'Sitting-Idle'
                 : clips['Breathing-Idle'] ? 'Breathing-Idle' : names[0];
  baseAction = mixer.clipAction(clips[baseName]);
  baseAction.play();

  // 一次性动作播完，淡回底层循环
  mixer.addEventListener('finished', () => {
    if (!oneShot) return;
    baseAction.enabled = true;
    baseAction.setEffectiveWeight(1);
    baseAction.crossFadeFrom(oneShot, 0.45, false);
    oneShot = null;
  });

  useMixamo = true;
  console.log('[room] 已加载动作:', names.join(', '), '底层循环:', baseName);
  return true;
}

/** 插播一个一次性动作，播完自动淡回 */
function playClip(name) {
  const c = clips[name];
  if (!c || !mixer || name === baseAction?.getClip().name) return false;
  if (oneShot) oneShot.stop();
  oneShot = mixer.clipAction(c);
  oneShot.reset();
  oneShot.setLoop(THREE.LoopOnce, 1);
  oneShot.clampWhenFinished = true;
  oneShot.setEffectiveWeight(1);
  oneShot.crossFadeFrom(baseAction, 0.35, false).play();
  return true;
}

/* 取景：背景图是坐姿平视拍的，3D 相机也必须水平看（不能俯仰），
 * 否则透视对不上，角色就会"浮"在背景前面。
 * HIP_AT 是让角色的胯落在画面纵向的哪个位置——背景图的桌沿大约在 85%，
 * 让胯压在桌沿上，上半身露出来，就读成"坐在桌前"。 */
// 锚点用胸口而不是胯：坐姿时大腿会在屏幕上翻到胯以上，
// 按胯取景会让桌沿挡不住腿和裙子。按胸口取景，桌沿以下全被遮住，
// 画面就是"隔着桌子看到对面的人"——最自然的构图。
const framing = { anchorAt: 0.88, headAt: 0.20, headroom: 0.12 };

function frameCamera() {
  const anchorBone = bones && (bones.chest || bones.spine || bones.hips);
  if (!vrm || !bones || !anchorBone || !bones.head) return;
  const anchor = new THREE.Vector3(), head = new THREE.Vector3();
  anchorBone.getWorldPosition(anchor);
  bones.head.getWorldPosition(head);

  const topY = head.y + framing.headroom;             // 头顶（头骨往上留一点）
  const span = topY - anchor.y;                       // 要占据画面的那一段身体
  const frac = framing.anchorAt - framing.headAt;     // 这一段占画面高度的比例
  const H = span / frac;                              // 该深度处的可视高度
  const d = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  // 画面中心（50%）对应的世界高度
  const centerY = anchor.y + (framing.anchorAt - 0.5) * H;

  camera.position.set(0, centerY, d);
  lookTarget.set(0, centerY, 0);                      // 水平视线，无俯仰
  camera.lookAt(lookTarget);
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

/* Mixamo 动作的调度：和程序化那套同一个哲学——间隔非周期、有冷却、加权 */
const CLIP_POOL = [
  { name: 'Look-Around',     w: 4, cd: 40000 },
  { name: 'Bored',           w: 3, cd: 70000 },
  { name: 'Head-Nod-Yes',    w: 2, cd: 55000 },
  { name: 'Sitting-Talking', w: 1.5, cd: 120000 },
  { name: 'Breathing-Idle',  w: 2, cd: 90000 }
];
const clipLast = {};
let clipNext = 10 + Math.random() * 12;

function updateClipScheduler(dt) {
  if (oneShot) return;              // 正在播一次性动作，不打断
  clipNext -= dt;
  if (clipNext > 0) return;
  clipNext = 12 + Math.random() * 20;

  const now = Date.now();
  let pool = CLIP_POOL.filter(c => clips[c.name] && now - (clipLast[c.name] || 0) > c.cd);
  if (!pool.length) return;
  const total = pool.reduce((s, c) => s + c.w, 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= c.w;
    if (r <= 0) { clipLast[c.name] = now; playClip(c.name); return; }
  }
}

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
  // rest 要等动作文件加载完才有值，这期间渲染循环已经在跑了
  if (!vrm || !bones || !rest) return;
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

  // 有 Mixamo 动作时，身体归动作管；下面这些程序化的只在没有动作文件时兜底
  if (useMixamo) { updateClipScheduler(dt); return; }

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
  if (mixer) mixer.update(dt);
  updateIdle(dt);
  if (vrm) vrm.update(dt);
  renderer.render(scene, camera);
}


/* ---------------- 感知层：WebSocket + 画中人 ---------------- */
/* 画面由 Python 那边推过来（带标注的 JPEG，二进制帧）。
 * 不用前端 getUserMedia：Windows 上摄像头基本独占，前端再开一路
 * 会把检测器饿死。而且推标注帧还有个好处——用户看到的就是程序
 * 处理的全部，隐私上讲得清。 */
const WS_URL = 'ws://127.0.0.1:8765';
let ws = null, wsTimer = null;
let pipOn = false;
let lastBlob = null;

const LABEL_CN = {
  focus: '专注', away: '离席', phone: '玩手机',
  drowsy: '犯困', covered: '遮挡镜头', calibrating: '标定中', unknown: '—'
};

function wsSend(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}

function connectPerception() {
  try { ws = new WebSocket(WS_URL); } catch (e) { retryWs(); return; }
  ws.binaryType = 'blob';

  ws.onopen = () => {
    $('camDot2').classList.add('on');
    $('camText').textContent = '摄像头已连接';
    wsSend({ cmd: 'start' });
    if (pipOn) wsSend({ cmd: 'preview', on: true });
    console.log('[room] 感知层已连接');
  };

  ws.onclose = () => {
    $('camDot2').classList.remove('on');
    $('camText').textContent = '摄像头未连接';
    $('pipLabel').textContent = '连接已断开';
    retryWs();
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };

  ws.onmessage = (ev) => {
    // 二进制 = 画中人的一帧
    if (ev.data instanceof Blob) {
      if (!pipOn) return;
      const url = URL.createObjectURL(ev.data);
      const img = $('pipImg');
      const prev = lastBlob;
      img.onload = () => { if (prev) URL.revokeObjectURL(prev); };
      img.src = url;
      lastBlob = url;
      return;
    }
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    onPerception(m);
  };
}
function retryWs() { if (wsTimer) return; wsTimer = setTimeout(() => { wsTimer = null; connectPerception(); }, 4000); }

let lastLabel = null;
function onPerception(m) {
  if (m.type === 'hello') {
    console.log('[room] 感知层握手', m);
    $('camText').textContent = m.phone ? '摄像头已连接' : '摄像头已连接（手机检测未启用）';
  }
  if (m.type === 'state') {
    const cn = LABEL_CN[m.label] || m.label;
    $('pipLabel').textContent = `${cn} · ${m.duration.toFixed(0)}s`;
    if (m.label !== lastLabel) {
      lastLabel = m.label;
      $('camText').textContent = '识别：' + cn;
    }
    // 联动先只做最轻的一层：认出你走了，角色抬头看一眼
    if (m.trigger && m.label === 'away') play('lookAway');
  }
  if (m.type === 'calibrating') say('保持你平时看书的姿势，15 秒…', 15000);
  if (m.type === 'calibrated') say(m.ok ? '记住你的姿势了。' : ('标定失败：' + (m.reason || '')), 4000);
  if (m.type === 'error') say('摄像头出错：' + m.message, 5000);
}

function setPip(on) {
  pipOn = !!on;
  $('pip').hidden = !pipOn;
  $('btnPip').classList.toggle('on', pipOn);
  if (!pipOn && lastBlob) { URL.revokeObjectURL(lastBlob); lastBlob = null; $('pipImg').removeAttribute('src'); }
  if (!wsSend({ cmd: 'preview', on: pipOn }) && pipOn) $('pipLabel').textContent = '感知层未连接';
}

function play(name) {
  if (useMixamo && clips[name]) return playClip(name);
  const d = ACTIONS.find(a => a.name === name);
  if (d) idle.action = { def: d, t: 0 };
}

/* ---------------- 场景与 UI ---------------- */
// 没有真实背景图时的兜底（CSS 渐变）
const FALLBACK = [
  { name: '自习室（夜）', css: 'radial-gradient(120% 80% at 50% 8%, rgba(255,236,200,.20), transparent 60%), linear-gradient(#2b3138 0%, #232a31 46%, #1d232a 46.4%, #171c22 100%)' },
  { name: '图书馆', css: 'radial-gradient(130% 70% at 50% 6%, rgba(214,232,255,.16), transparent 62%), linear-gradient(#333c44 0%, #2a323a 44%, #222931 44.4%, #1a2027 100%)' },
  { name: '咖啡厅', css: 'radial-gradient(120% 80% at 60% 10%, rgba(255,206,150,.22), transparent 58%), linear-gradient(#3a3229 0%, #322a22 45%, #29221c 45.4%, #1f1a15 100%)' },
  { name: '卧室（晚）', css: 'radial-gradient(110% 70% at 40% 12%, rgba(255,190,160,.18), transparent 60%), linear-gradient(#2e2a33 0%, #26232c 46%, #201d26 46.4%, #17151c 100%)' }
];

let SCENES = FALLBACK.slice();
let sceneIdx = 0;

// 合成参数：让 2D 背景和 3D 角色看起来在同一个空间里
// blur 制造景深、brightness/saturate 压住背景、tint 统一色温
const comp = { blur: 1.5, brightness: 0.86, saturate: 0.95, tint: 'rgba(18,22,28,.18)' };
// 前景桌面的上沿在画面纵向的位置。宁可切低一点（数值大），
// 切高了会把地板也盖到角色腿上，露馅。
// 每张图的桌沿高度不同，量出来的写进这张表，其余用默认值。
const FG_TOP_DEFAULT = 0.87;
const FG_TOP = {
  '01-自习室夜': 0.85,
  '03-咖啡馆': 0.88
};
const fgTopOf = (name) => FG_TOP[name] ?? FG_TOP_DEFAULT;

function applyComp() {
  const bg = $('bg');
  bg.style.filter = `blur(${comp.blur}px) brightness(${comp.brightness}) saturate(${comp.saturate})`;
  // 轻微放大，避免 blur 在边缘露出空白
  bg.style.transform = comp.blur > 0 ? `scale(${1 + comp.blur / 120})` : 'none';
  $('bgTint').style.background = comp.tint;
}

async function loadScenes() {
  try {
    if (window.tz && window.tz.listScenes) {
      const found = await window.tz.listScenes();
      if (found && found.length) {
        SCENES = found.map(f => ({ name: f.name, img: f.url }));
        return true;
      }
    }
  } catch (e) { /* 用兜底 */ }
  SCENES = FALLBACK.slice();
  return false;
}

function applyScene(i) {
  if (!SCENES.length) return;
  sceneIdx = (i + SCENES.length) % SCENES.length;
  const s = SCENES[sceneIdx];
  const bg = $('bg');
  bg.classList.remove('placeholder');
  const hasImg = !!s.img;
  $('desk').style.display = hasImg ? 'none' : '';
  $('deskItems').style.display = hasImg ? 'none' : '';
  $('lampGlow').style.display = hasImg ? 'none' : '';

  const fg = $('fg');
  if (hasImg) {
    // 同一张图、同样的 cover 定位 → 前景层和背景层天然对齐
    fg.style.display = '';
    fg.style.backgroundImage = `url("${s.img}")`;
    fg.style.clipPath = `inset(${(fgTopOf(s.name) * 100).toFixed(1)}% 0 0 0)`;
    fg.style.filter = `brightness(${comp.brightness}) saturate(${comp.saturate})`;
  } else {
    fg.style.display = 'none';
  }

  if (hasImg) {
    bg.style.background = `#12161a center/cover no-repeat url("${s.img}")`;
  } else {
    bg.style.background = s.css;
    bg.style.backgroundSize = 'cover';
  }
  applyComp();
  say('（' + s.name + '）', 1600);
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
$('btnPip').addEventListener('click', () => setPip(!pipOn));
$('pipClose').addEventListener('click', () => setPip(false));
$('btnPose').addEventListener('click', () => {
  idle.action = { def: pickAction(), t: 0 };
  say('（测试动作：' + idle.action.def.name + '）', 1800);
});

/* ---------------- 启动 ---------------- */
resize();
tick();
loadScenes().then((real) => {
  applyScene(0);
  if (!real) console.log('[room] assets/scenes 里还没有背景图，先用 CSS 兜底');
});
loadModel();
connectPerception();

// 供 CDP 调试与外部驱动
window.TZRoom = {
  reload: loadModel,
  play: (name) => {
    if (useMixamo && clips[name]) return playClip(name);
    const d = ACTIONS.find(a => a.name === name);
    if (d) idle.action = { def: d, t: 0 };
    return !!d;
  },
  actions: () => useMixamo ? Object.keys(clips) : ACTIONS.map(a => a.name),
  usingMixamo: () => useMixamo,
  pip: setPip,
  wsState: () => (ws ? ws.readyState : -1),
  debugPos: () => {
    const v3 = new THREE.Vector3();
    const g = (n) => { const b = vrm.humanoid.getNormalizedBoneNode(n); return b ? +b.getWorldPosition(v3).y.toFixed(3) : null; };
    const raw = (n) => { const b = vrm.humanoid.getRawBoneNode(n); return b ? +b.getWorldPosition(v3).y.toFixed(3) : null; };
    return { normHead: g('head'), normHips: g('hips'), rawHead: raw('head'), rawHips: raw('hips'),
             camY: +camera.position.y.toFixed(3), camZ: +camera.position.z.toFixed(3),
             sceneY: +vrm.scene.getWorldPosition(v3).y.toFixed(3) };
  },
  say,
  scene: applyScene,
  scenes: () => SCENES.map(s => s.name),
  reloadScenes: () => loadScenes().then(() => applyScene(0)),
  // 实时调合成参数，调好了我把数值固化进代码
  comp: (patch) => { Object.assign(comp, patch || {}); applyComp(); return { ...comp }; },
  frame: (patch) => { Object.assign(framing, patch || {}); frameCamera(); return { ...framing }; },
  fgTop: (v) => { $('fg').style.clipPath = `inset(${(v*100).toFixed(1)}% 0 0 0)`; return v; },
  info: () => ({
    loaded: !!vrm,
    mixamo: useMixamo,
    clips: Object.keys(clips),
    expressions: vrm && vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap || {}) : [],
    bones: bones ? Object.keys(bones).filter(k => bones[k]) : []
  })
};
