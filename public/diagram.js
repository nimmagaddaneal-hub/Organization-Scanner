// The "ours" diagram on the home page, drawn in 3D (isometric) on a canvas.
// The section locks in place while you scroll. As you scroll, items, a dashboard, a platform and finally
// "your organization" drop onto the ground. Each landing sends a ripple across the ground and a pulse ring.
// Falling follows the scroll position, so scrolling back up lifts everything again.
(() => {
  const section = document.getElementById('compare');
  const box = document.getElementById('diagram');
  const canvas = document.getElementById('dg-canvas');
  if (!section || !box || !canvas) return;
  const track = section.querySelector('.story-track');
  const stage = section.querySelector('.story-stage');
  const bar = section.querySelector('.story-bar span');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Logical drawing size. The canvas is scaled to the screen, so lines stay sharp.
  const W = 720;
  const H = 480;
  const A = 46; // half width of one ground unit on screen
  const B = 23; // half height of one ground unit on screen
  const OX = W / 2;
  const OY = 140;
  const N = 7; // ground is N by N units
  const STEP = 0.25; // ground mesh step, for smooth waves
  const M = N / STEP;
  const DROP = 560;
  const FALL = 0.12;

  // ti: scroll position (0 to 1) where the thing lands. amp: how hard it hits (pixels of ripple).
  const things = [
    { id: 'left', kind: 'cube', x: 0.7, y: 4.7, w: 1.2, d: 1.2, h: 46, ti: 0.14, amp: 9 },
    { id: 'right', kind: 'cube', x: 4.7, y: 0.7, w: 1.2, d: 1.2, h: 46, ti: 0.28, amp: 9 },
    { id: 'front', kind: 'cube', x: 3.7, y: 5.5, w: 1.2, d: 1.2, h: 46, ti: 0.42, amp: 9 },
    { id: 'slab', kind: 'slab', x: 5.0, y: 3.8, w: 1.8, d: 1.1, h: 12, ti: 0.58, amp: 12 },
    { id: 'pad', kind: 'pad', x: 2.65, y: 2.65, w: 1.7, d: 1.7, h: 14, ti: 0.72, amp: 14 },
    { id: 'orb', kind: 'orb', x: 3.5, y: 3.5, w: 0, d: 0, h: 0, ti: 0.88, amp: 22 },
  ];
  things.forEach((thing) => {
    thing.landed = false;
    thing.hopAt = -1e9;
    thing.landedAt = -1e9;
  });
  const byId = Object.fromEntries(things.map((thing) => [thing.id, thing]));
  let ripples = [];
  let shake = { amount: 0, at: -1e9 };
  let first = true;
  let visible = true;
  let scale = 1;
  const staticProgress = reduceMotion ? 1 : null;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const iso = (x, y, z) => [OX + (x - y) * A, OY + (x + y) * B - z];

  // Labels and numbered pins are real text on top of the canvas. Each sits at a spot on the ground
  // and appears once the thing it belongs to has landed.
  const tags = [...box.querySelectorAll('[data-after]')].map((el) => {
    const [px, py] = iso(Number(el.dataset.x), Number(el.dataset.y), Number(el.dataset.z || 0));
    el.style.left = `${(px / W) * 100}%`;
    el.style.top = `${(py / H) * 100}%`;
    return { el, after: byId[el.dataset.after] };
  });
  const legend = [...section.querySelectorAll('.callouts li')];

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, canvas.clientWidth);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((width * H * ratio) / W);
    scale = canvas.width / W;
  }

  // A ripple: a ring of lifted ground that travels outward and fades.
  function waveAt(x, y, now) {
    let z = 0;
    for (const ripple of ripples) {
      const age = (now - ripple.at) / 1000;
      if (age < 0 || age > 3) continue;
      const front = age * 4.2;
      const s = Math.hypot(x - ripple.x, y - ripple.y) - front;
      z += ripple.amp * Math.cos(s * 3.4) * Math.exp(-(s * s) / 1.5) * Math.exp(-age * 0.85);
    }
    return z;
  }

  function progress() {
    if (staticProgress !== null) return staticProgress;
    const area = track.getBoundingClientRect();
    const range = area.height - stage.offsetHeight;
    // The stage sticks this far from the top of the window (lower on phones, under the taller header).
    const stickTop = parseFloat(getComputedStyle(stage).top) || 84;
    return range > 0 ? clamp((stickTop - area.top) / range, 0, 1) : 0;
  }

  function draw(p, now) {
    const style = getComputedStyle(canvas);
    const inkRgb = style.getPropertyValue('--ink-rgb').trim() || '18, 18, 18';
    const dark = Number(inkRgb.split(',')[0]) > 128;
    const ink = (alpha) => `rgba(${inkRgb}, ${alpha})`;
    const palette = dark
      ? { ground: '#1d1d1d', top: '#3b3b3b', left: '#292929', right: '#1b1b1b', line: 'rgba(255,255,255,0.88)', hi: 'rgba(255,255,255,', lo: 'rgba(0,0,0,', orbA: '#686868', orbB: '#1c1c1c' }
      : { ground: '#f1f1f1', top: '#ffffff', left: '#e8e8e8', right: '#cfcfcf', line: 'rgba(20,20,20,0.88)', hi: 'rgba(255,255,255,', lo: 'rgba(20,20,20,', orbA: '#ffffff', orbB: '#cdcdcd' };

    const jolt = (() => {
      const age = (now - shake.at) / 1000;
      return age < 0.45 ? shake.amount * Math.sin(age * 55) * (1 - age / 0.45) : 0;
    })();
    ctx.setTransform(scale, 0, 0, scale, 0, jolt * scale);
    ctx.clearRect(0, -10, W, H + 20);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const poly = (points) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };

    // Ground: a mesh of quads whose corners rise and fall with the ripples.
    const heights = [];
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= M; i++) heights.push(waveAt(i * STEP, j * STEP, now));
    }
    const hAt = (i, j) => heights[j * (M + 1) + i];
    const corners = (i, j) =>
      [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => iso(a * STEP, b * STEP, hAt(a, b)));
    ctx.fillStyle = palette.ground;
    poly([iso(0, 0, 0), iso(N, 0, 0), iso(N, N, 0), iso(0, N, 0)]);
    ctx.fill();
    for (let sum = 0; sum <= 2 * M - 2; sum++) {
      for (let i = Math.max(0, sum - M + 1); i <= Math.min(M - 1, sum); i++) {
        const j = sum - i;
        const average = (hAt(i, j) + hAt(i + 1, j) + hAt(i + 1, j + 1) + hAt(i, j + 1)) / 4;
        // Light comes from the upper left: faces that tilt toward it are brighter.
        const tilt = (hAt(i, j) + hAt(i, j + 1) - hAt(i + 1, j) - hAt(i + 1, j + 1)) / 2;
        const shade = clamp(average / 16 + tilt / 14, -1, 1);
        if (Math.abs(shade) < 0.02) continue;
        ctx.fillStyle = shade > 0 ? `${palette.hi}${(shade * 0.5).toFixed(3)})` : `${palette.lo}${(-shade * 0.22).toFixed(3)})`;
        poly(corners(i, j));
        ctx.fill();
      }
    }
    // Grid lines every whole unit, following the surface.
    ctx.strokeStyle = ink(0.2);
    ctx.lineWidth = 1;
    for (let line = 0; line <= N; line++) {
      ctx.beginPath();
      for (let k = 0; k <= M; k++) {
        const [px, py] = iso(k * STEP, line, hAt(k, line / STEP));
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k <= M; k++) {
        const [px, py] = iso(line, k * STEP, hAt(line / STEP, k));
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = ink(0.45);
    ctx.lineWidth = 1.5;
    poly([iso(0, 0, 0), iso(N, 0, 0), iso(N, N, 0), iso(0, N, 0)]);
    ctx.stroke();

    // A ring on the ground where something landed, kept inside the ground.
    ctx.save();
    poly([iso(0, 0, 0), iso(N, 0, 0), iso(N, N, 0), iso(0, N, 0)]);
    ctx.clip();
    for (const ripple of ripples) {
      const age = (now - ripple.at) / 1000;
      if (age > 1.3) continue;
      const radius = 0.4 + age * 2.6;
      ctx.strokeStyle = ink(0.55 * (1 - age / 1.3));
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const angle = (k / 48) * Math.PI * 2;
        const [px, py] = iso(ripple.x + Math.cos(angle) * radius, ripple.y + Math.sin(angle) * radius, 0);
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Dashed links from everything that has landed to the platform, once the platform is down.
    if (byId.pad.landed) {
      const reveal = clamp((now - byId.pad.landedAt) / 700, 0, 1);
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -(now / 60) % 14;
      ctx.strokeStyle = ink(0.7);
      ctx.lineWidth = 1.6;
      for (const thing of things) {
        if (!thing.landed || thing.kind === 'pad' || thing.kind === 'orb') continue;
        const [x1, y1] = iso(thing.x + thing.w / 2, thing.y + thing.d / 2, 0);
        const [x2, y2] = iso(N / 2, N / 2, 0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 + (x2 - x1) * reveal, y1 + (y2 - y1) * reveal);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Solid shapes.
    const face = (points, fill, gradientTo) => {
      poly(points);
      if (gradientTo) {
        const top = Math.min(...points.map((point) => point[1]));
        const bottom = Math.max(...points.map((point) => point[1]));
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, fill);
        gradient.addColorStop(1, gradientTo);
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = fill;
      }
      ctx.fill();
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    };
    const prism = (x, y, w, d, h, base) => {
      face([iso(x, y + d, base), iso(x + w, y + d, base), iso(x + w, y + d, base + h), iso(x, y + d, base + h)], palette.left, palette.right);
      face([iso(x + w, y, base), iso(x + w, y + d, base), iso(x + w, y + d, base + h), iso(x + w, y, base + h)], palette.right, palette.left);
      face([iso(x, y, base + h), iso(x + w, y, base + h), iso(x + w, y + d, base + h), iso(x, y + d, base + h)], palette.top);
    };
    const mark = (x, y, size, z, alpha) => {
      poly([iso(x, y, z), iso(x + size, y, z), iso(x + size, y + size, z), iso(x, y + size, z)]);
      ctx.fillStyle = ink(alpha);
      ctx.fill();
    };

    for (const thing of [...things].sort((a, b) => a.x + a.w / 2 + a.y + a.d / 2 - (b.x + b.w / 2 + b.y + b.d / 2))) {
      const start = thing.ti - FALL;
      if (p <= start) continue;
      const u = clamp((p - start) / FALL, 0, 1);
      const lift = thing.landed ? 0 : DROP * (1 - u * u);
      const cx = thing.x + thing.w / 2;
      const cy = thing.y + thing.d / 2;
      // After landing, a short hop, and the thing rides the ripples.
      const hopAge = (now - thing.hopAt) / 1000;
      const hop = hopAge < 0.8 ? 14 * Math.abs(Math.sin(hopAge * 11)) * Math.exp(-hopAge * 5) : 0;
      const base = lift + hop + waveAt(cx, cy, now) * 0.7;

      // Shadow on the ground. It tightens and darkens as the thing comes down.
      const closeness = 1 - lift / DROP;
      const grow = 0.55 + 0.45 * closeness;
      const sw = (thing.kind === 'orb' ? 1.4 : thing.w) * grow;
      const sd = (thing.kind === 'orb' ? 1.4 : thing.d) * grow;
      const sx = thing.kind === 'orb' ? 3.5 - 0.7 : cx - sw / 2;
      const sy = thing.kind === 'orb' ? 3.5 - 0.7 : cy - sd / 2;
      if (thing.kind !== 'pad') {
        poly([iso(sx, sy, 0), iso(sx + sw, sy, 0), iso(sx + sw, sy + sd, 0), iso(sx, sy + sd, 0)]);
        ctx.fillStyle = `${palette.lo}${(0.12 + 0.2 * closeness).toFixed(3)})`;
        ctx.fill();
      }

      if (thing.kind === 'cube') {
        prism(thing.x, thing.y, thing.w, thing.d, thing.h, base);
        const top = base + thing.h;
        const s = thing.w;
        mark(thing.x + 0.14 * s, thing.y + 0.14 * s, 0.3 * s, top, 0.92);
        mark(thing.x + 0.56 * s, thing.y + 0.14 * s, 0.3 * s, top, 0.92);
        mark(thing.x + 0.14 * s, thing.y + 0.56 * s, 0.3 * s, top, 0.92);
        mark(thing.x + 0.6 * s, thing.y + 0.6 * s, 0.16 * s, top, 0.92);
      } else if (thing.kind === 'slab') {
        prism(thing.x, thing.y, thing.w, thing.d, thing.h, base);
        const top = base + thing.h;
        [0.2, 0.45, 0.7].forEach((row, index) => {
          const [x1, y1] = iso(thing.x + 0.2, thing.y + row, top);
          const [x2, y2] = iso(thing.x + (index === 0 ? 0.7 : 1.6), thing.y + row, top);
          ctx.strokeStyle = index === 0 ? '#d64b3b' : ink(0.55);
          ctx.lineWidth = index === 0 ? 3.4 : 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
      } else if (thing.kind === 'pad') {
        prism(thing.x, thing.y, thing.w, thing.d, thing.h, base);
      } else {
        // The orb: your organization, on a stem above the platform.
        const pad = byId.pad;
        const padTop = pad.landed ? pad.h : 0;
        const bob = thing.landed ? Math.sin(now / 650) * 3 : 0;
        const hover = padTop + 92 + bob + (thing.landed ? hop * 0.6 : lift) + waveAt(3.5, 3.5, now) * 0.5;
        const [ox, oy] = iso(3.5, 3.5, hover);
        const [bx, by] = iso(3.5, 3.5, padTop);
        if (pad.landed) {
          ctx.strokeStyle = palette.line;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(ox, oy + 40);
          ctx.stroke();
        }
        const radius = 42;
        const gradient = ctx.createRadialGradient(ox - radius * 0.35, oy - radius * 0.4, radius * 0.1, ox, oy, radius);
        gradient.addColorStop(0, palette.orbA);
        gradient.addColorStop(1, palette.orbB);
        ctx.beginPath();
        ctx.arc(ox, oy, radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.strokeStyle = ink(0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(ox, oy, radius, radius * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(ox, oy, radius * 0.34, radius, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (thing.landed) {
          // Glow that fades after landing.
          const glow = clamp(1 - (now - thing.landedAt) / 1400, 0, 1);
          if (glow > 0) {
            ctx.strokeStyle = ink(0.5 * glow);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(ox, oy, radius + 6 + (1 - glow) * 26, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function update(now) {
    const p = progress();
    for (const thing of things) {
      const down = p >= thing.ti;
      if (first || staticProgress !== null) {
        thing.landed = down;
        thing.landedAt = -1e9;
      } else if (down && !thing.landed) {
        thing.landed = true;
        thing.landedAt = now;
        thing.hopAt = now;
        ripples.push({ x: thing.x + thing.w / 2, y: thing.y + thing.d / 2, amp: thing.amp, at: now });
        shake = { amount: thing.kind === 'orb' ? 5 : 2, at: now };
      } else if (!down && thing.landed) {
        thing.landed = false;
      }
    }
    first = false;
    ripples = ripples.filter((ripple) => now - ripple.at < 3000);
    draw(p, now);

    tags.forEach((tag) => tag.el.classList.toggle('on', tag.after.landed));
    legend.forEach((item, index) => item.classList.toggle('on', byId[['right', 'pad', 'slab'][index]].landed));
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  }

  function frame(now) {
    if (visible) update(now);
    requestAnimationFrame(frame);
  }

  resize();
  new ResizeObserver(() => {
    resize();
    if (staticProgress !== null) update(performance.now());
  }).observe(canvas);
  section.classList.add('dg-ready');
  if (reduceMotion) {
    // No scrolling effect: show the finished scene once, and redraw if the theme changes.
    const redraw = () => update(performance.now());
    redraw();
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  } else {
    section.classList.add('dg-live');
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { rootMargin: '200px 0px' }).observe(track);
    requestAnimationFrame(frame);
  }
})();
