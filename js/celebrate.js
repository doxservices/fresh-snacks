/* Hybrid Celebrate: a colorful confetti burst followed 60ms later by a
 * glowing neon trail burst, each with a synthesized explosion "pop" sound.
 * Fires from a fixed full-viewport canvas (never intercepts clicks -
 * pointer-events:none) so it can layer over anything, including an open
 * modal. Any page that wants it just includes this file and calls
 * Celebrate.playHybridCelebrate(x, y). */
(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "celebrate-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const celebrationColors = ["#ff7a59", "#34c759", "#5ea7ff", "#ffd166", "#b07cff", "#ff5fa2"];
  const neonColors = ["#00e5ff", "#ff39c8", "#8dff3d", "#ffd600", "#7a5cff", "#00ffc3"];

  let particles = [];
  let looping = false;

  const randomBetween = (min, max) => Math.random() * (max - min) + min;
  const randomItem = (items) => items[Math.floor(Math.random() * items.length)];

  // Explosion "pop" sound, synthesized (no audio file/licensing to manage) -
  // a short filtered-noise crack layered with a low pitch-dropping thump,
  // the same two-part shape a real firework pop has. Lazily created on the
  // first pop so it's built inside a real user-gesture call chain (every
  // caller of this module is a click handler), satisfying browsers'
  // autoplay policy without needing a separate "enable sound" step.
  let audioCtx = null;
  function playExplosionSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const master = audioCtx.createGain();
      master.gain.value = 0.5;
      master.connect(audioCtx.destination);

      // The crack: a short burst of filtered white noise.
      const noiseDuration = 0.35;
      const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * noiseDuration, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;
      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = randomBetween(900, 1500);
      noiseFilter.Q.value = 0.7;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.9, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + noiseDuration);

      // The thump: a low oscillator with a quick downward pitch sweep.
      const thump = audioCtx.createOscillator();
      thump.type = "sine";
      thump.frequency.setValueAtTime(randomBetween(120, 160), now);
      thump.frequency.exponentialRampToValueAtTime(35, now + 0.3);
      const thumpGain = audioCtx.createGain();
      thumpGain.gain.setValueAtTime(0.8, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      thump.connect(thumpGain);
      thumpGain.connect(master);
      thump.start(now);
      thump.stop(now + 0.4);
    } catch (_) {
      // Web Audio unsupported/blocked - the visual celebration still runs fine without it.
    }
  }

  function createConfettiBurst(x, y) {
    // Small circular sparks.
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(0.9, 1.7);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: randomItem(celebrationColors),
        shape: "dot",
        size: randomBetween(2, 3),
        life: 1,
        fade: 0.018,
        gravity: 0.04,
        rotation: 0,
        rotationSpeed: 0,
      });
    }
    // Rectangular confetti pieces.
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(0.8, 2.2);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: randomItem(celebrationColors),
        shape: "confetti",
        size: randomBetween(3, 4.6),
        life: 1,
        fade: randomBetween(0.018, 0.03),
        gravity: 0.055,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: randomBetween(-0.18, 0.18),
      });
    }
    ensureLoop();
  }

  function createNeonTrails(x, y) {
    const count = 44;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + randomBetween(-0.08, 0.08);
      const speed = randomBetween(1.1, 2.6);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: randomItem(neonColors),
        shape: "neon",
        size: randomBetween(2.2, 3.4),
        life: 1,
        fade: randomBetween(0.011, 0.015),
        gravity: 0.038,
        rotation: 0,
        rotationSpeed: 0,
        trail: [],
      });
    }
    ensureLoop();
  }

  function drawParticle(p) {
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.shape === "dot") {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
      ctx.restore();
    } else if (p.shape === "neon") {
      if (p.trail.length > 1) {
        ctx.save();
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      if (p.shape === "neon") {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 8) p.trail.shift();
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.rotationSpeed;
      p.life -= p.fade;
      drawParticle(p);
    }
    if (particles.length > 0) {
      requestAnimationFrame(tick);
    } else {
      looping = false;
    }
  }
  function ensureLoop() {
    if (!looping) {
      looping = true;
      requestAnimationFrame(tick);
    }
  }

  function playHybridCelebrate(x, y) {
    createConfettiBurst(x, y);
    playExplosionSound();
    window.setTimeout(() => createNeonTrails(x, y), 60);
  }

  // A real fireworks show, not one static burst: several pops staggered
  // about a second apart, each landing at its own random spot in the
  // "sky" (upper-middle of the screen, inset from the edges so nothing
  // launches off-screen). Returns the ms delay until 5 seconds after the
  // LAST pop launches, so a caller can auto-close a modal exactly then.
  const MODAL_CLOSE_DELAY_AFTER_LAST_BURST_MS = 5000;
  function playFireworksShow(popCount) {
    const count = Math.max(5, popCount || Math.round(randomBetween(5, 7)));
    let delay = 0;
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        const x = randomBetween(window.innerWidth * 0.15, window.innerWidth * 0.85);
        const y = randomBetween(window.innerHeight * 0.15, window.innerHeight * 0.55);
        // Via window.Celebrate rather than the bare local function, so this
        // stays the single real entry point for a pop - anything watching
        // the public API (including verification tooling) sees every pop.
        window.Celebrate.playHybridCelebrate(x, y);
      }, delay);
      if (i < count - 1) delay += randomBetween(950, 1050);
    }
    return delay + MODAL_CLOSE_DELAY_AFTER_LAST_BURST_MS;
  }

  window.Celebrate = { playHybridCelebrate, playFireworksShow };
})();
