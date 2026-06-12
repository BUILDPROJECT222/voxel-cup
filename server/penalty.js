'use strict';

// Head Soccer 1v1 — adu sundul bola kamera samping, dua gawang kiri-kanan.
// Semua simulasi berjalan di server (otoritatif).
// Koordinat: X = horizontal (kiri-kanan), Y = vertikal (atas-bawah, gravitasi).
// Z tidak dipakai (side-view).

const FIELD_W = 28;        // lebar lapangan (satuan dunia)
const FIELD_H = 10;        // tinggi area bermain
const GROUND_Y = 0;        // tanah
const GRAVITY = -22;       // gravitasi (negatif = ke bawah)
const GOAL_W = 1.2;        // lebar tiang gawang
const GOAL_H = 4.2;        // tinggi gawang
const BALL_R = 0.45;       // radius bola
const HEAD_R = 0.95;       // radius kepala besar (gaya Sports Heads)
const BODY_H = 0.55;       // jarak kaki ke dasar kepala (tanpa badan)
const PLAYER_SPEED = 8;    // lebih cepat & responsif
const JUMP_POWER = 14;     // lompatan lebih tinggi
const AIR_CONTROL = 0.85;  // kendali horizontal saat di udara
const KICK_RADIUS = 1.6;
const KICK_POWER = 14;
const MATCH_TIME = 90;     // detik
const WIN_GOALS = 5;       // first to N goals

