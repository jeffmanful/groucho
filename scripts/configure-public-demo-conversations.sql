-- Activate only after the backend with conversation_v1 support is deployed.
-- Changes project settings only; persona records and unrelated settings are preserved.
begin;

do $$
begin
  if (select count(*) from public.projects where
    (id = 'aecfc938-f1e5-4464-b8f4-e6f8c1a3b81f' and slug = 'loptimiste') or
    (id = 'dbf3afa8-ac2d-4fcc-822b-fe8b1ed50e17' and slug = 'saltings') or
    (id = 'fd51f412-8689-461d-b510-b8153bb237e7' and slug = 'lewisham-social')
  ) <> 3 then
    raise exception 'Expected all three public demo projects; no settings were changed';
  end if;
end $$;

update public.projects
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'conversation_engine', 'conversation_v1',
  'conversation_profile', slug,
  'application_experience', coalesce(settings->'application_experience', '{}'::jsonb) || jsonb_build_object(
    'max_turns', 8,
    'preferred_input_types', jsonb_build_array('text', 'singleSelect'),
    'opening_message', case slug
      when 'loptimiste' then 'Bonsoir. Is this for you, or for someone?'
      when 'saltings' then 'What are you working on, in a sentence you''d say out loud?'
      when 'lewisham-social' then 'Alright! What got you into us?'
    end,
    'closing_message', case slug
      when 'loptimiste' then 'Merci for spending a little time with me.'
      when 'saltings' then 'Thank you. Your note is here to read.'
      when 'lewisham-social' then 'Thanks for coming through the door.'
    end
  )
)
where id in (
  'aecfc938-f1e5-4464-b8f4-e6f8c1a3b81f',
  'dbf3afa8-ac2d-4fcc-822b-fe8b1ed50e17',
  'fd51f412-8689-461d-b510-b8153bb237e7'
)
returning id, slug, settings->>'conversation_engine' as conversation_engine,
  settings->>'conversation_profile' as conversation_profile, settings->>'persona_id' as persona_id;

commit;
