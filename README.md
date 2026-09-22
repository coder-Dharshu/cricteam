# Honganuru Premier League (HPL) — Season 2 🏏

Live Cricket Tournament Registration & Management Web Platform with real-time updates and Supabase PostgreSQL database integration.

---

## 🚀 Supabase Setup Guide

This project supports **Supabase PostgreSQL** for persistent database storage on Vercel and local development. If Supabase credentials are not provided, it automatically falls back to local `data/db.json`.

### 1. Create a Supabase Project (Free)
1. Go to [https://supabase.com](https://supabase.com) and sign in with GitHub or your account.
2. Click **New Project**, choose a project name (e.g. `hpl-cricket`), set a database password, and pick the region closest to you (e.g. `Mumbai (ap-south-1)`).
3. Click **Create new project**.

---

### 2. Run the Database Schema
1. In your Supabase project dashboard, navigate to the **SQL Editor** (left navigation bar: `>_`).
2. Click **New query**.
3. Copy the contents of [`schema.sql`](./schema.sql) and paste it into the editor.
4. Click **Run** (or `Ctrl + Enter`).
   - This creates the `teams` and `players` tables, sets up foreign keys, adds performance indexes, and configures Row Level Security (RLS) policies for registrations.

---

### 3. Configure Environment Variables

#### For Local Development:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. In your Supabase project, go to **Project Settings** -> **API**.
3. Copy:
   - **Project URL** -> set as `SUPABASE_URL`
   - **anon (public)** key -> set as `SUPABASE_ANON_KEY`
4. Paste them into `.env`:
   ```env
   SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOi...
   PORT=3000
   ADMIN_PIN=HPL2026
   ```

#### For Vercel Deployment:
1. Go to your project dashboard on [vercel.com](https://vercel.com).
2. Go to **Settings** -> **Environment Variables**.
3. Add two environment variables:
   - `SUPABASE_URL` = `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY` = `your-anon-key`
4. Click **Save** and trigger a **Redeploy** (or push a commit to `main`).

---

### 4. (Optional) Migrate Existing Local Data
To copy existing teams and players from `data/db.json` directly into your Supabase database:
```bash
node scripts/migrate.js
```
The script will insert existing teams and players into Supabase without duplicates.

---

## 🛠 Local Development Commands

```bash
# Install dependencies
npm install

# Start local development server
npm start
```
Server runs at `http://localhost:3000`.

---

## 🌟 Key Features
- **Player & Team Registrations**: Clean, responsive forms with validation and duplicate prevention.
- **Team Roster Tracking**: Linking players to their registered teams with automatic role assignment.
- **Admin Dashboard**: Click any team name to view the full squad members, roles, and captain contact.
- **Dual-mode Database**: Zero-configuration local JSON fallback + cloud PostgreSQL via Supabase.
- **Real-Time Live Updates**: SSE (Server-Sent Events) for real-time registration broadcasts.
