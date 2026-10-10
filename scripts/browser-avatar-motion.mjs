import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.env.TEMP, 'echo-browser-verification/runner.cjs'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe'), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = 'verification/avatar-motion'; await mkdir(output, { recursive: true });
const result = { errors: [], avatars: [], renderer: 'Chromium SwiftShader (software); not a hardware FPS certification', passed: false };
page.on('pageerror', e => result.errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:5173'); await page.getByText(/Avatar ready/).waitFor({ timeout: 90000 });
  for (const [id, name] of [['default', 'Aira'], ['sky', 'Luna'], ['nova', 'Mira'], ['ember', 'Zyra']]) {
    const report = await page.evaluate(async url => (await import('/scripts/avatar-motion-probe.js')).auditMotion(url), id === 'default' ? '/AvatarSample_W.vrm' : `/models/${id}.vrm`);
    result.avatars.push({ id, name, ...report });
    assert.equal(report.unchangedTranslations, true); assert.ok(report.worstReach < .0001); assert.ok(report.worstPenetration <= .002, name + ' proxy penetration ' + report.worstPenetration);
    assert.ok(report.maxHeadShake > .01 && report.minHeadShake < -.01); assert.equal(report.returnedToIdle, true);
    console.log('PASS ' + name + ': real loaded VRM, ten IK poses, fixed lengths and boundary animation.');
  }
  assert.deepEqual(result.errors, []); result.passed = true;
} catch (e) { result.failure = e.message; process.exitCode = 1; console.error(e.message); }
finally { await writeFile(`${output}/model-motion.json`, JSON.stringify(result, null, 2)); await browser.close(); }
