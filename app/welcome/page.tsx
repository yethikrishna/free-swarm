'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// First-launch landing page. The desktop app opens
// https://freeswarm.myndlabs.tech/welcome?app_install_id=<uuid> in the user's
// browser on first run (see electron/affiliateTracking.js). This page binds any
// referral code the user arrived with to that app_install_id via the cloud, so
// the desktop's /api/install/lookup poll can discover the attribution. The bind
// is best-effort: if no referral code is present or the cloud endpoint is
// unreachable, the page still renders a clean install confirmation rather than
// the bare 404 it used to.

const CLOUD_URL = 'https://api.freeswarm.myndlabs.tech';

function WelcomeInner() {
  const params = useSearchParams();
  const appInstallId = params.get('app_install_id');

  // 'idle' until we know whether there was anything to bind.
  const [bindState, setBindState] = useState<'idle' | 'bound' | 'skipped'>('idle');

  useEffect(() => {
    if (!appInstallId) {
      setBindState('skipped');
      return;
    }

    // Referral code can arrive on the URL (?ref=) or have been stashed in
    // localStorage by a prior referral-link visit. URL wins if both exist.
    let ref: string | null = params.get('ref');
    if (!ref) {
      try {
        ref = localStorage.getItem('freeswarm_ref');
      } catch {
        ref = null;
      }
    }

    if (!ref) {
      setBindState('skipped');
      return;
    }

    // Fire-and-forget bind. The desktop poll tolerates this failing, so we
    // never surface an error to the user; worst case the install just isn't
    // attributed to a referrer.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`${CLOUD_URL}/api/install/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_install_id: appInstallId, ref }),
      signal: controller.signal,
    })
      .then(() => setBindState('bound'))
      .catch(() => setBindState('skipped'))
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [appInstallId, params]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <a href="/" className="flex items-center gap-3">
            <img src="https://openswarm.info/logo.png" alt="FreeSwarm" className="w-8 h-8" />
            <span className="text-lg font-semibold text-gray-900">Free Swarm</span>
          </a>
        </div>
      </nav>

      {/* Confirmation */}
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-900 mb-8">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight">
            FreeSwarm is installed
          </h1>
          <p className="text-xl text-gray-600 mb-10 leading-relaxed">
            You&apos;re all set. FreeSwarm should already be opening on your machine.
            You can close this tab and head back to the app to start working with
            your agents.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 bg-gray-900 text-white px-8 py-4 rounded-lg hover:bg-gray-800 transition text-lg font-semibold"
            >
              Back to home
            </a>
            <a
              href="https://github.com/yethikrishna/free-swarm/blob/HEAD/GETTING_STARTED.md"
              className="inline-flex items-center justify-center gap-2 border border-gray-300 text-gray-900 px-8 py-4 rounded-lg hover:bg-gray-50 transition text-lg font-semibold"
            >
              Getting started
            </a>
          </div>

          {bindState === 'bound' && (
            <p className="text-sm text-gray-400 mt-8">Referral linked. Thanks for the support.</p>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-gray-400 text-sm">© 2026 Free Swarm. MIT License.</p>
        </div>
      </footer>
    </div>
  );
}

export default function Welcome() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <WelcomeInner />
    </Suspense>
  );
}
