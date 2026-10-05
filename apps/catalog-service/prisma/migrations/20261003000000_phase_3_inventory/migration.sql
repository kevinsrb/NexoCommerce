-- Existing inventory is unreserved inventory. Rename preserves every existing quantity.
ALTER TABLE "ProductVariant" RENAME COLUMN "stock" TO "onHand";
-- statement
ALTER TABLE "ProductVariant" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;
-- statement
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_inventory_check"
  CHECK ("onHand" >= "reserved" AND "reserved" >= 0);
-- statement
CREATE TYPE "ReservationState" AS ENUM ('ACTIVE', 'PUBLISHED', 'RELEASED', 'EXPIRED');
-- statement
CREATE TABLE "StockReservation" (
  "id" UUID PRIMARY KEY,
  "attemptId" UUID NOT NULL UNIQUE,
  "requestHash" TEXT NOT NULL,
  "state" "ReservationState" NOT NULL DEFAULT 'ACTIVE',
  "reservedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "boundOrderId" UUID UNIQUE,
  "publicationRevision" INTEGER,
  "publishedAt" TIMESTAMPTZ(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "StockReservation_publication_check" CHECK (
    ("boundOrderId" IS NULL AND "publicationRevision" IS NULL AND "publishedAt" IS NULL AND "state" <> 'PUBLISHED') OR
    ("boundOrderId" IS NOT NULL AND "publicationRevision" IS NOT NULL AND "publicationRevision" > 0 AND "publishedAt" IS NOT NULL AND "state" <> 'ACTIVE')
  )
);
-- statement
CREATE INDEX "StockReservation_state_expiresAt_idx" ON "StockReservation" ("state", "expiresAt");
-- statement
CREATE TABLE "ReservationLine" (
  "reservationId" UUID NOT NULL REFERENCES "StockReservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "variantId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "unitPrice" DECIMAL(18,2) NOT NULL CHECK ("unitPrice" >= 0),
  "currency" VARCHAR(3) NOT NULL,
  PRIMARY KEY ("reservationId", "variantId")
);
-- statement
CREATE INDEX "ReservationLine_variantId_idx" ON "ReservationLine" ("variantId");
-- statement
CREATE TABLE "ReservationExpiryEvent" (
  "id" UUID PRIMARY KEY,
  "reservationId" UUID NOT NULL UNIQUE REFERENCES "StockReservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "attemptId" UUID NOT NULL,
  "boundOrderId" UUID,
  "publicationRevision" INTEGER,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL
);
-- statement
-- Deleting a product cascades through this trigger too. Terminal snapshots keep
-- their old variant IDs without preventing later Catalog replacement/deletion.
CREATE FUNCTION protect_reserved_variant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."reserved" > 0 OR EXISTS (
    SELECT 1 FROM "ReservationLine" l JOIN "StockReservation" r ON r.id = l."reservationId"
    WHERE l."variantId" = OLD.id AND r.state IN ('ACTIVE', 'PUBLISHED')
  ) THEN
    RAISE EXCEPTION 'Variant has nonterminal reservations' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
-- statement
CREATE TRIGGER "ProductVariant_protect_reservations" BEFORE DELETE ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION protect_reserved_variant();
