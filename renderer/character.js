/* character.js — 参数化 SVG 角色骨架
 * 零图片资产：捏脸 = 改参数，眨眼 = 改一个属性。
 * 对外只暴露 TZ.Character，其余模块不直接碰 DOM。
 */
'use strict';
window.TZ = window.TZ || {};

TZ.Character = (function () {
  const $ = (id) => document.getElementById(id);

  // 捏脸与外观参数
  const S = {
    skin: '#F1C7A6', hair: '#33292A', acc: '#9E1B25',
    eyeSize: 9.5, eyeDist: 24, eyeY: 166,
    brow: 2, browW: 4.5, faceW: 58, blush: 28,
    mouth: 'smile', hairStyle: 'short', outfit: 'suit',
    faceOn: true
  };

  // 瞬时姿态（由行为写入，reset 后归零）
  const P = {
    headRot: 0, headY: 0, armL: 0, armR: 0,
    figY: 0, figRot: 0, eyeK: 1, eyeDX: 0,
    mouthOverride: null, blink: false
  };

  const OUTFIT = {
    suit:    { hair: '#33292A', hairStyle: 'short', fit: 'fitSuit',    torso: '#26303A' },
    teacher: { hair: '#3A2F2B', hairStyle: 'bun',   fit: 'fitTeacher', torso: '#DDE2E4' },
    school:  { hair: '#2E2726', hairStyle: 'twin',  fit: 'fitSchool',  torso: '#F1F3F5' }
  };

  function mouthPath(kind) {
    switch (kind) {
      case 'smile': return 'M137,198 Q150,209 163,198';
      case 'flat':  return 'M140,200 L160,200';
      case 'o':     return 'M144,200 a6,7 0 1,0 12,0 a6,7 0 1,0 -12,0';
      case 'wave':  return 'M138,200 Q145,195 150,200 Q155,205 162,200';
      case 'yawn':  return 'M138,198 a12,15 0 1,0 24,0 a12,15 0 1,0 -24,0';
      case 'open':  return 'M141,197 a9,10 0 1,0 18,0 a9,10 0 1,0 -18,0';
      default:      return 'M140,200 L160,200';
    }
  }

  function render() {
    const o = OUTFIT[S.outfit];

    $('faceBase').setAttribute('fill', S.skin);
    $('earL').setAttribute('fill', S.skin);
    $('earR').setAttribute('fill', S.skin);
    $('neck').setAttribute('fill', S.skin);
    ['hb0', 'hbL', 'hbR', 'hbBun'].forEach(k => $(k).setAttribute('fill', S.hair));
    $('hairFront').setAttribute('fill', S.hair);
    $('armL').setAttribute('fill', o.torso);
    $('armR').setAttribute('fill', o.torso);
    $('torso').setAttribute('fill', o.torso);
    ['tie', 'tCollar', 'ribbon'].forEach(k => { const e = $(k); if (e) e.setAttribute('fill', S.acc); });

    ['fitSuit', 'fitTeacher', 'fitSchool'].forEach(k => {
      $(k).style.display = (k === o.fit) ? '' : 'none';
    });

    $('hbL').setAttribute('opacity', S.hairStyle === 'twin' ? 1 : 0);
    $('hbR').setAttribute('opacity', S.hairStyle === 'twin' ? 1 : 0);
    $('hbBun').setAttribute('opacity', S.hairStyle === 'bun' ? 1 : 0);

    $('faceBase').setAttribute('rx', S.faceW);
    $('earL').setAttribute('cx', 150 - S.faceW + 1);
    $('earR').setAttribute('cx', 150 + S.faceW - 1);
    $('blushL').setAttribute('opacity', S.blush / 100);
    $('blushR').setAttribute('opacity', S.blush / 100);
    $('blushL').setAttribute('cx', 150 - S.faceW * 0.74);
    $('blushR').setAttribute('cx', 150 + S.faceW * 0.74);
    $('blushL').setAttribute('cy', S.eyeY + 22);
    $('blushR').setAttribute('cy', S.eyeY + 22);

    const bl = $('browL'), br = $('browR'), by = S.eyeY - 22;
    bl.setAttribute('x1', 150 - S.eyeDist - 14); bl.setAttribute('y1', by - S.brow);
    bl.setAttribute('x2', 150 - S.eyeDist + 13); bl.setAttribute('y2', by + S.brow);
    br.setAttribute('x1', 150 + S.eyeDist + 14); br.setAttribute('y1', by - S.brow);
    br.setAttribute('x2', 150 + S.eyeDist - 13); br.setAttribute('y2', by + S.brow);
    [bl, br].forEach(b => { b.setAttribute('stroke', S.hair); b.setAttribute('stroke-width', S.browW); });

    const kind = P.mouthOverride || S.mouth;
    const m = $('mouth');
    m.setAttribute('d', mouthPath(kind));
    const filled = (kind === 'o' || kind === 'yawn' || kind === 'open');
    m.setAttribute('fill', filled ? '#7A3B3B' : 'none');
    m.setAttribute('stroke', filled ? 'none' : '#7A3B3B');
    m.setAttribute('stroke-width', 3);

    applyPose();
  }

  function applyPose() {
    const eL = $('eyeL'), eR = $('eyeR'), hL = $('hlL'), hR = $('hlR');
    const ry = P.blink ? 1.3 : S.eyeSize * P.eyeK;
    const rx = S.eyeSize * 0.82;
    const cxL = 150 - S.eyeDist + P.eyeDX;
    const cxR = 150 + S.eyeDist + P.eyeDX;

    eL.setAttribute('cx', cxL); eL.setAttribute('cy', S.eyeY);
    eL.setAttribute('rx', rx);  eL.setAttribute('ry', ry); eL.setAttribute('fill', '#2A2320');
    eR.setAttribute('cx', cxR); eR.setAttribute('cy', S.eyeY);
    eR.setAttribute('rx', rx);  eR.setAttribute('ry', ry); eR.setAttribute('fill', '#2A2320');

    const showHL = (!P.blink && P.eyeK > 0.7) ? 1 : 0;
    hL.setAttribute('cx', cxL + rx * 0.38); hL.setAttribute('cy', S.eyeY - ry * 0.42); hL.setAttribute('opacity', showHL);
    hR.setAttribute('cx', cxR + rx * 0.38); hR.setAttribute('cy', S.eyeY - ry * 0.42); hR.setAttribute('opacity', showHL);

    $('head').style.transform   = `rotate(${P.headRot}deg) translateY(${P.headY}px)`;
    $('figure').style.transform = `translateY(${P.figY}px) rotate(${P.figRot}deg)`;
    $('armL').style.transform   = `rotate(${P.armL}deg)`;
    $('armR').style.transform   = `rotate(${P.armR}deg)`;
    $('face').style.opacity     = S.faceOn ? 1 : 0;
  }

  /* ---------- 眨眼：随机间隔 + 成簇 ---------- */
  let blinkTimer = null;
  function blinkOnce(cb) {
    P.blink = true; applyPose();
    setTimeout(() => { P.blink = false; applyPose(); if (cb) cb(); }, 110);
  }
  function blinkLoop() {
    const gap = 2400 + Math.random() * 4200;
    blinkTimer = setTimeout(() => {
      blinkOnce(() => { if (Math.random() < 0.28) setTimeout(blinkOnce, 180); });
      blinkLoop();
    }, gap);
  }

  /* ---------- 对外 API ---------- */
  let resetTimer = null;

  return {
    init() { render(); blinkLoop(); },

    /** 部分更新捏脸参数 */
    setParams(patch) { Object.assign(S, patch || {}); render(); },
    getParams() { return Object.assign({}, S); },

    setOutfit(name) {
      if (!OUTFIT[name]) return;
      S.outfit = name;
      S.hair = OUTFIT[name].hair;
      S.hairStyle = OUTFIT[name].hairStyle;
      render();
    },
    setHairStyle(v) { S.hairStyle = v; render(); },
    setFaceVisible(v) { S.faceOn = !!v; applyPose(); },

    /** 直接摆一个姿态；dur 毫秒后自动归位（dur=0 表示不自动归位） */
    pose(patch, dur) {
      Object.assign(P, patch || {});
      render();
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      if (dur && dur > 0) {
        resetTimer = setTimeout(() => this.reset(), dur);
      }
    },

    reset() {
      P.headRot = 0; P.headY = 0; P.armL = 0; P.armR = 0;
      P.figY = 0; P.figRot = 0; P.eyeK = 1; P.eyeDX = 0;
      P.mouthOverride = null;
      render();
    }
  };
})();
