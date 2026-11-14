# ConnectX v3.0 — Expansion Plan & Module Map

ConnectX v3.0 grows the v2.0 platform (see `SRS.md`, Modules A–G) from
**24 modules to 32**, adding a home dashboard, personalization, live
information widgets and an address book — while keeping the same stack
(React · Express · MongoDB · Socket.IO · JWT) and the same rule: **no paid
or API-key services**.

## The 32 modules

### v2.0 foundation (modules 1–24, delivered)

| # | Module | Notes |
|---|--------|-------|
| 1 | Authentication | Register/login/logout, bcrypt hashing |
| 2 | Sessions & tokens | JWT access tokens, rotating HttpOnly refresh cookies |
| 3 | Password recovery | Forgot/reset password flow |
| 4 | User profiles | Username, bio, profile picture |
| 5 | User search & discovery | Find people by name/email |
| 6 | Privacy & blocking | Last-seen/picture toggles, block/unblock |
| 7 | Private messaging | 1-to-1 chats, pair-deduped conversations |
| 8 | Message lifecycle | Edit, delete-for-everyone, replies, reactions |
| 9 | Receipts & typing | Delivered/read receipts, typing indicators |
| 10 | Delete for me | Per-user message hiding (`hiddenFor`) |
| 11 | Group messaging | Group chats with member lists |
| 12 | Group administration | Admins, add/remove members, group name/picture |
| 13 | Real-time transport | Socket.IO delivery, reconnection |
| 14 | Presence | Online/offline + last seen across sessions |
| 15 | Media uploads | Images/documents; local disk or Cloudinary |
| 16 | Notifications | In-app notifications, unread counters, sounds |
| 17 | Search | Conversation/user search in the client |
| 18 | Status (stories) | 24-hour image/text statuses with viewers |
| 19 | Reports & moderation | Report users/messages |
| 20 | Admin dashboard | Stats, user suspension, report review |
| 21 | Account management | Deactivation, role-based access |
| 22 | Security hardening | Rate limits, zod validation, helmet, CORS |
| 23 | Idempotent sending | `clientMessageId` dedupe on retries |
| 24 | Single-service deployment | SERVE_CLIENT mode, health endpoint, e2e suite |

### v3.0 expansion (modules 25–32)

| # | Module | Phase | Status |
|---|--------|-------|--------|
| 25 | Wallpapers & appearance | A | ✅ Implemented |
| 26 | Weather | A | ✅ Implemented |
| 27 | World clock | A | ✅ Implemented |
| 28 | Contact cards & address book | A | ✅ Implemented |
| 29 | Maps & live location | C | ✅ Implemented |
| 30 | Business profiles | C | ✅ Implemented |
| 31 | Calendar & meetings | D | ✅ Implemented |
| 32 | Documents & tasks | D | ✅ Implemented |

> **v3.0 expansion COMPLETE.** All 32 modules are implemented: the v2.0
> foundation (1–24, including the Phase B messaging modules and Phase C
> calls) and the v3.0 additions (25–32). The final phase (D) also delivers
> the remaining SRS v2.0 items 22 (advanced account protection), 23
> (backup & recovery) and 24 (anti-spam & fraud basics). See the honest
> notes at the end of this document for the known limits.

## Phase roadmap

- **Phase A (this delivery)** — Interactive UI & personalization:
  animated auth screens (canvas particles), glass/3D-tilt dashboard cards,
  micro-animations and skeleton loaders (transform/opacity only,
  `prefers-reduced-motion` respected); **Home dashboard** (profile card,
  live clock, weather + world-clock widgets, quick actions, recent chats,
  unread summary); **module 25** wallpapers & appearance; **module 26**
  weather; **module 27** world clock; **module 28** contact cards.
- **Phase B** — The remaining SRS v2.0 messaging modules (voice messages,
  polls, archived/locked/hidden chats, communities & channels).
