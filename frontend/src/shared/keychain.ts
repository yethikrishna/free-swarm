// OS-keychain bridge for provider API keys. Keys live in the OS keychain
// (Electron safeStorage) and are pushed into the backend's in-memory secret store
// on boot, so the live keys never have to persist in plaintext settings.json.
//
// Desktop-only: in the browser/web build window.freeswarm is absent and every
// function here no-ops, leaving the existing settings.json flow untouched.
import { API_BASE } from './config';

// The provider key fields the backend's secret_store.SECRET_FIELDS accepts.
export const KEYCHAIN_SECRET_FIELDS = [
  'anthropic_api_key',
  'openai_api_key',
  'google_api_key',
  'openrouter_api_key',
] as const;

export type KeychainSecretField = (typeof KEYCHAIN_SECRET_FIELDS)[number];

function api(): FreeSwarmAPI | undefined {
  return (window as any).freeswarm as FreeSwarmAPI | undefined;
}

// True when the running shell exposes keychain storage (desktop with safeStorage).
export function keychainAvailable(): boolean {
  const a = api();
  return !!(a && a.getSecret && a.setSecret);
}

// Write one key to the OS keychain (or delete it when value is empty).
export async function storeKeychainSecret(field: KeychainSecretField, value: string | null): Promise<void> {
  const a = api();
  if (!a?.setSecret || !a?.deleteSecret) return;
  try {
    if (value) await a.setSecret(field, value);
    else await a.deleteSecret(field);
  } catch {
    /* keychain write is best-effort; settings.json remains the fallback */
  }
}

// Read every provider key from the keychain.
async function readAllFromKeychain(): Promise<Record<string, string>> {
  const a = api();
  const out: Record<string, string> = {};
  if (!a?.getSecret) return out;
  for (const field of KEYCHAIN_SECRET_FIELDS) {
    try {
      const res = await a.getSecret(field);
      if (res?.ok && res.value) out[field] = res.value;
    } catch {
      /* skip unreadable entries */
    }
  }
  return out;
}

// Push a set of secrets into the backend's in-memory store.
async function pushToBackend(secrets: Record<string, string | null>): Promise<void> {
  try {
    await fetch(`${API_BASE}/settings/secrets/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secrets }),
    });
  } catch {
    /* backend may still be cold-starting; SettingsLoader retries on focus */
  }
}

// Boot: load keys from the keychain into the backend store. No-op without keychain.
export async function loadKeychainSecretsToBackend(): Promise<void> {
  if (!keychainAvailable()) return;
  const secrets = await readAllFromKeychain();
  if (Object.keys(secrets).length === 0) return;
  await pushToBackend(secrets);
}

// One-time migration: if settings.json still holds plaintext keys and the keychain
// doesn't, copy them into the keychain, push to the backend store, and return the
// field names that moved so the caller can blank them on disk via the next save.
export async function migrateSettingsKeysToKeychain(
  settings: Record<string, unknown>,
): Promise<KeychainSecretField[]> {
  if (!keychainAvailable()) return [];
  const existing = await readAllFromKeychain();
  const moved: KeychainSecretField[] = [];
  const toPush: Record<string, string | null> = {};
  for (const field of KEYCHAIN_SECRET_FIELDS) {
    const onDisk = settings[field];
    if (typeof onDisk === 'string' && onDisk && !existing[field]) {
      await storeKeychainSecret(field, onDisk);
      toPush[field] = onDisk;
      moved.push(field);
    }
  }
  if (Object.keys(toPush).length > 0) await pushToBackend(toPush);
  return moved;
}

// Save: mirror a changed key into the keychain and push it to the backend store.
export async function saveKeychainSecret(field: KeychainSecretField, value: string | null): Promise<void> {
  if (!keychainAvailable()) return;
  await storeKeychainSecret(field, value);
  await pushToBackend({ [field]: value });
}

// Which keychain-backed secrets the backend currently holds (for the UI presence UX).
export async function fetchSecretsPresent(): Promise<Record<string, boolean>> {
  try {
    const r = await fetch(`${API_BASE}/settings/secrets/present`);
    if (r.ok) return (await r.json()).present ?? {};
  } catch {
    /* backend cold or web build: caller shows the legacy field */
  }
  return {};
}
