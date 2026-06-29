// Turn an arbitrary error / backend message into calm, user-facing copy. The app
// ships to non-developers, so raw exceptions, stack traces, and jargon must never
// reach the screen (see frontend/CLAUDE.md). Always logs the raw value to console
// for devs, then returns a short friendly line. Recognizes a few common shapes
// (timeout, network, validation) and otherwise falls back to the provided default.
export function friendlyError(raw: unknown, fallback = "Something went wrong. Please try again."): string {
  try {
    // eslint-disable-next-line no-console
    console.error("[friendlyError]", raw);
  } catch { /* never let logging throw */ }

  const msg = (() => {
    if (raw == null) return "";
    if (typeof raw === "string") return raw;
    if (raw instanceof Error) return raw.message;
    if (typeof raw === "object" && "message" in (raw as any)) return String((raw as any).message ?? "");
    return String(raw);
  })().toLowerCase();

  if (!msg) return fallback;
  if (msg.includes("timed out") || msg.includes("timeout")) return "That took too long and was stopped. Try again.";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network error") || msg.includes("econnrefused")) {
    return "Couldn't reach the app's backend. Check your connection and try again.";
  }
  if (msg.includes("required property") || msg.includes("validation") || msg.includes("is not of type")) {
    return "Some inputs need fixing before this can run.";
  }
  return fallback;
}
