# ConnectX — Secure Real-Time Messaging Platform

ConnectX is a secure, scalable messaging application: private and group chats,
instant delivery with Socket.IO, online presence, read receipts, media sharing
and an admin moderation panel — built milestone by milestone.

**Status: COMPLETE — all milestones implemented and verified.**
The full application (auth, profiles, private + group messaging, real-time
Socket.IO delivery, presence, typing, receipts, media uploads, notifications,
reports and the admin panel) is built and covered by an automated end-to-end
test suite: **51 checks, all passing** (`npm --prefix server test`).
See `DEPLOYMENT.md` for going live.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React.js (Vite), React Router |
| Backend | Node.js + Express.js |
| Database | MongoDB + Mongoose |
| Real-time | Socket.IO |
| Auth | JWT access + refresh tokens, bcrypt |
| Uploads | Multer locally, Cloudinary when configured |
| Validation / Security | Zod, Helmet, rate limiting |

REST and Socket.IO have separate jobs: REST handles registration, login,
profiles and conversation history; Socket.IO handles instant messages, typing
indicators, presence and receipts.

## Project structure

```
connectx/
├── client/          React frontend (Vite)
│   └── src/         components, pages, context, services, socket, utils
├── server/          Express backend
│   └── src/         config, models, controllers, routes, middleware, socket
├── docs/            SRS.md, database-design.md, api-documentation.md
├── .gitignore
└── README.md
```

## Getting started

Prerequisites: Node.js 18+ and Git. (MongoDB is optional for local dev — see below.)

```bash
# 1. Install everything (root, client, server)
npm run setup

# 2. Run frontend + backend together
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- Health check: http://localhost:5000/api/health

### Database modes

The server reads `server/.env`:

- `USE_MEMORY_DB=true` (default) — zero-setup in-memory MongoDB for development.
  Data resets when the server restarts. On Windows, the in-memory MongoDB binary
  needs the Microsoft Visual C++ Redistributable installed.
- `USE_MEMORY_DB=false` + `MONGODB_URI=...` — a real MongoDB (local install or a
  free MongoDB Atlas cluster). Use this for persistent data.

Copy `server/.env.example` to `server/.env` and `client/.env.example` to
`client/.env` if you need to change any values. **Never commit `.env` files or
secrets to Git.**

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| 1 | Project foundation (repo, React, Express, MongoDB, health check) | ✅ Done |
| 2 | Authentication (bcrypt, JWT access + refresh, protected routes) | ✅ Done |
| 3 | User management (profiles, pictures, search, block/unblock) | ✅ Done |
| 4 | Conversation management (private + group, membership, permissions) | ✅ Done |
| 5 | Real-time messaging (Socket.IO, rooms, reconnection) | ✅ Done |
| 6 | Advanced messaging (edit/delete, replies, reactions, receipts) | ✅ Done |
| 7 | Online presence (status, last seen, typing, multi-session) | ✅ Done |
| 8 | Media + notifications (uploads, Cloudinary, unread counters) | ✅ Done |
| 9 | Admin + security hardening (dashboard, reports, rate limiting) | ✅ Done |
| 10 | Deployment + tests + final documentation | ✅ Done — see DEPLOYMENT.md |

## Running the tests

```bash
npm --prefix server test
```

Boots the real server against an in-memory database and runs 51 end-to-end
checks covering the SRS acceptance scenarios (auth security, private-chat
privacy, live delivery, idempotent retries, group permissions, uploads,
blocking, admin suspension and more).

Full requirements: [docs/SRS.md](docs/SRS.md) ·
Database: [docs/database-design.md](docs/database-design.md) ·
API: [docs/api-documentation.md](docs/api-documentation.md)

## Security notes

- Passwords are hashed (bcrypt) — never stored or logged in plain text.
- Refresh tokens use secure, HttpOnly cookies; access tokens are short-lived.
- Every API request and socket event is validated, and conversation membership
  is checked server-side before any message access.
- Message sending is designed to be idempotent (safe retries, no duplicates).

> End-to-end encryption is intentionally out of scope for the current SRS; it
> would be a separate advanced milestone requiring proper cryptographic design.
