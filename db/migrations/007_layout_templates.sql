CREATE TABLE site_layout_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  layout_key TEXT NOT NULL CHECK (layout_key IN ('home', 'article')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  config JSONB NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX site_layout_templates_name_idx
  ON site_layout_templates (layout_key, lower(name));