// Power-up: muncul melayang di lapangan, ditangkap dengan menyentuh
const POWERUP_TYPES = ['speed', 'jump', 'bighead', 'freeze', 'bigball'];
const POWERUP_DUR = 6;     // durasi efek (detik)
const POWERUP_R = 0.7;     // radius tangkap

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class PenaltyMatch {
  constructor(id, roster, broadcast, onEnd) {
    this.id = id;
    this.broadcast = broadcast;
    this.onEnd = onEnd;
    this.state = 'countdown'; // countdown, play, goal, over
    this.time = MATCH_TIME;
    this.score = { red: 0, blue: 0 };
    this.goalTimer = 0;
    this.countdownTimer = 3;
    this.countdownVal = 3;

    // Dua pemain: red di kiri, blue di kanan
    this.players = roster.map((r, i) => ({
      id: r.id, name: r.name, level: r.level, bot: r.bot, team: r.team,
      x: 0, y: GROUND_Y, vx: 0, vy: 0,
      facing: i === 0 ? 1 : -1, // 1 = hadap kanan, -1 = hadap kiri
      headR: HEAD_R,
      kicking: false, kickCd: 0,
      goals: 0,
      input: { dx: 0, jump: false, kick: false },
      jumpPressed: false, // edge detect
      kickPressed: false, // edge detect
      // efek power-up (sisa waktu dalam detik)
      effSpeed: 0, effJump: 0, effBigHead: 0, frozen: 0,
    }));

    this.ball = {
      x: 0, y: 5, vx: 0, vy: 0, r: BALL_R, spin: 0,
    };

    // Power-up melayang & timer kemunculan
    this.powerup = null;
    this.powerupTimer = 6 + Math.random() * 4;
    this.bigBall = 0;

    this.resetPositions();
  }

  resetPositions() {
    const halfW = FIELD_W / 2;
    // Red (kiri) mulai di 1/4 kiri, Blue (kanan) di 1/4 kanan
    this.players[0].x = -halfW * 0.45;
    this.players[0].y = GROUND_Y;
    this.players[0].vx = 0;
    this.players[0].vy = 0;
    this.players[0].facing = 1;

    this.players[1].x = halfW * 0.45;
    this.players[1].y = GROUND_Y;
    this.players[1].vx = 0;
    this.players[1].vy = 0;
    this.players[1].facing = -1;

    // Bola di tengah atas
    this.ball.x = 0;
    this.ball.y = 6;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.spin = 0;
  }

  setInput(id, m) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot) return;
    if (m.dx !== undefined) p.input.dx = clamp(Number(m.dx) || 0, -1, 1);
    if (m.jump !== undefined) p.input.jump = !!m.jump;
    if (m.kick !== undefined) p.input.kick = !!m.kick;
  }

  requestKick(id, power) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot) return;
    if (this.state !== 'play') return;
    if (p.kickCd <= 0) {
      p.kicking = true;
      p.kickCd = 0.5;
    }
  }

  requestSlide() { /* not used in head soccer */ }
  requestDodge() { /* not used in head soccer */ }

  // ========== BOT AI ==========
  aiUpdate(p, dt) {
    const b = this.ball;
    const otherGoalX = p.team === 'red' ? FIELD_W / 2 : -FIELD_W / 2;
    const ownGoalX = p.team === 'red' ? -FIELD_W / 2 : FIELD_W / 2;
    const facingDir = p.team === 'red' ? 1 : -1;

    const headY = p.y + BODY_H + HEAD_R;

    // Kalau ada power-up cukup dekat & bola tidak mengancam gawang, sambar dulu
    let targetX = b.x, targetY = b.y;
    if (this.powerup && Math.abs(this.powerup.x - p.x) < 8 && Math.abs(b.x - ownGoalX) > 6) {
      targetX = this.powerup.x;
      targetY = this.powerup.y;
    }

    const dx = targetX - p.x;

    // Gerak ke arah target
    if (Math.abs(dx) > 0.5) {
      p.input.dx = dx > 0 ? 1 : -1;
    } else {
      p.input.dx = 0;
    }

    // Lompat kalau target di atas
    if (targetY > headY + 0.5 && Math.abs(dx) < 3 && p.y <= GROUND_Y + 0.05) {
      p.input.jump = true;
    } else {
      p.input.jump = false;
    }

    // Tendang kalau dekat bola
    const distBall = Math.hypot(dx, b.y - p.y);
    if (distBall < KICK_RADIUS + BALL_R + 0.3 && p.kickCd <= 0) {
      p.kicking = true;
      p.kickCd = 0.5;
    }

    // Kalau bola di belakang (dekat gawang sendiri), prioritas mundur
    const ballToOwnGoal = Math.abs(b.x - ownGoalX);
    if (ballToOwnGoal < 5) {
      // Lebih agresif mendekati bola
      p.input.dx = dx > 0 ? 1 : -1;
      if (p.y <= GROUND_Y + 0.05 && Math.abs(dx) < 2.5 && b.y > headY) {
        p.input.jump = true;
      }
    }
  }

  // ========== PHYSICS ==========
  updatePlayer(p, dt) {
    // Cooldowns & efek power-up
    if (p.kickCd > 0) p.kickCd -= dt;
    if (p.kickCd < 0.3) p.kicking = false;
    if (p.effSpeed > 0) p.effSpeed -= dt;
    if (p.effJump > 0) p.effJump -= dt;
    if (p.effBigHead > 0) p.effBigHead -= dt;
    p.headR = p.effBigHead > 0 ? HEAD_R * 1.7 : HEAD_R;

    // Dibekukan power-up lawan: tidak bisa bergerak
    if (p.frozen > 0) {
      p.frozen -= dt;
      p.vx = 0;
      p.vy += GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y < GROUND_Y) { p.y = GROUND_Y; p.vy = 0; }
      return;
    }

    const speed = PLAYER_SPEED * (p.effSpeed > 0 ? 1.6 : 1);
    const jump = JUMP_POWER * (p.effJump > 0 ? 1.3 : 1);
    const onGround = p.y <= GROUND_Y + 0.1;

    // Edge detection for jump
    if (p.input.jump && !p.jumpPressed && onGround) {
      p.vy = jump;
      p.jumpPressed = true;
    }
    if (!p.input.jump) p.jumpPressed = false;

    // Horizontal movement — penuh di darat, sedikit berkurang di udara
    const targetVx = p.input.dx * speed;
    if (onGround) p.vx = targetVx;
    else p.vx += (targetVx * AIR_CONTROL - p.vx) * Math.min(1, dt * 10);

    // Update facing direction
    if (p.input.dx > 0) p.facing = 1;
    else if (p.input.dx < 0) p.facing = -1;

    // Gravity
    p.vy += GRAVITY * dt;

    // Apply velocity
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Ground collision
    if (p.y < GROUND_Y) {
      p.y = GROUND_Y;
      p.vy = 0;
    }

    // Ceiling
    if (p.y + BODY_H + HEAD_R * 2 > FIELD_H) {
      p.y = FIELD_H - BODY_H - HEAD_R * 2;
      p.vy = 0;
    }

    const halfW = FIELD_W / 2;
    // Wall boundaries — pemain tidak bisa keluar dari gawang+sedikit
    const minX = -halfW + GOAL_W + HEAD_R * 0.5;
    const maxX = halfW - GOAL_W - HEAD_R * 0.5;
    p.x = clamp(p.x, minX, maxX);
  }

  updateBall(dt) {
    const b = this.ball;
    if (this.bigBall > 0) this.bigBall -= dt;
    b.r = BALL_R * (this.bigBall > 0 ? 1.7 : 1);

    // Gravity
    b.vy += GRAVITY * dt * 0.85;

    // Air friction
    b.vx *= Math.pow(0.998, dt * 60);
    b.vy *= Math.pow(0.999, dt * 60);

    // Apply velocity
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += b.vx * 0.08;

    const halfW = FIELD_W / 2;

    // Ground bounce
    if (b.y < GROUND_Y + b.r) {
      b.y = GROUND_Y + b.r;
      if (Math.abs(b.vy) > 1) {
        b.vy *= -0.65;
      } else {
        b.vy = 0;
      }
      b.vx *= 0.92; // ground friction
    }

    // Ceiling bounce
    if (b.y > FIELD_H - b.r) {
      b.y = FIELD_H - b.r;
      b.vy *= -0.5;
    }

    // Goal detection — bola masuk gawang kiri atau kanan
    const inGoalHeight = b.y - b.r < GOAL_H;

    // Crossbar collision (tiang atas gawang)
    for (const gx of [-halfW, halfW]) {
      // Crossbar di (gx, GOAL_H)
      const cdx = b.x - gx;
      const cdy = b.y - GOAL_H;
      const cd = Math.hypot(cdx, cdy);
      if (cd < b.r + 0.2 && cd > 0) {
        const nx = cdx / cd, ny = cdy / cd;
        b.x = gx + nx * (b.r + 0.2);
        b.y = GOAL_H + ny * (b.r + 0.2);
        const dot = b.vx * nx + b.vy * ny;
        b.vx -= 1.6 * dot * nx;
        b.vy -= 1.6 * dot * ny;
      }

      // Tiang vertikal (post) — hanya di area atas GOAL_H
      if (Math.abs(b.x - gx) < b.r + 0.15 && b.y > GOAL_H) {
        if (b.x < gx) b.x = gx - b.r - 0.15;
        else b.x = gx + b.r + 0.15;
        b.vx *= -0.6;
      }
    }

    // Left wall / left goal
    if (b.x < -halfW + b.r) {
      if (inGoalHeight) {
        // Masuk gawang kiri — gol untuk blue (tim kanan)
        if (b.x < -halfW - 1.5) {
          this.scoreGoal('blue');
          return;
        }
        // Back net
        if (b.x < -halfW - 1) {
          b.x = -halfW - 1;
          b.vx *= -0.2;
        }
      } else {
        b.x = -halfW + b.r;
        b.vx *= -0.7;
      }
    }

    // Right wall / right goal
    if (b.x > halfW - b.r) {
      if (inGoalHeight) {
        // Masuk gawang kanan — gol untuk red (tim kiri)
        if (b.x > halfW + 1.5) {
          this.scoreGoal('red');
          return;
        }
        // Back net
        if (b.x > halfW + 1) {
          b.x = halfW + 1;
          b.vx *= -0.2;
        }
      } else {
        b.x = halfW - b.r;
        b.vx *= -0.7;
      }
    }
  }

  collideBallPlayer(p) {
    const b = this.ball;
    // Head center
    const headX = p.x;
    const headY = p.y + BODY_H + HEAD_R;

    const dx = b.x - headX;
    const dy = b.y - headY;
    const d = Math.hypot(dx, dy);
    const minD = b.r + p.headR;

    if (d < minD && d > 0.01) {
      // Sundulan — bounce bola dari kepala
      const nx = dx / d, ny = dy / d;
      // Pindahkan bola keluar
      b.x = headX + nx * minD;
      b.y = headY + ny * minD;

      // Kecepatan sundulan
      const power = 9;
      b.vx = nx * power + p.vx * 0.5;
      b.vy = ny * power + p.vy * 0.3;
      if (b.vy < 1) b.vy = 2; // minimal ke atas sedikit
    }

    // Kick (tendang) — area di depan badan pemain
    if (p.kicking && p.kickCd > 0.2) {
      const kickX = p.x + p.facing * 0.8;
      const kickY = p.y + BODY_H * 0.4;
      const kd = Math.hypot(b.x - kickX, b.y - kickY);

      if (kd < KICK_RADIUS + b.r) {
        const angle = Math.atan2(b.y - kickY, b.x - kickX);
        b.vx = Math.cos(angle) * KICK_POWER + p.facing * 4;
        b.vy = Math.sin(angle) * KICK_POWER * 0.7 + 3; // sedikit ke atas
        p.kicking = false;
      }
    }

    // Body collision (badan di bawah kepala)
    const bodyTop = p.y + BODY_H;
    const bodyBot = p.y;
    const bodyHalfW = 0.4;

    if (b.x > p.x - bodyHalfW - b.r && b.x < p.x + bodyHalfW + b.r &&
        b.y > bodyBot - b.r && b.y < bodyTop + b.r) {
      // Push ball away from body
      const pushX = b.x - p.x;
      if (Math.abs(pushX) > 0.01) {
        b.vx += (pushX > 0 ? 1 : -1) * 5;
        b.vy += 2;
      }
    }
  }

  collidePlayers() {
    const a = this.players[0], c = this.players[1];
    // Hanya saling dorong jika berdiri di ketinggian yang mirip.
    // Kalau salah satu sedang melompat tinggi, dia bisa melewati lawan.
    if (Math.abs(a.y - c.y) > HEAD_R * 1.5) return;
    const dx = c.x - a.x;
    const d = Math.abs(dx);
    const minD = HEAD_R * 1.7;
    if (d < minD && d > 0.01) {
      const push = (minD - d) / 2;
      a.x -= Math.sign(dx) * push;
      c.x += Math.sign(dx) * push;
    }
  }

  // ========== POWER-UPS ==========
  spawnPowerup() {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const halfW = FIELD_W / 2;
    this.powerup = {
      type,
      x: (Math.random() * 2 - 1) * halfW * 0.55,
      y: 2.2 + Math.random() * 3,
      bob: Math.random() * Math.PI * 2,
    };
    this.broadcast({ t: 'pspawn', powerup: this.powerup.type });
  }

  applyPowerup(p, type) {
    const opp = this.players[p === this.players[0] ? 1 : 0];
    switch (type) {
      case 'speed': p.effSpeed = POWERUP_DUR; break;
      case 'jump': p.effJump = POWERUP_DUR; break;
      case 'bighead': p.effBigHead = POWERUP_DUR; break;
      case 'freeze': opp.frozen = 1.6; break;
      case 'bigball': this.bigBall = POWERUP_DUR; break;
    }
    this.broadcast({ t: 'pgrab', type, by: p.name, team: p.team });
  }

  updatePowerup(dt) {
    if (!this.powerup) {
      this.powerupTimer -= dt;
      if (this.powerupTimer <= 0) {
        this.spawnPowerup();
        this.powerupTimer = 9 + Math.random() * 5;
      }
      return;
    }
    this.powerup.bob += dt * 2;
    // Tertangkap bila kepala/badan pemain menyentuhnya
    for (const p of this.players) {
      const headY = p.y + BODY_H + HEAD_R;
      const d = Math.hypot(this.powerup.x - p.x, this.powerup.y - headY);
      if (d < POWERUP_R + p.headR) {
        this.applyPowerup(p, this.powerup.type);
        this.powerup = null;
        this.powerupTimer = 9 + Math.random() * 5;
        return;
      }
    }
  }

  scoreGoal(team) {
    if (this.state !== 'play') return;

    this.score[team]++;
    const scorer = team === 'red' ? this.players[0] : this.players[1];
    scorer.goals++;

    this.broadcast({
      t: 'pround',
      team,
      result: 'goal',
      shooter: scorer.name,
      score: [this.score.red, this.score.blue],
    });

    // Cek menang
    if (this.score.red >= WIN_GOALS || this.score.blue >= WIN_GOALS) {
      this.state = 'over';
      this.onEnd(this);
      return;
    }

    this.state = 'goal';
    this.goalTimer = 2;
  }

  // ========== MAIN TICK ==========
  tick(dt) {
    if (this.state === 'over') return;

    if (this.state === 'countdown') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdownVal--;
        this.countdownTimer = 1;
        if (this.countdownVal < 0) {
          this.state = 'play';
        }
      }
      return;
    }

    if (this.state === 'goal') {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        this.resetPositions();
        // bersihkan efek & power-up saat kickoff ulang
        this.powerup = null;
        this.bigBall = 0;
        for (const p of this.players) { p.effSpeed = 0; p.effJump = 0; p.effBigHead = 0; p.frozen = 0; }
        this.state = 'countdown';
        this.countdownVal = 2; // shorter countdown after goal
        this.countdownTimer = 1;
      }
      return;
    }

    // === state === 'play' ===
    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      this.state = 'over';
      this.onEnd(this);
      return;
    }

    // Update bot AI
    for (const p of this.players) {
      if (p.bot) this.aiUpdate(p, dt);
    }

    // Update players
    for (const p of this.players) {
      this.updatePlayer(p, dt);
    }

    // Collide players
    this.collidePlayers();

    // Update ball
    this.updateBall(dt);

    // Collide ball with players
    for (const p of this.players) {
      this.collideBallPlayer(p);
    }

    // Power-ups
    this.updatePowerup(dt);
  }

  // ========== SNAPSHOT ==========
  snapshot() {
    const r2 = v => Math.round(v * 100) / 100;
    return {
      t: 'state',
      mode: 'p',
      phase: this.state,
      time: Math.ceil(this.time),
      score: [this.score.red, this.score.blue],
      countdown: this.countdownVal,
      ball: [r2(this.ball.x), r2(this.ball.y), 0],
      ballVx: r2(this.ball.vx),
      ballVy: r2(this.ball.vy),
      ballSpin: r2(this.ball.spin),
      ballR: r2(this.ball.r),
      // [x, y, facing, kicking, vx, vy, bighead, frozen]
      ps: this.players.map(p => [
        r2(p.x), r2(p.y), p.facing, p.kicking ? 1 : 0,
        r2(p.vx), r2(p.vy),
        p.effBigHead > 0 ? 1 : 0, p.frozen > 0 ? 1 : 0,
      ]),
      // efek aktif pemain (untuk badge HUD): speed, jump
      eff: this.players.map(p => [p.effSpeed > 0 ? 1 : 0, p.effJump > 0 ? 1 : 0]),
      powerup: this.powerup ? [r2(this.powerup.x), r2(this.powerup.y), this.powerup.type] : null,
      fieldW: FIELD_W,
      fieldH: FIELD_H,
      goalW: GOAL_W,
      goalH: GOAL_H,
    };
  }

  drop(id) {
    const p = this.players.find(q => q.id === id);
    if (p) {
      p.bot = true;
      p.input = { dx: 0, jump: false, kick: false };
    }
    return this.players.some(q => !q.bot);
  }
}

module.exports = { PenaltyMatch };
