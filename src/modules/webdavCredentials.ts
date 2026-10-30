import { clearPref, getPref } from '../utils/prefs';

const origin = 'chrome://zaibar';
const realm = 'Zotero AI Bar WebDAV';

interface CredentialRuntime {
  manager: any;
  createLogin(username: string, password: string): any;
  encrypt?: (password: string) => Promise<string>;
  decrypt?: (password: string) => Promise<string>;
}

function credentialRuntime(): CredentialRuntime {
  const keyStore = (Zotero as any).OSKeyStore;
  return {
    manager: (globalThis as any).Services.logins,
    createLogin(username, password) {
      const Constructor = (globalThis as any).Components.Constructor;
      const Login = new Constructor('@mozilla.org/login-manager/loginInfo;1', 'nsILoginInfo', 'init');
      return new Login(origin, null, realm, username, password, '', '');
    },
    encrypt: keyStore?.encrypt?.bind(keyStore),
    decrypt: keyStore?.decrypt?.bind(keyStore),
  };
}

export async function setWebDavPassword(password: string, runtime = credentialRuntime()): Promise<void> {
  const manager = runtime.manager;
  const logins = await manager.searchLoginsAsync({ origin, httpRealm: realm });
  const encrypted = typeof runtime.encrypt === 'function';
  const stored = encrypted && password ? await runtime.encrypt!(password) : password;
  if (password) {
    const login = runtime.createLogin(encrypted ? 'encrypted' : 'password', stored);
    if (logins.length) manager.modifyLogin(logins[0], login);
    else await manager.addLoginAsync(login);
  } else {
    for (const login of logins) manager.removeLogin(login);
  }
  // Only remove the legacy preference after the credential was saved successfully.
  clearPref('sync.password');
}

export async function getWebDavPassword(runtime = credentialRuntime()): Promise<string> {
  const logins = await runtime.manager.searchLoginsAsync({ origin, httpRealm: realm });
  if (logins.length) {
    const login = logins[0];
    return login.username === 'encrypted' ? runtime.decrypt!(login.password) : login.password;
  }
  const legacy = String(getPref('sync.password') || '');
  if (legacy) await setWebDavPassword(legacy, runtime);
  return legacy;
}
