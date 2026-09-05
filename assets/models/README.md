# 角色模型放这里

## 目前用到的三个

| 文件 | 角色 | 用在哪 |
|---|---|---|
| `AvatarSample_A.vrm` | 女生 | 学生陪伴模式，默认 |
| `boy1.vrm` | 男生 | 学生陪伴模式 |
| `teacher.vrm` | 老师 | 老师监督模式（行为还没做） |

`.vrm` 不进仓库（见根目录 .gitignore），通过微信/网盘单独发。
缩略图 `thumbs/*.jpg` 是进仓库的，设置页的人物卡要用。

新登记的人物写在 `renderer/settings.js` 的 `CAST` 里；
不写也能用 —— 目录里多出来的 `.vrm` 会被自动扫出来列在设置页，
只是没有缩略图和介绍文案。

**动作和表情三个模型完全通用**：都是 VRoid 导出，`Fcl_*` 细分 morph
齐全（验过 `useRecipes: true`），Mixamo 动作也是同一套骨骼。

## 缩略图怎么做

300x400 的 jpg，放 `thumbs/`，文件名对上 `CAST` 里的 `thumb` 字段。
偷懒办法：进自习室把取景收到头肩（`TZRoom.anchorAt(0.92)`），
藏掉界面条截图，裁成 3:4。

## 从 .vroid 导出 .vrm

`.vroid` 是 VRoid Studio 的工程文件（内部是 zip + 私有格式），three.js 读不了。
必须在 VRoid Studio 里导出一次：

1. 打开 VRoid Studio，打开工程
2. 右上角 **相机/导出 → 导出 VRM**
3. 减面、材质合并可以开（提性能）
4. **表情（BlendShape）必须保留** —— 眨眼全靠它
5. VRM 版本选 **1.0**（有问题再退回 0.0）
6. 导出后放到本目录
