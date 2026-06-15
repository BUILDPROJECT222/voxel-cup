'use strict';

// Simulasi pertandingan berjalan sepenuhnya di server (otoritatif).
// Klien hanya mengirim input dan merender snapshot.

const FIELD = { halfX: 20, halfZ: 12, goalHalf: 4, goalH: 3 };
const TEAM_SIZE = 5;
const MATCH_TIME = 180;
// Formasi tim merah [x, z] (biru = cermin sumbu x). idx 1 = kiper.
const FORM = [[-4, 0], [-18.5, 0], [-10, -6], [-10, 6], [-13, 4]];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

class Match {
  /**
   * roster: [{id, name, level, bot, team: 'red'|'blue', idx: 0..4}]
   * broadcast(msg): kirim ke semua klien match ini
   * onEnd(match): dipanggil sekali saat waktu habis
   */
  constructor(id, roster, broadcast, onEnd) {
    this.id = id;
    this.broadcast = broadcast;
    this.onEnd = onEnd;
    this.state = 'play'; // play | goal | over
    this.time = MATCH_TIME;
    this.score = { red: 0, blue: 0 };
    this.goalTimer = 0;
    this.kickoffNext = 'blue';
    this.lastTouch = null;
    this.ball = { x: 0, y: 0.38, z: 0, vx: 0, vy: 0, vz: 0 };
    this.players = roster.map(r => ({
      id: r.id, name: r.name, level: r.level, bot: r.bot, team: r.team, idx: r.idx,
      x: 0, z: 0, vx: 0, vz: 0, facing: 0, kickCd: 0, goals: 0,
      input: { mx: 0, mz: 0, sprint: false }, pendingKick: 0,
      // Sliding tackle & skill move
      slide: 0, slideCd: 0, sdx: 0, sdz: 0, recover: 0,
      stun: 0, dodge: 0, dodgeCd: 0, tackles: 0, stole: false,
    }));
    this.resetKickoff('red');
  }

  resetKickoff(team) {
    Object.assign(this.ball, { x: 0, y: 0.38, z: 0, vx: 0, vy: 0, vz: 0 });
    for (const p of this.players) {
      p.x = p.team === 'red' ? FORM[p.idx][0] : -FORM[p.idx][0];
      p.z = FORM[p.idx][1];
      p.vx = 0; p.vz = 0;
      p.facing = p.team === 'red' ? Math.PI / 2 : -Math.PI / 2;
      if (p.team === team && p.idx === 0) p.x = p.team === 'red' ? -1.5 : 1.5;
    }
  }

  startSlide(p) {
    p.slide = 0.5;
    p.slideCd = 2.5;
    p.sdx = Math.sin(p.facing);
    p.sdz = Math.cos(p.facing);
    p.stole = false;
  }

  startDodge(p) {
    p.dodge = 0.55;
    p.dodgeCd = 3;
  }

