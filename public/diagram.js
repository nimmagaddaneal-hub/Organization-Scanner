// The "ours" diagram on the home page. As it scrolls into view, items, a dashboard and finally
// "your organization" drop onto an isometric ground. Each landing sends a pixelated ripple across the tiles.
// Falling follows the scroll position, so scrolling back up lifts everything again.
(() => {
  const box = document.getElementById('diagram');
  const canvas = document.getElementById('dg-canvas');
  if (!box || !canvas) return;
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The canvas is small and scaled up without smoothing, which gives the chunky pixel look.
  const W = 240;
  const H = 176;
  const N = 14;
  const TW = 16;
  const TH = 8;
  const OX = W / 2;
  const OY = 46;
  const DROP = 120;
  const FALL = 0.13;
  canvas.width = W;
  canvas.height = H;

  // ti: scroll position (0 to 1) where the thing lands. amp: how hard it hits.
  const things = [
    { id: 'left', kind: 'cube', gx: 2, gy: 10, w: 2, d: 2, h: 10, ti: 0.14, amp: 4 },
    { id: 'right', kind: 'cube', gx: 10, gy: 2, w: 2, d: 2, h: 10, ti: 0.28, amp: 4 },
    { id: 'front', kind: 'cube', gx: 8, gy: 12, w: 2, d: 2, h: 10, ti: 0.42, amp: 4 },
    { id: 'slab', kind: 'slab', gx: 10.5, gy: 8, w: 3, d: 2, h: 3, ti: 0.58, amp: 6 },
    { id: 'pad', kind: 'pad', gx: 5.5, gy: 5.5, w: 3, d: 3, h: 2, ti: 0.72, amp: 6 },
    { id: 'orb', kind: 'orb', gx: 7, gy: 7, w: 0, d: 0, h: 0, ti: 0.88, amp: 10 },
  ];
  things.forEach((thing) => {
    thing.landed = false;
  });
  const byId = Object.fromEntries(things.map((thing) => [thing.id, thing]));
  let ripples = [];
  let shake = { amount: 0, at: 0 };
  let first = true;
  let visible = true;
  const staticProgress = reduceMotion ? 1 : null;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const project = (gx, gy, z) => [Math.round(OX + ((gx - gy) * TW) / 2), Math.round(OY + ((gx + gy) * TH) / 2 - z)];

  // Labels and numbered pins are real text on top of the canvas. Each sits at a spot on the ground
  // and appears once the thing it belongs to has landed.
  const tags = [...box.querySelectorAll('[data-after]')].map((el) => ({
    el,
    after: byId[el.dataset.after],
    at: project(Number(el.dataset.gx), Number(el.dataset.gy), Number(el.dataset.z || 0)),
  }));
  tags.forEach((tag) => {
    tag.el.style.left = `${(tag.at[0] / W) * 100}%`;
    tag.el.style.top = `${(tag.at[1] / H) * 100}%`;
  });
  const legend = [...document.querySelectorAll('#compare .callouts li')];

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

  // 0 when the diagram starts to enter the window, 1 once it is about half way up.
  function progress() {
    if (staticProgress !== null) return staticProgress;
    const top = box.getBoundingClientRect().top;
    const vh = window.innerHeight;
    return clamp((vh * 0.92 - top) / (vh * 0.55), 0, 1);
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
        const edge = 0.2;
        face([project(gx, gy + 1, z), project(gx + 1, gy + 1, z), project(gx + 1, gy + 1, -4), project(gx, gy + 1, -4)], 0.16, edge);
        face([project(gx + 1, gy, z), project(gx + 1, gy + 1, z), project(gx + 1, gy + 1, -4), project(gx + 1, gy, -4)], 0.3, edge);
        const lift = z > 0 ? 0.06 + 0.5 * clamp(z / 9, 0, 1) : 0.1 + 0.22 * clamp(-z / 9, 0, 1);
        face([project(gx, gy, z), project(gx + 1, gy, z), project(gx + 1, gy + 1, z), project(gx, gy + 1, z)], lift, edge);
      }
    }

    // Dashed links from everything that has landed to the platform, once the platform is down.
    if (byId.pad.landed) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = inkAlpha(0.7);
      ctx.lineWidth = 1;
      for (const thing of things) {
        if (!thing.landed || thing.kind === 'pad' || thing.kind === 'orb') continue;
        const [x1, y1] = project(thing.gx + thing.w / 2, thing.gy + thing.d / 2, 0);
        const [x2, y2] = project(7, 7, 0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Things, back to front.
    const prism = (gx, gy, w, d, h, base) => {
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
      const ground = thing.kind === 'orb' ? waveAt(7, 7, now) : waveAt(thing.gx + thing.w / 2, thing.gy + thing.d / 2, now);
      const base = (thing.landed ? 0 : lift) + ground;

      // Shadow on the ground, tighter as the thing comes down.
      if (!thing.landed && lift > 1) {
        const [sx, sy] = project(thing.gx + thing.w / 2, thing.gy + thing.d / 2, ground);
        ctx.fillStyle = inkAlpha(0.18 * (1 - lift / DROP));
        ctx.fillRect(sx - 8, sy - 1, 16, 3);
      }

      if (thing.kind === 'cube') {
        prism(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
        const top = base + thing.h;
        square(thing.gx + 0.3, thing.gy + 0.3, 0.55, top, 0.9);
        square(thing.gx + 1.15, thing.gy + 0.3, 0.55, top, 0.9);
        square(thing.gx + 0.3, thing.gy + 1.15, 0.55, top, 0.9);
        square(thing.gx + 1.2, thing.gy + 1.2, 0.3, top, 0.9);
      } else if (thing.kind === 'slab') {
        prism(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
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
        prism(thing.gx, thing.gy, thing.w, thing.d, thing.h, base);
      } else {
        // The orb: your organization, coming down onto the platform on its stem.
        const pad = byId.pad;
        const rest = (pad.landed ? pad.h : 0) + 13;
        const [cx, cy] = project(7, 7, rest + (thing.landed ? 0 : lift) + ground);
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
        ctx.strokeStyle = inkAlpha(0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.strokeStyle = inkAlpha(0.5);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 12, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, 4, 12, 0, 0, Math.PI * 2);
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

    tags.forEach((tag) => tag.el.classList.toggle('on', tag.after.landed));
    legend.forEach((item, index) => item.classList.toggle('on', byId[['right', 'pad', 'slab'][index]].landed));
  }

  function frame(now) {
    if (visible) update(now);
    requestAnimationFrame(frame);
  }

  box.classList.add('dg-ready');
  if (reduceMotion) {
    // No scrolling effect: show the finished scene once, and redraw if the theme changes.
    const redraw = () => update(performance.now());
    redraw();
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  } else {
    box.classList.add('dg-live');
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { rootMargin: '200px 0px' }).observe(box);
    requestAnimationFrame(frame);
  }
})();
