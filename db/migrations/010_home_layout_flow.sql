UPDATE site_page_layouts
SET draft_config = jsonb_set(
      draft_config,
      '{modules}',
      (
        SELECT jsonb_agg(
          CASE module->>'id'
            WHEN 'home-ad-top' THEN jsonb_set(module, '{order}', '5'::jsonb)
            WHEN 'home-video' THEN jsonb_set(module, '{order}', '60'::jsonb)
            ELSE module
          END
          ORDER BY CASE module->>'id'
            WHEN 'home-ad-top' THEN 5
            WHEN 'home-breaking' THEN 10
            WHEN 'home-hero' THEN 20
            WHEN 'home-briefing' THEN 30
            WHEN 'home-latest' THEN 40
            WHEN 'home-live' THEN 50
            WHEN 'home-video' THEN 60
            WHEN 'home-ad-rail' THEN 70
            WHEN 'home-popular' THEN 80
            WHEN 'home-newsletter' THEN 100
            ELSE COALESCE((module->>'order')::integer, 0)
          END
        )
        FROM jsonb_array_elements(COALESCE(draft_config->'modules', '[]'::jsonb)) AS item(module)
      )
    ),
    published_config = jsonb_set(
      published_config,
      '{modules}',
      (
        SELECT jsonb_agg(
          CASE module->>'id'
            WHEN 'home-ad-top' THEN jsonb_set(module, '{order}', '5'::jsonb)
            WHEN 'home-video' THEN jsonb_set(module, '{order}', '60'::jsonb)
            ELSE module
          END
          ORDER BY CASE module->>'id'
            WHEN 'home-ad-top' THEN 5
            WHEN 'home-breaking' THEN 10
            WHEN 'home-hero' THEN 20
            WHEN 'home-briefing' THEN 30
            WHEN 'home-latest' THEN 40
            WHEN 'home-live' THEN 50
            WHEN 'home-video' THEN 60
            WHEN 'home-ad-rail' THEN 70
            WHEN 'home-popular' THEN 80
            WHEN 'home-newsletter' THEN 100
            ELSE COALESCE((module->>'order')::integer, 0)
          END
        )
        FROM jsonb_array_elements(COALESCE(published_config->'modules', '[]'::jsonb)) AS item(module)
      )
    )
WHERE layout_key = 'home'
  AND draft_config ? 'modules'
  AND published_config ? 'modules';
