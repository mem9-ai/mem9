import {
  DEFAULT_LOCALE,
  DEFAULT_THEME_PREFERENCE,
  LOCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isSiteLocale,
  isSiteResolvedTheme,
  isSiteThemePreference,
  siteCopy,
  type SiteDictionary,
  type SiteLocale,
  type SiteResolvedTheme,
  type SiteThemePreference,
} from '../content/site';

type MenuName = 'docs' | 'login' | 'language' | 'theme' | 'mobile';
type DocsLocale = 'en' | 'zh' | 'ja' | 'ko' | 'id' | 'th';
type OnboardingVersion = 'stable' | 'beta';
type OnboardingCommandParts = {
  prefix: string;
  url: string | null;
  suffix: string;
};

const ONBOARDING_COMMAND_URL_PATTERN = /https:\/\/\S+/u;
const PUBLIC_SKILL_ORIGIN = 'https://mem9.ai';
const PUBLIC_SKILL_URLS = [
  'https://mem9.ai/SKILL.md',
  'https://mem9.ai/beta/SKILL.md',
];
const TRACKED_SKILL_PATHS = new Set(['/SKILL.md', '/beta/SKILL.md']);

function getValue(dictionary: SiteDictionary, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }

    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, dictionary);
}

function textFor(dictionary: SiteDictionary, path: string): string {
  const value = getValue(dictionary, path);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function resolveBrowserLocale(): SiteLocale {
  const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];

  for (const locale of browserLocales) {
    const normalized = locale.toLowerCase();

    if (normalized.startsWith('zh')) {
      if (
        normalized.startsWith('zh-hant') ||
        normalized.startsWith('zh-tw') ||
        normalized.startsWith('zh-hk') ||
        normalized.startsWith('zh-mo')
      ) {
        return 'zh-Hant';
      }

      return 'zh';
    }

    if (normalized.startsWith('ja')) {
      return 'ja';
    }

    if (normalized.startsWith('ko')) {
      return 'ko';
    }

    if (normalized.startsWith('id') || normalized.startsWith('in')) {
      return 'id';
    }

    if (normalized.startsWith('th')) {
      return 'th';
    }

    if (normalized.startsWith('en')) {
      return 'en';
    }
  }

  return DEFAULT_LOCALE;
}

function localeToLang(locale: SiteLocale): string {
  if (locale === 'zh') {
    return 'zh-CN';
  }

  if (locale === 'zh-Hant') {
    return 'zh-Hant';
  }

  return locale;
}

function readPreferredLocale(): SiteLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSiteLocale(stored) ? stored : resolveBrowserLocale();
  } catch {
    return resolveBrowserLocale();
  }
}

function readStoredThemePreference(): SiteThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isSiteThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function getSystemTheme(): SiteResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: SiteThemePreference): SiteResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

function themeModeLabel(dictionary: SiteDictionary, preference: SiteThemePreference): string {
  switch (preference) {
    case 'light':
      return dictionary.aria.themeModeLight;
    case 'dark':
      return dictionary.aria.themeModeDark;
    case 'system':
    default:
      return dictionary.aria.themeModeSystem;
  }
}

function currentLocale(): SiteLocale {
  return isSiteLocale(document.documentElement.dataset.locale)
    ? document.documentElement.dataset.locale
    : DEFAULT_LOCALE;
}

function currentThemePreference(): SiteThemePreference {
  return isSiteThemePreference(document.documentElement.dataset.themePreference)
    ? document.documentElement.dataset.themePreference
    : readStoredThemePreference();
}

function isOnboardingVersion(value: string | null | undefined): value is OnboardingVersion {
  return value === 'stable' || value === 'beta';
}

function currentOnboardingVersion(): OnboardingVersion {
  const shell = document.querySelector<HTMLElement>('[data-onboarding-shell]');
  return isOnboardingVersion(shell?.dataset.onboardingVersion)
    ? shell.dataset.onboardingVersion
    : 'stable';
}

function splitOnboardingCommand(text: string): OnboardingCommandParts {
  const match = text.match(ONBOARDING_COMMAND_URL_PATTERN);

  if (!match || match.index === undefined) {
    return {
      prefix: text,
      url: null,
      suffix: '',
    };
  }

  const url = match[0];
  const prefix = text.slice(0, match.index);
  const suffix = text.slice(match.index + url.length);

  return { prefix, url, suffix };
}

function currentUTMParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  const filtered = new URLSearchParams();

  for (const [key, value] of params.entries()) {
    if (!key.startsWith('utm_') || value === '') {
      continue;
    }

    filtered.set(key, value);
  }

  return filtered;
}

function resolveTrackableSkillUrl(rawHref: string): URL | null {
  try {
    const url = new URL(rawHref, window.location.origin);
    const isSupportedOrigin = url.origin === PUBLIC_SKILL_ORIGIN || url.origin === window.location.origin;

    if (!isSupportedOrigin || !TRACKED_SKILL_PATHS.has(url.pathname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function isAbsoluteUrl(rawHref: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/iu.test(rawHref);
}

function rewriteSkillHref(rawHref: string): string {
  const url = resolveTrackableSkillUrl(rawHref);
  if (!url) {
    return rawHref;
  }

  const utmParams = currentUTMParams();
  url.search = utmParams.toString();

  if (!isAbsoluteUrl(rawHref)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }

  return url.toString();
}

function baseSkillHref(rawHref: string): string {
  const url = resolveTrackableSkillUrl(rawHref);
  if (!url) {
    return rawHref;
  }

  url.search = '';

  if (!isAbsoluteUrl(rawHref)) {
    return `${url.pathname}${url.hash}`;
  }

  return url.toString();
}

function rewriteSkillUrlsInText(text: string): string {
  let next = text;

  for (const rawHref of PUBLIC_SKILL_URLS) {
    next = next.replaceAll(rawHref, rewriteSkillHref(rawHref));
  }

  return next;
}

function applyTrackedSkillLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const baseHref = link.dataset.skillHrefBase ?? baseSkillHref(link.getAttribute('href') ?? '');
    if (!baseHref) {
      return;
    }

    if (!resolveTrackableSkillUrl(baseHref)) {
      return;
    }

    if (!link.dataset.skillHrefBase) {
      link.dataset.skillHrefBase = baseHref;
    }

    link.setAttribute('href', rewriteSkillHref(baseHref));
  });
}

function renderOnboardingCommand(element: HTMLElement, text: string): void {
  const { prefix, url, suffix } = splitOnboardingCommand(text);
  element.replaceChildren();

  if (prefix) {
    element.append(prefix);
  }

  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'onboarding-command-link';
    link.textContent = url;
    element.append(link);
  }

  if (suffix) {
    element.append(suffix);
  }
}

