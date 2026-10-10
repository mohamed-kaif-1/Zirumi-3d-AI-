import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Day 3 E2E and UI contract verification', async (t) => {
  await t.test('App.jsx contains upper-body and full-body camera views and fullscreen support', () => {
    const appContent = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');
    assert.ok(appContent.includes("cameraView"), 'Includes cameraView state');
    assert.ok(appContent.includes("isFullscreen"), 'Includes isFullscreen state');
    assert.ok(appContent.includes("WaveformVisualizer"), 'Includes WaveformVisualizer');
    assert.ok(appContent.includes("fullscreen-avatar"), 'Includes fullscreen mode classes');
    assert.ok(appContent.includes("VoiceSelector"), 'Includes VoiceSelector component');
  });

  await t.test('WaveformVisualizer.jsx exists and defines waveform canvas render logic', () => {
    const waveContent = readFileSync(join(process.cwd(), 'src', 'WaveformVisualizer.jsx'), 'utf8');
    assert.ok(waveContent.includes("WaveformVisualizer"), 'Exports WaveformVisualizer function');
    assert.ok(waveContent.includes("canvasRef"), 'Includes canvas for audio waveform');
  });

  await t.test('InteractionToolbar.jsx provides camera framing and fullscreen toggles', () => {
    const toolbarContent = readFileSync(join(process.cwd(), 'src', 'InteractionToolbar.jsx'), 'utf8');
    assert.ok(toolbarContent.includes("onToggleCameraView"), 'Includes camera toggle callback');
    assert.ok(toolbarContent.includes("onToggleFullscreen"), 'Includes fullscreen toggle callback');
    assert.ok(toolbarContent.includes("Reset"), 'Has Reset button');
  });

  await t.test('VoiceSelector.jsx and voicePresets.js define 6 natural feminine presets', () => {
    const presetContent = readFileSync(join(process.cwd(), 'src', 'voicePresets.js'), 'utf8');
    assert.ok(presetContent.includes("sweet"), 'Includes sweet preset');
    assert.ok(presetContent.includes("playful"), 'Includes playful preset');
    assert.ok(presetContent.includes("calm"), 'Includes calm preset');
    assert.ok(presetContent.includes("excited"), 'Includes excited preset');
    assert.ok(presetContent.includes("gentle"), 'Includes gentle preset');
    assert.ok(presetContent.includes("best_friend"), 'Includes best_friend preset');

    const voiceSelContent = readFileSync(join(process.cwd(), 'src', 'VoiceSelector.jsx'), 'utf8');
    assert.ok(voiceSelContent.includes("VoiceSelector"), 'Exports VoiceSelector');
  });

  await t.test('Avatar.jsx configures upper-body and full-body OrbitControls framing presets and voicePreset', () => {
    const avatarContent = readFileSync(join(process.cwd(), 'src', 'Avatar.jsx'), 'utf8');
    assert.ok(avatarContent.includes("cameraView"), 'Accepts cameraView prop');
    assert.ok(avatarContent.includes("voicePreset"), 'Accepts voicePreset prop');
    assert.ok(avatarContent.includes("controls.target.set"), 'Smoothly repositions target for camera framing');
  });
});
