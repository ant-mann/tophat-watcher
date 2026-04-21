import path from 'node:path';

export function resolveCompanionPaths({ rootDir, env = process.env, forceWsl = null }) {
  const inWsl = forceWsl ?? isWslEnvironment(env);
  if (!inWsl) {
    return {
      settingsPath: path.join(rootDir, '.data', 'app-settings.json'),
      legacyConfigPath: path.join(rootDir, 'config', 'tophat.json'),
      statePath: path.join(rootDir, '.data', 'tophat-state.json'),
      profileDir: path.join(rootDir, '.profiles', 'tophat'),
    };
  }

  const stateHome = env.XDG_STATE_HOME || path.join(env.HOME || rootDir, '.local', 'state');
  const appStateDir = path.join(stateHome, 'tophat-companion');
  const profileDir = inferWindowsProfileDir(rootDir)
    || path.join(env.XDG_CONFIG_HOME || path.join(env.HOME || rootDir, '.config'), 'tophat-companion', 'profile');

  return {
    settingsPath: path.join(appStateDir, 'app-settings.json'),
    legacyConfigPath: path.join(rootDir, 'config', 'tophat.json'),
    statePath: path.join(appStateDir, 'tophat-state.json'),
    profileDir,
  };
}

export function inferWindowsProfileDir(rootDir) {
  const match = rootDir.match(/^\/mnt\/([a-zA-Z])\/Users\/([^/]+)/);
  if (!match) {
    return null;
  }

  const drive = match[1].toLowerCase();
  const user = match[2];
  return `/mnt/${drive}/Users/${user}/AppData/Local/tophat-companion/profile`;
}

export function isWslEnvironment(env = process.env) {
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}