function syncControlLabels(locale: SiteLocale, preference: SiteThemePreference): void {
  const dictionary = siteCopy[locale];
  const languageToggle = document.querySelector<HTMLButtonElement>('[data-language-toggle]');
  const themeToggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');

  if (languageToggle) {
    languageToggle.setAttribute('aria-label', dictionary.aria.changeLanguage);
    languageToggle.setAttribute('title', dictionary.aria.changeLanguage);
  }

  if (themeToggle) {
    const label = themeModeLabel(dictionary, preference);
    themeToggle.setAttribute('aria-label', label);
    themeToggle.setAttribute('title', label);
  }
}

function applyTheme(
  theme: SiteResolvedTheme,
  preference: SiteThemePreference,
  locale: SiteLocale,
): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  syncControlLabels(locale, preference);

  document.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach((button) => {
    const isActive = button.dataset.setTheme === preference;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function setDocumentLang(locale: SiteLocale): void {
  document.documentElement.lang = localeToLang(locale);
}

function updateMetaElements(title: string, descriptionText: string): void {
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  const ogDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');

  document.title = title;

  if (description) {
    description.content = descriptionText;
  }

  if (ogTitle) {
    ogTitle.content = title;
  }

  if (ogDescription) {
    ogDescription.content = descriptionText;
  }
}

function updateMeta(locale: SiteLocale, dictionary: SiteDictionary): void {
  setDocumentLang(locale);
  const titleElement = document.querySelector<HTMLTitleElement>('title');
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const title = textFor(dictionary, titleElement?.dataset.metaTitleKey ?? 'meta.title')
    || dictionary.meta.title;
  const descriptionText = textFor(
    dictionary,
    description?.dataset.metaDescriptionKey ?? 'meta.description',
  ) || dictionary.meta.description;

  updateMetaElements(title, descriptionText);
}

function updateTranslations(dictionary: SiteDictionary): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) {
      return;
    }

    const value = textFor(dictionary, key);
    if (element.dataset.i18nHtml !== undefined) {
      element.innerHTML = value;
    } else {
      element.textContent = value;
    }
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((element) => {
    const raw = element.dataset.i18nAttr;
    if (!raw) {
      return;
    }

    raw.split(';').forEach((entry) => {
      const [attribute, key] = entry.split(':');
      if (!attribute || !key) {
        return;
      }

      element.setAttribute(attribute, textFor(dictionary, key));
    });
  });

  document.querySelectorAll<HTMLElement>('[data-copy-key]').forEach((element) => {
    const copyKey = element.dataset.copyKey;
    if (!copyKey) {
      return;
    }

    element.dataset.copyText = textFor(dictionary, copyKey);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-set-locale]').forEach((button) => {
    const isActive = button.dataset.setLocale === document.documentElement.dataset.locale;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function applyOnboardingVersion(version: OnboardingVersion): void {
  const shell = document.querySelector<HTMLElement>('[data-onboarding-shell]');
  const command = document.querySelector<HTMLElement>('[data-onboarding-command]');
  const copyButton = document.querySelector<HTMLButtonElement>('[data-copy-button]');
  const betaHighlights = document.querySelector<HTMLElement>('[data-beta-highlights]');

  if (!shell || !command || !copyButton || !betaHighlights) {
    return;
  }

  shell.dataset.onboardingVersion = version;

  const stableText = command.dataset.commandStable ?? '';
  const betaText = command.dataset.commandBeta ?? '';
  const nextText = version === 'beta' ? betaText : stableText;

  renderOnboardingCommand(command, nextText);
  applyTrackedSkillLinks();
  copyButton.dataset.copyText = nextText;

  if (version === 'beta') {
    betaHighlights.hidden = false;
    betaHighlights.classList.remove('is-visible');
    window.requestAnimationFrame(() => {
      betaHighlights.classList.add('is-visible');
    });
  } else {
    betaHighlights.classList.remove('is-visible');
    betaHighlights.hidden = true;
  }

  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-version-tab]').forEach((button) => {
    const isActive = button.dataset.onboardingVersionTab === version;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
}

function setOpenMenu(nextOpenMenu: MenuName | null): void {
  document.querySelectorAll<HTMLElement>('[data-menu-shell]').forEach((shell) => {
    const menuName = shell.dataset.menuShell as MenuName | undefined;
    if (!menuName) {
      return;
    }

    const isOpen = menuName === nextOpenMenu;
    const trigger = shell.querySelector<HTMLButtonElement>(`[data-menu-trigger="${menuName}"]`);
    const menu = shell.querySelector<HTMLElement>(`[data-menu="${menuName}"]`);

    shell.dataset.open = String(isOpen);

    if (trigger) {
      trigger.setAttribute('aria-expanded', String(isOpen));
    }

    if (menu) {
      menu.hidden = !isOpen;
    }
  });
}

function isDocsPage(): boolean {
  return document.querySelector('[data-docs-root]') !== null;
}

function isApiPage(): boolean {
  return document.querySelector('[data-api-root]') !== null;
}

function isReleaseNotesPage(): boolean {
  return document.querySelector('[data-release-notes-root]') !== null;
}

function resolveDocsLocale(locale: SiteLocale): DocsLocale {
  switch (locale) {
    case 'zh':
    case 'zh-Hant':
      return 'zh';
    case 'ja':
      return 'ja';
    case 'ko':
      return 'ko';
    case 'id':
      return 'id';
    case 'th':
      return 'th';
    case 'en':
    default:
      return 'en';
  }
}

function updateDocsPage(locale: SiteLocale): void {
  const docsLocale = resolveDocsLocale(locale);
  const root = document.querySelector<HTMLElement>('[data-docs-root]');

  if (!root) {
    return;
  }

  root.dataset.docsLocale = docsLocale;
  setDocumentLang(locale);

  root.querySelectorAll<HTMLElement>('[data-docs-copy]').forEach((sectionCopy) => {
    const isActive = sectionCopy.dataset.docsCopy === docsLocale;
    sectionCopy.hidden = !isActive;

    sectionCopy.querySelectorAll<HTMLElement>('[data-docs-anchor]').forEach((anchor) => {
      const sectionID = anchor.dataset.docsAnchor;
      if (!sectionID) {
        return;
      }

      if (isActive) {
        anchor.id = sectionID;
        return;
      }

      anchor.removeAttribute('id');
    });
  });

  const activeCopy = root.querySelector<HTMLElement>('[data-docs-copy]:not([hidden])');
  if (activeCopy) {
    updateMetaElements(activeCopy.dataset.docsMetaTitle ?? '', activeCopy.dataset.docsMetaDescription ?? '');

    const backToTopButton = root.querySelector<HTMLButtonElement>('[data-docs-back-to-top]');
    if (backToTopButton && activeCopy.dataset.docsBackToTopLabel) {
      backToTopButton.setAttribute('aria-label', activeCopy.dataset.docsBackToTopLabel);
    }
  }
}

function updateApiPage(locale: SiteLocale): void {
  const root = document.querySelector<HTMLElement>('[data-api-root]');
  const copy = siteCopy[locale].apiPage;

  if (!root) {
    return;
  }

  root.dataset.apiLocale = locale;
  setDocumentLang(locale);
  updateMetaElements(copy.meta.title, copy.meta.description);

  document.querySelectorAll<HTMLElement>('[data-api-copy]').forEach((sectionCopy) => {
    const isActive = sectionCopy.dataset.apiCopy === locale;
    sectionCopy.hidden = !isActive;

    sectionCopy.querySelectorAll<HTMLElement>('[data-api-anchor]').forEach((anchor) => {
      const anchorId = anchor.dataset.apiAnchor;
      if (!anchorId) {
        return;
      }

      if (isActive) {
        anchor.id = anchorId;
        return;
      }

      anchor.removeAttribute('id');
    });
  });
}

function updateReleaseNotesPage(locale: SiteLocale): void {
  const root = document.querySelector<HTMLElement>('[data-release-notes-root]');
  const copy = siteCopy[locale].releaseNotesPage;

  if (!root) {
    return;
  }

  root.dataset.releaseNotesLocale = locale;
  setDocumentLang(locale);
  updateMetaElements(copy.meta.title, copy.meta.description);

  document.querySelectorAll<HTMLElement>('[data-release-notes-copy]').forEach((sectionCopy) => {
    sectionCopy.hidden = sectionCopy.dataset.releaseNotesCopy !== locale;
  });
}

function updateFaqSection(locale: SiteLocale): void {
  const root = document.querySelector<HTMLElement>('[data-faq-root]');

  if (!root) {
    return;
  }

  root.dataset.faqLocale = locale;
  document.querySelectorAll<HTMLElement>('[data-faq-copy]').forEach((sectionCopy) => {
    sectionCopy.hidden = sectionCopy.dataset.faqCopy !== locale;
  });
}

function applyLocale(locale: SiteLocale): void {
  const dictionary = siteCopy[locale];
  document.documentElement.dataset.locale = locale;

  if (isDocsPage()) {
    updateTranslations(dictionary);
    updateDocsPage(locale);
  } else if (isApiPage()) {
    updateTranslations(dictionary);
    updateApiPage(locale);
  } else if (isReleaseNotesPage()) {
    updateTranslations(dictionary);
    updateReleaseNotesPage(locale);
  } else {
    updateMeta(locale, dictionary);
    updateTranslations(dictionary);
  }

  updateFaqSection(locale);

  const command = document.querySelector<HTMLElement>('[data-onboarding-command]');
  if (command) {
    command.dataset.commandStable = rewriteSkillUrlsInText(dictionary.hero.onboardingCommandStable);
    command.dataset.commandBeta = rewriteSkillUrlsInText(dictionary.hero.onboardingCommandBeta);
  }

  applyTrackedSkillLinks();
  applyOnboardingVersion(currentOnboardingVersion());
  syncControlLabels(locale, currentThemePreference());

  const feedback = document.querySelector<HTMLElement>('[data-copy-feedback]');
  if (feedback) {
    feedback.textContent = '';
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }
}

function initMenuControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-menu-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const menuName = trigger.dataset.menuTrigger as MenuName | undefined;
      const shell = trigger.closest<HTMLElement>('[data-menu-shell]');

      if (!menuName || !shell) {
        return;
      }

      const isOpen = shell.dataset.open === 'true';
      setOpenMenu(isOpen ? null : menuName);
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('[data-menu="mobile"] a').forEach((link) => {
    link.addEventListener('click', () => {
      setOpenMenu(null);
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    const insideMenuShell = Array.from(
      document.querySelectorAll<HTMLElement>('[data-menu-shell]'),
    ).some((shell) => shell.contains(target));

    if (!insideMenuShell) {
      setOpenMenu(null);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpenMenu(null);
    }
  });
}

function initLocaleControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-set-locale]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextLocale = button.dataset.setLocale;
      if (!isSiteLocale(nextLocale)) {
        return;
      }

      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      } catch {
        // Ignore storage failures and still update the in-memory state.
      }

      applyLocale(nextLocale);
      setOpenMenu(null);
    });
  });
}

function initThemeControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-set-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPreference = button.dataset.setTheme;
      if (!isSiteThemePreference(nextPreference)) {
        return;
      }

      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
      } catch {
        // Ignore storage failures and still update the UI state.
      }

      applyTheme(resolveTheme(nextPreference), nextPreference, currentLocale());
      setOpenMenu(null);
    });
  });
}

function initSystemThemeListener(): void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onThemeChange = () => {
    if (currentThemePreference() !== 'system') {
      return;
    }

    applyTheme(getSystemTheme(), 'system', currentLocale());
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onThemeChange);
    return;
  }

  mediaQuery.addListener(onThemeChange);
}

function initCopyButton(): void {
  const copyButton = document.querySelector<HTMLButtonElement>('[data-copy-button]');
  const feedback = document.querySelector<HTMLElement>('[data-copy-feedback]');

  if (!copyButton || !feedback) {
    return;
  }

  copyButton.addEventListener('click', async () => {
    const dictionary = siteCopy[currentLocale()];
    const text = copyButton.dataset.copyText ?? '';

    if (!text) {
      return;
    }

    const didCopy = await copyText(text);
    copyButton.classList.add('is-copied');
    feedback.textContent = didCopy
      ? dictionary.copyFeedback.copied
      : dictionary.copyFeedback.copyFailed;

    window.setTimeout(() => {
      copyButton.classList.remove('is-copied');
      feedback.textContent = '';
    }, 1600);
  });
}

function initOnboardingVersionControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-onboarding-version-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextVersion = button.dataset.onboardingVersionTab;
      if (!isOnboardingVersion(nextVersion)) {
        return;
      }

      applyOnboardingVersion(nextVersion);
    });
  });

  applyOnboardingVersion('stable');
}

