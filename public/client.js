'use strict';

// ============================== SKINS ==============================
const SKIN_PRESETS = [
  { name: 'THE CAPTAIN', tag: 'ARMBAND', desc: 'Born leader. Loudest voice on the pitch.', hair: '#1c1c1c', skin: '#e8b88a' },
  { name: 'LIGHTNING', tag: 'FULL SPEED', desc: 'Runs first, thinks later.', hair: '#c9a13b', skin: '#d49a6a' },
  { name: 'BALL WIZARD', tag: 'NUTMEG', desc: 'The ball sticks to him like glue.', hair: '#6b4423', skin: '#c68642' },
  { name: 'IRON WALL', tag: 'NO GOALS', desc: 'Strikers go home crying.', hair: '#e8e8e8', skin: '#e8b88a' },
  { name: 'FOX IN THE BOX', tag: 'TAP-IN', desc: 'Appears from nowhere. Scores from nowhere.', hair: '#b3541e', skin: '#f0c8a0' },
  { name: 'WONDERKID', tag: 'PRODIGY', desc: 'Age 17, level 99.', hair: '#3b6bd1', skin: '#d49a6a' },
];
let mySkin = parseInt(localStorage.getItem('voxelcup_skin') || '0', 10) || 0;
if (mySkin < 0 || mySkin >= SKIN_PRESETS.length) mySkin = 0;
let myMode = localStorage.getItem('voxelcup_mode') === 'penalty' ? 'penalty' : '5v5';
let myWallet = localStorage.getItem('voxelcup_wallet') || '';
let myCountry = localStorage.getItem('voxelcup_country') || '';

// ============================== UI HELPERS ==============================
const $ = id => document.getElementById(id);
const screens = { home: $('screen-home'), game: $('screen-game') };
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('show'));
  screens[name].classList.add('show');
  document.body.classList.toggle('in-game', name === 'game');
}
const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function setMode(mode) {
  myMode = mode;
  localStorage.setItem('voxelcup_mode', mode);
  $('mode-5v5').classList.toggle('selected', mode === '5v5');
  $('mode-penalty').classList.toggle('selected', mode === 'penalty');
}
$('mode-5v5').onclick = () => setMode('5v5');
$('mode-penalty').onclick = () => setMode('penalty');
setMode(myMode);

// ============================== NETWORKING ==============================
let ws = null;
let myName = null;
let myId = null;
let myTeam = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => { $('queue-status').textContent = ''; };
  ws.onclose = () => {
    $('queue-status').textContent = 'DISCONNECTED — RECONNECTING...';
    if (inMatch) exitMatch();
    showScreen('home');
    setTimeout(connect, 1500);
  };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    handleMessage(m);
  };
}
function sendMsg(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
connect();

function ensureJoin() {
  const name = $('name-input').value.trim();
  if (!name) {
    $('queue-status').textContent = 'TYPE YOUR NAME FIRST!';
    $('name-input').focus();
    return false;
  }
  myName = name;
  localStorage.setItem('voxelcup_name', name);

  // wallet: validate base58 length (32-44 chars typical for Solana)
  const walletRaw = $('wallet-input').value.trim();
  const walletOk = walletRaw.length >= 32 && walletRaw.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(walletRaw);
  myWallet = walletOk ? walletRaw : '';
  localStorage.setItem('voxelcup_wallet', myWallet);
  $('wallet-status').innerHTML = myWallet
    ? '<span class="wallet-ok">✓ WALLET SAVED</span>'
    : walletRaw ? '<span style="color:var(--red);font-size:11px;font-weight:700">✗ INVALID ADDRESS</span>' : '';

  myCountry = $('country-select').value;
  localStorage.setItem('voxelcup_country', myCountry);

  sendMsg({ t: 'join', name, skin: mySkin, wallet: myWallet, country: myCountry });
  return true;
}

$('btn-queue').onclick = () => { if (ensureJoin()) sendMsg({ t: 'queue', mode: myMode }); };
$('btn-unqueue').onclick = () => sendMsg({ t: 'unqueue' });
$('btn-bots').onclick = () => { if (ensureJoin()) sendMsg({ t: 'playBots', mode: myMode }); };
$('btn-leave').onclick = leaveToLobby;
$('btn-leave-end').onclick = leaveToLobby;
function leaveToLobby() {
  sendMsg({ t: 'leave' });
  exitMatch();
  showScreen('home');
}

function handleMessage(m) {
  switch (m.t) {
    case 'joined':
      $('my-stats').textContent = m.stats
        ? `Lvl ${m.lvl} · ${m.stats.p} played · ${m.stats.w}W ${m.stats.d}D ${m.stats.l}L · ${m.stats.g} goals`
        : `Lvl ${m.lvl} · new player — your story starts here`;
      $('chip-coins').textContent = m.coins || 0;
      renderQuests(m.quests || []);
      break;
    case 'lobby': renderLobby(m); break;
    case 'start': enterMatch(m); break;
    case 'state':
      latestSnap = m;
      snapBuf.push({ at: performance.now(), s: m });
      if (snapBuf.length > 15) snapBuf.shift();
      break;
    case 'goal': onGoalMsg(m); break;
    case 'pround': onPenaltyRound(m); break;
    case 'pspawn': beep(900, 0.12, 'triangle', 0.06); break;
    case 'pgrab': {
      const labels = { speed: '⚡ SPEED BOOST', jump: '🦘 SUPER JUMP', bighead: '🗣️ BIG HEAD', freeze: '❄️ FREEZE!', bigball: '⚽ BIG BALL' };
      const col = m.team === 'red' ? '#f87171' : '#60a5fa';
      announce(labels[m.type] || 'POWER-UP', col, `grabbed by ${m.by}`);
      beep(1100, 0.15, 'square', 0.08);
      break;
    }
    case 'end': onEndMsg(m); break;
  }
}

function renderQuests(quests) {
  if (!quests.length) return;
  $('quest-section').style.display = '';
  $('quest-list').innerHTML = quests.map(q => {
    const pct = Math.round((q.progress / q.target) * 100);
    return `<li>
      <div class="qtop"><span class="qname">${esc(q.name)}</span><span class="qreward">+${q.reward} 🪙</span></div>
      <div class="qdesc">${esc(q.desc)}</div>
      <div class="qbar"><div class="qfill" style="width:${pct}%"></div></div>
      <div class="qprog">${q.progress} / ${q.target}</div>
    </li>`;
  }).join('');
}

function renderLobby(m) {
  $('badge-n').textContent = m.online;
  $('chip-online').textContent = m.online;
  $('chip-queue').textContent = m.inQueue;

  const recOf = r => `${r.w}W ${r.d}D ${r.l}L · ${r.g} GLS · LVL ${r.lvl}`;
  const isOnline = name => m.names.some(p => p.name === name);

  $('podium').innerHTML = [1, 0, 2].map(i => {
    const r = m.leaderboard[i];
    const cls = `pod p${i + 1}` + (r ? '' : ' empty');
    if (!r) return `<div class="${cls}"><div class="medal">${i + 1}</div><div class="pname">—</div><div class="ppts">0 PTS</div><div class="prec">awaiting a champion</div></div>`;
    return `<div class="${cls}">
      <div class="medal">${i + 1}</div>
      <div class="pname">${esc(r.name)}${isOnline(r.name) ? ' <span style="color:var(--lime);font-size:10px">●</span>' : ''}</div>
      <div class="ppts">${r.pts} PTS</div>
      <div class="prec">${recOf(r)}</div>
    </div>`;
  }).join('');

  $('lb-list').innerHTML = m.leaderboard.slice(3).map((r, i) =>
    `<li class="${r.name === myName ? 'me' : ''}">
      <span class="rank">${i + 4}</span>
      <span class="nm">${esc(r.name)}${isOnline(r.name) ? '<span class="dot">●</span>' : ''}</span>
      <span class="rec">${recOf(r)}</span>
      <span class="pts">${r.pts}</span>
    </li>`).join('');

  $('online-line').innerHTML = 'ONLINE NOW: ' + (m.names.length
    ? m.names.map(p => `<b>${esc(p.name)}</b>${p.state === 'match' ? ' ⚽' : p.state === 'queue' ? ' ⏳' : ''}`).join(' · ')
    : '<b>—</b>');

  const inQ = m.names.some(p => p.name === myName && p.state === 'queue');
  $('btn-queue').style.display = inQ ? 'none' : '';
  $('btn-unqueue').style.display = inQ ? 'block' : 'none';
  $('btn-bots').disabled = inQ;
  if (inQ) {
    $('queue-status').textContent = `SEARCHING FOR OPPONENTS... ${m.inQueue} IN QUEUE — BOTS FILL EMPTY SLOTS SHORTLY`;
  } else if (!$('queue-status').textContent.startsWith('TYPE')) {
    $('queue-status').textContent = m.inQueue > 0 ? `${m.inQueue} PLAYER(S) IN QUEUE — JOIN NOW!` : '';
  }
}

// ============================== THREE.JS SCENE ==============================
const FIELD = { halfX: 20, halfZ: 12, goalHalf: 4, goalH: 3 };
const SPOT_X = FIELD.halfX - 6;
const GOAL_X = FIELD.halfX;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ed14f);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'game3d';
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.inset = '0';
renderer.domElement.style.display = 'none';
document.body.prepend(renderer.domElement);

