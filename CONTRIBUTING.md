# 协作约定

两天半、两三个人。**这份文档只解决一件事：别让我们互相踩脚。**

黑客松里真正杀时间的不是写代码，是两个人改了同一个文件、合并冲突、代码丢失、
以及"我这边好好的啊"。下面的规矩都是为这个来的。

---

## 一、分支：只用 `main`

不开 feature 分支，不走 PR。

两天半里，代码审查的延迟比冲突的代价还高。**我们靠文件分工避免冲突，不靠分支。**

规矩只有两条：

```bash
# 开工前，先拉
git pull --rebase

# 做完一个小功能，立刻推（不要攒到晚上）
git add -A && git commit -m "说清楚改了什么" && git push
```

**`--rebase` 很重要**，能避免一堆没意义的 merge commit 把历史搅乱。

每天收工前打个 tag，随时能退回去：

```bash
git tag day1-end && git push --tags
```

---

## 二、文件分工：这是防冲突的主力

项目已经按模块切开了，**每个人只动自己那一摊**。

| 区域 | 负责 | 说明 |
|---|---|---|
| `renderer/room.*` | 甲 | 3D 场景、角色、待机生命、取景合成 |
| `renderer/character.js` `idle.js` | 甲 | 2D 桌宠形态的角色与待机 |
| `assets/` | 甲 | 模型、场景图 |
| `perception/*.py` | 乙 | 摄像头判定，**独立进程，不碰前端** |
| `renderer/patrol.js`（待建） | 乙 | 随机巡查 + 军功币记账 |
| `renderer/expression.js` | 甲 | 表情、口型、情绪与摄像头联动 |
| `renderer/persona.js` | 谁写文案谁改 | 纯文本，冲突也好解 |

**共享文件，改之前在群里说一声**：

- `electron/main.js` — 加窗口、加 IPC 才需要动
- `package.json` — 加依赖才需要动
- `README.md` / 本文件

---

## 三、加新功能，尽量开新文件

**新文件永远不会冲突。**

要加一个功能，第一反应应该是"能不能放进一个新文件"，而不是"塞进现有的哪个文件"。
现在的模块划分就是这么来的：`gate.js` `session.js` `idle.js` `persona.js` 各管一件事，
互相之间只通过明确的接口调用。

---

## 四、前后端之间的契约

感知层（Python）和桌面端（JS）是**两个独立进程，靠 WebSocket 通信**。
这是整个项目最重要的一条缝——两个人可以在缝的两边同时开工，谁都不用等谁。

**地址**：`ws://127.0.0.1:8765`

### 感知层 → 桌面端

```json
{ "type": "hello",  "fps": 2, "phone": true }
{ "type": "state",  "label": "phone", "duration": 9.2, "trigger": true,
  "detail": { "pitch": 21.4, "ear": 0.19, "phone": true, "face": true } }
{ "type": "calibrated", "ok": true, "baseline": { "pitch": 4.2, "roll": 0.8 } }
{ "type": "error",  "message": "打不开摄像头" }
```

`label` 取值：`focus` | `away` | `phone` | `drowsy` | `covered` | `calibrating`

`trigger` 只在**本次连续片段首次达到阈值**时为 `true`。
重复触发由前端的频率闸门管，**感知层不重复喊**。

### 桌面端 → 感知层

```json
{ "cmd": "start" }      // 开始采集
{ "cmd": "pause" }      // 暂停并释放摄像头（休息时用，不是软暂停）
{ "cmd": "resume" }
{ "cmd": "calibrate" }  // 15 秒基线标定
{ "cmd": "preview", "on": true }   // 画中人开关
```

### 二进制帧 = 画中人

WebSocket 上的**二进制消息一律是画中人的一帧 JPEG**（带检测标注，320px 宽，
2 FPS，每帧 15–25KB），不用再包一层协议，前端 `ev.data instanceof Blob` 就能区分。

只有 `{"cmd":"preview","on":true}` 之后才会推，默认不推——省 CPU，也是隐私上的默认值。

**画面为什么从 Python 出，而不是前端 getUserMedia**：Windows 上摄像头基本是独占的，
前端再开一路会把检测器饿死。而且推的是**带标注的帧**——用户看到的就是程序处理的全部，
隐私上讲得清。

**改协议必须两个人一起改。** 加字段可以单方面加（对方忽略就行），
改字段名或语义要说一声。

---

## 五、提交信息

写清楚**改了什么、为什么**，不要写 "update" "fix bug"。

正例：

```
修复角色在浅色桌面上的可读性

校服白衬衫没有描边，贴在浅色桌面上整个身体会糊掉。
给躯干和手臂加 rgba(20,24,28,.22) 的细描边。
```

一行标题 + 空行 + 正文。标题说结论，正文说原因。

**赛后路演要讲"我们怎么协作的"，这些提交记录就是证据。**

---

## 六、不要提交的东西

`.gitignore` 已经挡掉了，但还是说一下：

- `node_modules/`、`.venv/` —— 各自装
- `*.pt` —— YOLO 权重，会自动下载
- `data/`、`*.sqlite`、`snapshots/` —— **本地数据和摄像头截图，绝对不能进仓库**
- 第三方 VRM 模型 —— 授权大多不允许再分发

---

## 七、卡住了怎么办

- 环境装不上 → 看 [SETUP.md](SETUP.md)，国内网络的三道墙都写在那儿
- 拉下来跑不起来 → 先 `npm install`，再看是不是 Electron 二进制没下下来
- 合并冲突 → 别自己硬解，喊一声，两个人一起看
- **Python 的 websockets 客户端连不上本机** → 这台机器环境里有 `HTTP_PROXY`，
  客户端库会把 `127.0.0.1` 也走代理。加 `websockets.connect(uri, proxy=None)`。
  （Chromium 对 localhost 有内置绕过，前端不受影响）
- **快到冻结时间了 → 停手。** 9/6 11:30 之后不许改代码，只做备份和排练
