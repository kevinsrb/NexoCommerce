-- Initial Orders schema: Phase 1 supplied a Prisma shell but no deployed migration.
CREATE TYPE "CheckoutAttemptState" AS ENUM ('CLAIMED', 'CART_CLAIMED', 'PREPARED', 'RESERVATION_PENDING', 'ORDER_RECORDING', 'RESERVATION_BOUND', 'ORDER_PENDING', 'COMPLETE', 'FAILED');
-- statement
CREATE TYPE "OrderRecordState" AS ENUM ('RECORDING', 'PENDING', 'EXPIRED', 'CANCELLED');
-- statement
CREATE TABLE checkout_attempts (
  id UUID PRIMARY KEY,
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_prices JSONB NOT NULL,
  request_id TEXT NOT NULL,
  cart_lines JSONB,
  failure JSONB,
  lease_owner UUID,
  lease_until TIMESTAMP(3),
  recover_after TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cart_version BIGINT,
  cart_claim_ref TEXT,
  prepared_lines JSONB,
  state "CheckoutAttemptState" NOT NULL DEFAULT 'CLAIMED',
  saga_version INTEGER NOT NULL DEFAULT 0,
  reservation_ref TEXT,
  failure_code TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT checkout_attempt_version_nonnegative CHECK (cart_version IS NULL OR cart_version >= 0)
);
-- statement
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  checkout_attempt_id UUID NOT NULL,
  principal_id TEXT NOT NULL,
  cart_version BIGINT NOT NULL,
  state "OrderRecordState" NOT NULL DEFAULT 'RECORDING',
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_decimal VARCHAR(100) NOT NULL CHECK (total_decimal ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  expires_at TIMESTAMP(3) NOT NULL,
  catalog_publication_revision BIGINT,
  published_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT orders_publication_required CHECK (state != 'PENDING' OR (catalog_publication_revision IS NOT NULL AND catalog_publication_revision > 0 AND published_at IS NOT NULL)),
  CONSTRAINT orders_checkout_attempt_id_fkey FOREIGN KEY (checkout_attempt_id) REFERENCES checkout_attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
-- statement
CREATE TABLE order_lines (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  variant_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_decimal VARCHAR(100) NOT NULL CHECK (unit_price_decimal ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  line_total_decimal VARCHAR(100) NOT NULL CHECK (line_total_decimal ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  variant_snapshot JSONB NOT NULL,
  CONSTRAINT order_lines_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
-- statement
CREATE TABLE outbox (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMP(3)
);
-- statement
CREATE INDEX checkout_attempts_state_recover_after_idx ON checkout_attempts(state, recover_after);
-- statement
CREATE UNIQUE INDEX checkout_attempts_principal_id_idempotency_key_key ON checkout_attempts(principal_id, idempotency_key);
-- statement
CREATE UNIQUE INDEX orders_checkout_attempt_id_key ON orders(checkout_attempt_id);
-- statement
-- An unpublished expiry releases the Cart claim without consuming its version.
-- Keep all accepted orders unique forever, but permit reconfirming that cart.
CREATE UNIQUE INDEX orders_principal_id_cart_version_key ON orders(principal_id, cart_version)
  WHERE state <> 'EXPIRED' OR catalog_publication_revision IS NOT NULL;
-- statement
CREATE INDEX order_lines_order_id_idx ON order_lines(order_id);
-- statement
CREATE INDEX outbox_completed_at_available_at_idx ON outbox(completed_at, available_at);