const VIEW = 16;
let aspect = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera(-VIEW * aspect, VIEW * aspect, VIEW, -VIEW, 0.1, 200);
const CAM_OFF = new THREE.Vector3(24, 26, 24);
camera.position.copy(CAM_OFF);
camera.lookAt(0, 0, 0);

// Kamera penalti: side-view ortografis untuk head soccer
const HS_VIEW = 9;
const pCam = new THREE.OrthographicCamera(-HS_VIEW * aspect, HS_VIEW * aspect, HS_VIEW, -HS_VIEW, 0.1, 200);
pCam.position.set(0, 5, 30);
pCam.lookAt(0, 5, 0);

addEventListener('resize', () => {
  aspect = innerWidth / innerHeight;
  camera.left = -VIEW * aspect; camera.right = VIEW * aspect;
  camera.updateProjectionMatrix();
  pCam.left = -HS_VIEW * aspect; pCam.right = HS_VIEW * aspect;
  pCam.top = HS_VIEW; pCam.bottom = -HS_VIEW;
  pCam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xfff4d6, 0.9);
sun.position.set(18, 30, 10);
sun.castShadow = true;
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

(function buildField() {
  const tileA = new THREE.MeshLambertMaterial({ color: 0x7ec850 });
  const tileB = new THREE.MeshLambertMaterial({ color: 0x8ed95c });
  const tileGeo = new THREE.BoxGeometry(2, 1, 2);
  for (let x = -FIELD.halfX; x < FIELD.halfX; x += 2) {
    for (let z = -FIELD.halfZ; z < FIELD.halfZ; z += 2) {
      const t = new THREE.Mesh(tileGeo, ((x + z) / 2) % 2 === 0 ? tileA : tileB);
      t.position.set(x + 1, -0.5, z + 1);
      t.receiveShadow = true;
      scene.add(t);
    }
  }
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(FIELD.halfX * 2 + 24, 1, FIELD.halfZ * 2 + 24),
    new THREE.MeshLambertMaterial({ color: 0x6aa843 })
  );
  apron.position.y = -0.55;
  apron.receiveShadow = true;
  scene.add(apron);

  const lineMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const addLine = (w, d, x, z) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), lineMat);
    l.position.set(x, 0.02, z);
    scene.add(l);
  };
  addLine(0.18, FIELD.halfZ * 2, 0, 0);
  addLine(FIELD.halfX * 2, 0.18, 0, -FIELD.halfZ + 0.1);
  addLine(FIELD.halfX * 2, 0.18, 0, FIELD.halfZ - 0.1);
  addLine(0.18, FIELD.halfZ * 2, -FIELD.halfX + 0.1, 0);
  addLine(0.18, FIELD.halfZ * 2, FIELD.halfX - 0.1, 0);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.16), lineMat);
    s.position.set(Math.cos(a) * 4, 0.02, Math.sin(a) * 4);
    s.rotation.y = -a + Math.PI / 2;
    scene.add(s);
  }
  [[-1], [1]].forEach(([side]) => {
    const gx = side * FIELD.halfX;
    addLine(0.16, 12, gx - side * 5, 0);
    addLine(5, 0.16, gx - side * 2.5, -6);
    addLine(5, 0.16, gx - side * 2.5, 6);
  });

  const postMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  [[-1], [1]].forEach(([side]) => {
    const gx = side * (FIELD.halfX + 0.3);
    const mk = (w, h, d, x, y, z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), postMat);
      p.position.set(x, y, z); p.castShadow = true; scene.add(p);
    };
    mk(0.3, FIELD.goalH, 0.3, gx, FIELD.goalH / 2, -FIELD.goalHalf);
    mk(0.3, FIELD.goalH, 0.3, gx, FIELD.goalH / 2, FIELD.goalHalf);
    mk(0.3, 0.3, FIELD.goalHalf * 2 + 0.3, gx, FIELD.goalH, 0);
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, FIELD.goalH, FIELD.goalHalf * 2),
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
    );
    net.position.set(gx + side * 1.2, FIELD.goalH / 2, 0);
    scene.add(net);
  });

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x4caf3e });
  const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x5dc24d });
  [[-26, -10], [-25, 8], [26, -7], [25, 11], [-12, -17], [8, -18], [14, 17], [-6, 18], [22, -16], [-22, 16]]
    .forEach(([x, z], i) => {
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), trunkMat);
      trunk.position.set(x, 0.8, z); trunk.castShadow = true; scene.add(trunk);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 2.6), i % 2 ? leafMat : leafMat2);
      leaf.position.set(x, 2.4, z); leaf.castShadow = true; scene.add(leaf);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), i % 2 ? leafMat2 : leafMat);
      top.position.set(x, 3.7, z); top.castShadow = true; scene.add(top);
    });
})();

