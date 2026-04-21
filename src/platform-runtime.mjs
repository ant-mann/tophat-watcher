import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_MAC_ALARM_SOUND = '/System/Library/Sounds/Glass.aiff';

export function createPlatformRuntime({
  platform = process.platform,
  execFileImpl = execFileAsync,
  stdout = process.stdout,
} = {}) {
  return {
    async openExternalUrl(url) {
      if (platform === 'darwin') {
        await execFileImpl('open', [url]);
        return;
      }

      if (platform === 'win32') {
        await execFileImpl('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]);
        return;
      }

      await execFileImpl('xdg-open', [url]);
    },

    async showNotification(title, message) {
      if (platform === 'win32') {
        const escapedTitle = xmlEscape(title);
        const escapedMessage = xmlEscape(message);
        const script = [
          "$ErrorActionPreference = 'Stop'",
          '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
          '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
          '$xmlPayload = @"',
          `<toast><visual><binding template='ToastGeneric'><text>${escapedTitle}</text><text>${escapedMessage}</text></binding></visual></toast>`,
          '"@',
          '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
          '$xml.LoadXml($xmlPayload)',
          '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
          "$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TopHatCompanion')",
          '$notifier.Show($toast)',
        ].join('\n');

        try {
          await execFileImpl('powershell.exe', ['-NoProfile', '-Command', script]);
        } catch {
          // Silent fallback keeps alerting non-fatal.
        }
        return;
      }

      if (platform === 'darwin') {
        try {
          await execFileImpl('osascript', [
            '-e',
            `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`,
          ]);
        } catch {
          // Silent fallback keeps alerting non-fatal.
        }
        return;
      }

      try {
        await execFileImpl('notify-send', [title, message]);
      } catch {
        // Linux support is best-effort only.
      }
    },

    async playAlarmSound() {
      if (platform === 'win32') {
        try {
          await execFileImpl('powershell.exe', ['-NoProfile', '-Command', '[console]::beep(1600, 750)']);
          return;
        } catch {
          stdout.write('\u0007');
          return;
        }
      }

      if (platform === 'darwin') {
        try {
          await execFileImpl('afplay', [DEFAULT_MAC_ALARM_SOUND]);
          return;
        } catch {
          stdout.write('\u0007');
          return;
        }
      }

      for (const [command, args] of [
        ['canberra-gtk-play', ['-i', 'alarm-clock-elapsed']],
        ['paplay', ['/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga']],
        ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
      ]) {
        try {
          await execFileImpl(command, args);
          return;
        } catch {
          // Keep trying Linux fallbacks.
        }
      }

      stdout.write('\u0007');
    },
  };
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function appleScriptString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
