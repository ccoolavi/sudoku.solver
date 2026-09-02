'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
    const swUrl = `${basePath}/sw.js`;

    navigator.serviceWorker
      .register(swUrl, { scope: `${basePath}/` })
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  return null;
}