// Ring bidikan penalti (hanya terlihat oleh penendang)
const aimRing = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.62, 24),
  new THREE.MeshBasicMaterial({ color: 0xa3e635, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
);
aimRing.rotation.x = -Math.PI / 2;
aimRing.visible = false;
scene.add(aimRing);

// ============================== CHARACTERS ==============================
const RED = 0xd13b3b, BLUE = 0x2e6bd6;
const cssHex = s => parseInt(s.slice(1), 16);

// Voxel body builder — used on the pitch and in the lobby preview
function buildCharacterMesh(preset, jerseyColor) {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: cssHex(preset.skin) });
  const jerseyMat = new THREE.MeshLambertMaterial({ color: jerseyColor });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const hairMat = new THREE.MeshLambertMaterial({ color: cssHex(preset.hair) });
  const mk = (w, h, d, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true;
    (parent || g).add(m);
    return m;
  };
  const legL = new THREE.Group(); legL.position.set(-0.22, 0.9, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.22, 0.9, 0); g.add(legR);
  mk(0.34, 0.9, 0.38, pantsMat, 0, -0.45, 0, legL);
  mk(0.34, 0.9, 0.38, pantsMat, 0, -0.45, 0, legR);
  mk(0.95, 1.1, 0.55, jerseyMat, 0, 1.45, 0);
  const armL = new THREE.Group(); armL.position.set(-0.62, 1.9, 0); g.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.62, 1.9, 0); g.add(armR);
  mk(0.28, 0.85, 0.32, jerseyMat, 0, -0.32, 0, armL);
  mk(0.28, 0.85, 0.32, jerseyMat, 0, -0.32, 0, armR);
  mk(0.28, 0.25, 0.32, skinMat, 0, -0.85, 0, armL);
  mk(0.28, 0.25, 0.32, skinMat, 0, -0.85, 0, armR);
  mk(0.85, 0.85, 0.78, skinMat, 0, 2.45, 0);
  mk(0.9, 0.3, 0.83, hairMat, 0, 2.82, 0);
  mk(0.9, 0.35, 0.2, hairMat, 0, 2.6, -0.32);
  return { group: g, legL, legR, armL, armR };
}

function makeLabel(name, level, isMe) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const c = cv.getContext('2d');
  c.textAlign = 'center';
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.font = 'bold 24px "Segoe UI", Arial';
  c.fillText(`Lvl ${level}`, 129, 31);
  c.font = 'bold 28px "Segoe UI", Arial';
  c.fillText(name, 129, 65);
  c.fillStyle = '#cfe9ff';
  c.font = 'bold 24px "Segoe UI", Arial';
  c.fillText(`Lvl ${level}`, 128, 30);
  c.fillStyle = isMe ? '#ffd84d' : '#ffffff';
  c.font = 'bold 28px "Segoe UI", Arial';
  c.fillText(name, 128, 64);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  sp.scale.set(4.6, 1.7, 1);
  sp.position.y = 3.1;
  return sp;
}

function makeCharacter(info) {
  const preset = SKIN_PRESETS[info.skin] || SKIN_PRESETS[0];
  const parts = buildCharacterMesh(preset, info.team === 'red' ? RED : BLUE);
  parts.group.add(makeLabel(info.name, info.level, info.id === myId));
  scene.add(parts.group);
  return {
    id: info.id, mesh: parts.group,
    legL: parts.legL, legR: parts.legR, armL: parts.armL, armR: parts.armR,
    tx: 0, tz: 0, tFacing: 0, moving: 0, walkPhase: Math.random() * 6,
  };
}

const ballMesh = (() => {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  sphere.castShadow = true;
  group.add(sphere);
  const dotMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.06), dotMat);
    const a = (i / 6) * Math.PI * 2;
    d.position.set(Math.cos(a) * 0.34, Math.sin(a) * 0.34, (i % 2 ? 1 : -1) * 0.18);
    d.lookAt(d.position.clone().multiplyScalar(2));
    group.add(d);
  }
  group.visible = false;
  scene.add(group);
  return group;
})();
const ballTarget = new THREE.Vector3(0, 0.38, 0);

// ============================== LOBBY CHARACTER PREVIEW ==============================
const pvScene = new THREE.Scene();
pvScene.add(new THREE.AmbientLight(0xffffff, 0.75));
const pvSun = new THREE.DirectionalLight(0xffffff, 0.85);
pvSun.position.set(4, 8, 6);
pvScene.add(pvSun);
const pvCam = new THREE.PerspectiveCamera(36, 280 / 300, 0.1, 50);
pvCam.position.set(0, 3.4, 7.6);
pvCam.lookAt(0, 1.6, 0);
const pvRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
pvRenderer.setSize(280, 300);
pvRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('avatar-view').appendChild(pvRenderer.domElement);
let pvChar = null;
function rebuildPreview() {
  if (pvChar) pvScene.remove(pvChar.group);
  pvChar = buildCharacterMesh(SKIN_PRESETS[mySkin], 0x84cc16);
  pvScene.add(pvChar.group);
}

function updateSkinUI() {
  const p = SKIN_PRESETS[mySkin];
  $('skin-name').textContent = p.name;
  $('skin-tag').textContent = p.tag;
  $('skin-desc').textContent = p.desc;
  $('skin-count').textContent = `${mySkin + 1} / ${SKIN_PRESETS.length}`;
  localStorage.setItem('voxelcup_skin', String(mySkin));
  rebuildPreview();
}
$('skin-prev').onclick = () => { mySkin = (mySkin + SKIN_PRESETS.length - 1) % SKIN_PRESETS.length; updateSkinUI(); };
$('skin-next').onclick = () => { mySkin = (mySkin + 1) % SKIN_PRESETS.length; updateSkinUI(); };
updateSkinUI();
$('name-input').value = localStorage.getItem('voxelcup_name') || '';
$('wallet-input').value = myWallet;
if (myCountry) $('country-select').value = myCountry;

// ============================== MATCH STATE ==============================
let inMatch = false;
let penaltyMode = false;
let chars = [];
let latestSnap = null;
let myChar = null;
let myIdx = -1;
let lastRoleShooter = -1;

// Smoothing jaringan: buffer interpolasi + prediksi sisi-klien
let snapBuf = [];
const INTERP_DELAY = 90; // ms — render sedikit di masa lalu agar gerak mulus
let pred = null;         // posisi prediksi karakter sendiri {x, z}
let predFacing = null;
let predAim = 0, predKz = 0;
// Prediksi lokal slide/dodge agar terasa instan
let mySlideT = 0, mySlideDx = 0, mySlideDz = 0, mySlideCd = 0;
let myDodgeT = 0, myDodgeCd = 0;
// Prediksi lokal Head Soccer (hilangkan lag input) — konstanta harus cocok dgn server
const HS = { SPEED: 8, JUMP: 14, GRAV: -22, AIR: 0.85, GROUND: 0, BODY_H: 0.55, HEAD_R: 0.95 };
let hsP = null;          // { x, y, vx, vy, jumpHeld }