- **Phase C** — SRS v2.0 module 8 (1-to-1 voice/video calls), module 29
  (maps & live location sharing) and module 30 (business profiles:
  verified business accounts, catalogues, business hours, auto-messages).
- **Phase D (delivered)** — Module 31 (calendar & meetings: events,
  invites, reminders) and module 32 (documents & tasks: shared folders,
  files, notes, task lists), plus SRS v2.0 modules 22 (advanced account
  protection: TOTP 2FA, sessions, login history), 23 (backup & recovery:
  data export/import, account reactivation) and 24 (anti-spam & fraud
  basics: send rate limits, report-based auto-flagging, link safety).

Each phase ships only when the client production build passes and the full
e2e suite (`server/tests/e2e.cjs`) is green, including new checks for the
phase's features.

## Phase A — what was built

### Interactive UI + Home dashboard
- Auth screens (login/register/forgot/reset) get a lightweight animated
  canvas particle background (no WebGL) over the existing navy gradient.
- `/home` is the landing page after login: a widget grid of tilt-on-hover
  glass cards — profile card, live local clock + date, weather widget,
  world-clock widget (editable), quick actions (new chat/group/status),
  recent chats preview, and an unread-messages/notifications summary.
  The chat sidebar gains a **Home** tab next to Chats | Status, and the
  dashboard deep-links into conversations.

### Module 25 — Wallpapers & appearance
- Default wallpaper per user + **per-conversation override** (your choice
  is yours only — the other participant keeps theirs).
- Built-ins are pure CSS gradients/patterns (no external images); a custom
  image can be uploaded through the existing uploads pipeline. A dim
  overlay slider (0–85%) keeps text readable. "Reset" removes the
  per-conversation override and falls back to the default.
- Accent-color choices re-theme the UI via the `--accent` CSS variables.
- Persisted server-side on the user: `GET/PATCH /api/users/me/preferences`.

### Module 26 — Weather (Open-Meteo, free, no key)
- `GET /api/weather/current` and `GET /api/weather/forecast` accept
  `?city=<name>` (Open-Meteo geocoding) or `?lat=&lon=` (+ optional
  `name`/`country` labels). Responses carry current conditions (temperature,
  feels-like, humidity, wind, WMO condition code + text), the next 24
  hourly entries and a 7-day forecast.
- A ~10-minute in-memory server cache absorbs repeat lookups; provider
  failures surface as graceful JSON errors (502 with a friendly message).
  The provider base URLs are env-overridable (`OPEN_METEO_GEO_URL`,
  `OPEN_METEO_API_URL`) so tests can stub them.
- Client: a Weather page (search, saved cities, optional browser
  geolocation behind an explicit button) + the dashboard widget. Saved
  cities persist in preferences.

### Module 27 — World clock
- Fully client-side with `Intl` IANA zones: local time plus user-added
  cities (persisted in preferences, shared 12/24h toggle), shown on the
  dashboard.
- Users may share an optional **time zone on their profile**; in a 1-to-1
  chat header the other person's local time appears **only** when they
  have set one.

### Module 28 — Contact cards & address book
- Optional profile fields: phone, whatsappNumber, country, city,
  homeAddress, businessAddress, postalCode, website, linkedin, github,
  jobTitle, organization.
- **Every field has a visibility**: `everyone` | `contacts` | `nobody`,
  where "contacts" = users sharing at least one conversation with the
  owner. `homeAddress` accepts only `contacts` | `nobody` — the API
  rejects `everyone` (400) and the model enum excludes it too, so a home
  address can never become public.
- Enforcement lives in the API: `GET /api/users/:id/contact-card` returns
  only the fields the requester may see (email is included only for the
  owner and their contacts). `GET/PATCH /api/users/me/contact-card`
  manage the owner's own card. Public profiles never embed card data.
