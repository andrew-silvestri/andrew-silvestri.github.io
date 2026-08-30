/* Side-margin generative art: one small canvas per page, drawing a bespoke
 * scene built only from that page's own real, already-published numbers -
 * never invented. Every article page sets a small window.MARGIN_SCENE object
 * before loading this file; this file only knows how to draw a handful of
 * shared primitives ('strata', 'bars', 'flowpulse', 'arcroute', 'cards') - it
 * never picks the numbers, the page does.
 *
 * Geometry comes from the page's own <main> grid, read live via
 * getComputedStyle().gridTemplateColumns, so the art always lines up exactly
 * with the real text column with no guessed pixel widths, and disables
 * itself the instant the grid collapses to one column (mobile) or the margin
 * is too narrow to hold anything legible - the direct answer to "scalable
 * with the resolution, using however much room there is."
 *
 * Layering is the same trick body::before already uses: this canvas paints
 * at z-index 0 (same stacking level, later in the DOM so it paints on top of
 * that static wash), main sits at z-index 1 with no opaque background on its
 * prose, so the scene is fully exposed in the margins beside a paragraph,
 * hidden behind an opaque .fig.wide/video/table, and visible again in the
 * margins flanking one - "dip behind and out the other side" falls out of
 * the stacking order already in style.css, nothing new to add there.
 *
 * Gated exactly like hero.js: data-motion="off" freezes to one settled
 * frame (never blank), motionchange/visibilitychange start and stop the
 * loop, and a missing canvas context degrades to doing nothing.
 */
