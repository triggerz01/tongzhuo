/* bond.js — 同行模式的羁绊数据与剧情表
 *
 * 只管数据和规则，不碰界面。界面在 companion.js（角色页 / 剧情页 / 画廊）。
 *
 * 一条硬原则：**进度只认有效专注时长**（记录里的 focusMin），不认在场时间。
 * 按总时长算的话，开着摄像头挂机就能刷完整条剧情线，
 * "和她一起进步"这个主张当场就塌了。
 *
 * 门槛是压缩过的。ban-jiang 原案是 15/80/180/300/450/620/800/1000 分钟
 * 外加 7 个有效签到日 —— 那是给真实使用设计的，一场演示根本走不到第二章。
 * 这里按同一条曲线压到 1/11 左右，一场 45 分钟的自习大概能开到第五章。
 * 真实值留在 REAL_STAGES 里，以后要放长直接换。
 */
'use strict';

const KEY = 'tongzhuo.bond.v1';

/* 每一章：门槛（分钟）、标题、正文、CG、以及这一章之后她的口吻变化。
 * 正文来自 ban-jiang 的 PRD，我按"自动播放的独白"重写了叙述部分，
 * 关键台词一字未动 —— 那些是他写得最好的地方。 */
export const CHAPTERS = [
  {
    id: 'ch1', at: 3, title: '空出来的座位', cg: 'ch1',
    text: [
      '开学第三周，你旁边那个一直空着的位置坐了人。',
      '她叫周以宁，高二转来的。父母离婚之后，她跟着母亲搬到了这座陌生的城市。',
      '她把书包和一本蓝色的错题本放在两张桌子中间，像是划了一条线。',
      '第一节自习课，你在便签上写了今天要做完的事。下课的时候，你把它划掉了。',
      '她看了一眼那张便签，又很快移开视线。',
      '「你每次都会把写下来的事情做完吗？」',
      '你说，尽量。',
      '「……没什么。我只是觉得，这样的人挺少见的。」',
      '她把那本蓝色错题本，往桌子中线的方向推了一点点。'
    ]
  },
  {
    id: 'ch2', at: 8, title: '风吹散的一页', cg: 'ch2',
    text: [
      '暴雨来之前，风先到了。',
      '窗帘鼓起来的那一下，一页纸从她的错题本里被卷了出去，翻着跟头滚进过道。',
      '你和她同时弯下腰。',
      '纸上不是题。是一行很用力写下的字，写的是她对自己的评价。',
      '你把纸捡起来，递过去，什么也没问。',
      '「你已经看见上面写的东西了？」',
      '「只看见一道还没做完的题。」',
      '她愣了几秒。',
      '「……那就一起做完吧。」',
      '这是她第一次接受别人的帮助。'
    ]
  },
  {
    id: 'ch3', at: 15, title: '留给她的位置', cg: 'ch3',
    text: [
      '她有过一次失约。家里的事，她没有解释，只是第二天来了之后一直没抬头。',
      '从那以后她再也不肯说"我一定会来"。',
      '傍晚的公共自习室几乎坐满了。她抱着书站在门口，正准备转身走。',
      '然后她看见你旁边的那把椅子，一直空着。',
      '桌上放着她的蓝色错题本，和一杯还温着的水。',
      '「你怎么知道我今天会来？」',
      '「不知道。只是觉得，应该给你留一个位置。」',
      '她坐下的时候，声音很轻。',
      '「那下次……也可以继续留着吗？」'
    ]
  },
  {
    id: 'ch4', at: 25, title: '没有扔掉的试卷', cg: 'ch4',
    text: [
      '月考成绩出来那天，关于她的话又开始传了。',
      '雷雨。空教室。她把那张揉皱的卷子举在垃圾桶上方，很久没有松手。',
      '你没有过去拦她。',
      '你只是在另一头，把她的蓝色错题本翻开，放下一支红笔。',
      '闪电亮了一下。她的手收了回来。',
      '她走过来，把卷子重新摊平，压在错题本第一页。',
      '「我以前觉得，失败的东西留着很丢脸。」',
      '「可是不留下，我连自己是怎么走出来的都不知道。」'
    ]
  },
  {
    id: 'ch5', at: 40, title: '自己说出口', cg: 'ch5',
    text: [
      '原来学校的那些话，被人转发到了新班级的群里。',
      '她把截图一条一条存了下来，却在办公室门口站了整整十分钟。',
      '你陪她走到那里，没有替她推门，也没有替她开口。',
      '雨停了。走廊很长，很亮。',
      '她举起手，要敲门之前，最后回头看了你一眼——确认你还在。',
      '然后她敲了门。',
      '出来的时候她的眼睛是红的，但背挺得很直。',
      '「进去以前，我一直在想，你会不会替我说。」',
      '「后来我发现，我真正想做的，是自己把那句话说出来。」'
    ]
  },
  {
    id: 'ch6', at: 55, title: '今天换我等你', cg: 'ch6',
    text: [
      '那天你状态很差。原计划没有做完，你提前收了东西。',
      '她什么都没说。',
      '第二天你到自习室的时候，她已经坐在那里了，比平时早了很多。',
      '她旁边的位置上，压着那本蓝色错题本——她在替你占座。',
      '看见你，她很快站起来，把错题本收进怀里。',
      '「上次你没有完成。所以呢？」',
      '「你以前也没有因为我失约，就把我的位置收走。」',
      '「今天换我等你。」',
      '你们之间的那条线，第一次反了过来。'
    ]
  },
  {
    id: 'ch7', at: 70, title: '不是由座位决定', cg: 'ch7',
    text: [
      '老师找她谈话，给了她一个进重点班的名额。',
      '要换到另一栋教学楼。',
      '雨后的天台上风很大，夕阳把水洼照得发亮。她抱着那本错题本，站了很久。',
      '「如果我去了，我们可能就不再是同桌了。」',
      '「是不是同桌，不是由座位决定的。」',
      '她往楼梯口走了两步，又回过头来看你。',
      '那一眼里没有犹豫，只有确认。',
      '第二天她去报到了。'
    ]
  },
  {
    id: 'ch8', at: 90, title: '我们还是同桌', cg: 'ch8', final: true,
    text: [
      '蓝色错题本一页一页写满了。',
      '那张曾经差点被扔掉的卷子，一直夹在第一页。',
      '你们用完的笔芯装满了一个玻璃瓶。',
      '后来是她开始主动约你："今天把能做的最后一件事做完。"',
      '——',
      '明德广场。九月。你们穿着一样的红色新生衫。',
      '「以前我总觉得，只要走得足够远，就能把过去甩掉。」',
      '「后来我才明白，重新开始不是逃到哪里。」',
      '「是终于敢决定，自己要去哪里。」',
      '「所以，我们还算同桌吗？」',
      '「高中那次，是老师安排的。」',
      '她笑了一下。',
      '「这一次，是我自己选的。」',
      '——',
      '她把那本蓝色错题本递给你。封皮已经磨得起毛了。',
      '「这个你拿着。上面有我所有做错过的题。」',
      '「也有你陪我坐过的每一个晚上。」'
    ],
    gift: { id: 'item_bluebook', name: '蓝色错题本' }
  }
];

