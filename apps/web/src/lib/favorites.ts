'use client';

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'eventpoint_favorites_list';
const FAVORITES_CHANGED_EVENT = 'eventpoint:favorites-changed';

export function getFavoritesFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (id): id is string =>
                typeof id === 'string' && id.length > 0 && id.length < 150,
            ),
          ),
        ).slice(0, 500)
      : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteInStorage(eventId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const current = getFavoritesFromStorage();
    const exists = current.includes(eventId);
    const updated = exists
      ? current.filter((id) => id !== eventId)
      : [...current, eventId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(FAVORITES_CHANGED_EVENT, { detail: updated }));
    return !exists;
  } catch {
    return false;
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setFavorites(getFavoritesFromStorage());
    setMounted(true);

    const onFavoritesChange = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (customEvent.detail) {
        setFavorites(customEvent.detail);
      } else {
        setFavorites(getFavoritesFromStorage());
      }
    };

    window.addEventListener(FAVORITES_CHANGED_EVENT, onFavoritesChange);
    window.addEventListener('storage', onFavoritesChange);

    return () => {
      window.removeEventListener(FAVORITES_CHANGED_EVENT, onFavoritesChange);
      window.removeEventListener('storage', onFavoritesChange);
    };
  }, []);

  const toggle = useCallback((eventId: string) => {
    return toggleFavoriteInStorage(eventId);
  }, []);

  const isFav = useCallback(
    (eventId: string) => {
      return mounted ? favorites.includes(eventId) : false;
    },
    [favorites, mounted],
  );

  return {
    favorites,
    isFavorite: isFav,
    toggleFavorite: toggle,
    count: favorites.length,
    mounted,
  };
}