function normalizeDocsTocQuery(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function initDocsTocSearch(): void {
  const root = document.querySelector<HTMLElement>('[data-docs-root]');
  if (!root) {
    return;
  }

  function applyFilter(sectionCopy: HTMLElement): void {
    const input = sectionCopy.querySelector<HTMLInputElement>('[data-docs-toc-search]');
    const empty = sectionCopy.querySelector<HTMLElement>('[data-docs-toc-empty]');
    if (!input || !empty) {
      return;
    }

    const tokens = normalizeDocsTocQuery(input.value);
    const hasQuery = tokens.length > 0;
    let visibleGroups = 0;

    sectionCopy.querySelectorAll<HTMLDetailsElement>('[data-docs-toc-group]').forEach((group) => {
      const groupHaystack = (group.dataset.docsSearch ?? '').toLowerCase();
      const groupMatches = hasQuery && tokens.every((token) => groupHaystack.includes(token));
      let visibleSections = 0;

      group.querySelectorAll<HTMLElement>('[data-docs-toc-section]').forEach((section) => {
        const sectionHaystack = (section.dataset.docsSearch ?? '').toLowerCase();
        const sectionMatches = !hasQuery || groupMatches || tokens.every((token) => sectionHaystack.includes(token));
        section.hidden = !sectionMatches;
        if (sectionMatches) {
          visibleSections++;
        }
      });

      const showGroup = !hasQuery || groupMatches || visibleSections > 0;
      group.hidden = !showGroup;
      if (showGroup && hasQuery) {
        group.open = true;
      }
      if (showGroup) {
        visibleGroups++;
      }
    });

    empty.hidden = !hasQuery || visibleGroups > 0;
  }

  document.querySelectorAll<HTMLElement>('[data-docs-copy]').forEach((sectionCopy) => {
    const input = sectionCopy.querySelector<HTMLInputElement>('[data-docs-toc-search]');
    if (!input) {
      return;
    }

    input.addEventListener('input', () => applyFilter(sectionCopy));
    applyFilter(sectionCopy);
  });

  const mutation = new MutationObserver(() => {
    const activeCopy = root.querySelector<HTMLElement>('[data-docs-copy]:not([hidden])');
    if (activeCopy) {
      applyFilter(activeCopy);
    }
  });

  mutation.observe(root, {
    attributes: true,
    attributeFilter: ['data-docs-locale'],
  });
}

function initDocsScrollSpy(): void {
  const root = document.querySelector<HTMLElement>('[data-docs-root]');
  if (!root) {
    return;
  }

  let observer: IntersectionObserver | null = null;

  function setup(): void {
    if (observer) {
      observer.disconnect();
    }

    const activeCopy = root!.querySelector<HTMLElement>('[data-docs-copy]:not([hidden])');
    if (!activeCopy) {
      return;
    }

    const sections = Array.from(
      activeCopy.querySelectorAll<HTMLElement>('[data-docs-anchor]'),
    );

    if (sections.length === 0) {
      return;
    }

    const visibleSections = new Map<string, IntersectionObserverEntry>();

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.docsAnchor;
          if (!id) {
            continue;
          }

          if (entry.isIntersecting) {
            visibleSections.set(id, entry);
          } else {
            visibleSections.delete(id);
          }
        }

        let activeId: string | null = null;
        let minTop = Infinity;

        for (const [id, entry] of visibleSections) {
          if (entry.boundingClientRect.top < minTop) {
            minTop = entry.boundingClientRect.top;
            activeId = id;
          }
        }

        activeCopy!.querySelectorAll<HTMLAnchorElement>('.docs-toc-link').forEach((link) => {
          const isActive = link.getAttribute('href') === `#${activeId}`;
          link.classList.toggle('is-active', isActive);
        });
      },
      {
        rootMargin: '-80px 0px -35% 0px',
        threshold: 0,
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }
  }

  setup();

  const mutation = new MutationObserver(() => {
    setup();
  });

  mutation.observe(root, {
    attributes: true,
    attributeFilter: ['data-docs-locale'],
  });
}

function initDocsProgressBar(): void {
  const bar = document.querySelector<HTMLElement>('[data-docs-progress]');
  if (!bar) {
    return;
  }

  let ticking = false;

  function update(): void {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0;
    bar!.style.width = `${progress}%`;
    ticking = false;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
}

function initDocsBackToTop(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-docs-back-to-top]');
  if (!button) {
    return;
  }

  let ticking = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function update(): void {
    const shouldShow = window.scrollY > 400;

    if (shouldShow) {
      if (hideTimeout !== null) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      button!.hidden = false;
      window.requestAnimationFrame(() => {
        button!.classList.add('is-visible');
      });
    } else {
      button!.classList.remove('is-visible');
      hideTimeout = setTimeout(() => {
        button!.hidden = true;
        hideTimeout = null;
      }, 250);
    }

    ticking = false;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true },
  );

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function initDocsMobileToc(): void {
  const toggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-docs-toc-toggle]');
  if (toggleButtons.length === 0) {
    return;
  }

  toggleButtons.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const sidebar = toggle.closest<HTMLElement>('.docs-sidebar');
      if (!sidebar) {
        return;
      }

      sidebar.classList.toggle('is-toc-open');
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('.docs-toc-link').forEach((link) => {
    link.addEventListener('click', () => {
      const sidebar = link.closest<HTMLElement>('.docs-sidebar');
      if (sidebar) {
        sidebar.classList.remove('is-toc-open');
      }
    });
  });
}

function initApiScrollSpy(): void {
  const root = document.querySelector<HTMLElement>('[data-api-root]');
  if (!root) {
    return;
  }

  let observer: IntersectionObserver | null = null;

  function setup(): void {
    if (observer) {
      observer.disconnect();
    }

    const activeCopy = root!.querySelector<HTMLElement>('[data-api-copy]:not([hidden])');
    if (!activeCopy) {
      return;
    }

    const sections = Array.from(
      activeCopy.querySelectorAll<HTMLElement>('[data-api-anchor]'),
    );

    if (sections.length === 0) {
      return;
    }

    const visibleSections = new Map<string, IntersectionObserverEntry>();

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.apiAnchor;
          if (!id) {
            continue;
          }

          if (entry.isIntersecting) {
            visibleSections.set(id, entry);
          } else {
            visibleSections.delete(id);
          }
        }

        let activeId: string | null = null;
        let minTop = Infinity;

        for (const [id, entry] of visibleSections) {
          if (entry.boundingClientRect.top < minTop) {
            minTop = entry.boundingClientRect.top;
            activeId = id;
          }
        }

        activeCopy!.querySelectorAll<HTMLAnchorElement>('.api-toc-link').forEach((link) => {
          const isActive = link.getAttribute('href') === `#${activeId}`;
          link.classList.toggle('is-active', isActive);
        });
      },
      {
        rootMargin: '-80px 0px -35% 0px',
        threshold: 0,
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }
  }

  setup();

  const mutation = new MutationObserver(() => {
    setup();
  });

  mutation.observe(root, {
    attributes: true,
    attributeFilter: ['data-api-locale'],
  });
}

