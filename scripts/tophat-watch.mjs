import process from 'node:process';
import { createCompanionController } from '../src/companion-controller.mjs';
const controller = createCompanionController();

async function main() {
  const command = process.argv[2] ?? 'watch';
  await controller.init();

  if (command === 'login') {
    await controller.startLogin();
    console.log('Top Hat login window opened. Sign in there, then return when you are done.');
    await waitForShutdown();
    return;
  }

  if (command === 'watch') {
    await controller.startWatcher();
    console.log('Top Hat watcher is running. Press Ctrl+C to stop.');
    await waitForShutdown(async () => {
      await controller.stopWatcher();
    });
    return;
  }

  if (command === 'ack') {
    const result = await controller.acknowledgeAlert();
    console.log(result.acknowledged ? 'Acknowledged the current alert.' : 'No active Top Hat alarm to acknowledge.');
    await controller.shutdown();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function waitForShutdown(onClose = async () => {}) {
  let handled = false;
  const close = async () => {
    if (handled) {
      return;
    }
    handled = true;
    await onClose();
    await controller.shutdown();
    process.exit(0);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  await controller.shutdown().catch(() => undefined);
  process.exitCode = 1;
});
