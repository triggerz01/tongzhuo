"""server.py — 感知层服务

采集摄像头 → 本地推理 → 把「用户状态」通过 WebSocket 推给桌面端。

  * 画面不落盘、不出本机，只发送标签与带标注的预览帧。
  * 休息 / 暂停时摄像头真正释放，不是软暂停。
  * 未装 mediapipe 时直接退出，桌面端会自动降级为纯陪伴模式。

三档帧率是刻意分开的（这是画中人不卡的关键）：
  采集 15 FPS  → 画中人流畅
  人脸 5 FPS   → 标注框跟得上，CPU 又不炸
  手机 2 FPS   → YOLO 最贵，压到最低
画中人关掉时三档一起降到 2 FPS，回到最省电的状态。

用法：
    python server.py            # 默认 ws://127.0.0.1:8765
    python server.py --show     # 调试：开一个本地预览窗
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time

import cv2

from detectors import Frame, FaceAnalyzer, PhoneDetector, frame_stats
from classifier import Classifier
import preview

try:
    import websockets
except ImportError:  # pragma: no cover
    raise SystemExit("缺少 websockets：pip install websockets")

# ---- 帧率 ----
CAPTURE_FPS_PREVIEW = 15.0
CAPTURE_FPS_IDLE = 2.0
FACE_FPS_PREVIEW = 5.0
FACE_FPS_IDLE = 2.0
PHONE_FPS = 2.0
PHONE_FPS_BOOST = 5.0      # 检出手机后短时升频确认
BOOST_SEC = 6.0

# ---- 取景模式 ----
# 摄像头不支持变焦（实测 CAP_PROP_ZOOM 设置失败），纵向视野是镜头定死的。
# 所以模式只影响分辨率和判定阈值，"拍得更宽"要靠用户挪摄像头——
# 前端的轮廓线就是干这个的。
MODES = {
    # 电脑办公：只要人脸。4:3 够用，最省。
    "office": {"w": 640, "h": 480, "label": "电脑办公"},
    # 桌面读写：要看到手臂和桌面。16:9 横向更宽（实测比 4:3 宽一截），
    # 分辨率也更高，手部细节更清楚。
    "desk": {"w": 1280, "h": 720, "label": "桌面读写"},
}
DEFAULT_MODE = "office"


class Perception:
    def __init__(self, cam_index: int = 0, show: bool = False) -> None:
        self.cam_index = cam_index
        self.show = show
        self.cap: cv2.VideoCapture | None = None
        self.face = FaceAnalyzer()
        self.phone = PhoneDetector()
        self.clf = Classifier()
        self.clients: set = set()
        self.running = False
        self.preview = False          # 画中人默认关：省 CPU，也是隐私上的默认值
        self.mode = DEFAULT_MODE

        self._last_face_at = 0.0
        self._last_phone_at = 0.0
        self._boost_until = 0.0
        self._last_frame: Frame = Frame()      # 两次推理之间，标注沿用上一次的结果
        self._last_res: dict = {"label": "unknown", "duration": 0.0,
                                "trigger": False, "calibrating": False}

    # ---------- 摄像头 ----------

    def open_cam(self) -> bool:
        if self.cap is not None:
            return True
        cap = cv2.VideoCapture(self.cam_index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(self.cam_index)
        if not cap.isOpened():
            return False
        m = MODES[self.mode]
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, m["w"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, m["h"])
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # 少缓冲，画面更跟手
        except Exception:
            pass
        self.cap = cap
        return True

    def close_cam(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        if self.show:
            cv2.destroyAllWindows()

    def set_mode(self, mode: str) -> bool:
        if mode not in MODES or mode == self.mode:
            return False
        self.mode = mode
        if self.cap is not None:       # 换分辨率必须重开
            self.close_cam()
            self.open_cam()
        return True

    # ---------- 广播 ----------

    async def _send_all(self, data) -> None:
        if not self.clients:
            return
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def broadcast(self, msg: dict) -> None:
        await self._send_all(json.dumps(msg, ensure_ascii=False))

    async def broadcast_bytes(self, data: bytes) -> None:
        """二进制消息一律是画中人的 JPEG 帧，前端据此区分，不用再包一层协议。"""
        await self._send_all(data)

    # ---------- 主循环 ----------

    async def loop(self) -> None:
        aloop = asyncio.get_running_loop()
        while True:
            if not self.running:
                await asyncio.sleep(0.25)
                continue

            if not self.open_cam():
                await self.broadcast({"type": "error", "message": "打不开摄像头"})
                self.running = False
                continue

            ok, bgr = await aloop.run_in_executor(None, self.cap.read)
            if not ok or bgr is None:
                await asyncio.sleep(0.5)
                continue

            now = time.time()
            live = self.preview and bool(self.clients)

            face_period = 1.0 / (FACE_FPS_PREVIEW if live else FACE_FPS_IDLE)
            phone_fps = PHONE_FPS_BOOST if now < self._boost_until else PHONE_FPS
            phone_period = 1.0 / phone_fps

            do_face = (now - self._last_face_at) >= face_period
            do_phone = self.phone.ok and (now - self._last_phone_at) >= phone_period

            if do_face:
                self._last_face_at = now
                f = Frame(ts=now)
                frame_stats(bgr, f)
                # 画面全黑时没必要跑模型
                if f.brightness >= 26 and f.variance >= 55:
                    self.face.analyze(bgr, f)
                    if do_phone:
                        self._last_phone_at = now
                        self.phone.detect(bgr, f)
                    else:
                        # 沿用上一次的手机结果，避免标签在两次 YOLO 之间抖
                        f.phone = self._last_frame.phone
                        f.phone_near_face = self._last_frame.phone_near_face
                        f.extra["phone_boxes"] = self._last_frame.extra.get("phone_boxes", [])

                res = self.clf.push(f)
                self._last_frame, self._last_res = f, res

                if res.get("calibration") is not None:
                    await self.broadcast({"type": "calibrated", **res["calibration"]})

                if not res["calibrating"]:
                    await self.broadcast({
                        "type": "state",
                        "label": res["label"],
                        "duration": res["duration"],
                        "trigger": res["trigger"],
                        "detail": res.get("detail", {}),
                        "ts": f.ts,
                    })

                if f.phone:
                    self._boost_until = now + BOOST_SEC

            # 画中人：每一帧都推，标注沿用最近一次的推理结果
            if live:
                shot = preview.annotate(bgr, self._last_frame,
                                        self._last_res["label"],
                                        self._last_res["duration"])
                jpg = preview.encode(shot)
                if jpg:
                    await self.broadcast_bytes(jpg)

            if self.show:
                self._debug_window(bgr, self._last_res)

            cap_fps = CAPTURE_FPS_PREVIEW if live else CAPTURE_FPS_IDLE
            await asyncio.sleep(1.0 / cap_fps)

    def _debug_window(self, bgr, res) -> None:  # pragma: no cover - 调试用
        txt = f"{res['label']} {res['duration']}s"
        cv2.putText(bgr, txt, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.imshow("tongzhuo perception (debug)", bgr)
        cv2.waitKey(1)

    # ---------- 指令 ----------

    def _hello(self) -> str:
        return json.dumps({
            "type": "hello",
            "phone": self.phone.ok,
            "preview": self.preview,
            "mode": self.mode,
            "modes": {k: v["label"] for k, v in MODES.items()},
            "fps": {"capture": CAPTURE_FPS_PREVIEW, "face": FACE_FPS_PREVIEW},
        }, ensure_ascii=False)

    async def handle(self, ws) -> None:
        self.clients.add(ws)
        await ws.send(self._hello())
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                cmd = msg.get("cmd")

                if cmd in ("start", "resume"):
                    self.running = True
                    print("[perception] 采集开始")
                elif cmd in ("pause", "stop"):
                    self.running = False
                    self.close_cam()          # 真正关闭，不是软暂停
                    print("[perception] 采集暂停，摄像头已释放")
                elif cmd == "preview":
                    self.preview = bool(msg.get("on"))
                    print(f"[perception] 画中人 {'开' if self.preview else '关'}")
                    await ws.send(json.dumps({"type": "preview", "on": self.preview}))
                elif cmd == "mode":
                    m = msg.get("mode")
                    changed = self.set_mode(m)
                    print(f"[perception] 取景模式 → {self.mode}")
                    await ws.send(json.dumps({"type": "mode", "mode": self.mode,
                                              "changed": changed,
                                              "size": [MODES[self.mode]["w"],
                                                       MODES[self.mode]["h"]]},
                                             ensure_ascii=False))
                elif cmd == "calibrate":
                    self.running = True
                    self.clf.start_calibration(float(msg.get("seconds", 15)))
                    await ws.send(json.dumps({"type": "calibrating", "seconds": 15},
                                             ensure_ascii=False))
                    print("[perception] 开始基线标定")
        finally:
            self.clients.discard(ws)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--cam", type=int, default=0)
    ap.add_argument("--show", action="store_true", help="开预览窗（调试用）")
    args = ap.parse_args()

    per = Perception(cam_index=args.cam, show=args.show)
    print(f"[perception] ws://{args.host}:{args.port} · 手机检测={'on' if per.phone.ok else 'off'}")
    print("[perception] 画面不落盘、不出本机")

    async with websockets.serve(per.handle, args.host, args.port):
        await per.loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[perception] 退出")
