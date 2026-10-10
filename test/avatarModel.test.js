import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Mesh, BoxGeometry, MeshBasicMaterial, Texture, Box3, Vector3 } from 'three';
import { prepareAvatar, disposeAvatarScene } from '../src/avatarModel.js';

test('model framing applies uniform root scale and grounds the character', () => {
  const scene = new Scene();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshBasicMaterial()));
  const vrm = { scene, meta: { metaVersion: '1' } };
  prepareAvatar(vrm);
  const box = new Box3().setFromObject(scene);
  assert.ok(Math.abs(box.getSize(new Vector3()).y - 1.65) < 1e-6);
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.equal(scene.scale.x, scene.scale.y);
  assert.equal(scene.scale.y, scene.scale.z);
  disposeAvatarScene(scene);
});

test('discarding a model disposes its meshes and closes shared bitmap storage once', () => {
  const scene = new Scene();
  let closed = 0, geometries = 0, materials = 0;
  const texture = new Texture({ close() { closed++; } });
  for (let i = 0; i < 2; i++) {
    const geometry = new BoxGeometry();
    geometry.addEventListener('dispose', () => geometries++);
    const material = new MeshBasicMaterial({ map: texture });
    material.addEventListener('dispose', () => materials++);
    scene.add(new Mesh(geometry, material));
  }
  disposeAvatarScene(scene);
  assert.equal(geometries, 2);
  assert.equal(materials, 2);
  assert.equal(closed, 1);
});
