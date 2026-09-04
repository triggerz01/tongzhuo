/* expression.js — 表情与口型
 *
 * VRM 自带 14 个表情通道，之前只用了 blink 一个，脸是死的。
 * 这里把它们组织成三层，互不打架：
 *
 *   情绪层  happy / angry / sad / relaxed / surprised —— 互斥，交叉淡入淡出
 *   口型层  aa / ih / ou / ee / oh —— 说话时循环，平时闭着
 *   眨眼层  blink —— 完全独立，任何情绪下都照眨
 *
 * 每个通道都是"当前值朝目标值缓动"，不会有瞬间跳变。
 */
'use strict';

const EMOTIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

/* 情绪配方：直接调分区形变，不用 VRM 的预设。
 *
 * 为什么：这个模型的预设每个只绑了一个"整脸合成"形变（happy → Fcl_ALL_Joy），
 * 眉眼嘴一起拉满，没有中间态 —— 想要"微微一笑但眼睛还睁着"根本做不到，
 * 这就是表情显得怪的原因。而模型里有 38 个分区形变可以单独控制
 * （眉 5 / 眼 14 / 嘴 19），自己配就能要多细有多细。
 *
 * 分区形变没有被任何预设绑定，所以直接写 morphTargetInfluences
 * 不会和 VRM 的表情管理器打架。
 */
const RECIPES = {
  // 待机时的默认表情：只动嘴角和眉毛一点点，眼睛完全不参与。
  // 「微笑但不要眯眯眼」—— 眯眼笑看久了会腻，也不适合长时间挂着。
  gentleSmile: { Fcl_BRW_Joy: 0.25, Fcl_MTH_Joy: 0.35 },
  // 淡淡的满意：眼睛只给一点点
  happy:     { Fcl_BRW_Joy: 0.45, Fcl_MTH_Joy: 0.55, Fcl_EYE_Joy: 0.15 },
  // 皱眉：眉头压下来 + 嘴角绷住，是"不高兴"不是"要吵架"
  frown:     { Fcl_BRW_Angry: 0.75, Fcl_MTH_Angry: 0.3, Fcl_MTH_Down: 0.25, Fcl_EYE_Angry: 0.25 },
  // 真的笑起来才闭眼
  bigSmile:  { Fcl_BRW_Joy: 0.7,  Fcl_MTH_Joy: 0.9,  Fcl_EYE_Joy: 0.75 },
  // 失望，不是生气：眉毛垮下来，嘴角下沉，眼睛还看着你
  sad:       { Fcl_BRW_Sorrow: 0.65, Fcl_MTH_Sorrow: 0.4, Fcl_EYE_Sorrow: 0.22 },
  angry:     { Fcl_BRW_Angry: 0.7,  Fcl_MTH_Angry: 0.35, Fcl_EYE_Angry: 0.3 },
  surprised: { Fcl_BRW_Surprised: 0.8, Fcl_EYE_Surprised: 0.55, Fcl_MTH_Surprised: 0.45 },
  // 放松：几乎只有嘴角一点点，用来做微表情
  relaxed:   { Fcl_BRW_Fun: 0.3, Fcl_MTH_Fun: 0.35 },
  // 困：眉毛垮 + 眼睛半闭
  sleepy:    { Fcl_BRW_Sorrow: 0.35, Fcl_EYE_Close: 0.45, Fcl_MTH_Sorrow: 0.15 }
};

export class Expressions {
  constructor(vrm) {
    this.vrm = vrm;
    this.mgr = vrm && vrm.expressionManager ? vrm.expressionManager : null;
    this.available = new Set(
      this.mgr ? Object.keys(this.mgr.expressionMap || {}) : []
    );

    // 分区形变索引：名字 → [{mesh, index}, ...]（一个名字可能出现在多个 mesh 上）
    this.morphs = new Map();
    if (vrm && vrm.scene) {
      vrm.scene.traverse((o) => {
        if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        for (const name in o.morphTargetDictionary) {
          const idx = o.morphTargetDictionary[name];
          if (!this.morphs.has(name)) this.morphs.set(name, []);
          this.morphs.get(name).push({ mesh: o, index: idx });
        }
      });
    }
    // 有分区形变就用配方，否则退回 VRM 预设
    this.useRecipes = this.morphs.has('Fcl_BRW_Joy') && this.morphs.has('Fcl_MTH_Joy');
    this.mch = {};   // 分区形变的缓动状态

    /** name -> {cur, target, speed} */
    this.ch = {};

    // 眨眼
    this.blinkNext = 2 + Math.random() * 4;
    this.blinkPhase = -1;
    this.blinkDouble = false;

    // 说话口型
    this.talkUntil = 0;
    this.visemeNext = 0;
    this.viseme = null;
    this.yawnUntil = 0;     // 哈欠期间不让口型循环抢 aa

    // 情绪
    this.emotion = null;
    this.emotionUntil = 0;

    // 微表情：脸不能长时间一动不动
    this.microNext = 6 + Math.random() * 10;
  }

