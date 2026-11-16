CREATE TABLE integration_credentials (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  integration_key TEXT NOT NULL,
  integration_name TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (integration_key, field_key),
  CHECK (integration_key ~ '^[a-z0-9-]{1,60}$'),
  CHECK (field_key ~ '^[a-z0-9-]{1,60}$')
);

CREATE INDEX integration_credentials_name_idx
  ON integration_credentials (integration_key, field_key);
