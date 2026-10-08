// Scroll story on the home page: as you scroll, items, a dashboard and finally "your organization" drop onto
// an isometric ground. Each landing sends a pixelated ripple across the tiles.
// Falling is tied to the scroll position, so scrolling back up lifts everything again.
(() => {
  const story = document.getElementById('system');
  const canvas = document.getElementById('story-canvas');
  if (!story || !canvas) return;
  const ctx = canvas.getContext('2d');
  const track = story.querySelector('.story-track');
  const stage = story.querySelector('.story-stage');
  const bar = story.querySelector('.story-bar span');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The canvas is small and scaled up without smoothing, which gives the chunky pixel look.
  const W = 240;
  const H = 176;
  const N = 13;
  const TW = 14;
  const TH = 7;
  const OX = W / 2;
  const OY = 54;
  const DROP = 120;
  const FALL = 0.13;
  canvas.width = W;
  canvas.height = H;

  // ti: scroll position (0 to 1) where the thing lands. amp: how hard it hits.
  const things = [
    { kind: 'cube', gx: 3, gy: 3, w: 2, d: 2, h: 9, ti: 0.16, amp: 4 },
    { kind: 'cube', gx: 9, gy: 3, w: 2, d: 2, h: 9, ti: 0.3, amp: 4 },
    { kind: 'cube', gx: 3, gy: 9, w: 2, d: 2, h: 9, ti: 0.44, amp: 4 },
    { kind: 'slab', gx: 8, gy: 8.5, w: 3, d: 2, h: 3, ti: 0.62, amp: 6 },
    { kind: 'pad', gx: 5, gy: 5, w: 3, d: 3, h: 2, ti: 0.74, amp: 6 },
    { kind: 'orb', gx: 6.5, gy: 6.5, w: 0, d: 0, h: 0, ti: 0.86, amp: 10 },
  ];
  things.forEach((thing) => {
    thing.landed = false;
  });
  let ripples = [];
  let shake = { amount: 0, at: 0 };
  let first = true;
  let visible = true;
  let staticProgress = reduceMotion ? 1 : null;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const project = (gx, gy, z) => [Math.round(OX + ((gx - gy) * TW) / 2), Math.round(OY + ((gx + gy) * TH) / 2 - z)];

  function waveAt(gx, gy, now) {
    let z = 0;
    for (const ripple of ripples) {
      const age = (now - ripple.at) / 1000;
      if (age < 0 || age > 2.4) continue;
      const distance = Math.hypot(gx - ripple.gx, gy - ripple.gy);
      const s = distance - age * 8;
      z += ripple.amp * Math.cos(s * 1.5) * Math.exp(-(s * s) / 5.8) * Math.exp(-age * 0.9);
    }
    // Steps of 2 pixels keep the surface blocky.
    return Math.round(z / 2) * 2;
  }

  function progress() {
    if (staticProgress !== null) return staticProgress;
    const box = track.getBoundingClientRect();
    const range = box.height - stage.offsetHeight;
    // The stage sticks this far from the top of the window (it is lower on phones, under the taller header).
    const stickTop = parseFloat(getComputedStyle(stage).top) || 84;
    return range > 0 ? clamp((stickTop - box.top) / range, 0, 1) : 0;
  }

  function draw(p, now) {
    const style = getComputedStyle(canvas);
    const ink = style.getPropertyValue('--ink-rgb').trim() || '18, 18, 18';
    const surface = style.getPropertyValue('--surface').trim() || '#fff';
    const inkAlpha = (alpha) => `rgba(${ink}, ${alpha})`;

    const face = (points, overlay, line = 0.3) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = surface;
      ctx.fill();
      if (overlay) {
        ctx.fillStyle = inkAlpha(overlay);
        ctx.fill();
      }
      ctx.strokeStyle = inkAlpha(line);
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // A little screen shake on impact, in whole pixels.
    const shakeAge = (now - shake.at) / 1000;
    const jolt = shakeAge < 0.35 ? Math.round(shake.amount * (1 - shakeAge / 0.35) * Math.sin(shakeAge * 70)) : 0;
    ctx.setTransform(1, 0, 0, 1, 0, jolt);
    ctx.clearRect(0, -4, W, H + 8);

    // Ground tiles, back to front.
    for (let sum = 0; sum <= 2 * N - 2; sum++) {
      for (let gx = Math.max(0, sum - N + 1); gx <= Math.min(N - 1, sum); gx++) {
        const gy = sum - gx;
        const z = waveAt(gx + 0.5, gy + 0.5, now);
        const edge = 0.22;
        face([project(gx, gy + 1, z), project(gx + 1, gy + 1, z), project(gx + 1, gy + 1, -5), project(gx, gy + 1, -5)], 0.16, edge);
        face([project(gx + 1, gy, z), project(gx + 1, gy + 1, z), project(gx + 1, gy + 1, -5), project(gx + 1, gy, -5)], 0.3, edge);
        const lift = z > 0 ? 0.06 + 0.5 * clamp(z / 9, 0, 1) : 0.1 + 0.22 * clamp(-z / 9, 0, 1);
        face([project(gx, gy, z), project(gx + 1, gy, z), project(gx + 1, gy + 1, z), project(gx, gy + 1, z)], lift, edge);
      }
    }

    // Things, back to front.
    const box = (gx, gy, w, d, h, base) => {
      face([project(gx, gy + d, base), project(gx + w, gy + d, base), project(gx + w, gy + d, base + h), project(gx, gy + d, base + h)], 0.14, 0.85);
      face([project(gx + w, gy, base), project(gx + w, gy + d, base), project(gx + w, gy + d, base + h), project(gx + w, gy, base + h)], 0.32, 0.85);
      face([project(gx, gy, base + h), project(gx + w, gy, base + h), project(gx + w, gy + d, base + h), project(gx, gy + d, base + h)], 0, 0.85);
    };
    const square = (gx, gy, size, z, alpha) => {
      ctx.beginPath();
      [[gx, gy], [gx + size, gy], [gx + size, gy + size], [gx, gy + size]].forEach(([x, y], index) => {
        const [sx, sy] = project(x, y, z);
        return index ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = inkAlpha(alpha);
      ctx.fill();
    };

    for (const thing of [...things].sort((a, b) => a.gx + a.gy - (b.gx + b.gy))) {
      const start = thing.ti - FALL;
      if (p <= start) continue;
      const u = clamp((p - start) / FALL, 0, 1);
      const lift = DROP * (1 - u * u);
      const ground = thing.kind === 'orb' ? waveAt(6, 6, now) : waveAt(thing.gx + thing.w / 2, thing.gy + thing.d / 2, now);
      const base = (thing.landed ? 0 : lift) + ground;

      // Shadow on the ground, tighter as the thing comes down.
      if (!thing.landed && lift > 1) {
        const [sx, sy] = project(thing.gx + thing.w / 2, thing.gy + thing.d / 2, ground);
        ctx.fillStyle = inkAlpha(0.18 * (1 - lift / DROP));
        ctx.fillRect(sx - 8, sy - 1, 16, 3);
      }

      if (thing.kind === 'cube') {
        box(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
        const top = base + thing.h;
        square(thing.gx + 0.3, thing.gy + 0.3, 0.55, top, 0.9);
        square(thing.gx + 1.15, thing.gy + 0.3, 0.55, top, 0.9);
        square(thing.gx + 0.3, thing.gy + 1.15, 0.55, top, 0.9);
        square(thing.gx + 1.2, thing.gy + 1.2, 0.3, top, 0.9);
      } else if (thing.kind === 'slab') {
        box(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
        const top = base + thing.h;
        [0.35, 0.8, 1.25].forEach((row, index) => {
          const [x1, y1] = project(thing.gx + 0.3, thing.gy + row, top);
          const [x2, y2] = project(thing.gx + 2.6, thing.gy + row, top);
          ctx.strokeStyle = index === 0 ? '#c0392b' : inkAlpha(0.55);
          ctx.lineWidth = index === 0 ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
      } else if (thing.kind === 'pad') {
        box(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
      } else {
        // The orb: your organization, coming down onto the pad.
        const pad = things.find((other) => other.kind === 'pad');
        const rest = (pad.landed ? pad.h : 0) + 12;
        const [cx, cy] = project(6.5, 6.5, rest + (thing.landed ? 0 : lift) + ground);
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
        ctx.strokeStyle = inkAlpha(0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = inkAlpha(0.5);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 11, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, 4, 11, 0, 0, Math.PI * 2);
        ctx.stroke();
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
      } else if (down && !thing.landed) {
        thing.landed = true;
        ripples.push({ gx: thing.gx + thing.w / 2, gy: thing.gy + thing.d / 2, amp: thing.amp, at: now });
        shake = { amount: thing.kind === 'orb' ? 3 : 1, at: now };
      } else if (!down && thing.landed) {
        thing.landed = false;
      }
    }
    first = false;
    ripples = ripples.filter((ripple) => now - ripple.at < 2400);
    draw(p, now);

    story.dataset.step = p < 0.5 ? '1' : p < 0.8 ? '2' : '3';
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  }

  function frame(now) {
    if (visible) update(now);
    requestAnimationFrame(frame);
  }

  story.classList.add('story-ready');
  if (reduceMotion) {
    // No scrolling effect: show the finished scene once, and redraw if the theme changes.
    const redraw = () => update(performance.now());
    redraw();
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  } else {
    story.classList.add('story-live');
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }).observe(story);
    requestAnimationFrame(frame);
  }
})();
