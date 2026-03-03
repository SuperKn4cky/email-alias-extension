type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'email-alias-theme';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function getSavedTheme(): ThemeMode | null {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : null;
}

function getSystemTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ThemeMode, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function setToggleCopy(button: HTMLButtonElement, currentTheme: ThemeMode): void {
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  const nextLabel = nextTheme === 'dark' ? 'Activer le mode sombre' : 'Activer le mode clair';
  button.setAttribute('aria-label', nextLabel);
  button.title = nextLabel;
}

export function initializeThemeToggle(button: HTMLButtonElement | null): void {
  const savedTheme = getSavedTheme();
  const initialTheme = savedTheme ?? getSystemTheme();
  applyTheme(initialTheme, false);

  if (!button) {
    return;
  }

  setToggleCopy(button, initialTheme);

  button.addEventListener('click', () => {
    const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const nextTheme: ThemeMode = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
    setToggleCopy(button, nextTheme);
  });

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const updateFromSystem = (event: MediaQueryListEvent): void => {
    if (getSavedTheme()) {
      return;
    }
    const systemTheme: ThemeMode = event.matches ? 'dark' : 'light';
    applyTheme(systemTheme, false);
    setToggleCopy(button, systemTheme);
  };

  if ('addEventListener' in mediaQuery) {
    mediaQuery.addEventListener('change', updateFromSystem);
  } else {
    mediaQuery.addListener(updateFromSystem);
  }
}
