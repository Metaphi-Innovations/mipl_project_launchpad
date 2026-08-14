const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);

const DROP_TAGS = new Set(['iframe', 'link', 'meta', 'object', 'script', 'style', 'svg']);
const MAX_INLINE_IMAGE_SOURCE_LENGTH = 700_000;

const ALLOWED_STYLES = new Set([
  'background-color',
  'border',
  'border-color',
  'border-style',
  'border-width',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'margin-left',
  'padding-left',
  'text-align',
  'text-decoration',
  'vertical-align',
  'white-space',
]);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const sanitizeStyle = (style: string) =>
  style
    .split(';')
    .map((declaration) => {
      const separatorIndex = declaration.indexOf(':');
      if (separatorIndex === -1) {
        return '';
      }

      const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
      const value = declaration.slice(separatorIndex + 1).trim();

      if (!ALLOWED_STYLES.has(property)) {
        return '';
      }

      if (/url\s*\(|expression\s*\(|javascript:|data:|[<>]/i.test(value)) {
        return '';
      }

      return value ? `${property}: ${value}` : '';
    })
    .filter(Boolean)
    .join('; ');

const isSafeUrl = (value: string) => /^(https?:|mailto:|tel:|#|\/)/i.test(value.trim());
const isSafeImageUrl = (value: string) => {
  const trimmed = value.trim();
  const isInlineImage =
    trimmed.length <= MAX_INLINE_IMAGE_SOURCE_LENGTH &&
    /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed);

  return isInlineImage || /^(https?:|\/)/i.test(trimmed);
};
const isSafeTableSpan = (value: string) => /^[1-9]\d{0,2}$/.test(value.trim());
const sanitizeAttributeText = (value: string, maxLength = 180) =>
  value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
const RICH_HTML_PATTERN = /<(?:a|b|blockquote|code|em|h[1-6]|i|img|li|ol|pre|strong|table|td|th|u|ul)\b/i;
const UNORDERED_LIST_PATTERN = /^\s*(?:[-*•●▪◦‣–—])\s+(.+)$/;
const ORDERED_LIST_PATTERN = /^\s*\d+[\.)]\s+(.+)$/;

const COMMON_HEADING_TEXTS = new Set([
  'about company',
  'about the company',
  'about the role',
  'benefits',
  'company overview',
  'education',
  'eligibility',
  'experience',
  'good to have',
  'job description',
  'job summary',
  'key responsibilities',
  'location',
  'must have',
  'preferred qualifications',
  'qualification',
  'qualifications',
  'required skills',
  'requirements',
  'responsibilities',
  'role',
  'role overview',
  'selection process',
  'skills',
  'technical skills',
  'what you will do',
  'who can apply',
]);

const sanitizeElement = (sourceElement: Element, targetDocument: Document) => {
  const tagName = sourceElement.tagName.toLowerCase();

  if (DROP_TAGS.has(tagName)) {
    return null;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = targetDocument.createDocumentFragment();
    sourceElement.childNodes.forEach((child) => {
      const sanitizedChild = sanitizeNode(child, targetDocument);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const element = targetDocument.createElement(tagName);

  if (sourceElement.hasAttribute('style')) {
    const safeStyle = sanitizeStyle(sourceElement.getAttribute('style') || '');
    if (safeStyle) {
      element.setAttribute('style', safeStyle);
    }
  }

  if (tagName === 'a') {
    const href = sourceElement.getAttribute('href') || '';
    if (isSafeUrl(href)) {
      element.setAttribute('href', href);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer');
    }
  }

  if (tagName === 'img') {
    const src = sourceElement.getAttribute('src') || '';
    if (!isSafeImageUrl(src)) {
      return null;
    }

    element.setAttribute('src', src.trim());
    element.setAttribute('alt', sanitizeAttributeText(sourceElement.getAttribute('alt') || ''));
    if (sourceElement.getAttribute('data-banner') === 'true') {
      element.setAttribute('data-banner', 'true');
    }
    return element;
  }

  if ((tagName === 'td' || tagName === 'th') && sourceElement.hasAttribute('colspan')) {
    const value = sourceElement.getAttribute('colspan') || '';
    if (isSafeTableSpan(value)) {
      element.setAttribute('colspan', value);
    }
  }

  if ((tagName === 'td' || tagName === 'th') && sourceElement.hasAttribute('rowspan')) {
    const value = sourceElement.getAttribute('rowspan') || '';
    if (isSafeTableSpan(value)) {
      element.setAttribute('rowspan', value);
    }
  }

  if (tagName === 'ol' && sourceElement.hasAttribute('start')) {
    const value = sourceElement.getAttribute('start') || '';
    if (isSafeTableSpan(value)) {
      element.setAttribute('start', value);
    }
  }

  sourceElement.childNodes.forEach((child) => {
    const sanitizedChild = sanitizeNode(child, targetDocument);
    if (sanitizedChild) {
      element.appendChild(sanitizedChild);
    }
  });

  return element;
};

const sanitizeNode = (node: Node, targetDocument: Document): Node | DocumentFragment | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    return targetDocument.createTextNode(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  return sanitizeElement(node as Element, targetDocument);
};

const formatInlinePlainText = (value: string) => {
  let html = escapeHtml(value.trim());

  html = html.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:|\/)[^)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  return html;
};

const normalizeHeadingText = (value: string) =>
  value
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__(.+)__$/, '$1')
    .replace(/\s*:\s*$/, '')
    .trim();

const getHeadingLevel = (line: string) => {
  const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
  if (markdownHeading) {
    return {
      level: Math.min(markdownHeading[1].length, 3),
      text: normalizeHeadingText(markdownHeading[2]),
    };
  }

  const headingText = normalizeHeadingText(line);
  const normalized = headingText.toLowerCase();
  const wordCount = headingText.split(/\s+/).filter(Boolean).length;
  const isShort = headingText.length > 0 && headingText.length <= 86 && wordCount <= 10;

  if (COMMON_HEADING_TEXTS.has(normalized)) {
    return { level: 2, text: headingText };
  }

  if (line.trim().endsWith(':') && isShort) {
    return { level: 3, text: headingText };
  }

  if (
    isShort &&
    headingText.length >= 4 &&
    headingText === headingText.toUpperCase() &&
    /[A-Z]/.test(headingText)
  ) {
    return { level: 3, text: headingText };
  }

  return null;
};

const hasStructuredPlainText = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .some((line) => {
      const trimmed = line.trim();
      return Boolean(
        trimmed &&
          (UNORDERED_LIST_PATTERN.test(trimmed) ||
            ORDERED_LIST_PATTERN.test(trimmed) ||
            getHeadingLevel(trimmed)),
      );
    });

export const plainTextToHtml = (text: string) => {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const html: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    html.push(`<p>${paragraphLines.join('<br>')}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      return;
    }

    html.push(`<${listType}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listType}>`);
    listItems = [];
    listType = null;
  };

  normalized.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const unorderedListItem = line.match(UNORDERED_LIST_PATTERN);
    const orderedListItem = line.match(ORDERED_LIST_PATTERN);
    if (unorderedListItem || orderedListItem) {
      flushParagraph();

      const nextListType = unorderedListItem ? 'ul' : 'ol';
      if (listType && listType !== nextListType) {
        flushList();
      }

      listType = nextListType;
      listItems.push(formatInlinePlainText((unorderedListItem || orderedListItem)?.[1] || ''));
      return;
    }

    const heading = getHeadingLevel(line);
    if (heading) {
      flushParagraph();
      flushList();
      html.push(`<h${heading.level}>${formatInlinePlainText(heading.text)}</h${heading.level}>`);
      return;
    }

    flushList();
    paragraphLines.push(formatInlinePlainText(line));
  });

  flushParagraph();
  flushList();

  return html.join('');
};

export const sanitizeRichTextHtml = (html: string) => {
  const source = html.trim();
  if (!source) {
    return '';
  }

  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return plainTextToHtml(source);
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${source}</div>`, 'text/html');
  const container = document.createElement('div');

  parsed.body.firstElementChild?.childNodes.forEach((child) => {
    const sanitizedChild = sanitizeNode(child, document);
    if (sanitizedChild) {
      container.appendChild(sanitizedChild);
    }
  });

  return container.innerHTML.trim();
};

export const normalizeRichTextHtml = (html: string, fallbackText = '') => {
  const shouldFormatFallback =
    Boolean(html.trim()) &&
    Boolean(fallbackText.trim()) &&
    !RICH_HTML_PATTERN.test(html) &&
    hasStructuredPlainText(fallbackText);
  const source = html.trim() && !shouldFormatFallback ? html : plainTextToHtml(fallbackText);
  return sanitizeRichTextHtml(source);
};

export const richTextToPlainText = (html: string) => {
  if (!html.trim()) {
    return '';
  }

  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const container = document.createElement('div');
  container.innerHTML = sanitizeRichTextHtml(html);
  return (container.innerText || container.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
