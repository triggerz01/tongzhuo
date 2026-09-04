"""连一下感知层，看状态推送和画中人帧是否正常。调试用，不参与运行。"""
import asyncio, json, sys, time
import websockets

async def main():
    uri = "ws://127.0.0.1:8765"
    async with websockets.connect(uri, proxy=None) as ws:  # 环境里有代理，本机回环必须绕过
        print("已连接")
        await ws.send(json.dumps({"cmd": "start"}))
        await ws.send(json.dumps({"cmd": "preview", "on": True}))

        states, frames, t0 = 0, 0, time.time()
        labels = {}
        while time.time() - t0 < 12:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                print("超时：5 秒没收到任何消息"); break
            if isinstance(msg, bytes):
                frames += 1
                if frames == 1:
                    open("preview_sample.jpg", "wb").write(msg)
                    print(f"  首帧已存 preview_sample.jpg  {len(msg)} 字节")
            else:
                d = json.loads(msg)
                if d.get("type") == "state":
                    states += 1
                    labels[d["label"]] = labels.get(d["label"], 0) + 1
                    if states <= 3 or d.get("trigger"):
                        print(f"  state: {d['label']:10s} {d['duration']:5.1f}s "
                              f"trigger={d.get('trigger')} {d.get('detail')}")
                else:
                    print("  ", d)
        await ws.send(json.dumps({"cmd": "pause"}))
        print(f"\n12 秒内：状态 {states} 条，画面 {frames} 帧")
        print("标签分布:", labels)

asyncio.run(main())
