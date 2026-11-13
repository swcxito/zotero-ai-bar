import { z } from 'zod';
import type { AskUserPayload } from '../../utils/agentSchemas';
import type { AgentUserAnswer } from '../chatManager';
import { codexString } from './i18n';

type Ask = (payload: AskUserPayload) => Promise<AgentUserAnswer[]>;
const cancelled = () => ({ action: 'cancel', content: null });

function choices(schema: any): { value: string; label: string }[] | undefined {
  const entries = schema.oneOf || schema.anyOf;
  if (Array.isArray(entries))
    return entries.map((entry: any) => {
      if (typeof entry.const !== 'string' || typeof entry.title !== 'string') throw new Error('Unsupported app form choice');
      return { value: entry.const, label: `${entry.title} (${entry.const})` };
    });
  if (Array.isArray(schema.enum))
    return schema.enum.map((value: unknown, i: number) => {
      if (typeof value !== 'string') throw new Error('Unsupported app form enum');
      return { value, label: schema.enumNames?.[i] ? `${schema.enumNames[i]} (${value})` : value };
    });
  return undefined;
}

function fieldSchema(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') throw new Error('Invalid app form');
  const options = choices(schema);
  if (schema.type === 'string') {
    let value = z.string();
    if (schema.minLength != null) value = value.min(schema.minLength);
    if (schema.maxLength != null) value = value.max(schema.maxLength);
    if (schema.format === 'email') value = value.email();
    else if (schema.format === 'uri') value = value.url();
    else if (schema.format === 'date') value = value.date();
    else if (schema.format === 'date-time') value = value.datetime({ offset: true });
    else if (schema.format != null) throw new Error('Unsupported app form format');
    return options ? value.refine((v) => options.some((option) => option.value === v)) : value;
  }
  if (schema.type === 'boolean') return z.boolean();
  if (schema.type === 'number' || schema.type === 'integer') {
    let value = z.number().finite();
    if (schema.type === 'integer') value = value.int();
    if (schema.minimum != null) value = value.min(schema.minimum);
    if (schema.maximum != null) value = value.max(schema.maximum);
    return value;
  }
  if (schema.type === 'array') {
    const options = choices(schema.items || {});
    if (!options) throw new Error('Unsupported app form array');
    let value = z.array(z.string().refine((v) => options.some((option) => option.value === v)));
    if (schema.minItems != null) value = value.min(schema.minItems);
    if (schema.maxItems != null) value = value.max(schema.maxItems);
    return value.refine((v) => new Set(v).size === v.length);
  }
  throw new Error('Unsupported app form field');
}

/** Validate every field before prompting, including nullable bounds from the native schema. */
export function formFields(schema: any): [string, any, z.ZodTypeAny][] {
  if (schema?.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))
    throw new Error('Unsupported app form');
  const fields = Object.entries(schema.properties);
  if (fields.length > 20) throw new Error('App form is too large');
  if (schema.required != null && (!Array.isArray(schema.required) || schema.required.some((key: any) => !Object.hasOwn(schema.properties, key))))
    throw new Error('Invalid required app fields');
  return fields.map(([key, field]) => [key, field, fieldSchema(field)]);
}

export function elicitationUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid app authorization URL');
  return url.href;
}

/** The runtime executes app tools. The client supplies only the user's explicit answers. */
export async function handleElicitation(params: any, ask: Ask, active: () => boolean, openUrl: (url: string) => void) {
  if (!active()) return cancelled();
  const header = `${params.serverName}\n${params.message}`;
  const yes = codexString('codex-apps-continue', '继续');
  const no = codexString('codex-apps-decline', '拒绝');
  const confirm = async (question: string) => {
    const answers = await ask({
      questions: [
        {
          question,
          options: [
            { label: yes, description: '' },
            { label: no, description: '' },
          ],
          isOther: false,
          isSecret: false,
          multiple: false,
        },
      ],
    });
    return active() && answers[0]?.selectedOptions.length === 1 && answers[0].selectedOptions[0] === yes;
  };
  if (params.mode === 'url') {
    const url = elicitationUrl(params.url);
    if (!(await confirm(`${header}\n${url}\n${codexString('codex-apps-open-url', '打开上述地址完成连接？')}`)))
      return { action: 'decline', content: null };
    if (!active()) return cancelled();
    openUrl(url);
    if (!(await confirm(codexString('codex-apps-url-complete', '请在浏览器中完成连接后选择继续。')))) return { action: 'decline', content: null };
    return { action: 'accept', content: null };
  }
  if (params.mode !== 'form') throw new Error('Unsupported app elicitation mode');
  const fields = formFields(params.requestedSchema);
  const content: Record<string, unknown> = Object.create(null);
  if (!fields.length && !(await confirm(header))) return { action: 'decline', content: null };
  for (const [key, schema, validator] of fields) {
    if (!active()) return cancelled();
    const required = params.requestedSchema.required?.includes(key);
    const options =
      schema.type === 'boolean'
        ? [
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
          ]
        : choices(schema.type === 'array' ? schema.items : schema);
    // Large enums use explicit JSON/text entry; never silently select defaults.
    const useChoices = options && options.length >= 2 && options.length <= 5;
    const question = `${header}\n${schema.title || key}${schema.description ? `: ${schema.description}` : ''}\n${required ? '*' : '(optional)'} ${schema.type}${!useChoices && options ? `: ${options.map((o) => o.value).join(', ')}` : ''}`;
    const answers = await ask({
      questions: [
        {
          question,
          options: useChoices ? options.map((o) => ({ label: o.label, description: o.value })) : null,
          isOther: !useChoices,
          isSecret: false,
          multiple: schema.type === 'array',
        },
      ],
    });
    if (!active()) return cancelled();
    const answer = answers[0];
    if (!answer) return cancelled();
    let value: unknown;
    if (useChoices) {
      const selected = answer.selectedOptions.map((label) => {
        const option = options.find((option) => option.label === label);
        if (!option) throw new Error('Invalid app form choice');
        return option.value;
      });
      if (schema.type === 'array') value = selected;
      else {
        if (selected.length > 1) throw new Error('Invalid app form selection');
        value = selected[0];
        if (schema.type === 'boolean' && value !== undefined) value = value === 'true';
      }
    } else {
      const text = answer.customInput ?? '';
      value = text === '' && !required ? undefined : schema.type === 'string' ? text : JSON.parse(text);
    }
    if (value === undefined && !required) continue;
    content[key] = validator.parse(value);
  }
  return active() ? { action: 'accept', content } : cancelled();
}
