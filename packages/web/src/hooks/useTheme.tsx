import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

export type Theme = 'terminal' | 'blueprint';

export interface ThemeConfig {
  id: Theme;
  name: string;
  icon: 'moon' | 'sun';
  description: string;
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'moon',
    description: 'Industrial dark mode',
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    icon: 'sun',
    description: 'Engineering light mode',
  },
];

const STORAGE_KEY = 'agent-containers-theme';

function getInitialTheme(): Theme {
  // Check localStorage first
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some(t => t.id === stored)) {
      return stored as Theme;
    }

    // Check system preference
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'blueprint';
    }
  }

  return 'terminal';
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  themes: ThemeConfig[];
  currentThemeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');

    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem(STORAGE_KEY);
      // Only auto-switch if user hasn't explicitly set a preference
      if (!stored) {
        setThemeState(e.matches ? 'blueprint' : 'terminal');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(current => current === 'terminal' ? 'blueprint' : 'terminal');
  }, []);

  const currentThemeConfig = THEMES.find(t => t.id === theme) || THEMES[0];

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
    themes: THEMES,
    currentThemeConfig,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
