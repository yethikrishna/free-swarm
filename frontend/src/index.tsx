import React from 'react';
import { createRoot } from 'react-dom/client';
import Main from './app/Main';
import ErrorBoundary from './app/components/feedback/ErrorBoundary';
import { ensureAuthToken, IS_WEB } from './shared/config';
import { runStartupMigrations } from './shared/migrations';

// Route /account to the web account portal (sign-in, plan info, OAuth landing).
// All other paths render the canvas app; on the web this shows the UI in
// "connecting" state since there is no local backend.
async function bootstrap() {
  const root = document.getElementById('root')!;
  const path = window.location.pathname;
  const isAccountPath = path === '/account' || path.startsWith('/account/');

  if (isAccountPath) {
    const { default: WebApp } = await import('./web/WebApp');
    createRoot(root).render(
      <ErrorBoundary scope="root">
        <WebApp />
      </ErrorBoundary>
    );
    return;
  }

  // Must run before ensureAuthToken reads localStorage; v1.0.31 migration force-clears auth+onboarding so the stale token doesn't survive.
  if (!IS_WEB) runStartupMigrations();

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
