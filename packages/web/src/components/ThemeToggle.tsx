import { useTheme } from '../hooks/useTheme';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'blueprint';

  return (
    <button
      onClick={toggleTheme}
      className="relative p-2 transition-all duration-200 border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] bg-[hsl(var(--bg-elevated))] hover:bg-[hsl(var(--bg-overlay))]"
      title={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      aria-label="Toggle theme"
    >
      <div className="relative w-4 h-4">
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? 'rotate-0 scale-100 text-[hsl(var(--amber))]'
              : 'rotate-90 scale-0 text-[hsl(var(--amber))]'
          }`}
        />
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? '-rotate-90 scale-0 text-[hsl(var(--cyan))]'
              : 'rotate-0 scale-100 text-[hsl(var(--cyan))]'
          }`}
        />
      </div>
    </button>
  );
}

// Compact version for tight spaces
export function ThemeToggleCompact() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'blueprint';

  return (
    <button
      onClick={toggleTheme}
      className="relative p-1.5 transition-all duration-200 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
      title={`Switch to ${isLight ? 'dark' : 'light'} mode`}
      aria-label="Toggle theme"
    >
      <div className="relative w-4 h-4">
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? 'rotate-0 scale-100 text-[hsl(var(--amber))]'
              : 'rotate-90 scale-0'
          }`}
        />
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? '-rotate-90 scale-0'
              : 'rotate-0 scale-100 text-[hsl(var(--cyan))]'
          }`}
        />
      </div>
    </button>
  );
}
