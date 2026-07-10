import { DEFAULT_LOCALE, isSiteLocale, siteCopy, type SiteLocale } from '../content/site';
import { copyText } from './clipboard';

const excludedSelector = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[data-markdown-exclude]',
  'button:not([data-markdown-include])',
  'canvas',
  'dialog',
  'form',
  'iframe',
  'input',
  'nav',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
].join(',');

const blockTags = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'FIGURE',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'MAIN',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
]);

interface SerializerContext {
  codeBlocks: string[];
}

type CopyState = 'copied' | 'error' | 'idle';

function currentLocale(): SiteLocale {
  const locale = document.documentElement.dataset.locale;
  return isSiteLocale(locale) ? locale : DEFAULT_LOCALE;
}

function canonicalUrl(): string {
  return document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
    ?? window.location.href;
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, canonicalUrl()).toString();
  } catch {
    return value;
  }
}

function escapeText(value: string): string {
  return value.replace(/([\\*[\]])/g, '\\$1');
}

function inlineCode(value: string): string {
  const longestFence = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longestFence + 1);
  const padded = /^\s|\s$|^`|`$/u.test(value) ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function inlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? '').replace(/\s+/gu, ' ');
  }

  if (!(node instanceof HTMLElement) || node.matches(excludedSelector)) {
    return '';
  }

  const content = inlineChildren(node);

  switch (node.tagName) {
    case 'A': {
      const rawHref = node instanceof HTMLAnchorElement ? node.getAttribute('href') ?? '' : '';
      const href = rawHref ? absoluteUrl(rawHref) : '';
      return href && content ? `[${content}](<${href.replaceAll('>', '%3E')}>)` : content;
    }
    case 'BR':
      return '  \n';
    case 'CODE':
      return inlineCode(node.textContent ?? '');
    case 'DEL':
    case 'S':
      return content ? `~~${content}~~` : '';
    case 'EM':
    case 'I':
      return content ? `*${content}*` : '';
    case 'IMG': {
      const image = node as HTMLImageElement;
      const rawSrc = image.getAttribute('src') ?? '';
      const src = rawSrc ? absoluteUrl(rawSrc) : '';
      return image.alt && src ? `![${escapeText(image.alt)}](<${src.replaceAll('>', '%3E')}>)` : '';
    }
    case 'STRONG':
    case 'B':
      return content ? `**${content}**` : '';
    default:
      return content;
  }
}

function inlineChildren(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .map(inlineNode)
    .join('')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function normalizeFragment(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function codeBlock(pre: HTMLElement, context: SerializerContext): string {
  const code = pre.querySelector('code');
  const value = (code?.textContent ?? pre.textContent ?? '').replace(/\n$/u, '');
  const language = code?.className.match(/(?:^|\s)language-([\w-]+)/u)?.[1] ?? '';
  const longestFence = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  const token = `@@MEM9_CODE_BLOCK_${context.codeBlocks.length}@@`;
  context.codeBlocks.push(`${fence}${language}\n${value}\n${fence}`);
  return token;
}

function tableMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows).map((row) => (
    Array.from(row.cells).map((cell) => (
      inlineChildren(cell)
        .replaceAll('|', '\\|')
        .replace(/\n+/gu, '<br>')
    ))
  ));

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row: string[]): string[] => (
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  );
  const header = normalizeRow(rows[0]);
  const body = rows.slice(1).map(normalizeRow);
  const caption = table.caption ? inlineChildren(table.caption) : '';
  const markdown = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

  return caption ? `**${caption}**\n\n${markdown}` : markdown;
}

function listMarkdown(list: HTMLOListElement | HTMLUListElement, context: SerializerContext, depth = 0): string {
  const ordered = list instanceof HTMLOListElement;
  const start = ordered ? list.start : 1;
  const items = Array.from(list.children).filter((child): child is HTMLLIElement => child.tagName === 'LI');

  return items.map((item, index) => {
    const nestedLists = Array.from(item.children).filter(
      (child): child is HTMLOListElement | HTMLUListElement => child.tagName === 'OL' || child.tagName === 'UL',
    );
    const contentNodes = Array.from(item.childNodes)
      .filter((child) => !(child instanceof HTMLElement && nestedLists.includes(child as HTMLOListElement | HTMLUListElement)));
    const hasBlockContent = contentNodes.some(
      (child) => child instanceof HTMLElement && blockTags.has(child.tagName),
    );
    const content = normalizeFragment(
      hasBlockContent
        ? contentNodes
          .map((child) => blockNode(child, context))
          .filter(Boolean)
          .join('\n\n')
        : contentNodes.map(inlineNode).join('').replace(/[ \t]+/gu, ' '),
    );
    const marker = ordered ? `${start + index}. ` : '- ';
    const indent = '  '.repeat(depth);
    const continuation = `${indent}${' '.repeat(marker.length)}`;
    const line = `${indent}${marker}${content.replaceAll('\n', `\n${continuation}`)}`.trimEnd();
    const nested = nestedLists.map((child) => listMarkdown(child, context, depth + 1)).join('\n');
    return nested ? `${line}\n${nested}` : line;
  }).join('\n');
}

