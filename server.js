const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = Boolean(process.env.VERCEL);

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
app.get('/api/events', async (req, res) => {
  const stats = await db.getStats();

  if (isVercel) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'close'
    });
    res.write(`event: sync\ndata: ${JSON.stringify({ type: 'sync', data: { stats } })}\n\n`);
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
  res.write(`event: sync\ndata: ${JSON.stringify({ type: 'sync', data: { stats } })}\n\n`);

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
    database: db.isSupabase() ? 'Supabase PostgreSQL' : 'Local JSON Fallback',
    timestamp: new Date().toISOString(),
    liveConnections: sseClients.size
  });
});

// Tournament Stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute tournament stats' });
  }
});

// Players API
app.get('/api/players', async (req, res) => {
  try {
    const players = await db.getPlayers(req.query.q);
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

app.post('/api/players', async (req, res) => {
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

  try {
    const exists = await db.findPlayerByMobile(cleanMobile);
    if (exists) {
      return res.status(409).json({
        error: 'You have already registered for Honganuru Premier League – Season 2.'
      });
    }

    const newPlayer = await db.createPlayer({ name, mobile: cleanMobile, role, team });
    const stats = await db.getStats();
    broadcastEvent('player_registered', { player: newPlayer, stats });

    res.status(201).json({
      success: true,
      message: 'Player registered successfully for Honganuru Premier League Season 2!',
      player: newPlayer,
      stats
    });
  } catch (err) {
    console.error('Player registration error:', err);
    res.status(500).json({ error: 'Player registration failed. Please try again.' });
  }
});

// Teams API (Includes squad roster and member playing roles)
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await db.getTeams(req.query.q);
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

app.post('/api/teams', async (req, res) => {
  const { name, captain, mobile, players } = req.body;

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

  try {
    const exists = await db.findTeamByName(name);
    if (exists) {
      return res.status(409).json({ error: 'A team with this name has already been registered.' });
    }

    const newTeam = await db.createTeam({ name, captain, mobile: cleanMobile, players });
    const stats = await db.getStats();
    broadcastEvent('team_registered', { team: newTeam, stats });

    res.status(201).json({
      success: true,
      message: 'Team registered successfully for Honganuru Premier League Season 2!',
      team: newTeam,
      stats
    });
  } catch (err) {
    console.error('Team registration error:', err);
    res.status(500).json({ error: 'Team registration failed. Please try again.' });
  }
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
