/* longevity.html's own margin scene: a canopy-to-ocean-floor descent that
 * runs the whole length of the page, carrying real named species from this
 * page's own prose, each labeled with its real longevity quotient. Nothing
 * here is invented: every creature, habitat assignment and number is lifted
 * straight from the page's own "Comparing whole groups", "Colonies are not
 * individuals" and "What comes out" sections.
 *
 * Depth is a function of scroll position and nothing else. Both the
 * background gradient and every creature's opacity are read from how far
 * down the document the reader is, so the scene is present from the first
 * screen to the last, a fade is a distance rather than a duration, and
 * scrolling back up retraces exactly what scrolling down drew. See the
 * comment above BIOME for what this replaced and why.
 *
 * Motion is hand-authored, not simulated: each creature is a short closed
 * loop of waypoints, walked with eased interpolation for organic movement.
 * loopDuration is long (100-160s) so an ordinary visit never spans a full
 * cycle, every loop is seamless (pose(0) === pose(duration) by
 * construction), and playback starts at a random phase per page load so two
 * visits never look the same.
 *
 * Shares margin-scene.js's geometry/lifecycle conventions (same canvas
 * approach, same motion-contract gating, same <main> grid measurement) but
 * is its own file given its size - only longevity.html loads it.
 */
(function () {
  var main = document.querySelector('main');
  if (!main) return;

  var canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;z-index:0;pointer-events:none';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var still = document.documentElement.dataset.motion !== 'on';

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function hexToRgb(hex) {
    hex = hex.trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
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
  function rgba(name, a) {
    var c = PAL[name] || PAL.dim;
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ---- margins, exactly as margin-scene.js measures them --------------- */
  var W = 0, H = 0, dpr = 1;
  var leftBand = null, rightBand = null;

  function measureBands() {
    var rect = main.getBoundingClientRect();
    var cs = getComputedStyle(main);
    var tracks = cs.gridTemplateColumns.split(' ')
      .filter(function (s) { return s.indexOf('[') !== 0; })
      .map(parseFloat);
    if (tracks.length < 5) { leftBand = rightBand = null; return; }
    var outerL = tracks[0], padL = tracks[1], text = tracks[2], padR = tracks[3],
        outerR = tracks[4];
    var mainLeft = rect.left;
    var textLeft = mainLeft + outerL + padL;
    var textRight = textLeft + text;
    // Run the band all the way to the actual browser edge, not just to the
    // edge of main's own (shell-capped) box - on a screen wider than the
    // 1440px shell there is real, unused window past main's box.
    leftBand  = (textLeft - 0)  > 60 ? { x0: 0,        x1: textLeft } : null;
    rightBand = (W - textRight) > 60 ? { x0: textRight, x1: W       } : null;
  }

  /* ---- the descent, mapped onto the whole document ----------------------
     This used to key the biome to three of the page's h2 positions and step
     between them, which had two consequences. The first tracked heading sits
     about a quarter of the way down, so the top quarter of the page rendered
     biome 0 - whose colours were the page background - and the scene simply
     was not there. And because the step was discrete, the only thing making
     the change gradual was a per-frame lerp toward it, which is a timer: at
     reading pace it eased, and on a fast scroll it was outrun, so creatures
     blinked out rather than fading.

     Both are gone. The biome axis is now a continuous function of how far
     down the document the reader is, so the descent runs canopy to reef
     across the full scroll, and every opacity below is read from position
     rather than accumulated over time. Scrolling back up retraces exactly;
     scrolling fast crosses the same fades, just sooner. */
  /* Ordered as the descent is read, top of the page to bottom: canopy, then
     open water, then the deep, then the floor. Canopy sits at 0 because the
     page opens over land animals - bats, ants, a chameleon, an elephant - and
     the tint should agree with what is drawn on top of it. */
  var BIOME = {
    0: { top: '#151027', bot: '#0a0e1c' }, // dusk canopy, violet-leaning
    1: { top: '#0a1020', bot: '#070c16' }, // open water, just off the page bg
    2: { top: '#060a10', bot: '#04070a' }, // near-black abyssal
    3: { top: '#081a1c', bot: '#050f14' }  // reef / floor, teal-leaning
  };
  var LAST_BIOME = 3;

  /* Cached because scrollHeight forces layout, and this is read every frame.
     Refreshed by resize() and by the ResizeObserver on body below, which is
     what catches a figure loading in and making the document taller. */
  var scrollSpan = 1;
  function measureScrollSpan() {
    scrollSpan = Math.max(
      1, document.documentElement.scrollHeight - window.innerHeight);
  }

  /* 0 at the top of the document, 1 at the bottom. */
  function progress() {
    return Math.min(1, Math.max(0, scrollY / scrollSpan));
  }

  /* Smoothstep, so a fade eases in and out of its endpoints instead of
     arriving and leaving at a constant rate. */
  function ease(k) {
    k = Math.min(1, Math.max(0, k));
    return k * k * (3 - 2 * k);
  }

  /* ---- real creature icons ------------------------------------------
     Twelve of the fourteen use real OpenMoji line-icon art (CC BY-SA 4.0,
     https://openmoji.org - credited on the page itself), recolored per
     creature to the site's own palette by swapping the SVG's single stroke
     color before rasterizing. The chameleon and the tubeworm have no
     emoji equivalent, so they stay hand-drawn below, restyled to the same
     pure-outline weight so the whole set reads as one family rather than a
     mismatch of styles.

     Icons are extracted from the OpenMoji release archive's black/svg set,
     which is the outline-only variant - the color set would fight the
     palette. */
  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }
  var ICON_SRC = {
    bat:      { file: 'assets/openmoji/1F987.svg', color: 'acc' },
    ant:      { file: 'assets/openmoji/1F41C.svg', color: 'moss' },
    elephant: { file: 'assets/openmoji/1F418.svg', color: 'dim' },
    molerat:  { file: 'assets/openmoji/1F400.svg', color: 'acc' },
    tortoise: { file: 'assets/openmoji/1F422.svg', color: 'moss' },
    whale:    { file: 'assets/openmoji/1F40B.svg', color: 'cool' },
    shark:    { file: 'assets/openmoji/1F988.svg', color: 'cool' },
    rockfish: { file: 'assets/openmoji/1F41F.svg', color: 'cool' },
    mussel:   { file: 'assets/openmoji/1F9AA.svg', color: 'dim' },
    quahog:   { file: 'assets/openmoji/1F41A.svg', color: 'acc' },
    octopus:  { file: 'assets/openmoji/1F419.svg', color: 'cool' },
    nautilus: { file: 'assets/openmoji/1F40C.svg', color: 'dim' }
  };
  var ICONS = {};
  Object.keys(ICON_SRC).forEach(function (kind) {
    var spec = ICON_SRC[kind];
    fetch(spec.file).then(function (r) { return r.text(); })
      .then(function (svgText) {
        /* OpenMoji writes its single stroke colour as either #000000 or
           #000 depending on the icon, and an unmatched one would draw the
           creature in black on a near-black page - invisible rather than
           obviously broken. Both forms are matched here, and the icons are
           normalised to the long form when they are extracted, so this is a
           belt-and-braces guard for the next icon somebody adds by hand. */
        var recolored = svgText.replace(
          /#000000|#000(?![0-9A-Fa-f])/g, toHex(PAL[spec.color]));
        var img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(recolored);
        ICONS[kind] = img;
      })
      .catch(function () { /* icon missing; that creature just skips a frame */ });
  });
  function drawIcon(kind, x, y, s) {
    var img = ICONS[kind];
    if (!img || !img.complete || !img.naturalWidth) return;
    ctx.drawImage(img, x - s, y - s, s * 2, s * 2);
  }

  /* ---- creatures --------------------------------------------------------
     Each: kind (how it's drawn), label (real name + real quotient/lifespan,
     verbatim from the page), biome it belongs to, a closed waypoint loop in
     band-relative fractions (0..1), and its own loop duration + random
     start phase. */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rndPhase = mulberry32(Date.now() & 0xffffffff);

  function loop(waypoints, duration) {
    var t0 = rndPhase() * duration;
    return {
      duration: duration,
      t0: t0,
      pose: function (elapsed) {
        var t = ((t0 + elapsed) % duration + duration) % duration;
        var seg = (t / duration) * waypoints.length;
        var i0 = Math.floor(seg) % waypoints.length;
        var i1 = (i0 + 1) % waypoints.length;
        var f = seg - Math.floor(seg);
        // ease each segment (smoothstep) rather than linear, so motion
        // eases in/out of each waypoint instead of moving at constant
        // robotic speed
        var e = f * f * (3 - 2 * f);
        var a = waypoints[i0], b = waypoints[i1];
        return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
      }
    };
  }

  /* Fourteen real species, in the order a descent meets them: canopy and
     ground, then open water, then the deep, then the floor. Every quotient
     below is the species' own lq_class_maximum from
     longevity-quotient/outputs/lq_table.csv - the same table the page's
     figures are drawn from - rounded to two figures, and every lifespan is
     that row's `maximum`. Three of these labels were previously wrong: the
     bat carried the order-level 2.5x when Chiroptera is 2.68 and Brandt's
     bat itself is 12.75, the tubeworm said 22x against a real 23.41, and the
     quahog said 45x against a real 47.48. `at` is where on the page the
     creature lives, `span` how far either side it fades. */
  var CREATURES = [
    {
      kind: 'bat', biome: 0, color: 'acc',
      at: 0.03, span: 0.15,
      label: "Brandt's bat · 12.75× prediction (41 years at 7 grams)",
      motion: loop([
        { x: 0.15, y: 0.20 }, { x: 0.45, y: 0.10 }, { x: 0.75, y: 0.22 },
        { x: 0.60, y: 0.35 }, { x: 0.30, y: 0.30 }
      ], 110)
    },
    {
      kind: 'ant', biome: 0, color: 'moss',
      at: 0.11, span: 0.15,
      label: 'black garden ant queen · 28.72× prediction (29 years)',
      motion: loop([
        { x: 0.20, y: 0.42 }, { x: 0.52, y: 0.38 }, { x: 0.72, y: 0.46 },
        { x: 0.40, y: 0.50 }
      ], 125)
    },
    {
      kind: 'chameleon', biome: 0, color: 'moss',
      at: 0.19, span: 0.15,
      label: "Labord's chameleon · 0.13× prediction (one year, size predicts eight)",
      motion: loop([
        { x: 0.20, y: 0.55 }, { x: 0.40, y: 0.58 }, { x: 0.62, y: 0.53 },
        { x: 0.45, y: 0.60 }
      ], 140)
    },
    {
      kind: 'elephant', biome: 0, color: 'dim',
      at: 0.27, span: 0.15,
      label: 'African bush elephant · 1.31× prediction (80 years)',
      motion: loop([
        { x: 0.25, y: 0.68 }, { x: 0.48, y: 0.66 }, { x: 0.66, y: 0.70 },
        { x: 0.42, y: 0.72 }
      ], 155)
    },
    {
      kind: 'molerat', biome: 1, color: 'acc',
      at: 0.35, span: 0.15,
      label: 'naked mole-rat · 6.75× prediction (31 years at 35 grams)',
      motion: loop([
        { x: 0.30, y: 0.30 }, { x: 0.55, y: 0.26 }, { x: 0.70, y: 0.34 },
        { x: 0.44, y: 0.38 }
      ], 100)
    },
    {
      kind: 'tortoise', biome: 1, color: 'moss',
      at: 0.43, span: 0.15,
      label: 'Galapagos tortoise · 3.21× prediction (177 years)',
      motion: loop([
        { x: 0.22, y: 0.60 }, { x: 0.44, y: 0.62 }, { x: 0.64, y: 0.58 },
        { x: 0.40, y: 0.64 }
      ], 160)
    },
    {
      kind: 'whale', biome: 1, color: 'cool',
      at: 0.51, span: 0.15,
      label: 'bowhead whale · 1.78× prediction (211 years)',
      motion: loop([
        { x: 0.18, y: 0.24 }, { x: 0.50, y: 0.18 }, { x: 0.78, y: 0.26 },
        { x: 0.46, y: 0.32 }
      ], 150)
    },
    {
      kind: 'shark', biome: 2, color: 'cool',
      at: 0.59, span: 0.15,
      label: 'Greenland shark · 6.34× prediction (392 years)',
      motion: loop([
        { x: 0.20, y: 0.40 }, { x: 0.52, y: 0.34 }, { x: 0.76, y: 0.42 },
        { x: 0.44, y: 0.48 }
      ], 135)
    },
    {
      kind: 'rockfish', biome: 2, color: 'cool',
      at: 0.67, span: 0.15,
      label: 'rougheye rockfish · 12.90× prediction (205 years)',
      motion: loop([
        { x: 0.28, y: 0.56 }, { x: 0.54, y: 0.52 }, { x: 0.72, y: 0.58 },
        { x: 0.46, y: 0.62 }
      ], 115)
    },
    {
      kind: 'tubeworm', biome: 2, color: 'cool',
      at: 0.75, span: 0.15,
      label: 'cold-seep tubeworm · 23.41× prediction (250 years)',
      motion: loop([
        { x: 0.30, y: 0.70 }, { x: 0.30, y: 0.60 }, { x: 0.30, y: 0.70 },
        { x: 0.30, y: 0.78 }
      ], 90)
    },
    {
      kind: 'mussel', biome: 3, color: 'dim',
      at: 0.83, span: 0.15,
      label: 'freshwater pearl mussel · 15.78× prediction (190 years)',
      motion: loop([
        { x: 0.34, y: 0.74 }, { x: 0.38, y: 0.72 }, { x: 0.36, y: 0.76 },
        { x: 0.32, y: 0.75 }
      ], 145)
    },
    {
      kind: 'quahog', biome: 3, color: 'acc',
      at: 0.91, span: 0.15,
      label: 'ocean quahog · 47.48× prediction (a real 507-year lifespan)',
      motion: loop([
        { x: 0.55, y: 0.80 }, { x: 0.58, y: 0.78 }, { x: 0.56, y: 0.82 },
        { x: 0.52, y: 0.81 }
      ], 130)
    },
    {
      kind: 'octopus', biome: 3, color: 'cool',
      at: 0.95, span: 0.15,
      label: 'common octopus · 0.07× prediction (two years)',
      motion: loop([
        { x: 0.24, y: 0.46 }, { x: 0.50, y: 0.40 }, { x: 0.70, y: 0.50 },
        { x: 0.42, y: 0.54 }
      ], 120)
    },
    {
      kind: 'nautilus', biome: 3, color: 'dim',
      at: 1.00, span: 0.15,
      label: 'chambered nautilus · 0.81× prediction (20 years)',
      motion: loop([
        { x: 0.60, y: 0.62 }, { x: 0.68, y: 0.58 }, { x: 0.64, y: 0.66 },
        { x: 0.56, y: 0.64 }
      ], 140)
    }
  ];

  /* ---- drawing ------------------------------------------------------- */
  function drawChameleon(x, y, s, t) {
    // Pure outline, to match the OpenMoji line-icon weight used by the
    // other four - was a filled shape, which read as a different, heavier
    // style next to the icon-drawn creatures.
    ctx.lineWidth = s * 0.14;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.9, s * 0.45, 0, 0, 6.2832);
    ctx.stroke();
    var curl = Math.sin(t * 1.5) * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.8, y);
    ctx.quadraticCurveTo(x - s * 1.4, y + s * (0.3 + curl), x - s * 1.1, y + s * 0.9);
    ctx.stroke();
  }
  function drawTubeworm(x, y, s, t) {
    var sway = Math.sin(t * 0.8) * s * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 1.2);
    ctx.quadraticCurveTo(x + sway, y, x, y - s * 1.2);
    ctx.lineWidth = s * 0.28;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  /* Every icon-backed kind draws the same way, so the table is built from
     ICON_SRC rather than listed by hand - a creature added to ICON_SRC and
     CREATURES without a matching entry here used to throw
     "DRAW[c.kind] is not a function" on the first frame, which kills the
     animation loop for the whole scene, not just that creature. The two
     hand-drawn kinds are added after. */
  var DRAW = {};
  Object.keys(ICON_SRC).forEach(function (kind) {
    DRAW[kind] = function (x, y, s) { drawIcon(kind, x, y, s); };
  });
  DRAW.chameleon = drawChameleon;
  DRAW.tubeworm = drawTubeworm;

  /* A creature naming a kind nothing can draw is a content error, and it
     should be loud in development rather than silently blanking the scene. */
  CREATURES.forEach(function (c) {
    if (typeof DRAW[c.kind] !== 'function') {
      throw new Error('biome-scene: no way to draw creature kind ' + c.kind);
    }
  });

  function drawBiomeBackdrop(band, biomeFloat) {
    var lo = Math.floor(biomeFloat), hi = Math.ceil(biomeFloat);
    var f = biomeFloat - lo;
    var a = BIOME[lo] || BIOME[0], b = BIOME[hi] || a;
    function mix(c1, c2, k) {
      var p1 = hexToRgb(c1), p2 = hexToRgb(c2);
      return 'rgb(' + Math.round(p1[0] + (p2[0] - p1[0]) * k) + ','
        + Math.round(p1[1] + (p2[1] - p1[1]) * k) + ','
        + Math.round(p1[2] + (p2[2] - p1[2]) * k) + ')';
    }
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(a.top, b.top, f));
    g.addColorStop(1, mix(a.bot, b.bot, f));
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(band.x0, 0, band.x1 - band.x0, H);
    ctx.globalAlpha = 1;
  }

  /* How present a creature is, read straight off where the reader is in the
     document: full at its own `at`, gone `span` away on either side. span is
     0.26 of the document, so on this page each creature fades over roughly
     3,700px of scroll - far enough that flicking the wheel crosses a visible
     fade instead of a blink. Neighbouring ranges overlap by design, so the
     margins are never empty between one creature and the next. */
  function presence(c, p) {
    return ease(1 - Math.abs(p - c.at) / c.span);
  }

  function drawCreature(c, band, p, elapsed) {
    var active = presence(c, p);
    if (active <= 0.02) return;
    var pose = c.motion.pose(elapsed);
    var bw = band.x1 - band.x0, bh = H;
    var x = band.x0 + pose.x * bw;
    var y = pose.y * bh;
    var s = Math.max(7, Math.min(16, bw * 0.09));
    ctx.globalAlpha = 0.5 * active;
    ctx.fillStyle = rgba(c.color, 1);
    DRAW[c.kind](x, y, s, elapsed);
    if (active > 0.6) {
      ctx.globalAlpha = 0.55 * active;
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = rgba('ink', 1);
      /* Measured, not assumed. This used to reserve a flat 140px for every
         label, which was near enough while the labels were "octopus" plus a
         quotient; once they carried a species name, a quotient and a real
         lifespan they ran past 200px, so the flip-to-the-left test fired too
         late and the text was drawn straight through its own creature. */
      var lw = ctx.measureText(c.label).width;
      var gap = s * 1.6;
      var lx = x + gap;                       // preferred: to the right
      if (lx + lw > band.x1 - 4) lx = x - gap - lw;   // else flip left
      lx = Math.max(band.x0 + 4, Math.min(lx, band.x1 - lw - 4));
      /* If the band is too narrow to hold the label anywhere without sitting
         on the creature, the creature is the thing worth keeping. */
      if (lw + gap * 2 < band.x1 - band.x0) ctx.fillText(c.label, lx, y);
    }
    ctx.globalAlpha = 1;
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
    measureBands();
    measureScrollSpan();
  }

  var scrollY = 0;
  /* With motion off the loop is not running, so a scroll would otherwise
     leave the last painted frame on screen while the reader moves past it -
     a backdrop belonging to a part of the page they have left. Repainting on
     scroll keeps the scene correct for where they are without animating
     anything: creature poses stay frozen at their start, and only the
     position-derived opacities and the gradient move. */
  var stillRaf = 0;
  function onScroll() {
    scrollY = window.scrollY || window.pageYOffset || 0;
    if (still && !stillRaf) {
      stillRaf = requestAnimationFrame(function () {
        stillRaf = 0;
        draw(0);
      });
    }
  }

  function draw(elapsed) {
    ctx.clearRect(0, 0, W, H);
    if (!leftBand && !rightBand) return;
    /* One read of position, shared by the backdrop and every creature. No
       smoothing state is carried between frames: what is drawn depends only
       on where the page is, which is what makes a fast scroll cross the same
       fades a slow one does. */
    var p = progress();
    var biomeFloat = p * LAST_BIOME;
    [leftBand, rightBand].forEach(function (band) {
      if (!band) return;
      drawBiomeBackdrop(band, biomeFloat);
      CREATURES.forEach(function (c) { drawCreature(c, band, p, elapsed); });
    });
  }

  var last = 0, tAcc = 0, running = false, raf = 0;
  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now; tAcc += dt;
    draw(tAcc);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running || still) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  resize();
  draw(0);

  window.addEventListener('scroll', onScroll, { passive: true });
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); draw(tAcc); }, 180);
  });

  /* Every opacity here is a fraction of the document's height, so the
     document getting taller - a lazy figure arriving, the group view
     redrawing - moves every fade. Same watcher margin-scene.js uses. */
  if (window.ResizeObserver) {
    var lastH = document.documentElement.scrollHeight;
    new ResizeObserver(function () {
      var h = document.documentElement.scrollHeight;
      if (h === lastH) return;
      lastH = h;
      measureScrollSpan();
      draw(tAcc);
    }).observe(document.body);
  }

  /* These two are registered whether or not the scene is currently moving.
     They used to sit behind an `if (still) return;`, which meant a reader who
     arrived with motion off never got the motionchange listener at all: the
     footer control then did nothing on this page until a reload, against the
     contract in motion.js that the control overrides the default without
     one. start() already refuses to run while still, so there is nothing to
     guard against here. */
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); draw(tAcc); } else { start(); }
  });

  if (!still) start();
})();
