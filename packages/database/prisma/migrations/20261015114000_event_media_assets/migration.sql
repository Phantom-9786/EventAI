-- CreateEventMediaAsset
-- Adds a dedicated table for tracking uploaded event-media assets and their
-- originating Cloudinary provider. Existing event image URLs stored in
-- events.cover_image and events.images remain untouched and continue to work
-- via URL-parsing fallback logic.

CREATE TABLE "event_media_assets" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "url" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'gallery',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_media_assets_event_id_idx" ON "event_media_assets"("event_id");
CREATE INDEX "event_media_assets_url_idx" ON "event_media_assets"("url");

ALTER TABLE "event_media_assets" ADD CONSTRAINT "event_media_assets_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
