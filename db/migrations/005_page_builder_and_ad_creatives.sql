CREATE TABLE site_page_layouts (
  layout_key TEXT PRIMARY KEY CHECK (layout_key IN ('home', 'article')),
  draft_config JSONB NOT NULL,
  published_config JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ad_creatives_campaign_status_idx ON ad_creatives (campaign_id, status, created_at DESC);

CREATE TABLE newsletter_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id BIGINT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('confirm', 'unsubscribe')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX newsletter_tokens_contact_idx ON newsletter_tokens (contact_id, purpose, expires_at DESC);
