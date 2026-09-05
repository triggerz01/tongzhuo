# -*- coding: utf-8 -*-
"""白底抠图 v3：按颜色取实心区 + 补洞，不再靠 flood fill 的连通性。

前两版都栽在同一件事上：白马克杯、白猫毛和白背景是同一个颜色，
flood fill 靠连通性走过去，要么够不着阴影（v1 留白斑），
要么从物体边缘钻进去把白色部分吃穿（v2 杯身没了）。

这版换个判据：
  1. "不是白背景"= 亮度够暗 或 彩度够高。阴影是又亮又灰的，天然被排除；
     物体的白色部分虽然也又亮又灰，但它被物体自己的暗边框住。
  2. 闭运算把柔边桥接起来，再从画布外圈往里补洞 ——
     被暗边围住的白色区域会被认回来，杯身和白毛就回来了。
  3. 最后腐蚀 1px 去白边。
"""
import os
import numpy as np
import scipy.ndimage as nd
from PIL import Image, ImageFilter

SRC = r'D:\heckerson\item'
DST = r'D:\heckerson\tongzhuo\assets\items'

# 每件东西的判据可以微调：亮度上限越高、彩度下限越低，收得越多
CFG = {
    'lamp':  {'tag': '8140', 'lum': 232, 'sat': 12},
    'plant': {'tag': '5937', 'lum': 232, 'sat': 14},
    'mug':   {'tag': '1225', 'lum': 230, 'sat': 10},
    'books': {'tag': '5011', 'lum': 232, 'sat': 12},
    'cat':   {'tag': '7021', 'lum': 230, 'sat': 10},
}


def find(tag):
    for f in os.listdir(SRC):
        if f.startswith('jimeng-2026-09-05-' + tag + '-'):
            return os.path.join(SRC, f)
    raise SystemExit('找不到 ' + tag)


def cut(path, lum_max, sat_min):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    lum = a.mean(axis=2)
    sat = mx - mn                       # 简单彩度：最大通道减最小通道

    solid = (lum < lum_max) | (sat > sat_min)

    # 闭运算：把柔化的边缘桥接起来，免得补洞时从缝里漏出去
    solid = nd.binary_closing(solid, structure=np.ones((7, 7)))
    # 补洞：被暗边围住的白色区域认回来（杯身、白毛、书页）
    solid = nd.binary_fill_holes(solid)
    # 去掉零星噪点：只留最大的连通块（外加面积超过 0.2% 的其他块）
    lab, n = nd.label(solid)
    if n > 1:
        sizes = nd.sum(solid, lab, range(1, n + 1))
        keep = np.where(sizes >= max(sizes) * 0.02)[0] + 1
        solid = np.isin(lab, keep)

    # 最后一刀：地面阴影永远在物体下方。逐列找到"确实是物体"的最低点，
    # 再往下留 6px 缓冲，其余全切掉 —— 物体正下方那片残影就是这么去的。
    strong = (lum < 212) | (sat > 22)
    strong = nd.binary_closing(strong, structure=np.ones((5, 5)))
    H = solid.shape[0]
    rows_idx = np.arange(H)[:, None]
    have = strong.any(axis=0)
    lowest = np.where(have, (strong * rows_idx).max(axis=0), H)
    cut_below = np.minimum(lowest + 6, H - 1)
    solid &= rows_idx <= cut_below[None, :]

    # 去白丝：只在离轮廓 8px 以内的地方，按"有多白"把 alpha 拉下来。
    # 物体内部离边界远，不受影响；贴着边的那几道白残影会淡掉。
    dist = nd.distance_transform_edt(solid)
    edge = np.clip((8.0 - dist) / 8.0, 0, 1)              # 越靠边越接近 1
    whiteness = np.clip((lum - 214) / 26.0, 0, 1) * (sat < 18)
    alpha = (solid * 255 * (1 - edge * whiteness)).astype(np.uint8)
    am = Image.fromarray(alpha, 'L')
    am = am.filter(ImageFilter.MinFilter(3))        # 腐蚀 1px，去白边
    am = am.filter(ImageFilter.GaussianBlur(0.8))

    out = im.convert('RGBA')
    out.putalpha(am)
    box = out.getbbox()
    if box:
        out = out.crop(box)                          # 裁到外接框 → 底边自动贴底
    k = 1024 / max(out.size)
    if k < 1:
        out = out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS)
    return out, solid.mean()


os.makedirs(DST, exist_ok=True)
print(f'{"物件":<8}{"尺寸":<14}{"宽高比":<9}{"占画面"}')
for name, cfg in CFG.items():
    img, frac = cut(find(cfg['tag']), cfg['lum'], cfg['sat'])
    img.save(os.path.join(DST, name + '.png'))
    print(f'{name:<9}{str(img.width)+"x"+str(img.height):<14}'
          f'{round(img.width/img.height,2):<10}{frac*100:.1f}%')
