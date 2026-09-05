/* voice.js — 语音与字幕
 *
 * 一条原则：**字幕就是这条音频的原文**。
 * 以前台词写死在 REACTIONS 里、音频另配一套，两边迟早对不上 ——
 * 所以这里把「文件 + 文字」绑成一条记录，播哪条就显示哪条，
 * 物理上不可能不匹配。
 *
 * 口型也由音频驱动：拿到 audio.duration 再让嘴动那么久。
 * 之前是 hold * 0.7 拍脑袋估的，声音停了嘴还在动。
 *
 * 每个角色一套音频包（assets/voice/<角色>/）。目前只有女生有；
 * 男生和老师没有包，自动退化成"只有字幕不出声"，不会报错。
 */
'use strict';

/* 台词表。文字和 aimis_voice_pack_wenben.txt 逐字一致 —— 改一处就要改两处，
   所以别在别的地方再写一遍台词。 */
export const LINES = {
  sessionStart: [
    ['session_start_01', '开始了，我也开始。'],
    ['session_start_02', '那我陪你坐着。'],
    ['session_start_03', '嗯，我在了。']
  ],
  cameraOn: [
    ['camera_connected_01', '看到你了。']
  ],
  sessionFinish: [
    ['session_finish_01', '时间到了，今天到这儿。'],
    ['session_finish_02', '说好的时间到了，收工。'],
    ['session_finish_03', '够了，今天挺好的。']
  ],
  sessionEarlyEnd: [
    ['session_early_end_01', '今天先到这儿吧。'],
    ['session_early_end_02', '行，那就先这样。']
  ],
  praise: [
    ['praise_01', '你已经坐了很久了，厉害啊。'],
    ['praise_02', '一直没抬头，我都看着呢。'],
    ['praise_04', '挺好的，就这样。'],
    ['praise_05', '你今天状态不错。']
  ],
  phone: [
    ['phone_01', '手机。'],
    ['phone_02', '……我看见了。'],
    ['phone_03', '就看一眼？'],
    ['phone_04', '它比我好看是吧。'],
    ['phone_05', '放下吧。'],
    ['phone_06', '我等你。']
  ],
  away: [
    ['away_01', '你去哪儿了，我一个人坐着呢。'],
    ['away_02', '人呢。'],
    ['away_03', '桌子空了。'],
    ['away_04', '我还在这儿。']
  ],
  welcome: [
    ['welcome_01', '你回来啦，我等你半天了。'],
    ['welcome_02', '回来了。'],
    ['welcome_03', '我就知道你会回来。'],
    ['welcome_04', '位置我给你留着呢。']
  ],
  sleepy: [
    ['sleepy_01', '……困了？'],
    ['sleepy_02', '要不趴一会儿。']
  ],
  puzzled: [
    ['puzzled_01', '我看不见你了。'],
    ['puzzled_02', '挡住了。']
  ],
  backturn: [
    ['backturn_01', '你转过去干嘛呢。'],
    ['backturn_02', '背对着我啦？'],
    ['backturn_03', '我在你后面看着呢。']
  ],
  /* 无字的三条。字幕留空 —— 叹气配一行「（叹气）」很出戏，
     不如什么都不显示，让声音自己说话。 */
  sigh: [['idle_sigh_01', '']],
  yawn: [['idle_yawn_01', '']],
  hum:  [['idle_hum_01', '']]
};

const PACK = { girl: 'AvatarSample_A.vrm' };     // 哪个模型用哪套音频包

let character = 'girl';
let muted = false;
let volume = 0.9;
let current = null;                  // 正在播的 Audio
const recent = {};                   // 每类最近播过的下标，避免连着重复
const durations = new Map();         // 文件 → 时长（秒），第一次播完就记住

/** 模型文件名 → 音频包目录。没有对应包的角色只出字幕。 */
export function setCharacter(modelFile) {
  const hit = Object.keys(PACK).find(k => PACK[k] === modelFile);
  character = hit || null;
  return character;
}

export function setMuted(v) {
  muted = !!v;
  if (muted && current) { try { current.pause(); } catch (e) {} current = null; }
  return muted;
}
export const isMuted = () => muted;
export function setVolume(v) { volume = Math.max(0, Math.min(1, v)); return volume; }

/** 从一类里挑一条，尽量不连着重复 */
function pick(kind) {
  const rows = LINES[kind];
  if (!rows || !rows.length) return null;
  if (rows.length === 1) return rows[0];
  let i, guard = 0;
  do { i = Math.floor(Math.random() * rows.length); } while (i === recent[kind] && ++guard < 8);
  recent[kind] = i;
  return rows[i];
}

/**
 * 播一条。
 * @param kind  LINES 里的分类
 * @param opts.onText  拿到字幕文字（调用方负责显示）
 * @param opts.onMouth 拿到该动嘴多久（秒）；无字的音效不会回调
 * @returns {text, seconds} —— 音频拿不到时 seconds 是按字数估的
 */
export function play(kind, opts) {
  const o = opts || {};
  const row = pick(kind);
  if (!row) return null;
  const [file, text] = row;

  // 字幕先出：音频要解码，等它会有延迟，字幕慢半拍很出戏
  if (o.onText) o.onText(text);

  // 没有音频包（男生/老师）就只出字幕，按字数估个时长给口型
  const fallback = text ? Math.max(1.2, text.length * 0.22) : 0;
  if (!character || muted) {
    if (text && o.onMouth) o.onMouth(fallback);
    return { text, seconds: fallback };
  }

  const src = `../assets/voice/${character}/${file}.mp3`;
  try {
    if (current) { current.pause(); current = null; }
    const a = new Audio(src);
    a.volume = volume;
    current = a;

    const known = durations.get(file);
    if (known && text && o.onMouth) o.onMouth(known);

    a.addEventListener('loadedmetadata', () => {
      if (!isFinite(a.duration)) return;
      durations.set(file, a.duration);
      // 第一次播这条时时长还不知道，metadata 到了再补一次口型
      if (!known && text && o.onMouth) o.onMouth(a.duration);
    }, { once: true });

    a.addEventListener('ended', () => { if (current === a) current = null; }, { once: true });
    a.addEventListener('error', () => {
      console.warn('[voice] 播放失败', src);
      if (current === a) current = null;
      if (!known && text && o.onMouth) o.onMouth(fallback);
    }, { once: true });

    a.play().catch(() => {
      // 自动播放被拦（一般不会，Electron 里没这限制）
      if (!known && text && o.onMouth) o.onMouth(fallback);
    });
  } catch (e) {
    console.warn('[voice] 起播出错', e);
    if (text && o.onMouth) o.onMouth(fallback);
  }

  return { text, seconds: durations.get(file) || fallback };
}

/** 立刻闭嘴（收工、切场景之类） */
export function stop() {
  if (current) { try { current.pause(); } catch (e) {} current = null; }
}

/** 预热：把音频的时长先量出来，第一次触发时口型就是准的 */
export function warmup() {
  if (!character) return;
  for (const kind in LINES) {
    for (const [file] of LINES[kind]) {
      const a = new Audio(`../assets/voice/${character}/${file}.mp3`);
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => {
        if (isFinite(a.duration)) durations.set(file, a.duration);
      }, { once: true });
    }
  }
}

export const knownDurations = () => Object.fromEntries(durations);
