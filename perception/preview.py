"""preview.py — 画中人：把检测器看到的画面编码后推给前端

为什么画面必须从这里出，而不是前端自己 getUserMedia：
Windows 上摄像头基本是独占的，前端再开一路会直接把检测器饿死。

顺带的好处是，推过去的不是原始画面，而是**带标注的画面**——
用户看到的就是程序处理的全部，既好演示，隐私上也讲得清。
"""
from __future__ import annotations

import cv2
import numpy as np

from detectors import Frame

# 标注配色（BGR）
_C_FACE = (120, 220, 140)     # 人脸框：绿
_C_PHONE = (90, 90, 240)      # 手机框：红
_C_TEXT = (245, 245, 245)
_C_BG = (34, 28, 24)

_LABEL_CN = {
    "focus": "PROFESSIONAL",     # 占位，实际用下面的 ascii 表
}

# OpenCV 的 putText 画不了中文，标签用英文；中文在前端显示
_LABEL_EN = {
    "focus": "FOCUS",
    "away": "AWAY",
    "backturn": "BACK TURNED",
    "phone": "PHONE",
    "drowsy": "DROWSY",
    "covered": "COVERED",
    "calibrating": "CALIBRATING",
    "unknown": "...",
}
_LABEL_COLOR = {
    "focus": (140, 220, 140),
    "away": (170, 170, 170),
    "backturn": (150, 180, 200),
    "phone": (90, 90, 240),
    "drowsy": (80, 190, 240),
    "covered": (200, 120, 220),
    "calibrating": (240, 200, 120),
}


def annotate(bgr: np.ndarray, f: Frame, label: str, duration: float) -> np.ndarray:
    """在画面上叠加检测结果。返回新图，不改原图。"""
    img = bgr.copy()
    h, w = img.shape[:2]

    box = f.extra.get("face_box")
    if box:
        x0, y0, x1, y1 = [int(v) for v in box]
        cv2.rectangle(img, (x0, y0), (x1, y1), _C_FACE, 2)
        # 四角加重，比整框更像"检测中"
        d = max(8, (x1 - x0) // 8)
        for (px, py, dx, dy) in ((x0, y0, d, d), (x1, y0, -d, d),
                                 (x0, y1, d, -d), (x1, y1, -d, -d)):
            cv2.line(img, (px, py), (px + dx, py), _C_FACE, 4)
            cv2.line(img, (px, py), (px, py + dy), _C_FACE, 4)

    for (x1_, y1_, x2_, y2_) in f.extra.get("phone_boxes", []):
        cv2.rectangle(img, (int(x1_), int(y1_)), (int(x2_), int(y2_)), _C_PHONE, 2)
        cv2.putText(img, "PHONE", (int(x1_), max(14, int(y1_) - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, _C_PHONE, 1, cv2.LINE_AA)

    # 底部状态条
    bar_h = 26
    cv2.rectangle(img, (0, h - bar_h), (w, h), _C_BG, -1)
    color = _LABEL_COLOR.get(label, _C_TEXT)
    cv2.putText(img, f"{_LABEL_EN.get(label, label)}  {duration:.0f}s",
                (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

    if f.face:
        info = f"pitch {f.pitch:+.0f}  eye {f.ear:.2f}"
    else:
        info = "no face"
    (tw, _), _ = cv2.getTextSize(info, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
    cv2.putText(img, info, (w - tw - 8, h - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (170, 170, 170), 1, cv2.LINE_AA)

    return img


def encode(bgr: np.ndarray, width: int = 320, quality: int = 60) -> bytes | None:
    """缩放 + JPEG 编码。2 FPS 下大约每帧 15–25KB，本机回环毫无压力。"""
    h, w = bgr.shape[:2]
    if w > width:
        nh = int(h * width / w)
        bgr = cv2.resize(bgr, (width, nh), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buf.tobytes() if ok else None
