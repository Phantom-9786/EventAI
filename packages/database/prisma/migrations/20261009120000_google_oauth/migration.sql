-- Google OAuth 2.0 support:
-- 1. passwordHash becomes nullable so accounts created via Google
--    ("Sign in with Google" only, no local password) can be stored.
-- 2. googleId stores Google's immutable subject ("sub") for linked accounts.

ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "google_id" TEXT;
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