function enterMatch(m) {
  exitMatch();
  myId = m.youId;
  penaltyMode = m.mode === 'penalty';
  const me = m.roster.find(r => r.id === m.youId);
  myTeam = me ? me.team : null;
  chars = m.roster.map((r, idx) => {
    const c = makeCharacter(r);
    c.mesh.userData = { playerName: r.name, skin: r.skin || 0 };
    return c;
  });
  myChar = chars.find(c => c.id === myId) || null;
  myIdx = chars.findIndex(c => c.id === myId);
  lastRoleShooter = -1;

  if (penaltyMode) {
    $('match-info').textContent = `HEAD SOCCER · FIRST TO 5 · 90s`;
    $('timer').textContent = '1:30';
    $('hint').innerHTML = `<b>A/D</b> move · <b>W</b> jump (over enemy!) · <b>SPACE</b> kick · grab <b>power-ups</b> · attack <b>${myTeam === 'red' ? 'RIGHT ➜' : '⬅ LEFT'}</b>`;
  } else {
    $('hint').innerHTML = `<b>WASD</b> move · <b>SPACE</b> shoot · <b>E</b> slide tackle · <b>Q</b> skill move · attack <b>${myTeam === 'red' ? 'RIGHT ➜' : '⬅ LEFT'}</b>`;
    $('match-info').textContent = `MATCH #${m.matchId} · ${m.roster.filter(r => !r.bot).length} HUMANS · ${m.roster.filter(r => r.bot).length} BOTS`;
  }
  $('hint').style.opacity = '1';
  $('score-red').textContent = '0';
  $('score-blue').textContent = '0';
  $('endscreen').classList.remove('show');
  ballMesh.visible = true;
  latestSnap = null;
  snapBuf = [];
  pred = null;
  predFacing = null;
  predAim = 0; predKz = 0;
  mySlideT = 0; mySlideCd = 0; myDodgeT = 0; myDodgeCd = 0;
  hsP = null;
  inMatch = true;
  if (penaltyMode) {
    // Head Soccer dirender di kanvas 2D, bukan scene 3D
    renderer.domElement.style.display = 'none';
    ensureHsCanvas();
    showHsCanvas();
  } else {
    renderer.domElement.style.display = 'block';
  }
  showScreen('game');
  announce(penaltyMode ? 'HEAD SOCCER!' : 'KICK OFF!', '#fff');
  setTimeout(() => { $('hint').style.opacity = '0.4'; }, 7000);
}

function exitMatch() {
  inMatch = false;
  penaltyMode = false;
  chars.forEach(c => scene.remove(c.mesh));
  chars = [];
  myChar = null;
  myIdx = -1;
  ballMesh.visible = false;
  aimRing.visible = false;
  latestSnap = null;
  snapBuf = [];
  pred = null;
  renderer.domElement.style.display = 'none';
  hideHsCanvas();
  $('endscreen').classList.remove('show');
}

function onGoalMsg(m) {
  $('score-red').textContent = m.score[0];
  $('score-blue').textContent = m.score[1];
  const col = m.team === 'red' ? '#f87171' : '#60a5fa';
  const sub = m.scorer ? `⚽ ${m.scorer}` : (m.ownGoal ? 'OWN GOAL!' : '');
  announce('GOAL!', col, sub);
  sfxGoal();
}

function onPenaltyRound(m) {
  $('score-red').textContent = m.score[0];
  $('score-blue').textContent = m.score[1];
  if (m.result === 'goal') {
    announce('GOAL!', '#a3e635', `⚽ ${m.shooter}`);
    sfxGoal();
  } else if (m.result === 'save') {
    announce('SAVED!', '#60a5fa', `🧤 denied ${m.shooter}`);
    sfxWhistle();
  } else {
    announce('WIDE!', '#f87171', `${m.shooter} missed the target`);
    beep(180, 0.3, 'square', 0.08);
  }
}

function onEndMsg(m) {
  const [r, b] = m.score;
  let title = 'DRAW';
  if (myTeam) {
    const my = myTeam === 'red' ? r : b;
    const op = myTeam === 'red' ? b : r;
    title = my > op ? '🏆 VICTORY!' : my < op ? 'DEFEAT' : 'DRAW';
  }
  $('end-title').textContent = title;
  $('end-detail').textContent = m.mode === 'penalty'
    ? `HEAD SOCCER · RED ${r} — ${b} BLUE`
    : `RED ${r} — ${b} BLUE`;
  $('end-goals').innerHTML = m.goals.length
    ? 'Scorers: ' + m.goals.map(g =>
        `<span style="color:${g.team === 'red' ? '#f87171' : '#60a5fa'}">${esc(g.name)} (${g.goals})</span>`).join(' · ')
    : 'No goals — defense wins games.';
  $('end-rewards').innerHTML = (m.rewards || []).map(r =>
    `QUEST COMPLETE: ${esc(r.name)} <span style="font-style:italic">+${r.reward} 🪙</span>`).join('<br>');
  if (m.coins != null) $('chip-coins').textContent = m.coins;
  if (m.quests) renderQuests(m.quests);
  if (m.rewards && m.rewards.length) sfxGoal();
  $('endscreen').classList.add('show');
  sfxWhistle();
}

// ============================== SOUND ==============================
let audioCtx = null;
function beep(freq, dur, type, vol) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(gn).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}
const sfxKick = pow => beep(160 + pow * 120, 0.12, 'square', 0.1);
const sfxGoal = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.12), i * 110));
const sfxWhistle = () => beep(2200, 0.4, 'sawtooth', 0.05);

