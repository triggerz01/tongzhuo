/* mixamo.js — 把 Mixamo 的 FBX 动作重定向到 VRM 骨骼
 *
 * Mixamo 和 VRM 有三处对不上，逐一处理：
 *   1. 骨骼命名不同（mixamorig:LeftArm ↔ leftUpperArm）→ 查表映射
 *   2. 静止姿势不同 → 用两边的世界旋转做一次坐标变换
 *   3. 单位不同（Mixamo 用厘米，VRM 用米）+ 身高不同 → 按胯高比例缩放位移
 *
 * 做法沿用 @pixiv/three-vrm 官方示例 loadMixamoAnimation 的思路。
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/** Mixamo 骨骼名 → VRM humanoid 骨骼名 */
const RIG_MAP = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',

  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigLeftHandThumb1: 'leftThumbMetacarpal',
  mixamorigLeftHandThumb2: 'leftThumbProximal',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigLeftHandRing1: 'leftRingProximal',
  mixamorigLeftHandRing2: 'leftRingIntermediate',
  mixamorigLeftHandRing3: 'leftRingDistal',
  mixamorigLeftHandPinky1: 'leftLittleProximal',
  mixamorigLeftHandPinky2: 'leftLittleIntermediate',
  mixamorigLeftHandPinky3: 'leftLittleDistal',

  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  mixamorigRightHandThumb1: 'rightThumbMetacarpal',
  mixamorigRightHandThumb2: 'rightThumbProximal',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigRightHandRing1: 'rightRingProximal',
  mixamorigRightHandRing2: 'rightRingIntermediate',
  mixamorigRightHandRing3: 'rightRingDistal',
  mixamorigRightHandPinky1: 'rightLittleProximal',
  mixamorigRightHandPinky2: 'rightLittleIntermediate',
  mixamorigRightHandPinky3: 'rightLittleDistal',

  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes'
};

const _loader = new FBXLoader();

/**
 * @param {string} url  .fbx 路径
 * @param {import('@pixiv/three-vrm').VRM} vrm
 * @returns {Promise<THREE.AnimationClip>} 可直接喂给 AnimationMixer 的 clip
 */
export async function loadMixamoAnimation(url, vrm) {
  const asset = await _loader.loadAsync(url);

  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com')
            || asset.animations[0];
  if (!clip) throw new Error('FBX 里没有动画轨道');

  const tracks = [];

  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quatA = new THREE.Quaternion();
  const _vec3 = new THREE.Vector3();

  // 用胯高比例把位移换算到这个模型的身材上（同时消化 cm → m）
  const motionHips = asset.getObjectByName('mixamorigHips');
  const vrmHipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  if (!motionHips || !vrmHipsNode) throw new Error('找不到 hips 骨骼，无法对齐');

  const motionHipsHeight = motionHips.position.y;
  const vrmHipsY = vrmHipsNode.getWorldPosition(_vec3).y;
  const vrmRootY = vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
  const hipsScale = vrmHipsHeight / motionHipsHeight;

  // VRM 0.x 朝向和 1.0 相反，位移要翻 x/z
  const flip = (vrm.meta?.metaVersion === '0') ? -1 : 1;

  for (const track of clip.tracks) {
    const [rigName, propertyName] = track.name.split('.');
    const vrmBoneName = RIG_MAP[rigName];
    if (!vrmBoneName) continue;

    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName);
    if (!vrmNode) continue;
    const vrmNodeName = vrmNode.name;

    const rigNode = asset.getObjectByName(rigName);
    if (!rigNode) continue;

    rigNode.getWorldQuaternion(restRotationInverse).invert();
    rigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      // 把 Mixamo 静止姿势下的旋转，换算到 VRM 归一化骨骼空间
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 4) {
        _quatA.fromArray(values, i)
              .premultiply(parentRestWorldRotation)
              .multiply(restRotationInverse);
        _quatA.toArray(values, i);
        if (flip === -1) { values[i] *= -1; values[i + 2] *= -1; }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${vrmNodeName}.${propertyName}`, track.times.slice(), values
      ));
    }
    // 位移轨道（只有 hips 有）刻意丢掉：
    // 角色是钉在桌子后面的固定机位，根位移没有意义；而且坐姿和站姿的
    // 动作根高度差很多，保留位移会导致换动作时人跳出画面。
    // hipsScale 仍然算出来了，将来要恢复位移时直接乘上去即可。
  }

  return new THREE.AnimationClip(clip.name || 'mixamo', clip.duration, tracks);
}

export const MIXAMO_RIG_MAP = RIG_MAP;
