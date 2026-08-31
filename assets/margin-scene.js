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
 * Which item is visible, and how strongly, is a function of scroll position
 * and nothing else - the same contract biome-scene.js uses for longevity.html.
 * Every item (a layer, a bar, a flow path, a card, an arc route) is given an
 * `at` (where on the page it lives, 0..1 of the document) and a `span` (how
 * far either side it fades), both derived once from the item's own index and
 * the item count, and a `side` (which margin it prefers) assigned by
 * alternating index so consecutive items land in opposite margins. Opacity
 * is `presence()`, a pure function of `at`/`span` and how far down the
 * document the reader is - no state accumulates frame to frame, so a fast
 * scroll crosses the same fades a slow one does and scrolling back up
 * retraces exactly. Only the small idle motion each kind carries (a dot's
 * shimmer, a bar's breathing, a pulse travelling its path, an arc's wobble,
 * a card's gentle bob) is time-driven, same as biome-scene.js's own
 * distinction between position-driven presence and hand-authored motion.
 *
 * Gated exactly like hero.js: data-motion="off" freezes to one settled
 * frame (never blank) but still repaints on scroll so the reader never sees
 * a frame belonging to a part of the page they have left, motionchange/
 * visibilitychange start and stop the loop, and a missing canvas context
 * degrades to doing nothing.
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
  var W = 0, H = 0, dpr = 1;
  var leftBand = null, rightBand = null; // {x0,x1} in viewport px, or null

  // nav.top has no background (style.css:132-147), so with no clamp at all a
  // drifting item drawn near the top of the document - desktop.html's book
  // cards, in particular - passes straight through it rather than being
  // hidden by it the way an opaque header would hide it for free. nav.top is
  // in normal flow, not fixed, so its bottom edge moves in viewport space as
  // the page scrolls; read it live rather than caching one number.
  var navEl = document.querySelector('nav.top');
  var navBottom = 0;
  function updateNavBottom() {
    navBottom = navEl ? navEl.getBoundingClientRect().bottom : 0;
  }

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
    // Anchored to wide-start/wide-end, not text-start/text-end: main > .wide
    // (and > table, > img.fig, > .cardgrid...) already lets a figure, a table
    // or a card grid occupy the whole wide track, wider than the text column
    // these bands used to stop at - which is exactly why the archive-size
    // bars on code.html used to draw underneath the table rows. A 24px
    // gutter on top keeps the art from touching the wide content's own edge.
    var GUTTER = 24;
    var wideLeft = mainLeft + outerL;
    var wideRight = wideLeft + padL + text + padR;
    // The band runs all the way to the actual browser edge, not just to the
    // edge of main's own (shell-capped) box - on a screen wider than the
    // 1440px shell there is real, unused window past main's box, and the
    // animation should fill it rather than stop short.
    leftBand  = (wideLeft - GUTTER)        > 60 ? { x0: 0, x1: wideLeft - GUTTER }     : null;
    rightBand = (W - (wideRight + GUTTER)) > 60 ? { x0: wideRight + GUTTER, x1: W }    : null;
  }

  /* Given an item's preferred side, the band it actually draws in. When both
     margins exist this is just "the one it was assigned"; when the window is
     narrow enough that measureBands() only found one band, every item falls
     back to that one rather than silently disappearing on its assigned but
     absent side. */
  function bandForSide(side) {
    if (side === 'l') return leftBand || rightBand;
    return rightBand || leftBand;
  }

  /* Cached because scrollHeight forces layout, and this is read every frame.
     Refreshed by resize() and by the ResizeObserver on body below - the same
     approach biome-scene.js uses, so a lazy figure loading in and making the
     document taller moves every fade rather than leaving it stale. */
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

  /* How present an item is, read straight off where the reader is in the
     document. No state accumulates between calls - a fast scroll crosses the
     same fades a slow one does, and scrolling back up retraces exactly.

     The profile is a trapezoid, not a peak: full opacity anywhere within
     `hold` of the item's own `at`, then a fade out to nothing at `span`.
     With a single peak an item was only ever fully opaque at one exact
     scroll position, so everything read as flickering past on the way to
     somewhere else however slowly you scrolled. The plateau is what gives an
     item a stretch of the page it simply owns, and the longer tail is what
     stops it snapping in and out at the edges of that stretch. */
  function presence(item, p) {
    var d = Math.abs(p - item.at);
    var hold = item.hold || 0;
    if (d <= hold) return 1;
    if (d >= item.span) return 0;
    return ease(1 - (d - hold) / (item.span - hold));
  }

  /* Spreads a list of items evenly down the whole document and alternates
     which margin each prefers. `at` is the item's own slot, centred so the
     first and last items don't sit flush against the very top/bottom of the
     document.

     `hold` and `span` are both expressed in item-spacings (1/n of the
     document), so the feel is the same whether a page hands over ten items
     or forty-four. An item is fully opaque across two spacings - one either
     side of its own slot - and then fades over another two, so it is
     somewhere on screen for six spacings in all. That is deliberately slower
     than it was: at `span = 2/n` with no plateau, an item reached full
     opacity at exactly one scroll position and was visibly on its way in or
     out everywhere else.

     Six spacings live at once needs more rows than five to sit in, hence
     ROWS below. Side alternates by index so consecutive items - the ones
     simultaneously in view - land in opposite margins rather than
     mirroring each other. */
  function assignAtSpan(items) {
    var n = items.length;
    if (!n) return;
    items.forEach(function (item, i) {
      item.at = (i + 0.5) / n;
      /* Capped so a scene with very few items does not end up with every one
         of them permanently on screen. */
      item.hold = Math.min(0.16, 1 / n);
      item.span = Math.min(0.42, 3 / n);
      item.side = i % 2 === 0 ? 'l' : 'r';
      /* Stamped here rather than read from a loop index at draw time: the
         collage kind draws several item lists in one frame, so an item's
         row has to belong to the item, not to its position inside whichever
         list it happens to sit in - otherwise two kinds both start at row 0
         and draw on top of each other. */
      item.row = i % ROWS;
    });
  }

  /* The home page's scene is a mesh of the other pages' - a bar from the
     code index, a card from the atlas, a route from the climate calculator,
     a pulse from the heat model. Each part keeps its own kind and its own
     real numbers; they are laid out with their own layout function, then the
     union is re-assigned across the whole document in interleaved order so
     the reader meets one kind, then the next, on the way down, rather than
     one of every kind at every scroll position. */
  function layoutCollage() {
    var parts = SCENE.parts || [];
    var byKind = {};
    parts.forEach(function (part) {
      var sub = { kind: part.kind, items: part.items, paths: part.paths,
                  layers: part.layers };
      var saved = SCENE;
      SCENE = sub;                    // the layout functions read SCENE
      if (part.kind === 'strata') { layoutStrata(); byKind.strata = strataBands; }
      else if (part.kind === 'bars') { layoutBars(); byKind.bars = barsCells; }
      else if (part.kind === 'flowpulse') { layoutFlow(); byKind.flow = flowPaths; }
      else if (part.kind === 'cards') { layoutCards(); byKind.cards = cardItems; }
      else if (part.kind === 'arcroute') { layoutArcs(); byKind.arcs = arcRows; }
      SCENE = saved;
    });
    /* Interleave: take one item from each part in turn, so consecutive
       positions down the page come from different pages' scenes. */
    var lists = [byKind.strata, byKind.bars, byKind.flow, byKind.cards,
                 byKind.arcs].filter(Boolean);
    var union = [], k = 0, more = true;
    while (more) {
      more = false;
      for (var j = 0; j < lists.length; j++) {
        if (k < lists[j].length) { union.push(lists[j][k]); more = true; }
      }
      k++;
    }
    assignAtSpan(union);
  }

  function drawCollage(t) {
    /* Every draw function already returns early on an item that is not live,
       so running all five is the whole implementation. */
    drawStrata(t); drawBars(t); drawFlow(t); drawCards(t); drawArcs(t);
  }

  /* Vertical slots within the viewport that simultaneously-visible items are
     laid out in, so two items live at once don't draw on top of each other.
     Five is comfortably more than the three-to-five that are ever actually
     present together (see assignAtSpan), and items are far enough apart in
     `at` that two sharing a row index are never both visible at once.

     Seven, not five: with the trapezoid profile an item is live across six
     item-spacings, so up to six can be on screen together. Two items sharing
     a row are seven spacings apart, which is wider than that window, so a
     row is never asked to hold two visible items. */
  var ROWS = 7;

  /* The top and bottom of the drawable column, in viewport pixels. The top
     starts below nav.top so an item never begins underneath it. */
  function columnTop()    { return Math.max(24, navBottom + 16); }
  function columnHeight() { return Math.max(120, H - columnTop() - 28); }

  /* Where item `i` sits vertically, and how tall its slot is.

     This used to be `20 + (i % ROWS) * Math.min(CAP, (H - 40) / ROWS)`, and
     the cap was the bug: on an 876px viewport (H - 40) / 5 is 167, so every
     Math.min(34..70, 167) returned the constant, the five slots spanned only
     20..190 or 20..370, and every scene on the site was glued into the top
     quarter of the window with the rest of the margin empty. The slot height
     is now derived from the column, so the rows always fill it. `slotFrac`
     lets a kind ask for a shorter drawing box inside its own slot without
     changing where the slots are. */
  /* An item's own row if it has one (assignAtSpan stamps it), else its index
     in the list being drawn - which is the same thing for a single-kind
     scene, and the correct thing for a collage where one list's index says
     nothing about where another list's items sit. */
  function rowOf(item, i) {
    return (item && item.row != null) ? item.row : i;
  }

  function slotY(i, slotFrac) {
    var h = columnHeight() / ROWS;
    var mid = columnTop() + (i % ROWS) * h + h / 2;
    var box = h * (slotFrac || 1);
    return { y: mid - box / 2, h: box, mid: mid };
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
    updateNavBottom();
    measureScrollSpan();
    layoutScene();
  }

  var scrollY = 0;
  /* With motion off the animation loop is not running, so a scroll would
     otherwise leave the last painted frame on screen while the reader moves
     past it - a scene belonging to a part of the page they have left.
     Repainting on scroll (throttled to one paint per frame) keeps the scene
     correct for where they are without animating anything extra: idle
     motion stays frozen at its start, and only the position-derived
     opacities move. Same approach as biome-scene.js's onScroll. */
  var stillRaf = 0;
  function onScroll() {
    scrollY = window.scrollY || window.pageYOffset || 0;
    updateNavBottom();
    if (still && !stillRaf) {
      stillRaf = requestAnimationFrame(function () {
        stillRaf = 0;
        draw(tAcc);
      });
    }
  }

  /* ---- per-kind precomputed layout (dot fields etc, seeded once) ------- */
  var strataBands = null;   // strata: [{layer,color,dots:[{fx,fy}],at,span,side}]
  var barsCells = null;     // bars: [{label,n,frac,color,at,span,side}]
  var flowPaths = null;     // flowpulse: [{label,weight,color,pts,at,span,side}]
  var cardItems = null;     // cards: [{text,sub,at,span,side}]
  var arcRows = null;       // arcroute: [{label,weight,color,at,span,side}]

  function layoutScene() {
    if (SCENE.kind === 'strata') layoutStrata();
    else if (SCENE.kind === 'bars') layoutBars();
    else if (SCENE.kind === 'flowpulse') layoutFlow();
    else if (SCENE.kind === 'cards') layoutCards();
    else if (SCENE.kind === 'arcroute') layoutArcs();
    else if (SCENE.kind === 'collage') layoutCollage();
  }

  function layoutStrata() {
    var layers = SCENE.layers || [];
    var heights = layers.map(function (L) { return Math.log10(L.n + 1); });
    var maxHeight = Math.max.apply(null, heights) || 1;
    var rnd = mulberry32(1);
    strataBands = layers.map(function (L, i) {
      var density = Math.max(6, Math.round(6 + 10 * (heights[i] / maxHeight)));
      var dots = [];
      for (var d = 0; d < density; d++) {
        dots.push({ fx: rnd(), fy: rnd(), ph: rnd() * 6.28 });
      }
      return { layer: L, color: CYCLE[i % CYCLE.length], dots: dots };
    });
    assignAtSpan(strataBands);
  }

  function layoutBars() {
    var items = SCENE.items || [];
    var max = Math.max.apply(null, items.map(function (d) { return d.n; })) || 1;
    barsCells = items.map(function (d, i) {
      return { label: d.label, n: d.n, frac: d.n / max, color: CYCLE[i % CYCLE.length] };
    });
    assignAtSpan(barsCells);
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
    assignAtSpan(flowPaths);
  }

  function layoutCards() {
    var items = SCENE.items || [];
    cardItems = items.map(function (d) {
      return { text: d.text, sub: d.sub };
    });
    assignAtSpan(cardItems);
  }

  function layoutArcs() {
    var items = SCENE.items || [];
    arcRows = items.map(function (d, i) {
      return { label: d.label, from: d.from, to: d.to, weight: d.weight,
               color: CYCLE[i % CYCLE.length] };
    });
    assignAtSpan(arcRows);
  }

  /* ---- drawing ----------------------------------------------------------
     Every kind shares the same shape: for each item, compute presence from
     scroll position, skip it if it's not live, resolve which band it draws
     in (falling back when only one band exists), place it in a viewport-
     relative row so simultaneously-visible items don't collide, and gate
     its whole opacity through `active`. Only the small hand-authored motion
     inside each item - a shimmer, a breath, a travelling pulse, a wobble, a
     bob - reads the elapsed-time clock `t`. */

  function drawStrata(t) {
    if (!strataBands) return;
    var p = progress();
    var rowFrac = 0.62;
    strataBands.forEach(function (b, i) {
      var active = presence(b, p);
      if (active <= 0.02) return;
      var band = bandForSide(b.side);
      if (!band) return;
      var bw = band.x1 - band.x0;
      var slot = slotY(rowOf(b, i), rowFrac), y0 = slot.y, rowH = slot.h;
      ctx.globalAlpha = active;
      ctx.fillStyle = rgba(b.color, 0.09);
      ctx.fillRect(band.x0, y0, bw, rowH - 8);
      b.dots.forEach(function (dot) {
        var dy = y0 + dot.fy * (rowH - 8) + Math.sin(t * 0.25 + dot.ph) * 3;
        ctx.beginPath();
        ctx.fillStyle = rgba(b.color, 0.5);
        ctx.arc(band.x0 + dot.fx * bw, dy, 1.3, 0, 6.2832);
        ctx.fill();
      });
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = rgba('dim', 0.6);
      ctx.fillText(b.layer.label + ' · ' + b.layer.n.toLocaleString(),
                   band.x0 + 8, y0 + 14);
      ctx.globalAlpha = 1;
    });
  }

  function drawBars(t) {
    if (!barsCells) return;
    var p = progress();
    var rowFrac = 0.34;
    barsCells.forEach(function (c, i) {
      var active = presence(c, p);
      if (active <= 0.02) return;
      var band = bandForSide(c.side);
      if (!band) return;
      var bw = band.x1 - band.x0;
      var pad = Math.min(18, bw * 0.15);
      var trackW = bw - pad * 2;
      var slot = slotY(rowOf(c, i), rowFrac), y = slot.y, rowH = slot.h;
      var breathe = 0.9 + 0.1 * Math.sin(t * 0.6 + i);
      var w = trackW * c.frac * breathe;
      ctx.globalAlpha = active;
      ctx.fillStyle = rgba(c.color, 0.28);
      ctx.fillRect(band.x0 + pad, y + rowH * 0.25, w, rowH * 0.4);
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = rgba('dim', 0.6);
      ctx.fillText(c.label, band.x0 + pad, y + rowH * 0.15);
      ctx.globalAlpha = 1;
    });
  }

  function drawFlow(t) {
    if (!flowPaths) return;
    var p = progress();
    var rowFrac = 0.62;
    flowPaths.forEach(function (fp, i) {
      var active = presence(fp, p);
      if (active <= 0.02) return;
      var band = bandForSide(fp.side);
      if (!band) return;
      var bw = band.x1 - band.x0;
      var slot = slotY(rowOf(fp, i), rowFrac), y0 = slot.y, rowH = slot.h;
      ctx.globalAlpha = active;
      ctx.beginPath();
      ctx.strokeStyle = rgba(fp.color, 0.35);
      ctx.lineWidth = 1;
      fp.pts.forEach(function (pt, k) {
        var x = band.x0 + pt.fx * bw, y = y0 + pt.fy * (rowH - 10);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // a pulse travelling the path, speed set by the path's real weight
      var speed = 0.15 + fp.weight * 0.6;
      var phase = (t * speed + i * 0.3) % 1;
      var seg = phase * (fp.pts.length - 1);
      var i0 = Math.floor(seg), f = seg - i0;
      var a = fp.pts[i0], bpt = fp.pts[Math.min(i0 + 1, fp.pts.length - 1)];
      var px = band.x0 + (a.fx + (bpt.fx - a.fx) * f) * bw;
      var py = y0 + (a.fy + (bpt.fy - a.fy) * f) * (rowH - 10);
      ctx.beginPath();
      ctx.fillStyle = rgba(fp.color, 0.85);
      ctx.arc(px, py, 2.2, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  function drawCards(t) {
    if (!cardItems) return;
    var p = progress();
    var rowFrac = 0.46;
    cardItems.forEach(function (c, i) {
      var active = presence(c, p);
      if (active <= 0.02) return;
      var band = bandForSide(c.side);
      if (!band) return;
      var bw = band.x1 - band.x0;
      var pad = 6, w = Math.max(0, bw - pad * 2);
      // a small idle bob, purely decorative - the card's own presence is
      // entirely position-driven, this just keeps it from looking inert
      var slot = slotY(rowOf(c, i), rowFrac), rowH = slot.h;
      var y = slot.y + Math.sin(t * 0.5 + i) * 2;
      ctx.globalAlpha = 0.55 * active;
      ctx.fillStyle = rgba('dim', 0.1);
      ctx.fillRect(band.x0 + pad, y, w, 40);
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = rgba('ink', 0.55);
      ctx.fillText(c.text, band.x0 + pad + 6, y + 17, w - 12);
      ctx.fillStyle = rgba('dim', 0.5);
      ctx.fillText(c.sub || '', band.x0 + pad + 6, y + 31, w - 12);
      ctx.globalAlpha = 1;
    });
  }

  function drawArcs(t) {
    if (!arcRows) return;
    var p = progress();
    var maxW = Math.max.apply(null, arcRows.map(function (r) { return r.weight; })) || 1;
    var rowFrac = 0.40;
    arcRows.forEach(function (r, i) {
      var active = presence(r, p);
      if (active <= 0.02) return;
      var band = bandForSide(r.side);
      if (!band) return;
      var bw = band.x1 - band.x0;
      var slot = slotY(rowOf(r, i), rowFrac), y = slot.y, rowH = slot.h;
      var thick = 0.6 + (r.weight / maxW) * 3.5;
      var wobble = Math.sin(t * 0.3 + i) * 3;
      ctx.globalAlpha = active;
      ctx.beginPath();
      ctx.strokeStyle = rgba(r.color, 0.4);
      ctx.lineWidth = thick;
      var x0 = band.x0 + bw * 0.15, x1 = band.x0 + bw * 0.85;
      ctx.moveTo(x0, y + rowH * 0.5);
      ctx.quadraticCurveTo((x0 + x1) / 2, y + rowH * 0.5 - 10 + wobble, x1, y + rowH * 0.5);
      ctx.stroke();
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = rgba('dim', 0.6);
      ctx.fillText(r.label, band.x0 + 8, y + rowH * 0.5 - 14);
      ctx.globalAlpha = 1;
    });
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    if (!leftBand && !rightBand) return;
    ctx.save();
    // Clip everything below nav.top's own bottom edge - a hard cull, not a
    // fade, because nav has no background to fade into; anything drawn above
    // this line would otherwise show through it rather than behind it.
    if (navBottom > 0) {
      ctx.beginPath();
      ctx.rect(0, navBottom, W, Math.max(0, H - navBottom));
      ctx.clip();
    }
    if (SCENE.kind === 'strata') drawStrata(t);
    else if (SCENE.kind === 'bars') drawBars(t);
    else if (SCENE.kind === 'flowpulse') drawFlow(t);
    else if (SCENE.kind === 'cards') drawCards(t);
    else if (SCENE.kind === 'arcroute') drawArcs(t);
    else if (SCENE.kind === 'collage') drawCollage(t);
    ctx.restore();
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

  // Every fade here is a fraction of the document's height, so the document
  // getting taller - a lazy figure arriving, a details block collapsing -
  // moves every fade. Same watcher biome-scene.js uses.
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

  /* Registered whether or not the scene is currently moving. Behind an
     `if (still) return;` a reader who arrived with motion off never got the
     motionchange listener, so the footer control did nothing until a reload
     - against motion.js's contract that it overrides the default without
     one. start() already refuses to run while still. */
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); draw(tAcc); } else { start(); }
  });

  if (!still) start(); // still: the one settled frame drawn above is enough
})();
