import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3, Quaternion } from 'three';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(f => /\.vrm$/i.test(f));
const reports = files.map(file => {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('Invalid GLB: ' + file);
  const jsonSize = data.readUInt32LE(12), gltf = JSON.parse(data.subarray(20, 20 + jsonSize).toString());
  const binary = data.subarray(20 + jsonSize + 8);
  const nodes = gltf.nodes || [], parents = new Map();
  nodes.forEach((n, i) => n.children?.forEach(c => parents.set(c, i)));
  const matrices = new Map();
  function matrix(i) {
    if (matrices.has(i)) return matrices.get(i);
    const n = nodes[i], m = n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3().fromArray(n.translation || [0, 0, 0]), new Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), new Vector3().fromArray(n.scale || [1, 1, 1]));
    if (parents.has(i)) m.premultiply(matrix(parents.get(i))); matrices.set(i, m); return m;
  }
  const v1 = gltf.extensions?.VRMC_vrm, v0 = gltf.extensions?.VRM;
  const humanoid = v1 ? v1.humanoid.humanBones : Object.fromEntries((v0?.humanoid?.humanBones || []).map(b => [b.bone, b]));
  const bones = Object.fromEntries(Object.entries(humanoid).map(([name, b]) => [name, { node: b.node, name: nodes[b.node].name, parent: parents.get(b.node), world: new Vector3().setFromMatrixPosition(matrix(b.node)).toArray(), translation: nodes[b.node].translation || [0, 0, 0] }]));
  const length = (a, b) => bones[a] && bones[b] ? new Vector3(...bones[a].world).distanceTo(new Vector3(...bones[b].world)) : null;
  const primitives = (gltf.meshes || []).flatMap(m => m.primitives);
  let badWeights = 0, weightVertices = 0;
  for (const p of primitives) {
    const a = gltf.accessors[p.attributes.WEIGHTS_0]; if (!a || a.sparse) continue;
    const view = gltf.bufferViews[a.bufferView], bytes = a.componentType === 5126 ? 4 : a.componentType === 5123 ? 2 : 1;
    for (let i = 0; i < a.count; i++) {
      let sum = 0; const offset = (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || bytes * 4);
      for (let j = 0; j < 4; j++) sum += bytes === 4 ? binary.readFloatLE(offset + j * bytes) : bytes === 2 ? binary.readUInt16LE(offset + j * bytes) / 65535 : binary.readUInt8(offset + j) / 255;
      if (!Number.isFinite(sum) || Math.abs(sum - 1) > .02) badWeights++; weightVertices++;
    }
  }
  const imageInfo = (gltf.images || []).map(image => {
    const view = gltf.bufferViews[image.bufferView], bytes = binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    let width = null, height = null;
    if (image.mimeType === 'image/png' && bytes.length >= 24) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
    if (image.mimeType === 'image/jpeg') for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 255) break; const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break; }
      if (length < 2) break; offset += length + 2;
    }
    return { mimeType: image.mimeType, bytes: view.byteLength, width, height };
  });
  const uniquePositions = [...new Set(primitives.map(p => p.attributes.POSITION))];
  return { file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), version: v1?.specVersion || v0?.specVersion || (v0 ? '0.x' : 'unknown'), name: v1?.meta?.name || v0?.meta?.title, license: v1?.meta?.licenseUrl || v0?.meta?.licenseName, bones, skeletonNodes: [...new Set((gltf.skins || []).flatMap(s => s.joints))].map(i => ({ node: i, name: nodes[i].name, parent: parents.get(i), translation: nodes[i].translation, rotation: nodes[i].rotation, scale: nodes[i].scale })), morphTargetNames: [...new Set((gltf.meshes || []).flatMap(m => m.extras?.targetNames || []))], boneCount: Object.keys(bones).length, armLengths: { leftUpper: length('leftUpperArm', 'leftLowerArm'), leftLower: length('leftLowerArm', 'leftHand'), rightUpper: length('rightUpperArm', 'rightLowerArm'), rightLower: length('rightLowerArm', 'rightHand') }, legLengths: { thigh: length('leftUpperLeg', 'leftLowerLeg'), shin: length('leftLowerLeg', 'leftFoot') }, shoulderWidth: length('leftUpperArm', 'rightUpperArm'), neckToHead: length('neck', 'head'), vertices: uniquePositions.reduce((n, i) => n + gltf.accessors[i].count, 0), triangles: primitives.reduce((n, p) => n + (p.indices !== undefined ? gltf.accessors[p.indices].count : gltf.accessors[p.attributes.POSITION].count) / 3, 0), skins: gltf.skins?.map(s => ({ joints: s.joints.length, inverseBindMatrices: s.inverseBindMatrices !== undefined })), weightVertices, badWeights, expressions: v1 ? Object.keys(v1.expressions?.preset || {}) : v0?.blendShapeMaster?.blendShapeGroups?.map(g => g.presetName), materials: gltf.materials?.map((m, i) => ({ name: m.name, toon: Boolean(m.extensions?.VRMC_materials_mtoon) || v0?.materialProperties?.[i]?.shader === 'VRM/MToon', alphaMode: m.alphaMode || 'OPAQUE', doubleSided: m.doubleSided || false })), textures: imageInfo, restPose: 'Original GLB node transforms; full hierarchy and joint world positions recorded in bones. No re-proportioning applied.' };
});
fs.mkdirSync('verification/avatar-motion', { recursive: true });
fs.writeFileSync('verification/avatar-motion/model-audit.json', JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports.map(({ file, version, vertices, triangles, boneCount, badWeights, armLengths, name }) => ({ file, version, name, vertices, triangles, boneCount, badWeights, armLengths })), null, 2));
