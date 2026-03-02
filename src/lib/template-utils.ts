function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function resolveTemplateValue(context: unknown, path: string): string {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let current: unknown = context;

  for (const part of parts) {
    const record = asRecord(current);
    if (!record || !(part in record)) {
      return '';
    }
    current = record[part];
  }

  if (current == null) return '';
  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean') return String(current);
  return '';
}

export function renderTemplate(template: string, context: unknown): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => resolveTemplateValue(context, key.trim()));
}
