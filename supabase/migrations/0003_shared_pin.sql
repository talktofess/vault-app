-- Shared device PIN: the 4-digit unlock PIN, encrypted under the safe-words KEK
-- (GCM), so every device adopts the SAME PIN instead of choosing its own. Only
-- ciphertext is stored; cracking it still requires the safe words. Idempotent.
alter table public.vault_keys add column if not exists wrapped_pin text;
