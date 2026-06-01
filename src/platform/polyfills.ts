// Globals that @supabase/supabase-js expects but Hermes (the RN engine) doesn't
// ship. Imported once at the entry point, before Supabase loads. (Same class of
// gap as the missing TextDecoder that broke unlock — see src/crypto/b64.ts.)

// structuredClone: Supabase clones plain JSON-ish config/session objects. A
// JSON round-trip is sufficient for that usage and is a no-op when the engine
// already provides a real implementation.
if (typeof (globalThis as any).structuredClone !== "function") {
  (globalThis as any).structuredClone = <T>(v: T): T =>
    v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
