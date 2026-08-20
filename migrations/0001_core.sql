-- ============================================================================
-- 0001_core.sql — "سنفتح أقصانا" content platform
-- Enums, tables, indexes. No business rules here: every gate rule lives in
-- 0002_functions.sql inside advance_item(), because an admin must be able to
-- override any rule with a logged reason, and a CHECK constraint can never be
-- overridden.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================== ENUMS ==============================

create type role_name        as enum ('writer', 'reviewer', 'producer', 'admin');

-- The pipeline, exactly as agreed. Rejections do NOT get their own status:
-- a rejection writes an approvals row and moves the item BACK one stage,
-- so the reason is preserved and the current stage stays unambiguous.
create type item_status      as enum (
  'idea',              -- فكرة
  'writing',           -- كتابة
  'content_approved',  -- بوابة ١ — اعتماد المحتوى
  'in_production',     -- إنتاج
  'design_approved',   -- بوابة ٢ — اعتماد الإدارة على التصميم
  'ready',             -- بوابة ٣ — جاهز للنشر (بوابة نظام، لا معتمِد بشري)
  'published',         -- منشور
  'cancelled'          -- ملغى
);

create type approval_gate    as enum ('content', 'design');
create type approval_result  as enum ('approve', 'reject');
create type participant_part as enum ('writer', 'producer', 'reviewer');
create type slot_state       as enum ('open', 'assigned', 'published', 'skipped');
create type ai_draft_kind    as enum ('monthly_report', 'caption_review', 'collab_suggestion');
create type link_state       as enum ('pending', 'confirmed', 'rejected');

-- ============================== PEOPLE ==============================

create table profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text not null,
  roles                role_name[] not null default '{writer}',
  phone                text,
  active               boolean not null default true,
  -- Accounts are created by an admin and the password is handed over by hand,
  -- so the first login must force a change.
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now(),
  constraint chk_roles_not_empty check (array_length(roles, 1) >= 1)
);

-- ============================== CLOSED LISTS ==============================

create table tracks (
  id         smallint primary key,
  slug       text not null unique,
  name       text not null unique,
  color_hex  text not null,
  sort_order smallint not null
);

create table idea_types (
  id     smallserial primary key,
  name   text not null unique,
  active boolean not null default true
);

