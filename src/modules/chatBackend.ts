import type { ModelMessage } from 'ai';
import type { Session } from './chatManager';
import type { TranslationRequestMeta } from '../utils/translation';
import { streamLLMV2, streamTranslationV2 } from './llm';
import { codexModelSelection, streamCodex } from './codex/backend';
import { streamClaudeCode } from './claudeCode/backend';
import { claudeCodeModelSelection } from './claudeCode/protocol';
import { streamAgy } from './agy/backend';
import { agyModelSelection } from './agy/protocol';

export interface ChatBackend {
  stream(messages: ModelMessage[] | Promise<ModelMessage[]>, session: Session, translation?: TranslationRequestMeta): Promise<void>;
}

const apiBackend: ChatBackend = {
  stream: (messages, session, translation) => (translation ? streamTranslationV2(messages, session, translation) : streamLLMV2(messages, session)),
};
const codexBackend: ChatBackend = { stream: streamCodex };

export function streamChatBackend(
  messages: ModelMessage[] | Promise<ModelMessage[]>,
  session: Session,
  translation?: TranslationRequestMeta
): Promise<void> {
  if (claudeCodeModelSelection(translation?.modelKey, addon.data.userProviderConfigV2?.active) !== undefined) {
    if (!translation) session.codex = undefined;
    return streamClaudeCode(messages, session, translation);
  }
  if (agyModelSelection(translation?.modelKey, addon.data.userProviderConfigV2?.active) !== undefined) {
    if (!translation) session.codex = undefined;
    return streamAgy(messages, session, translation);
  }
  const backend = codexModelSelection(translation?.modelKey) !== undefined ? codexBackend : apiBackend;
  if (backend === apiBackend && !translation) session.codex = undefined;
  return backend.stream(messages, session, translation);
}
