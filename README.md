# 同桌 · Tongzhuo

> 它不会来查你。它只是一直在。

一个常驻桌面的虚拟同桌。你在，它也在；你走神，它只是停下笔看你一眼；你熬太久，它先起身说"我先歇会儿"。

Build with Care · 中国人民大学首届黑客松 · 赛道二（伴学计划）参赛作品。

---

## 它和"监督软件"的区别

图书馆里没有人盯着你，也没有人会骂你——但他们在，你就不好意思摸鱼。起作用的是**共在**，不是**审判**。

所以这个程序里最反直觉的一段代码是[频率闸门](renderer/gate.js)：**它检测到了，但大部分时候什么都不说。**

- 任意干预：10 分钟内最多 1 次
- 同一行为：30 分钟内最多 2 次
- 首次触发一律是 L1——停下笔，看你一眼，又低头，不出声
- L3（明确的话）只在你自己选了"教导主任"人格时才存在

---

> **新加入的同学先看 [SETUP.md](SETUP.md)**（环境搭建，含国内网络的三个坑）
> **开工前先看 [CONTRIBUTING.md](CONTRIBUTING.md)**（分工与防冲突约定）

## 跑起来

### 1. 桌面端（必需，零门槛）

```bash
npm install
npm start
```

角色会出现在屏幕右下角。**点它打开控制台**（会话设置、捏脸、待机行为、演示通道）。

> 桌面端可以完全独立运行。没有摄像头、没装 Python，角色、待机生命、会话管理、干预阶梯全部照常工作——这是 PRD 里的 F14 降级路径，也是现场演示的兜底。

### 2. 感知层（可选，需要摄像头）

⚠️ **mediapipe / ultralytics 目前不支持 Python 3.14，请用 Python 3.12。**

```bash
cd perception
py -3.12 -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python server.py                # 加 --show 可以开预览窗调试
```

> **国内网络注意**：如果机器上开着代理，`pypi.tuna.tsinghua.edu.cn` 可能握手失败（实测报 `SSL: UNEXPECTED_EOF_WHILE_READING`）。改用阿里源：
>
> ```bash
> pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
> ```
>
> 同理，`winget` 和 `python.org` 的文件下载通道也可能不通。gh 可以从 GitHub releases 直接下 zip；Python 走 `registry.npmmirror.com/-/binary/python/`。
> 另外 **Python 3.12 最后一个带 Windows 安装包的版本是 3.12.10**，之后只发源码。

启动后桌面端会自动连上（`ws://127.0.0.1:8765`），角色头顶的小圆点变红表示摄像头在工作。

**第一次使用先点控制台里的「① 基线标定」**，保持你平时看书的姿势 15 秒。不做这一步，所有阈值都是错的——不同人、不同摄像头高度，"正常看书"的俯角能差 30°。

`ultralytics` 不装也能跑，只是手机检测不生效（它会拉 ~2GB 的 torch，赶时间可以先跳过）。

---

## 隐私

- 所有视觉推理**在本地完成**，画面不出本机，不上传任何服务器
- **默认不保存任何图像**，只保存事件（时间戳 + 类型）
- 休息 / 暂停时摄像头**真正释放**，不是软暂停
- 角色头顶有常驻的摄像头状态指示，随时可关

---

## 结构

```
tongzhuo/
├── electron/
│   ├── main.js          透明置顶窗 + 鼠标穿透 + 跨窗口消息总线
│   └── preload.js
├── renderer/
│   ├── index.html       角色窗（内联 SVG 角色，0 张图片）
│   ├── panel.html       控制台窗
│   ├── character.js     参数化 SVG 骨架：捏脸/姿态/眨眼
│   ├── idle.js          待机生命：10 个行为 + 非周期加权调度器
│   ├── persona.js       三种人格皮肤（只换语言，不换逻辑）
│   ├── gate.js          ★ 干预阶梯 + 频率闸门
│   ├── session.js       会话状态机 未开始/陪伴中/休息中/已结束
│   └── app.js           装配 + 感知层 WebSocket 客户端
├── assets/
│   ├── models/          .vrm 角色，丢进去自动识别
│   ├── scenes/          场景背景图，丢进去自动识别
│   └── animations/      Mixamo 动作 FBX，丢进去自动识别
├── perception/
│   ├── server.py        2 FPS 采集循环 + WebSocket 服务
│   ├── detectors.py     MediaPipe 头部姿态/闭眼 + YOLOv8n 手机 + 帧统计
│   └── classifier.py    ★ 基线标定 + 30s 滑窗 + 规则判定
└── docs/                PRD、架构图、角色原型
```

---

## 现在能跑什么

| | 状态 |
|---|---|
| 桌面常驻角色（透明置顶、鼠标穿透、不抢焦点） | ✅ |
| 待机生命（呼吸/眨眼/10 个行为/非周期调度） | ✅ |
| 自习室窗口（3D VRM 角色 + 场景合成） | ✅ |
| Mixamo 动捕动作（6 段，重定向到 VRM） | ✅ |
| 模板 + 捏脸（3 套服装、9 个参数） | ✅ |
| 会话状态机（时长/休息点/结束） | ✅ |
| 干预阶梯 L1–L3 + 频率闸门 + 申诉静默 | ✅ |
| 三种人格文案 | ✅ |
| 感知：离席 / 遮挡 / 困倦 / 手机 | ✅ 待真机调参 |
| 基线标定 | ✅ 待真机验证 |
| 今日回放 | ⬜ |
| 照片 → 捏脸参数（本地 landmark） | ⬜ |
| 照片 → 表情集（预生成） | ⬜ |
| 场景与白噪音（Web Audio 程序生成） | ⬜ |

**没有摄像头也能演示**：控制台里有「无摄像头演示通道」，连点几次"模拟：看手机"就能看到闸门把后续干预挡掉。

---

## 文档

- [产品需求文档](docs/PRD-同桌.md)
- [系统架构图](docs/架构图-同桌.html)（5 张图：分层与隐私边界 / 感知管线 / 双状态机 / 干预时序 / 角色渲染层）
- [角色原型](docs/角色原型-A方案.html)（可交互，浏览器直接打开）

## License

MIT
