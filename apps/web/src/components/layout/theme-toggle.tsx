'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { authFetch } from '@/lib/auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  window.localStorage.setItem('eventai_theme', theme);
}

export function ThemeToggle() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<Theme>('light');
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('eventai_theme');
    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved);
      setTheme(saved);
      return;
    }

    const system: Theme = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    applyTheme(system);
    setTheme(system);
    if (user) {
      void authFetch('/users/me')
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { user?: { preferences?: { theme?: unknown } } };
          const savedTheme = body.user?.preferences?.theme;
          if (savedTheme === 'light' || savedTheme === 'dark') {
            applyTheme(savedTheme);
            setTheme(savedTheme);
          }
        })
        .catch(() => setSyncError(true));
    }
  }, [user]);

  async function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
    setSyncError(false);
    if (!user) return;

    try {
      const response = await authFetch('/users/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ preferences: { theme: next } }),
      });
      if (!response.ok) setSyncError(true);
    } catch {
      setSyncError(true);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        onClick={() => void toggleTheme()}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      {syncError && <span className="sr-only" role="status">Theme saved on this device but could not be synced to your account.</span>}
    </div>
  );
}
