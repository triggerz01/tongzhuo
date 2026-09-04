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

export class Expressions {
  constructor(vrm) {
    this.vrm = vrm;
    this.mgr = vrm && vrm.expressionManager ? vrm.expressionManager : null;
    this.available = new Set(
      this.mgr ? Object.keys(this.mgr.expressionMap || {}) : []
    );

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
    if (!this.has(name)) return false;
    for (const e of EMOTIONS) if (e !== name) this.set(e, 0, 3);
    this.set(name, level, 4);
    this.emotion = name;
    this.emotionUntil = performance.now() / 1000 + hold;
    return true;
  }

  /** 情绪立刻收回 */
  clearEmotion(speed = 2.5) {
    for (const e of EMOTIONS) this.set(e, 0, speed);
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
        const pick = Math.random() < 0.65 ? 'relaxed' : 'happy';
        this.play(pick, 0.16 + Math.random() * 0.14, 2 + Math.random() * 2);
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
  }

  _raw(name, value) {
    try { this.mgr.setValue(name, value); } catch (e) { /* 该模型没这个通道 */ }
  }

  /** 调试用：当前所有非零通道 */
  dump() {
    const out = {};
    for (const name in this.ch) if (this.ch[name].cur > 0.01) out[name] = +this.ch[name].cur.toFixed(2);
    return { channels: out, emotion: this.emotion, talking: performance.now() / 1000 < this.talkUntil,
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
