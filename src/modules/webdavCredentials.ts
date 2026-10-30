import { clearPref, getPref } from '../utils/prefs';

const origin = 'chrome://zaibar';
const realm = 'Zotero AI Bar WebDAV';

function loginManager(): any {
  return (globalThis as any).Services.logins;
}

export async function setWebDavPassword(password: string): Promise<void> {
  const manager = loginManager();
  const logins = await manager.searchLoginsAsync({ origin, httpRealm: realm });
  const encrypted = typeof (Zotero as any).OSKeyStore?.encrypt === 'function';
  const stored = encrypted && password ? await (Zotero as any).OSKeyStore.encrypt(password) : password;
  if (password) {
    const Constructor = (globalThis as any).Components.Constructor;
    const Login = new Constructor('@mozilla.org/login-manager/loginInfo;1', 'nsILoginInfo', 'init');
    const login = new Login(origin, null, realm, encrypted ? 'encrypted' : 'password', stored, '', '');
    if (logins.length) manager.modifyLogin(logins[0], login);
    else await manager.addLoginAsync(login);
  } else {
    for (const login of logins) manager.removeLogin(login);
  }
  // Only remove the legacy preference after the credential was saved successfully.
  clearPref('sync.password');
}

export async function getWebDavPassword(): Promise<string> {
  const logins = await loginManager().searchLoginsAsync({ origin, httpRealm: realm });
  if (logins.length) {
    const login = logins[0];
    return login.username === 'encrypted' ? (Zotero as any).OSKeyStore.decrypt(login.password) : login.password;
  }
  const legacy = String(getPref('sync.password') || '');
  if (legacy) await setWebDavPassword(legacy);
  return legacy;
}