function initApiMobileToc(): void {
  const toggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-api-toc-toggle]');
  if (toggleButtons.length === 0) {
    return;
  }

  toggleButtons.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const sidebar = toggle.closest<HTMLElement>('.api-sidebar');
      if (!sidebar) {
        return;
      }

      sidebar.classList.toggle('is-toc-open');
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('.api-toc-link').forEach((link) => {
    link.addEventListener('click', () => {
      const sidebar = link.closest<HTMLElement>('.api-sidebar');
      if (sidebar) {
        sidebar.classList.remove('is-toc-open');
      }
    });
  });
}

function normalizeApiTocQuery(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function initApiTocSearch(): void {
  const root = document.querySelector<HTMLElement>('[data-api-root]');
  if (!root) {
    return;
  }

  function setGroupExpanded(group: HTMLElement, expanded: boolean): void {
    const toggle = group.querySelector<HTMLButtonElement>('[data-api-toc-group-toggle]');
    const sublist = group.querySelector<HTMLElement>('[data-api-toc-sublist]');
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    if (sublist) {
      sublist.hidden = !expanded;
    }
  }

  function applyFilter(sectionCopy: HTMLElement): void {
    const input = sectionCopy.querySelector<HTMLInputElement>('[data-api-toc-search]');
    const empty = sectionCopy.querySelector<HTMLElement>('[data-api-toc-empty]');
    if (!input || !empty) {
      return;
    }

    const tokens = normalizeApiTocQuery(input.value);
    const hasQuery = tokens.length > 0;
    let visibleGroups = 0;

    sectionCopy.querySelectorAll<HTMLElement>('[data-api-toc-static]').forEach((item) => {
      item.hidden = hasQuery;
    });

    sectionCopy.querySelectorAll<HTMLElement>('[data-api-toc-group]').forEach((group) => {
      const groupHaystack = (group.dataset.apiSearch ?? '').toLowerCase();
      const groupMatches = hasQuery && tokens.every((token) => groupHaystack.includes(token));
      let visibleEndpoints = 0;
      const toggle = group.querySelector<HTMLButtonElement>('[data-api-toc-group-toggle]');

      group.querySelectorAll<HTMLElement>('[data-api-toc-endpoint]').forEach((endpoint) => {
        const endpointHaystack = (endpoint.dataset.apiSearch ?? '').toLowerCase();
        const endpointMatches = !hasQuery || groupMatches || tokens.every((token) => endpointHaystack.includes(token));
        endpoint.hidden = !endpointMatches;
        if (endpointMatches) {
          visibleEndpoints++;
        }
      });

      const showGroup = !hasQuery || groupMatches || visibleEndpoints > 0;
      group.hidden = !showGroup;
      setGroupExpanded(group, showGroup && (!hasQuery || visibleEndpoints > 0));
      if (showGroup) {
        visibleGroups++;
      }
    });

    empty.hidden = !hasQuery || visibleGroups > 0;
  }

  document.querySelectorAll<HTMLElement>('[data-api-copy]').forEach((sectionCopy) => {
    const input = sectionCopy.querySelector<HTMLInputElement>('[data-api-toc-search]');
    if (!input) {
      return;
    }
    input.addEventListener('input', () => applyFilter(sectionCopy));
    applyFilter(sectionCopy);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-api-toc-group-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const group = toggle.closest<HTMLElement>('[data-api-toc-group]');
      const sectionCopy = toggle.closest<HTMLElement>('[data-api-copy]');
      const input = sectionCopy?.querySelector<HTMLInputElement>('[data-api-toc-search]');
      if (!group || (input && input.value.trim() !== '')) {
        return;
      }
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      setGroupExpanded(group, !expanded);
    });
  });

  const mutation = new MutationObserver(() => {
    const activeCopy = root.querySelector<HTMLElement>('[data-api-copy]:not([hidden])');
    if (activeCopy) {
      applyFilter(activeCopy);
    }
  });

  mutation.observe(root, {
    attributes: true,
    attributeFilter: ['data-api-locale'],
  });
}

type ApiTestField = {
  name: string;
  description: string;
  required: boolean;
};

type ApiTestEndpoint = {
  groupTitle: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  headers: ApiTestField[];
  queryParams: ApiTestField[];
  bodyFields: ApiTestField[];
};

type ApiTestModalElements = {
  modal: HTMLElement;
  form: HTMLFormElement;
  title: HTMLElement;
  method: HTMLElement;
  path: HTMLElement;
  baseUrl: HTMLInputElement;
  saveInfo: HTMLInputElement;
  pathFields: HTMLElement;
  headerFields: HTMLElement;
  queryFields: HTMLElement;
  bodyFields: HTMLElement;
  jsonWrap: HTMLElement;
  json: HTMLTextAreaElement;
  url: HTMLElement;
  response: HTMLElement;
  status: HTMLElement;
  output: HTMLElement;
  run: HTMLButtonElement;
};

type ApiTestSavedForm = {
  baseUrl: string;
  path: Record<string, string>;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, string>;
  json: string;
};

const API_TEST_STORAGE_PREFIX = 'mem9.apiTestForm.';
const API_TEST_SAVE_INFO_STORAGE_KEY = 'mem9.apiTestSaveInfo';
let activeApiTestEndpoint: ApiTestEndpoint | null = null;

function apiTestLabels(): SiteDictionary['apiPage']['labels'] {
  return siteCopy[currentLocale()].apiPage.labels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseApiTestField(value: unknown): ApiTestField | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  return {
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    required: value.required === true,
  };
}

function parseApiTestFields(value: unknown): ApiTestField[] {
  return Array.isArray(value)
    ? value.map(parseApiTestField).filter((field): field is ApiTestField => field !== null)
    : [];
}

function parseApiTestEndpoint(value: string | undefined): ApiTestEndpoint | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      typeof parsed.method !== 'string' ||
      typeof parsed.path !== 'string' ||
      typeof parsed.summary !== 'string'
    ) {
      return null;
    }

    return {
      groupTitle: typeof parsed.groupTitle === 'string' ? parsed.groupTitle : '',
      method: parsed.method.toUpperCase(),
      path: parsed.path,
      summary: parsed.summary,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      headers: parseApiTestFields(parsed.headers),
      queryParams: parseApiTestFields(parsed.queryParams),
      bodyFields: parseApiTestFields(parsed.bodyFields),
    };
  } catch {
    return null;
  }
}

