# 角色模型放这里

把 VRoid Studio 导出的 `.vrm` 放进这个目录，文件名用下面任意一个：

- `model2.vrm`（优先）
- `model1.vrm`
- `character.vrm`
- `avatar.vrm`

## 从 .vroid 导出 .vrm

`.vroid` 是 VRoid Studio 的工程文件（内部是 zip + 私有格式），three.js 读不了。
必须在 VRoid Studio 里导出一次：

1. 打开 VRoid Studio，打开工程
2. 右上角 **相机/导出 → 导出 VRM**
3. 减面、材质合并可以开（提性能）
4. **表情（BlendShape）必须保留** —— 眨眼全靠它
5. VRM 版本选 **1.0**（有问题再退回 0.0）
6. 导出后放到本目录