- Client: a per-field editor with visibility dropdowns on the Profile
  page, and a read-only card in the chat info panel with quick actions —
  copy, `https://wa.me/<number>` for a visible WhatsApp number, `tel:`
  and `mailto:` links.

## Phase B — what was built (SRS v2.0 modules 5, 14, 19, 20, 21 + polls)

Per the agreed delivery order, this phase completes the remaining SRS v2.0
messaging modules; modules 29 (maps) and 30 (business profiles) move to the
next phase, with 31/32 after them.

- **Module 5 — Voice messages.** Browser recording (MediaRecorder) with
  cancel/send, uploaded through the existing uploads pipeline (new audio
  MIME types, stored locally or on Cloudinary like any upload). Messages
  carry `audioMeta { duration, waveform }` — peaks sampled from an
  AnalyserNode at record time. Playback supports play/pause, seek on the
  waveform, and 1x/1.5x/2x speeds. Voice messages flow through receipts,
  replies and both delete modes like any message.
- **Polls.** A `poll` message type with embedded, server-persisted state
  (question, 2–10 options, per-option voter ids, single/multiple choice,
  closed flag). Voting replaces the caller's vote set via
  `POST /api/messages/:id/vote`; only the creator can close
  (`POST /api/messages/:id/poll/close`). Votes broadcast `message_updated`
  so percentages update live.
- **Module 20 — Archived chats.** Per-user `archived` flag on
  ConversationMember. `POST /api/conversations/:id/archive|unarchive`;
  main list excludes archived, `?view=archived` serves the Archived view
  (unread counts preserved). Any new incoming message auto-unarchives.
- **Module 19 — Locked chats.** One PIN per user (4–6 digits), stored only
  as a bcrypt hash (`chatLockPinHash`, select:false). Per-user `locked`
  flag on ConversationMember. Unlocking verifies the PIN server-side and
  issues a 10-minute JWT unlock grant (`scope: chat_unlock`) presented as
  `X-Unlock-Token` (REST) or the `unlock_chats` socket event. Without a
  grant, history, sends, detail and read receipts are refused with 423 —
  over REST and Socket.IO alike — and locked conversations vanish from the
  chat list and from notification payloads entirely. Failed PIN attempts
  are rate-limited (5 failures → 5-minute lockout, 429). Change PIN needs
  the current PIN; recovery is a password-verified PIN reset
  (`/api/chat-locks/pin/reset`). API: `/api/chat-locks/*`.
- **Module 21 — Hidden chats.** A locked chat can be marked `hidden`: it
  disappears even from the locked list and is revealed only by entering
  the user's secret code (`POST /api/chat-locks/reveal`), which is also
  bcrypt-hashed and rate-limited. A password-verified secret reset
  un-hides everything, so a forgotten code can't trap chats forever.