function getApiTestModalElements(): ApiTestModalElements | null {
  const modal = document.querySelector<HTMLElement>('[data-api-test-modal]');
  const form = document.querySelector<HTMLFormElement>('[data-api-test-form]');
  const title = document.querySelector<HTMLElement>('[data-api-test-title]');
  const method = document.querySelector<HTMLElement>('[data-api-test-method]');
  const path = document.querySelector<HTMLElement>('[data-api-test-path]');
  const baseUrl = document.querySelector<HTMLInputElement>('[data-api-test-base-url]');
  const saveInfo = document.querySelector<HTMLInputElement>('[data-api-test-save-info]');
  const pathFields = document.querySelector<HTMLElement>('[data-api-test-path-fields]');
  const headerFields = document.querySelector<HTMLElement>('[data-api-test-header-fields]');
  const queryFields = document.querySelector<HTMLElement>('[data-api-test-query-fields]');
  const bodyFields = document.querySelector<HTMLElement>('[data-api-test-body-fields]');
  const jsonWrap = document.querySelector<HTMLElement>('[data-api-test-json-wrap]');
  const json = document.querySelector<HTMLTextAreaElement>('[data-api-test-json]');
  const url = document.querySelector<HTMLElement>('[data-api-test-url]');
  const response = document.querySelector<HTMLElement>('[data-api-test-response]');
  const status = document.querySelector<HTMLElement>('[data-api-test-status]');
  const output = document.querySelector<HTMLElement>('[data-api-test-output]');
  const run = document.querySelector<HTMLButtonElement>('[data-api-test-run]');

  if (
    !modal ||
    !form ||
    !title ||
    !method ||
    !path ||
    !baseUrl ||
    !saveInfo ||
    !pathFields ||
    !headerFields ||
    !queryFields ||
    !bodyFields ||
    !jsonWrap ||
    !json ||
    !url ||
    !response ||
    !status ||
    !output ||
    !run
  ) {
    return null;
  }

  return {
    modal,
    form,
    title,
    method,
    path,
    baseUrl,
    saveInfo,
    pathFields,
    headerFields,
    queryFields,
    bodyFields,
    jsonWrap,
    json,
    url,
    response,
    status,
    output,
    run,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightJson(value: string): string {
  return value.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, stringToken: string | undefined, colon: string | undefined, booleanToken: string | undefined) => {
      if (stringToken) {
        const className = colon ? 'api-json-key' : 'api-json-string';
        return `<span class="${className}">${escapeHtml(stringToken)}</span>${colon ?? ''}`;
      }

      if (booleanToken) {
        return `<span class="api-json-boolean">${match}</span>`;
      }

      if (match === 'null') {
        return '<span class="api-json-null">null</span>';
      }

      return `<span class="api-json-number">${match}</span>`;
    },
  );
}

function formatApiTestOutput(text: string): string {
  if (text.trim() === '') {
    return `<span class="api-json-null">(${escapeHtml(apiTestLabels().emptyResponse)})</span>`;
  }

  try {
    return highlightJson(JSON.stringify(JSON.parse(text) as unknown, null, 2));
  } catch {
    return escapeHtml(text);
  }
}

function apiTestInputValue(fieldName: string): unknown {
  const lowerName = fieldName.toLowerCase();

  if (lowerName.includes('limit')) {
    return 10;
  }

  if (lowerName.includes('offset')) {
    return 0;
  }

  if (lowerName.includes('scanall')) {
    return false;
  }

  if (lowerName.includes('tags') || lowerName.includes('ids') || lowerName.includes('nodes')) {
    return [];
  }

  if (lowerName.includes('metadata')) {
    return {};
  }

  if (lowerName.includes('messages')) {
    return [{ role: 'user', content: 'Hello mem9' }];
  }

  if (lowerName.includes('content')) {
    return 'Example memory content';
  }

  if (lowerName.includes('memory_type')) {
    return 'pinned';
  }

  if (lowerName.includes('app')) {
    return null;
  }

  return '';
}

function buildApiTestJsonTemplate(fields: ApiTestField[]): string {
  const body = fields.reduce<Record<string, unknown>>((current, field) => {
    current[field.name] = apiTestInputValue(field.name);
    return current;
  }, {});

  return JSON.stringify(body, null, 2);
}

function isApiTestMultipart(endpoint: ApiTestEndpoint): boolean {
  return endpoint.headers.some((field) => field.name.toLowerCase() === 'content-type' && field.description.toLowerCase().includes('multipart'));
}

function extractApiTestPathParams(path: string): ApiTestField[] {
  const labels = apiTestLabels();
  return Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => ({
    name: match[1] ?? '',
    description: labels.pathParameter,
    required: true,
  }));
}

function setApiTestSectionVisibility(container: HTMLElement, visible: boolean): void {
  const section = container.closest<HTMLElement>('[data-api-test-section]');
  if (section) {
    section.hidden = !visible;
  }
}

function createApiTestInput(container: HTMLElement, scope: string, field: ApiTestField, type = 'text'): HTMLInputElement {
  const label = document.createElement('label');
  label.className = 'api-test-control';

  const labelText = document.createElement('span');
  labelText.className = 'api-test-label-line';

  const labelName = document.createElement('span');
  labelName.className = 'api-test-label-name';
  labelName.textContent = field.name;
  labelText.append(labelName);

  if (field.required) {
    const labels = apiTestLabels();
    const requiredMark = document.createElement('span');
    requiredMark.className = 'api-test-required-mark';
    requiredMark.textContent = '*';
    requiredMark.setAttribute('aria-label', labels.required);
    labelText.append(requiredMark);
  }

  const input = document.createElement('input');
  input.type = type;
  input.autocomplete = 'off';
  input.dataset.apiTestScope = scope;
  input.dataset.apiTestName = field.name;
  if (field.required && type !== 'file') {
    input.required = true;
  }

  if (field.name.toLowerCase() === 'content-type') {
    input.value = field.description.toLowerCase().includes('multipart') ? 'multipart/form-data' : 'application/json';
  }

  label.append(labelText, input);

  if (field.description) {
    const help = document.createElement('p');
    help.className = 'api-test-help';
    help.textContent = field.description;
    label.append(help);
  }

  container.append(label);
  return input;
}

function renderApiTestFields(container: HTMLElement, scope: string, fields: ApiTestField[], multipart = false): void {
  container.replaceChildren();
  fields.forEach((field) => {
    const type = multipart && field.name.toLowerCase() === 'file' ? 'file' : 'text';
    createApiTestInput(container, scope, field, type);
  });
  setApiTestSectionVisibility(container, fields.length > 0);
}