  requestSlide(id) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot || this.state !== 'play') return;
    if (p.slide > 0 || p.stun > 0 || p.slideCd > 0) return;
    this.startSlide(p);
  }

  requestDodge(id) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot || this.state !== 'play') return;
    if (p.slide > 0 || p.stun > 0 || p.dodgeCd > 0) return;
    this.startDodge(p);
  }

  slideEffects(p) {
    const b = this.ball;
    // Curi bola — kecuali pembawanya sedang melakukan gocekan (kebal tackle)
    if (!p.stole && b.y < 1.2 && dist(p.x, p.z, b.x, b.z) < 1.3) {
      const owner = this.lastTouch;
      const isProtected = owner && owner !== p && owner.dodge > 0;
      if (!isProtected) {
        // Ball sticks to the tackler — place it just ahead, minimal velocity
        b.x = p.x + p.sdx * 0.9;
        b.z = p.z + p.sdz * 0.9;
        b.y = 0.38;
        b.vx = p.sdx * 1.5; b.vz = p.sdz * 1.5; b.vy = 0;
        if (owner && owner !== p && owner.team !== p.team) p.tackles++;
        this.lastTouch = p;
        p.stole = true;
      }
    }
    // Lawan yang tertabrak sliding tersandung sebentar
    for (const q of this.players) {
      if (q === p || q.team === p.team || q.slide > 0 || q.dodge > 0) continue;
      if (dist(p.x, p.z, q.x, q.z) < 0.95) q.stun = Math.max(q.stun, 0.65);
    }
  }

  doKick(p, power) {
    if (p.kickCd > 0) return;
    if (dist(p.x, p.z, this.ball.x, this.ball.z) > 1.7) return;
    const str = 10 + power * 18;
    this.ball.vx = Math.sin(p.facing) * str;
    this.ball.vz = Math.cos(p.facing) * str;
    this.ball.vy = power * 5.5;
    p.kickCd = 0.35;
    this.lastTouch = p;
  }

  ai(p, dt) {
    const goalX = p.team === 'red' ? FIELD.halfX : -FIELD.halfX;
    const ownGoalX = -goalX;
    const b = this.ball;
    const toBall = dist(p.x, p.z, b.x, b.z);

    // Sedang bawa bola dan ada lawan meluncur ke arah kita? Gocek!
    if (this.lastTouch === p && p.dodgeCd <= 0) {
      const threat = this.players.find(q =>
        q.team !== p.team && q.slide > 0 && dist(q.x, q.z, p.x, p.z) < 2.4);
      if (threat) this.startDodge(p);
    }

    let tx, tz, wantSprint = false;

    if (p.idx === 1) {
      // Kiper: jaga mulut gawang, sapu bola di kotak penalti
      tx = ownGoalX + (p.team === 'red' ? 1.2 : -1.2);
      tz = clamp(b.z, -FIELD.goalHalf + 0.6, FIELD.goalHalf - 0.6);
      if (Math.abs(b.x - ownGoalX) < 6 && Math.abs(b.z) < 7) {
        tx = b.x; tz = b.z; wantSprint = true;
        if (toBall < 1.4 && p.kickCd <= 0) {
          p.facing = Math.atan2(goalX - p.x, (Math.random() - 0.5) * 10);
          this.doKick(p, 0.8);
        }
      }
    } else {
      const mates = this.players.filter(q => q.team === p.team && q !== p && q.idx !== 1);
      const isClosest = mates.every(q => !q.bot || dist(q.x, q.z, b.x, b.z) >= toBall - 0.01);
      if (isClosest) {
        tx = b.x; tz = b.z;
        wantSprint = toBall > 4;
        if (toBall < 1.4 && p.kickCd <= 0) {
          const distGoal = Math.abs(goalX - p.x);
          const aimZ = (Math.random() - 0.5) * FIELD.goalHalf * 1.4;
          p.facing = Math.atan2(goalX - p.x, aimZ - p.z);
          this.doKick(p, distGoal < 12 ? 0.85 : 0.45);
        }
        // Lawan membawa bola di depan? Sesekali sliding tackle
        const carrier = this.lastTouch;
        if (carrier && carrier.team !== p.team && p.slideCd <= 0 && p.slide <= 0 &&
            toBall > 1.2 && toBall < 2.6 && dist(p.x, p.z, carrier.x, carrier.z) < 2.4 &&
            Math.random() < dt * 1.2) {
          p.facing = Math.atan2(b.x - p.x, b.z - p.z);
          this.startSlide(p);
        }
      } else {
        // Jaga posisi: formasi bergeser mengikuti bola
        const fx = p.team === 'red' ? FORM[p.idx][0] : -FORM[p.idx][0];
        tx = fx * 0.6 + b.x * 0.45 + (p.team === 'red' ? -2 : 2);
        tz = FORM[p.idx][1] + b.z * 0.3;
      }
    }

    const dx = tx - p.x, dz = tz - p.z;
    const len = Math.hypot(dx, dz);
    const ak = Math.min(1, dt * 10);
    if (len > 0.4) {
      const sp = p.idx === 1 ? (wantSprint ? 6.6 : 5.2) : (wantSprint ? 6.4 : 4.6);
      p.vx += ((dx / len) * sp - p.vx) * ak;
      p.vz += ((dz / len) * sp - p.vz) * ak;
      p.facing = Math.atan2(dx, dz);
    } else {
      p.vx *= 1 - ak;
      p.vz *= 1 - ak;
    }
  }

  tick(dt) {
    if (this.state === 'over') return;

    if (this.state === 'goal') {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        this.resetKickoff(this.kickoffNext);
        this.kickoffNext = this.kickoffNext === 'red' ? 'blue' : 'red';
        this.state = 'play';
      }
      return;
    }

    this.time -= dt;
    if (this.time <= 0) {
      this.time = 0;
      this.state = 'over';
      this.onEnd(this);
      return;
    }

    // --- Gerak pemain ---
    for (const p of this.players) {
      p.kickCd = Math.max(0, p.kickCd - dt);
      p.slideCd = Math.max(0, p.slideCd - dt);
      p.dodgeCd = Math.max(0, p.dodgeCd - dt);
      if (p.dodge > 0) p.dodge -= dt;

      let mult = 1;
      if (p.stun > 0) {
        // Tersandung kena tackle: tidak bisa apa-apa sebentar
        p.stun -= dt;
        const ak = Math.min(1, dt * 8);
        p.vx -= p.vx * ak; p.vz -= p.vz * ak;
      } else if (p.slide > 0) {
        // Meluncur lurus searah hadap
        p.slide -= dt;
        p.vx = p.sdx * 9.5; p.vz = p.sdz * 9.5;
        this.slideEffects(p);
        if (p.slide <= 0) p.recover = 0.2;
      } else {
        if (p.recover > 0) { p.recover -= dt; mult = 0.3; } // bangun setelah sliding
        if (p.bot) {
          this.ai(p, dt);
        } else {
          let { mx, mz, sprint } = p.input;
          const len = Math.hypot(mx, mz);
          let tvx = 0, tvz = 0;
          if (len > 0.05) {
            if (len > 1) { mx /= len; mz /= len; }
            const sp = sprint ? 7.2 : 5;
            tvx = mx * sp; tvz = mz * sp;
            p.facing = Math.atan2(mx, mz);
          }
          // Akselerasi halus, bukan kecepatan instan
          const ak = Math.min(1, dt * 14);
          p.vx += (tvx - p.vx) * ak;
          p.vz += (tvz - p.vz) * ak;
        }
        if (p.dodge > 0) mult *= 1.45; // gocekan: ledakan kecepatan singkat
      }

      if (p.pendingKick > 0) {
        if (p.slide <= 0 && p.stun <= 0) this.doKick(p, p.pendingKick);
        p.pendingKick = 0;
      }
      p.x = clamp(p.x + p.vx * mult * dt, -FIELD.halfX - 2, FIELD.halfX + 2);
      p.z = clamp(p.z + p.vz * mult * dt, -FIELD.halfZ - 2, FIELD.halfZ + 2);
    }

    // Tabrakan antar pemain (dorong ringan)
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const d = dist(a.x, a.z, c.x, c.z);
        if (d < 0.9 && d > 0.001) {
          const push = (0.9 - d) / 2 / d;
          const dx = (a.x - c.x) * push, dz = (a.z - c.z) * push;
          a.x += dx; a.z += dz; c.x -= dx; c.z -= dz;
        }
      }
    }

    // --- Fisika bola ---
    const b = this.ball;
    b.vy -= 22 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < 0.38) {
      b.y = 0.38;
      b.vy = Math.abs(b.vy) > 1.5 ? -b.vy * 0.45 : 0;
    }
    const ground = b.y <= 0.4;
    if (ground) {
      const f = Math.pow(0.35, dt);
      b.vx *= f; b.vz *= f;
    }
    if (Math.abs(b.z) > FIELD.halfZ - 0.4) {
      b.z = Math.sign(b.z) * (FIELD.halfZ - 0.4);
      b.vz *= -0.65;
    }
    if (Math.abs(b.x) > FIELD.halfX - 0.3) {
      const inMouth = Math.abs(b.z) < FIELD.goalHalf && b.y < FIELD.goalH;
      if (inMouth && Math.abs(b.x) > FIELD.halfX + 0.2) {
        this.onGoal(b.x > 0 ? 'red' : 'blue');
        return;
      }
      if (!inMouth) {
        b.x = Math.sign(b.x) * (FIELD.halfX - 0.3);
        b.vx *= -0.65;
      }
    }
    if (Math.abs(b.x) > FIELD.halfX + 1.3) {
      b.x = Math.sign(b.x) * (FIELD.halfX + 1.3);
      b.vx *= 0.2; b.vy *= 0.2; b.vz *= 0.2;
    }

    // --- Menggiring: bola lengket di depan pemain terdekat ---
    const speed2 = b.vx * b.vx + b.vz * b.vz;
    if (ground && speed2 < 36) {
      let best = null, bestD = 1.15;
      for (const p of this.players) {
        if (p.slide > 0 || p.stun > 0) continue;
        const d = dist(p.x, p.z, b.x, b.z) - (p.dodge > 0 ? 0.4 : 0); // penggocek menang rebutan
        if (d < bestD && p.kickCd <= 0) { best = p; bestD = d; }
      }
      if (best) {
        const fx = best.x + Math.sin(best.facing) * 0.85;
        const fz = best.z + Math.cos(best.facing) * 0.85;
        const k = Math.min(1, dt * 9);
        b.x += (fx - b.x) * k; b.z += (fz - b.z) * k;
        b.y = 0.38; b.vy = 0;
        b.vx = best.vx; b.vz = best.vz;
        this.lastTouch = best;
      }
    }
  }

  onGoal(team) {
    this.score[team]++;
    const scorer = this.lastTouch && this.lastTouch.team === team ? this.lastTouch : null;
    if (scorer) scorer.goals++;
    this.state = 'goal';
    this.goalTimer = 2.5;
    this.broadcast({
      t: 'goal', team,
      scorer: scorer ? scorer.name : null,
      ownGoal: !scorer && !!this.lastTouch,
      score: [this.score.red, this.score.blue],
    });
  }

  snapshot() {
    const r2 = v => Math.round(v * 100) / 100;
    return {
      t: 'state',
      time: Math.ceil(this.time),
      score: [this.score.red, this.score.blue],
      ball: [r2(this.ball.x), r2(this.ball.y), r2(this.ball.z)],
      // Urutan sama dengan roster yang dikirim di pesan 'start'
      // [x, z, facing, bergerak, status] — status: 0 normal, 1 sliding, 2 tersandung, 3 gocekan
      ps: this.players.map(p => [
        r2(p.x), r2(p.z), r2(p.facing),
        Math.hypot(p.vx, p.vz) > 0.5 ? 1 : 0,
        p.stun > 0 ? 2 : p.slide > 0 ? 1 : p.dodge > 0 ? 3 : 0,
      ]),
    };
  }

  setInput(id, m) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot) return;
    p.input.mx = clamp(Number(m.mx) || 0, -1, 1);
    p.input.mz = clamp(Number(m.mz) || 0, -1, 1);
    p.input.sprint = !!m.sprint;
  }

  requestKick(id, power) {
    const p = this.players.find(q => q.id === id);
    if (!p || p.bot || this.state !== 'play') return;
    p.pendingKick = clamp(Number(power) || 0.4, 0.2, 1);
  }

  drop(id) {
    const p = this.players.find(q => q.id === id);
    if (p) { p.bot = true; p.input = { mx: 0, mz: 0, sprint: false }; }
    return this.players.some(q => !q.bot);
  }
}

module.exports = { Match, FIELD, TEAM_SIZE, MATCH_TIME };
