/* idle.js — 待机生命
 * 三条硬规则：① 间隔非周期 ② 同一动作有冷却 ③ 从不完全静止（呼吸/眨眼在 character.js）
 * 真实节奏 40–110s，演示节奏 5–13s。
 */
'use strict';
window.TZ = window.TZ || {};

TZ.Idle = (function () {
  const C = () => TZ.Character;

  const ACTIONS = [
    { id: 'write',   label: '低头写字', w: 5,   cd: 14000,  dur: 6000,
      run: () => C().pose({ headRot: 7, headY: 3, armR: -22, armL: 6 }, 6000) },
    { id: 'stretch', label: '伸懒腰',   w: 2,   cd: 60000,  dur: 2600,
      run: () => C().pose({ armL: 32, armR: -32, figY: -7, headRot: -5, mouthOverride: 'open', eyeK: 0.15 }, 2600) },
    { id: 'yawn',    label: '打哈欠',   w: 2,   cd: 55000,  dur: 2200,
      run: () => C().pose({ mouthOverride: 'yawn', eyeK: 0.12, headRot: -4 }, 2200) },
    { id: 'daze',    label: '发呆',     w: 3,   cd: 30000,  dur: 4200,
      run: () => C().pose({ eyeK: 0.55 }, 4200) },
    { id: 'drink',   label: '喝水',     w: 2,   cd: 70000,  dur: 2600,
      run: () => C().pose({ armR: -72, headRot: -3, mouthOverride: 'o' }, 2600) },
    { id: 'rub',     label: '揉眼睛',   w: 2,   cd: 70000,  dur: 2400,
      run: () => C().pose({ armR: -78, eyeK: 0.1 }, 2400) },
    { id: 'glance',  label: '看你一眼', w: 3,   cd: 26000,  dur: 1800,
      run: () => C().pose({ eyeDX: 5, headRot: -2.5 }, 1800) },
    { id: 'lie',     label: '趴一会儿', w: 1,   cd: 120000, dur: 5200,
      run: () => C().pose({ figY: 30, figRot: 5, headRot: 8, eyeK: 0.1 }, 5200) },
    { id: 'tidy',    label: '整理桌面', w: 2,   cd: 80000,  dur: 2600,
      run: () => C().pose({ armL: -38, headRot: 5 }, 2600) },
    { id: 'rare',    label: '笔掉了',   w: 0.4, cd: 240000, dur: 2800,
      run: () => C().pose({ headRot: 14, figY: 6, armR: -46 }, 2800) }
  ];

  const last = {};
  let timer = null, running = false, fast = false;
  let onFire = null;

  function pick() {
    const now = Date.now();
    let pool = ACTIONS.filter(a => now - (last[a.id] || 0) > a.cd);
    if (!pool.length) pool = ACTIONS.slice();
    const total = pool.reduce((s, a) => s + a.w, 0);
    let r = Math.random() * total;
    for (const a of pool) { r -= a.w; if (r <= 0) return a; }
    return pool[0];
  }

  function fire(a) {
    last[a.id] = Date.now();
    a.run();
    if (onFire) onFire(a);
  }

  function loop() {
    const gap = fast ? (5000 + Math.random() * 8000) : (40000 + Math.random() * 70000);
    timer = setTimeout(() => {
      if (running) fire(pick());
      loop();
    }, gap);
  }

  return {
    actions: ACTIONS,
    start(cb) { onFire = cb || null; running = true; if (!timer) loop(); },
    stop() { running = false; },
    setFast(v) { fast = !!v; },
    isFast() { return fast; },
    /** 手动触发（控制台调试用） */
    trigger(id) { const a = ACTIONS.find(x => x.id === id); if (a) fire(a); }
  };
})();