function announce(text, color, sub) {
  const el = $('announce');
  el.innerHTML = esc(text) + (sub ? `<span class="sub">${esc(sub)}</span>` : '');
  el.style.color = color || '#fff';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

// ============================== INPUT ==============================
const keys = {};
let charging = false, chargePower = 0;
let lastSentInput = '';

addEventListener('keydown', e => {
  if (!inMatch) return;
  keys[e.code] = true;
  sendInput(); // kirim segera, jangan tunggu interval
  if (e.code === 'Space') {
    e.preventDefault();
    if (!charging && !penaltyMode) {
      charging = true; chargePower = 0;
      $('powerbar-wrap').style.display = 'block';
    }
    if (penaltyMode) sfxKick(0.7);
  }
  // Sliding tackle — diprediksi lokal supaya langsung terasa
  if (e.code === 'KeyE' && !penaltyMode && mySlideCd <= 0 && mySlideT <= 0) {
    mySlideCd = 2.5;
    mySlideT = 0.5;
    const d = localInputDir();
    const f = predFacing !== null ? predFacing : (myChar ? myChar.mesh.rotation.y : 0);
    mySlideDx = d ? d.mx : Math.sin(f);
    mySlideDz = d ? d.mz : Math.cos(f);
    sendMsg({ t: 'slide' });
    beep(120, 0.18, 'sawtooth', 0.07);
  }
  // Skill move / gocekan — kebal tackle + ledakan kecepatan
  if (e.code === 'KeyQ' && !penaltyMode && myDodgeCd <= 0) {
    myDodgeCd = 3;
    myDodgeT = 0.55;
    sendMsg({ t: 'dodge' });
    beep(700, 0.1, 'triangle', 0.07);
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (inMatch) sendInput();
  if (e.code === 'Space' && charging) {
    charging = false;
    $('powerbar-wrap').style.display = 'none';
    if (inMatch) {
      sendMsg({ t: 'kick', power: 0.35 + chargePower * 0.65 });
      sfxKick(chargePower);
    }
  }
});

// Isometric camera at (+x,+z): screen-up = world (-x,-z), screen-right = world (+x,-z)
const DIAG = Math.SQRT1_2;
function sendInput() {
  if (!inMatch) return;
  const ixRaw = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);

  if (penaltyMode) {
    // Head Soccer mode: send movement, jump, kick
    const dx = ixRaw;
    const jump = !!(keys['KeyW'] || keys['ArrowUp']);
    const kick = !!(keys['Space']);
    const sig = `hs${dx},${jump},${kick}`;
    if (sig !== lastSentInput) {
      lastSentInput = sig;
      sendMsg({ t: 'pinput', dx, jump, kick });
    }
    // Send kick as separate message for edge detection
    if (kick && !hsLastKick) {
      sendMsg({ t: 'kick', power: 1 });
    }
    hsLastKick = kick;
    return;
  }

  let ix = ixRaw;
  let iz = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  let mx = 0, mz = 0;
  if (ix || iz) {
    const len = Math.hypot(ix, iz);
    ix /= len; iz /= len;
    mx = (ix + iz) * DIAG;
    mz = (iz - ix) * DIAG;
  }
  const sprint = !!(keys['ShiftLeft'] || keys['ShiftRight']);
  const sig = `${mx.toFixed(2)},${mz.toFixed(2)},${sprint}`;
  if (sig !== lastSentInput) {
    lastSentInput = sig;
    sendMsg({ t: 'input', mx, mz, sprint });
  }
}
let hsLastKick = false;
setInterval(sendInput, 50);

// ============================== RENDER LOOP ==============================
const clock = new THREE.Clock();
let pvTime = 0;
const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const lerpN = (a, b, t) => a + (b - a) * t;
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

// Ambil dua snapshot yang mengapit "waktu render" (sedikit di masa lalu)
// lalu interpolasi linear di antaranya — gerak jadi mulus, bukan patah-patah.
function sampleSnaps() {
  if (!snapBuf.length) return null;
  const rt = performance.now() - INTERP_DELAY;
  for (let j = 0; j < snapBuf.length - 1; j++) {
    if (snapBuf[j].at <= rt && rt <= snapBuf[j + 1].at) {
      const t = (rt - snapBuf[j].at) / Math.max(1, snapBuf[j + 1].at - snapBuf[j].at);
      return { a: snapBuf[j].s, b: snapBuf[j + 1].s, t };
    }
  }
  const last = snapBuf[snapBuf.length - 1].s;
  return { a: last, b: last, t: 0 };
}

function localInputDir() {
  let ix = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  let iz = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  if (!ix && !iz) return null;
  const len = Math.hypot(ix, iz);
  ix /= len; iz /= len;
  return { mx: (ix + iz) * DIAG, mz: (iz - ix) * DIAG };
}

// Posisi + animasi dari perpindahan nyata antar frame.
// state: 0 normal, 1 sliding, 2 tersandung, 3 gocekan
function updateCharVisual(c, x, z, facing, dt, soft, state = 0) {
  if (soft) {
    const k = Math.min(1, dt * 14);
    x = c.mesh.position.x + (x - c.mesh.position.x) * k;
    z = c.mesh.position.z + (z - c.mesh.position.z) * k;
  }
  const spd = Math.hypot(x - c.mesh.position.x, z - c.mesh.position.z) / Math.max(dt, 1e-4);
  c.mesh.position.x = x;
  c.mesh.position.z = z;

  if (c.tilt === undefined) { c.tilt = 0; c.spin = 0; c.amp = 0; c.baseYaw = facing; }

  // Sliding: badan rebah ke belakang, kaki lurus ke depan
  const tTilt = state === 1 ? -1.05 : 0;
  c.tilt += (tTilt - c.tilt) * Math.min(1, dt * 12);
  c.mesh.rotation.x = c.tilt;
  c.mesh.position.y = Math.abs(c.tilt) * 0.16;

  // Gocekan: putaran badan 360°
  if (state === 3 || (c.spin > 0 && c.spin < Math.PI * 2)) c.spin += dt * 13;
  if (c.spin >= Math.PI * 2) c.spin = 0;

  // Tersandung: sempoyongan
  const wobble = state === 2 ? Math.sin(performance.now() * 0.02) * 0.16 : 0;
  c.mesh.rotation.z += (wobble - c.mesh.rotation.z) * Math.min(1, dt * 12);

  c.baseYaw = lerpAngle(c.baseYaw, facing, Math.min(1, dt * 16));
  c.mesh.rotation.y = c.baseYaw + c.spin;

  if (state === 1) {
    // Pose meluncur
    c.legL.rotation.x += (-1.35 - c.legL.rotation.x) * Math.min(1, dt * 14);
    c.legR.rotation.x += (-1.1 - c.legR.rotation.x) * Math.min(1, dt * 14);
    c.armL.rotation.x += (0.7 - c.armL.rotation.x) * Math.min(1, dt * 14);
    c.armR.rotation.x += (0.7 - c.armR.rotation.x) * Math.min(1, dt * 14);
  } else {
    const targetAmp = spd > 0.7 ? Math.min(0.65, spd * 0.1) : 0;
    c.amp += (targetAmp - c.amp) * Math.min(1, dt * 10);
    if (spd > 0.7) c.walkPhase += Math.min(spd, 8.5) * dt * 1.7;
    const sw = Math.sin(c.walkPhase) * c.amp;
    c.legL.rotation.x = sw; c.legR.rotation.x = -sw;
    c.armL.rotation.x = -sw * 0.7; c.armR.rotation.x = sw * 0.7;
  }
}

function setBall(x, y, z) {
  const dx = x - ballMesh.position.x, dz = z - ballMesh.position.z;
  ballMesh.position.set(x, y, z);
  ballMesh.rotation.z -= dx * 2;
  ballMesh.rotation.x += dz * 2;
}

function frame5v5(smp, dt) {
  const { a, b, t } = smp;
  const s = latestSnap;
  $('score-red').textContent = s.score[0];
  $('score-blue').textContent = s.score[1];
  const mn = Math.floor(s.time / 60), sc = s.time % 60;
  $('timer').textContent = `${mn}:${String(sc).padStart(2, '0')}`;

  setBall(lerpN(a.ball[0], b.ball[0], t), lerpN(a.ball[1], b.ball[1], t), lerpN(a.ball[2], b.ball[2], t));

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], pa = a.ps[i], pb = b.ps[i];
    if (!pa || !pb) continue;
    let x = lerpN(pa[0], pb[0], t);
    let z = lerpN(pa[1], pb[1], t);
    let facing = lerpAngle(pa[2], pb[2], t);

    const state = pb[4] || 0;
    if (c === myChar) {
      // Prediksi lokal: karaktermu merespons input SEKARANG,
      // lalu dikoreksi pelan-pelan ke posisi server.
      if (!pred) pred = { x, z };
      if (mySlideT > 0) {
        mySlideT -= dt;
        pred.x += mySlideDx * 9.5 * dt;
        pred.z += mySlideDz * 9.5 * dt;
        predFacing = Math.atan2(mySlideDx, mySlideDz);
      } else {
        const d = localInputDir();
        if (d) {
          let sp = (keys['ShiftLeft'] || keys['ShiftRight']) ? 7.2 : 5;
          if (myDodgeT > 0) sp *= 1.45;
          pred.x += d.mx * sp * dt;
          pred.z += d.mz * sp * dt;
          predFacing = Math.atan2(d.mx, d.mz);
        }
      }
      if (myDodgeT > 0) myDodgeT -= dt;
      pred.x = clampN(pred.x, -FIELD.halfX - 2, FIELD.halfX + 2);
      pred.z = clampN(pred.z, -FIELD.halfZ - 2, FIELD.halfZ + 2);
      const ex = x - pred.x, ez = z - pred.z;
      // Saat tersandung server menghentikan kita — tarik prediksi lebih cepat
      const ck = state === 2 ? Math.min(1, dt * 10) : Math.min(1, dt * 4);
      if (Math.hypot(ex, ez) > 2.5) { pred.x = x; pred.z = z; }
      else { pred.x += ex * ck; pred.z += ez * ck; }
      x = pred.x; z = pred.z;
      if (predFacing !== null && state !== 1) facing = predFacing;
    }
    updateCharVisual(c, x, z, facing, dt, false, c === myChar && mySlideT > 0 ? 1 : state);
  }

  const focusSrc = myChar ? myChar.mesh.position : ballMesh.position;
  const focus = focusSrc.clone().lerp(ballMesh.position, 0.35);
  focus.x = clampN(focus.x, -12, 12);
  focus.z = clampN(focus.z, -6, 6);
  focus.y = 0;
  camera.position.lerp(focus.clone().add(CAM_OFF), Math.min(1, dt * 5));
  renderer.render(scene, camera);
}

