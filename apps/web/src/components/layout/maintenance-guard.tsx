'use client';

import * as React from 'react';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ShieldAlert, Wrench, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { getPublicSystemControls, type SystemControlsSettings } from '@/lib/admin';

interface SystemControlsContextValue {
  controls: SystemControlsSettings | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const SystemControlsContext = createContext<SystemControlsContextValue>({
  controls: null,
  loading: false,
  reload: async () => {},
});

export function useSystemControls() {
  return useContext(SystemControlsContext);
}

export function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const [controls, setControls] = useState<SystemControlsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const pathname = usePathname();

  const loadControls = useCallback(async () => {
    try {
      const data = await getPublicSystemControls();
      setControls(data);
    } catch {
      // Safe fallback on network failure: do not lock users out
      setControls(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadControls();
    // Poll every 15 seconds to detect live maintenance toggles across clients
    const timer = setInterval(() => {
      void loadControls();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadControls]);

  const isAdmin = user?.role === 'ADMIN';
  const isAuthRecoveryPath =
    pathname === '/signin' ||
    pathname === '/auth/callback' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';

  // 1. If website maintenance is active:
  if (controls?.websiteMaintenance) {
    // If user is ADMIN, let them navigate, with a prominent maintenance banner
    if (isAdmin) {
      return (
        <SystemControlsContext.Provider value={{ controls, loading, reload: loadControls }}>
          <div className="bg-amber-500 text-amber-950 dark:bg-amber-500/20 dark:text-amber-200 border-b border-amber-600/30 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-between sticky top-0 z-50 shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Website Maintenance Mode is ACTIVE.</strong> Public visitors are blocked. You are viewing as Administrator.
              </span>
            </div>
            <Link
              href="/admin?tab=system-controls"
              className="inline-flex items-center gap-1 font-semibold underline hover:text-black dark:hover:text-white transition-colors ml-4 shrink-0"
            >
              System Controls <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {children}
        </SystemControlsContext.Provider>
      );
    }

    // If unauthenticated or non-admin visiting signin or password recovery, allow them to view the page to recover admin access
    if (isAuthRecoveryPath) {
      return (
        <SystemControlsContext.Provider value={{ controls, loading, reload: loadControls }}>
          <div className="bg-amber-500/10 text-amber-800 dark:text-amber-300 border-b border-amber-500/20 px-4 py-2 text-xs font-medium text-center">
            Website Maintenance is active. Administrator authentication and password recovery are available for system recovery.
          </div>
          {children}
        </SystemControlsContext.Provider>
      );
    }

    // Public / non-admin visitors see the dedicated, responsive Maintenance Screen
    return (
      <SystemControlsContext.Provider value={{ controls, loading, reload: loadControls }}>
        <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-16 text-center select-none">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-inner mb-6 animate-pulse">
            <Wrench className="h-10 w-10" />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 mb-4">
            <ShieldAlert className="h-3.5 w-3.5" />
            System Maintenance
          </span>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground max-w-xl">
            EventPoint is Under Maintenance
          </h1>

          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-md leading-relaxed">
            {controls.websiteMaintenanceMessage ||
              'EventPoint is temporarily undergoing maintenance. Please check back soon.'}
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              onClick={() => void loadControls()}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all active:scale-[0.98]"
            >
              Check Again
            </button>
            <Link
              href="/signin"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ShieldCheck className="h-4 w-4 text-primary" />
              Administrator Access
            </Link>
          </div>

          <p className="mt-12 text-xs text-muted-foreground/60">
            Expected return shortly. Existing bookings and tickets remain safe.
          </p>
        </div>
      </SystemControlsContext.Provider>
    );
  }

  // 2. Normal rendering
  return (
    <SystemControlsContext.Provider value={{ controls, loading, reload: loadControls }}>
      {children}
    </SystemControlsContext.Provider>
  );
}