function blockChildren(element: HTMLElement, context: SerializerContext): string {
  return Array.from(element.childNodes)
    .map((child) => blockNode(child, context))
    .filter(Boolean)
    .join('\n\n');
}

function blockNode(node: Node, context: SerializerContext): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? '').replace(/\s+/gu, ' ').trim();
  }

  if (!(node instanceof HTMLElement) || node.matches(excludedSelector)) {
    return '';
  }

  const markdownHeading = Number(node.dataset.markdownHeading);
  if (Number.isInteger(markdownHeading) && markdownHeading >= 1 && markdownHeading <= 6) {
    return `${'#'.repeat(markdownHeading)} ${inlineChildren(node)}`;
  }

  switch (node.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
      return `${'#'.repeat(Number(node.tagName[1]))} ${inlineChildren(node)}`;
    case 'P':
    case 'FIGCAPTION':
    case 'SUMMARY':
      return inlineChildren(node);
    case 'PRE':
      return codeBlock(node, context);
    case 'UL':
    case 'OL':
      return listMarkdown(node as HTMLOListElement | HTMLUListElement, context);
    case 'TABLE':
      return tableMarkdown(node as HTMLTableElement);
    case 'BLOCKQUOTE':
      return normalizeFragment(blockChildren(node, context))
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
    case 'DETAILS': {
      const summary = Array.from(node.children).find((child) => child.tagName === 'SUMMARY');
      const content = Array.from(node.childNodes)
        .filter((child) => child !== summary)
        .map((child) => blockNode(child, context))
        .filter(Boolean)
        .join('\n\n');
      return [`### ${summary instanceof HTMLElement ? inlineChildren(summary) : ''}`, content]
        .filter(Boolean)
        .join('\n\n');
    }
    case 'DT':
      return `**${inlineChildren(node)}**`;
    case 'DD':
      return blockChildren(node, context) || inlineChildren(node);
    case 'HR':
      return '---';
    case 'A':
    case 'B':
    case 'CODE':
    case 'DEL':
    case 'EM':
    case 'I':
    case 'IMG':
    case 'S':
    case 'SPAN':
    case 'STRONG':
      return inlineNode(node);
    case 'DIV':
      if (Array.from(node.children).some((child) => blockTags.has(child.tagName))) {
        return blockChildren(node, context);
      }

      if (
        node.children.length > 1
        && Array.from(node.childNodes).every(
          (child) => child.nodeType !== Node.TEXT_NODE || child.textContent?.trim() === '',
        )
      ) {
        return Array.from(node.children).map(inlineNode).filter(Boolean).join(' ');
      }

      return inlineChildren(node);
    default:
      return blockChildren(node, context) || inlineChildren(node);
  }
}

function activeMarkdownRoot(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-markdown-root]'))
    .find((root) => root.closest('[hidden], [aria-hidden="true"]') === null) ?? null;
}

export function serializePageMarkdown(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>(excludedSelector).forEach((element) => element.remove());

  const context: SerializerContext = { codeBlocks: [] };
  let content = normalizeFragment(blockNode(clone, context));
  context.codeBlocks.forEach((block, index) => {
    content = content.replace(`@@MEM9_CODE_BLOCK_${index}@@`, block);
  });

  if (!/^#\s/mu.test(content)) {
    content = `# ${escapeText(document.title)}\n\n${content}`;
  }

  const canonical = canonicalUrl();
  const language = root.dataset.markdownLang ?? document.documentElement.lang;
  const source = `> Source: [${canonical}](<${canonical.replaceAll('>', '%3E')}>)\n> Language: ${language}`;
  return `${source}\n\n${content.trim()}\n`;
}

function setButtonState(button: HTMLButtonElement, state: CopyState): void {
  const dictionary = siteCopy[currentLocale()].pageTools;
  const label = button.querySelector<HTMLElement>('[data-page-markdown-label]');
  const text = state === 'copied'
    ? dictionary.copiedMarkdown
    : state === 'error'
      ? dictionary.copyMarkdownFailed
      : dictionary.copyMarkdown;

  if (label) {
    label.textContent = text;
  }

  button.classList.toggle('is-copied', state === 'copied');
  button.classList.toggle('is-error', state === 'error');
  button.setAttribute('aria-label', text);
  button.setAttribute('title', text);
}

export function initPageMarkdownCopy(): void {
  const actions = document.querySelectorAll<HTMLElement>('[data-page-markdown-action]');
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-page-markdown-copy]');
  const hasRoot = activeMarkdownRoot() !== null;

  actions.forEach((action) => {
    action.hidden = !hasRoot;
  });

  buttons.forEach((button) => {
    let resetTimer = 0;
    let copying = false;
    button.addEventListener('click', async () => {
      const root = activeMarkdownRoot();
      if (!root || copying) {
        return;
      }

      window.clearTimeout(resetTimer);
      copying = true;
      button.setAttribute('aria-busy', 'true');
      let copied = false;
      try {
        copied = await copyText(serializePageMarkdown(root));
      } catch {
        copied = false;
      } finally {
        copying = false;
        button.removeAttribute('aria-busy');
      }
      setButtonState(button, copied ? 'copied' : 'error');
      resetTimer = window.setTimeout(() => setButtonState(button, 'idle'), copied ? 2200 : 3000);
    });
  });
}
