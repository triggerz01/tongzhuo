"""detectors.py — 单帧特征提取

只负责"这一帧看到了什么"，不做任何行为判定（那是 classifier.py 的事）。
全部本地推理，画面不出本机。

用 MediaPipe Tasks API（FaceLandmarker）。旧的 mp.solutions 已经从
mediapipe 里移除了，不要再找它。Tasks API 需要一个 .task 模型文件，
已经放在 perception/models/ 里，随仓库分发，不需要联网下载。
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    _HAS_MP = True
except Exception:  # pragma: no cover
    _HAS_MP = False

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task")
_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")

def _pick_object_model() -> str:
    """有更大的模型就优先用。想换只要把文件丢进 models/，不用改代码。"""
    for name in ("efficientdet_lite2.tflite", "efficientdet_lite0.tflite"):
        p = os.path.join(_MODEL_DIR, name)
        if os.path.exists(p):
            return p
    return os.path.join(_MODEL_DIR, "efficientdet_lite0.tflite")

OBJ_MODEL_PATH = _pick_object_model()


@dataclass
class Frame:
    """一帧的全部特征。"""
    ts: float = 0.0
    face: bool = False
    pitch: float = 0.0          # 俯仰角，低头为正（正负号需真机核对一次）
    roll: float = 0.0           # 侧倾角
    yaw: float = 0.0            # 左右转头
    ear: float = 0.0            # 睁眼程度 0–1，越大越睁开
    face_area: float = 0.0      # 人脸框面积占画面比
    face_cy: float = 0.5        # 人脸中心纵向位置（趴桌时会下移）
    phone: bool = False
    phone_near_face: bool = False
    person: bool = False   # 画面里有人但没脸 → 背对镜头/趴桌，而不是真的走了
    brightness: float = 0.0
    variance: float = 0.0
    extra: dict = field(default_factory=dict)


def _euler_from_matrix(m: np.ndarray) -> tuple[float, float, float]:
    """4x4 位姿矩阵 → (pitch, yaw, roll)，单位度。"""
    r = m[:3, :3]
    sy = math.sqrt(r[0, 0] ** 2 + r[1, 0] ** 2)
    if sy > 1e-6:
        pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    else:  # 万向锁
        pitch = math.degrees(math.atan2(-r[1, 2], r[1, 1]))
        yaw = math.degrees(math.atan2(-r[2, 0], sy))
        roll = 0.0
    return pitch, yaw, roll


class FaceAnalyzer:
    """MediaPipe FaceLandmarker：头部姿态 + 闭眼程度 + 人脸位置。

    比手写 solvePnP + EAR 好在两点：姿态矩阵是模型直接输出的，
    闭眼用的是 52 个表情系数里的 eyeBlink，比几何算的 EAR 稳得多。
    """

    def __init__(self, model_path: str = MODEL_PATH) -> None:
        if not _HAS_MP:
            raise RuntimeError("未安装 mediapipe。用 Python 3.12 + pip install mediapipe")
        if not os.path.exists(model_path):
            raise RuntimeError(
                f"缺少模型文件 {model_path}\n"
                "它应该随仓库一起分发。如果丢了，从这里下载：\n"
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
                "face_landmarker/float16/latest/face_landmarker.task"
            )

        opts = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            min_face_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._lm = mp_vision.FaceLandmarker.create_from_options(opts)
        self._t0 = time.time()

    def close(self) -> None:
        try:
            self._lm.close()
        except Exception:
            pass

    def analyze(self, bgr: np.ndarray, out: Frame) -> Frame:
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int((time.time() - self._t0) * 1000)

        try:
            res = self._lm.detect_for_video(mp_img, ts_ms)
        except Exception as exc:  # pragma: no cover
            print(f"[perception] 人脸推理失败：{exc}")
            out.face = False
            return out

        if not res.face_landmarks:
            out.face = False
            return out

        out.face = True

        # 人脸框：取所有关键点的包围盒
        pts = np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]], dtype=np.float64)
        x0, y0 = pts[:, 0].min(), pts[:, 1].min()
        x1, y1 = pts[:, 0].max(), pts[:, 1].max()
        out.face_area = float(((x1 - x0) * (y1 - y0)) / (w * h))
        out.face_cy = float(((y0 + y1) / 2.0) / h)
        out.extra["face_box"] = (float(x0), float(y0), float(x1), float(y1))

        # 头部姿态：模型直接给 4x4 位姿矩阵
        if res.facial_transformation_matrixes:
            m = np.array(res.facial_transformation_matrixes[0]).reshape(4, 4)
            out.pitch, out.yaw, out.roll = _euler_from_matrix(m)

        # 睁眼程度：用表情系数里的 eyeBlink，比几何 EAR 稳
        if res.face_blendshapes:
            blink = {c.category_name: c.score for c in res.face_blendshapes[0]
                     if c.category_name in ("eyeBlinkLeft", "eyeBlinkRight")}
            closed = max(blink.values()) if blink else 0.0
            out.ear = float(1.0 - closed)      # 1 = 完全睁开，0 = 闭紧
            out.extra["blendshapes"] = {
                c.category_name: round(c.score, 3)
                for c in res.face_blendshapes[0] if c.score > 0.15
            }
        else:
            out.ear = 1.0

        return out


class PhoneDetector:
    """手机检测：MediaPipe ObjectDetector + EfficientDet-Lite0（COCO 80 类）。

    原本打算用 ultralytics/YOLOv8n，但它依赖 torch —— 124MB 的 wheel 在
    这个网络下反复下不完（试过阿里、腾讯两个镜像都中途断）。
    而 mediapipe 我们已经装了，它自带的 ObjectDetector 同样是 COCO 训练的，
    模型只有 13MB，走的还是下 face_landmarker 那个能通的源。
    零新依赖，反而更省。

    模型文件缺失时静默降级（phone 一类不生效，其余功能不受影响）。
    """

    # 顺带认 person：没脸但有人 = 背对镜头或趴桌，和"真的离席"是两回事，
    # 这两种在 PRD 里本来就是不同阈值的两条行为，之前没法区分。
    TARGETS = ("cell phone", "person")

    # 检出后保持一段时间。手机一晃就是运动模糊，小模型很容易漏一两帧；
    # 而判定要求"连续 N 秒有手机"，漏一帧累计就清零，阈值永远达不到。
    # 所以这里做迟滞：见过就按住，直到确实消失超过 HOLD_SEC。
    HOLD_SEC = 2.5

    def __init__(self, model_path: str = OBJ_MODEL_PATH, score: float = 0.28) -> None:
        self.ok = False
        self._det = None
        self._t0 = time.time()
        self._phone_seen_at = 0.0
        self._phone_boxes: list = []
        if not _HAS_MP:
            print("[perception] 手机检测未启用：没有 mediapipe")
            return
        if not os.path.exists(model_path):
            print("[perception] 手机检测未启用：缺少 "
                  + os.path.basename(model_path)
                  + "  下载：https://storage.googleapis.com/mediapipe-models"
                    "/object_detector/efficientdet_lite0/float32/latest"
                    "/efficientdet_lite0.tflite")
            return
        try:
            opts = mp_vision.ObjectDetectorOptions(
                base_options=mp_python.BaseOptions(model_asset_path=model_path),
                running_mode=mp_vision.RunningMode.VIDEO,
                score_threshold=score,
                category_allowlist=list(self.TARGETS),
            )
            self._det = mp_vision.ObjectDetector.create_from_options(opts)
            self.ok = True
        except Exception as exc:  # pragma: no cover
            print(f"[perception] 手机检测未启用：{exc}")

    def close(self) -> None:
        try:
            if self._det:
                self._det.close()
        except Exception:
            pass

    def detect(self, bgr: np.ndarray, out: Frame) -> Frame:
        if not self.ok:
            return out
        try:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = self._det.detect_for_video(mp_img, int((time.time() - self._t0) * 1000))
        except Exception as exc:  # pragma: no cover
            print(f"[perception] 目标检测失败：{exc}")
            return out

        boxes = []
        for d in res.detections:
            bb = d.bounding_box
            name = d.categories[0].category_name if d.categories else ""
            rect = (float(bb.origin_x), float(bb.origin_y),
                    float(bb.origin_x + bb.width), float(bb.origin_y + bb.height))
            if name == "person":
                out.person = True
            else:
                boxes.append(rect)
        now = time.time()
        if boxes:
            self._phone_seen_at = now
            self._phone_boxes = boxes
        held = (now - self._phone_seen_at) < self.HOLD_SEC

        out.phone = bool(boxes) or held
        # 保持期内沿用上一次的框，但标记出来——预览里画成虚线，不骗人
        out.extra["phone_boxes"] = boxes if boxes else (self._phone_boxes if held else [])
        out.extra["phone_held"] = bool(held and not boxes)

        # 手机框是否贴近人脸（举起来刷视频）
        if boxes and out.face:
            h = bgr.shape[0]
            fy = out.face_cy * h
            for (_x1, y1, _x2, y2) in boxes:
                cy = (y1 + y2) / 2.0
                if abs(cy - fy) < h * 0.28:
                    out.phone_near_face = True
                    break
        return out


class AnyObjectDetector(PhoneDetector):
    """调试用：不限类别，看看模型到底认出了什么。"""
    TARGETS = ()

    def __init__(self, model_path: str = OBJ_MODEL_PATH, score: float = 0.35) -> None:
        self.ok = False
        self._det = None
        self._t0 = time.time()
        if not _HAS_MP or not os.path.exists(model_path):
            return
        opts = mp_vision.ObjectDetectorOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            running_mode=mp_vision.RunningMode.VIDEO,
            score_threshold=score,
            max_results=10,
        )
        self._det = mp_vision.ObjectDetector.create_from_options(opts)
        self.ok = True

    def raw(self, bgr: np.ndarray):
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        res = self._det.detect_for_video(mp_img, int((time.time() - self._t0) * 1000))
        return [(d.categories[0].category_name, round(d.categories[0].score, 2))
                for d in res.detections]


def frame_stats(bgr: np.ndarray, out: Frame) -> Frame:
    """遮挡判定用：整帧亮度与方差。用手或书挡住镜头时两者同时塌陷。"""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    out.brightness = float(gray.mean())
    out.variance = float(gray.var())
    return out
