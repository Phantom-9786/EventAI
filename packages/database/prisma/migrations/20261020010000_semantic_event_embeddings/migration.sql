CREATE TABLE "event_semantic_embeddings" (
  "event_id" TEXT NOT NULL PRIMARY KEY REFERENCES "events"("id") ON DELETE CASCADE,
  "model" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "source_updated_at" TIMESTAMP(3) NOT NULL,
  "embedding" DOUBLE PRECISION[] NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_semantic_embedding_dimensions" CHECK (cardinality("embedding") = 384)
);
