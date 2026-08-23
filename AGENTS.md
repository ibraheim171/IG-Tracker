# AGENTS.md — منصة "سنفتح أقصانا"

Read this file before writing any line of code. It is the contract, not a suggestion.
Comments and identifiers in English. All user-facing strings in Arabic.

---

## 1. What this is

A content operations platform for one Instagram account (`aqsana2026`). It replaces a
Google Sheet that documented roughly a quarter of what actually got published. The
platform's single most important job is to close that gap: **publishing goes through
the platform, so documentation is a by-product of the work rather than extra work
stacked on top of it.**

Everything else is secondary to that.

- **Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres + Auth) · Vercel
- **Language:** Arabic UI, RTL, `dir="rtl"` on `<html>`
- **Team:** ~20 people, mobile-first, phones over laptops

---

## 2. The rules that must never be broken

### 2.1 Status moves only through RPC

`items.status` is never written by an `UPDATE` from the client. A database trigger
rejects it. The only paths are:

| Function | Use |
|---|---|
| `advance_item(item, to_status, note, override_reason)` | forward one stage |
| `reject_item(item, gate, note)` | send back with a written note (note is mandatory) |
| `mark_published(item, permalink, at, override_reason)` | the "تم النشر" button |
| `assign_slot(item, slot)` | attach to a publishing slot |

If a screen needs a new rule, the rule goes into `item_violations()` in
`0002_functions.sql`. **Never into a React component, never into an API route.**
One file holds every rule so that one file can be read to know what the system forbids.

### 2.2 Admin override is a feature, not a leak

Any rule fails open for an admin **who supplies a written reason**, and every override
is written to `transitions` with `is_override = true`. Do not add `CHECK` constraints
for gate rules — a `CHECK` cannot be overridden, which would break this requirement.

The one exception, deliberately absolute: **archived items (months 4 and 5) cannot be
written by anyone, admin included.** Excluded means excluded from everything.

### 2.3 A failed metric is blank, never zero

Metric columns are nullable with **no default**. Never `coalesce(x, 0)` when storing.
Never render `0` for a missing reading — render `—`. Zero is a measurement; blank is
the absence of one, and conflating them has already corrupted one month of analysis.

### 2.4 Numbers are Latin, always

`٤٥` never appears in the UI. Use `toLocaleString('en-US')` and
`font-variant-numeric: tabular-nums`. Arabic text, Latin digits.

### 2.5 The UI states, it does not judge

No "قوي", no "ضعيف", no "أداء ممتاز", no colour-coded verdicts on performance, no
emoji rating. The platform shows numbers and flags sample size. Judgement happens in
the monthly report, written by a human.

Flags that ARE allowed: `عيّنة صغيرة` when `n < 4`, `مسودة آلية — تحتاج اعتماداً` on
every AI output, `قياس ناقص` when `signal_partial` is true.

### 2.6 Analysis reads views, not tables

`v_item_performance`, `v_track_month`, `v_partner_month`, `v_partner_track` already
exclude archived items, already use `percentile_cont(0.5)` (median, never `avg`), and
already return `n` and `is_thin`. Do not recompute any of this in application code.

Reach accumulates with a post's age, so absolute reach is never compared across
different publication dates. Compare rates.

`reach_non_followers` can exceed `reach` — Meta computes them over different windows.
**Never divide one by the other.** Show the absolute figure.

### 2.7 Closed lists are foreign keys

Track, idea type and partner come from `tracks`, `idea_types`, `partners`. Never a
free-text field, never a partial string match on a name. Partner spelling variants live
in `partners.aliases` and are resolved on exact match against the alias array only.

---

## 3. Data model at a glance

```
profiles ──< item_participants >── items ──< item_partners >── partners
                                     │
                       publishing_slots ┘   items ── approvals
                                            items ── transitions
                                            items ── ig_posts ──< ig_post_daily
```

- `items` is one unified table with a unique `ref` (`AQ-0142`). The five monthly sheet
  tabs are gone; `legacy_tab` / `legacy_row` preserve the trace.
- Participants are rows, not two fixed columns. One person can hold two parts; several
  people can share one item.
- `ig_media_id` stays null until the nightly pull resolves the pasted permalink. That
  is expected, not an error, for the first ~24 hours.

### Pipeline

```
idea → writing → content_approved → in_production → design_approved → ready → published
```

Three gates: `content_approved` and `design_approved` are signed by a human with the
`reviewer` role (or admin). `ready` is a **system gate** — no signature; it opens only
when caption, production file link and publishing slot are all present.

Rejection is not a status. `reject_item()` writes the note and moves the item back one
stage, so the current stage always means the same thing.

---

## 4. Publishing slots

Monday · Tuesday · Saturday at **21:00** in `Asia/Hebron` (`app_tz()` — one constant).
Slots are rows generated eight weeks ahead by `ensure_slots()`. A slot may hold more
than one item.

**An empty slot must be visible before its date.** The slot board shows the empty ones
as prominently as the filled ones; a gap discovered afterwards is worthless.

Publication dates come from slots only. There is no free date picker anywhere.

---

## 5. Visual identity

| Token | Value |
|---|---|
| Background (paper) | `#F4F1EA` |
| Card | `#FBF9F4` |
| Ink | `#231E1C` |
| Accent (قرمزي) | `#96181D` |
| Accent soft (شريط العبارة) | `#E2C3C4` |
| Rule / border | `#DDD5C7` |