  has(name) { return this.available.has(name); }

  /** 直接设一个分区形变的目标值 */
  setMorph(name, target, speed = 5) {
    if (!this.morphs.has(name)) return;
    const c = this.mch[name] || (this.mch[name] = { cur: 0, target: 0, speed: 5 });
    c.target = Math.max(0, Math.min(1, target));
    c.speed = speed;
  }

  /** 按配方铺一组分区形变，配方里没提到的归零 */
  applyRecipe(name, level = 1, speed = 4) {
    const r = RECIPES[name];
    if (!r) return false;
    const wanted = new Set(Object.keys(r));
    for (const k in this.mch) if (!wanted.has(k)) this.setMorph(k, 0, speed * 0.8);
    for (const k in r) this.setMorph(k, r[k] * level, speed);
    return true;
  }

  /** 设一个通道的目标值。speed 是每秒变化量。 */
  set(name, target, speed = 5) {
    if (!this.has(name)) return;
    const c = this.ch[name] || (this.ch[name] = { cur: 0, target: 0, speed: 5 });
    c.target = Math.max(0, Math.min(1, target));
    c.speed = speed;
  }

  /**
   * 播一个情绪：淡入 → 保持 → 淡出。
   * @param {string} name  happy|angry|sad|relaxed|surprised
   * @param {number} level 0–1
   * @param {number} hold  保持秒数
   */
  play(name, level = 0.8, hold = 2.5) {
    if (this.useRecipes && RECIPES[name]) {
      for (const e of EMOTIONS) this.set(e, 0, 6);   // 预设让位给配方
      this.applyRecipe(name, level);
    } else {
      if (!this.has(name)) return false;
      for (const e of EMOTIONS) if (e !== name) this.set(e, 0, 3);
      this.set(name, level, 4);
    }
    this.emotion = name;
    this.emotionUntil = performance.now() / 1000 + hold;
    return true;
  }

  /** 播一个配方并保持一段时间，到期自动收回 */
  applyRecipeHold(recipe, level = 0.8, hold = 3) {
    if (this.useRecipes && RECIPES[recipe]) {
      for (const e of EMOTIONS) this.set(e, 0, 6);
      this.applyRecipe(recipe, level);
      this.emotion = recipe;
      this.emotionUntil = performance.now() / 1000 + hold;
      return true;
    }
    // 没有分区形变的模型：退回最接近的预设
    const fallback = { gentleSmile: 'happy', bigSmile: 'happy', frown: 'angry',
                       sleepy: 'sad' }[recipe] || recipe;
    return this.play(fallback, level, hold);
  }

  /** 情绪立刻收回 */
  clearEmotion(speed = 2.5) {
    for (const e of EMOTIONS) this.set(e, 0, speed);
    for (const k in this.mch) this.setMorph(k, 0, speed);
    this.emotion = null;
  }

  /**
   * 说话：在这段时间里循环口型。
   * 之所以要有这个 —— 角色弹了气泡却不张嘴，看起来是"字幕"不是"说话"。
   */
  talk(seconds = 2.0) {
    const now = performance.now() / 1000;
    if (now < this.yawnUntil) return;      // 正在打哈欠，不插话
    this.talkUntil = now + Math.max(0.3, seconds);
    this.visemeNext = 0;
  }

  stopTalk() {
    this.talkUntil = 0;
    for (const v of VISEMES) this.set(v, 0, 10);
    this.viseme = null;
  }

  /** 打哈欠：嘴大张 + 眯眼，1 秒左右 */
  yawn(seconds = 1.6) {
    // 先把说话停掉，否则口型循环会把 aa 覆盖成别的音（实测踩到）
    this.stopTalk();
    this.yawnUntil = performance.now() / 1000 + seconds + 0.4;
    this.set('aa', 0.95, 2.5);
    this.blinkPhase = -1;
    this.set('blink', 0.85, 3);
    setTimeout(() => {
      this.set('aa', 0, 1.6);
      this.set('blink', 0, 4);
    }, seconds * 1000);
  }

