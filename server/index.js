'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Match, TEAM_SIZE, MATCH_TIME } = require('./game');
const { PenaltyMatch } = require('./penalty');

const PORT = process.env.PORT || 3000;
const TICK_HZ = 30;          // simulation rate
const SNAP_EVERY = 1;        // send snapshot every tick (30 Hz)
const QUEUE_WAIT_MS = 8000;  // setelah ini, sisa slot diisi bot

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ============================== LEADERBOARD ==============================
// { nama: { p: main, w: menang, d: seri, l: kalah, g: gol } }
const LB_FILE = path.join(__dirname, 'leaderboard.json');
let lb = {};
try { lb = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch (e) { /* belum ada */ }

function saveLb() {
  fs.writeFile(LB_FILE, JSON.stringify(lb, null, 2), () => {});
}
// Repeatable quests — progress carries over, rewards auto-claimed on completion
const QUESTS = [
  { id: 'goals', name: 'Goal Hunter', desc: 'Score 3 goals in 5v5', target: 3, reward: 50 },
  { id: 'wins', name: 'Serial Winner', desc: 'Win a match', target: 1, reward: 100 },
  { id: 'tackles', name: 'Clean Sweeper', desc: 'Win the ball with 5 slide tackles', target: 5, reward: 40 },
  { id: 'played', name: 'The Grinder', desc: 'Play 3 matches', target: 3, reward: 30 },
  { id: 'pgoals', name: 'Header Hero', desc: 'Score 3 goals in Head Duel', target: 3, reward: 35 },
];

function lbStats(name) {
  if (!lb[name]) lb[name] = { p: 0, w: 0, d: 0, l: 0, g: 0 };
  const s = lb[name];
  if (s.c == null) s.c = 0; // coins
  if (!s.qp) s.qp = { goals: 0, wins: 0, tackles: 0, played: 0, pgoals: 0 };
  return s;
}

function questView(s) {
  return QUESTS.map(q => ({
    name: q.name, desc: q.desc, target: q.target, reward: q.reward,
    progress: Math.min(q.target, (s.qp && s.qp[q.id]) || 0),
  }));
}
function levelOf(name) {
  const s = lb[name];
  if (!s) return 1;
  return 1 + Math.floor(s.w * 2 + s.p * 0.5 + s.g * 0.5);
}
function lbTop(n = 10) {
  return Object.entries(lb)
    .map(([name, s]) => ({ name, ...s, pts: s.w * 3 + s.d, lvl: levelOf(name) }))
    .sort((a, b) => b.pts - a.pts || b.g - a.g || a.name.localeCompare(b.name))
    .slice(0, n);
}

// ============================== KLIEN & LOBBY ==============================
let nextId = 1;
const clients = new Set(); // { ws, id, name, state: 'lobby'|'queue'|'match', match, queuedAt }

const BOT_NAMES = ['Bodhi', 'mof', 'MrBubbles', 'Rahma', 'skgz', 'jm2', 'wheezy',
  'pandahg', 'Genji', 'ItsElii', 'chop', 'Hash', '0007', 'Kintaro', 'Bayu', 'Dimas'];

function send(c, msg) {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}
function lobbySnapshot() {
  const all = [...clients].filter(c => c.name);
  return {
    t: 'lobby',
    online: all.length,
    inQueue: all.filter(c => c.state === 'queue').length,
    names: all.map(c => ({ name: c.name, lvl: levelOf(c.name), state: c.state })),
    leaderboard: lbTop(),
  };
}
function broadcastLobby() {
  const snap = lobbySnapshot();
  for (const c of clients) {
    if (c.name && c.state !== 'match') send(c, snap);
  }
}

// ============================== MATCH ==============================
const matches = new Map(); // id -> { match, members: Set<client>, timer, tickNo }
let nextMatchId = 1;

function pickBotName(usedNames) {
  let bn;
  do { bn = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; } while (usedNames.has(bn));
  usedNames.add(bn);
  return bn;
}

function startPenalty(humans) {
  const id = nextMatchId++;
  const usedNames = new Set(humans.map(h => h.name));
  const roster = ['red', 'blue'].map((team, i) => {
    const h = humans[i];
    if (h) return { id: 'c' + h.id, name: h.name, level: levelOf(h.name), bot: false, team, skin: h.skin || 0 };
    return {
      id: `b${id}_${team}`, name: pickBotName(usedNames),
      level: 1 + Math.floor(Math.random() * 20), bot: true, team,
      skin: Math.floor(Math.random() * 6),
    };
  });

  const members = new Set(humans);
  const broadcast = msg => { for (const c of members) send(c, msg); };
  const match = new PenaltyMatch(id, roster, broadcast, m => finishMatch(id, m));
  const room = { match, members, tickNo: 0, timer: null, mode: 'penalty' };
  matches.set(id, room);

  for (const h of humans) {
    h.state = 'match';
    h.match = id;
    send(h, {
      t: 'start', mode: 'penalty', matchId: id, youId: 'c' + h.id,
      roster: roster.map(r => ({ id: r.id, name: r.name, level: r.level, team: r.team, bot: r.bot, skin: r.skin })),
    });
  }

  room.timer = setInterval(() => {
    match.tick(1 / TICK_HZ);
    room.tickNo++;
    if (room.tickNo % SNAP_EVERY === 0 && match.state !== 'over') {
      broadcast(match.snapshot());
    }
  }, 1000 / TICK_HZ);

  broadcastLobby();
  console.log(`Head Soccer #${id} started: ${roster.map(r => r.name + (r.bot ? ' (bot)' : '')).join(' vs ')}`);
}

function startMatch(humans) {
  const id = nextMatchId++;
  const roster = [];
  const usedNames = new Set(humans.map(h => h.name));

  // Bagi manusia bergantian merah/biru
  humans.forEach((h, i) => { h.assignTeam = i % 2 === 0 ? 'red' : 'blue'; });

  for (const team of ['red', 'blue']) {
    const teamHumans = humans.filter(h => h.assignTeam === team);
    // Urutan peran: penyerang & gelandang dulu, kiper (idx 1) paling akhir
    // supaya manusia tidak terjebak jadi kiper kecuali timnya full manusia.
    const roleOrder = [0, 4, 2, 3, 1];
    roleOrder.forEach((idx, slot) => {
      const h = teamHumans[slot];
      if (h) {
        roster.push({ id: 'c' + h.id, name: h.name, level: levelOf(h.name), bot: false, team, idx, skin: h.skin || 0 });
      } else {
        const bn = pickBotName(usedNames);
        roster.push({
          id: `b${id}_${team}_${idx}`, name: bn,
          level: 1 + Math.floor(Math.random() * 20), bot: true, team, idx,
          skin: Math.floor(Math.random() * 6),
        });
      }
    });
  }

  const members = new Set(humans);
  const broadcast = msg => { for (const c of members) send(c, msg); };
  const match = new Match(id, roster, broadcast, m => finishMatch(id, m));
  const room = { match, members, tickNo: 0, timer: null, mode: '5v5' };
  matches.set(id, room);

  for (const h of humans) {
    h.state = 'match';
    h.match = id;
    send(h, {
      t: 'start',
      mode: '5v5',
      matchId: id,
      youId: 'c' + h.id,
      duration: MATCH_TIME,
      roster: roster.map(r => ({ id: r.id, name: r.name, level: r.level, team: r.team, bot: r.bot, skin: r.skin })),
    });
  }

  room.timer = setInterval(() => {
    match.tick(1 / TICK_HZ);
    room.tickNo++;
    if (room.tickNo % SNAP_EVERY === 0 && match.state !== 'over') {
      broadcast(match.snapshot());
    }
  }, 1000 / TICK_HZ);

  broadcastLobby();
  console.log(`Match #${id} started: ${humans.map(h => h.name).join(', ')} (+${TEAM_SIZE * 2 - humans.length} bots)`);
}

function finishMatch(id, match) {
  const room = matches.get(id);
  if (!room) return;
  clearInterval(room.timer);

  // Update leaderboard + quest progress for human players (bots don't count)
  const { red, blue } = match.score;
  const rewardsByName = new Map();
  for (const p of match.players) {
    if (p.id[0] !== 'c') continue;
    const s = lbStats(p.name);
    s.p++; s.g += p.goals;
    const my = p.team === 'red' ? red : blue;
    const op = p.team === 'red' ? blue : red;
    if (my > op) s.w++; else if (my < op) s.l++; else s.d++;

    // Quest progress
    s.qp.played++;
    if (my > op) s.qp.wins++;
    if (room.mode === 'penalty') s.qp.pgoals += p.goals;
    else { s.qp.goals += p.goals; s.qp.tackles += p.tackles || 0; }

    // Auto-claim completed quests (repeatable: progress rolls over)
    const earned = [];
    for (const q of QUESTS) {
      while (s.qp[q.id] >= q.target) {
        s.qp[q.id] -= q.target;
        s.c += q.reward;
        earned.push({ name: q.name, reward: q.reward });
      }
    }
    if (earned.length) rewardsByName.set(p.name, earned);
  }
  saveLb();

  const goalsList = match.players.filter(p => p.goals > 0)
    .map(p => ({ name: p.name, team: p.team, goals: p.goals }));
  for (const c of room.members) {
    const s = lbStats(c.name);
    send(c, {
      t: 'end',
      mode: room.mode,
      score: [red, blue],
      goals: goalsList,
      leaderboard: lbTop(),
      coins: s.c,
      rewards: rewardsByName.get(c.name) || [],
      quests: questView(s),
    });
  }
  matches.delete(id);
  for (const c of room.members) { c.state = 'lobby'; c.match = null; }
  broadcastLobby();
  console.log(`Match #${id} finished: Red ${red} - ${blue} Blue`);
}

function leaveMatch(c) {
  if (c.match == null) return;
  const room = matches.get(c.match);
  c.match = null;
  c.state = 'lobby';
  if (room) {
    room.members.delete(c);
    const stillHuman = room.match.drop('c' + c.id);
    if (!stillHuman || room.members.size === 0) {
      clearInterval(room.timer);
      matches.delete(room.match.id);
      console.log(`Match #${room.match.id} disbanded (all players left)`);
    }
  }
}

// Matchmaking: check queues every second
setInterval(() => {
  const all = [...clients].filter(c => c.state === 'queue');

  const q5 = all.filter(c => c.queueMode !== 'penalty');
  if (q5.length) {
    const oldest = Math.min(...q5.map(c => c.queuedAt));
    if (q5.length >= TEAM_SIZE * 2 || Date.now() - oldest >= QUEUE_WAIT_MS) {
      startMatch(q5.slice(0, TEAM_SIZE * 2));
    }
  }

  const qp = all.filter(c => c.queueMode === 'penalty');
  if (qp.length) {
    const oldest = Math.min(...qp.map(c => c.queuedAt));
    if (qp.length >= 2) startPenalty(qp.slice(0, 2));
    else if (Date.now() - oldest >= 5000) startPenalty(qp.slice(0, 1));
  }
}, 1000);

// ============================== WEBSOCKET ==============================
wss.on('connection', ws => {
  const c = { ws, id: nextId++, name: null, state: 'lobby', match: null, queuedAt: 0 };
  clients.add(c);
  send(c, lobbySnapshot());

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    switch (m.t) {
      case 'join': {
        const name = String(m.name || '').trim().slice(0, 12).replace(/[<>]/g, '');
        if (!name) return;
        c.name = name;
        c.skin = Math.max(0, Math.min(5, Number(m.skin) || 0));
        const st = lbStats(name);
        send(c, { t: 'joined', name, lvl: levelOf(name), stats: st.p > 0 ? st : null, coins: st.c, quests: questView(st) });
        broadcastLobby();
        break;
      }
      case 'queue':
        if (c.name && c.state === 'lobby') {
          c.state = 'queue';
          c.queueMode = m.mode === 'penalty' ? 'penalty' : '5v5';
          c.queuedAt = Date.now();
          broadcastLobby();
        }
        break;
      case 'unqueue':
        if (c.state === 'queue') { c.state = 'lobby'; broadcastLobby(); }
        break;
      case 'playBots':
        if (c.name && c.state !== 'match') {
          if (m.mode === 'penalty') startPenalty([c]);
          else startMatch([c]);
        }
        break;
      case 'input':
      case 'pinput': {
        const room = matches.get(c.match);
        if (room) room.match.setInput('c' + c.id, m);
        break;
      }
      case 'slide': {
        const room = matches.get(c.match);
        if (room && room.match.requestSlide) room.match.requestSlide('c' + c.id);
        break;
      }
      case 'dodge': {
        const room = matches.get(c.match);
        if (room && room.match.requestDodge) room.match.requestDodge('c' + c.id);
        break;
      }
      case 'kick': {
        const room = matches.get(c.match);
        if (room) room.match.requestKick('c' + c.id, m.power);
        break;
      }
      case 'leave':
        leaveMatch(c);
        send(c, lobbySnapshot());
        broadcastLobby();
        break;
    }
  });

  ws.on('close', () => {
    leaveMatch(c);
    clients.delete(c);
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`⚽ Voxel Cup server running at http://localhost:${PORT}`);
});