(function () {
  var SCENE = window.MARGIN_SCENE;
  if (!SCENE) return;
  var main = document.querySelector('main');
  if (!main) return;

  var canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;z-index:0;pointer-events:none';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var still = document.documentElement.dataset.motion !== 'on';

  /* ---- palette, read from the page's own CSS custom properties --------- */
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function hexToRgb(hex) {
    hex = hex.trim().replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(function (c) { return c + c; }).join('');
    }
    var n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  var PAL = {
    acc:  hexToRgb(cssVar('--acc', '#8b7ff2')),
    cool: hexToRgb(cssVar('--cool', '#5aa8d8')),
    moss: hexToRgb(cssVar('--moss', '#4f9d84')),
    dim:  hexToRgb(cssVar('--dim', '#8b93b0')),
    ink:  hexToRgb(cssVar('--ink', '#e3e6f2'))
  };
  var CYCLE = ['acc', 'cool', 'moss', 'dim'];
  function rgba(name, a) {
    var c = PAL[name] || PAL.dim;
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ---- a tiny deterministic PRNG, so dot fields don't jitter frame to
     frame - seeded once per layout, not re-rolled every draw call. ------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- layout: where the margins actually are, this instant ------------ */
  var W = 0, H = 0, dpr = 1, docH = 0;
  var leftBand = null, rightBand = null; // {x0,x1} in viewport px, or null

  function measureBands() {
    var rect = main.getBoundingClientRect();
    var cs = getComputedStyle(main);
    // getComputedStyle returns the bracketed line names inline with the
    // track sizes (e.g. "[full-start] 150px [wide-start] 264px ...") -
    // drop those tokens before parsing or every track index is off by one.
    var tracks = cs.gridTemplateColumns.split(' ')
      .filter(function (s) { return s.indexOf('[') !== 0; })
      .map(parseFloat);
    if (tracks.length < 5) { leftBand = rightBand = null; return; }
    var outerL = tracks[0], padL = tracks[1], text = tracks[2], padR = tracks[3],
        outerR = tracks[4];
    var mainLeft = rect.left;
    var textLeft = mainLeft + outerL + padL;
    var textRight = textLeft + text;
    var mainRight = textRight + padR + outerR;
    leftBand  = (textLeft - mainLeft)   > 60 ? { x0: mainLeft,  x1: textLeft  } : null;
    rightBand = (mainRight - textRight) > 60 ? { x0: textRight, x1: mainRight } : null;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    docH = document.documentElement.scrollHeight;
    measureBands();
    layoutScene();
  }

  var scrollY = 0;
  function onScroll() { scrollY = window.scrollY || window.pageYOffset || 0; }

  /* ---- per-kind precomputed layout (dot fields etc, seeded once) ------- */
  var strataBands = null;   // strata: [{y0,y1,layer,dots:[{fx,fy}]}]
  var barsCells = null;     // bars: [{x0,x1,label,n}]
  var flowPaths = null;     // flowpulse: [{label,speed,color,pts:[{fx,fy}...]}]
  var cardItems = null;     // cards: [{text,y (px, recycled)}]
  var arcRows = null;       // arcroute: [{label,weight,color,revealAt}]

  function layoutScene() {
    if (SCENE.kind === 'strata') layoutStrata();
    else if (SCENE.kind === 'bars') layoutBars();
    else if (SCENE.kind === 'flowpulse') layoutFlow();
    else if (SCENE.kind === 'cards') layoutCards();
    else if (SCENE.kind === 'arcroute') layoutArcs();
  }

  function layoutStrata() {
    var layers = SCENE.layers || [];
    var heights = layers.map(function (L) { return Math.log10(L.n + 1); });
    var total = heights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var y = 0, rnd = mulberry32(1);
    strataBands = layers.map(function (L, i) {
      var bh = heights[i] / total * docH;
      var band = { y0: y, y1: y + bh, layer: L, color: CYCLE[i % CYCLE.length], dots: [] };
      var density = Math.max(6, Math.round(6 + 10 * (heights[i] / Math.max.apply(null, heights))));
      for (var d = 0; d < density; d++) {
        band.dots.push({ fx: rnd(), fy: rnd(), ph: rnd() * 6.28 });
      }
      y += bh;
      return band;
    });
  }

  function layoutBars() {
    var items = SCENE.items || [];
    var max = Math.max.apply(null, items.map(function (d) { return d.n; })) || 1;
    barsCells = items.map(function (d, i) {
      return { label: d.label, n: d.n, frac: d.n / max, color: CYCLE[i % CYCLE.length] };
    });
  }

  function layoutFlow() {
    var paths = SCENE.paths || [];
    var rnd = mulberry32(7);
    flowPaths = paths.map(function (p, i) {
      // a short organic-looking polyline standing in for the named real path,
      // fixed once so the pulse always rides the same track
      var pts = [];
      var n = 5;
      for (var k = 0; k <= n; k++) {
        pts.push({ fx: k / n, fy: 0.5 + (rnd() - 0.5) * 0.5 });
      }
      return { label: p.label, weight: p.weight, color: CYCLE[i % CYCLE.length], pts: pts };
    });
  }

  function layoutCards() {
    var items = SCENE.items || [];
    var rnd = mulberry32(3);
    cardItems = items.map(function (d, i) {
      return { text: d.text, sub: d.sub, side: i % 2 === 0 ? 'l' : 'r',
               y0: rnd() * (docH || 2000) };
    });
  }

  function layoutArcs() {
    var items = SCENE.items || [];
    arcRows = items.map(function (d, i) {
      return { label: d.label, from: d.from, to: d.to, weight: d.weight,
               color: CYCLE[i % CYCLE.length], rowIndex: i };
    });
  }

  /* ---- drawing ----------------------------------------------------------
     Each primitive is handed the two viewport-space bands and draws only
     inside them - never under the text column itself. */

  function eachBand(fn) {
    if (leftBand) fn(leftBand);
    if (rightBand) fn(rightBand);
  }

  function drawStrata(t) {
    if (!strataBands) return;
    strataBands.forEach(function (b) {
      var vy0 = b.y0 - scrollY, vy1 = b.y1 - scrollY;
      if (vy1 < -40 || vy0 > H + 40) return;
      var top = Math.max(0, vy0), bot = Math.min(H, vy1);
      eachBand(function (band) {
        var bw = band.x1 - band.x0;
        ctx.fillStyle = rgba(b.color, 0.045);
        ctx.fillRect(band.x0, top, bw, Math.max(0, bot - top));
        b.dots.forEach(function (dot) {
          var dy = vy0 + dot.fy * (vy1 - vy0) + Math.sin(t * 0.25 + dot.ph) * 3;
          if (dy < -4 || dy > H + 4) return;
          ctx.beginPath();
          ctx.fillStyle = rgba(b.color, 0.4);
          ctx.arc(band.x0 + dot.fx * bw, dy, 1.3, 0, 6.2832);
          ctx.fill();
        });
        if (vy0 > -20 && vy0 < H - 20) {
          ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = rgba('dim', 0.55);
          ctx.fillText(b.layer.label + ' · ' + b.layer.n.toLocaleString(),
                       band.x0 + 8, Math.max(vy0 + 14, 14));
        }
      });
    });
  }

  function drawBars(t) {
    if (!barsCells) return;
    var n = barsCells.length;
    eachBand(function (band) {
      var bw = band.x1 - band.x0;
      var pad = Math.min(18, bw * 0.15);
      var trackW = bw - pad * 2;
      var rowH = Math.min(34, (H - 80) / n);
      var top = (H - rowH * n) / 2;
      barsCells.forEach(function (c, i) {
        var breathe = 0.9 + 0.1 * Math.sin(t * 0.6 + i);
        var w = trackW * c.frac * breathe;
        var y = top + i * rowH;
        if (y < -rowH || y > H) return;
        ctx.fillStyle = rgba(c.color, 0.22);
        ctx.fillRect(band.x0 + pad, y + rowH * 0.25, w, rowH * 0.4);
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = rgba('dim', 0.55);
        ctx.fillText(c.label, band.x0 + pad, y + rowH * 0.15);
      });
    });
  }

  function drawFlow(t) {
    if (!flowPaths) return;
    eachBand(function (band) {
      var bw = band.x1 - band.x0, bh = Math.min(H * 0.5, 420);
      var top = (H - bh) / 2;
      flowPaths.forEach(function (p, i) {
        var rowH = bh / flowPaths.length;
        var y0 = top + i * rowH;
        ctx.beginPath();
        ctx.strokeStyle = rgba(p.color, 0.12);
        ctx.lineWidth = 1;
        p.pts.forEach(function (pt, k) {
          var x = band.x0 + pt.fx * bw, y = y0 + pt.fy * rowH;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        // a pulse travelling the path, speed set by the path's real weight
        var speed = 0.15 + p.weight * 0.6;
        var phase = (t * speed + i * 0.3) % 1;
        var seg = phase * (p.pts.length - 1);
        var i0 = Math.floor(seg), f = seg - i0;
        var a = p.pts[i0], bpt = p.pts[Math.min(i0 + 1, p.pts.length - 1)];
        var px = band.x0 + (a.fx + (bpt.fx - a.fx) * f) * bw;
        var py = y0 + (a.fy + (bpt.fy - a.fy) * f) * rowH;
        ctx.beginPath();
        ctx.fillStyle = rgba(p.color, 0.85);
        ctx.arc(px, py, 2.2, 0, 6.2832);
        ctx.fill();
      });
    });
  }

  function drawCards(t) {
    if (!cardItems) return;
    var speed = 6; // px/sec upward drift
    eachBand(function (band) {
      var bw = band.x1 - band.x0;
      cardItems.forEach(function (c) {
        if ((c.side === 'l') !== (band === leftBand)) return;
        var y = ((c.y0 - t * speed) % (docH || 2000) + (docH || 2000)) % (docH || 2000);
        var vy = y - scrollY;
        if (vy < -60 || vy > H + 60) return;
        var pad = 6, w = Math.max(0, bw - pad * 2);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = rgba('dim', 0.08);
        ctx.fillRect(band.x0 + pad, vy, w, 40);
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = rgba('ink', 0.5);
        ctx.fillText(c.text, band.x0 + pad + 6, vy + 17, w - 12);
        ctx.fillStyle = rgba('dim', 0.45);
        ctx.fillText(c.sub || '', band.x0 + pad + 6, vy + 31, w - 12);
        ctx.globalAlpha = 1;
      });
    });
  }

  function drawArcs(t) {
    if (!arcRows) return;
    var maxW = Math.max.apply(null, arcRows.map(function (r) { return r.weight; })) || 1;
    eachBand(function (band) {
      var bw = band.x1 - band.x0, rowH = 30;
      var top = -scrollY + 60;
      arcRows.forEach(function (r, i) {
        var y = top + i * rowH;
        if (y < -rowH || y > H) return;
        var reveal = Math.max(0, Math.min(1, (H * 0.85 - y) / 40));
        if (reveal <= 0) return;
        var thick = 0.6 + (r.weight / maxW) * 3.5;
        ctx.beginPath();
        ctx.strokeStyle = rgba(r.color, 0.28 * reveal);
        ctx.lineWidth = thick;
        var x0 = band.x0 + bw * 0.15, x1 = band.x0 + bw * 0.85 * reveal + x0 * (1 - reveal);
        ctx.moveTo(x0, y + rowH * 0.5);
        ctx.quadraticCurveTo((x0 + x1) / 2, y + rowH * 0.5 - 10, x1, y + rowH * 0.5);
        ctx.stroke();
        if (reveal > 0.5) {
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = rgba('dim', 0.5 * reveal);
          ctx.fillText(r.label, band.x0 + 8, y + rowH * 0.5 - 14);
        }
      });
    });
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    if (!leftBand && !rightBand) return;
    if (SCENE.kind === 'strata') drawStrata(t);
    else if (SCENE.kind === 'bars') drawBars(t);
    else if (SCENE.kind === 'flowpulse') drawFlow(t);
    else if (SCENE.kind === 'cards') drawCards(t);
    else if (SCENE.kind === 'arcroute') drawArcs(t);
  }

  /* ---- loop -------------------------------------------------------------- */
  var last = 0, tAcc = 0, running = false, raf = 0;

  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    tAcc += dt;
    draw(tAcc);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || still) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
  }

  resize();
  draw(0);

  window.addEventListener('scroll', onScroll, { passive: true });
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); draw(tAcc); }, 180);
  });

  if (still) return; // one settled frame, already drawn above, no loop

  start();
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); draw(tAcc); } else { start(); }
  });
})();
