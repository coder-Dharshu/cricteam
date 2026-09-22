-- ============================================================
-- Honganuru Premier League (HPL) — Season 2 Database Schema
-- Run this script in your Supabase SQL Editor
-- (Dashboard -> SQL Editor -> New Query -> Run)
-- ============================================================

-- 1. Create Teams Table
CREATE TABLE IF NOT EXISTS public.teams (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    captain TEXT NOT NULL,
    mobile TEXT NOT NULL,
    players JSONB DEFAULT '[]'::jsonb,
    registered_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Create Players Table
CREATE TABLE IF NOT EXISTS public.players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('batter', 'bowler', 'keeper', 'allrounder', 'extra')),
    team TEXT,
    team_id TEXT REFERENCES public.teams(id) ON DELETE SET NULL,
    registered_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_players_mobile ON public.players(mobile);
CREATE INDEX IF NOT EXISTS idx_players_team ON public.players(team);
CREATE INDEX IF NOT EXISTS idx_players_role ON public.players(role);
CREATE INDEX IF NOT EXISTS idx_teams_name ON public.teams(name);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- 5. Set RLS Policies (Allow public tournament registration & viewing)
DROP POLICY IF EXISTS "Allow public read teams" ON public.teams;
CREATE POLICY "Allow public read teams" ON public.teams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read players" ON public.players;
CREATE POLICY "Allow public read players" ON public.players FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert teams" ON public.teams;
CREATE POLICY "Allow public insert teams" ON public.teams FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public insert players" ON public.players;
CREATE POLICY "Allow public insert players" ON public.players FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update teams" ON public.teams;
CREATE POLICY "Allow public update teams" ON public.teams FOR UPDATE USING (true) WITH CHECK (true);

-- 6. Fresh Start / Wipe All Data (Optional)
-- Run this single line in Supabase SQL Editor whenever you want to wipe all test registrations and start fresh:
-- TRUNCATE TABLE public.players, public.teams CASCADE;
