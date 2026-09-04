"""detectors.py — 单帧特征提取

只负责"这一帧看到了什么"，不做任何行为判定（那是 classifier.py 的事）。
全部本地推理，画面不出本机。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

try:
    import mediapipe as mp
    _HAS_MP = True
except Exception:  # pragma: no cover
    _HAS_MP = False

# solvePnP 用的通用 3D 人脸模型点（单位 mm，粗略即可）
_MODEL_POINTS = np.array([
    (0.0,    0.0,    0.0),      # 鼻尖      landmark 1
    (0.0,  -63.6,  -12.5),      # 下巴      landmark 152
    (-43.3, 32.7,  -26.0),      # 左眼外角  landmark 33
    (43.3,  32.7,  -26.0),      # 右眼外角  landmark 263
    (-28.9,-28.9,  -24.1),      # 左嘴角    landmark 61
    (28.9, -28.9,  -24.1),      # 右嘴角    landmark 291
], dtype=np.float64)
_PNP_IDX = [1, 152, 33, 263, 61, 291]

# EAR（眼睛纵横比）用的关键点
_EYE_L = [33, 160, 158, 133, 153, 144]
_EYE_R = [362, 385, 387, 263, 373, 380]


@dataclass
class Frame:
    """一帧的全部特征。"""
    ts: float = 0.0
    face: bool = False
    pitch: float = 0.0          # 俯仰角，正数=低头
    roll: float = 0.0           # 侧倾角
    yaw: float = 0.0            # 左右转头
    ear: float = 0.0            # 眼睛纵横比，越小越闭
    face_area: float = 0.0      # 人脸框面积占画面比
    face_cy: float = 0.5        # 人脸中心纵向位置（趴桌时会下移）
    phone: bool = False
    phone_near_face: bool = False
    brightness: float = 0.0
    variance: float = 0.0
    extra: dict = field(default_factory=dict)


def _ear(pts: np.ndarray, idx: list[int]) -> float:
    p = pts[idx]
    a = np.linalg.norm(p[1] - p[5])
    b = np.linalg.norm(p[2] - p[4])
    c = np.linalg.norm(p[0] - p[3])
    return float((a + b) / (2.0 * c)) if c > 1e-6 else 0.0


class FaceAnalyzer:
    """MediaPipe FaceMesh：头部姿态 + 闭眼程度 + 人脸位置。"""

    def __init__(self) -> None:
        if not _HAS_MP:
            raise RuntimeError("未安装 mediapipe。请用 Python 3.12 并 pip install mediapipe")
        self._mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def close(self) -> None:
        try:
            self._mesh.close()
        except Exception:
            pass

    def analyze(self, bgr: np.ndarray, out: Frame) -> Frame:
        h, w = bgr.shape[:2]
        res = self._mesh.process(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            out.face = False
            return out

        lm = res.multi_face_landmarks[0].landmark
        pts = np.array([(p.x * w, p.y * h) for p in lm], dtype=np.float64)

        out.face = True
        out.ear = (_ear(pts, _EYE_L) + _ear(pts, _EYE_R)) / 2.0

        x0, y0 = pts[:, 0].min(), pts[:, 1].min()
        x1, y1 = pts[:, 0].max(), pts[:, 1].max()
        out.face_area = float(((x1 - x0) * (y1 - y0)) / (w * h))
        out.face_cy = float(((y0 + y1) / 2.0) / h)

        # 头部姿态
        image_pts = pts[_PNP_IDX]
        focal = float(w)
        cam = np.array([[focal, 0, w / 2.0],
                        [0, focal, h / 2.0],
                        [0, 0, 1]], dtype=np.float64)
        ok, rvec, _tvec = cv2.solvePnP(
            _MODEL_POINTS, image_pts, cam, np.zeros((4, 1)),
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if ok:
            rmat, _ = cv2.Rodrigues(rvec)
            proj = np.hstack((rmat, np.zeros((3, 1), dtype=np.float64)))
            _, _, _, _, _, _, euler = cv2.decomposeProjectionMatrix(proj)
            pitch, yaw, roll = [float(a) for a in euler.flatten()[:3]]
            # 归一到 [-90, 90]，低头为正
            out.pitch = _wrap(pitch)
            out.yaw = _wrap(yaw)
            out.roll = _wrap(roll)
        return out


def _wrap(a: float) -> float:
    while a > 90:
        a -= 180
    while a < -90:
        a += 180
    return a


class PhoneDetector:
    """YOLOv8n + COCO 预训练：cell phone 是第 67 类，开箱即用，不用标数据。

    未安装 ultralytics 时静默降级（phone 一类不生效，其余功能不受影响）。
    """

    COCO_CELL_PHONE = 67

    def __init__(self, weights: str = "yolov8n.pt", conf: float = 0.35) -> None:
        self.conf = conf
        self.ok = False
        self._model = None
        try:
            from ultralytics import YOLO  # noqa: WPS433
            self._model = YOLO(weights)
            self.ok = True
        except Exception as exc:  # pragma: no cover
            print(f"[perception] 手机检测未启用：{exc}")

    def detect(self, bgr: np.ndarray, out: Frame) -> Frame:
        if not self.ok:
            return out
        try:
            res = self._model.predict(bgr, verbose=False, conf=self.conf,
                                      classes=[self.COCO_CELL_PHONE])
        except Exception as exc:  # pragma: no cover
            print(f"[perception] YOLO 推理失败：{exc}")
            return out

        boxes = []
        for r in res:
            for b in r.boxes:
                x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
                boxes.append((x1, y1, x2, y2))
        out.phone = len(boxes) > 0
        out.extra["phone_boxes"] = boxes

        # 手机框是否贴近人脸（举起来刷视频）
        if boxes and out.face:
            h, w = bgr.shape[:2]
            fy = out.face_cy * h
            for (x1, y1, x2, y2) in boxes:
                cy = (y1 + y2) / 2.0
                if abs(cy - fy) < h * 0.28:
                    out.phone_near_face = True
                    break
        return out


def frame_stats(bgr: np.ndarray, out: Frame) -> Frame:
    """遮挡判定用：整帧亮度与方差。用手或书挡住镜头时两者同时塌陷。"""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    out.brightness = float(gray.mean())
    out.variance = float(gray.var())
    return out
