import { asSchema, type ModelMessage } from 'ai';
import type { Session } from '../chatManager';
import { getSharedToolDefinitions } from '../agentTools';
import { onToolCallEndV2, onToolCallStartV2, onTranslationResultV2 } from '../chatUI';
import type { ClaudeToolResult, ClaudeToolServer } from './protocol';

const MAX_TOOL_CALLS = 30;

function toolError(text: string): ClaudeToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** JSON text for the model; a captured page (dataUrl) is also sent as an image. */
export function toolOutput(output: unknown): ClaudeToolResult {
  const { dataUrl, ...rest } =
    output && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>) : { value: output };
  const content: ClaudeToolResult['content'] = [{ type: 'text', text: JSON.stringify(rest) }];
  const image = typeof dataUrl === 'string' && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (image) content.push({ type: 'image', mimeType: image[1], data: image[2] });
  return { content };
}

/**
 * AI Bar's Agent tools for one Claude Code turn: the same handlers, validation and
 * limits as the Codex path. `beforeTool` lets the caller finish rendering the text
 * written before the call, so the tool card appears below it.
 */
export function zoteroToolServer(
  session: Session,
  signal: AbortSignal | undefined,
  messages: ModelMessage[],
  beforeTool: () => Promise<void> = async () => {}
): ClaudeToolServer {
  const definitions = getSharedToolDefinitions();
  const writes = new Map<string, Promise<ClaudeToolResult>>();
  let count = 0;
  return {
    tools: Object.entries(definitions).map(([name, definition]) => ({
      name,
      description: definition.description,
      inputSchema: asSchema(definition.inputSchema).jsonSchema,
    })),
    call(name, args, toolUseId) {
      // A repeated add_paper with identical arguments must not add the paper twice.
      const writeKey = name === 'add_paper' ? JSON.stringify(args) : undefined;
      if (writeKey && writes.has(writeKey)) return writes.get(writeKey)!;
      const work = (async (): Promise<ClaudeToolResult> => {
        const definition = Object.hasOwn(definitions, name) ? definitions[name] : undefined;
        if (!definition) return toolError(`Unknown tool: ${name}`);
        if (++count > MAX_TOOL_CALLS) return toolError('Tool call limit reached for this turn. Answer with the information already gathered.');
        if (signal?.aborted) return toolError('操作已取消。');
        await beforeTool();
        const ui = { toolCallId: toolUseId ?? `claude-tool-${count}`, toolName: name, input: args };
        // ask_user renders its own question card instead of a tool box.
        if (name !== 'ask_user') onToolCallStartV2(session, ui);
        try {
          const input = definition.inputSchema.parse(args);
          const output = await definition.execute(input, {
            experimental_context: session,
            imageSupport: true,
            abortSignal: signal,
            toolCallId: ui.toolCallId,
            messages,
          });
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (name === 'translate') onTranslationResultV2(session, output);
          else if (name !== 'ask_user') onToolCallEndV2(session, { ...ui, output });
          return toolOutput(output);
        } catch (error) {
          const message = signal?.aborted ? '操作已取消。' : (error as Error).message || 'Tool failed.';
          if (!signal?.aborted) onToolCallEndV2(session, { ...ui, output: { error: message } });
          return toolError(message);
        }
      })();
      if (writeKey) writes.set(writeKey, work);
      return work;
    },
  };
}
