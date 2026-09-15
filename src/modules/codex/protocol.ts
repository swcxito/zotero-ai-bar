export type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { code: number; message: string } };

/** Newline-delimited JSON-RPC. No shell, sockets, polling or model API HTTP in the plugin. */
export class CodexRpc {
  private sequence = 0;
  private buffer = '';
  private closed?: Error;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly listeners = new Set<(message: RpcMessage) => void>();
  onRequest?: (message: RpcMessage) => Promise<unknown>;

  constructor(private write: (text: string) => Promise<unknown>) {}

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) throw this.closed;
    await this.write(JSON.stringify({ method, params }) + '\n');
  }

  request<T = any>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} 超时；操作不会自动重试。`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write(JSON.stringify({ id, method, params }) + '\n').catch(() => this.close(new Error('Codex 通信中断。')));
    });
  }

  feed(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) {
      this.close(new Error('Codex 消息超出大小限制。'));
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message');
      } catch {
        this.close(new Error('Codex 返回了无效协议消息。'));
        return;
      }
      if (message.method && message.id !== undefined) {
        void this.respond(message);
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        // Do not propagate arbitrary server error bodies (may contain credentials).
        if (message.error) pending.reject(new Error(`Codex ${message.error.code}: 请求失败。请检查登录、模型和运行时状态。`));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners) {
          try {
            listener(message);
          } catch {
            this.close(new Error('Codex 事件处理失败。'));
            return;
          }
        }
      }
    }
  }

  private async respond(message: RpcMessage): Promise<void> {
    try {
      if (!this.onRequest) throw new Error('Unsupported request');
      const result = await this.onRequest(message);
      if (!this.closed) await this.write(JSON.stringify({ id: message.id, result }) + '\n');
    } catch {
      if (!this.closed)
        await this.write(
          JSON.stringify({ id: message.id, error: { code: -32601, message: 'This client does not permit this operation.' } }) + '\n'
        ).catch(() => undefined);
    }
  }

  close(error = new Error('Codex 连接已关闭。')): void {
    if (this.closed) return;
    this.closed = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'client/disconnected' });
    this.listeners.clear();
  }
}
