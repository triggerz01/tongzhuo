"""classifier.py — 基线标定 + 时序滑窗 + 规则判定

两条原则（见 PRD §5）：
  1. 单帧永远不做判定，判定只发生在持续时长上。
  2. 所有阈值是相对基线的偏移，不是绝对角度——不同人、不同摄像头高度差异可达 30°。
"""
from __future__ import annotations

import statistics
import time
from collections import deque
from dataclasses import dataclass, asdict

from detectors import Frame

# 判定所需的持续时长（秒），来自 PRD §5 的阈值表
DURATION = {
    "covered": 5.0,
    "away": 25.0,
    "phone": 8.0,   # 服务端只是打个 trigger 标记，真正的提醒时长在前端 LINK 里
    "phone_near": 5.0,
    "drowsy": 20.0,
    "slump": 20.0,     # 趴桌
    "backturn": 40.0,  # 背对镜头
}

# 判定优先级：越靠前越优先（遮挡最明确，专注是兜底）
PRIORITY = ["covered", "away", "backturn", "phone", "drowsy", "focus"]


@dataclass
class Baseline:
    pitch: float = 0.0
    roll: float = 0.0
    ear: float = 0.25
    face_area: float = 0.05
    face_cy: float = 0.45
    ready: bool = False


class Classifier:
    def __init__(self) -> None:
        self.baseline = Baseline()
        self.window: deque[Frame] = deque(maxlen=120)   # 2 FPS × 60 秒
        self._cal: list[Frame] = []
        self._calibrating = False
        self._cal_until = 0.0

        self.label = "unknown"
        self.label_since = time.time()
        self._fired_episode = False

    def reset_episode(self) -> None:
        """把当前这一段的计时清零。

        准备页上摄像头可以先开着看画面，但那段时间不该算进自习里 ——
        不清零的话，一进自习室"专注"就已经是 53 秒了。"""
        self.label_since = time.time()
        self._fired_episode = False

    # ---------------- 基线标定 ----------------

    def start_calibration(self, seconds: float = 15.0) -> None:
        self._cal.clear()
        self._calibrating = True
        self._cal_until = time.time() + seconds

    @property
    def calibrating(self) -> bool:
        return self._calibrating

    def _feed_calibration(self, f: Frame) -> dict | None:
        if f.face:
            self._cal.append(f)
        if time.time() < self._cal_until:
            return None

        self._calibrating = False
        good = [x for x in self._cal if x.face]
        if len(good) < 8:
            return {"ok": False, "reason": "没有采到足够的人脸帧，请正对摄像头重试"}

        med = lambda key: statistics.median([getattr(x, key) for x in good])  # noqa: E731
        self.baseline = Baseline(
            pitch=med("pitch"), roll=med("roll"), ear=med("ear"),
            face_area=med("face_area"), face_cy=med("face_cy"), ready=True,
        )
        return {"ok": True, "baseline": asdict(self.baseline), "frames": len(good)}

    # ---------------- 逐帧判定 ----------------

    def push(self, f: Frame) -> dict:
        """喂一帧，返回当前判定结果。

        返回 {label, duration, trigger, calibrating, detail}
        trigger 只在"本次连续片段首次达到阈值"时为 True——
        重复触发交给渲染端的频率闸门，感知层不重复喊。
        """
        self.window.append(f)

        if self._calibrating:
            done = self._feed_calibration(f)
            return {"label": "calibrating", "duration": 0.0, "trigger": False,
                    "calibrating": done is None, "calibration": done}

        cand = self._instant_label(f)
        now = time.time()
        if cand != self.label:
            self.label = cand
            self.label_since = now
            self._fired_episode = False

        duration = now - self.label_since
        need = DURATION.get(cand)
        trigger = False
        if need is not None and duration >= need and not self._fired_episode:
            trigger = True
            self._fired_episode = True

        return {"label": cand, "duration": round(duration, 1), "trigger": trigger,
                "calibrating": False,
                "detail": {"pitch": round(f.pitch, 1), "ear": round(f.ear, 3),
                           "phone": f.phone, "face": f.face}}

    # ---------------- 规则 ----------------

    def _instant_label(self, f: Frame) -> str:
        b = self.baseline

        # 四·遮挡镜头：亮度与方差同时塌陷
        if f.brightness < 26 or f.variance < 55:
            return "covered"

        # 三·手机 —— 必须排在人脸判断之前。
        # 低头看手机时人脸经常丢失，要是先判"没脸"，标签就会变成 away/backturn，
        # 手机那一段的计时会不停重新开始，永远攒不够触发时长。
        # 检出手机本身就说明人在，没必要再要一张脸。
        if f.phone:
            return "phone"

        # 一·离开画面 vs 背对镜头：有没有人是两回事
        # （画面里检出 person 但没脸 = 背对或趴桌，阈值更长，见 DURATION）
        if not f.face:
            return "backturn" if f.person else "away"

        # 二·困倦：低头超基线 + 闭眼 + 头部几乎不动
        pitch_off = f.pitch - b.pitch
        eyes_closed = f.ear < b.ear * 0.62
        if eyes_closed and (pitch_off > 12 or abs(f.roll - b.roll) > 25):
            if self._still():
                return "drowsy"

        # 二·趴桌：人脸整体下移且变大/变形
        if f.face_cy > b.face_cy + 0.16 and eyes_closed:
            return "drowsy"

        # 五·有效学习（对照）：其余情况且姿态在基线附近
        return "focus"

    def _still(self, span: int = 12) -> bool:
        """最近 span 帧（约 6 秒）头部位移方差极低 → 静止不动。"""
        xs = [x.pitch for x in list(self.window)[-span:] if x.face]
        if len(xs) < max(4, span // 2):
            return False
        try:
            return statistics.pstdev(xs) < 1.6
        except statistics.StatisticsError:
            return False
