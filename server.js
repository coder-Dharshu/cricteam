const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = Boolean(process.env.VERCEL);
const DB_DIR = isVercel ? '/tmp' : path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'db.json');

// Ensure data directory and initial db.json exist (skip on Vercel read-only root)
if (!isVercel && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      let initialData = { players: [], teams: [] };
      if (fs.existsSync(SEED_FILE)) {
        try {
          initialData = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
        } catch (e) {}
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

function writeDb(data) {
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

// Helper: Calculate aggregate tournament stats
function computeStats(db) {
  const players = db.players || [];
  const teams = db.teams || [];

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
    totalTeams: teams.length
  };
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// Admin PIN configuration
const ADMIN_PIN = process.env.ADMIN_PIN || 'HPL2026';

// ----------------- REAL-TIME SERVER-SENT EVENTS (SSE) -----------------
const sseClients = new Set();

function broadcastEvent(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Periodic keep-alive comment every 25 seconds (for persistent server environments)
if (!isVercel) {
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(`: keep-alive\n\n`);
      } catch (e) {
        sseClients.delete(client);
      }
    }
  }, 25000);
}

// SSE Stream Endpoint
app.get('/api/events', (req, res) => {
  if (isVercel) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'close'
    });
    const db = readDb();
    res.write(`event: sync\ndata: ${JSON.stringify({ type: 'sync', data: { stats: computeStats(db) } })}\n\n`);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to HPL Live Stream', timestamp: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  // Send immediate initial sync
  const db = readDb();
  const initialData = {
    stats: computeStats(db)
  };
  res.write(`event: sync\ndata: ${JSON.stringify({ type: 'sync', data: initialData })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ----------------- API ENDPOINTS -----------------

// Health & System Info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    tournament: 'Honganuru Premier League (HPL) — Season 2',
    timestamp: new Date().toISOString(),
    liveConnections: sseClients.size
  });
});

// Tournament Stats
app.get('/api/stats', (req, res) => {
  const db = readDb();
  res.json(computeStats(db));
});

// Players API
app.get('/api/players', (req, res) => {
  const db = readDb();
  let players = db.players || [];
  const q = (req.query.q || '').trim().toLowerCase();

  if (q) {
    players = players.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.mobile && p.mobile.includes(q)) ||
      (p.role && p.role.toLowerCase().includes(q))
    );
  }

  players = players.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  res.json(players);
});

app.post('/api/players', (req, res) => {
  const { name, mobile, role, team } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Player name must be at least 2 characters.' });
  }
  const cleanMobile = String(mobile || '').replace(/\D/g, '');
  if (cleanMobile.length !== 10) {
    return res.status(400).json({ error: 'A valid 10-digit mobile number is required.' });
  }
  const validRoles = ['batter', 'bowler', 'keeper', 'allrounder', 'extra'];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Please select a valid playing role.' });
  }

  const db = readDb();
  db.players = db.players || [];
  db.teams = db.teams || [];

  const exists = db.players.find(p => p.mobile === cleanMobile);
  if (exists) {
    return res.status(409).json({
      error: 'You have already registered for Honganuru Premier League – Season 2.'
    });
  }

  const cleanTeam = (team || '').trim();
  let matchedTeam = null;
  if (cleanTeam) {
    matchedTeam = db.teams.find(t => t.name.toLowerCase() === cleanTeam.toLowerCase());
  }

  const newPlayer = {
    id: 'p-' + Date.now(),
    name: name.trim(),
    mobile: cleanMobile,
    role,
    team: matchedTeam ? matchedTeam.name : cleanTeam,
    teamId: matchedTeam ? matchedTeam.id : undefined,
    registeredAt: new Date().toISOString()
  };

  db.players.push(newPlayer);

  // If player registered for an existing team, ensure they appear in the team's squad list
  if (matchedTeam) {
    if (!Array.isArray(matchedTeam.players)) matchedTeam.players = [];
    if (!matchedTeam.players.some(pn => pn.toLowerCase() === name.trim().toLowerCase())) {
      matchedTeam.players.push(name.trim());
    }
  }

  writeDb(db);

  const stats = computeStats(db);
  broadcastEvent('player_registered', { player: newPlayer, stats });

  res.status(201).json({
    success: true,
    message: 'Player registered successfully for Honganuru Premier League Season 2!',
    player: newPlayer,
    stats
  });
});

// Teams API (Includes squad roster and member playing roles)
app.get('/api/teams', (req, res) => {
  const db = readDb();
  let teams = db.teams || [];
  const players = db.players || [];
  const q = (req.query.q || '').trim().toLowerCase();

  // Enrich each team with full member list and their roles
  let enrichedTeams = teams.map(t => {
    const teamNameLower = (t.name || '').toLowerCase();
    // Find all players registered specifically under this team
    const teamPlayers = players.filter(p =>
      (p.teamId && p.teamId === t.id) ||
      (p.team && p.team.toLowerCase() === teamNameLower)
    );

    // Collect all unique member names from team squad and individual registrations
    const squadNames = new Set();
    if (t.captain) squadNames.add(t.captain.trim());
    if (Array.isArray(t.players)) {
      t.players.forEach(pn => { if (pn && pn.trim()) squadNames.add(pn.trim()); });
    }
    teamPlayers.forEach(tp => { if (tp.name && tp.name.trim()) squadNames.add(tp.name.trim()); });

    // Map each member to their known role and contact details
    const roster = Array.from(squadNames).map(name => {
      const matched = teamPlayers.find(tp => tp.name.toLowerCase() === name.toLowerCase()) ||
                      players.find(p => p.name.toLowerCase() === name.toLowerCase());
      const isCaptain = Boolean(t.captain && t.captain.toLowerCase() === name.toLowerCase());

      return {
        name,
        role: matched ? matched.role : (isCaptain ? 'allrounder' : 'extra'),
        mobile: matched ? matched.mobile : (isCaptain ? t.mobile : ''),
        isCaptain,
        isRegistered: Boolean(matched)
      };
    });

    return {
      ...t,
      roster,
      playerCount: roster.length
    };
  });

  if (q) {
    enrichedTeams = enrichedTeams.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.captain && t.captain.toLowerCase().includes(q)) ||
      (t.mobile && t.mobile.includes(q)) ||
      (t.roster && t.roster.some(m => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)))
    );
  }

  enrichedTeams = enrichedTeams.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
  res.json(enrichedTeams);
});

app.post('/api/teams', (req, res) => {
  const { name, captain, mobile, ground, players } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Team name must be at least 2 characters.' });
  }
  if (!captain || captain.trim().length < 2) {
    return res.status(400).json({ error: 'Captain name must be at least 2 characters.' });
  }
  const cleanMobile = String(mobile || '').replace(/\D/g, '');
  if (cleanMobile.length !== 10) {
    return res.status(400).json({ error: 'A valid 10-digit captain mobile number is required.' });
  }

  const db = readDb();
  db.teams = db.teams || [];

  const exists = db.teams.find(t => t.name.toLowerCase() === name.trim().toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'A team with this name has already been registered.' });
  }

  // Parse squad players
  const squadList = Array.isArray(players) ? players : (players ? String(players).split(',').map(s=>s.trim()).filter(Boolean) : []);
  if (!squadList.some(pn => pn.toLowerCase() === captain.trim().toLowerCase())) {
    squadList.unshift(captain.trim());
  }

  const newTeam = {
    id: 't-' + Date.now(),
    name: name.trim(),
    captain: captain.trim(),
    mobile: cleanMobile,
    ground: (ground || '').trim(),
    players: squadList,
    registeredAt: new Date().toISOString()
  };

  db.teams.push(newTeam);
  writeDb(db);

  const stats = computeStats(db);
  broadcastEvent('team_registered', { team: newTeam, stats });

  res.status(201).json({
    success: true,
    message: 'Team registered successfully for Honganuru Premier League Season 2!',
    team: newTeam,
    stats
  });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) {
    res.json({
      success: true,
      token: 'hpl-auth-' + Buffer.from(pin).toString('base64'),
      message: 'Admin authorization granted.'
    });
  } else {
    res.status(401).json({
      success: false,
      error: 'Incorrect admin PIN. Try again.'
    });
  }
});

// Fallback to index.html for single page navigation
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.sendFile(path.join(__dirname, 'hpl_season2 (1).html'));
  }
});

// Start Server when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  Honganuru Premier League (HPL) — Season 2 Server  `);
    console.log(`  Real-Time SSE & REST API active at port ${PORT}  `);
    console.log(`====================================================`);
  });
}

module.exports = app;
