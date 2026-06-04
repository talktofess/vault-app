// App-wide vault state: holds the single VaultService, tracks lock status, and
// locks IMMEDIATELY whenever the app leaves the foreground — so you must
// re-authenticate every time you return.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { VaultService } from "../vault/VaultService";
import { ExpoStorage } from "../platform/expoStorage";
import { ExpoKeychain } from "../platform/expoKeychain";
import { createSupabase, type Supabase } from "../cloud/supabase";

interface VaultCtx {
  vault: VaultService;
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
  lock: () => void;
  // Run a function (a system file/photo picker, the camera, share sheet…)
  // WITHOUT the app auto-locking while it's in the foreground-elsewhere. Opening
  // a picker backgrounds the app, which would otherwise lock the vault and force
  // a re-login when you come back. Re-arms the auto-lock shortly after it returns.
  withoutAutoLock: <T>(fn: () => Promise<T>) => Promise<T>;
  // The Supabase handle, or null when cloud env vars aren't configured
  // (the app then runs purely local — every cloud UI affordance hides).
  cloud: Supabase | null;
}

const Ctx = createContext<VaultCtx | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const vault = useMemo(() => new VaultService(new ExpoStorage(), new ExpoKeychain()), []);
  const cloud = useMemo(() => createSupabase(), []);
  const [unlocked, setUnlockedState] = useState(false);

  const lock = useCallback(() => {
    vault.lock();
    setUnlockedState(false);
  }, [vault]);

  const setUnlocked = useCallback((v: boolean) => setUnlockedState(v), []);

  // When true, the auto-lock is paused — set while a system picker/camera is up.
  const suppressLock = useRef(false);
  const withoutAutoLock = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    suppressLock.current = true;
    try {
      return await fn();
    } finally {
      // keep it paused briefly so the return-to-foreground transition (which can
      // emit a late background/inactive event) settles before we re-arm.
      setTimeout(() => {
        suppressLock.current = false;
      }, 1200);
    }
  }, []);

  // Lock the moment the app leaves the foreground (background OR the iOS/Android
  // app switcher 'inactive' state) — UNLESS a picker is open (suppressLock).
  // Returning to the app otherwise requires a fresh unlock; the key is wiped
  // from memory on every real exit. On web the analog is the tab becoming hidden.
  useEffect(() => {
    if (Platform.OS === "web") {
      const onHide = () => {
        if (!suppressLock.current && typeof document !== "undefined" && document.visibilityState === "hidden") lock();
      };
      document.addEventListener("visibilitychange", onHide);
      return () => document.removeEventListener("visibilitychange", onHide);
    }
    const sub = AppState.addEventListener("change", (next) => {
      if (!suppressLock.current && (next === "background" || next === "inactive")) lock();
    });
    return () => sub.remove();
  }, [lock]);

  const value: VaultCtx = { vault, unlocked, setUnlocked, lock, withoutAutoLock, cloud };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault(): VaultCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
