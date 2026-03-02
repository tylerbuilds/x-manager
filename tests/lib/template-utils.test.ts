import { describe, expect, it } from 'vitest';
import { renderTemplate } from '@/lib/template-utils';

describe('template-utils', () => {
  it('renders top-level and nested placeholders', () => {
    const result = renderTemplate('New post: {title} by @{author.username}', {
      title: 'Agents at Work',
      author: { username: 'swarmsignal' },
    });

    expect(result).toBe('New post: Agents at Work by @swarmsignal');
  });

  it('replaces missing values with empty strings', () => {
    expect(renderTemplate('Hello {missing}', {})).toBe('Hello ');
  });
});
