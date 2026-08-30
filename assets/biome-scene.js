/* longevity.html's own margin scene: a canopy-to-ocean-floor strip that pans
 * as the reader crosses this page's own section boundaries, carrying real
 * named species from this page's own prose, each labeled with its real
 * longevity quotient. Nothing here is invented: every creature, habitat
 * assignment and number is lifted straight from the page's own "Comparing
 * whole groups", "Colonies are not individuals" and "What comes out"
 * sections.
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

  /* ---- the page's own three section boundaries -------------------------
     Found by matching real h2 text, not a hardcoded index, so the scene
     keeps working if a section is reworded elsewhere but stays keyed to
     these headings. */
  var SECTION_HEADINGS = [
    'Comparing whole groups',      // -> canopy
    'Colonies are not individuals', // -> deep ocean floor
    'What comes out'                // -> reef / tide line
  ];
  var sectionY = [];

  function measureSections() {
    var h2s = Array.prototype.slice.call(document.querySelectorAll('h2'));
    sectionY = SECTION_HEADINGS.map(function (text) {
      var el = h2s.filter(function (h) { return h.textContent.trim() === text; })[0];
      if (!el) return null;
      return el.getBoundingClientRect().top + window.scrollY;
    });
  }

  /* biome 0 = default open water (before the first tracked section),
     1 = canopy, 2 = deep floor, 3 = reef */
  var BIOME = {
    0: { top: '#070a12', bot: '#0a0f1c' },
    1: { top: '#151027', bot: '#0a0e1c' }, // dusk canopy, violet-leaning
    2: { top: '#060a10', bot: '#04070a' }, // near-black abyssal floor
    3: { top: '#081a1c', bot: '#050f14' }  // reef / tide, teal-leaning
  };

  function currentBiomeFloat(scrollY) {
    var y = scrollY + window.innerHeight * 0.5;
    var b = 0;
    for (var i = 0; i < sectionY.length; i++) {
      if (sectionY[i] != null && y >= sectionY[i]) b = i + 1;
    }
    return b;
  }

  /* ---- real creature icons ------------------------------------------
     octopus/bat/nautilus/quahog use real OpenMoji line-icon art (CC BY-SA
     4.0, https://openmoji.org - credited on the page itself), recolored
     per creature to the site's own palette by swapping the SVG's single
     stroke color before rasterizing. Chameleon and tubeworm have no real
     emoji equivalent, so they stay hand-drawn below, restyled to the same
     pure-outline weight so all six read as one set rather than a mismatch
     of styles. */
  function toHex(rgb) {
    return '#' + rgb.map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }
  var ICON_SRC = {
    octopus:  { file: 'assets/openmoji/1F419.svg', color: 'cool' },
    bat:      { file: 'assets/openmoji/1F987.svg', color: 'acc' },
    nautilus: { file: 'assets/openmoji/1F40C.svg', color: 'dim' },
    quahog:   { file: 'assets/openmoji/1F41A.svg', color: 'acc' }
  };
  var ICONS = {};
  Object.keys(ICON_SRC).forEach(function (kind) {
    var spec = ICON_SRC[kind];
    fetch(spec.file).then(function (r) { return r.text(); })
      .then(function (svgText) {
        var recolored = svgText.replace(/#000000/g, toHex(PAL[spec.color]));
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

  var CREATURES = [
    {
      kind: 'bat', biome: 1, color: 'acc',
      label: 'Chiroptera (bats) · 2.5× prediction',
      motion: loop([
        { x: 0.15, y: 0.20 }, { x: 0.45, y: 0.10 }, { x: 0.75, y: 0.22 },
        { x: 0.60, y: 0.35 }, { x: 0.30, y: 0.30 }
      ], 110)
    },
    {
      kind: 'chameleon', biome: 1, color: 'moss',
      label: "Labord's chameleon · 4-5 real months, size predicts 8 yr",
      motion: loop([
        { x: 0.20, y: 0.55 }, { x: 0.40, y: 0.58 }, { x: 0.62, y: 0.53 },
        { x: 0.45, y: 0.60 }
      ], 140)
    },
    {
      kind: 'tubeworm', biome: 2, color: 'cool',
      label: 'cold-seep tubeworm · 22× prediction',
      motion: loop([
        { x: 0.30, y: 0.70 }, { x: 0.30, y: 0.60 }, { x: 0.30, y: 0.70 },
        { x: 0.30, y: 0.78 }
      ], 90)
    },
    {
      kind: 'quahog', biome: 3, color: 'acc',
      label: 'ocean quahog · 45× prediction (a real 507-year lifespan)',
      motion: loop([
        { x: 0.25, y: 0.75 }, { x: 0.27, y: 0.76 }, { x: 0.25, y: 0.75 },
        { x: 0.23, y: 0.74 }
      ], 160)
    },
    {
      kind: 'octopus', biome: 3, color: 'cool',
      label: 'giant Pacific octopus · ~1/20 prediction, dead in 5 real years',
      motion: loop([
        { x: 0.55, y: 0.60 }, { x: 0.70, y: 0.68 }, { x: 0.60, y: 0.80 },
        { x: 0.40, y: 0.74 }, { x: 0.45, y: 0.62 }
      ], 130)
    },
    {
      kind: 'nautilus', biome: 3, color: 'dim',
      label: 'chambered nautilus · lives 20 real years',
      motion: loop([
        { x: 0.65, y: 0.30 }, { x: 0.75, y: 0.42 }, { x: 0.65, y: 0.50 },
        { x: 0.55, y: 0.40 }
      ], 150)
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
  var DRAW = {
    bat: function (x, y, s) { drawIcon('bat', x, y, s); },
    chameleon: drawChameleon,
    tubeworm: drawTubeworm,
    quahog: function (x, y, s) { drawIcon('quahog', x, y, s); },
    octopus: function (x, y, s) { drawIcon('octopus', x, y, s); },
    nautilus: function (x, y, s) { drawIcon('nautilus', x, y, s); }
  };

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

  var docTop = 0; // scrollY at draw time
  function drawCreature(c, band, biomeFloat, elapsed) {
    var active = 1 - Math.min(1, Math.abs(biomeFloat - c.biome) * 1.6);
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
      var lx = x + s * 1.6;
      if (lx + 140 > band.x1) lx = x - s * 1.6 - 140;
      ctx.fillText(c.label, Math.max(band.x0 + 4, Math.min(lx, band.x1 - 140)), y);
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
    measureSections();
  }

  var scrollY = 0;
  function onScroll() { scrollY = window.scrollY || window.pageYOffset || 0; }

  var biomeShown = 0; // smoothed, lerped toward the real section each frame

  function draw(elapsed) {
    ctx.clearRect(0, 0, W, H);
    if (!leftBand && !rightBand) return;
    var target = currentBiomeFloat(scrollY);
    biomeShown += (target - biomeShown) * 0.04;
    [leftBand, rightBand].forEach(function (band) {
      if (!band) return;
      drawBiomeBackdrop(band, biomeShown);
      CREATURES.forEach(function (c) { drawCreature(c, band, biomeShown, elapsed); });
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

  if (still) return;

  start();
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); draw(tAcc); } else { start(); }
  });
})();