function readApiTestTextInputs(scope: string): Array<{ name: string; value: string }> {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`[data-api-test-scope="${scope}"]`))
    .filter((input) => input.type !== 'file')
    .map((input) => ({
      name: input.dataset.apiTestName ?? '',
      value: input.value.trim(),
    }))
    .filter((entry) => entry.name !== '');
}

function apiTestStorageKey(endpoint: ApiTestEndpoint): string {
  return `${API_TEST_STORAGE_PREFIX}${encodeURIComponent(`${endpoint.method}:${endpoint.path}`)}`;
}

function readApiTestSaveInfoPreference(): boolean {
  try {
    return localStorage.getItem(API_TEST_SAVE_INFO_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeApiTestSaveInfoPreference(enabled: boolean): void {
  try {
    localStorage.setItem(API_TEST_SAVE_INFO_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

function isApiTestApiKeyName(name: string): boolean {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').includes('apikey');
}

function collectApiTestSavedInputs(scope: string): Record<string, string> {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`[data-api-test-scope="${scope}"]`))
    .filter((input) => input.type !== 'file')
    .reduce<Record<string, string>>((saved, input) => {
      const name = input.dataset.apiTestName ?? '';
      if (name === '' || isApiTestApiKeyName(name)) {
        return saved;
      }

      saved[name] = input.value;
      return saved;
    }, {});
}

function applyApiTestSavedInputs(scope: string, saved: Record<string, string>): void {
  document.querySelectorAll<HTMLInputElement>(`[data-api-test-scope="${scope}"]`).forEach((input) => {
    const name = input.dataset.apiTestName ?? '';
    if (name === '' || isApiTestApiKeyName(name) || !(name in saved)) {
      return;
    }

    input.value = saved[name] ?? '';
  });
}

function sanitizeApiTestJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeApiTestJsonValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.entries(value).reduce<Record<string, unknown>>((sanitized, [key, nestedValue]) => {
    if (!isApiTestApiKeyName(key)) {
      sanitized[key] = sanitizeApiTestJsonValue(nestedValue);
    }
    return sanitized;
  }, {});
}

function sanitizeApiTestJsonText(text: string): string {
  if (text.trim() === '') {
    return '';
  }

  try {
    return JSON.stringify(sanitizeApiTestJsonValue(JSON.parse(text) as unknown), null, 2);
  } catch {
    return '';
  }
}

function parseApiTestStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((record, [key, nestedValue]) => {
    if (typeof nestedValue === 'string' && !isApiTestApiKeyName(key)) {
      record[key] = nestedValue;
    }
    return record;
  }, {});
}

function readApiTestSavedForm(endpoint: ApiTestEndpoint): ApiTestSavedForm | null {
  try {
    const raw = localStorage.getItem(apiTestStorageKey(endpoint));
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      path: parseApiTestStringRecord(parsed.path),
      headers: parseApiTestStringRecord(parsed.headers),
      query: parseApiTestStringRecord(parsed.query),
      body: parseApiTestStringRecord(parsed.body),
      json: typeof parsed.json === 'string' ? sanitizeApiTestJsonText(parsed.json) : '',
    };
  } catch {
    return null;
  }
}

function collectApiTestSavedForm(elements: ApiTestModalElements): ApiTestSavedForm {
  return {
    baseUrl: elements.baseUrl.value,
    path: collectApiTestSavedInputs('path'),
    headers: collectApiTestSavedInputs('headers'),
    query: collectApiTestSavedInputs('query'),
    body: collectApiTestSavedInputs('body'),
    json: elements.jsonWrap.hidden ? '' : sanitizeApiTestJsonText(elements.json.value),
  };
}

function saveApiTestForm(elements: ApiTestModalElements): void {
  if (!activeApiTestEndpoint || !elements.saveInfo.checked) {
    return;
  }

  try {
    localStorage.setItem(
      apiTestStorageKey(activeApiTestEndpoint),
      JSON.stringify(collectApiTestSavedForm(elements)),
    );
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

function clearApiTestSavedForm(endpoint: ApiTestEndpoint): void {
  try {
    localStorage.removeItem(apiTestStorageKey(endpoint));
  } catch {
    // Ignore storage failures.
  }
}

function clearApiTestSavedForms(): void {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(API_TEST_STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Ignore storage failures.
  }
}

function restoreApiTestSavedForm(elements: ApiTestModalElements, endpoint: ApiTestEndpoint): void {
  if (!elements.saveInfo.checked) {
    return;
  }

  const saved = readApiTestSavedForm(endpoint);
  if (!saved) {
    return;
  }

  if (saved.baseUrl.trim() !== '') {
    elements.baseUrl.value = saved.baseUrl;
  }

  applyApiTestSavedInputs('path', saved.path);
  applyApiTestSavedInputs('headers', saved.headers);
  applyApiTestSavedInputs('query', saved.query);
  applyApiTestSavedInputs('body', saved.body);
  if (!elements.jsonWrap.hidden && saved.json.trim() !== '') {
    elements.json.value = saved.json;
  }
}

function buildApiTestUrl(elements: ApiTestModalElements, endpoint: ApiTestEndpoint): URL {
  const base = elements.baseUrl.value.trim().replace(/\/+$/u, '');
  const baseUrl = base === '' ? defaultApiTestBaseUrl() : base;
  const resolvedPath = endpoint.path.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-api-test-scope="path"]'))
      .find((candidate) => candidate.dataset.apiTestName === name);
    const value = input?.value.trim() ?? '';
    return value === '' ? match : encodeURIComponent(value);
  });
  const url = new URL(resolvedPath, `${baseUrl}/`);

  readApiTestTextInputs('query').forEach(({ name, value }) => {
    if (value !== '') {
      url.searchParams.append(name, value);
    }
  });

  return url;
}

function defaultApiTestBaseUrl(): string {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    ? 'http://localhost:8081'
    : 'https://api.mem9.ai';
}

function updateApiTestUrlPreview(elements: ApiTestModalElements): void {
  if (!activeApiTestEndpoint) {
    return;
  }

  try {
    elements.url.textContent = buildApiTestUrl(elements, activeApiTestEndpoint).toString();
  } catch (error) {
    elements.url.textContent = error instanceof Error ? error.message : String(error);
  }
}

