import { access, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isWslEnvironment } from './runtime-paths.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_DEBUG_PORT = 9339;
const DEFAULT_BROWSER_CANDIDATES = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  '/mnt/c/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
];

export function createWindowsBrowserBridge({ env = process.env } = {}) {
  return {
    isSupported() {
      return isWslEnvironment(env);
    },
    async openSession({ browserType, profileDir, url, port = DEFAULT_DEBUG_PORT }) {
      const executablePath = await findFirstExisting(DEFAULT_BROWSER_CANDIDATES);
      if (!executablePath) {
        throw new Error('Top Hat Companion could not find Chrome, Edge, or Brave on Windows. Run the app from Windows or install a Chromium-based browser.');
      }

      await mkdir(profileDir, { recursive: true });
      const endpoints = await buildCdpEndpoints(port);
      let browser = await connectExisting(browserType, endpoints);
      if (!browser) {
        await launchWindowsChromium({ executablePath, profileDir, port, url });
        browser = await waitForBrowser(browserType, endpoints);
      }

      const context = browser.contexts()[0];
      if (!context) {
        throw new Error('Top Hat Companion connected to Windows Chrome, but no browser context was available.');
      }

      const page = context.pages()[0] ?? (await context.newPage());
      return { browser, context, page, endpoint: endpoints[0], executablePath };
    },
  };
}

export async function findFirstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

async function launchWindowsChromium({ executablePath, profileDir, port, url }) {
  const windowsExecutablePath = await toWindowsPath(executablePath);
  const windowsProfileDir = await toWindowsPath(profileDir);
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=0.0.0.0',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${windowsProfileDir}`,
    '--new-window',
    url,
  ];

  const encodedCommand = buildStartProcessCommand(windowsExecutablePath, args);
  await execFileAsync('powershell.exe', ['-NoProfile', '-EncodedCommand', encodedCommand]);
}

function buildStartProcessCommand(executablePath, args) {
  const quotedPath = psQuote(executablePath);
  const quotedArgs = args.map((arg) => psQuote(arg)).join(', ');
  const script = `Start-Process -FilePath ${quotedPath} -ArgumentList @(${quotedArgs})`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function waitForBrowser(browserType, endpoints) {
  const deadline = Date.now() + 20000;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const endpoint of endpoints) {
      try {
        return await browserType.connectOverCDP(endpoint, { timeout: 2000 });
      } catch (error) {
        lastError = error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Top Hat Companion could not connect to the Windows browser over CDP. ${lastError?.message ?? ''}`.trim());
}

async function connectExisting(browserType, endpoints) {
  for (const endpoint of endpoints) {
    try {
      return await browserType.connectOverCDP(endpoint, { timeout: 1000 });
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

async function buildCdpEndpoints(port) {
  const hosts = ['127.0.0.1', ...(await getWslHostCandidates())];
  return [...new Set(hosts.filter(Boolean).map((host) => `http://${host}:${port}`))];
}

async function getWslHostCandidates() {
  const candidates = [];

  try {
    const { stdout } = await execFileAsync('sh', ['-lc', "ip route | awk '/^default/ { print $3; exit }'"]);
    if (stdout.trim()) {
      candidates.push(stdout.trim());
    }
  } catch {
    // ignore route lookup errors
  }

  try {
    const resolvConf = await readFile('/etc/resolv.conf', 'utf8');
    const match = resolvConf.match(/^nameserver\s+(\S+)/m);
    if (match?.[1]) {
      candidates.push(match[1]);
    }
  } catch {
    // ignore resolver lookup errors
  }

  return candidates;
}

async function toWindowsPath(linuxPath) {
  const { stdout } = await execFileAsync('wslpath', ['-w', linuxPath]);
  return stdout.trim();
}