/* 真实节奏留档。以后要放长，把 CHAPTERS 里的 at 换成这一列即可。 */
export const REAL_STAGES = [15, 80, 180, 300, 450, 620, 800, 1000];

/* 角色登记。以后加男生线就在这里加一条。 */
export const CAST_BOND = {
  yining: {
    id: 'yining',
    name: '周以宁',
    model: 'AvatarSample_A.vrm',
    portrait: '../assets/story/yining.png',
    tag: '高二转学生 · 17 岁',
    intro: '父母离异后跟着母亲转来这座城市。表面安静冷淡，'
         + '实际敏感、认真、很在意承诺。习惯把重要的话写在便签背面，'
         + '用一本蓝色错题本记录自己失败过的地方。',
    why: '她跟不上新学校的进度，又不肯开口求助。'
       + '她想找一个人一起坐着——不是被看着，是有人也在。'
  }
};

/* ---------------- 存档 ---------------- */
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 隐私模式 */ }
}

function blank() {
  return { focusMin: 0, seen: [], cgs: [], gifts: [], lastAt: 0 };
}

export function get(who) {
  const all = load();
  return Object.assign(blank(), all[who] || {});
}

export function set(who, patch) {
  const all = load();
  all[who] = Object.assign(blank(), all[who] || {}, patch);
  save(all);
  return all[who];
}

/* ---------------- 规则 ---------------- */
/** 按累计有效专注，现在应该解锁到第几章（0 = 一章都还没到） */
export function stageOf(minutes) {
  let n = 0;
  for (const c of CHAPTERS) if (minutes >= c.at) n++;
  return n;
}

/** 下一章还差多少分钟。全部读完返回 null */
export function nextGap(minutes) {
  for (const c of CHAPTERS) {
    if (minutes < c.at) return { chapter: c, need: c.at - minutes };
  }
  return null;
}

/** 该播哪一章：门槛到了、但还没读过的第一章。没有就返回 null */
export function pendingChapter(who) {
  const b = get(who);
  for (const c of CHAPTERS) {
    if (b.focusMin >= c.at && !b.seen.includes(c.id)) return c;
  }
  return null;
}

/** 记一章为已读，同时解锁 CG 和礼物 */
export function markRead(who, chapterId) {
  const b = get(who);
  const c = CHAPTERS.find(x => x.id === chapterId);
  if (!c) return b;
  const seen = b.seen.includes(c.id) ? b.seen : b.seen.concat(c.id);
  const cgs = b.cgs.includes(c.cg) ? b.cgs : b.cgs.concat(c.cg);
  const gifts = (c.gift && !b.gifts.includes(c.gift.id))
    ? b.gifts.concat(c.gift.id) : b.gifts;
  return set(who, { seen, cgs, gifts });
}

/**
 * 一场自习结束，把有效专注记到她账上。
 * @returns {{before, after, crossed:[章节...]}} crossed 是这一场跨过的章节
 */
export function addFocus(who, focusMin) {
  const b = get(who);
  const before = b.focusMin;
  const after = before + Math.max(0, Math.round(focusMin || 0));
  const crossed = CHAPTERS.filter(c => before < c.at && after >= c.at);
  set(who, { focusMin: after, lastAt: Date.now() });
  return { before, after, crossed };
}

/** 已解锁的 CG（按章节顺序） */
export function unlockedCGs(who) {
  const b = get(who);
  return CHAPTERS.filter(c => b.cgs.includes(c.cg));
}

export function reset(who) {
  const all = load();
  if (who) delete all[who]; else Object.keys(all).forEach(k => delete all[k]);
  save(all);
}

/** 调试：直接跳到第 n 章之后 */
export function jumpTo(who, n) {
  const c = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length, n)) - 1];
  const minutes = c ? c.at : 0;
  set(who, { focusMin: minutes });
  return get(who);
}
