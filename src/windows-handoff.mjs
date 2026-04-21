import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { isWslEnvironment } from './runtime-paths.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_WINDOWS_NODE = 'C:\\Program Files\\nodejs\\node.exe';

export function shouldHandOffToWindows({ rootDir, env = process.env }) {
  if (!isWslEnvironment(env)) {
    return false;
  }

  if (env.TOPHAT_WINDOWS_HANDOFF === '1' || env.TOPHAT_SKIP_WINDOWS_HANDOFF === '1') {
    return false;
  }

  return Boolean(toWindowsPath(rootDir));
}

export function buildWindowsCompanionLaunchScript({ rootDir, nodePath = DEFAULT_WINDOWS_NODE }) {
  const windowsRoot = toWindowsPath(rootDir);
  if (!windowsRoot) {
    throw new Error('Top Hat Companion could not translate the repo path into a Windows path.');
  }

  const windowsEntry = `${windowsRoot}\\scripts\\tophat-companion.mjs`;
  return [
    '@echo off',
    `cd /d ${windowsRoot}`,
    'set TOPHAT_WINDOWS_HANDOFF=1',
    `"${nodePath}" "${windowsEntry}"`,
    '',
  ].join('\r\n');
}

export async function launchCompanionInWindows({ rootDir, nodePath = DEFAULT_WINDOWS_NODE, env = process.env }) {
  const launchScript = buildWindowsCompanionLaunchScript({ rootDir, nodePath });
  const handoffDir = path.join(rootDir, '.data');
  const handoffPath = path.join(handoffDir, 'launch-companion.cmd');
  await mkdir(handoffDir, { recursive: true });
  await writeFile(handoffPath, launchScript, 'utf8');

  const windowsBatchPath = await toWindowsPathViaWsl(handoffPath);
  const child = spawn('cmd.exe', ['/c', 'start', '', '/min', windowsBatchPath], {
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return { handoffPath, windowsBatchPath };
}

export function toWindowsPath(linuxPath) {
  const match = linuxPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) {
    return null;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

async function toWindowsPathViaWsl(linuxPath) {
  const { stdout } = await execFileAsync('wslpath', ['-w', linuxPath]);
  return stdout.trim();
}
