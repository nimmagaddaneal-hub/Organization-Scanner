// Draggable ink sculpture for the home page: ribbons and dust drawn on a 2D canvas with a 3D projection.
(() => {
  const canvas = document.getElementById('ink-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const seedLabel = document.getElementById('ink-seed');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SEGMENTS = 150;
  let ribbons = [];
  let dust = [];
  let seed = 4211;
  let rotX = -0.35;
  let rotY = 0.6;
  let velX = 0;
  let velY = reduceMotion ? 0 : 0.0035;
  let width = 0;
  let height = 0;
  let visible = true;

  function mulberry32(a) {
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rotate = ([x, y, z], ax, ay, az) => {
    let [cx, sx] = [Math.cos(ax), Math.sin(ax)];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [cx, sx] = [Math.cos(ay), Math.sin(ay)];
    [x, z] = [x * cx + z * sx, -x * sx + z * cx];
    [cx, sx] = [Math.cos(az), Math.sin(az)];
    [x, y] = [x * cx - y * sx, x * sx + y * cx];
    return [x, y, z];
  };

  function build(newSeed) {
    seed = newSeed;
    const rand = mulberry32(seed);
    ribbons = [];
    dust = [];
    for (let i = 0; i < 6; i++) {
      const shape = { a: 0.75 + rand() * 0.45, b: 0.75 + rand() * 0.45, c: 0.45 + rand() * 0.6, k: 1 + Math.floor(rand() * 3), phase: rand() * 6.28 };
      const tilt = [rand() * 3.14, rand() * 3.14, rand() * 3.14];
      const half = 0.03 + rand() * 0.07;
      const points = [];
      for (let s = 0; s < SEGMENTS; s++) {
        const t = (s / SEGMENTS) * Math.PI * 2;
        points.push(rotate([Math.cos(t) * shape.a, Math.sin(t) * shape.b, Math.sin(shape.k * t + shape.phase) * shape.c], ...tilt));
      }
      // Width direction: cross product of the path direction and the outward direction.
      const sides = points.map((p, s) => {
        const next = points[(s + 1) % SEGMENTS];
        const d = [next[0] - p[0], next[1] - p[1], next[2] - p[2]];
        const n = [
          d[1] * p[2] - d[2] * p[1],
          d[2] * p[0] - d[0] * p[2],
          d[0] * p[1] - d[1] * p[0],
        ];
        const len = Math.hypot(...n) || 1;
        return n.map((v) => (v / len) * half * (0.6 + 0.4 * Math.sin(s * 0.17 + i)));
      });
      ribbons.push({ points, sides, shade: 0.3 + rand() * 0.6 });
      for (let d = 0; d < 170; d++) {
        const s = Math.floor(rand() * SEGMENTS);
        const jitter = () => (rand() + rand() + rand() - 1.5) * 0.14;
        dust.push([points[s][0] + jitter(), points[s][1] + jitter(), points[s][2] + jitter(), 0.25 + rand() * 0.6]);
      }
    }
    if (seedLabel) seedLabel.textContent = `seed ${String(seed % 100000).padStart(5, '0')}`;
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function draw() {
    const ink = getComputedStyle(canvas).getPropertyValue('--ink-rgb').trim() || '17, 17, 17';
    const scale = Math.min(width, height) * 0.3;
    const cx = width / 2;
    const cy = height / 2;
    const project = ([x, y, z]) => {
      const [rx, ry, rz] = rotate([x, y, z], rotX, rotY, 0);
      const f = 3.2 / (3.2 - rz * 0.9);
      return [cx + rx * scale * f, cy + ry * scale * f, rz];
    };
    ctx.clearRect(0, 0, width, height);

    // Faint axes and spikes.
    ctx.strokeStyle = `rgba(${ink}, 0.16)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.moveTo(0, cy);
    ctx.lineTo(width, cy);
    ctx.stroke();

    for (const ribbon of ribbons) {
      for (let s = 0; s < SEGMENTS; s++) {
        const n = (s + 1) % SEGMENTS;
        const a = ribbon.points[s];
        const b = ribbon.points[n];
        const sa = ribbon.sides[s];
        const sb = ribbon.sides[n];
        const p1 = project([a[0] + sa[0], a[1] + sa[1], a[2] + sa[2]]);
        const p2 = project([b[0] + sb[0], b[1] + sb[1], b[2] + sb[2]]);
        const p3 = project([b[0] - sb[0], b[1] - sb[1], b[2] - sb[2]]);
        const p4 = project([a[0] - sa[0], a[1] - sa[1], a[2] - sa[2]]);
        const depth = (p1[2] + p3[2]) / 2;
        const alpha = Math.max(0.08, Math.min(0.95, (0.55 + depth * 0.5) * ribbon.shade + 0.1));
        ctx.fillStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.lineTo(p4[0], p4[1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    for (const [x, y, z, weight] of dust) {
      const p = project([x, y, z]);
      ctx.fillStyle = `rgba(${ink}, ${Math.max(0.05, (0.45 + p[2] * 0.4) * weight).toFixed(3)})`;
      ctx.fillRect(p[0], p[1], 1.3, 1.3);
    }

    // Glass core.
    const core = scale * 0.2;
    const gradient = ctx.createRadialGradient(cx - core * 0.3, cy - core * 0.3, core * 0.1, cx, cy, core);
    gradient.addColorStop(0, `rgba(${ink}, 0.02)`);
    gradient.addColorStop(1, `rgba(${ink}, 0.2)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${ink}, 0.45)`;
    ctx.stroke();
  }

  // Drag to rotate. A click without moving makes a new sculpture.
  let dragging = false;
  let moved = 0;
  let last = [0, 0];
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = 0;
    last = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - last[0];
    const dy = event.clientY - last[1];
    last = [event.clientX, event.clientY];
    moved += Math.abs(dx) + Math.abs(dy);
    rotY += dx * 0.01;
    rotX += dy * 0.01;
    velY = dx * 0.003;
    velX = dy * 0.003;
    if (reduceMotion) draw();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (moved < 4) {
      build(Math.floor(Math.random() * 99999));
      if (reduceMotion) draw();
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function frame() {
    if (visible && !reduceMotion) {
      if (!dragging) {
        rotY += velY;
        rotX += velX;
        velX *= 0.95;
        velY = velY * 0.98 + 0.0035 * 0.02;
      }
      draw();
    }
    requestAnimationFrame(frame);
  }

  build(seed);
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  }).observe(canvas);
  resize();
  requestAnimationFrame(frame);
})();
