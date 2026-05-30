// App-wide vault state: holds the single VaultService, tracks lock status, and
// auto-locks when the app is backgrounded or after an idle timeout.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { VaultService } from "../vault/VaultService";
import { ExpoStorage } from "../platform/expoStorage";
import { ExpoKeychain } from "../platform/expoKeychain";

const AUTO_LOCK_MS = 2 * 60 * 1000; // lock 2 min after backgrounding

interface VaultCtx {
  vault: VaultService;
  unlocked: boolean;
  setUnlocked: (v: boolean) => void;
  lock: () => void;
}

const Ctx = createContext<VaultCtx | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const vault = useMemo(() => new VaultService(new ExpoStorage(), new ExpoKeychain()), []);
  const [unlocked, setUnlockedState] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const lock = useCallback(() => {
    vault.lock();
    setUnlockedState(false);
  }, [vault]);

  const setUnlocked = useCallback((v: boolean) => setUnlockedState(v), []);

  // Auto-lock: record when we go to background; lock if we return after timeout.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        backgroundedAt.current = Date.now();
      } else if (next === "active" && backgroundedAt.current) {
        if (Date.now() - backgroundedAt.current > AUTO_LOCK_MS) lock();
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [lock]);

  const value: VaultCtx = { vault, unlocked, setUnlocked, lock };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault(): VaultCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
