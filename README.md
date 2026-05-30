# Vault

A personal, offline, on-device encrypted vault for your phone. Store photos,
videos, secure notes / JSON, and any files — all **AES-256-GCM encrypted at
rest**, unlocked by a master password or biometrics. Everything stays on your
device; there is no server and no account.

Built with **Expo (React Native)** so it runs on your own iPhone or Android via
the free **Expo Go** app — no app store, no Apple developer account.

## Run it on your phone
```bash
cd vault-app
npm install
npx expo start
```
Install **Expo Go** from the App Store / Play Store, then scan the QR code shown
in the terminal. The app opens on your phone.

> First launch → set a master password. After that, unlock with the password or
> (once enabled in Settings) Face ID / fingerprint.

> Note: `npx expo start` runs the app *through your computer* (it's the dev
> server). Great for trying it out; for permanent, untethered use build a
> standalone app — see below.

## Install permanently (standalone Android APK)
Builds run in Expo's cloud (EAS) and need a **free Expo account**. The build
config is already set up (`eas.json`, Android package `com.talktofess.vault`).

```bash
npm install -g eas-cli      # one-time
eas login                   # sign in / create a free account
eas init                    # links this project to your account (adds a projectId)
eas build --platform android --profile preview
```
When it finishes (~10–15 min) the terminal prints a URL to **download the APK**.
Open that link on your Android phone and install it (you'll allow "install from
unknown sources" once). The app then lives on your phone with no computer needed.

- **`preview`** profile → a directly-installable **APK** (sideload). Best for
  personal use.
- **`production`** profile → also an APK here, with auto-incrementing version.
- iOS standalone needs an Apple Developer account (`eas build --platform ios`);
  Android APK has no such requirement.

> The vault's data never leaves the device regardless of how it's installed —
> EAS only builds the app binary, not your vault contents.

## What it stores
- **Media** — import photos/videos from your library, browse an encrypted
  gallery, view in-app (decrypted to a temp file that's wiped on close).
- **Notes** — encrypted text notes, with a **JSON mode** that validates on save.
- **Files** — import any document; **export** it back out via the share sheet.
- **Backup** — export the whole vault as a single encrypted file (separate
  backup password) and restore it on a fresh install.

## How the encryption works
```
master password ──PBKDF2-SHA256 (150k iters, random salt)──▶ master key (never stored)
master key ──wraps──▶ DEK (random 256-bit data key)
DEK ──AES-256-GCM, unique nonce per item──▶ every photo, note, and file
```
- **Envelope encryption:** the password derives a key that *wraps* a random DEK.
  Changing your password only re-wraps the DEK — no re-encrypting your data.
- **Biometric unlock** stores the DEK in the OS hardware keychain
  (`expo-secure-store`), released only after a Face ID / fingerprint prompt.
- **Authenticated encryption (GCM):** tampered data fails to decrypt.
- **Item names are encrypted too** — the on-disk index is itself a sealed blob.

## Threat model — read this
**Protects against:**
- A **lost or stolen device** (locked / powered off) — contents are ciphertext.
- **Other apps / casual snooping** — data is in the app's private sandbox, encrypted.
- **Cloud/device backups** — they capture only ciphertext.

**Does NOT protect against:**
- A **determined attacker with your unlocked phone** (the key is in memory while unlocked).
- A **rooted / jailbroken / malware-infected** device — the OS sandbox is the foundation.
- **A forgotten password** — there is **no recovery backdoor**. Your encrypted
  backup is the only safety net. Keep one.
- Screen recording / OS-level keyloggers (out of scope for an app).

This is real, honest security for a phone *you* control — not a claim of
defeating forensic extraction.

## What's verified vs. what runs on-device
- **Verified here (desktop, `npm test`):** the security core — AES-GCM
  round-trip / wrong-key / tamper detection / unique nonce, KDF, and the full
  VaultService (create, unlock, wrong-password rejection, CRUD round-trip,
  persistence across restart, *item names absent from plaintext on disk*,
  password-change re-wrap, biometric keychain unlock, backup export→restore).
  **20 tests.**
- **Runs on-device only:** camera-roll import, biometric prompt, the share
  sheet, and the gallery UI — these use native modules and light up in Expo Go.

The security-critical logic has **zero Expo imports** (it talks to `Storage` and
`Keychain` interfaces), which is exactly why it's testable off-device.

## Layout
```
src/crypto/    b64 · random · kdf · cipher (AES-GCM)        ← primitives (@noble)
src/vault/     VaultService · types · ports · memoryPorts    ← the core (tested)
src/platform/  expoStorage · expoKeychain                    ← device adapters
src/state/     VaultContext (lock state + auto-lock)
src/ui/        theme · components
app/           onboarding · unlock · (vault)/{media,notes,files,settings}
__tests__/     crypto + vault suites
```

## Notes / next steps
- Inline video playback needs `expo-av` (the viewer currently decrypts the video
  to a temp file and notes this); images play inline already.
- The file-backed backup import is stubbed in the UI (the core `importVault` is
  implemented and tested) — wiring the picker → `importVault` is the next step.
