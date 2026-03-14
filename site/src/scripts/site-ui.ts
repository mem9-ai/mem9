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

type MenuName = 'language' | 'theme';
type OnboardingVersion = 'stable' | 'beta';

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

function updateMeta(locale: SiteLocale, dictionary: SiteDictionary): void {
  document.documentElement.lang = localeToLang(locale);

  const titleElement = document.querySelector<HTMLTitleElement>('title');
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  const ogDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
  const title = textFor(dictionary, titleElement?.dataset.metaTitleKey ?? 'meta.title')
    || dictionary.meta.title;
  const descriptionText = textFor(
    dictionary,
    description?.dataset.metaDescriptionKey ?? 'meta.description',
  ) || dictionary.meta.description;

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

function updateTranslations(dictionary: SiteDictionary): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (!key) {
      return;
    }

    element.textContent = textFor(dictionary, key);
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

  command.textContent = nextText;
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

function applyLocale(locale: SiteLocale): void {
  const dictionary = siteCopy[locale];
  document.documentElement.dataset.locale = locale;
  updateMeta(locale, dictionary);
  updateTranslations(dictionary);
  const command = document.querySelector<HTMLElement>('[data-onboarding-command]');
  if (command) {
    command.dataset.commandStable = dictionary.hero.onboardingCommandStable;
    command.dataset.commandBeta = dictionary.hero.onboardingCommandBeta;
  }
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
}
