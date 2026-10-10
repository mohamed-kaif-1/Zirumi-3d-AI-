import { Vector3, Scene, Color, PerspectiveCamera, WebGLRenderer, AmbientLight, HemisphereLight, DirectionalLight } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { AvatarAnimationController } from '../src/AvatarAnimationController.js';
import { prepareAvatar, disposeAvatarScene } from '../src/avatarModel.js';
import { getAvatarVoiceProfile } from '../src/avatarVoiceProfiles.js';

export function projectPoint(position, aspect) {
  const camera = new PerspectiveCamera(36, aspect, 0.1, 100);
  camera.position.set(0, 1.42, 2.3);
  camera.lookAt(0, 1.25, 0);
  camera.updateMatrixWorld(true);
  return new Vector3(...position).project(camera).toArray();
}

export async function probe(url, thumbnail = false) {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = prepareAvatar(gltf.userData.vrm);
  const controller = new AvatarAnimationController();
  controller.setVRM(vrm);
  controller.avatarPersonality = getAvatarVoiceProfile(url.match(/(sky|nova|ember)\.vrm/)?.[1]);
  controller.activeVoicePreset = controller.avatarPersonality.preset;
  const describe = () => Object.fromEntries(Object.entries(controller.bones).filter(([, bone]) => bone).map(([name, bone]) => [name, { local: bone.position.toArray(), world: bone.getWorldPosition(new Vector3()).toArray(), scale: bone.getWorldScale(new Vector3()).toArray() }]));
  const before = describe();
  let maxBlink = 0;
  for (let i = 0; i < 360; i++) {
    controller.update(1 / 60, i / 60);
    maxBlink = Math.max(maxBlink, vrm.expressionManager.getValue('blink'));
  }
  vrm.scene.updateMatrixWorld(true);
  const after = describe();
  controller.setConversationState('SPEAKING');
  for (let i = 0; i < 120; i++) controller.update(1 / 60, 6 + i / 60);
  const mouthSpeaking = vrm.expressionManager.getValue('aa');
  controller.holdPose = true;
  const dragTarget = controller.currentTargets.right.clone().add(new Vector3(0.05, 0.10, 0.1));
  controller.startDrag('right', dragTarget);
  for (let i = 0; i < 30; i++) controller.update(1 / 60, 8 + i / 60);
  controller.endDrag('right');
  for (let i = 0; i < 30; i++) controller.update(1 / 60, 9 + i / 60);
  const heldError = controller.desiredTargets.right.distanceTo(dragTarget);
  controller.setConversationState('IDLE');
  controller.resetPose();
  for (let i = 0; i < 120; i++) controller.update(1 / 60, 10 + i / 60);
  const mouthStopped = vrm.expressionManager.getValue('aa');
  const result = { rig: controller.rigInfo, before, after, maxBlink, mouthSpeaking, mouthStopped, heldError, rotation: vrm.scene.rotation.toArray(), scale: vrm.scene.scale.toArray() };
  if (thumbnail) {
    for (const name of ['blink', 'blinkLeft', 'blinkRight']) {
      if (vrm.expressionManager.getExpression(name)) vrm.expressionManager.setValue(name, 0);
    }
    vrm.update(0);
    const scene = new Scene();
    scene.background = new Color('#13101d');
    scene.add(vrm.scene, new AmbientLight('#ffffff', 0.8), new HemisphereLight('#f1eaff', '#333048', 0.9));
    const light = new DirectionalLight('#ffffff', 1.4);
    light.position.set(2.5, 5, 3);
    scene.add(light);
    const camera = new PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 1.4, 1.7);
    camera.lookAt(0, 1.25, 0);
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(384, 384);
    renderer.render(scene, camera);
    result.thumbnail = renderer.domElement.toDataURL('image/png').split(',')[1];
    renderer.dispose();
    renderer.forceContextLoss();
  }
  disposeAvatarScene(vrm.scene);
  return result;
}
