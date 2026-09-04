# 环境搭建

给新加入的同学。**这台机器上踩过的坑全写在这儿了，照着走能省两小时。**

前提：Windows。macOS/Linux 把路径换一下，逻辑一样。

---

## 0. 先说结论：国内网络有三道墙

在开始之前先知道这三件事，省得卡住：

| 你会遇到 | 现象 | 解法 |
|---|---|---|
| `winget` 装不了东西 | `Failed when searching source: winget` | 别用 winget，从 GitHub Releases 或镜像直接下 |
| Electron 二进制卡住 | `Downloading Electron binary...` 十分钟不动 | 设 `ELECTRON_MIRROR` 走 npmmirror |
| pip 清华源握手失败 | `SSL: UNEXPECTED_EOF_WHILE_READING` | 换阿里源 |

---

## 1. 克隆

```bash
git clone <仓库地址>
cd tongzhuo
```

仓库带一个 18MB 的 `.vrm` 角色模型和四张场景图，克隆约 15MB，正常。

---

## 2. 桌面端（必需）

需要 **Node.js 18+**（我这边是 24.19）。

```bash
npm install
```

装完如果 `npm start` 卡在 `Downloading Electron binary...`，是 Electron 的二进制走 GitHub 通道被墙。用镜像重下：

```powershell
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
node node_modules/electron/install.js
```

（Git Bash 下用 `export ELECTRON_MIRROR=...`）

然后：

```bash
npm start              # 桌宠形态（透明置顶小人）
npm start -- --room    # 自习室形态（3D 角色 + 场景，主形态）
```

**桌面端不依赖摄像头和 Python，装完就能跑。** 角色、待机生命、会话、干预阶梯全都能演示。

---

## 3. 感知层（可选，要摄像头才需要）

> ⚠️ **mediapipe / ultralytics 不支持 Python 3.14，必须用 3.12。**
> 3.12 最后一个带 Windows 安装包的版本是 **3.12.10**（之后只发源码）。

python.org 的文件下载通道在国内经常超时，走镜像：

```
https://registry.npmmirror.com/-/binary/python/3.12.10/python-3.12.10-amd64.exe
```

装的时候勾 **Install for me only**，`TargetDir` 指到独立目录，不要覆盖你现有的 Python。

然后建虚拟环境：

```bash
cd perception
py -3.12 -m venv .venv          # 或者直接用 3.12 的完整路径
.venv\Scripts\activate
pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
python server.py                # 加 --show 开预览窗看检测结果
```

**注意 `-i https://mirrors.aliyun.com/pypi/simple/`**。清华源在有代理的环境下会 SSL 握手失败，实测报 `SSL: UNEXPECTED_EOF_WHILE_READING`。阿里、华为、腾讯源和官方源都正常。

> **关于 mediapipe 的坑**：网上的教程大多写 `mp.solutions.face_mesh`，
> 但那套 API **已经从 mediapipe 里删除了**（0.10.35 和 1.x 都没有）。
> 我们用的是 Tasks API（`mediapipe.tasks.python.vision.FaceLandmarker`）。
> 它需要一个 `.task` 模型文件，已经放在 `perception/models/` 里随仓库分发，
> **不需要联网下载**，赛场断网也能跑。

`ultralytics` 会拉 torch（约 2GB），赶时间可以先不装——**不装也能跑**，只是手机检测那一类不生效。

---

## 4. 验证装好了

```bash
npm start -- --room
```

应该看到：3D 角色坐在自习室里，会呼吸、会眨眼、隔十几秒做一个小动作。右下角能切场景、测动作。

感知层跑起来之后，窗口左上角的小圆点会变红，表示摄像头在工作。

---

## 5. 两个可能要装的工具

- **GitHub CLI**：winget 装不上，从 [releases](https://github.com/cli/cli/releases) 下 `gh_*_windows_amd64.zip` 解压即用，不需要管理员权限
- **VRoid Studio**（只有要改角色模型才需要）：<https://vroid.com/studio>，免费

---

## 6. 关于素材

`assets/models/` 里的 `.vrm` 是我们自己用 VRoid 做的。

**不要把从网上下载的第三方模型提交到这个公开仓库**——很多 VRM 模型的授权不允许再分发。要用第三方模型先看它的 license。
