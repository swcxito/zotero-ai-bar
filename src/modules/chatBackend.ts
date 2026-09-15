import type { ModelMessage } from 'ai';
import type { Session } from './chatManager';
import type { TranslationRequestMeta } from '../utils/translation';
import { streamLLMV2, streamTranslationV2 } from './llm';
import { codexModelSelection, streamCodex } from './codex/backend';

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
  const backend = codexModelSelection(translation?.modelKey) !== undefined ? codexBackend : apiBackend;
  if (backend === apiBackend && !translation) session.codex = undefined;
  return backend.stream(messages, session, translation);
}