- **Module 14 — Communities & channels.** Channels are a broadcast
  Conversation type: admins post, followers read + react; post permission
  is enforced in `createMessage` so REST and sockets agree. Public
  channels are discoverable via `GET /api/channels?q=` with follower
  counts; follow/unfollow via `/api/conversations/:id/follow|unfollow`.
  Private channels never appear in discovery. Communities (new
  `Community` model) link existing groups under one name/avatar, own an
  announcement channel (linked groups' members become its followers), and
  derive their member list from the linked groups.

## Phase C — what was built (SRS v2.0 module 8 + modules 29, 30)

- **Module 8 — Voice & video calls (1-to-1).** WebRTC peer connections
  with signalling over Socket.IO (`call_invite` / `call_accept` /
  `call_reject` / `call_end` / `call_ice`). Every signalling event is
  verified server-side: an invite requires membership in a *private*
  conversation with the callee (a stranger cannot signal someone they
  share nothing with), accept/reject/end/ICE require being one of the
  call's two parties. Call flow covers outgoing/incoming ringing UI,
  accept/reject, mute, camera on/off, a platform-dependent speaker toggle,
  a call timer, and busy/declined/timeout resolution (30 s ring timeout,
  `CALL_RING_TIMEOUT_MS`). Calls persist as `Call` records
  (completed/missed/declined + duration + end reason), surface as system
  messages in the conversation and in a Calls history view, and a missed
  call raises a `missed_call` notification. Locked chats cannot leak: the
  notifications feed already withholds locked conversations entirely, and
  a call's system message lives only inside the conversation.
  - **NAT honesty:** media uses public STUN servers only (configured in
    `client/src/utils/rtc.js`, overridable via `VITE_ICE_SERVERS` /
    `VITE_STUN_URLS`). There is **no TURN relay** — STUN is enough for
    most home and mobile networks, but peers behind strict/symmetric NATs
    (some corporate or carrier networks) may fail to connect until a TURN
    server is added. Group calls remain a v4.0 item per the blueprint.
- **Module 29 — Maps & live location.** OpenStreetMap via Leaflet (free,
  no key; tile provider configured in one place, `client/src/utils/maps.js`).
  One-time location messages carry lat/lng + label, render an inline map
  and open a full map view with a Google Maps *Directions* link.
  Live location sharing runs for 15 min / 1 h / 8 h: the sharer's browser
  streams throttled position updates over Socket.IO (the REST twin shares
  the same service and rules), the message shows a live map + remaining
  time, the sharer can stop at any time, and sessions auto-expire
  server-side — updates after stop or expiry are rejected. Locked-chat
  rules apply unchanged. Browser geolocation is used **only** after the
  user explicitly taps share.
- **Module 30 — Business profiles.** Any user can upgrade: business name,
  logo + cover (existing uploads pipeline), category, description, public
  email/phone/address with per-field visibility (everyone / contacts /
  nobody — the Phase A contact rules; home-address rules untouched),
  website, per-day working hours, and a product/service catalogue with
  owner-only CRUD. A directory (search by name/category) and public
  business pages show an open/closed indicator computed from the hours in
  the business's time zone (viewer's zone as fallback) and a one-tap
  Message action. Welcome messages auto-send once on first contact; away
  messages auto-send while closed, at most once per conversation per day —
  implemented in the message-create flow with hard loop guards (never for
  the business's own messages, never for auto-messages). Quick replies are
  owner-defined composer shortcuts. The **verified badge can only be set
  by an admin** (`PATCH /api/admin/users/:id/business-verified`); the
  owner-facing API does not accept the field.


## Phase D — what was built (modules 31, 32 + SRS v2.0 modules 22, 23, 24)

- **Module 31 — Calendar & meetings.** Events with title, description,
  start/end, an IANA `timezone` stored on the event, location or meeting
  link, and per-event reminder offsets. Invitees must share a conversation
  with the creator (the contacts rule); they can accept/decline, and the
  event lists attendee states. Times render in the viewer's local zone
  with the event's original zone shown when it differs. The client ships a
  hand-rolled month grid + agenda (no calendar library) and the Home
  dashboard gains an "Upcoming events" widget (next 3). Reminders are
  in-app notifications produced by a lightweight server interval checker
  (`EVENT_REMINDER_INTERVAL_MS`, default 30 s) with per-participant
  bookkeeping on the event so each reminder fires exactly once.
- **Module 32 — Documents & tasks.** Shared folders (owner + specific
  users + whole conversations) holding files (bytes via the existing
  uploads pipeline; downloads go through the access-checked
  `GET /api/docs/files/:id/download`), shared text notes (folder sharing
  defines the editors), and task lists — standalone or inside a folder —
  with tasks that carry an assignee (who must have list access), a due
  date and a todo/in-progress/done status. The list owner and the assignee
  can change a task's status; everyone with list access can view. Access
  is enforced server-side on every read and download. The Home dashboard
  gains a "My tasks" widget (assigned to me, not done).
- **Module 23 — Backup & recovery.** `GET /api/users/me/export` downloads
  one JSON document with the caller's profile, contact card, preferences,
  business settings, conversation metadata, their messages (excluding
  deleted-for-everyone and delete-for-me), events, documents data and call
  history. An explicit exclusion list lives in the code (`routes/users.js`)
  and is asserted by tests: no password hash, no chat-PIN or secret-code
  hash, no refresh tokens, no TOTP secret or backup-code hashes, no
  password-reset token. `POST /api/users/me/import` merges an export back
  — preferences, contact card, folders/notes/task lists/tasks and the
  caller's own events — skipping duplicates and never deleting anything.
  Account deactivation gained its missing mirror: password-verified
  **reactivation** from the sign-in screen (2FA-aware), and the
  forgot/reset-password flow is covered end-to-end by tests.
- **Module 22 — Advanced account protection.** TOTP two-factor
  authentication implemented directly on `node:crypto` (RFC 6238, no new
  dependency): setup shows the secret + otpauth:// URL exactly once, login
  becomes a two-step flow (password → short-lived challenge → code), and
  disable needs password + code. Eight one-time backup codes are issued at
  setup, stored only as bcrypt hashes, each usable once. The TOTP secret
  is stored AES-256-GCM encrypted (select:false) and never returned by any
  API after setup; code attempts are rate-limited (5 failures → 5-minute
  lockout, 429). Every refresh token is a listed **session** (device label
  from the user agent, IP, last active) with per-session revoke and
  "revoke all others" — revoking removes the stored token hash, so the
  session's refresh immediately stops working. Login history is recorded,
  and a successful sign-in from a new IP + user-agent combination raises a
  "New sign-in" in-app notification (no email — no mail service is
  configured).
- **Module 24 — Anti-spam & fraud basics.** Enforced inside
  `createMessage`, so REST and Socket.IO share the rules: a per-user
  sliding-window send limit (`SPAM_MSG_MAX` per `SPAM_MSG_WINDOW_MS`,
  default 240/min) and a stricter first-hour cap on how many *distinct*
  people a brand-new account can message (`SPAM_NEW_DISTINCT_MAX`,
  default 10) — refusals are 429s. Reports feed an auto-flag: at
  `REPORT_FLAG_THRESHOLD` (default 3) reports from distinct users within
  `REPORT_FLAG_WINDOW_MS` (default 7 days) the account is flagged for
  admins (badge in the admin panel) — never auto-banned; admins decide.
  Link safety: URLs in messages are analysed server-side
  (`utils/linkSafety.js`); the client renders the bare domain and marks
  links that use known shorteners or punycode (`xn--`) hosts with a
  warning. Links are flagged, never blocked.

## Honest notes & known limits

- **Calls have no TURN relay** (module 8): media uses public STUN only,
  so peers behind strict/symmetric NATs may fail to connect until a TURN
  server is added. Group calls remain a v4.0 item.
- **Import never restores messages** (module 23): an export contains your
  messages for backup/reading, but importing one restores only profile,
  preferences, documents data and your own events — chat history can
  never be recreated or faked through import. Assignees on restored tasks
  and attendees on restored events are likewise not carried over.
- **Event reminders are best-effort scheduling**: the checker is an
  in-memory interval. Event data persists, and a reminder that falls due
  while the server is down fires on the next run (up to 30 minutes late),
  but reminders do not survive as independent scheduled jobs.
- **2FA QR codes**: setup returns the otpauth:// URL (the QR content) and
  the base32 secret; the client shows both for manual entry or scanning
  with any authenticator app — it does not render a QR image itself.
- **Anti-spam counters are in-memory**: a server restart resets the
  sliding windows. The report-based flag is persistent (it lives on the
  user document), and the limits are env-tunable for larger deployments.
- **Document downloads** are access-checked through
  `/api/docs/files/:id/download`. As with chat media, the underlying
  upload URLs follow the existing uploads pipeline's model; the folder
  layer is what enforces who may fetch a document through the app.
