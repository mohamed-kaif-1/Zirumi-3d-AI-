import { Box3, Vector3 } from 'three';
import { VRMUtils } from '@pixiv/three-vrm';

export function prepareAvatar(vrm) {
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(vrm.scene);
  const height = bounds.getSize(new Vector3()).y;
  if (!Number.isFinite(height) || height < 0.01) throw new Error('VRM has invalid dimensions');
  const scale = 1.65 / height;
  vrm.scene.scale.multiplyScalar(scale);
  vrm.scene.position.y -= bounds.min.y * scale;
  vrm.scene.updateMatrixWorld(true);
  return vrm;
}

// three-vrm disposes GPU resources but does not close ImageBitmap storage.
export function disposeAvatarScene(scene) {
  if (!scene) return;
  const bitmaps = new Set();
  const collect = (value) => {
    if (!value?.isTexture) return;
    const images = Array.isArray(value.image) ? value.image : [value.image];
    for (const image of images) if (typeof image?.close === 'function') bitmaps.add(image);
  };
  scene.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      Object.values(material).forEach(collect);
      Object.values(material.uniforms || {}).forEach(uniform => collect(uniform.value));
    }
  });
  VRMUtils.deepDispose(scene);
  for (const image of bitmaps) image.close();
}
