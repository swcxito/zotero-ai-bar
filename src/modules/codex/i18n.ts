import type { FluentMessageId } from '../../../typings/i10n';
import { getString } from '../../utils/locale';

/**
 * Codex can report errors before the preferences window has initialized the
 * Fluent bundle (for example during startup detection). Keep those early
 * messages readable while using the active locale whenever it is available.
 */
export function codexString(id: FluentMessageId, fallback: string, args?: Record<string, unknown>): string {
  try {
    const localized = args === undefined ? getString(id) : getString(id, { args });
    if (localized && localized !== `zaibar-${id}`) return localized;
  } catch {
    // Locale initialization is intentionally non-blocking.
  }
  return fallback;
}
