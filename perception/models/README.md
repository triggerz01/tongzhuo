# 感知层模型

| 文件 | 用途 | 大小 |
|---|---|---|
| `face_landmarker.task` | 人脸关键点 + 头部姿态 + 表情系数 | 3.6 MB |
| `efficientdet_lite0.tflite` | 目标检测（手机、人体），COCO 80 类 | 13 MB |
| `efficientdet_lite2.tflite` | 同上，更准更慢 | 22 MB |

**目标检测模型是自动挑的**：`detectors.py` 里的 `_pick_object_model()`
优先用 lite2，没有就退回 lite0。想换模型只要把文件丢进这个目录，不用改代码。

## 为什么不用 YOLOv8 / ultralytics

ultralytics 依赖 torch，Windows 上那个 wheel 有 124 MB，在国内网络下
反复下不完（阿里、腾讯镜像都试过，中途断）。mediapipe 我们本来就装了，
它自带的 ObjectDetector 同样是 COCO 训练的，模型小一个数量级，
下载源也是能通的那个 Google 存储。

## 万一模型丢了

```
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/latest/efficientdet_lite0.tflite
https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/latest/efficientdet_lite2.tflite
```
