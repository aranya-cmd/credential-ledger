# Credential Ledger — setup guide

A multi-user version of the credential tracker: Firms, Assignments, Work Orders,
Documents, Document Links, Field Values, and Flags, backed by a real shared
database so your whole team can log in and edit the same data.

## 1. Create your database (Supabase)

1. Go to https://supabase.com → sign up (free) → **New project**.
2. Pick a name and a database password (save the password somewhere).
3. Once the project finishes provisioning, open **SQL Editor** → **New query**.
4. Paste in the entire contents of `schema.sql` (in this folder) and click **Run**.
   This creates all 7 tables and the access rules that let any signed-in
   teammate read and write them.
5. Go to **Authentication → Providers** and confirm Email is enabled (it is by
   default — nothing to change unless you want to turn off "Confirm email").
6. Go to **Settings → API**. You'll need two values from this page:
   - **Project URL**
   - **anon public** key

## 2. Run the app on your computer

1. Make sure you have Node.js installed (nodejs.org, LTS version).
2. In this folder, copy the env template and fill in your two values:
   ```
   cp .env.example .env
   ```
   Then open `.env` and paste in your Project URL and anon key.
3. Install and run:
   ```
   npm install
   npm run dev
   ```
4. Open the URL it prints (usually `http://localhost:5173`). You should see a
   sign-in screen.
5. Click "Need an account? Sign up", create your first login. This is now
   your team's first user — everyone else signs up the same way and lands in
   the same shared workspace.

## 3. Put it on the internet (Vercel)

1. Push this folder to a GitHub repository (or use Vercel's drag-and-drop
   deploy if you'd rather skip GitHub for now).
2. Go to https://vercel.com → sign up free → **Add New Project** → import
   your repo.
3. Vercel will detect it's a Vite app automatically. Before deploying, add
   your two environment variables under **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. You'll get a real URL (e.g. `credential-ledger.vercel.app`)
   that anyone on your team can open and log into.

## How the data model maps to the app

- **Firms** → competitors
- **Assignments** → one real exam/election event, groups multiple Work Orders
- **Work Orders** → one row per WO number (the core "entry")
- **Documents** → the actual WO letters, WCCs, invoices, correspondence
- **Document Links** → the join table: which documents attach to which Work
  Orders, and whether that document originated or enriched the entry
- **Field Values** → per-field source tracking (Direct / Invoice / Derived /
  BOQ) for Candidates, Cameras, Centres, and WO Value
- **Flags** → open exceptions, filterable by resolved/unresolved

The **Master Ledger** tab is computed live from the other six tables — it's
never edited directly, so it can't drift out of sync with the underlying data.

## Where to take this next

Once this version is live and your team is using it, natural next
improvements (I can help build any of these when you're ready):

- **Realtime sync** — Supabase supports live updates, so edits from a
  teammate appear instantly without refreshing.
- **File uploads** — Supabase Storage can hold the actual PDFs, linked
  straight from the Documents table.
- **The AI extraction step from earlier** — a button that sends an uploaded
  PDF package to Claude, gets back structured rows, and inserts them straight
  into Work Orders / Documents / Document Links / Field Values automatically.
- **Roles/permissions** — e.g. read-only teammates vs. editors.
- **Bulk import** — pulling in your existing `Competitors_Experience.xlsx`
  data as a one-time migration into the new tables.
