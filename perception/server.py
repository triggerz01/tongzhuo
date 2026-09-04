"""server.py — 感知层服务

以 2 FPS 采样摄像头，做本地推理，把「用户状态」通过 WebSocket 推给桌面端。

  * 画面不落盘、不出本机，只发送标签与时长。
  * 休息 / 暂停时摄像头真正释放，不是软暂停。
  * 未装 mediapipe 时直接退出，桌面端会自动降级为纯陪伴模式。

用法：
    python server.py            # 默认 ws://127.0.0.1:8765
    python server.py --show     # 调试：开一个预览窗看检测结果
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

FPS = 2.0                 # PRD §5 补漏 3：2 FPS 足够，30 FPS 会烧 CPU
FPS_CONFIRM = 5.0         # 检出手机后短时升频确认
CONFIRM_SEC = 6.0


class Perception:
    def __init__(self, cam_index: int = 0, show: bool = False) -> None:
        self.cam_index = cam_index
        self.show = show
        self.cap: cv2.VideoCapture | None = None
        self.face = FaceAnalyzer()
        self.phone = PhoneDetector()
        self.clf = Classifier()
        self.clients: set = set()
        self.running = False          # 是否正在采集
        self._boost_until = 0.0
        self.preview = False          # 画中人默认关闭：省 CPU，也是隐私上的默认值

    # ---------- 摄像头 ----------

    def open_cam(self) -> bool:
        if self.cap is not None:
            return True
        cap = cv2.VideoCapture(self.cam_index, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap = cv2.VideoCapture(self.cam_index)
        if not cap.isOpened():
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.cap = cap
        return True

    def close_cam(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        if self.show:
            cv2.destroyAllWindows()

    # ---------- 广播 ----------

    async def broadcast_bytes(self, data: bytes) -> None:
        """二进制消息一律是画中人的 JPEG 帧，前端据此区分，不用再包一层协议。"""
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
        if not self.clients:
            return
        data = json.dumps(msg, ensure_ascii=False)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    # ---------- 主循环 ----------

    async def loop(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            if not self.running:
                await asyncio.sleep(0.25)
                continue

            if not self.open_cam():
                await self.broadcast({"type": "error", "message": "打不开摄像头"})
                self.running = False
                continue

            ok, bgr = await loop.run_in_executor(None, self.cap.read)
            if not ok or bgr is None:
                await asyncio.sleep(0.5)
                continue

            f = Frame(ts=time.time())
            frame_stats(bgr, f)
            # 画面全黑时没必要跑模型
            if f.brightness >= 26 and f.variance >= 55:
                self.face.analyze(bgr, f)
                self.phone.detect(bgr, f)

            res = self.clf.push(f)

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

            if self.preview and self.clients:
                shot = preview.annotate(bgr, f, res["label"], res["duration"])
                jpg = preview.encode(shot)
                if jpg:
                    await self.broadcast_bytes(jpg)

            if f.phone:
                self._boost_until = time.time() + CONFIRM_SEC

            if self.show:
                self._preview(bgr, res)

            fps = FPS_CONFIRM if time.time() < self._boost_until else FPS
            await asyncio.sleep(1.0 / fps)

    def _preview(self, bgr, res) -> None:  # pragma: no cover - 调试用
        txt = f"{res['label']} {res['duration']}s"
        cv2.putText(bgr, txt, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.imshow("tongzhuo perception (debug)", bgr)
        cv2.waitKey(1)

    # ---------- 指令 ----------

    async def handle(self, ws) -> None:
        self.clients.add(ws)
        await ws.send(json.dumps({"type": "hello", "fps": FPS,
                                  "phone": self.phone.ok,
                                  "preview": self.preview}, ensure_ascii=False))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                cmd = msg.get("cmd")

                if cmd == "start" or cmd == "resume":
                    self.running = True
                    print("[perception] 采集开始")
                elif cmd == "pause" or cmd == "stop":
                    self.running = False
                    self.close_cam()          # 真正关闭，不是软暂停
                    print("[perception] 采集暂停，摄像头已释放")
                elif cmd == "preview":
                    self.preview = bool(msg.get("on"))
                    print(f"[perception] 画中人 {'开' if self.preview else '关'}")
                    await ws.send(json.dumps({"type": "preview", "on": self.preview}))
                elif cmd == "calibrate":
                    self.running = True
                    self.clf.start_calibration(15.0)
                    await ws.send(json.dumps({"type": "calibrating", "seconds": 15},
                                             ensure_ascii=False))
                    print("[perception] 开始 15 秒基线标定")
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
