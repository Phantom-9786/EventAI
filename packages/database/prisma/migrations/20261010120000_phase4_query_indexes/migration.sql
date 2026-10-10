-- Composite indexes matching the event browse, organizer event list, and booking expiry/list queries.
DROP INDEX IF EXISTS "events_organizer_id_idx";
CREATE INDEX "events_organizer_id_created_at_idx" ON "events"("organizer_id", "created_at");
CREATE INDEX "events_status_start_date_idx" ON "events"("status", "start_date");

DROP INDEX IF EXISTS "bookings_user_id_idx";
DROP INDEX IF EXISTS "bookings_status_idx";
DROP INDEX IF EXISTS "bookings_expires_at_idx";
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");
CREATE INDEX "bookings_status_expires_at_idx" ON "bookings"("status", "expires_at");