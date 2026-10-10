import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AVATAR_REGISTRY, DEFAULT_AVATAR_ID, getAvatarById } from '../src/avatarRegistry.js';

test('avatarRegistry defines all 4 distinct avatars with required metadata', () => {
  assert.equal(AVATAR_REGISTRY.length, 4, 'Must define exactly 4 avatars');
  const ids = AVATAR_REGISTRY.map((a) => a.id);
  assert.deepEqual(ids, ['default', 'sky', 'nova', 'ember']);

  const names = AVATAR_REGISTRY.map((a) => a.name);
  assert.ok(names.includes('Aira'));
  assert.ok(names.includes('Luna'));
  assert.ok(names.includes('Mira'));
  assert.ok(names.includes('Zyra'));

  for (const avatar of AVATAR_REGISTRY) {
    assert.ok(avatar.id, 'Avatar has id');
    assert.ok(avatar.name, 'Avatar has name');
    assert.ok(avatar.modelUrl, 'Avatar has modelUrl');
    assert.ok(avatar.thumbnailUrl, 'Avatar has thumbnailUrl');
    assert.ok(avatar.defaultVoice, 'Avatar has defaultVoice');
    assert.ok(avatar.description, 'Avatar has description');
    assert.ok(avatar.license, 'Avatar has license');
  }
});

test('getAvatarById resolves valid avatar and falls back safely', () => {
  assert.equal(DEFAULT_AVATAR_ID, 'default');
  const sky = getAvatarById('sky');
  assert.equal(sky.name, 'Luna');
  assert.equal(sky.modelUrl, '/models/sky.vrm');

  const fallback = getAvatarById('unknown_invalid_id');
  assert.equal(fallback.id, 'default');
  assert.equal(fallback.name, 'Aira');
});

test('all 4 VRM models exist in public/models and have valid glTF/GLB binary container', () => {
  const publicModelsDir = path.resolve(process.cwd(), 'public/models');
  assert.ok(fs.existsSync(publicModelsDir), 'public/models directory exists');

  const modelHashes = new Set();

  for (const avatar of AVATAR_REGISTRY) {
    const filename = path.basename(avatar.modelUrl);
    const filePath = path.join(publicModelsDir, filename);
    assert.ok(fs.existsSync(filePath), `Model file exists: ${filename}`);

    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 1000000, `Model file ${filename} must be valid binary model > 1MB (size: ${stat.size})`);
    const binary = fs.readFileSync(filePath);
    modelHashes.add(createHash('sha256').update(binary).digest('hex'));
    assert.equal(binary.readUInt32LE(8), binary.length, 'Declared GLB length matches file');
    assert.equal(binary.readUInt32LE(16), 0x4e4f534a, 'First chunk is JSON');
    const json = JSON.parse(binary.toString('utf8', 20, 20 + binary.readUInt32LE(12)));
    const vrm = json.extensions?.VRM || json.extensions?.VRMC_vrm;
    assert.ok(vrm?.humanoid?.humanBones, 'VRM humanoid metadata exists');
    if (avatar.id !== 'default') {
      const expected = { sky: ['Vivi', 'eaf902e041a7a810f1423599ae75682f61184ab6ef0206da9a8ed9caa8ec3a9d'], nova: ['Victoria Rubin', 'b1372131bdbf233f46320146d565f342a7e4f6f4b8f2aefb301f1a283ec07e1e'], ember: ['Vita', 'f2bf78f28a24e2f75f5ca0b6c3b646654c394e4b03592dfaa0d0633ef0972b4d'] };
      assert.equal(vrm.meta.title, expected[avatar.id][0]);
      assert.equal(createHash('sha256').update(binary).digest('hex'), expected[avatar.id][1]);
      assert.equal(vrm.meta.licenseName, 'CC0');
      assert.equal(vrm.meta.commercialUssageName, 'Allow');
      const names = vrm.humanoid.humanBones.map(entry => entry.bone);
      for (const bone of ['head', 'spine', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']) assert.ok(names.includes(bone));
      const expressions = vrm.blendShapeMaster.blendShapeGroups.map(entry => entry.presetName);
      for (const name of ['a', 'blink', 'joy']) assert.ok(expressions.includes(name));
    }

    // Verify GLB magic header
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(12);
    fs.readSync(fd, headerBuf, 0, 12, 0);
    fs.closeSync(fd);

    const magic = headerBuf.toString('utf8', 0, 4);
    const version = headerBuf.readUInt32LE(4);
    assert.equal(magic, 'glTF', `File ${filename} must have glTF magic header`);
    assert.equal(version, 2, `File ${filename} must be glTF binary version 2`);
  }

  // Verify models are genuinely distinct
  assert.equal(modelHashes.size, 4, 'All four models have distinct binary content');
});

test('all 4 avatar thumbnails exist in public/avatars', () => {
  const publicAvatarsDir = path.resolve(process.cwd(), 'public/avatars');
  assert.ok(fs.existsSync(publicAvatarsDir), 'public/avatars directory exists');

  for (const avatar of AVATAR_REGISTRY) {
    const filename = path.basename(avatar.thumbnailUrl);
    const filePath = path.join(publicAvatarsDir, filename);
    assert.ok(fs.existsSync(filePath), `Thumbnail exists: ${filename}`);

    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 1000, `Thumbnail ${filename} must not be empty`);
  }
});

test('ATTRIBUTION.md documents female model sources, creator and CC0 license', () => {
  const attrPath = path.resolve(process.cwd(), 'public/models/ATTRIBUTION.md');
  assert.ok(fs.existsSync(attrPath), 'public/models/ATTRIBUTION.md exists');

  const content = fs.readFileSync(attrPath, 'utf8');
  assert.ok(content.includes('CC0 1.0'), 'Mentions CC0 1.0 license');
  assert.ok(content.includes('Luna'), 'Mentions Luna model');
  assert.ok(content.includes('Mira'), 'Mentions Mira model');
  assert.ok(content.includes('Zyra'), 'Mentions Zyra model');
  assert.ok(content.includes('pixiv VRoid Project') && content.includes('vroid.pixiv.help'), 'Mentions creator and official licensing source');
});

test('App.jsx and InteractionToolbar.jsx integrate AvatarSelector and localStorage persistence', () => {
  const appCode = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
  assert.ok(appCode.includes('AvatarSelector'), 'App imports/renders AvatarSelector');
  assert.ok(appCode.includes('echo_selected_avatar'), 'App uses echo_selected_avatar localStorage key');
  assert.ok(appCode.includes('handleSelectAvatar'), 'App defines handleSelectAvatar');
  assert.ok(appCode.includes('Characters'), 'App has Change Avatar button');

  const toolbarCode = fs.readFileSync(path.resolve(process.cwd(), 'src/InteractionToolbar.jsx'), 'utf8');
  assert.ok(toolbarCode.includes('onToggleHandInteraction'), 'Toolbar retains hand interaction');
});
