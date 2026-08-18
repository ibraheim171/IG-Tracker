-- ============================================================================
-- 0005_seed.sql — fixed lists. Colours are lifted from the existing dashboard so
-- the platform and the old portal read identically during the overlap.
-- ============================================================================

insert into tracks (id, slug, name, color_hex, sort_order) values
  (1, 'basira',  'على بصيرة',           '#1E8F8B', 1),   -- فيروزي
  (2, 'nabd',    'نبض المسرى',          '#96181D', 2),   -- قرمزي
  (3, 'bawsala', 'بوصلة الوعي',         '#6F8B4E', 3),   -- زيتوني
  (4, 'huna',    'هنا مرّوا كما دخلوه', '#A87433', 4)    -- عسلي
on conflict (id) do nothing;

insert into idea_types (name) values
  ('كاروسيل'), ('فيديو'), ('صورة'), ('أخرى')
on conflict (name) do nothing;

-- Aliases carry every spelling the old sheet produced, so migration matches
-- exactly and never falls back to partial name matching.
insert into partners (name, aliases) values
  ('نبض',             array['نبض','نبض القدس','لجنة نبض القدس','لجنه نبض القدس']),
  ('مسرى',            array['مسرى','مسري','مسرا']),
  ('تشارك',           array['تشارك']),
  ('شباب لأجل القدس', array['شباب لأجل القدس','شباب لاجل القدس','شباب اجل القدس']),
  ('كما دخلوه',       array['كما دخلوه','كما دخلوها']),
  ('مرابطات عن بعد',  array['مرابطات عن بعد','مرابطات']),
  ('الأستاذ زياد',    array['الأستاذ زياد','الاستاذ زياد','استاذ زياد','زياد']),
  ('القبة',           array['القبة','القبه']),
  ('عفة الخير',       array['عفة الخير','عفه الخير'])
on conflict (name) do nothing;

-- Eight weeks of Mon / Tue / Sat slots.
select ensure_slots(8);
