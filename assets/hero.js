/* The home page's hero: one of three nonlinear systems, integrated live.
 *
 * Double pendulum, Lorenz attractor, or Burrau's three-body problem - one
 * picked at random per load, or forced with ?hero=pendulum|lorenz|threebody.
 * Nothing is a video, nothing is a data file, nothing comes from a CDN: the
 * equations are four to eight lines each and the trajectory is computed as you
 * watch. That is the whole argument for it being here - a figure a reader can
 * see being computed, rather than a picture of one.
 *
 * IT IS NOT THE ENERGY MODEL, AND THE CAPTIONS STOPPED SAYING SO ON
 * 2026-09-06. READ THIS BEFORE PUTTING ANYTHING ATLAS-SHAPED BACK ON THE HOME
 * PAGE.
 *
 * DESLOP_AUDIT F6 deleted force-bg.js - a real, physically simulated subgraph
 * of the published atlas - for being "decoration that restates the page at
 * illegible size". The answer to that, recorded in HANDOFF section 4, was that
 * these captions name a published system and deny being the model outright.
 * The denial has gone: the captions were cut to about a dozen words and the
 * clause went with the length.
 *
 * THAT IS ONLY SAFE BECAUSE THE SAME COMMIT EMPTIED THE PAGE AROUND IT. The
 * atlas card, the figure mosaic and the model chart went at the same time, so
 * the home page is this canvas and the index and nothing else. There is
 * nothing left for a reader to mistake the animation FOR. A pendulum beside a
 * card headed "A model of the world energy system" invites exactly the
 * reading F6 punished; a pendulum on an otherwise empty page does not.
 *
 * SO THE RULE CARRIES ITS CIRCUMSTANCE: if anything atlas-shaped returns to
 * the home page - a card, a figure of the model, a node-link anything, and the
 * pending rename may well put one there - THE DISCLAIMER COMES BACK INTO THE
 * CAPTIONS AT THE SAME TIME. It is not a stylistic preference that was
 * outgrown; it was load-bearing until the thing it was bearing against was
 * removed.
 *
 * ---- the four things that will bite whoever edits this ------------------
 *
 * 1. THE MOTION GATE IS THIS FILE'S JOB, NOT THE STYLESHEET'S. style.css's
 *    [data-motion="off"] block kills animation-duration and transition-
 *    duration. It does nothing whatever to requestAnimationFrame. So this file
 *    reads documentElement.dataset.motion itself, draws one settled frame and
 *    stops if it is not "on", and listens for "motionchange" to tear down.
 *    motion.js's header states that contract; a loop left running behind a page
 *    that says "static" is the failure it exists to prevent.
 *
 * 2. RATE IS DECOUPLED FROM REFRESH RATE, and a constant steps-per-frame does
 *    not do that. It gives the same trajectory SHAPE on every machine but a
 *    rate proportional to the display: on a 120Hz phone everything runs at
 *    double speed, and a 30fps machine looks deliberately slow. So wall time is
 *    accumulated from the rAF timestamp and spent in whole steps, remainder
 *    carried. The `last ? ... : NOMINAL_MS` sentinel is load-bearing: without it
 *    the first frame after every start() sees last === 0, computes a dt of the
 *    page's whole lifetime, and burns the clamp that exists for the cases
 *    visibilitychange cannot see (a GC pause, a closing lid, a breakpoint).
 *
 * 3. THE THREE-BODY NEEDS AN ADAPTIVE STEP AND THIS IS NOT NEGOTIABLE. Burrau's
 *    closest approach is ~4e-4, where the dynamical time is ~2.5e-6; a fixed
 *    1e-6 step leaves the encounter unresolved and the run ends with a relative
 *    energy drift of 1.8e+1 - the bodies go wherever truncation error puts
 *    them. Softening it away (eps=1e-3) gives a system that never resolves at
 *    all. Adaptive Cash-Karp is 2,400x CHEAPER as well as correct, because it
 *    takes long steps between encounters: 25,746 of them to t=61.4, against 61
 *    million. tests/verify_hero_systems.js measures all of that and reproduces
 *    Szebehely & Peters 1967; run it before touching EPS2, TOL or escaped().
 *
 * 4. THE TRAIL FADES TOWARD TRANSPARENT, NOT TOWARD PAPER. See fadeBack().
 *
 * Palette is the site's: dark ink on paper. Every reference image of these
 * systems is a glowing line on black and this is the inverse on purpose - it
 * should read as a plotter drawing, like the rest of the site's figures, not as
 * a screensaver. Nothing is ever summed: the one composite operation here is
 * destination-out, an eraser, and trap 10 is about additive blending saturating
 * to white - so trap 10 cannot apply. 2D canvas honours lineWidth, so trap 9
 * does not either. Those are the two traps the constraint list flagged, and
 * choosing a 2D canvas removes both rather than managing them.
 *
 * Design and measurements: 03 RESEARCH/rename-hero/STAGE2_PLAN.md.
 */