// ============ HEAD SOCCER 2D OVERLAY (Canvas rendering on top of 3D) ============
let hsCanvas = null, hsCtx = null;
function ensureHsCanvas() {
  if (hsCanvas) return;
  hsCanvas = document.createElement('canvas');
  hsCanvas.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;';
  document.body.appendChild(hsCanvas);
  hsCtx = hsCanvas.getContext('2d');
  hsCanvas.width = innerWidth;
  hsCanvas.height = innerHeight;
  window.addEventListener('resize', () => {
    if (hsCanvas) { hsCanvas.width = innerWidth; hsCanvas.height = innerHeight; }
  });
}
function hideHsCanvas() {
  if (hsCanvas) { hsCanvas.style.display = 'none'; }
}
function showHsCanvas() {
  if (hsCanvas) { hsCanvas.style.display = 'block'; }
}

// Prediksi posisi pemain sendiri di Head Soccer dengan fisika identik server,
// lalu dikoreksi pelan ke posisi otoritatif. Hilangkan ~90ms lag input.
function predictHs(serverX, serverY, dt, eff, frozen, FW, GW) {
  if (!hsP) hsP = { x: serverX, y: serverY, vx: 0, vy: 0, jumpHeld: false };
  const speed = HS.SPEED * (eff && eff[0] ? 1.6 : 1);
  const jump = HS.JUMP * (eff && eff[1] ? 1.3 : 1);
  const onGround = hsP.y <= HS.GROUND + 0.1;

  if (frozen) {
    hsP.vx = 0;
  } else {
    const dxIn = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    const wantJump = !!(keys['KeyW'] || keys['ArrowUp']);
    if (wantJump && !hsP.jumpHeld && onGround) hsP.vy = jump;
    hsP.jumpHeld = wantJump;
    const target = dxIn * speed;
    if (onGround) hsP.vx = target;
    else hsP.vx += (target * HS.AIR - hsP.vx) * Math.min(1, dt * 10);
  }
  hsP.vy += HS.GRAV * dt;
  hsP.x += hsP.vx * dt;
  hsP.y += hsP.vy * dt;
  if (hsP.y < HS.GROUND) { hsP.y = HS.GROUND; hsP.vy = 0; }
  const halfW = FW / 2;
  hsP.x = clampN(hsP.x, -halfW + GW + HS.HEAD_R * 0.5, halfW - GW - HS.HEAD_R * 0.5);

  // Rekonsiliasi lembut ke server; snap keras kalau melenceng jauh
  const ex = serverX - hsP.x, ey = serverY - hsP.y;
  if (Math.hypot(ex, ey) > 3) { hsP.x = serverX; hsP.y = serverY; }
  else { hsP.x += ex * Math.min(1, dt * 3); hsP.y += ey * Math.min(1, dt * 3); }
  return hsP;
}

