// App-wide vault state: holds the single VaultService, tracks lock status, and
// locks IMMEDIATELY whenever the app leaves the foreground — so you must
// re-authenticate every time you return.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";
import { VaultService } from "../vault/VaultService";
import { ExpoStorage } from "../platform/expoStorage";
import { ExpoKeychain } from "../platform/expoKeychain";

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

  const lock = useCallback(() => {
    vault.lock();
    setUnlockedState(false);
  }, [vault]);

  const setUnlocked = useCallback((v: boolean) => setUnlockedState(v), []);

  // Lock the moment the app leaves the foreground (background OR the iOS/Android
  // app switcher 'inactive' state). Returning to the app always requires a
  // fresh unlock — the key is wiped from memory on every exit.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") lock();
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
