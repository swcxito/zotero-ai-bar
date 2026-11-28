import { agyMcpReply, constantTimeEqual, type AgyToolServer } from './protocol';

export interface LoopbackMcpHandle {
  url: string;
  token: string;
  close(): void;
}

function loadHttpServer(): any {
  try {
    return (ChromeUtils.importESModule('chrome://remote/content/server/httpd.sys.mjs') as any).HttpServer;
  } catch {
    return (ChromeUtils.import('resource://zotero/httpd.js') as any).HttpServer;
  }
}

function loadNetUtil(): any {
  try {
    return (ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs') as any).NetUtil;
  } catch {
    return (ChromeUtils.import('resource://gre/modules/NetUtil.jsm') as any).NetUtil;
  }
}

function generateBearerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function writeUtf8Body(response: any, text: string): void {
  const converter = Cc['@mozilla.org/intl/converter-output-stream;1'].createInstance(Ci.nsIConverterOutputStream);
  converter.init(response.bodyOutputStream, 'UTF-8');
  converter.writeString(text);
  converter.flush();
}

function sendPlain(request: any, response: any, code: number, statusText: string, body = ''): void {
  response.setStatusLine(request.httpVersion, code, statusText);
  if (body) {
    response.setHeader('Content-Type', 'text/plain', false);
    response.setHeader('Content-Length', String(new TextEncoder().encode(body).byteLength), false);
    writeUtf8Body(response, body);
  } else {
    response.setHeader('Content-Length', '0', false);
  }
  response.finish();
}

/**
 * Starts an ephemeral, loopback-only (127.0.0.1) HTTP MCP server backed by Mozilla's
 * built-in `HttpServer` (the same server Zotero uses in `Zotero.Server`), scoped to a
 * single Agent turn and protected by a per-turn 256-bit Bearer token.
 */
export function startAgyMcpServer(toolServer: AgyToolServer): LoopbackMcpHandle {
  const HttpServer = loadHttpServer();
  const NetUtil = loadNetUtil();
  const token = generateBearerToken();
  const server = new HttpServer();
  let closed = false;

  server.registerPathHandler('/mcp', (request: any, response: any) => {
    response.processAsync();
    void (async () => {
      try {
        if (closed) {
          sendPlain(request, response, 503, 'Service Unavailable');
          return;
        }
        if (request.method !== 'POST') {
          sendPlain(request, response, 405, 'Method Not Allowed', 'Method Not Allowed');
          return;
        }
        const auth = request.hasHeader('Authorization') ? String(request.getHeader('Authorization') || '') : '';
        if (!constantTimeEqual(auth, `Bearer ${token}`)) {
          sendPlain(request, response, 401, 'Unauthorized', 'Unauthorized');
          return;
        }
        const available = request.bodyInputStream?.available?.() ?? 0;
        const raw = available > 0 ? NetUtil.readInputStreamToString(request.bodyInputStream, available, { charset: 'UTF-8' }) : '';
        let message: any;
        try {
          message = JSON.parse(raw);
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid JSON-RPC payload');
        } catch {
          sendPlain(request, response, 400, 'Bad Request', 'Invalid JSON');
          return;
        }
        const reply = await agyMcpReply(message, toolServer);
        if (reply === undefined) {
          sendPlain(request, response, 202, 'Accepted');
          return;
        }
        const payload = JSON.stringify(reply);
        const byteLength = new TextEncoder().encode(payload).byteLength;
        response.setStatusLine(request.httpVersion, 200, 'OK');
        response.setHeader('Content-Type', 'application/json', false);
        response.setHeader('Content-Length', String(byteLength), false);
        writeUtf8Body(response, payload);
        response.finish();
      } catch (error) {
        Zotero.debug?.(`[zaibar-agy-mcp] request failed: ${String((error as Error)?.message || error)}`);
        try {
          sendPlain(request, response, 500, 'Internal Server Error', 'Internal Server Error');
        } catch {
          try {
            response.finish();
          } catch {
            /* ignore */
          }
        }
      }
    })();
  });

  // Port -1 allocates an OS ephemeral port on loopback only.
  server.start(-1);
  const port = server.identity.primaryPort;
  server.identity.add('http', '127.0.0.1', port);

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close() {
      if (closed) return;
      closed = true;
      try {
        server.stop(() => undefined);
      } catch {
        /* ignore */
      }
    },
  };
}
