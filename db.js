/**
 * Database Layer for Honganuru Premier League (HPL) — Season 2
 * Connects to Supabase PostgreSQL with seamless automatic fallback to local db.json
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const isVercel = Boolean(process.env.VERCEL);
const DB_DIR = isVercel ? '/tmp' : path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'db.json');

// Supabase environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    console.log(`✓ Connected to Supabase PostgreSQL: ${SUPABASE_URL}`);
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
  }
} else {
  console.log('ℹ Running with local database fallback (data/db.json). Add SUPABASE_URL & SUPABASE_ANON_KEY to enable Supabase.');
}

// ----------------- LOCAL DB.JSON FALLBACK HELPERS -----------------
function readLocalDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      let initialData = { players: [], teams: [] };
      if (fs.existsSync(SEED_FILE)) {
        try { initialData = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8')); } catch (e) {}
      }
      if (isVercel && !fs.existsSync(DB_DIR)) {
        try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch (e) {}
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
      return initialData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return { players: [], teams: [] };
  }
}

function writeLocalDb(data) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing db.json:', err);
    return false;
  }
}

// Helper to calculate roster with roles
function buildRoster(team, allPlayers) {
  const teamNameLower = (team.name || '').toLowerCase();
  const teamPlayers = allPlayers.filter(p =>
    (p.teamId && p.teamId === team.id) ||
    (p.team && p.team.toLowerCase() === teamNameLower)
  );

  const squadNames = new Set();
  if (team.captain) squadNames.add(team.captain.trim());
  if (Array.isArray(team.players)) {
    team.players.forEach(pn => { if (pn && pn.trim()) squadNames.add(pn.trim()); });
  }
  teamPlayers.forEach(tp => { if (tp.name && tp.name.trim()) squadNames.add(tp.name.trim()); });

  return Array.from(squadNames).map(name => {
    const matched = teamPlayers.find(tp => tp.name.toLowerCase() === name.toLowerCase()) ||
                    allPlayers.find(p => p.name.toLowerCase() === name.toLowerCase());
    const isCaptain = Boolean(team.captain && team.captain.toLowerCase() === name.toLowerCase());

    return {
      name,
      role: matched ? matched.role : (isCaptain ? 'allrounder' : 'extra'),
      mobile: matched ? matched.mobile : (isCaptain ? team.mobile : ''),
      isCaptain,
      isRegistered: Boolean(matched)
    };
  });
}

// ----------------- UNIFIED DATABASE API -----------------
const dbAdapter = {
  isSupabase() {
    return Boolean(supabase);
  },

  // ===== PLAYERS =====
  async getPlayers(query = '') {
    const qStr = (query || '').trim().toLowerCase();

    if (supabase) {
      try {
        let q = supabase.from('players').select('*').order('registered_at', { ascending: false });
        if (qStr) {
          q = q.or(`name.ilike.%${qStr}%,mobile.ilike.%${qStr}%,team.ilike.%${qStr}%,role.ilike.%${qStr}%`);
        }
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map(p => ({
          id: p.id,
          name: p.name,
          mobile: p.mobile,
          role: p.role,
          team: p.team || '',
          teamId: p.team_id || undefined,
          registeredAt: p.registered_at
        }));
      } catch (err) {
        console.error('Supabase getPlayers error, falling back to local:', err.message);
      }
    }

    // Local fallback
    const local = readLocalDb();
    let players = local.players || [];
    if (qStr) {
      players = players.filter(p =>
        (p.name && p.name.toLowerCase().includes(qStr)) ||
        (p.mobile && p.mobile.includes(qStr)) ||
        (p.team && p.team.toLowerCase().includes(qStr)) ||
        (p.role && p.role.toLowerCase().includes(qStr))
      );
    }
    return players.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  },

  async findPlayerByMobile(mobile) {
    const cleanMobile = String(mobile || '').replace(/\D/g, '');

    if (supabase) {
      try {
        const { data, error } = await supabase.from('players').select('*').eq('mobile', cleanMobile).maybeSingle();
        if (error) throw error;
        if (data) {
          return {
            id: data.id,
            name: data.name,
            mobile: data.mobile,
            role: data.role,
            team: data.team || '',
            teamId: data.team_id || undefined,
            registeredAt: data.registered_at
          };
        }
        return null;
      } catch (err) {
        console.error('Supabase findPlayerByMobile error, falling back to local:', err.message);
      }
    }

    const local = readLocalDb();
    return (local.players || []).find(p => p.mobile === cleanMobile) || null;
  },

  async createPlayer({ name, mobile, role, team }) {
    const cleanMobile = String(mobile || '').replace(/\D/g, '');
    const cleanName = name.trim();
    const cleanTeam = (team || '').trim();
    const nowIso = new Date().toISOString();
    const newId = 'p-' + Date.now();

    if (supabase) {
      try {
        let matchedTeam = null;
        if (cleanTeam) {
          const { data: teamData } = await supabase.from('teams').select('*').ilike('name', cleanTeam).maybeSingle();
          matchedTeam = teamData;
        }

        const newP = {
          id: newId,
          name: cleanName,
          mobile: cleanMobile,
          role,
          team: matchedTeam ? matchedTeam.name : (cleanTeam || null),
          team_id: matchedTeam ? matchedTeam.id : null,
          registered_at: nowIso
        };

        const { error: insertError } = await supabase.from('players').insert([newP]);
        if (insertError) throw insertError;

        // If registered for an existing team, ensure player is inside team's players JSON list
        if (matchedTeam) {
          const currentSquad = Array.isArray(matchedTeam.players) ? matchedTeam.players : [];
          if (!currentSquad.some(pn => pn.toLowerCase() === cleanName.toLowerCase())) {
            currentSquad.push(cleanName);
            await supabase.from('teams').update({ players: currentSquad }).eq('id', matchedTeam.id);
          }
        }

        return {
          id: newP.id,
          name: newP.name,
          mobile: newP.mobile,
          role: newP.role,
          team: newP.team || '',
          teamId: newP.team_id || undefined,
          registeredAt: newP.registered_at
        };
      } catch (err) {
        console.error('Supabase createPlayer error, falling back to local:', err.message);
      }
    }

    // Local fallback
    const local = readLocalDb();
    local.players = local.players || [];
    local.teams = local.teams || [];

    let matchedTeam = null;
    if (cleanTeam) {
      matchedTeam = local.teams.find(t => t.name.toLowerCase() === cleanTeam.toLowerCase());
    }

    const localPlayer = {
      id: newId,
      name: cleanName,
      mobile: cleanMobile,
      role,
      team: matchedTeam ? matchedTeam.name : cleanTeam,
      teamId: matchedTeam ? matchedTeam.id : undefined,
      registeredAt: nowIso
    };

    local.players.push(localPlayer);
    if (matchedTeam) {
      if (!Array.isArray(matchedTeam.players)) matchedTeam.players = [];
      if (!matchedTeam.players.some(pn => pn.toLowerCase() === cleanName.toLowerCase())) {
        matchedTeam.players.push(cleanName);
      }
    }
    writeLocalDb(local);
    return localPlayer;
  },

  // ===== TEAMS =====
  async getTeams(query = '') {
    const qStr = (query || '').trim().toLowerCase();

    if (supabase) {
      try {
        const { data: teamsData, error: tErr } = await supabase.from('teams').select('*').order('registered_at', { ascending: false });
        if (tErr) throw tErr;

        const { data: playersData, error: pErr } = await supabase.from('players').select('*');
        if (pErr) throw pErr;

        const mappedPlayers = (playersData || []).map(p => ({
          id: p.id,
          name: p.name,
          mobile: p.mobile,
          role: p.role,
          team: p.team || '',
          teamId: p.team_id || undefined,
          registeredAt: p.registered_at
        }));

        let enriched = (teamsData || []).map(t => {
          const teamObj = {
            id: t.id,
            name: t.name,
            captain: t.captain,
            mobile: t.mobile,
            players: Array.isArray(t.players) ? t.players : [],
            registeredAt: t.registered_at
          };
          const roster = buildRoster(teamObj, mappedPlayers);
          return {
            ...teamObj,
            roster,
            playerCount: roster.length
          };
        });

        if (qStr) {
          enriched = enriched.filter(t =>
            (t.name && t.name.toLowerCase().includes(qStr)) ||
            (t.captain && t.captain.toLowerCase().includes(qStr)) ||
            (t.mobile && t.mobile.includes(qStr)) ||
            (t.roster && t.roster.some(m => m.name.toLowerCase().includes(qStr) || m.role.toLowerCase().includes(qStr)))
          );
        }

        return enriched;
      } catch (err) {
        console.error('Supabase getTeams error, falling back to local:', err.message);
      }
    }

    // Local fallback
    const local = readLocalDb();
    const teams = local.teams || [];
    const players = local.players || [];

    let enriched = teams.map(t => {
      const roster = buildRoster(t, players);
      return {
        ...t,
        roster,
        playerCount: roster.length
      };
    });

    if (qStr) {
      enriched = enriched.filter(t =>
        (t.name && t.name.toLowerCase().includes(qStr)) ||
        (t.captain && t.captain.toLowerCase().includes(qStr)) ||
        (t.mobile && t.mobile.includes(qStr)) ||
        (t.roster && t.roster.some(m => m.name.toLowerCase().includes(qStr) || m.role.toLowerCase().includes(qStr)))
      );
    }

    return enriched.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  },

  async findTeamByName(name) {
    const cleanName = (name || '').trim();

    if (supabase) {
      try {
        const { data, error } = await supabase.from('teams').select('*').ilike('name', cleanName).maybeSingle();
        if (error) throw error;
        return data || null;
      } catch (err) {
        console.error('Supabase findTeamByName error, falling back to local:', err.message);
      }
    }

    const local = readLocalDb();
    return (local.teams || []).find(t => t.name.toLowerCase() === cleanName.toLowerCase()) || null;
  },

  async createTeam({ name, captain, mobile, players }) {
    const cleanName = name.trim();
    const cleanCaptain = captain.trim();
    const cleanMobile = String(mobile || '').replace(/\D/g, '');
    const nowIso = new Date().toISOString();
    const newId = 't-' + Date.now();

    const squadList = Array.isArray(players) ? players : (players ? String(players).split(',').map(s=>s.trim()).filter(Boolean) : []);
    if (!squadList.some(pn => pn.toLowerCase() === cleanCaptain.toLowerCase())) {
      squadList.unshift(cleanCaptain);
    }

    if (supabase) {
      try {
        const newT = {
          id: newId,
          name: cleanName,
          captain: cleanCaptain,
          mobile: cleanMobile,
          players: squadList,
          registered_at: nowIso
        };
        const { error } = await supabase.from('teams').insert([newT]);
        if (error) throw error;

        return {
          id: newT.id,
          name: newT.name,
          captain: newT.captain,
          mobile: newT.mobile,
          players: newT.players,
          registeredAt: newT.registered_at
        };
      } catch (err) {
        console.error('Supabase createTeam error, falling back to local:', err.message);
      }
    }

    // Local fallback
    const local = readLocalDb();
    local.teams = local.teams || [];

    const localTeam = {
      id: newId,
      name: cleanName,
      captain: cleanCaptain,
      mobile: cleanMobile,
      players: squadList,
      registeredAt: nowIso
    };

    local.teams.push(localTeam);
    writeLocalDb(local);
    return localTeam;
  },

  // ===== STATS =====
  async getStats() {
    const players = await this.getPlayers();
    const teams = await this.getTeams();

    const roles = {
      batter: 0,
      bowler: 0,
      keeper: 0,
      allrounder: 0,
      extra: 0
    };

    players.forEach(p => {
      if (roles[p.role] !== undefined) {
        roles[p.role]++;
      }
    });

    return {
      totalPlayers: players.length,
      roles,
      totalTeams: teams.length,
      database: supabase ? 'supabase-postgres' : 'local-json'
    };
  },

  // ===== RESET / CLEAR ALL DATA =====
  async resetAllData() {
    if (supabase) {
      try {
        await supabase.from('players').delete().neq('id', '');
        await supabase.from('teams').delete().neq('id', '');
      } catch (err) {
        console.error('Supabase resetAllData error:', err.message);
      }
    }
    writeLocalDb({ players: [], teams: [] });
    return { success: true, message: 'All tournament player and team data has been reset.' };
  }
};

module.exports = dbAdapter;