(function () {
  'use strict';

  var host = document.getElementById('hero');
  if (!host) return;

  var back = document.createElement('canvas');   // trails, eroded not cleared
  var front = document.createElement('canvas');  // bodies and rods, cleared
  back.className = front.className = 'hero-layer';
  host.appendChild(back);
  host.appendChild(front);
  var bc = back.getContext && back.getContext('2d');
  var fc = front.getContext && front.getContext('2d');
  if (!bc || !fc) return;

  var INK = '#241E1A';                  /* --ink  */
  var ACC = '#245F73';                  /* --acc  */
  var MOSS = '#733E24';                 /* --moss */
  var RULE = '#BBBDBC';                 /* --rule */

  /* The back canvas ran at dpr 1 while the front ran at min(dpr,2), which put
     half-resolution trails against crisp rods and was visible.
     Raising it was expected to be expensive, because the erosion covers the
     whole surface and scales with bdpr^2. Measured, it is not: three runs of
     the three-body at 1440 averaged 1022 ms/3s at dpr 1 and 964 at dpr 2, a
     difference smaller than the +/-150ms run-to-run noise. The per-frame cost
     is dominated by stroke COUNT, not by fill area - which is also why
     splitting trail() from bodies() below was worth far more than this. So
     dpr 2, because it is visibly better and costs nothing detectable. */
  var TRAIL_DPR = 1;

  /* AN ABSOLUTE CEILING ON THE BACKING STORE, in device pixels - not a device
     ratio, because a ratio is a multiplier on a viewport nobody controls.
     This page was reported unusable on a 3840x2400 panel at 225% Windows
     scaling: devicePixelRatio 2.2222, CSS viewport 1728x1080, and with the old
     cap of 2 that is 3456x2160 = 7.5 megapixels PER CANVAS, twice, every
     frame. About 900 megapixels a second. On that machine Firefox's
     accelerated Canvas2D was AVAILABLE and failing at runtime inside the GPU
     process, so all of it was running on one CPU core through Skia's software
     raster pipeline.
     Capping the width instead puts the ceiling on WORK rather than on a ratio,
     so it holds whatever display arrives. Which limit binds depends on the
     window: at 1728 CSS px this one does (1600/1728 = 0.926), on a 1200-wide
     window TRAIL_DPR does.
     DESIGN FOR SOFTWARE RASTER. Acceleration was available on that machine and
     failed anyway, so a page that only works when canvas acceleration works is
     a page that breaks silently for everyone whose acceleration does not. */
  var MAX_BACKING_W = 1600;
  var CLAMP_MS = 50;                    /* hero.js 2a99923 used this; keep it */
  var NOMINAL_MS = 16;                  /* one 60Hz frame, for the first frame */

  var W = 0, H = 0, fdpr = 1, footRect = null;

  function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }

  /* ==== the three systems ==============================================
   * Each exposes: reset(), frame(), step(h), trail(alpha), bodies(alpha), and
   * the constants
   *
   * TRAIL AND BODIES ARE SEPARATE BECAUSE THEY RUN AT DIFFERENT RATES. The
   * trail needs one segment per integration step, or it draws a dotted line
   * with gaps where the step was; the rods and discs need drawing once per
   * FRAME, because the front canvas is cleared once per frame and every pass
   * but the last is overwritten. They were one function until 2026-09-06, so
   * seventeen steps a frame meant seventeen redraws of six rods and six discs,
   * sixteen of them invisible. Splitting them was worth ~40% of the frame.
   * H (step), RATE (system time per wall second), CAP (steps a frame may take),
   * FADE (the trail's erosion per frame), settle (units to run undrawn), and a
   * caption.
   *
   * THE CAPTIONS ARE ONE REGISTER: the system's name, then the parameters that
   * make this instance this instance - the release offset, the three Lorenz
   * constants, the three masses. Nothing else. The dates that used to follow
   * the Lorenz and Burrau names were dropped on 2026-09-07 because the double
   * pendulum has no single publication to date and inventing symmetry is worse
   * than losing two numbers a reader was not using; the citations are in the
   * per-system comments below, where provenance belongs. Keep new captions to
   * that shape and to about a dozen words.
   *
   * FADE IS PER SYSTEM. The erosion is per frame but the drawing rate is per
   * unit of system time, so one constant gives the fast system a long arc and
   * the slow one a stub that washes out before it grows. A trail survives about
   * 1/FADE frames, so these are roughly 3s, 5s and 20s of memory - chosen so
   * each system shows a comparable LENGTH of trajectory, not a comparable
   * duration. */

  /* ---- 1. three double pendulums ------------------------------------- */
  /* Three, not one, and that is the whole point of choosing this system: they
     are released 0.001 rad apart, they are indistinguishable for several
     seconds, and then they are not. One pendulum draws a pretty curve; three
     draw sensitive dependence, which is the thing the page is about.
     tests/verify_hero_systems.js pins that claim - it is a caption assertion
     like the other two, not a decoration. */
  function Pendulum() {
    var M1 = 1, M2 = 1, L1 = 1, L2 = 1, G = 9.81;
    var TH = [2.000, 2.001, 2.002];
    var COL = [ACC, MOSS, INK];
    var st = [], prev = [];
    var k1 = [0,0,0,0], k2 = [0,0,0,0], k3 = [0,0,0,0], k4 = [0,0,0,0], t = [0,0,0,0];
    var px = 0, py = 0, scale = 1;

    function f(y, o) {
      var t1 = y[0], t2 = y[1], w1 = y[2], w2 = y[3];
      var d = t1 - t2, den = 2 * M1 + M2 - M2 * Math.cos(2 * d);
      o[0] = w1; o[1] = w2;
      o[2] = (-G * (2 * M1 + M2) * Math.sin(t1) - M2 * G * Math.sin(t1 - 2 * t2)
            - 2 * Math.sin(d) * M2 * (w2 * w2 * L2 + w1 * w1 * L1 * Math.cos(d)))
            / (L1 * den);
      o[3] = (2 * Math.sin(d) * (w1 * w1 * L1 * (M1 + M2) + G * (M1 + M2) * Math.cos(t1)
            + w2 * w2 * L2 * M2 * Math.cos(d))) / (L2 * den);
    }
    this.H = 0.001;          /* 1ms. RK4 is not symplectic, so the energy error
                                is secular: at 2ms it reaches 1.35e-4 over eight
                                hours, breaching a 1e-4 bound at about six. At
                                1ms it is 4.22e-6. Both measured. */
    this.RATE = 1.0;         /* genuine real time - a 1m pendulum's ~2s period is
                                the one thing here a reader has a feel for */
    this.CAP = 200;
    this.FADE = 0.03;
    this.settle = 0;
    this.reset = function () {
      st = TH.map(function (a) { return [a, a, 0, 0]; });
      prev = [null, null, null];
    };
    this.frame = function () {
      /* The pivot is CENTRED, and `scale` is PX PER METRE while the swept
         disc's RADIUS is l1+l2 = 2m. The design said "2l = 0.95W", which reads
         as a diameter and is not: taken either way it put the reachable radius
         at 1224px on a 900px-tall screen, with the pivot at 0.22H, so both bobs
         spent most of their time above the top edge and the trail was laid down
         off-canvas - measured, the darkest pixel on the back canvas was 230
         against paper's 242, i.e. nothing visible.
         What the framing wants is a radius fixed against the WIDTH, so the disc
         reaches into the margins either side of the paper column: 0.375W, which
         at 1440 is 540px against a column edge at 391 - 149px of penetration,
         the "inner half of each margin" the design asked for - and at 1024
         covers the 121px margin outright. Capped against height so a short
         window does not get a pendulum swinging entirely off the top and
         bottom. It still overflows vertically by design: the drawing is larger
         than the window, which is the same thing the column says. */
      px = W * 0.5; py = H * 0.45;
      scale = Math.min(0.1875 * W, 0.42 * H);
    };
    this.step = function (h) {
      for (var n = 0; n < 3; n++) {
        var y = st[n], i;
        f(y, k1);
        for (i = 0; i < 4; i++) t[i] = y[i] + 0.5 * h * k1[i];
        f(t, k2);
        for (i = 0; i < 4; i++) t[i] = y[i] + 0.5 * h * k2[i];
        f(t, k3);
        for (i = 0; i < 4; i++) t[i] = y[i] + h * k3[i];
        f(t, k4);
        for (i = 0; i < 4; i++) y[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
    };
    function tip(y) {
      var x1 = px + scale * L1 * Math.sin(y[0]), y1 = py + scale * L1 * Math.cos(y[0]);
      return [x1, y1, x1 + scale * L2 * Math.sin(y[1]), y1 + scale * L2 * Math.cos(y[1])];
    }
    this.trail = function (alpha) {
      bc.lineWidth = 1.6; bc.lineCap = 'round'; bc.globalAlpha = alpha;
      for (var n = 0; n < 3; n++) {
        var p = tip(st[n]);
        if (prev[n]) {
          bc.strokeStyle = COL[n];
          bc.beginPath(); bc.moveTo(prev[n][0], prev[n][1]); bc.lineTo(p[2], p[3]); bc.stroke();
        }
        prev[n] = [p[2], p[3]];
      }
      bc.globalAlpha = 1;
    };
    /* Rods 1.2/1.0 and discs 5/4, down from 1.6/1.3 and 6/5: six rods and six
       discs at the single-pendulum weights read as clutter. Each pendulum's
       rods take its own colour so a reader can follow one of the three. */
    this.bodies = function (alpha) {
      fc.globalAlpha = alpha;
      fc.lineCap = 'round'; fc.lineJoin = 'round';
      for (var n = 0; n < 3; n++) {
        var p = tip(st[n]);
        fc.strokeStyle = COL[n];
        fc.lineWidth = 1.2;
        fc.beginPath(); fc.moveTo(px, py); fc.lineTo(p[0], p[1]); fc.stroke();
        fc.lineWidth = 1.0;
        fc.beginPath(); fc.moveTo(p[0], p[1]); fc.lineTo(p[2], p[3]); fc.stroke();
        fc.fillStyle = COL[n]; dot(fc, p[0], p[1], 5); dot(fc, p[2], p[3], 4);
      }
      fc.fillStyle = RULE; dot(fc, px, py, 3);     /* the shared pivot, once */
      fc.globalAlpha = 1;
    };
    this.caption = 'Three double pendulums, released 0.001 rad apart.';
  }

  /* ---- 2. Lorenz attractor -------------------------------------------- */
  function Lorenz() {
    var SIG = 10, RHO = 28, BETA = 8 / 3;
    var s = [0, 1, 0];
    var k1 = [0,0,0], k2 = [0,0,0], k3 = [0,0,0], k4 = [0,0,0], t = [0,0,0];
    var ox = 0, oy = 0, sx = 1, sy = 1, prev = null;

    function f(y, o) {
      o[0] = SIG * (y[1] - y[0]);
      o[1] = y[0] * (RHO - y[2]) - y[1];
      o[2] = y[0] * y[1] - BETA * y[2];
    }
    this.H = 0.004;
    this.RATE = 1.2;         /* ~0.7 units a lobe circuit, so ~1.7 a second:
                                fast enough to read as flow, slow enough to
                                follow one arc */
    this.CAP = 400;
    this.FADE = 0.02;
    /* (0,1,0) sits beside the origin, which is a saddle: the opening is a slow
       spiral outward, and drawn it gives the arrival screen a motionless dot
       for the first second. 20 units are integrated and not drawn, and the
       caption says so. Same code path as the reduced-motion settle pass. */
    this.settle = 20;
    this.reset = function () { s = [0, 1, 0]; prev = null; };
    this.frame = function () {
      sx = 0.92 * W / 40; sy = 0.86 * H / 50;   /* x in [-20,20], z in [0,50] */
      ox = W / 2; oy = H / 2 + 25 * sy;
    };
    this.step = function (h) {
      var i;
      f(s, k1);
      for (i = 0; i < 3; i++) t[i] = s[i] + 0.5 * h * k1[i];
      f(t, k2);
      for (i = 0; i < 3; i++) t[i] = s[i] + 0.5 * h * k2[i];
      f(t, k3);
      for (i = 0; i < 3; i++) t[i] = s[i] + h * k3[i];
      f(t, k4);
      for (i = 0; i < 3; i++) s[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    };
    this.trail = function (alpha) {
      var x = ox + s[0] * sx, y = oy - s[2] * sy;
      if (prev) {
        /* y is out of plane, so it carries depth through width and alpha - both
           of which a 2D canvas honours, unlike WebGL's linewidth (trap 9).
           Colour is the lobe, which is information rather than decoration. */
        var n = Math.max(0, Math.min(1, (s[1] + 30) / 60));
        bc.strokeStyle = s[0] < 0 ? ACC : MOSS;
        bc.lineWidth = 0.9 + 0.9 * n;
        bc.globalAlpha = (0.4 + 0.5 * n) * alpha;
        bc.lineCap = 'round';
        bc.beginPath(); bc.moveTo(prev[0], prev[1]); bc.lineTo(x, y); bc.stroke();
        bc.globalAlpha = 1;
      }
      prev = [x, y];
    };
    this.bodies = function (alpha) {
      fc.globalAlpha = alpha;
      fc.fillStyle = INK; dot(fc, ox + s[0] * sx, oy - s[2] * sy, 3.5);
      fc.globalAlpha = 1;
    };
    this.caption = 'Lorenz attractor. σ = 10, ρ = 28, β = 8/3.';
  }

  /* ---- 3. Burrau's three-body problem ---------------------------------- */
  function ThreeBody() {
    var M = [3, 4, 5];
    /* b1 mass 3 at (1,3); b2 mass 4 at (-2,-1); b3 mass 5 at (1,-1). Each mass
       sits opposite the triangle side of the same length, and the barycentre is
       the origin. Bodies are b1..b3; their MASSES are 3,4,5 - do not conflate
       the two, there is no b4 or b5. */
    var R0 = [1, 3, 0, 0, -2, -1, 0, 0, 1, -1, 0, 0];
    var EPS2 = 1e-12, TOL = 1e-11, FLOOR = 8;
    var B = [[], [1/5], [3/40, 9/40], [3/10, -9/10, 6/5],
             [-11/54, 5/2, -70/27, 35/27],
             [1631/55296, 175/512, 575/13824, 44275/110592, 253/4096]];
    var C = [37/378, 0, 250/621, 125/594, 0, 512/1771];
    var DC = [37/378 - 2825/27648, 0, 250/621 - 18575/48384,
              125/594 - 13525/55296, -277/14336, 512/1771 - 1/4];
    var y = new Float64Array(12), yt = new Float64Array(12), y5 = new Float64Array(12);
    var k = [], q;
    for (q = 0; q < 6; q++) k.push(new Float64Array(12));
    var RAD = [0, 1, 2].map(function (i) { return 4.0 * Math.pow(M[i], 1 / 3); });
    var hh = 1e-4, seed = 0, prev = null, sx = 1, ox = 0, oy = 0, span = 3;

    function deriv(v, o) {
      var i, j;
      for (i = 0; i < 3; i++) { o[4*i] = v[4*i+2]; o[4*i+1] = v[4*i+3]; o[4*i+2] = 0; o[4*i+3] = 0; }
      for (i = 0; i < 3; i++) for (j = i + 1; j < 3; j++) {
        var dx = v[4*j] - v[4*i], dy = v[4*j+1] - v[4*i+1];
        var d2 = dx*dx + dy*dy + EPS2, inv = 1 / (d2 * Math.sqrt(d2));
        o[4*i+2] += M[j]*dx*inv; o[4*i+3] += M[j]*dy*inv;
        o[4*j+2] -= M[i]*dx*inv; o[4*j+3] -= M[i]*dy*inv;
      }
    }
    function trial(h) {
      var st, i, p;
      for (st = 0; st < 6; st++) {
        if (st === 0) { for (i = 0; i < 12; i++) yt[i] = y[i]; }
        else for (i = 0; i < 12; i++) {
          var a = 0;
          for (p = 0; p < st; p++) a += B[st][p] * k[p][i];
          yt[i] = y[i] + h * a;
        }
        deriv(yt, k[st]);
      }
      var err = 0;
      for (i = 0; i < 12; i++) {
        var s5 = 0, se = 0;
        for (p = 0; p < 6; p++) { s5 += C[p] * k[p][i]; se += DC[p] * k[p][i]; }
        y5[i] = y[i] + h * s5;
        var sc = Math.abs(y[i]) + Math.abs(h * k[0][i]) + 1e-30;
        err = Math.max(err, Math.abs(h * se) / sc);
      }
      return err;
    }
    /* Binding energy, not distance. "d > 4 x |r_j - r_k|" inverts at a close
       pass - the pair closes to ~1e-2 and the threshold falls with it - and on
       Burrau it fires at t=3.7, during the first collapse, naming the wrong
       body. Three conditions, all required, and generic over all three bodies:
       hard-coding the published escaper would hide a softening that changed
       it. */
    function escaped() {
      for (var i = 0; i < 3; i++) {
        var j = (i + 1) % 3, kk = (i + 2) % 3, mp = M[j] + M[kk];
        var px = (M[j]*y[4*j] + M[kk]*y[4*kk]) / mp;
        var py = (M[j]*y[4*j+1] + M[kk]*y[4*kk+1]) / mp;
        var pvx = (M[j]*y[4*j+2] + M[kk]*y[4*kk+2]) / mp;
        var pvy = (M[j]*y[4*j+3] + M[kk]*y[4*kk+3]) / mp;
        var dx = y[4*i] - px, dy = y[4*i+1] - py, d = Math.sqrt(dx*dx + dy*dy);
        if (d < FLOOR) continue;                       /* not far enough out */
        var wx = y[4*i+2] - pvx, wy = y[4*i+3] - pvy;
        if (dx*wx + dy*wy <= 0) continue;              /* not receding */
        var mu = M[i] * mp / (M[i] + mp);
        if (0.5*mu*(wx*wx + wy*wy) - M[i]*mp/d > 0) return true;   /* unbound */
      }
      return false;
    }
    this.H = 0.01;           /* the chunk handed to the adaptive stepper, not a
                                fixed step - it subdivides internally */
    this.RATE = 0.30;        /* resolution at t=61.4 (measured) -> ~205s a run.
                                At real-time scaling it would reseed every 60s
                                and the wipe would be the page's main event. */
    this.CAP = 40;
    this.FADE = 0.005;       /* slowest mover, so the longest memory */
    this.settle = 0;
    this.done = false;
    this.reset = function () {
      for (var i = 0; i < 12; i++) y[i] = R0[i];
      y[0] += seed * 1e-6;   /* each run perturbed on b1's x, so no two are the
                                same and the caption can say by how much */
      seed++;
      hh = 1e-4; prev = null; span = 3; this.done = false;
    };
    this.step = function (want) {
      var did = 0, guard = 0, i;
      while (did < want && guard++ < 4000) {
        if (hh > want - did) hh = want - did;
        var err = trial(hh);
        if (err > TOL && hh > 1e-13) { hh *= Math.max(0.1, 0.9 * Math.pow(TOL / err, 0.25)); continue; }
        for (i = 0; i < 12; i++) y[i] = y5[i];
        did += hh;
        hh *= Math.min(5, 0.9 * Math.pow(TOL / Math.max(err, 1e-18), 0.2));
        if (hh > 0.05) hh = 0.05;
      }
      if (escaped()) this.done = true;
    };
    this.frame = function () { };
    function frameFit() {
      var i, mx = 0;
      for (i = 0; i < 3; i++) mx = Math.max(mx, Math.abs(y[4*i]), Math.abs(y[4*i+1]));
      /* Scale against the WIDTH, not min(W,H). The visible canvas is shaped
         like an upside-down U - the hero band across the top, and the two
         margins down the sides - so a compact system fitted to the smaller
         dimension sits entirely behind the paper column and a reader sees one
         body peeking over the top. That is what min(W,H)/span did. Mapping the
         configuration's half-extent to 0.45W puts the bodies at +/-648px at
         1440, crossing both margins, which is what "the column occludes a
         larger drawing" needs the drawing to actually be. */
      span += (Math.max(1.5, Math.min(mx, 20)) - span) * 0.02;   /* slow follow */
      sx = 0.45 * W / span;
      ox = W / 2; oy = H / 2;
      /* radius = k * m^(1/3), computed rather than typed so the mass encoding
         cannot drift when someone resizes the dots. [5.77, 6.35, 6.84]. */
    }
    var COL3 = [ACC, MOSS, INK];
    function pts() {
      var i, p = [];
      for (i = 0; i < 3; i++) p.push([ox + y[4*i] * sx, oy - y[4*i+1] * sx]);
      return p;
    }
    this.trail = function (alpha) {
      frameFit();
      var i, pt = pts();
      if (prev) {
        /* 1.4 not 1.0: destination-out erodes an antialiased thin line's soft
           edges before its core, so a 1px diagonal breaks into dashes as it
           fades. A slightly fatter core outlives that. */
        bc.lineWidth = 1.4; bc.lineCap = 'round'; bc.globalAlpha = alpha;
        for (i = 0; i < 3; i++) {
          bc.strokeStyle = COL3[i];
          bc.beginPath(); bc.moveTo(prev[i][0], prev[i][1]); bc.lineTo(pt[i][0], pt[i][1]); bc.stroke();
        }
        bc.globalAlpha = 1;
      }
      prev = pt;
    };
    this.bodies = function (alpha) {
      var i, pt = pts();
      fc.globalAlpha = alpha;
      for (i = 0; i < 3; i++) { fc.fillStyle = COL3[i]; dot(fc, pt[i][0], pt[i][1], RAD[i]); }
      fc.globalAlpha = 1;
    };
    this.caption = 'Burrau’s three-body problem. Masses 3, 4 and 5.';
  }

  /* ==== choose ========================================================= */
  var KINDS = { pendulum: Pendulum, lorenz: Lorenz, threebody: ThreeBody };
  /* ?hero= pins the choice. Without it a screenshot diff is meaningless and the
     deslop rig measures a different system every run. */
  var want = (location.search.match(/[?&]hero=([a-z]+)/) || [])[1];
  var names = ['pendulum', 'lorenz', 'threebody'];
  var sys = new KINDS[KINDS[want] ? want : names[Math.floor(Math.random() * 3)]]();

  setErosion(sys.FADE);

  var cap = document.querySelector('.herocap');
  if (cap) cap.textContent = sys.caption;

  /* ==== sizing ========================================================= */
  /* Re-measured rather than inlined in resize(), because it has to happen
     again when the web font arrives. The block is anchored to the bottom, so
     if the caption re-wraps from one line to two after IBM Plex loads, the
     block grows UPWARD and a rect cached at load time leaves an uncleared
     strip along its top edge. Measured: the pendulum's caption is the one that
     wraps, and it was the only pin leaking ink into the block. */
  function measureFoot() {
    var hf = document.querySelector('.herofoot');
    footRect = null;
    if (hf && getComputedStyle(hf).position === 'fixed') {
      var fr = hf.getBoundingClientRect();
      if (fr.width > 0 && fr.height > 0) footRect = fr;
    }
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === W && h === H) return;
    W = w; H = h;
    /* Both canvases now take the device ratio, capped: TRAIL_DPR above records
       why the back one stopped being pinned to 1. */
    var lid = MAX_BACKING_W / W;
    fdpr = Math.min(window.devicePixelRatio || 1, 2, lid);
    var bdpr = Math.min(window.devicePixelRatio || 1, TRAIL_DPR, lid);
    back.width = Math.round(W * bdpr); back.height = Math.round(H * bdpr);
    front.width = Math.round(W * fdpr); front.height = Math.round(H * fdpr);
    /* The CSS size stays the full viewport either way: the browser scales the
       smaller backing store up, which is one composited blit rather than
       millions of extra rasterised pixels. */
    back.style.width = front.style.width = W + 'px';
    back.style.height = front.style.height = H + 'px';
    /* Both contexts still draw in CSS pixels - every routine in this file
       assumes that, and none of them change. */
    fc.setTransform(fdpr, 0, 0, fdpr, 0, 0);
    bc.setTransform(bdpr, 0, 0, bdpr, 0, 0);
    bc.clearRect(0, 0, W, H);              /* a stretched trail is a smear */
    /* The band is the whole first screen less the nav. Measured rather than
       computed from a constant, because the navband's height changes when the
       nav wraps - which it does at 390. The stylesheet keeps height:0 as the
       no-JS default; the band only exists when this file runs anyway.

       SETTING THIS IN THE HEAD SCRIPT INSTEAD DOES NOT HELP, and the reasoning
       that says it should is wrong about this page. The argument: hero-live is
       added here, after load, so the page paints with a zero-height band and
       then reflows the whole document when an ~823px block appears above it -
       a layout thrash on every load, and a good candidate for the 80-113ms
       single frames seen at t=0.
       Measured on 2026-09-07 and it does not happen. Cumulative layout shift
       is 0 before and 0 after moving the height into the blocking head script:
       0 shifts on two pins, one shift of 0.0002 on the third, either way. The
       reason is at the bottom of index.html - hero.js is a plain <script src>
       with no defer and no async, so it is parser-blocking and runs BEFORE the
       first paint. The band already has its height when the page first paints.
       There is no reflow to remove. The t=0 spikes are something else. */
    var nb = document.querySelector('.navband');
    var band = document.querySelector('.heroband');
    if (nb && band) band.style.height = Math.max(0, H - nb.getBoundingClientRect().height) + 'px';
    /* The caption/footer block's rectangle, cached HERE and not read per frame.
       It is position:fixed, so its box does not move while the page scrolls;
       re-reading getBoundingClientRect every frame would reintroduce exactly
       the per-frame layout read that made the clip experiment lose on
       2026-09-07. Null below 960, where the block is back in the flow and
       there is no canvas behind it to clear. */
    measureFoot();
    sys.frame();
  }

  /* ==== the loop ======================================================= */
  var still = document.documentElement.dataset.motion !== 'on';
  var running = false, raf = 0, last = 0, acc = 0, wipe = 0;
  var paper = document.querySelector('.paper');

  /* THE TRAIL FADES TOWARD TRANSPARENT, NOT TOWARD PAPER, and the difference is
     not stylistic. Painting translucent paper over the trail each frame - the
     obvious way, and what the first build did - never converges to paper,
     because a low-alpha fill is quantised hard by premultiplication: at alpha
     0.03 the stored alpha is 8/255, and the premultiplied blue of
     rgb(242,240,239) is round(239 * 8/255) = 7, which unpremultiplies to 223.
     Red and green round the other way, to 8. So the colour actually painted is
     not the colour asked for, and the canvas settles wherever that lands:
     measured, an opaque (242,240,224) over the whole viewport - a uniform
     yellow cast on every pixel, including corners no trail can reach, which is
     how it was told apart from trail residue.
     destination-out multiplies the destination's ALPHA by (1 - f) instead.
     Rounding there is strictly downward, so it converges cleanly to fully
     transparent and the page's own --bg shows through exactly. The trail is
     laid down at alpha 1, so its colour is never re-quantised on the way out.
     This is an eraser, not additive blending; nothing here sums.

     AND alpha:false DOES NOT RESCUE THE OTHER APPROACH. getContext('2d',
     {alpha:false}) would remove the per-pixel alpha-blend stages that show up
     in a software-raster profile, but destination-out needs an alpha channel
     to act on, so an opaque canvas would have to go back to painting --bg -
     the thing that does not converge. Measured 2026-09-07 in both Firefox and
     Chromium, 400 frames at f=0.03: the opaque canvas settles at (242,240,224)
     exactly as the transparent one does, because the quantisation is in the
     low-alpha SOURCE colour and not in the destination. Same failure, same
     yellow cast. So the back canvas keeps its alpha channel. */
  /* AND DO NOT CONFINE THE CANVAS TO THE HERO BAND EITHER, at least not for
     the reason it keeps getting proposed for. The argument is that a
     full-viewport fixed canvas rasterises far more than a band-sized one, so
     shrinking it to the band would cut the work sharply. That WAS true when
     the band was min(58vh, 460px) - about 43% of a 1080-tall screen. The
     2026-09-06 revision made the band the full viewport less the nav, and the
     premise was never rechecked against it.
     Once the band IS the viewport minus the nav, there is almost nothing to
     win. Built and measured on 2026-09-07 as variant 4a: 2.97 megapixels a
     frame against 3.20, about 7%, in exchange for losing the margin animation
     for the whole page - including on the arrival screen, where the two are
     visually near-identical because the band is 1003px of a 1080px viewport.
     Both variants pause after the band leaves and both pauses were proven by
     removing the observer and watching the drawing resume, so past that point
     they are the same page. 7% is not worth the design.
     If a loaded machine still struggles, MAX_BACKING_W is the lever, not the
     margins. */

  /* DO NOT CLIP THIS TO THE VISIBLE MARGINS. It is the obvious optimisation -
     the paper column hides 782 of 1440 pixels, 54% of every frame drawn,
     blended and uploaded to be covered by an opaque element - and it was tried
     on 2026-09-07 and measured WORSE: p95 19.0 -> 24.3ms and dropped frames
     1 -> 7 during a scroll, restored on revert.
     Two reasons, and the second is the one that matters.
     Cost: two getBoundingClientRect reads, two path builds and two
     non-rectangular clips per frame cost more than the fill they save, and a
     non-rectangular clip takes canvas off its fast path.
     AND THE OCCLUSION IS NOT PERMANENT, WHICH IS WHAT MAKES THE CHEAP VERSION
     IMPOSSIBLE. It looks static - a fixed column down the middle of a fixed
     canvas - but at the top of the page the hero band sits ABOVE .paper and
     the full width is visible; the column only closes over the middle once the
     reader has scrolled past the band. So the clip cannot be a constant. It
     has to read the rect every frame, which is where the cost came from.
     Anyone re-proposing this on the fill-savings argument alone has not
     checked the scroll-zero case. Measure with tests/test_scroll_jank.js
     --real before believing any of it. */
  function fadeBack(f) {
    bc.globalCompositeOperation = 'destination-out';
    bc.fillStyle = 'rgba(0,0,0,' + f + ')';
    bc.fillRect(0, 0, W, H);
    bc.globalCompositeOperation = 'source-over';
  }

  /* THE EROSION HAS AN 8-BIT FLOOR, AND BELOW ~0.02 IT STOPS ERODING WELL
     SHORT OF ZERO.

     destination-out multiplies the stored alpha, and BOTH alphas are 8-bit
     integers. The erasing alpha is quantised FIRST - f becomes
     round(f * 255) / 255 - and a pixel then stops changing once
     a * round(255f) / 255 rounds to nothing:

         floor = 255 / (2 * round(f * 255))

     Measured over 3000 frames on a solid patch with NO redrawing, identical
     in Firefox and Chromium:

         f        round(255f)   predicted   measured
         0.005        1           127.5       127
         0.0199       5            25.5        25
         0.02         5            25.5        25
         0.03         8            15.9        15

     IT IS NOT 0.5/f, which is what this comment claimed until the numbers
     were checked against it. That form ignores the quantisation of f and
     predicts 100 at f = 0.005 against the 127 measured; it only looks right
     when round(255f) is large, which is why it fitted 0.02 and 0.03 and
     missed 0.005 by 27%. A mechanism that cannot reproduce its own
     measurement is not pinned. This one reproduces all four.
     (Nor is the settling point explained by ink being re-laid over the same
     path: the probe fills once and never draws again.)

     WHAT IT COST: the three-body's FADE of 0.005 was chosen for "about twenty
     seconds of memory" and delivered unlimited memory at alpha 127 of 255,
     cleared only by the reseed wipe every ~205s. Its trails were never
     fading. That looked like long trails, which is what they were supposed to
     look like, which is why it survived four rounds of screenshots.

     THE FIX keeps the decay rate and lifts the per-application alpha over the
     floor: erode every Nth frame with the alpha that compounds to the same
     rate. 0.005 becomes 0.0199 every 4th frame - measured effective rate
     0.00501 against 0.00500, residue alpha 25 instead of 127. Visually, at
     t=60 on the three-body: identical geometry and coverage (4.3% of the
     canvas either way), mean ink darkness 67 -> 111 against paper. */
  var EROSION_MIN = 0.02;
  var erodeN = 1, erodeF = 0, erodeTick = 0;
  function setErosion(f) {
    if (f >= EROSION_MIN) { erodeN = 1; erodeF = f; return; }
    erodeN = Math.ceil(EROSION_MIN / f);
    erodeF = 1 - Math.pow(1 - f, erodeN);
  }
  function erode() {
    if (erodeTick++ % erodeN) return;
    fadeBack(erodeF);
  }

  /* The three-body resolves into a binary and an escaper and has to start
     again. A hard cut - trails gone, bodies suddenly elsewhere - is the one
     moment this reads as a page that crashed and reloaded, so the trails are
     washed out over 1.2s, held, and the run restarts perturbed. The ramp is on
     the EROSION CONSTANT, never on a blend mode, so trap 10 still cannot apply
     at the one moment somebody would reach for one. */
  var WIPE_OUT = 1.2, WIPE_HOLD = 1.4, WIPE_END = 1.6;
  function wipeAlpha() {
    if (wipe <= 0) return 1;
    if (wipe < WIPE_OUT) return 1 - wipe / WIPE_OUT;
    if (wipe < WIPE_HOLD) return 0;
    return (wipe - WIPE_HOLD) / (WIPE_END - WIPE_HOLD);
  }

  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min(now - last, CLAMP_MS) : NOMINAL_MS;
    last = now;

    if (wipe > 0) {
      wipe += dt * 0.001;
      /* The reseed ramp goes to 0.25, far above the floor, so it drives
         fadeBack directly rather than through the frame-skipping path. */
      fadeBack(wipe < WIPE_OUT ? sys.FADE + (0.25 - sys.FADE) * (wipe / WIPE_OUT) : 0.25);
      if (wipe >= WIPE_HOLD && sys.done) sys.reset();
      if (wipe >= WIPE_END) wipe = 0;
      fc.clearRect(0, 0, W, H);
      sys.bodies(wipeAlpha());
      raf = requestAnimationFrame(frame);
      return;
    }

    acc += dt * 0.001 * sys.RATE;
    var n = Math.min(Math.floor(acc / sys.H), sys.CAP);
    acc -= n * sys.H;
    if (n === sys.CAP) acc = 0;      /* debt dropped, never banked: catching up
                                        after a hitch is more visible than the
                                        missing time, and compounds under load */
    erode();
    fc.clearRect(0, 0, W, H);
    for (var i = 0; i < n; i++) { sys.step(sys.H); sys.trail(1); }
    sys.bodies(1);          /* once a frame: the front canvas was cleared once */
    /* Keep the animation out of the caption/footer block. A clearRect of one
       axis-aligned rectangle, not a clip: clipping was measured on 2026-09-07
       and lost, because a non-rectangular clip path takes canvas off its fast
       path. Both canvases - the back one accumulates and would fill straight
       back in next frame, and the front one can have a body inside the rect.
       THE STYLESHEET CANNOT VERIFY THIS. _deslop/measure.js resolves
       backgrounds through getComputedStyle and reports 0 AA failures whether
       this works or is deleted; the check that can see it samples rendered
       pixels (_deslop/ground.js). */
    if (footRect) {
      bc.clearRect(footRect.x, footRect.y, footRect.width, footRect.height);
      fc.clearRect(footRect.x, footRect.y, footRect.width, footRect.height);
    }
    if (sys.done) wipe = 1e-6;
    raf = requestAnimationFrame(frame);
  }

  /* transitionend is not guaranteed - an interrupted transition never fires
     it - so the stop is also armed on a timer, and whichever arrives first
     wins. Stopping late costs a few frames; not stopping at all is the bug. */
  var fadeT = 0;
  function hide() {
    document.body.classList.add('hero-idle');
    clearTimeout(fadeT);
    fadeT = setTimeout(stop, 380);
  }
  function show() {
    clearTimeout(fadeT);
    document.body.classList.remove('hero-idle');
    start();
  }

  function start() {
    if (running || still) return;
    running = true;
    last = 0;                 /* the sentinel's other half: a resumed tab must
                                 not hand the accumulator the time it slept */
    acc = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  /* One settled frame for a reader who asked for less motion - and the same
     path gives the Lorenz its transient discard. Integrate without drawing,
     then lay down enough trail that the still frame is a trajectory and not a
     dot: an arc, a wing, three tracks. */
  function settle(units) {
    var n = Math.min(Math.round(units / sys.H), 20000);
    for (var i = 0; i < n; i++) sys.step(sys.H);
  }
  function stillFrame() {
    bc.clearRect(0, 0, W, H);
    fc.clearRect(0, 0, W, H);
    settle(sys.settle);
    var n = Math.min(Math.round(2.5 / sys.H), 4000);
    for (var i = 0; i < n; i++) { sys.step(sys.H); sys.trail(1); }
    sys.bodies(1);
  }

  /* The loop may pause when the hero band leaves the viewport ONLY where the
     paper column is full-bleed, because that is exactly when no pixel of the
     canvas is still visible. Above the breakpoint the margins are showing and a
     stopped loop freezes visible pixels mid-scroll, which reads as a crash. The
     paper's own width is the gate - a second copy of 960 in here is the
     duplicated constant that goes stale (trap 15). */
  var io = null;
  function observe() {
    /* 4b: no `covered` guard, and no hard stop. When the band leaves, the
       canvas FADES to nothing over 300ms and the loop stops when it gets
       there; scrolling back up restarts it and fades it in. The full-viewport
       canvas and the arrival are untouched, so the margins still animate
       beside the top of the column - the cost only appears once the reader has
       left the hero behind. */
    if (io) { io.disconnect(); io = null; }
    if ('IntersectionObserver' in window) {
      var band = document.querySelector('.heroband');
      if (band) {
        io = new IntersectionObserver(function (e) {
          if (e[0].isIntersecting) show(); else hide();
        }, { threshold: 0 });
        io.observe(band);
        return;
      }
    }
    show();
  }

  /* ==== wiring ========================================================= */
  document.body.classList.add('hero-live');
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureFoot);
  sys.reset();
  if (sys.settle) settle(sys.settle);

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      resize();
      if (still) stillFrame(); else observe();
    }, 180);
  });

  if (still) stillFrame(); else observe();

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else if (!still) observe();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); stillFrame(); } else observe();
  });
}());
