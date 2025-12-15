import { useTheme } from '../hooks/useTheme';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme, currentThemeConfig } = useTheme();
  const isLight = theme === 'blueprint';

  return (
    <button
      onClick={toggleTheme}
      className="group relative flex items-center gap-2 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-all duration-300 border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] bg-[hsl(var(--bg-elevated))] hover:bg-[hsl(var(--bg-overlay))]"
      title={`Switch to ${isLight ? 'Terminal' : 'Blueprint'} theme`}
      aria-label={`Current theme: ${currentThemeConfig.name}. Click to switch.`}
    >
      {/* Icon container with rotation animation */}
      <div className="relative w-4 h-4 overflow-hidden">
        {/* Sun icon - visible in light mode */}
        <Sun
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? 'rotate-0 scale-100 text-[hsl(var(--amber))]'
              : 'rotate-90 scale-0 text-[hsl(var(--amber))]'
          }`}
        />
        {/* Moon icon - visible in dark mode */}
        <Moon
          className={`absolute inset-0 h-4 w-4 transition-all duration-300 ${
            isLight
              ? '-rotate-90 scale-0 text-[hsl(var(--cyan))]'
              : 'rotate-0 scale-100 text-[hsl(var(--cyan))]'
          }`}
        />
      </div>

      {/* Theme name */}
      <span className="text-[hsl(var(--text-secondary))] group-hover:text-[hsl(var(--text-primary))] transition-colors">
        {currentThemeConfig.name}
      </span>

      {/* Animated indicator bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isLight
              ? 'bg-[hsl(var(--amber))] translate-x-0'
              : 'bg-[hsl(var(--cyan))] translate-x-0'
          } group-hover:opacity-100 opacity-0`}
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