-- Open list: new partners are added, existing ones are never renamed in place
-- (aliases absorb spelling variants coming from the old sheet).
create table partners (
  id         smallserial primary key,
  name       text not null unique,
  aliases    text[] not null default '{}',
  active     boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================== INSTAGRAM MIRROR ==============================
-- Metric columns are nullable and have NO DEFAULT. A metric that did not return
-- is unknown; writing 0 would later read as a real measurement of nothing.

create table ig_posts (
  media_id     text primary key,
  published_at timestamptz not null,
  media_type   text,
  product_type text,
  permalink    text not null,
  shortcode    text generated always as (
                 substring(permalink from '/(?:p|reel|tv)/([^/?#]+)')
               ) stored,
  caption      text,
  synced_at    timestamptz not null default now()
);
create index ix_ig_posts_shortcode on ig_posts (shortcode);
create index ix_ig_posts_published on ig_posts (published_at desc);

create table ig_post_daily (
  media_id      text not null references ig_posts(media_id) on delete cascade,
  snapshot_date date not null,
  age_days      integer,
  likes         integer,
  comments      integer,
  reach         integer,
  views         integer,
  saved         integer,
  shares        integer,
  interactions  integer,
  profile_visits integer,
  follows       integer,
  avg_watch_ms  integer,
  primary key (media_id, snapshot_date)
);

create table ig_account_daily (
  date                date primary key,
  followers           integer,
  media_count         integer,
  reach               integer,
  views               integer,
  reach_followers     integer,
  -- Meta computes the follow-type split over its own window, so this can exceed
  -- reach. Never divide one by the other.
  reach_non_followers integer,
  follows             integer,
  -- The API does not return unfollows on our login path. Column kept nullable so
  -- a future source can fill it; it must stay blank, never 0.
  unfollows           integer
);

create table ig_demographics (
  snapshot_date date not null,
  dimension     text not null,
  key           text not null,
  value         integer,
  primary key (snapshot_date, dimension, key)
);

-- ============================== SLOTS ==============================
-- Mon / Tue / Sat 21:00. Generated ahead by ensure_slots() so an empty slot is
-- visible before its date, not after it.

create table publishing_slots (
  id         uuid primary key default gen_random_uuid(),
  slot_at    timestamptz not null unique,
  state      slot_state not null default 'open',
  note       text,
  created_at timestamptz not null default now()
);
create index ix_slots_at on publishing_slots (slot_at);

-- ============================== ITEMS ==============================

create sequence item_ref_seq start 1;

create table items (
  id                  uuid primary key default gen_random_uuid(),
  -- Human handle used in WhatsApp: AQ-0142
  ref                 text not null unique
                        default ('AQ-' || lpad(nextval('item_ref_seq')::text, 4, '0')),
  title               text not null,
  track_id            smallint references tracks(id),
  idea_type_id        smallint references idea_types(id),
  caption             text,
  notes               text,
  priority            smallint,
  status              item_status not null default 'idea',

  slot_id             uuid references publishing_slots(id) on delete set null,
  production_file_url text,

  -- The permalink is pasted by the publisher the moment the post goes live.
  -- media_id is resolved later by the nightly pull, so it stays nullable.
  ig_permalink        text,
  ig_shortcode        text generated always as (
                        substring(ig_permalink from '/(?:p|reel|tv)/([^/?#]+)')
                      ) stored,
  ig_media_id         text references ig_posts(media_id) on delete set null,
  published_at        timestamptz,

  -- Migration trace back to the old sheet.
  legacy_tab          text,
  legacy_row          integer,
  -- Months 4 and 5. Excluded from every analysis, immutable at trigger level.
  is_archived         boolean not null default false,

  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index ux_items_shortcode on items (ig_shortcode) where ig_shortcode is not null;
create index ix_items_status    on items (status);
create index ix_items_slot      on items (slot_id);
create index ix_items_track     on items (track_id);
create index ix_items_published on items (published_at desc);
create index ix_items_live      on items (status) where not is_archived;

-- One person may write and produce; several people may share one item.
create table item_participants (
  item_id  uuid not null references items(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  part     participant_part not null,
  added_by uuid references profiles(id),
  added_at timestamptz not null default now(),
  primary key (item_id, user_id, part)
);
create index ix_participants_user on item_participants (user_id);

create table item_partners (
  item_id    uuid not null references items(id) on delete cascade,
  partner_id smallint not null references partners(id),
  added_by   uuid references profiles(id),
  added_at   timestamptz not null default now(),
  primary key (item_id, partner_id)
);

-- Every approval AND every rejection, with the note. Nothing is overwritten.
create table approvals (
  id         bigserial primary key,
  item_id    uuid not null references items(id) on delete cascade,
  gate       approval_gate not null,
  result     approval_result not null,
  actor_id   uuid not null references profiles(id),
  note       text,
  created_at timestamptz not null default now()
);
create index ix_approvals_item on approvals (item_id, created_at desc);

-- Full movement log, including admin overrides and the reason given.
create table transitions (
  id              bigserial primary key,
  item_id         uuid not null references items(id) on delete cascade,
  from_status     item_status,
  to_status       item_status not null,
  actor_id        uuid references profiles(id),
  is_override     boolean not null default false,
  override_reason text,
  violations      text[],
  note            text,
  created_at      timestamptz not null default now()
);
create index ix_transitions_item on transitions (item_id, created_at desc);
create index ix_transitions_override on transitions (created_at desc) where is_override;

-- ============================== LINK MATCHING ==============================
-- Replaces the match_review sheet. Only ambiguous matches land here; unambiguous
-- ones are written straight onto items.ig_permalink by the matcher.

create table ig_link_candidates (
  id           bigserial primary key,
  item_id      uuid not null references items(id) on delete cascade,
  media_id     text not null references ig_posts(media_id) on delete cascade,
  similarity   numeric(5,4),
  day_gap      integer,
  margin       numeric(5,4),
  state        link_state not null default 'pending',
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (item_id, media_id)
);

-- ============================== REPORTS & AI ==============================

create table reports (
  id           uuid primary key default gen_random_uuid(),
  month        date not null,           -- first day of the month it covers
  title        text not null,
  author_id    uuid references profiles(id),
  context_note text,                    -- what I type before asking for a draft
  body_md      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index ix_reports_month on reports (month desc);

-- Every AI output is a draft until a human approves it. Nothing is auto-applied.
create table ai_drafts (
  id           uuid primary key default gen_random_uuid(),
  kind         ai_draft_kind not null,
  item_id      uuid references items(id) on delete cascade,
  report_id    uuid references reports(id) on delete cascade,
  input_snapshot jsonb,
  output       text not null,
  model        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now(),
  approved_by  uuid references profiles(id),
  approved_at  timestamptz
);
create index ix_ai_drafts_item on ai_drafts (item_id, created_at desc);
