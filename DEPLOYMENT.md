# ConnectX — Deployment Guide (complete method)

ConnectX has three parts: the **API server** (Node/Express + Socket.IO), the
**web client** (React build) and the **database** (MongoDB). For a public live
link you need free accounts on the services below — creating those accounts
and signing in is the only step that cannot be done for you.

---

## Option A (recommended, simplest): one service on Render + MongoDB Atlas

The server can serve the built React client itself (`SERVE_CLIENT=true`), so a
single Render web service hosts the whole app.

### Step 1 — MongoDB Atlas (database, free)
1. Go to https://www.mongodb.com/atlas and create a free account.
2. Create a **free (M0) cluster**.
3. Database Access → add a user (username + password — save them).
4. Network Access → allow `0.0.0.0/0` (so Render can connect).
5. Connect → Drivers → copy the connection string, e.g.
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/connectx`

### Step 2 — Render (hosting, free)
1. Go to https://render.com and sign up (easiest: "Sign in with GitHub" after
   the code is on GitHub, see below).
2. New → **Web Service** → connect the `connectx` GitHub repo
   (or use the included `render.yaml` blueprint: New → Blueprint).
3. Settings if entering manually:
   - **Build command:** `npm run setup && npm run build`
   - **Start command:** `npm --prefix server start`
4. Environment variables (Render dashboard → Environment):

   | Key | Value |
   |---|---|
   | `USE_MEMORY_DB` | `false` |
   | `MONGODB_URI` | your Atlas string from Step 1 |
   | `SERVE_CLIENT` | `true` |
   | `JWT_ACCESS_SECRET` | a long random string (invent one) |
   | `JWT_REFRESH_SECRET` | another long random string |
   | `CLIENT_URL` | your Render URL, e.g. `https://connectx-xxxx.onrender.com` |
   | `PUBLIC_BASE_URL` | same Render URL |
   | `ADMIN_EMAIL` | your email (the account that registers with it becomes admin) |

5. Create the service. First build takes a few minutes. Your live link is the
   `onrender.com` URL. Note: the free tier sleeps after ~15 minutes idle; the
   first visit afterwards takes ~30–60 s to wake.

### Step 3 — Optional extras
- **Password-reset emails:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM` (e.g. a Gmail App Password or any SMTP service).
  Without them, reset links print on the server console (fine for local dev).
- **Cloud image/file storage:** create a free https://cloudinary.com account
  and set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
  Without them, uploads are stored on the server's local disk (on Render's free
  tier that disk is wiped on redeploy — use Cloudinary for anything permanent).

---

## Option B: API on Render + client on Netlify (two services)

1. Deploy the API exactly as in Option A, but set `SERVE_CLIENT=false` and
   `CLIENT_URL` to your Netlify URL (step 2). Set `PUBLIC_BASE_URL` to the
   Render URL.
2. Netlify (https://www.netlify.com): Add new site → import the `connectx`
   repo. The included `client/netlify.toml` already sets:
   - Base directory `client`, build `npm run build`, publish `dist`,
     SPA redirect for React Router.
   - Set environment variable `VITE_API_URL` to the Render API URL.
3. Redeploy the API after setting `CLIENT_URL` (CORS + Socket.IO need it).

---

## Putting the code on GitHub

The project is already a Git repository with full history. To publish it:

**Method 1 — GitHub CLI (fastest on your own PC, one-time sign-in):**
```bat
gh auth login
cd connectx
gh repo create connectx --public --source=. --push
```

**Method 2 — git push to an empty repo:**
1. On https://github.com/new create a repo named `connectx` (do NOT tick
   "Add a README").
2. In the project folder:
```bat
git remote add origin https://github.com/YOUR-USERNAME/connectx.git
git push -u origin main
```

**Method 3 — web upload:** create the empty repo, then "uploading an existing
file", and drag in the contents of the project zip. (Method 1 or 2 is better:
the zip has no Git history.)

> Never push `.env` files — they are already excluded by `.gitignore`
> (verified). Only `.env.example` templates are committed.

---

## Local production check (before deploying)

```bash
npm run setup           # install everything (once)
npm run build           # build the client
# then in server/.env set SERVE_CLIENT=true and run:
npm --prefix server start
# open http://localhost:5000 — the app and API on one port
```

## Tests

```bash
npm --prefix server test
```
51 end-to-end checks against the SRS acceptance scenarios — all passing.
