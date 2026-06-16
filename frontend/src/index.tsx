import React from 'react';
import { createRoot } from 'react-dom/client';
import Main from './app/Main';
import ErrorBoundary from './app/components/feedback/ErrorBoundary';
import { ensureAuthToken, IS_WEB } from './shared/config';
import { runStartupMigrations } from './shared/migrations';

// The hosted web build has no local backend or Electron bridge: render the
// account portal and skip the desktop bootstrap (local token + migrations).
async function bootstrap() {
  const root = document.getElementById('root')!;

  if (IS_WEB) {
    const { default: WebApp } = await import('./web/WebApp');
    createRoot(root).render(
      <ErrorBoundary scope="root">
        <WebApp />
      </ErrorBoundary>
    );
    return;
  }

  // Must run before ensureAuthToken reads localStorage; v1.0.31 migration force-clears auth+onboarding so the stale token doesn't survive.
  runStartupMigrations();

  // 3s timeout so a missing Electron bridge (plain-browser dev) doesn't hang; 401 in that case is intentional.
  try {
    await Promise.race([
      ensureAuthToken(),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
  } catch {}
  createRoot(root).render(
    <ErrorBoundary scope="root">
      <Main />
    </ErrorBoundary>
  );
}
bootstrap();