function framePenalty(smp, dt) {
  const { a, b, t } = smp;
  const s = latestSnap;
  $('score-red').textContent = s.score[0];
  $('score-blue').textContent = s.score[1];
  const mn = Math.floor(s.time / 60), sc = s.time % 60;
  $('timer').textContent = `${mn}:${String(sc).padStart(2, '0')}`;

  // Hide 3D scene for head soccer, render 2D overlay instead
  renderer.domElement.style.display = 'none';
  ensureHsCanvas();
  showHsCanvas();

  const W = hsCanvas.width, H = hsCanvas.height;
  const ctx = hsCtx;
  ctx.clearRect(0, 0, W, H);

  // Get field dimensions from snapshot
  const FW = s.fieldW || 28;
  const FH = s.fieldH || 10;
  const GW = s.goalW || 1.2;
  const GH = s.goalH || 4.2;

  // World to screen mapping
  const margin = 60;
  const gameW = W - margin * 2;
  const gameH = H * 0.65;
  const gameTop = H * 0.12;
  const groundScreenY = gameTop + gameH;
  const scaleX = gameW / (FW + 4); // extra for goals
  const scaleY = gameH / FH;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = W / 2;
  const offsetY = groundScreenY;

  function wx(x) { return offsetX + x * scale; }
  function wy(y) { return offsetY - y * scale; }
  function ws(s) { return s * scale; }

  // ===== DRAW STADIUM =====
  // Night sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#0d1b3e');
  skyGrad.addColorStop(0.4, '#1e3a5f');
  skyGrad.addColorStop(0.7, '#2d5a3f');
  skyGrad.addColorStop(1, '#1b3a12');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Crowd / stands
  ctx.fillStyle = '#15152a';
  const standH = gameTop * 0.85;
  ctx.fillRect(0, gameTop * 0.15, W, standH);
  const crowdPhaseLocal = performance.now() * 0.002;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 50; i++) {
      const cx = (i / 50) * W + 10;
      const cy = gameTop * 0.25 + row * 18 + Math.sin(crowdPhaseLocal + i * 0.7 + row) * 2;
      const hue = (i * 67 + row * 131) % 360;
      ctx.fillStyle = `hsl(${hue}, 45%, ${38 + (i%3)*8}%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Ad board
  ctx.fillStyle = '#0e2240';
  ctx.fillRect(0, gameTop * 0.95, W, 25);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 13px Arial';
  ctx.textAlign = 'center';
  const ads = ['⚽ HEAD SOCCER', 'VOXEL CUP', '★ 1 V 1 ★', 'HEAD SOCCER ⚽', 'CHAMPIONS'];
  ads.forEach((ad, i) => ctx.fillText(ad, W * (i + 0.5) / 5, gameTop * 0.95 + 17));

  // Pitch (green field)
  const pitchGrad = ctx.createLinearGradient(0, groundScreenY - ws(0.5), 0, groundScreenY);
  pitchGrad.addColorStop(0, '#2e7d32');
  pitchGrad.addColorStop(1, '#43a047');
  ctx.fillStyle = pitchGrad;
  const fieldLeft = wx(-FW / 2 - 2);
  const fieldRight = wx(FW / 2 + 2);
  ctx.fillRect(fieldLeft, groundScreenY - ws(0.5), fieldRight - fieldLeft, ws(1));

  // Grass stripes
  const halfW = FW / 2;
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue;
    const sx = wx(-halfW + i * FW / 8);
    const sw = ws(FW / 8);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(sx, gameTop + 20, sw, groundScreenY - gameTop - 20);
  }

  // Ground (dirt)
  const dirtGrad = ctx.createLinearGradient(0, groundScreenY, 0, H);
  dirtGrad.addColorStop(0, '#33691e');
  dirtGrad.addColorStop(1, '#1b3a12');
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(0, groundScreenY, W, H - groundScreenY);

  // Ground line
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fieldLeft, groundScreenY);
  ctx.lineTo(fieldRight, groundScreenY);
  ctx.stroke();

  // Center line
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wx(0), gameTop + 30);
  ctx.lineTo(wx(0), groundScreenY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center circle
  ctx.beginPath();
  ctx.arc(wx(0), groundScreenY, ws(3), Math.PI, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.stroke();

  // ===== DRAW GOALS =====
  function drawGoal(side) {
    const gx = side * halfW;
    const netDepth = 2;
    const postX = wx(gx);
    const topY = wy(GH);
    const botY = wy(0);
    const backX = wx(gx + side * netDepth);

    // Net background
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(
      Math.min(postX, backX), topY,
      Math.abs(backX - postX), botY - topY
    );
    // Net lines
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    const netSteps = 8;
    for (let i = 0; i <= netSteps; i++) {
      const ny = topY + (botY - topY) * (i / netSteps);
      ctx.beginPath(); ctx.moveTo(postX, ny); ctx.lineTo(backX, ny); ctx.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const nx = postX + (backX - postX) * (i / 4);
      ctx.beginPath(); ctx.moveTo(nx, topY); ctx.lineTo(nx, botY); ctx.stroke();
    }

    // Posts (white thick lines)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(postX, botY);
    ctx.lineTo(postX, topY);
    ctx.lineTo(backX, topY);
    ctx.stroke();
  }
  drawGoal(-1); // left goal
  drawGoal(1);  // right goal

  // Floodlights
  for (const lx of [wx(-halfW + 2), wx(halfW - 2)]) {
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(lx, gameTop + 20);
    ctx.lineTo(lx, gameTop - 5);
    ctx.stroke();
    ctx.fillStyle = '#ffffcc';
    ctx.shadowColor = '#ffffaa'; ctx.shadowBlur = 15;
    ctx.fillRect(lx - 18, gameTop - 12, 36, 9);
    ctx.shadowBlur = 0;
  }

  // ===== INTERPOLATE POSITIONS =====
  const ballX = lerpN(a.ball[0], b.ball[0], t);
  const ballY = lerpN(a.ball[1], b.ball[1], t);
  const ballSpin = s.ballSpin || 0;

  // ===== DRAW BALL =====
  const bsx = wx(ballX), bsy = wy(ballY);
  const bsr = ws(s.ballR || 0.45);

  // Ball shadow
  const shadowScale = Math.max(0.3, 1 - ballY / 8);
  ctx.fillStyle = `rgba(0,0,0,${0.25 * shadowScale})`;
  ctx.beginPath();
  ctx.ellipse(bsx, groundScreenY + 3, bsr * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ball trail
  const bvx = s.ballVx || 0, bvy = s.ballVy || 0;
  const bspeed = Math.hypot(bvx, bvy);
  if (bspeed > 6) {
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.12 * (4 - i) / 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bsx - ws(bvx * i * 0.04), bsy + ws(bvy * i * 0.04), bsr * (1 - i * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Ball body
  ctx.save();
  ctx.translate(bsx, bsy);
  ctx.rotate(ballSpin);
  const ballGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, bsr);
  ballGrad.addColorStop(0, '#fff');
  ballGrad.addColorStop(1, '#ccc');
  ctx.fillStyle = ballGrad;
  ctx.beginPath(); ctx.arc(0, 0, bsr, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.stroke();
  // Pentagon pattern
  ctx.fillStyle = '#222';
  for (let i = 0; i < 5; i++) {
    const a2 = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a2) * bsr * 0.55, Math.sin(a2) * bsr * 0.55, bsr * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, bsr * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // ===== DRAW POWER-UP (floating) =====
  if (s.powerup) {
    const PU = {
      speed:   { icon: '⚡', col: '#a855f7', label: 'SPEED' },
      jump:    { icon: '🦘', col: '#22d3ee', label: 'JUMP' },
      bighead: { icon: '🗣️', col: '#f59e0b', label: 'BIG HEAD' },
      freeze:  { icon: '❄️', col: '#60a5fa', label: 'FREEZE' },
      bigball: { icon: '⚽', col: '#fbbf24', label: 'BIG BALL' },
    }[s.powerup[2]] || { icon: '★', col: '#fff', label: '' };
    const bob = Math.sin(performance.now() / 300) * ws(0.18);
    const pux = wx(s.powerup[0]);
    const puy = wy(s.powerup[1]) + bob;
    const r = ws(0.75);
    ctx.save();
    ctx.shadowColor = PU.col; ctx.shadowBlur = 22;
    ctx.fillStyle = 'rgba(14,17,24,0.92)';
    ctx.strokeStyle = PU.col; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pux - r, puy - r, r * 2, r * 2, r * 0.45);
    else ctx.rect(pux - r, puy - r, r * 2, r * 2);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(r * 1.3)}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(PU.icon, pux, puy + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = PU.col;
    ctx.font = 'bold 10px Arial';
    ctx.fillText(PU.label, pux, puy - r - 6);
    ctx.restore();
  }

  // ===== DRAW PLAYERS (Sports Heads style: BIG head + two shoes, no body) =====
  const HEAD_WORLD_R = 0.95;   // harus cocok dengan HEAD_R di server
  const FEET_GAP = 0.55;       // harus cocok dengan BODY_H di server
  for (let i = 0; i < s.ps.length && i < chars.length; i++) {
    const pa = a.ps[i], pb = b.ps[i];
    if (!pa || !pb) continue;

    let px = lerpN(pa[0], pb[0], t);
    let py = lerpN(pa[1], pb[1], t);
    let facing = pb[2]; // 1 = kanan, -1 = kiri
    const isKicking = pb[3];
    let vx = pb[4] || 0;
    const bigHead = pb[6];
    const frozen = pb[7];
    const c = chars[i];
    const isRed = i === 0;

    // Pemain sendiri: pakai prediksi lokal supaya gerak terasa instan
    if (i === myIdx && s.phase === 'play') {
      const eff = s.eff ? s.eff[i] : null;
      const hp = predictHs(px, py, dt, eff, frozen, FW, GW);
      px = hp.x; py = hp.y; vx = hp.vx;
      if (!frozen && vx > 0.3) facing = 1; else if (!frozen && vx < -0.3) facing = -1;
    }

    const headWR = HEAD_WORLD_R * (bigHead ? 1.7 : 1);
    const headR = ws(headWR);
    const headCx = wx(px);
    const headCy = wy(py + FEET_GAP + headWR);
    const feetY = wy(py);
    const inAir = py > 0.18;

    const preset = SKIN_PRESETS[c.mesh?.userData?.skin] || SKIN_PRESETS[0];
    const skinColor = frozen ? '#9fd8ff' : (preset?.skin || '#e8b88a');
    const hairColor = preset?.hair || '#1c1c1c';
    const bandColor = isRed ? '#d13b3b' : '#2e6bd6';

    // ----- Shadow (mengecil saat melompat) -----
    ctx.fillStyle = `rgba(0,0,0,${inAir ? 0.14 : 0.28})`;
    ctx.beginPath();
    ctx.ellipse(headCx, groundScreenY + 3, headR * (inAir ? 0.65 : 0.95), 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // ----- Sepatu: dua, melayang di bawah kepala -----
    const moving = Math.abs(vx) > 0.6 && !inAir;
    const shuffle = moving ? Math.sin(performance.now() / 65) * ws(0.16) : 0;
    const kickExt = isKicking ? facing * ws(0.85) : 0;
    const shoeW = ws(0.62), shoeH = ws(0.34);
    function drawShoe(cx, lift) {
      const y = feetY - lift;
      // badan sepatu
      ctx.fillStyle = '#15151a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - shoeW * 0.42, y - shoeH, shoeW * 0.84, shoeH, ws(0.12));
      else ctx.fillRect(cx - shoeW * 0.42, y - shoeH, shoeW * 0.84, shoeH);
      ctx.fill();
      // moncong sepatu mengarah ke depan
      ctx.beginPath();
      ctx.ellipse(cx + facing * shoeW * 0.42, y - shoeH * 0.45, shoeW * 0.34, shoeH * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // sol putih
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(cx - shoeW * 0.42, y - ws(0.07), shoeW * 0.84 + facing * shoeW * 0.3, ws(0.07), ws(0.04));
      else ctx.fillRect(cx - shoeW * 0.42, y - ws(0.07), shoeW * 0.84, ws(0.07));
      ctx.fill();
    }
    drawShoe(headCx - facing * ws(0.26) - shuffle, 0);                       // kaki belakang
    drawShoe(headCx + facing * ws(0.26) + shuffle + kickExt, isKicking ? ws(0.55) : 0); // kaki depan (menendang)

    // ----- Kepala besar -----
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ----- Rambut (separuh atas, dipotong bentuk kepala) -----
    ctx.save();
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.ellipse(headCx, headCy - headR * 0.42, headR * 1.12, headR * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    // ----- Ikat kepala warna tim -----
    ctx.fillStyle = bandColor;
    ctx.fillRect(headCx - headR, headCy - headR * 0.2, headR * 2, headR * 0.17);
    ctx.restore();

    // ----- Mata (menghadap arah lari) -----
    const faceShift = facing * headR * 0.16;
    const eyeY = headCy + headR * 0.04;
    const eyeDx = headR * 0.26;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(headCx + faceShift - eyeDx, eyeY, headR * 0.15, headR * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(headCx + faceShift + eyeDx, eyeY, headR * 0.15, headR * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(headCx + faceShift - eyeDx + facing * headR * 0.05, eyeY + headR * 0.02, headR * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(headCx + faceShift + eyeDx + facing * headR * 0.05, eyeY + headR * 0.02, headR * 0.08, 0, Math.PI * 2); ctx.fill();

    // ----- Mulut -----
    ctx.strokeStyle = '#7a3a2a';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (isKicking) ctx.arc(headCx + faceShift, headCy + headR * 0.46, headR * 0.16, 0, Math.PI);
    else { ctx.moveTo(headCx + faceShift - headR * 0.14, headCy + headR * 0.5); ctx.lineTo(headCx + faceShift + headR * 0.14, headCy + headR * 0.5); }
    ctx.stroke();

    // ----- Efek tendangan -----
    if (isKicking) {
      ctx.strokeStyle = 'rgba(255,255,150,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(headCx + facing * ws(0.5), feetY - ws(0.3), ws(1.1), 0, Math.PI * 2);
      ctx.stroke();
    }

    // ----- Nama -----
    ctx.fillStyle = isRed ? '#ff6b6b' : '#60a5fa';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(c.mesh?.userData?.playerName || (isRed ? 'RED' : 'BLUE'), headCx, headCy - headR - 8);
  }

  // ===== DRAW COUNTDOWN =====
  if (s.phase === 'countdown' && s.countdown >= 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.font = '900 100px Arial';
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 30;
    const txt = s.countdown > 0 ? s.countdown : 'GO!';
    ctx.fillText(txt, W / 2, H / 2 + 30);
    ctx.shadowBlur = 0;
  }

  // Don't render 3D for head soccer
  // (3D renderer is hidden, we use canvas2D)
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Lobby: spin the character preview
  if (!inMatch) {
    if (pvChar) {
      pvTime += dt;
      pvChar.group.rotation.y += dt * 0.9;
      pvChar.group.position.y = Math.sin(pvTime * 2.2) * 0.07;
      const sw = Math.sin(pvTime * 2.2) * 0.12;
      pvChar.armL.rotation.x = sw; pvChar.armR.rotation.x = -sw;
    }
    pvRenderer.render(pvScene, pvCam);
    return;
  }

  if (charging) {
    chargePower = Math.min(1, chargePower + dt * 1.6);
    $('powerbar').style.width = (chargePower * 100) + '%';
  }
  mySlideCd = Math.max(0, mySlideCd - dt);
  myDodgeCd = Math.max(0, myDodgeCd - dt);

  const smp = sampleSnaps();
  if (!smp || !latestSnap) { renderer.render(scene, penaltyMode ? pCam : camera); return; }

  if (latestSnap.mode === 'p') framePenalty(smp, dt);
  else frame5v5(smp, dt);
}
animate();
