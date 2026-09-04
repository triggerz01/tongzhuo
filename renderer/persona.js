/* persona.js — 人格皮肤：只换语言，不换触发逻辑
 * 三种人格共用同一条干预阶梯；差别只在文案与允许的最高级别。
 * L1 永远是沉默的动作（停笔看一眼），因此这里没有 L1 文案。
 */
'use strict';
window.TZ = window.TZ || {};

TZ.Persona = (function () {
  const LIB = {
    /* 并肩战友（默认）——最高只到 L2 */
    peer: {
      name: '并肩战友',
      maxLevel: 2,
      L2: {
        phone:   ['我也有点走神了。', '……刚才那条消息很重要吗？', '我先把这段写完。'],
        away:    ['我等你。', '水杯我帮你看着。'],
        drowsy:  ['要不要趴五分钟？', '我也困了。'],
        covered: ['？']
      },
      L3: {},
      praise: ['这段挺顺的。', '你已经连着写了很久了。', '状态不错。'],
      breakStart: ['歇会儿吧，我也停一下。'],
      breakEnd: ['我先坐直了。'],
      sessionEnd: ['今天到这儿。明天见。']
    },

    /* 温柔同学 */
    gentle: {
      name: '温柔同学',
      maxLevel: 2,
      L2: {
        phone:   ['要不要先喝口水？', '看一会儿就好啦。', '我在呢。'],
        away:    ['慢慢来，不着急。', '回来的时候我还在。'],
        drowsy:  ['困了就眯一会儿吧。', '要不要起来走两步？'],
        covered: ['怎么啦？']
      },
      L3: {},
      praise: ['你好厉害呀。', '一直坐得很稳呢。', '这一段做得很好。'],
      breakStart: ['休息时间到啦。'],
      breakEnd: ['准备好了吗？'],
      sessionEnd: ['今天辛苦了。']
    },

    /* 教导主任——需用户主动开启，允许 L3 */
    strict: {
      name: '教导主任',
      maxLevel: 3,
      L2: {
        phone:   ['手机。', '放下。', '我看着呢。'],
        away:    ['人呢。', '还有多久。'],
        drowsy:  ['坐直。', '醒醒。'],
        covered: ['把手拿开。']
      },
      L3: {
        phone:   ['你已经第三次拿手机了，这一节还剩 20 分钟。', '手机扣下，我们把这页做完。'],
        away:    ['离开快十分钟了，回来。'],
        drowsy:  ['这样撑着没有意义，去洗把脸再来。'],
        covered: ['遮住镜头不会让作业自己写完。']
      },
      praise: ['嗯，这一段没有偷懒。', '保持。'],
      breakStart: ['休息八分钟，计时开始。'],
      breakEnd: ['时间到，回来。'],
      sessionEnd: ['今天的量完成了。']
    }
  };

  let current = 'peer';
  const lastPicked = {};

  /** 同一个 key 不连续说同一句 */
  function pick(arr, key) {
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    let i, guard = 0;
    do { i = Math.floor(Math.random() * arr.length); guard++; }
    while (arr[i] === lastPicked[key] && guard < 8);
    lastPicked[key] = arr[i];
    return arr[i];
  }

  return {
    list() { return Object.keys(LIB).map(k => ({ id: k, name: LIB[k].name, maxLevel: LIB[k].maxLevel })); },
    set(id) { if (LIB[id]) current = id; },
    get() { return current; },
    maxLevel() { return LIB[current].maxLevel; },

    /** level: 2 | 3 ; kind: phone|away|drowsy|covered */
    line(level, kind) {
      const p = LIB[current];
      const bucket = (level >= 3 ? p.L3 : p.L2)[kind] || p.L2[kind];
      return pick(bucket, 'lv' + level + kind);
    },
    praise()      { return pick(LIB[current].praise, 'praise'); },
    breakStart()  { return pick(LIB[current].breakStart, 'bs'); },
    breakEnd()    { return pick(LIB[current].breakEnd, 'be'); },
    sessionEnd()  { return pick(LIB[current].sessionEnd, 'se'); }
  };
})();
