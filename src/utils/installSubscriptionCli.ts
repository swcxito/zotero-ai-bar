import { getString } from './locale';

const packages = {
  codex: '@openai/codex',
  'claude-code': '@anthropic-ai/claude-code@latest',
} as const;

function environmentValue(environment: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

export async function installSubscriptionCli(provider: keyof typeof packages, workdir: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs') as any;
  const inherited: Record<string, string> = Subprocess.getEnvironment();
  const path = environmentValue(inherited, 'PATH') || '';
  const pathEntries = path
    .split(Zotero.isWin ? ';' : ':')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const names = Zotero.isWin ? ['npm.cmd', 'npm.exe'] : ['npm'];
  if (Zotero.isMac) pathEntries.push('/opt/homebrew/bin', '/usr/local/bin');
  const candidates = pathEntries.flatMap((entry) => names.map((name) => PathUtils.join(entry, name)));
  let npm: string | undefined;
  for (const candidate of candidates) {
    if (await IOUtils.exists(candidate).catch(() => false)) {
      npm = candidate;
      break;
    }
  }
  npm ??= await Subprocess.pathSearch('npm').catch(() => undefined);
  if (!npm) throw new Error(getString('subscription-npm-not-found'));

  const allowed = ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];
  const environment = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => allowed.some((name) => name.toLowerCase() === key.toLowerCase()))
  );
  const home =
    environmentValue(inherited, Zotero.isWin ? 'USERPROFILE' : 'HOME') || environmentValue(inherited, Zotero.isWin ? 'HOME' : 'USERPROFILE');
  if (home) environment.HOME = home;
  environment.PATH = [PathUtils.parent(npm), ...pathEntries].filter(Boolean).join(Zotero.isWin ? ';' : ':');
  const args = ['install', '--global', '--no-audit', '--no-fund', packages[provider]];
  const systemRoot = environmentValue(inherited, 'SystemRoot') || environmentValue(inherited, 'WINDIR') || 'C:\\Windows';
  const escapedNpm = npm.replaceAll("'", "''");
  const command = Zotero.isWin ? PathUtils.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : npm;
  const launchArgs = Zotero.isWin
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& '${escapedNpm}' ${args.join(' ')}; exit $LASTEXITCODE`]
    : args;

  await IOUtils.makeDirectory(workdir, { permissions: 0o700, ignoreExisting: true });
  signal?.throwIfAborted();
  const failure = () => new Error(getString('subscription-install-failed'));
  const child = await Subprocess.call({ command, arguments: launchArgs, environment, stderr: 'pipe', workdir }).catch(() => {
    throw failure();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const drain = async (pipe: { readString: () => Promise<string> }) => {
    while (await pipe.readString()) {
      // Installer output can include paths and registry configuration.
    }
  };
  try {
    signal?.throwIfAborted();
    const install = Promise.all([drain(child.stdout), drain(child.stderr), child.wait()]);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(failure()), 180000);
    });
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(signal!.reason);
      signal?.addEventListener('abort', cancel, { once: true });
    });
    const [, , result] = await Promise.race([install, timeout, cancelled]);
    signal?.throwIfAborted();
    if (result.exitCode !== 0) throw failure();
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
    await child.kill(1000).catch(() => undefined);
  }
}
