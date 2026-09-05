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
import { Expressions, STATE_FACE } from './expression.js';
import { settings } from './settings.js';
import * as voice from './voice.js';
import * as shots from './shots.js';

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
  // 桌面的放大倍数是按视口高算的，窗口一变就得重算
  if (SCENES && SCENES.length) sizeDesk(SCENES[sceneIdx]);
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
let face = null;   // 表情控制器
let frozen = false;  // 冻结身体动作，只留表情——调表情时用

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

/** want 传具体路径就加载它；不传就按 findModel 的顺序挑第一个 */
async function loadModel(want) {
  const path = want || await findModel();
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
    face = new Expressions(v);
    console.log('[room] 表情通道:', [...face.available].join(', '));

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
  // 底层循环挑最像"她也在学习"的那个。按名字松匹配，
  // 从 Mixamo 下下来叫 "X Bot@Writing.fbx" 也认得。
  // 底层循环必须是抬着头的：脸是这个产品的全部，
  // Writing 整段都低着头，只适合偶尔插播（见 CLIP_POOL）。
  const BASE_PREF = ['sittingidle', 'breathingidle', 'writing'];
  const baseName = BASE_PREF.map(p => names.find(n => _norm(n).includes(p))).find(Boolean)
                 || names[0];
  baseAction = mixer.clipAction(clips[baseName]);
  baseAction.play();

  // 一次性动作播完，淡回底层循环
  mixer.addEventListener('finished', (e) => {
    // 只认当前这个一次性动作的结束事件，别被上一个的残留 finished 带偏
    if (!oneShot || e.action !== oneShot) return;
    baseAction.enabled = true;
    baseAction.setEffectiveWeight(1);
    baseAction.paused = false;
    baseAction.play();
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
  // 关键：上一个一次性动作还在时，光 stop() 是不够的 —— 它淡入的时候把底层
  // 循环的权重压到了 0，stop 之后没人把它加回来。接下来的 crossFadeFrom 就是
  // 从"没有任何姿势"淡进来，权重和不足 1，绑定姿势（T-pose）从缝里漏出来。
  // 双手平举就是这么来的。所以每次插播前都把底层循环的权重显式复位。
  if (oneShot) { oneShot.stop(); oneShot = null; }
  baseAction.enabled = true;
  baseAction.setEffectiveWeight(1);
  baseAction.paused = false;
  baseAction.play();
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
// anchorAt 是胸口锚点落在画面纵向的位置。桌沿在 0.68，锚点压到 0.78 ——
// 胸口以下被桌子吃掉一截，看着就是"她坐在桌子后面"，而不是浮在桌前。
// 桌沿 0.72、锚点 0.56 —— 定稿值，别再动。
// 写字那一段她低头前倾，裙子和腿会露在小臂下面；0.72 刚好把腿盖住，
// 同时小臂和手还留在桌面上。再往上（数值更小）手也没了，再往下腿就露。
const framing = { anchorAt: 0.56, headAt: 0.14, headroom: 0.12 };

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
// 待机动作池。Sitting-Talking 拿掉了 —— 角色没在跟谁说话却比划个不停，
// 看起来轻浮，和"安静陪你自习"的定位不符。
const CLIP_POOL = [
  // 写字给的权重最高：她也在学，这是整个产品的主张
  { name: 'X Bot@Writing',   w: 8, cd: 25000 },
  { name: 'Look-Around',     w: 5, cd: 40000 },
  { name: 'Head-Nod-Yes',    w: 3, cd: 55000 },
  { name: 'Bored',           w: 2, cd: 90000 },
  { name: 'Breathing-Idle',  w: 2, cd: 90000 }
];
const clipLast = {};
let clipNext = 10 + Math.random() * 12;

/* 动作按"角色"匹配，不认死文件名 —— 你从 Mixamo 下什么名字都能用。
 * 候选按优先级排，找到第一个存在的就用。 */
const CLIP_ROLES = {
  praise:     ['thumbsup', 'clapping', 'cheer', 'happyidle', 'excited', 'headnod'],
  disappoint: ['handsonhips', 'angry', 'annoyed', 'arguing', 'dismiss', 'shakinghead', 'lookaround'],
  lonely:     ['sadidle', 'defeat', 'disappoint', 'bored', 'breathingidle'],
  welcome:    ['waving', 'happyidle', 'headnod', 'thumbsup'],
  lookAround: ['lookaround'],
  nod:        ['headnod'],
  study:      ['writing', 'typing']
};

const _norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function clipFor(role) {
  const cands = CLIP_ROLES[role] || [];
  const keys = Object.keys(clips);
  for (const c of cands) {
    const hit = keys.find(k => _norm(k).includes(c));
    if (hit) return hit;
  }
  return null;
}

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

  // 眨眼、口型、情绪统一归 expression.js 管，这里不再碰表情通道，
  // 否则两处会抢同一个 blink，互相把对方的值覆盖掉。

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
        if (a.t < dt * 2 && face) face.yawn(1.8);   // 只在动作开头触发一次
        idle.headTargetY = -0.12 * ease;
        break;
      case 'shift':
        if (bones.hips) bones.hips.rotation.y = rest.hips.y + 0.10 * ease;
        if (bones.spine) bones.spine.rotation.y = rest.spine.y - 0.06 * ease;
        break;
    }

    if (p >= 1) {

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
  if (mixer && !frozen) mixer.update(dt);
  if (face) face.update(dt);       // 冻结时表情照常跑，这是冻结的意义
  if (!frozen) updateIdle(dt);
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
let camOn = false;          // 用户是否要求开摄像头（和"连上了没有"是两回事）
let procRunning = false;    // 感知层子进程在不在

const LABEL_CN = {
  focus: '专注', away: '离席', backturn: '背对镜头', phone: '玩手机',
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
    console.log('[room] 感知层已连接');
    if (camOn) wsSend({ cmd: 'start' });
    if (pipOn) wsSend({ cmd: 'preview', on: true });
    paintCam();
  };

  ws.onclose = () => {
    $('pipLabel').textContent = '连接已断开';
    paintCam();
    retryWs();
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };

  ws.onmessage = (ev) => {
    // 二进制 = 画中人的一帧
    if (ev.data instanceof Blob) {
      if (!pipOn && !calibOpen) return;
      const url = URL.createObjectURL(ev.data);
      if (calibOpen) {
        const ci = $('calibImg'), cprev = calibBlob;
        ci.onload = () => { if (cprev) URL.revokeObjectURL(cprev); };
        ci.src = url;
        calibBlob = url;
        if (!pipOn) return;              // 只喂校准框，别再建一个 URL
      }
      if (pipOn) {
        const img = $('pipImg'), prev = lastBlob;
        img.onload = () => { if (prev && prev !== url) URL.revokeObjectURL(prev); };
        img.src = url;
        lastBlob = url;
      }
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
    if (!m.phone) console.warn('[room] 手机检测未启用，检查 perception/models/');
    paintCam();
  }
  if (m.type === 'state') {
    const cn = LABEL_CN[m.label] || m.label;
    $('pipLabel').textContent = `${cn} · ${m.duration.toFixed(0)}s`;
    if (m.label !== lastLabel) { lastLabel = m.label; paintCam(); }
    // 摄像头开着、第一次真的认出人：说一句「看到你了。」
    if (!greeted && camOn && (m.label === 'focus' || m.label === 'phone' || m.label === 'drowsy')) {
      greeted = true;
      speak('cameraOn', 2.6);
    }
    onState(m.label, m.duration || 0);
    // 联动先只做最轻的一层：认出你走了，角色抬头看一眼
    if (m.trigger && m.label === 'away') play('lookAway');
  }
  if (m.type === 'calibrating') say('保持你平时看书的姿势，15 秒…', 15000);
  if (m.type === 'calibrated') {
    say(m.ok ? '记住你的姿势了。' : ('标定失败：' + (m.reason || '')), 4000);
    if (calibOpen) {
      $('calibGo').disabled = false;
      $('calibMsg').textContent = m.ok
        ? `标定完成（采到 ${m.frames || 0} 帧）。可以关掉了。`
        : '标定失败：' + (m.reason || '没采到足够人脸，正对摄像头重试');
      if (m.ok) setTimeout(closeCalib, 1600);
    }
  }
  if (m.type === 'mode') $('calibTip').textContent =
    OUTLINES[calibMode].tip + `　（画面 ${m.size ? m.size.join('×') : ''}）`;
  if (m.type === 'snapshot') {
    const want = pendingShot;
    pendingShot = null;
    if (!m.ok || !session || !want) return;
    const id = shots.add('data:image/jpeg;base64,' + m.data,
                         { at: want.at, kind: m.tag || 'phone' });
    const ev = session.events[want.index];
    if (ev) ev.shot = id;      // 记录里只留 id，图片存在 shots 那边
  }
  if (m.type === 'error') say('摄像头出错：' + m.message, 5000);
}

/* 反应 = 表情 + 动作 + 台词，三样一起来才协调。
 * 动作用"角色"指定，缺哪个就退到候选里的下一个，缺光了就只做表情。 */
const REACTIONS = {
  praise:     { recipe: 'bigSmile',   level: 0.9,  hold: 4.0, role: 'praise',   voice: 'praise' },
  disappoint: { recipe: 'frown',      level: 0.85, hold: 5.0, role: 'disappoint', voice: 'phone' },
  lonely:     { recipe: 'sad',        level: 0.7,  hold: 4.5, role: 'lonely',   voice: 'away' },
  welcome:    { recipe: 'bigSmile',   level: 0.85, hold: 3.5, role: 'welcome',  voice: 'welcome' },
  sleepy:     { recipe: 'sleepy',     level: 0.8,  hold: 3.5, role: null, yawn: true, voice: 'sleepy' },
  puzzled:    { recipe: 'surprised',  level: 0.75, hold: 2.5, role: 'nod',      voice: 'puzzled' },
  // 背对镜头：感知层一直认得出，之前没有反应。语气是好奇不是难过。
  backturn:   { recipe: 'surprised',  level: 0.6,  hold: 3.0, role: 'lookAround', voice: 'backturn' },
  calm:       { recipe: 'gentleSmile', level: 0.5, hold: 3.0, role: null }
};

/** 播一条语音：字幕用同一条的原文，停留时长跟着音频走，口型也跟着音频走 */
function speak(kind, minHold) {
  const res = voice.play(kind, {
    onText: (t) => say(t, Math.max(2600, (minHold || 2.4) * 1000)),
    onMouth: (sec) => { if (face) face.talkAtLeast(sec); }
  });
  // 时长已知的话再校一次字幕：音频停了字幕还挂着，或者反过来，都很出戏
  if (res && res.seconds && res.text) say(res.text, res.seconds * 1000 + 1300);
  return res;
}

/**
 * 做一次反应：表情 + 动作 + 语音。
 * 第二个参数传 '' 可以强制不出声（待机小插曲用）。
 */
function react(name, silent) {
  const r = REACTIONS[name];
  if (!r || !face) return false;
  face.applyRecipeHold(r.recipe, r.level, r.hold);
  if (r.yawn) face.yawn(1.6);
  if (r.role) {
    const clip = clipFor(r.role);
    if (clip) playClip(clip);
  }
  if (r.voice && silent !== '') {
    // 字幕就是这条音频的原文，口型按音频真实时长走 ——
    // 两件事都由 voice 模块给，物理上不会对不上
    speak(r.voice, r.hold);
  }
  return true;
}

/* ---------------- 摄像头联动 ----------------
 * 原则：状态一变就反应会显得神经质。除了"遮挡镜头"这种明确信号，
 * 其余都要等持续够久才触发 —— 阈值全在 LINK 里，方便调。
 */
/* 全部用秒。以前是分钟，想调到 15 秒得写 0.25，很容易看错。
   现在这一组是**测试值**，演示前要按真实节奏调回去：
   专注 15~25 分钟、手机 1 分钟、离席 5 分钟。 */
const LINK = {
  focusPraiseSec: 60,      // 连续专注满这么久 → 开心夸你（之后每隔同样时间再夸一次）
  phoneScoldSec: 15,       // 玩手机满这么久 → 失望皱眉 + 抓拍
  awayLonelySec: 120,      // 离席满这么久 → 难过
  welcomeAfterAwaySec: 120,// 离席至少这么久，回来才值得说"你回来了"
  reactCooldownSec: 20,    // 任意两次大反应之间的最小间隔
  cuteGapMin: [4, 9]       // 待机小插曲（犯困/疑惑）的随机间隔，分钟
};

// 当前这一段连续状态
let greeted = false;          // 这一场是否已经打过招呼
let epLabel = null, epFired = {}, epNextAt = {};
let lastAwaySec = 0;          // 上一段离席持续了多久
let lastReactAt = 0;
let cuteAt = 0;               // 下一次待机小插曲的时间

function canReact() {
  return Date.now() - lastReactAt > LINK.reactCooldownSec * 1000;
}
// 反应名 → 记进事件时间线时用的类型
const EVENT_KIND = {
  disappoint: 'phone', lonely: 'away', sleepy: 'drowsy',
  puzzled: 'covered', praise: 'praise', welcome: 'back',
  backturn: 'backturn'
};

/** 抓拍：等服务端把图送回来时，知道该挂到哪条事件上 */
let pendingShot = null;

function fire(name, line) {
  if (!canReact()) return false;
  lastReactAt = Date.now();
  // 玩手机被提醒的这一刻抓一张留证。摄像头没开就没有画面，跳过。
  if (name === 'disappoint' && session && camOn) {
    pendingShot = { at: Date.now(), index: session.events.length };
    wsSend({ cmd: 'snapshot', tag: 'phone' });
  }
  if (session && EVENT_KIND[name]) {
    const kind = EVENT_KIND[name];
    session.events.push({
      t: Math.round((Date.now() - session.startedAt) / 1000),   // 距开场多少秒
      kind,
      dur: Math.round(epDur)                                     // 触发时已经持续了多久
    });
    // 点数就挂在这儿：她做出反应和账上记一笔，是同一个事件。
    // 另起一套状态机去数同一串信号，两本账迟早会分家。
    if (window.TZPoints) window.TZPoints.award(kind);
  }
  react(name, line);
  return true;
}

/** 每条 state 消息都会走这里。duration 由感知层给，是当前标签的连续秒数。 */
function onState(label, duration) {
  // 没在自习就只更新界面，不做反应也不记账。
  // 准备页上摄像头可以先开着对位置，但她不该在那儿就开始夸你或者念你。
  if (!session) { epLabel = label; epDur = duration; return; }
  // 换段了：结算上一段
  if (label !== epLabel) {
    if (epLabel === 'away') lastAwaySec = epDur;
    // 上一段结束了，把它的时长记到账上
    if (session && epLabel && epDur > 0) {
      session.byLabel[epLabel] = (session.byLabel[epLabel] || 0) + epDur;
    }
    if (session) {
      if (label === 'away') session.awayCount++;
      if (label === 'phone' || label === 'drowsy') session.distractCount++;
    }
    // 离席够久再回到专注，才值得说"你回来了"
    if (label === 'focus' && lastAwaySec >= LINK.welcomeAfterAwaySec) {
      lastAwaySec = 0;
      fire('welcome');
    } else if (label === 'covered') {
      fire('puzzled');            // 遮挡是明确信号，不用等
    } else if (label === 'backturn') {
      fire('backturn');           // 人还在，只是转过去了
    } else if (label === 'focus') {
      if (face) face.clearEmotion();   // 回到待机，表情交给微表情系统
    }
    epLabel = label;
    epFired = {};
    epNextAt = {};
    scheduleCute();
  }
  epDur = duration;

  // 持续够久才触发的那几条
  if (label === 'focus' && duration >= (epNextAt.praise ?? LINK.focusPraiseSec)) {
    if (fire('praise')) epNextAt.praise = duration + LINK.focusPraiseSec;
  }
  if (label === 'phone' && duration >= (epNextAt.phone ?? LINK.phoneScoldSec)) {
    if (fire('disappoint')) epNextAt.phone = duration + LINK.phoneScoldSec;
  }
  if (label === 'away' && duration >= (epNextAt.away ?? LINK.awayLonelySec)) {
    if (fire('lonely')) epNextAt.away = duration + LINK.awayLonelySec * 2;
  }
  if (label === 'drowsy' && !epFired.drowsy) {
    epFired.drowsy = true;
    fire('sleepy');
  }

  // 待机小插曲：专注时偶尔犯个困、疑惑一下，显得像个人而不是监控探头
  if (label === 'focus' && Date.now() > cuteAt && canReact()) {
    scheduleCute();
    lastReactAt = Date.now();
    // 待机时不说话，只做表情和小动作，外加一声没有词的气音 ——
    // 句句有声反而像监控探头
    const pick = Math.random() < 0.55 ? 'sleepy' : 'puzzled';
    react(pick, '');
    voice.play(pick === 'sleepy' ? 'yawn' : 'hum', {});
  }
}
let epDur = 0;

function scheduleCute() {
  const [a, b] = LINK.cuteGapMin;
  cuteAt = Date.now() + (a + Math.random() * (b - a)) * 60000;
}

/* 用户是不是想要画中人。收工时会把画中人关掉（否则摄像头一暂停，
   最后一帧就冻在右下角，看着像一张照片粘在那儿），
   但下一场开始时要自动开回来 —— 关它是我们的技术决定，不是用户的意思。 */
let pipWanted = false;

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



/* ---------------- 摄像头开关与重连 ---------------- */
/* 状态有三层，界面要说清楚是哪一层出问题：
 *   1. 感知层进程在不在（Electron 自己拉起来的）
 *   2. WebSocket 通没通
 *   3. 摄像头是不是被要求开着
 * 之前只显示"摄像头未连接"，看不出到底卡在哪一层。 */
function camState() {
  const wsOk = ws && ws.readyState === 1;
  if (!procRunning) return { dot: false, text: '感知层未启动', btn: '启动' };
  if (!wsOk) return { dot: false, text: '连接中…', btn: '启动' };
  if (!camOn) return { dot: false, text: '摄像头已就绪（未开启）', btn: '开启' };
  return { dot: true, text: lastLabel ? ('识别：' + (LABEL_CN[lastLabel] || lastLabel)) : '摄像头已开启',
           btn: '关闭' };
}

function paintCam() {
  const st = camState();
  $('camDot2').classList.toggle('on', st.dot);
  $('camText').textContent = st.text;
  const b = $('btnCam');
  b.textContent = st.btn;
  b.classList.toggle('on', camOn && st.dot);
}

// 主进程会广播感知层子进程的生死，收一下
if (window.tz && window.tz.onBus) {
  window.tz.onBus((msg) => {
    if (!msg || msg.type !== 'perception-proc') return;
    procRunning = !!msg.running;
    paintCam();
    if (msg.log && msg.log.length) console.log('[perception]', msg.log[msg.log.length - 1]);
  });
}

async function refreshProc() {
  if (!(window.tz && window.tz.perception)) return;
  try {
    const s = await window.tz.perception.status();
    procRunning = !!s.running;
  } catch (e) { procRunning = false; }
  paintCam();
}

async function toggleCam() {
  const btn = $('btnCam');
  btn.disabled = true;
  try {
    if (!procRunning) {
      $('camText').textContent = '正在启动感知层…';
      await window.tz.perception.start();
      await refreshProc();
      setTimeout(connectPerception, 1200);   // 给服务端一点起身时间
      camOn = true;
    } else if (!camOn) {
      camOn = true;
      if (!wsSend({ cmd: 'start' })) connectPerception();
    } else {
      camOn = false;
      greeted = false;
      wsSend({ cmd: 'pause' });              // 真正释放摄像头，不是软暂停
      if (pipOn) setPip(false);
    }
  } finally {
    btn.disabled = false;
    paintCam();
  }
}

async function reloadCam() {
  const btn = $('btnCamReload');
  btn.disabled = true;
  $('camText').textContent = '正在重启感知层…';
  try {
    if (ws) { try { ws.close(); } catch (e) {} }
    await window.tz.perception.restart();
    await refreshProc();
    setTimeout(() => { connectPerception(); }, 1400);
  } finally {
    setTimeout(() => { btn.disabled = false; paintCam(); }, 1600);
  }
}

/* ---------------- 摄像头校准 ---------------- */
/* 轮廓线不是相机控制，是给人看的定位参考——摄像头不支持变焦
 * （实测 CAP_PROP_ZOOM 设置失败），纵向视野是镜头定死的，
 * 想拍到桌面只能物理挪。轮廓线告诉用户挪到什么程度。 */

// viewBox 320x180，和预览图的 16:9 对齐
const OUTLINES = {
  office: {
    // 电脑办公：头肩占中间，像证件照的取景框
    svg: `
      <ellipse cx="160" cy="72" rx="34" ry="43"/>
      <path d="M104,180 C106,140 128,120 160,120 C192,120 214,140 216,180"/>
      <line x1="160" y1="8" x2="160" y2="24" class="tick"/>
      <text x="160" y="172" class="lb">头肩落在框里就行</text>`,
    tip: '让脸清楚地落在椭圆里，肩膀大致贴着下面的弧线'
  },
  desk: {
    // 桌面读写：头要更小更靠上，给手臂和桌面留出下半张画面
    svg: `
      <ellipse cx="160" cy="50" rx="25" ry="31"/>
      <path d="M112,128 C116,96 134,84 160,84 C186,84 204,96 208,128"/>
      <path d="M112,128 C92,134 72,146 62,168" class="arm"/>
      <path d="M208,128 C228,134 248,146 258,168" class="arm"/>
      <line x1="16" y1="150" x2="304" y2="150" class="desk"/>
      <text x="160" y="166" class="lb">桌沿要在这条线附近</text>
      <line x1="160" y1="8" x2="160" y2="20" class="tick"/>`,
    tip: '头缩到上半部分，两只手臂和桌面都要进画面'
  }
};

let calibMode = 'office';
let calibOpen = false;
let calibBlob = null;
let calibTimer = null;

function renderOutline() {
  const o = OUTLINES[calibMode];
  $('calibSvg').innerHTML = `
    <defs><style>
      ellipse,path{fill:none;stroke:#7fd39a;stroke-width:1.6;stroke-dasharray:6 4}
      path.arm{stroke:#7fd39a;stroke-width:1.4;stroke-dasharray:4 5;opacity:.75}
      line.desk{stroke:#e0b366;stroke-width:1.4;stroke-dasharray:8 5}
      line.tick{stroke:#7fd39a;stroke-width:1.4}
      text.lb{fill:#9fb0a6;font-size:8px;text-anchor:middle;font-family:monospace}
    </style></defs>${o.svg}`;
  $('calibTip').textContent = o.tip;
  document.querySelectorAll('[data-mode]').forEach(b =>
    b.classList.toggle('on', b.getAttribute('data-mode') === calibMode));
}

/* 校准现在是一个界面，显隐由 home.js 的 show() 统一管
   （和设置页、商店一样）。这里只负责感知层那一半。 */
let onCalibExit = null;

function openCalib() {
  calibOpen = true;
  renderOutline();
  $('calibMsg').textContent = '对好位置后点右边，保持姿势 15 秒';
  if (!wsSend({ cmd: 'preview', on: true })) {
    $('calibTip').textContent = '感知层没连上，先启动 perception/server.py';
  }
}

function closeCalib() {
  calibOpen = false;
  if (calibTimer) { clearInterval(calibTimer); calibTimer = null; }
  if (calibBlob) { URL.revokeObjectURL(calibBlob); calibBlob = null; }
  // 校准时是临时开的预览，关掉时按用户原来的意愿恢复
  wsSend({ cmd: 'preview', on: pipOn });
  $('calib').classList.remove('on');       // 调试条那条路径没走 show()，兜一下
  if (onCalibExit) onCalibExit();          // 回到准备一下
}

function startCalib() {
  if (!wsSend({ cmd: 'calibrate', seconds: 15 })) {
    $('calibMsg').textContent = '感知层没连上';
    return;
  }
  let left = 15;
  $('calibGo').disabled = true;
  $('calibMsg').textContent = `保持姿势不要动… ${left}`;
  calibTimer = setInterval(() => {
    left -= 1;
    $('calibMsg').textContent = left > 0 ? `保持姿势不要动… ${left}` : '正在计算基线…';
    if (left <= 0) { clearInterval(calibTimer); calibTimer = null; }
  }, 1000);
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
//
// 每张图里桌沿（木面和地面的分界线）在原图纵向的位置，量出来的。
// 这条线以下是桌面，以上是房间。
const FG_EDGE_DEFAULT = 0.86;
const FG_EDGE = {
  '01-自习室夜': 0.852,
  '02-图书馆':   0.866,
  '03-咖啡馆':   0.893,
  '04-卧室夜':   0.900   // 自动量出来是 0.705，那是床沿不是桌沿，手动改
};
// 把桌沿抬到画面的哪个高度。原图只有 13%~15% 的桌面，读起来像个下边框；
// 抬到 0.68 就有三分之一画面是桌子，人被切在胸口下方 ——
// 这就是"和她拼一张桌子"的观感，顺带把腿彻底藏了。
const DESK = { screenTop: 0.72, aoHeight: 0.12 };
const fgEdgeOf = (name) => FG_EDGE[name] ?? FG_EDGE_DEFAULT;

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

/* 前景桌面：把原图底部那条桌面放大、贴着底边对齐，
 * 让桌沿落在 DESK.screenTop 上。
 *
 * 背景层是 cover，前景层是放大过的同一张图，两者不再对齐 —— 这是故意的：
 * 放大后的桌子读作"离你更近的那张桌子"，正好就是你自己坐的这张。
 * 只要前景完全盖住背景里那张桌子（放大后必然盖住），就不会露出两条桌沿。 */
function sizeDesk(s) {
  const fg = $('fg'), box = fg.getBoundingClientRect();
  if (!box.height) return;
  const edge = fgEdgeOf(s.name);          // 桌沿在原图的纵向位置
  const img = { w: 1920, h: 1081 };       // 四张场景图都是这个尺寸

  // 贴底对齐时，桌沿到底边的距离 = 渲染高度 × (1 - edge)
  // 要它等于屏幕上的 (1 - screenTop) × 视口高
  const need = (1 - DESK.screenTop) * box.height / (1 - edge);
  const scale = need / img.h;
  fg.style.backgroundSize = `${(img.w * scale / box.width * 100).toFixed(1)}% auto`;
  fg.style.backgroundPosition = 'center bottom';
  fg.style.clipPath = `inset(${(DESK.screenTop * 100).toFixed(1)}% 0 0 0)`;
  fg.style.filter = `brightness(${(comp.brightness * 0.94).toFixed(2)}) saturate(${comp.saturate})`;

  // 接触阴影：紧贴桌沿往上化开
  const ao = $('deskAO');
  ao.style.display = 'block';
  ao.style.bottom = `${((1 - DESK.screenTop) * 100).toFixed(1)}%`;
  ao.style.height = `${(DESK.aoHeight * 100).toFixed(1)}%`;
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
    // 注意是 'block' 不是 ''：#fg 的 CSS 基础规则是 display:none，
    // 清空内联样式会回落回 none —— 这层遮挡以前一直没生效就是栽在这儿。
    fg.style.display = 'block';
    fg.style.backgroundImage = `url("${s.img}")`;
    sizeDesk(s);
  } else {
    fg.style.display = 'none';
    $('deskAO').style.display = 'none';
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
  // 弹了气泡却不张嘴，看起来是"字幕"不是"说话"。按字数估个时长。
  // 中文大约每秒 4–5 个字。下限 1.4 秒 —— 太短的话嘴一闪就停，
  // 看起来还是"只在笑"，这正是之前的问题。
  if (face && text) face.talk(Math.max(1.4, Math.min(4.5, 0.5 + text.length * 0.19)));
}

/* 会话计时（巡查逻辑下一步接上） */
let session = null;
const sessionEndCbs = [];

function startSession(opts) {
  const min = (opts && opts.minutes) || Number($('fMin').value) || 25;
  session = { startedAt: Date.now(), plannedMin: min, focusMs: 0,
              awayCount: 0, distractCount: 0,
              // 每个状态累计待了多久（秒），比"次数"有用得多
              byLabel: {},
              // 触发过提醒的时刻，详情页的时间线就是它
              events: [] };
  if (window.TZPoints) window.TZPoints.startSession({ plannedMin: min });
  $('stateText').textContent = '自习中';
  $('fMin').value = min;
  // 进了自习室就把摄像头这条线接上（用户没开摄像头也不影响其余部分）
  wsSend({ cmd: 'start' });
  // 感知层那边也清零 —— 准备页上摄像头可能已经开了一会儿，
  // 不清的话一进来"专注"就已经是几十秒了
  wsSend({ cmd: 'reset' });
  epLabel = null; epDur = 0; epFired = {}; epNextAt = {};
  lastAwaySec = 0; lastReactAt = 0;
  $('focusText').textContent = '0';
  $('pipLabel').textContent = '—';
  if (pipWanted && !pipOn) setPip(true);
  speak('sessionStart', 3.2);
}
function stopSession(reason) {
  if (!session) return;
  // 最后一段也要结算
  if (epLabel && epDur > 0) {
    session.byLabel[epLabel] = (session.byLabel[epLabel] || 0) + epDur;
  }
  const secs = session.byLabel;
  const elapsedMin = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
  // 没开摄像头时 byLabel 是空的，focusMin 会算成 0，日历上就成了"专注 0 分钟"。
  // 没有摄像头就是没有证据，这时候按坐满算 —— 记成 0 比记成满更离谱。
  const sawAnything = Object.keys(secs).length > 0;
  const focusMin = sawAnything ? Math.round((secs.focus || 0) / 60) : elapsedMin;
  const summary = {
    reason: reason || 'manual',
    startedAt: session.startedAt,
    elapsedMin,
    focusMin,
    awayMin: Math.round((secs.away || 0) / 60),
    phoneMin: Math.round((secs.phone || 0) / 60),
    drowsyMin: Math.round((secs.drowsy || 0) / 60),
    awayCount: session.awayCount,
    distractCount: session.distractCount,
    events: session.events.slice(),
    plannedMin: session.plannedMin
  };
  // 点数结算。放在 summary 组好之后 —— 结算页要用到专注时长。
  summary.points = window.TZPoints
    ? window.TZPoints.endSession(summary.reason, { focusMin, elapsedMin })
    : null;
  const planned = summary.reason === 'planned';
  session = null;
  $('stateText').textContent = '已结束';
  // 收工这句要跟着 summary 走：回主界面会把浮动字幕清掉（show 里的 say('')），
  // 音频却还在放，两边就对不上了。所以把原文交给结算页去显示。
  const spoken = speak(planned ? 'sessionFinish' : 'sessionEarlyEnd', 3.2);
  summary.line = spoken ? spoken.text : '';
  wsSend({ cmd: 'pause' });          // 收工就把摄像头放开
  // 摄像头一暂停，画中人的最后一帧会冻在右下角，看着像一张照片粘住了。
  // 关掉它，但 pipWanted 留着 —— 下一场开始会自动开回来。
  if (pipOn) setPip(false);
  greeted = false;
  sessionEndCbs.forEach(fn => { try { fn(summary); } catch (e) { console.error(e); } });
}
setInterval(() => {
  if (!session) return;
  const m = Math.floor((Date.now() - session.startedAt) / 60000);
  $('focusText').textContent = m;
  if (window.TZPoints) {
    const sn = window.TZPoints.snapshot();
    $('coinText').textContent = sn.balance;
    const d = sn.session ? sn.session.delta : 0;
    $('deltaText').textContent = (d > 0 ? '+' : '') + d;
    $('deltaText').className = d > 0 ? 'up' : (d < 0 ? 'down' : '');
  }
  if (m >= session.plannedMin) stopSession('planned');
}, 1000);

// 调试条那两个按钮以前也叫 btnStart/btnStop，和主界面的撞了 id ——
// getElementById 只返回第一个，调试条的按钮其实一直是死的。
$('btnStartDebug').addEventListener('click', startSession);
$('btnStopDebug').addEventListener('click', stopSession);
$('btnReload').addEventListener('click', () => loadModel());
$('btnScene').addEventListener('click', () => applyScene(sceneIdx + 1));
// 表情调试条：调表情时最好把身体冻住，不然动作会盖过表情
$('btnFreeze').addEventListener('click', function () {
  const v = window.TZRoom.freeze();
  this.classList.toggle('on', v);
  this.textContent = v ? '恢复动作' : '冻结动作';
});
document.querySelectorAll('[data-react]').forEach(b => {
  b.addEventListener('click', () => react(b.getAttribute('data-react')));
});
$('btnTalk').addEventListener('click', () => face && face.talk(2.5));
$('btnHideExpr').addEventListener('click', () => document.body.classList.add('noexpr'));

/* 语音：静音键和逐条试听 */
function paintMute() {
  const m = voice.isMuted();
  $('btnMute').textContent = m ? '取消静音' : '静音';
  const h = $('btnMuteHome');
  h.textContent = m ? '♪ 静音' : '♪ 有声';
  h.classList.toggle('off', m);
}
function toggleMute() { voice.setMuted(!voice.isMuted()); paintMute(); }
$('btnMute').addEventListener('click', toggleMute);
$('btnMuteHome').addEventListener('click', toggleMute);
paintMute();

// 试听：按顺序把每一类都放一条，字幕跟着走
const VOICE_KINDS = ['sessionStart', 'cameraOn', 'praise', 'phone', 'away',
                     'welcome', 'sleepy', 'puzzled', 'backturn',
                     'sessionFinish', 'sessionEarlyEnd'];
let vkIdx = 0;
$('btnVoiceTest').addEventListener('click', () => {
  const kind = VOICE_KINDS[vkIdx % VOICE_KINDS.length];
  vkIdx++;
  $('btnVoiceTest').textContent = '试听 ' + kind;
  voice.play(kind, {
    onText: (t) => say(t || '（无字音效）', 3200),
    onMouth: (sec) => { if (face) face.talkAtLeast(sec); }
  });
});

$('btnCam').addEventListener('click', toggleCam);
$('btnCamReload').addEventListener('click', reloadCam);
// 调试条里的入口：自习中也能重新校准。正常动线是准备页里那个按钮。
$('btnCalib').addEventListener('click', () => {
  $('calib').classList.add('on');
  openCalib();
});
$('calibCancel').addEventListener('click', closeCalib);
$('calibGo').addEventListener('click', startCalib);
document.querySelectorAll('[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    calibMode = b.getAttribute('data-mode');
    renderOutline();
    wsSend({ cmd: 'mode', mode: calibMode });
  });
});
$('btnPip').addEventListener('click', () => { pipWanted = !pipOn; setPip(pipWanted); });
$('pipClose').addEventListener('click', () => { pipWanted = false; setPip(false); });
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
// 启动时加载设置里选的那个人；文件不在了就退回目录里的第一个
(async () => {
  if (!(await loadModel(settings.modelPath()))) await loadModel();
  // 音频包按角色分。目前只有女生有；男生和老师没有包，退化成只出字幕。
  voice.setCharacter(settings.get().model);
  voice.warmup();          // 先把时长量出来，第一次触发口型就是准的
  shots.prune();           // 抓拍只留 7 天，启动时清一次
})();

// 用户不该为了用摄像头去手动开一个 Python 进程 —— 启动时自己拉起来。
// 但摄像头本身默认不开，等用户点「开启」（隐私上的默认值）。
(async () => {
  if (window.tz && window.tz.perception) {
    await window.tz.perception.start();
    await refreshProc();
  }
  setTimeout(connectPerception, 1200);
  paintCam();
})();

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
  face: () => (face ? face.dump() : null),
  emote: (n, lv, hold) => face && face.play(n, lv ?? 0.8, hold ?? 3),
  talk: (sec) => face && face.talk(sec ?? 2),
  yawn: () => face && face.yawn(),
  onState,
  link: LINK,
  linkState: () => ({ label: epLabel, dur: epDur, fired: epFired, next: epNextAt,
                      lastAwaySec, cooldownLeft: Math.max(0,
                        LINK.reactCooldownSec * 1000 - (Date.now() - lastReactAt)) / 1000 }),
  reactAs: react,
  shots,
  voice: {
    play: (kind) => voice.play(kind, {
      onText: (t) => say(t, 3200),
      onMouth: (sec) => { if (face) face.talkAtLeast(sec); }
    }),
    setCharacter: (m) => { const c = voice.setCharacter(m); voice.warmup(); return c; },
    mute: (v) => { const r = voice.setMuted(v); paintMute(); return r; },
    muted: voice.isMuted,
    volume: voice.setVolume,
    stop: voice.stop,
    durations: voice.knownDurations
  },
  reactions: () => Object.keys(REACTIONS),
  clipFor,
  freeze: (v) => {
    frozen = v === undefined ? !frozen : !!v;
    if (mixer && baseAction) {
      if (frozen) {
        if (oneShot) { oneShot.stop(); oneShot = null; }
        baseAction.reset().play();
        mixer.update(0.001);      // 回到第一帧再定住，姿势干净
        baseAction.paused = true;
      } else {
        baseAction.paused = false;
      }
    }
    return frozen;
  },
  morph: (n, v) => face && face.setMorph(n, v, 8),
  recipe: (n, lv) => face && face.applyRecipe(n, lv ?? 1),
  pip: setPip,
  calib: (m) => { if (m) { calibMode = m; } openCalib(); },
  onCalibExit: (fn) => { onCalibExit = fn; },
  closeCalib,
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
  startSession,
  endSession: (why) => stopSession(why || 'manual'),
  onSessionEnd: (fn) => sessionEndCbs.push(fn),
  sessionInfo: () => (session ? { ...session } : null),
  scene: applyScene,
  scenes: () => SCENES.map(s => s.name),
  reloadScenes: () => loadScenes().then(() => applyScene(0)),
  // 实时调合成参数，调好了我把数值固化进代码
  comp: (patch) => { Object.assign(comp, patch || {}); applyComp(); return { ...comp }; },
  frame: (patch) => { Object.assign(framing, patch || {}); frameCamera(); return { ...framing }; },
  deskTop: (v) => { DESK.screenTop = v; applyScene(sceneIdx); return v; },
  deskAO:  (v) => { DESK.aoHeight = v; applyScene(sceneIdx); return v; },
  anchorAt: (v) => { framing.anchorAt = v; frameCamera(); return v; },
  headAt: (v) => { framing.headAt = v; frameCamera(); return v; },
  info: () => ({
    loaded: !!vrm,
    mixamo: useMixamo,
    clips: Object.keys(clips),
    expressions: vrm && vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap || {}) : [],
    bones: bones ? Object.keys(bones).filter(k => bones[k]) : []
  })
};
