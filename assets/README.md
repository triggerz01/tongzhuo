# 素材目录

**大文件不在 Git 仓库里**——国内拉 GitHub 很慢，30MB 的二进制会让 clone 变成酷刑。
这些文件通过微信/网盘单独发，**丢进对应目录即可，代码会自动扫描识别，不用改任何配置**。

| 目录 | 放什么 | 大小 | 没有会怎样 |
|---|---|---|---|
| `assets/models/` | `.vrm` 角色模型 | ~18 MB | 自习室里没有人，界面提示放模型 |
| `assets/animations/` | Mixamo 的 `.fbx` 动作 | ~8 MB | 角色还在，退回程序化待机（呼吸/眨眼/骨骼动作） |
| `perception/models/` | `face_landmarker.task` | ~3.8 MB | 感知层起不来，桌面端不受影响 |

已经在仓库里的小文件（场景图、实拍照片）不用管。

## 拿到素材包之后

解压，把三个目录的内容对号入座放进去，然后：

```bash
npm start -- --room
```

看到 3D 角色坐在自习室里、会呼吸会眨眼、隔十几秒做个小动作，就说明齐了。

## 万一素材包丢了

- **`face_landmarker.task`** 可以自己下（3.58 MB）：
  <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task>
  （Google CDN，国内不一定通）
- **`.vrm` 角色**：VRoid Studio 里重新导出，见 `assets/models/README.md`
- **`.fbx` 动作**：Mixamo 重新下，要 `Sitting Idle` / `Breathing Idle` / `Bored` /
  `Look Around` / `Head Nod Yes` / `Sitting Talking`，格式选 **FBX for Unity / Without Skin**
