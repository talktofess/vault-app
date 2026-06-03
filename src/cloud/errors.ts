// Supabase errors come in two shapes: AuthError (a real Error subclass) and
// Postgrest/Storage errors (PLAIN OBJECTS like {message, code, hint, details}).
// A bare `e instanceof Error` check misses the plain-object ones and shows a
// useless "Failed." — so pull a real message out of whatever was thrown.
export function errorText(e: unknown, fallback = "Failed."): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const m = o.message ?? o.error_description ?? o.error ?? o.hint ?? o.details;
    if (typeof m === "string" && m) {
      const code = typeof o.code === "string" && o.code ? ` (${o.code})` : "";
      return m + code;
    }
    try {
      return JSON.stringify(o);
    } catch {
      /* fall through */
    }
  }
  return e ? String(e) : fallback;
}