Tracks: `على بصيرة #1E8F8B` · `نبض المسرى #96181D` · `بوصلة الوعي #6F8B4E` ·
`هنا مرّوا كما دخلوه #A87433`.

Fonts: **Cairo** for headings and buttons · **IBM Plex Sans Arabic** for body ·
**IBM Plex Mono** for every number.

Logical CSS properties only (`margin-inline-start`, not `margin-left`) — the layout is
RTL. Minimum touch target 44px. Design for a phone first; the desktop layout is the
same screens, wider.

---

## 6. Instagram constraints (learned the hard way, do not relitigate)

- **No auto-scheduling.** It needs Meta App Review. Not in scope.
- **Collab cannot be added via the API.** Ever. It is manual, after publishing.
- **Stories are unavailable** on the Instagram Login path in use.
- Account-level daily insights go back ~90 days only. Post-level insights are permanent.
- `unfollows` does not come back from the API. The column stays blank.
- Full daily logging began **2026-08-11**. Before that date, reach only.
- The token expires every 60 days; weekly auto-refresh is mandatory.

The nightly pull stays on Google Apps Script for now and writes into Supabase through
the REST API with the `service_role` key. Do not port it to Vercel Cron without being
asked.

---

## 7. AI features

Explicit buttons only. Nothing runs automatically. Every output is written to
`ai_drafts` and displayed with the tag **«مسودة آلية — تحتاج اعتماداً»** until a human
approves it.

Three buttons, no more: monthly report draft (reads the numbers plus my typed context
note) · caption review (spelling, length, clarity of the call to action) · collab
suggestion.

**The collab suggestion may only read `v_partner_track`.** It must never name a partner
we have not worked with, and must not recommend any partner with fewer than 5
collaborations on that track. When the sample is short it says «عيّنة غير كافية» — it
does not invent a recommendation.

---

## 8. Mistakes already made on this project

Each of these passed a test suite. Tests prove the code does what it was told; they do
not prove the instruction was right.

| Mistake | Rule now |
|---|---|
| Inferred completion from partial text ("تم التعديل" read as done) | Read the field literally; compare against the exact allowed values |
| Matched a person's name against a track name | No partial matching on names, ever |
| Wrote `0` when a metric failed | Leave it blank |
| Compared half a month against a full month | Truncate both ranges to the same day-of-month |
| Reversed sort order in a main table | Check sort direction explicitly, every table |
| Wrote into an archived month | Archived is excluded from everything, writes included |

---

## 9. Deferred — do not build without an explicit go-ahead

These are agreed future work, written down so they are not forgotten and not
started early by mistake. Do not scaffold tables, routes, or UI for anything in
this section unless the person explicitly asks to begin it.

### Notifications & reminders

An admin-configurable reminder system: the admin can message any team member
directly, and the system can send automatic reminders — e.g. a nudge to
whoever is marked as publisher an hour before a publishing slot, or a nudge to
a writer whose item has sat in one stage too long. Schedule and triggers must
be configurable by the admin (daily digest vs. per-event, quiet hours, etc.),
not hard-coded.

When this is picked up, resolve first:
- **Delivery channel.** Email is simplest (Code.gs already sends the daily
  brief via `MailApp`); WhatsApp would need a paid API and is a separate
  decision, not a default.
- **Trigger model.** A scheduled job (cron) checking `publishing_slots` and
  `items.status` against thresholds, distinct from a per-user notification
  preferences table.
- **Where rules live.** Consistent with §2.1, the *conditions* for the six
  gate rules live in `item_violations()` — reminder *rules* are a different
  concern (timing, not permission) and should get their own config table, not
  be folded into the gate-rule function.

### Editorial-decision skills

Judgment aids for content/publishing decisions (drawn from an external
reference the person is adapting). Explicitly on hold until the operational
core (this document, sections 1–8) is running and stable. Do not start
drafting these skills as a side effect of an unrelated task.

### Flexible scheduling beyond the fixed slots

An admin affordance to open an exceptional publishing slot outside the
Mon/Tue/Sat 21:00 cadence (e.g. a one-off Thursday post), reusing the existing
`assign_slot()` RPC — no new schema needed for this part. The fixed cadence
stays the *default*; this is an admin-only exception path, not a free date
picker for regular users (that would break §2's "date comes from slots only"
rule).

**Do not build "pull best posting time from Instagram."** The account uses
the Instagram Login API path (`graph.instagram.com`), not Facebook Login +
Business assets; there is no evidence the "when your followers are most
active" feature is exposed through that API, and it is not in this codebase's
metric lists (`M_ACCT`, `M_POST`, `M_REEL` in `Code.gs`). Do not scaffold
against this assumption without first confirming the endpoint exists for this
account's auth path.

Once slots are flexible and posting times start to vary, a better and fully
owned alternative becomes possible: mine the account's own `v_item_performance`
for median `signal` grouped by day-of-week / hour-of-day. Today every post
goes out at 21:00, so there is no time variance yet to learn from — this only
becomes useful after the flexibility above ships.

---

## 10. Working agreement

- Small commits, one concern each. Arabic commit subject is fine; body in English.
- No new dependency without a stated reason. No UI kit, no charting library until a
  chart actually exists.
- No `localStorage` for anything the database owns.
- When a requirement is ambiguous, stop and ask. Do not guess and do not invent a
  plausible-looking default — a wrong default here becomes a wrong number in a report.
- Never edit files under `supabase/migrations/` that have already been applied. Add a
  new numbered migration.
