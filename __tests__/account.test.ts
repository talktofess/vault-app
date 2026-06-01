import { describe, expect, it } from "vitest";
import { deriveAccount, ensureSignedIn } from "../src/cloud/account";
import type { CloudAuth } from "../src/cloud/ports";

describe("deriveAccount", () => {
  it("is deterministic for the same safe words", () => {
    const a = deriveAccount("correct horse battery staple");
    const b = deriveAccount("  correct horse battery staple  "); // trimmed + normalized
    expect(a).toEqual(b);
  });

  it("produces a valid-looking synthetic email and differs per input", () => {
    const a = deriveAccount("alpha bravo charlie delta");
    const b = deriveAccount("alpha bravo charlie echo");
    expect(a.email).toMatch(/^[0-9a-f]{32}@vaultsync\.app$/);
    expect(a.email).not.toBe(b.email);
    expect(a.password).not.toBe(b.password);
  });
});

describe("ensureSignedIn", () => {
  it("signs in directly when the account already exists", async () => {
    const calls: string[] = [];
    const auth: CloudAuth = {
      async signIn() {
        calls.push("signIn");
      },
      async signUp() {
        calls.push("signUp");
      },
      async signOut() {},
      async currentUserId() {
        return "u";
      },
    };
    await ensureSignedIn(auth, "some safe words here");
    expect(calls).toEqual(["signIn"]); // no signUp when sign-in works
  });

  it("creates the account on first use, then signs in", async () => {
    const calls: string[] = [];
    let exists = false;
    const auth: CloudAuth = {
      async signIn() {
        if (!exists) throw new Error("Invalid login credentials");
        calls.push("signIn");
      },
      async signUp() {
        exists = true;
        calls.push("signUp");
      },
      async signOut() {},
      async currentUserId() {
        return "u";
      },
    };
    await ensureSignedIn(auth, "some safe words here");
    expect(calls).toEqual(["signUp", "signIn"]);
  });
});
