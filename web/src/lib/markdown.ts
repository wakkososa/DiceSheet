import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/** Render DiceCloud rules text (markdown with already-computed inline values) safely. */
export function renderMarkdown(text: string | undefined | null): string {
  if (!text) return '';
  const html = marked.parse(String(text), { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] });
}

/** Computed text of an inline-calculation field (summary/description). */
export function fieldText(field: any): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.value ?? field.text ?? '';
}
