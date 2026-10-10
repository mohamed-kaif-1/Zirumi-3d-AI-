import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const assets = [
  { id: 'sky', model: 'Vivi', file: '02-vivi.vrm', sha256: 'eaf902e041a7a810f1423599ae75682f61184ab6ef0206da9a8ed9caa8ec3a9d', licenseSource: 'https://vroid.pixiv.help/hc/en-us/articles/360014900273' },
  { id: 'nova', model: 'Victoria Rubin', file: '04-victoria-rubin.vrm', sha256: 'b1372131bdbf233f46320146d565f342a7e4f6f4b8f2aefb301f1a283ec07e1e', licenseSource: 'https://vroid.pixiv.help/hc/en-us/articles/360014900233' },
  { id: 'ember', model: 'Vita', file: '03-vita.vrm', sha256: 'f2bf78f28a24e2f75f5ca0b6c3b646654c394e4b03592dfaa0d0633ef0972b4d', licenseSource: 'https://vroid.pixiv.help/hc/en-us/articles/360014900113' },
];
await mkdir('public/models', { recursive: true });
await mkdir('verification/female-avatars', { recursive: true });
const results = [];
for (const asset of assets) {
  const url = `https://file-in-abyss.soga-web.studio/download/vrm/${asset.file}`;
  const target = `public/models/${asset.id}.vrm`;
  await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--connect-timeout', '20', '--max-time', '180', url, '--output', `${target}.female.download`]);
  const bytes = await readFile(`${target}.female.download`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== asset.sha256 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`${asset.id}: download integrity failed`);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const vrm = gltf.extensions?.VRM;
  if (vrm?.meta?.licenseName !== 'CC0') throw new Error(`${asset.id}: redistribution license not verified`);
  const bones = vrm.humanoid.humanBones.map(item => item.bone);
  for (const bone of ['head', 'neck', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']) if (!bones.includes(bone)) throw new Error(`${asset.id}: missing ${bone}`);
  const expressions = vrm.blendShapeMaster.blendShapeGroups.map(item => item.presetName);
  if (!expressions.includes('blink') || !expressions.includes('a')) throw new Error(`${asset.id}: missing mouth/blink expressions`);
  // Creator CC0 pages were reviewed separately. They reject some curl clients;
  // embedded CC0 and a pinned SHA ensure this is the reviewed beta-era model.
  results.push({ ...asset, url, bytes: bytes.length, metadata: vrm.meta, bones, expressions });
  console.log(`VERIFIED ${asset.id}: ${asset.model}, CC0, ${bones.length} bones`);
}
// Commit only after all three models pass integrity, licensing and rig checks.
const backup = path.join(process.env.TEMP || '.', 'echo-previous-male-avatars');
await mkdir(backup, { recursive: true });
for (const asset of assets) {
  const target = `public/models/${asset.id}.vrm`;
  await copyFile(target, path.join(backup, `${asset.id}.vrm`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rename(`${target}.female.download`, target);
}
await writeFile('verification/female-avatars/download-results.json', JSON.stringify(results, null, 2));
console.log('Installed three distinct female VRMs; original ECHO preserved.');
