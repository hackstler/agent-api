-- Add name and surname columns to users (idempotent)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "surname" text;

-- Backfill: existing users with non-email usernames get:
--   1. Their old username copied to "name" (display name)
--   2. Their email set to username@example.com (valid email for login)
UPDATE "users"
SET name = email,
    email = email || '@example.com'
WHERE email IS NOT NULL
  AND email NOT LIKE '%@%';
