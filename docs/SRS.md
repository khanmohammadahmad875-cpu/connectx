# ConnectX — Software Requirements Specification (Summary)

**Project:** ConnectX — real-time messaging platform (client–server)
**Stack:** React.js · Node.js + Express.js · MongoDB (Mongoose) · Socket.IO · JWT

**Objective:** A secure messaging application where registered users communicate
privately and in groups through instant messages, share files, see online
status, and receive notifications.

## User roles

1. **Guest** — can register or log in.
2. **Registered user** — communicate, create groups, manage contacts, update profile.
3. **Administrator** — manage users, investigate reported content, platform safety.

## Functional requirements

- **Module A — Authentication & security:** registration, login/logout, password
  hashing, JWT auth, refresh tokens, forgot/reset password (email), protected
  routes, role-based authorization, account deactivation.
- **Module B — User profile:** profile picture upload, username change, bio,
  user search, view profiles, block/unblock, privacy settings.
- **Module C — Private messaging:** instant send/receive, text, images,
  documents, timestamps, edit, delete, replies, reactions, read + delivered
  receipts, typing indicators.
- **Module D — Group messaging:** create group, add/remove members, group
  admins, group name/picture, group messages, leave group, member permissions.
- **Module E — Real-time:** online/offline status, last seen, typing status,
  instant delivery, real-time receipts, live notifications, automatic
  reconnection, multiple browser sessions.
- **Module F — Search & notifications:** search users/conversations/messages,
  unread counters, notification sounds, in-app notifications, mark as read.
- **Module G — Administration:** admin dashboard, view users, suspend accounts,
  review reports, basic platform statistics.

## Non-functional requirements

| Requirement | Expected behaviour |
|---|---|
| Security | Passwords never stored as plain text |
| Performance | Messages delivered with low latency |
| Reliability | Reconnect after temporary disconnection |
| Scalability | Support multiple concurrent users |
| Usability | Responsive mobile + desktop design |
| Maintainability | Modular code architecture |
| Data integrity | No duplicate message creation |
| Authorization | No access to unauthorized conversations |

## Security requirements

bcrypt/Argon2 password hashing · HTTPS in production · validation of every API
request and socket event · file type/size restrictions · NoSQL-injection and
XSS protection · rate limiting (login + messaging) · refresh tokens in secure
HttpOnly cookies · no secrets in frontend env vars · membership checked before
message access · users can only edit/delete their own messages · correct
presence across multiple sessions · **idempotent message sending** (retries must
not create duplicates).

Out of scope: end-to-end encryption (separate advanced milestone).

## Definition of completion

Authentication secure · private + group messaging working · messages persisted
in MongoDB · real-time delivery · presence correct across sessions · receipts
working · media uploads · unauthorized access prevented · responsive UI ·
tests passing · deployed · professional GitHub documentation.
