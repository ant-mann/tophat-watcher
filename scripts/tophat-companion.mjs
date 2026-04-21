import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createCompanionController, openExternal } from '../src/companion-controller.mjs';
import { createDashboardServer } from '../src/dashboard-server.mjs';
import { launchCompanionInWindows, shouldHandOffToWindows } from '../src/windows-handoff.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

if (shouldHandOffToWindows({ rootDir })) {
  const { windowsBatchPath } = await launchCompanionInWindows({ rootDir });
  console.log(`Top Hat Companion launched in Windows using ${windowsBatchPath}.`);
  process.exit(0);
}

const controller = createCompanionController();
const server = createDashboardServer({ controller, port: 0 });

async function main() {
  await controller.init();
  const origin = await server.start();
  await openExternal(origin).catch(() => undefined);
  console.log(`Top Hat Companion is running at ${origin}`);

  const close = async () => {
    await controller.shutdown();
    await server.stop().catch(() => undefined);
    process.exit(0);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  await controller.shutdown().catch(() => undefined);
  await server.stop().catch(() => undefined);
  process.exitCode = 1;
});
