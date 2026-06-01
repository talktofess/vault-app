// Opportunistic background sync: push new local items and pull remote changes,
// but only when cloud is configured AND signed in AND this device is linked.
// Returns null when any precondition is unmet, so callers can stay silent
// (e.g. running local-only, signed out, or offline).
import type { VaultService } from "../vault/VaultService";
import type { Supabase } from "./supabase";

export interface SyncResult {
  pushed: number;
  added: number;
  removed: number;
}

export async function syncIfLinked(
  vault: VaultService,
  cloud: Supabase | null
): Promise<SyncResult | null> {
  if (!cloud) return null;
  const uid = await cloud.auth.currentUserId();
  if (!uid) return null;
  if (!(await vault.cloudEnabled(cloud.store))) return null;
  const pushed = await vault.pushAll(cloud.store, uid);
  const { added, removed } = await vault.pull(cloud.store);
  return { pushed, added, removed };
}
