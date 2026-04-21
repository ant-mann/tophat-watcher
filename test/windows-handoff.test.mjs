import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowsCompanionLaunchScript, shouldHandOffToWindows } from '../src/windows-handoff.mjs';

test('shouldHandOffToWindows returns true for WSL repo on /mnt path', () => {
  assert.equal(shouldHandOffToWindows({
    rootDir: '/mnt/c/Users/chimn/OneDrive/Desktop/tophat',
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
  }), true);
});

test('shouldHandOffToWindows returns false when already relaunched on Windows side', () => {
  assert.equal(shouldHandOffToWindows({
    rootDir: '/mnt/c/Users/chimn/OneDrive/Desktop/tophat',
    env: { WSL_DISTRO_NAME: 'Ubuntu', TOPHAT_WINDOWS_HANDOFF: '1' },
  }), false);
});

test('buildWindowsCompanionLaunchScript writes a Windows node handoff batch', () => {
  const script = buildWindowsCompanionLaunchScript({
    rootDir: '/mnt/c/Users/chimn/OneDrive/Desktop/tophat',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  });

  assert.match(script, /^@echo off/m);
  assert.match(script, /cd \/d C:\\Users\\chimn\\OneDrive\\Desktop\\tophat/);
  assert.match(script, /set TOPHAT_WINDOWS_HANDOFF=1/);
  assert.match(script, /"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\chimn\\OneDrive\\Desktop\\tophat\\scripts\\tophat-companion.mjs"/);
});