function openApiTestModal(elements: ApiTestModalElements, endpoint: ApiTestEndpoint): void {
  const multipart = isApiTestMultipart(endpoint);
  const labels = apiTestLabels();
  activeApiTestEndpoint = endpoint;
  if (elements.baseUrl.value.trim() === '') {
    elements.baseUrl.value = defaultApiTestBaseUrl();
  }
  elements.title.textContent = endpoint.summary;
  elements.method.textContent = `${endpoint.method} · ${endpoint.groupTitle}`;
  elements.path.textContent = endpoint.path;
  elements.response.hidden = false;
  elements.status.textContent = labels.ready;
  elements.output.textContent = labels.responseReady;
  renderApiTestFields(elements.pathFields, 'path', extractApiTestPathParams(endpoint.path));
  renderApiTestFields(elements.headerFields, 'headers', endpoint.headers);
  renderApiTestFields(elements.queryFields, 'query', endpoint.queryParams);
  renderApiTestFields(elements.bodyFields, 'body', multipart ? endpoint.bodyFields : [], multipart);
  elements.jsonWrap.hidden = multipart || endpoint.bodyFields.length === 0;
  elements.json.value = multipart || endpoint.bodyFields.length === 0 ? '' : buildApiTestJsonTemplate(endpoint.bodyFields);
  setApiTestSectionVisibility(elements.bodyFields, endpoint.bodyFields.length > 0);
  restoreApiTestSavedForm(elements, endpoint);
  updateApiTestUrlPreview(elements);

  elements.modal.hidden = false;
  window.requestAnimationFrame(() => {
    elements.modal.classList.add('is-visible');
    elements.baseUrl.focus();
  });
}

function closeApiTestModal(elements: ApiTestModalElements): void {
  elements.modal.classList.remove('is-visible');
  window.setTimeout(() => {
    elements.modal.hidden = true;
  }, 180);
}

async function runApiTest(elements: ApiTestModalElements): Promise<void> {
  if (!activeApiTestEndpoint) {
    return;
  }

  const labels = apiTestLabels();
  const endpoint = activeApiTestEndpoint;
  const multipart = isApiTestMultipart(endpoint);
  const headers = new Headers();
  readApiTestTextInputs('headers').forEach(({ name, value }) => {
    if (value === '') {
      return;
    }
    if (multipart && name.toLowerCase() === 'content-type') {
      return;
    }
    headers.set(name, value);
  });

  let body: BodyInit | undefined;
  if (multipart) {
    const formData = new FormData();
    document.querySelectorAll<HTMLInputElement>('[data-api-test-scope="body"]').forEach((input) => {
      const name = input.dataset.apiTestName ?? '';
      if (name === '') {
        return;
      }
      if (input.type === 'file') {
        const file = input.files?.[0];
        if (file) {
          formData.append(name, file);
        }
        return;
      }
      if (input.value.trim() !== '') {
        formData.append(name, input.value.trim());
      }
    });
    body = formData;
  } else if (!elements.jsonWrap.hidden && elements.json.value.trim() !== '') {
    JSON.parse(elements.json.value) as unknown;
    body = elements.json.value;
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const url = buildApiTestUrl(elements, endpoint);
  const startedAt = performance.now();
  elements.run.disabled = true;
  elements.run.textContent = labels.running;
  elements.response.hidden = false;
  elements.status.textContent = labels.runningRequest;
  elements.output.textContent = '';

  try {
    const response = await fetch(url.toString(), {
      method: endpoint.method,
      headers,
      body: ['GET', 'HEAD'].includes(endpoint.method) ? undefined : body,
    });
    const elapsed = Math.round(performance.now() - startedAt);
    const text = await response.text();
    elements.status.textContent = `${response.status} ${response.statusText} · ${elapsed}ms`;
    elements.output.innerHTML = formatApiTestOutput(text);
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    elements.status.textContent = `${labels.requestFailed} · ${elapsed}ms`;
    elements.output.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    elements.run.disabled = false;
    elements.run.textContent = apiTestLabels().run;
  }
}

function initApiTestConsole(): void {
  const elements = getApiTestModalElements();
  if (!elements) {
    return;
  }

  elements.saveInfo.checked = readApiTestSaveInfoPreference();

  document.querySelectorAll<HTMLButtonElement>('[data-api-test-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const endpoint = parseApiTestEndpoint(button.dataset.apiTestEndpoint);
      if (endpoint) {
        openApiTestModal(elements, endpoint);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-api-test-close]').forEach((button) => {
    button.addEventListener('click', () => closeApiTestModal(elements));
  });

  const resetButton = document.querySelector<HTMLButtonElement>('[data-api-test-reset]');
  resetButton?.addEventListener('click', () => {
    if (activeApiTestEndpoint) {
      clearApiTestSavedForm(activeApiTestEndpoint);
      openApiTestModal(elements, activeApiTestEndpoint);
    }
  });

  elements.modal.addEventListener('click', (event) => {
    if (event.target === elements.modal) {
      closeApiTestModal(elements);
    }
  });

  elements.saveInfo.addEventListener('change', () => {
    writeApiTestSaveInfoPreference(elements.saveInfo.checked);
    if (elements.saveInfo.checked) {
      saveApiTestForm(elements);
      return;
    }

    clearApiTestSavedForms();
  });

  elements.form.addEventListener('input', () => {
    updateApiTestUrlPreview(elements);
    saveApiTestForm(elements);
  });
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    runApiTest(elements).catch((error: unknown) => {
      const labels = apiTestLabels();
      elements.response.hidden = false;
      elements.status.textContent = labels.requestFailed;
      elements.output.textContent = error instanceof Error ? error.message : String(error);
      elements.run.disabled = false;
      elements.run.textContent = labels.run;
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.modal.hidden) {
      closeApiTestModal(elements);
    }
  });
}

export function initSiteUI(): void {
  const locale = isSiteLocale(document.documentElement.dataset.locale)
    ? document.documentElement.dataset.locale
    : readPreferredLocale();
  const preference = isSiteThemePreference(document.documentElement.dataset.themePreference)
    ? document.documentElement.dataset.themePreference
    : readStoredThemePreference();
  const theme = isSiteResolvedTheme(document.documentElement.dataset.theme)
    ? document.documentElement.dataset.theme
    : resolveTheme(preference);

  applyTheme(theme, preference, locale);
  applyLocale(locale);
  initMenuControls();
  initLocaleControls();
  initThemeControls();
  initSystemThemeListener();
  initCopyButton();
  initOnboardingVersionControls();
  setOpenMenu(null);

  if (isDocsPage()) {
    initDocsTocSearch();
    initDocsScrollSpy();
    initDocsProgressBar();
    initDocsBackToTop();
    initDocsMobileToc();
  }

  if (isApiPage()) {
    initApiScrollSpy();
    initApiTocSearch();
    initApiMobileToc();
    initApiTestConsole();
  }
}
