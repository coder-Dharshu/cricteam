/**
 * Migration helper: Imports current db.json teams and players into Supabase PostgreSQL
 * Usage: node scripts/migrate.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in your .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

async function migrate() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('data/db.json not found.');
    return;
  }

  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const db = JSON.parse(raw);

  const teams = db.teams || [];
  const players = db.players || [];

  console.log(`Starting migration: ${teams.length} teams, ${players.length} players...`);

  // 1. Migrate Teams
  for (const t of teams) {
    const { data, error } = await supabase.from('teams').upsert({
      id: t.id,
      name: t.name,
      captain: t.captain,
      mobile: t.mobile,
      players: Array.isArray(t.players) ? t.players : [t.captain],
      registered_at: t.registeredAt || new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) {
      console.error(`Error migrating team ${t.name}:`, error.message);
    } else {
      console.log(`✓ Team migrated: ${t.name}`);
    }
  }

  // 2. Migrate Players
  for (const p of players) {
    const { data, error } = await supabase.from('players').upsert({
      id: p.id,
      name: p.name,
      mobile: p.mobile,
      role: p.role,
      team: p.team || null,
      team_id: p.teamId || null,
      registered_at: p.registeredAt || new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) {
      console.error(`Error migrating player ${p.name}:`, error.message);
    } else {
      console.log(`✓ Player migrated: ${p.name} (${p.role})`);
    }
  }

  console.log('\nMigration to Supabase completed successfully!');
}

migrate().catch(console.error);
