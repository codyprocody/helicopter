(() => {
  'use strict';

  // ---------- Config (world units: view is always 600 tall) ----------
  const VIEW_H = 600;
  const STEP = 1 / 120;
  const GRAVITY = 1500;
  const LIFT = 2300;
  const MAX_VY = 520;
  const HELI_SCALE = 0.5;               // helicopter drawn at half the original size
  const HELI_W = 56 * HELI_SCALE, HELI_H = 26 * HELI_SCALE;       // collision body
  const POINT_GAP = 260;                // spacing of cave control points
  const BEST_KEY = 'helicopter.best';
  const MUTE_KEY = 'helicopter.muted';
  const NICK_KEY = 'helicopter.nick';
  const THEME_KEY = 'helicopter.theme';
  const THEMES = ['night', 'disco'];
  const NICK_RE = /^[\w .\-]{1,16}$/;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const el = {
    hud: $('hud'), score: $('score'), best: $('best'), mute: $('mute'),
    menu: $('menu'), over: $('over'), final: $('finalScore'),
    newBest: $('newBest'), gear: $('settingsBtn'), settings: $('settings'), soundBtn: $('soundToggle'), themeBtns: document.querySelectorAll('[data-theme-choice]'), nick: $('nick'), play: $('play'), board: $('board'), boardNote: $('boardNote'), menuBest: $('menuBest'), overBest: $('overBest'),
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- State ----------
  let W = 0, H = 0, scale = 1, dpr = 1;
  let state = 'menu';                     // menu | play | dead
  let held = 0, keyHeld = false;
  let best = parseInt(store.get(BEST_KEY) || '0', 10) || 0;
  let muted = store.get(MUTE_KEY) === '1';
  let camX = 0, speed = 0, dist = 0, time = 0, shake = 0, deadAt = 0;
  let heli, points, obstacles, particles;
  let lastScoreShown = -1;
  let theme = THEMES.includes(store.get(THEME_KEY)) ? store.get(THEME_KEY) : 'night';
  let nickname = (store.get(NICK_KEY) || '').slice(0, 16);
  let startedAt = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => t * t * (3 - 2 * t);

  // ---------- Cave generation ----------
  function gapFor(d) { return Math.max(310, 480 - d * 0.045); }

  function addPoint() {
    const last = points[points.length - 1];
    const gap = gapFor(Math.max(0, last.x + POINT_GAP) / 10);
    const margin = 30;
    const lo = margin + gap / 2, hi = VIEW_H - margin - gap / 2;
    const c = clamp(last.c + rand(-150, 150), lo, hi);
    const p = { x: last.x + POINT_GAP, c, g: gap };
    points.push(p);
    // obstacle once the player is past the opening stretch
    if (p.x > 1600 && Math.random() < Math.min(0.55, 0.15 + p.x / 30000)) {
      const h = rand(70, 100);
      const top = c - gap / 2, room = gap - 120 - h;
      if (room > 10) {
        const y = top + 60 + Math.random() * room;
        obstacles.push({ x: p.x - 22, y, w: 44 + rand(0, 14), h });
      }
    }
  }

  function caveAt(x) {
    let i = 0;
    // points are ordered; binary-ish search from start is fine (short list)
    while (i < points.length - 2 && points[i + 1].x < x) i++;
    const a = points[i], b = points[i + 1];
    const t = smooth(clamp((x - a.x) / (b.x - a.x), 0, 1));
    const c = a.c + (b.c - a.c) * t, g = a.g + (b.g - a.g) * t;
    return { top: c - g / 2, bot: c + g / 2 };
  }

  // ---------- Game lifecycle ----------
  function resetWorld(demo) {
    camX = 0; dist = 0; time = 0; shake = 0;
    speed = demo ? 170 : 280;
    points = [{ x: -POINT_GAP * 2, c: VIEW_H / 2, g: 500 }, { x: -POINT_GAP, c: VIEW_H / 2, g: 500 }, { x: 0, c: VIEW_H / 2, g: 500 }];
    obstacles = [];
    particles = [];
    while (points[points.length - 1].x < W + POINT_GAP * 3) addPoint();
    heli = { x: heliScreenX(), y: VIEW_H / 2, vy: 0, tilt: 0, rotor: 0 };
    lastScoreShown = -1;
  }

  function heliScreenX() { return Math.max(90, W * 0.24); }

  function show(which) {
    el.menu.classList.toggle('hidden', which !== 'menu');
    el.over.classList.toggle('hidden', which !== 'over');
    el.hud.classList.toggle('hidden', which !== 'play');
    el.gear.classList.toggle('hidden', which === 'play');
  }

  function startGame() {
    startedAt = time;
    resetWorld(false);
    state = 'play';
    show('play');
    el.best.textContent = best;
    Audio.resume();
  }

  function crash() {
    state = 'dead';
    deadAt = performance.now();
    shake = 14;
    const score = Math.floor(dist / 10);
    const isBest = score > best;
    if (isBest) { best = score; store.set(BEST_KEY, String(best)); }
    el.final.textContent = score;
    el.overBest.textContent = best;
    el.menuBest.textContent = best;
    el.newBest.classList.toggle('hidden', !isBest);
    const wx = camX + heli.x;
    for (let i = 0; i < 46; i++) {
      const a = rand(0, Math.PI * 2), s = rand(60, 420);
      particles.push({ x: wx, y: heli.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 1, max: rand(0.5, 1.3), r: rand(2, 6), kind: i % 3 === 0 ? 'fire' : 'debris' });
    }
    Audio.crash();
    submitScore(score, Math.round((time - startedAt) * 1000) + 1000);
    setTimeout(() => { if (state === 'dead') show('over'); }, 450);
  }

  function tryStart() {
    const n = el.nick.value.trim();
    if (!NICK_RE.test(n)) {
      el.nick.focus();
      el.nick.classList.add('bad');
      return false;
    }
    nickname = n;
    store.set(NICK_KEY, n);
    el.nick.blur();
    startGame();
    return true;
  }

  // ---------- Leaderboard ----------
  function renderBoard(top, me) {
    el.board.textContent = '';
    if (!top || !top.length) { el.boardNote.textContent = 'No scores yet'; return; }
    el.boardNote.textContent = '';
    let youShown = false;
    top.forEach((r, i) => {
      const li = document.createElement('li');
      const you = me && r.nick.toLowerCase() === me.toLowerCase();
      if (you) { li.className = 'you'; youShown = true; }
      const a = document.createElement('span'); a.className = 'pos'; a.textContent = i + 1;
      const b = document.createElement('span'); b.className = 'nm'; b.textContent = r.nick;
      const c = document.createElement('span'); c.className = 'sc'; c.textContent = r.score;
      li.append(a, b, c);
      el.board.appendChild(li);
    });
    return youShown;
  }

  async function submitScore(score, ms) {
    el.boardNote.textContent = 'Loading leaderboard…';
    el.board.textContent = '';
    try {
      const r = await fetch('/api/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nick: nickname, score, ms }),
      });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      renderBoard(d.top, nickname);
      if (d.rank && d.rank > d.top.length) el.boardNote.textContent = `Your best rank: #${d.rank}`;
    } catch {
      try {
        const r = await fetch('/api/leaderboard');
        renderBoard((await r.json()).top, nickname);
      } catch { el.boardNote.textContent = 'Leaderboard unavailable'; }
    }
  }

  function inputDown() {
    if (state === 'menu') tryStart();
    else if (state === 'dead' && performance.now() - deadAt > 700) { resetWorld(true); startGame(); }
  }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    const active = state === 'play';
    const lifting = active && (held > 0 || keyHeld);

    if (active) {
      speed = 280 + Math.min(dist / 40, 230);
      const a = lifting ? -LIFT : GRAVITY;
      heli.vy = clamp(heli.vy + a * dt, -MAX_VY, MAX_VY);
      heli.y += heli.vy * dt;
    } else if (state === 'menu') {
      heli.y = VIEW_H / 2 + Math.sin(time * 2.2) * 14;
      heli.vy = Math.cos(time * 2.2) * 30;
    } else {
      // falling wreck stops
    }

    if (state !== 'dead') {
      camX += speed * dt;
      dist = camX;
    } else {
      speed *= Math.pow(0.0005, dt);
      camX += speed * dt;
    }

    const targetTilt = clamp(heli.vy / MAX_VY, -1, 1) * 0.28 + (active ? 0.06 : 0);
    heli.tilt += (targetTilt - heli.tilt) * Math.min(1, dt * 10);
    heli.rotor += dt * (lifting ? 46 : 36);

    while (points[points.length - 1].x < camX + W + POINT_GAP * 2) addPoint();
    while (points.length > 4 && points[2].x < camX - POINT_GAP) points.shift();
    while (obstacles.length && obstacles[0].x + obstacles[0].w < camX - 80) obstacles.shift();

    if (active) {
      // exhaust smoke
      if (Math.random() < dt * (lifting ? 70 : 30)) {
        particles.push({ x: camX + heli.x - 34 * HELI_SCALE, y: heli.y + 2 * HELI_SCALE, vx: -speed * 0.15 + rand(-20, 10), vy: rand(-30, 20), life: 1, max: rand(0.5, 0.9), r: rand(3, 6) * HELI_SCALE * 1.4, kind: 'smoke' });
      }
      checkCollision();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt / p.max;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.kind === 'debris') p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    shake *= Math.pow(0.002, dt);
    Audio.update(active, lifting, state === 'menu');

    if (active) {
      const s = Math.floor(dist / 10);
      if (s !== lastScoreShown) { lastScoreShown = s; el.score.textContent = s; if (s > best) el.best.textContent = s; }
    }
  }

  function checkCollision() {
    const wx = camX + heli.x;
    const hw = HELI_W / 2 - 2, hh = HELI_H / 2 - 1.5;
    const xs = [wx - hw, wx - hw / 2, wx, wx + hw / 2, wx + hw];
    for (const x of xs) {
      const c = caveAt(x);
      if (heli.y - hh < c.top || heli.y + hh > c.bot) return crash();
    }
    for (const o of obstacles) {
      if (wx + hw > o.x && wx - hw < o.x + o.w && heli.y + hh > o.y && heli.y - hh < o.y + o.h) return crash();
    }
    // rotor blade is thin; check it against ceiling too
    const c = caveAt(wx);
    if (heli.y - 22 * HELI_SCALE < c.top) return crash();
  }

  // ---------- Rendering ----------
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.7, r: rand(0.6, 1.8), t: Math.random() * 6 }));

  function ridge(offset, par, base, amp, color, f1, f2) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_H);
    for (let sx = 0; sx <= W + 16; sx += 16) {
      const x = sx + camX * par + offset;
      const y = base - (Math.sin(x * f1) * 0.6 + Math.sin(x * f2 + 1.7) * 0.4) * amp;
      ctx.lineTo(sx, y);
    }
    ctx.lineTo(W, VIEW_H);
    ctx.closePath();
    ctx.fill();
  }

  const NIGHT = {
    sky: ['#0b1026', '#2b2f6b', '#a1476f'], ridge1: '#3b3274', ridge2: '#2a2358',
    rock: ['#1a1633', '#241a3d'], rim: '#7d6cff', obsA: '#4a3f8f', obsB: '#2c2560', obsEdge: '#9d8fff',
  };
  function palette() {
    if (theme === 'night') return NIGHT;
    const h = (time * 30) % 360;
    const c = (o, sat, l) => `hsl(${(h + o) % 360},${sat}%,${l}%)`;
    return {
      sky: [c(0, 70, 8), c(40, 80, 16), c(120, 85, 28)], ridge1: c(200, 60, 22), ridge2: c(240, 60, 14),
      rock: ['#0d0618', '#1a0a2e'], rim: c(0, 100, 62), obsA: c(300, 80, 40), obsB: c(180, 80, 22), obsEdge: c(60, 100, 70),
    };
  }
  let pal = NIGHT;

  function drawDiscoExtras() {
    const bx = W * 0.5, by = 70;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI / 2 + Math.sin(time * 0.8 + i * 1.3) * 0.9;
      const spread = 0.07;
      ctx.fillStyle = `hsla(${(time * 60 + i * 52) % 360},100%,60%,0.16)`;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a - spread) * 1400, by + Math.sin(a - spread) * 1400);
      ctx.lineTo(bx + Math.cos(a + spread) * 1400, by + Math.sin(a + spread) * 1400);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // mirror ball
    ctx.save();
    ctx.translate(bx, by);
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -by); ctx.lineTo(0, -26); ctx.stroke();
    const bg = ctx.createRadialGradient(-8, -8, 2, 0, 0, 28);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#7b7f9e');
    ctx.fillStyle = bg;
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 26, 0, 6.2832); ctx.clip();
    for (let gy = -26; gy < 26; gy += 8) for (let gx = -26; gx < 26; gx += 8) {
      const k = Math.sin(gx * 0.7 + gy * 1.3 + time * 3);
      ctx.fillStyle = `hsla(${(time * 90 + gx * 6 + gy * 9) % 360},90%,${55 + k * 25}%,${0.35 + 0.3 * Math.abs(k)})`;
      ctx.fillRect(gx + 0.5, gy + 0.5, 7, 7);
    }
    ctx.restore();
    ctx.restore();
    // twinkling sparkles
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 137.5 + Math.sin(i) * 40) % W + W) % W, sy = (i * 71.3) % VIEW_H;
      const tw = Math.max(0, Math.sin(time * 4 + i * 2.1));
      if (tw < 0.2) continue;
      ctx.fillStyle = `hsla(${(time * 80 + i * 40) % 360},100%,80%,${tw})`;
      const r = 1 + tw * 2.5;
      ctx.fillRect(sx - r, sy - 0.5, r * 2, 1); ctx.fillRect(sx - 0.5, sy - r, 1, r * 2);
    }
  }

  function drawBackground() {
    pal = palette();
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(0.55, pal.sky[1]); g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, VIEW_H);
    if (theme === 'night') for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(time * 1.5 + s.t);
      ctx.globalAlpha = tw * 0.8;
      ctx.fillStyle = '#fff';
      const sx = ((s.x * W - camX * 0.02) % W + W) % W;
      ctx.beginPath(); ctx.arc(sx, s.y * VIEW_H, s.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ridge(0, 0.08, 470, 80, pal.ridge1, 0.004, 0.011);
    ridge(300, 0.18, 520, 60, pal.ridge2, 0.006, 0.017);
    if (theme === 'disco') drawDiscoExtras();
  }

  function drawCave() {
    const step = 8;
    const hasTop = [], hasBot = [];
    for (let sx = -step; sx <= W + step; sx += step) {
      const c = caveAt(sx + camX);
      hasTop.push([sx, c.top]); hasBot.push([sx, c.bot]);
    }
    const rock = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    rock.addColorStop(0, pal.rock[0]); rock.addColorStop(1, pal.rock[1]);

    const path = (pts, edge) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], edge);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], edge);
      ctx.closePath();
    };
    ctx.fillStyle = rock;
    path(hasTop, -20); ctx.fill();
    path(hasBot, VIEW_H + 20); ctx.fill();

    // glowing rim
    ctx.lineWidth = 3; ctx.lineJoin = 'round';
    if (theme === 'disco') {
      const rg = ctx.createLinearGradient(0, 0, W, 0);
      for (let i = 0; i <= 4; i++) rg.addColorStop(i / 4, `hsl(${(time * 90 + i * 70) % 360},100%,62%)`);
      ctx.strokeStyle = rg; ctx.shadowColor = pal.rim;
    } else { ctx.strokeStyle = pal.rim; ctx.shadowColor = pal.rim; }
    ctx.shadowBlur = 14;
    for (const pts of [hasTop, hasBot]) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function drawObstacles() {
    for (const o of obstacles) {
      const x = o.x - camX;
      if (x > W + 60 || x + o.w < -60) continue;
      const g = ctx.createLinearGradient(x, 0, x + o.w, 0);
      g.addColorStop(0, pal.obsA); g.addColorStop(1, pal.obsB);
      ctx.fillStyle = g;
      ctx.shadowColor = pal.rim; ctx.shadowBlur = 10;
      roundRect(x, o.y, o.w, o.h, 8); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.obsEdge; ctx.lineWidth = 2;
      roundRect(x, o.y, o.w, o.h, 8); ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawParticles() {
    for (const p of particles) {
      const x = p.x - camX, a = Math.max(0, p.life);
      if (p.kind === 'smoke') {
        ctx.fillStyle = `rgba(210,214,255,${a * 0.35})`;
        ctx.beginPath(); ctx.arc(x, p.y, p.r * (1.6 - a * 0.6), 0, 6.2832); ctx.fill();
      } else if (p.kind === 'fire') {
        ctx.fillStyle = `rgba(255,${Math.floor(120 + 110 * a)},60,${a})`;
        ctx.beginPath(); ctx.arc(x, p.y, p.r * (0.6 + a), 0, 6.2832); ctx.fill();
      } else {
        ctx.fillStyle = `rgba(230,50,60,${a})`;
        ctx.fillRect(x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
    }
  }

  function drawHeli() {
    if (state === 'dead') return;
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.rotate(heli.tilt);
    ctx.scale(HELI_SCALE, HELI_SCALE);
    // shadow glow
    ctx.shadowColor = 'rgba(255,70,70,.5)'; ctx.shadowBlur = 16;
    // tail boom
    ctx.fillStyle = '#b81d2c';
    roundRect(-6, -4, -34, 7, 3); ctx.fill();
    roundRect(-40, -12, 6, 14, 3); ctx.fill();
    // tail rotor
    ctx.save(); ctx.translate(-38, -5); ctx.rotate(heli.rotor * 1.4);
    ctx.fillStyle = '#cfd8ff'; ctx.fillRect(-1, -8, 2, 16);
    ctx.restore();
    // body
    const bg = ctx.createLinearGradient(0, -14, 0, 14);
    bg.addColorStop(0, '#ff6b6b'); bg.addColorStop(1, '#c81e2f');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(2, 0, 26, 14, 0, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    // cockpit window
    const wg = ctx.createLinearGradient(0, -10, 0, 6);
    wg.addColorStop(0, '#c9f0ff'); wg.addColorStop(1, '#4aa9dc');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(11, -2, 12, 8, 0.1, Math.PI, 0); ctx.lineTo(23, 2); ctx.lineTo(-1, 2); ctx.closePath(); ctx.fill();
    // mast + rotor
    ctx.fillStyle = '#9aa6d6'; ctx.fillRect(-2, -20, 4, 8);
    const sw = Math.cos(heli.rotor);
    ctx.fillStyle = 'rgba(207,216,255,.28)';
    ctx.beginPath(); ctx.ellipse(0, -21, 46, 2.5, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#e4e9ff';
    ctx.beginPath(); ctx.ellipse(0, -21, 46 * Math.abs(sw), 1.6, 0, 0, 6.2832); ctx.fill();
    // skids
    ctx.strokeStyle = '#cfd8ff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-14, 19); ctx.lineTo(20, 19); ctx.moveTo(-8, 13); ctx.lineTo(-10, 19); ctx.moveTo(14, 13); ctx.lineTo(15, 19); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (shake > 0.2) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawBackground();
    drawCave();
    drawObstacles();
    drawParticles();
    drawHeli();
  }

  // ---------- Audio (synthesised, no assets) ----------
  const Audio = (() => {
    let ac = null, osc, lfo, gain, filt, noiseBuf;
    function init() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 52;
      lfo = ac.createOscillator(); lfo.frequency.value = 17;
      const lg = ac.createGain(); lg.gain.value = 0.5;
      gain = ac.createGain(); gain.gain.value = 0;
      filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
      const am = ac.createGain(); am.gain.value = 0.5;
      lfo.connect(lg); lg.connect(am.gain);
      osc.connect(filt); filt.connect(am); am.connect(gain); gain.connect(ac.destination);
      osc.start(); lfo.start();
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.8, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    return {
      resume() { init(); if (ac && ac.state === 'suspended') ac.resume(); },
      update(active, lifting, menu) {
        if (!ac) return;
        const t = ac.currentTime;
        const on = !muted && (active || menu);
        const vol = on ? (menu ? 0.025 : lifting ? 0.11 : 0.07) : 0;
        gain.gain.setTargetAtTime(vol, t, 0.08);
        lfo.frequency.setTargetAtTime(lifting ? 21 : 16, t, 0.12);
        osc.frequency.setTargetAtTime(lifting ? 60 : 50, t, 0.12);
      },
      crash() {
        if (!ac || muted) return;
        const src = ac.createBufferSource(); src.buffer = noiseBuf;
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
        const g = ac.createGain(); g.gain.value = 0.5;
        src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
      },
    };
  })();

  // ---------- Input ----------
  function bindInput() {
    const down = e => {
      if (e.target === el.mute || settingsOpen) return;
      e.preventDefault();
      if (state === 'menu') { held = 0; inputDown(); return; }
      held++;
      inputDown();
    };
    const up = e => { if (e.target === el.mute || settingsOpen) return; held = Math.max(0, held - 1); };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', () => { held = 0; });
    window.addEventListener('blur', () => { held = 0; keyHeld = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    for (const id of ['menu', 'over']) {
      // overlays have pointer-events: none, so taps reach the canvas
      el[id].style.pointerEvents = 'none';
      // ...except the menu's nickname field and Play button
      if (id === 'menu') { el.nick.style.pointerEvents = 'auto'; el.play.style.pointerEvents = 'auto'; }
    }
    window.addEventListener('keydown', e => {
      if (settingsOpen) { if (e.code === 'Escape') setSettings(false); return; }
      if (e.target === el.nick) {
        if (e.code === 'Enter') { e.preventDefault(); tryStart(); }
        return;
      }
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
        e.preventDefault();
        if (!e.repeat) { keyHeld = true; inputDown(); }
      } else if (e.code === 'KeyM') toggleMute();
    });
    window.addEventListener('keyup', e => {
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) keyHeld = false;
    });
    el.mute.addEventListener('click', toggleMute);
    el.play.addEventListener('click', tryStart);
    el.gear.addEventListener('click', () => setSettings(true));
    el.soundBtn.addEventListener('click', toggleMute);
    el.settings.addEventListener('pointerdown', e => { if (e.target === el.settings || e.target.id === 'closeSettings') setSettings(false); });
    el.themeBtns.forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeChoice)));
    el.nick.addEventListener('input', () => el.nick.classList.remove('bad'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) { held = 0; keyHeld = false; } });
  }

  // ---------- Settings ----------
  let settingsOpen = false;

  function applyTheme(t) {
    theme = t;
    store.set(THEME_KEY, t);
    document.documentElement.dataset.theme = t;
    el.themeBtns.forEach(b => {
      const on = b.dataset.themeChoice === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setSettings(open) {
    settingsOpen = open;
    el.settings.classList.toggle('hidden', !open);
    held = 0; keyHeld = false;
  }

  function toggleMute() {
    muted = !muted;
    store.set(MUTE_KEY, muted ? '1' : '0');
    el.mute.textContent = muted ? '🔇' : '🔊';
    el.soundBtn.textContent = muted ? 'Off' : 'On';
    if (muted) Audio.update(false, false, false);
  }

  // ---------- Sizing & loop ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = canvas.height / VIEW_H;
    W = canvas.width / scale;
    H = VIEW_H;
    if (heli) heli.x = heliScreenX();
  }

  let last = 0, acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  el.menuBest.textContent = best;
  el.nick.value = nickname;
  el.mute.textContent = muted ? '🔇' : '🔊';
  el.soundBtn.textContent = muted ? 'Off' : 'On';
  applyTheme(theme);
  resize();
  resetWorld(true);
  bindInput();
  window.addEventListener('resize', resize);
  requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
})();