  update(dt) {
    if (!this.mgr) return;
    const now = performance.now() / 1000;

    /* ---- 眨眼：随机间隔 + 28% 概率连眨两下 ---- */
    if (this.blinkPhase < 0) {
      this.blinkNext -= dt;
      if (this.blinkNext <= 0) {
        this.blinkPhase = 0;
        this.blinkNext = 2.2 + Math.random() * 4.2;
        this.blinkDouble = Math.random() < 0.28;
      }
    } else {
      this.blinkPhase += dt;
      const d = 0.13;
      const v = this.blinkPhase < d / 2
        ? this.blinkPhase / (d / 2)
        : 1 - (this.blinkPhase - d / 2) / (d / 2);
      this._raw('blink', Math.max(0, Math.min(1, v)));
      if (this.blinkPhase >= d) {
        this._raw('blink', 0);
        if (this.blinkDouble) { this.blinkDouble = false; this.blinkPhase = 0; }
        else this.blinkPhase = -1;
      }
    }

    /* ---- 口型 ---- */
    if (now < this.yawnUntil) {
      // 哈欠优先，什么都不做
    } else if (now < this.talkUntil) {
      this.visemeNext -= dt;
      if (this.visemeNext <= 0) {
        // 每 90–160ms 换一个口型，幅度也随机，才像在说话而不是机械开合
        this.visemeNext = 0.09 + Math.random() * 0.07;
        const pick = VISEMES[Math.floor(Math.random() * VISEMES.length)];
        for (const v of VISEMES) this.set(v, v === pick ? 0.35 + Math.random() * 0.5 : 0, 16);
        this.viseme = pick;
      }
    } else if (this.viseme) {
      this.stopTalk();
    }

    /* ---- 情绪到期自动收回 ---- */
    if (this.emotion && now > this.emotionUntil) this.clearEmotion();

    /* ---- 微表情：没有情绪时，偶尔轻轻动一下，别让脸冻住 ---- */
    if (!this.emotion && now >= this.talkUntil) {
      this.microNext -= dt;
      if (this.microNext <= 0) {
        this.microNext = 8 + Math.random() * 14;
        // 待机时挂一个很淡的微笑，偶尔轻轻起伏，而不是在几种情绪间乱跳
        this.applyRecipeHold('gentleSmile', 0.35 + Math.random() * 0.25,
                             3 + Math.random() * 3);
      }
    }

    /* ---- 所有通道朝目标缓动 ---- */
    for (const name in this.ch) {
      const c = this.ch[name];
      if (c.cur === c.target) continue;
      const step = c.speed * dt;
      c.cur = c.cur < c.target
        ? Math.min(c.target, c.cur + step)
        : Math.max(c.target, c.cur - step);
      this._raw(name, c.cur);
    }
    for (const name in this.mch) {
      const c = this.mch[name];
      if (c.cur === c.target) continue;
      const step = c.speed * dt;
      c.cur = c.cur < c.target
        ? Math.min(c.target, c.cur + step)
        : Math.max(c.target, c.cur - step);
      this._rawMorph(name, c.cur);
    }
  }

  _rawMorph(name, value) {
    const list = this.morphs.get(name);
    if (!list) return;
    for (const { mesh, index } of list) mesh.morphTargetInfluences[index] = value;
  }

  _raw(name, value) {
    try { this.mgr.setValue(name, value); } catch (e) { /* 该模型没这个通道 */ }
  }

  /** 调试用：当前所有非零通道 */
  dump() {
    const out = {};
    for (const name in this.ch) if (this.ch[name].cur > 0.01) out[name] = +this.ch[name].cur.toFixed(2);
    const mo = {};
    for (const name in this.mch) if (this.mch[name].cur > 0.01) mo[name] = +this.mch[name].cur.toFixed(2);
    return { channels: out, morphs: mo, emotion: this.emotion,
             talking: performance.now() / 1000 < this.talkUntil,
             useRecipes: this.useRecipes, morphCount: this.morphs.size,
             available: [...this.available] };
  }
}

/** 摄像头判定 → 表情。这是"联动"真正落地的地方。 */
export const STATE_FACE = {
  focus:    { emotion: 'relaxed',   level: 0.35, hold: 3.0 },
  away:     { emotion: null },                                  // 人不在，别做表情给空气看
  backturn: { emotion: 'relaxed',   level: 0.2,  hold: 2.0 },
  phone:    { emotion: 'sad',       level: 0.55, hold: 3.5 },   // 不是生气，是失望
  drowsy:   { emotion: 'sad',       level: 0.4,  hold: 3.0, yawn: true },
  covered:  { emotion: 'surprised', level: 0.7,  hold: 2.0 },
  back:     { emotion: 'happy',     level: 0.7,  hold: 2.5 }    // 你回来了
};
