/* The home page's hero: one of three nonlinear systems, integrated live.
 *
 * Double pendulum, Lorenz attractor, or Burrau's three-body problem - one
 * picked at random per load, or forced with ?hero=pendulum|lorenz|threebody.
 * Nothing is a video, nothing is a data file, nothing comes from a CDN: the
 * equations are four to eight lines each and the trajectory is computed as you
 * watch. That is the whole argument for it being here - a figure a reader can
 * see being computed, rather than a picture of one.
 *
 * It is NOT the energy model, and every caption says so. A picture of a
 * nonlinear system on a page about energy modelling is a metaphor, and the
 * captions are what keep it from pretending otherwise (DESLOP_AUDIT F6: an
 * unlabelled background made from real data is still decoration).
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

  var CLAMP_MS = 50;                    /* hero.js 2a99923 used this; keep it */
  var NOMINAL_MS = 16;                  /* one 60Hz frame, for the first frame */

  var W = 0, H = 0, fdpr = 1;

  function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }

  /* ==== the three systems ==============================================
   * Each exposes: reset(), frame(), step(h), draw(alpha), and the constants
   * H (step), RATE (system time per wall second), CAP (steps a frame may take),
   * FADE (the trail's erosion per frame), settle (units to run undrawn), and a
   * caption.
   *
   * FADE IS PER SYSTEM. The erosion is per frame but the drawing rate is per
   * unit of system time, so one constant gives the fast system a long arc and
   * the slow one a stub that washes out before it grows. A trail survives about
   * 1/FADE frames, so these are roughly 3s, 5s and 20s of memory - chosen so
   * each system shows a comparable LENGTH of trajectory, not a comparable
   * duration. */

  /* ---- 1. double pendulum --------------------------------------------- */
  function Pendulum() {
    var M1 = 1, M2 = 1, L1 = 1, L2 = 1, G = 9.81;
    var s = [2, 2, 0, 0];
    var k1 = [0,0,0,0], k2 = [0,0,0,0], k3 = [0,0,0,0], k4 = [0,0,0,0], t = [0,0,0,0];
    var px = 0, py = 0, scale = 1, prev = null;

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
    this.reset = function () { s = [2, 2, 0, 0]; prev = null; };
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
      var i;
      f(s, k1);
      for (i = 0; i < 4; i++) t[i] = s[i] + 0.5 * h * k1[i];
      f(t, k2);
      for (i = 0; i < 4; i++) t[i] = s[i] + 0.5 * h * k2[i];
      f(t, k3);
      for (i = 0; i < 4; i++) t[i] = s[i] + h * k3[i];
      f(t, k4);
      for (i = 0; i < 4; i++) s[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    };
    this.draw = function (alpha) {
      var x1 = px + scale * L1 * Math.sin(s[0]), y1 = py + scale * L1 * Math.cos(s[0]);
      var x2 = x1 + scale * L2 * Math.sin(s[1]), y2 = y1 + scale * L2 * Math.cos(s[1]);
      if (prev) {                                   /* the lower bob's trail */
        bc.strokeStyle = ACC; bc.lineWidth = 1.6; bc.lineCap = 'round';
        bc.globalAlpha = alpha;
        bc.beginPath(); bc.moveTo(prev[0], prev[1]); bc.lineTo(x2, y2); bc.stroke();
        bc.globalAlpha = 1;
      }
      prev = [x2, y2];
      fc.globalAlpha = alpha;
      fc.strokeStyle = INK; fc.lineCap = 'round'; fc.lineJoin = 'round';
      fc.lineWidth = 1.6;
      fc.beginPath(); fc.moveTo(px, py); fc.lineTo(x1, y1); fc.stroke();
      fc.lineWidth = 1.3;
      fc.beginPath(); fc.moveTo(x1, y1); fc.lineTo(x2, y2); fc.stroke();
      fc.fillStyle = RULE; dot(fc, px, py, 3);
      fc.fillStyle = INK;  dot(fc, x1, y1, 6); dot(fc, x2, y2, 5);
      fc.globalAlpha = 1;
    };
    this.caption = 'Double pendulum. Two 1 kg masses on 1 m rods, released from '
      + 'rest at θ₁ = θ₂ = 2.00 rad, g = 9.81 m s⁻². Integrated in your browser, '
      + 'Runge–Kutta 4 at a 1 ms step. A picture of a nonlinear system, not of the '
      + 'energy model.';
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
    this.draw = function (alpha) {
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
      fc.globalAlpha = alpha;
      fc.fillStyle = INK; dot(fc, x, y, 3.5);
      fc.globalAlpha = 1;
    };
    this.caption = 'Lorenz attractor, 1963. σ = 10, ρ = 28, β = 8/3, from '
      + '(x, y, z) = (0, 1, 0), with the first 20 time units of transient '
      + 'integrated but not drawn, projected on the x–z plane. Integrated in your '
      + 'browser, Runge–Kutta 4 at h = 0.004. A picture of a nonlinear system, not '
      + 'of the energy model.';
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
    this.draw = function (alpha) {
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
      var col = [ACC, MOSS, INK], rad = [3.6, 4.0, 4.3];   /* radius ~ m^(1/3) */
      var pt = [];
      for (i = 0; i < 3; i++) pt.push([ox + y[4*i] * sx, oy - y[4*i+1] * sx]);
      if (prev) {
        /* 1.4 not 1.0: destination-out erodes an antialiased thin line's soft
           edges before its core, so a 1px diagonal breaks into dashes as it
           fades. A slightly fatter core outlives that. */
        bc.lineWidth = 1.4; bc.lineCap = 'round'; bc.globalAlpha = alpha;
        for (i = 0; i < 3; i++) {
          bc.strokeStyle = col[i];
          bc.beginPath(); bc.moveTo(prev[i][0], prev[i][1]); bc.lineTo(pt[i][0], pt[i][1]); bc.stroke();
        }
        bc.globalAlpha = 1;
      }
      prev = pt;
      fc.globalAlpha = alpha;
      for (i = 0; i < 3; i++) { fc.fillStyle = col[i]; dot(fc, pt[i][0], pt[i][1], rad[i]); }
      fc.globalAlpha = 1;
    };
    this.caption = 'Burrau’s three-body problem, 1913. Masses 3, 4 and 5 released '
      + 'from rest at the vertices of a 3–4–5 triangle. Integrated in your browser, '
      + 'adaptive Runge–Kutta, softened at 10⁻⁶ so a close pass cannot break the '
      + 'step. In this integration the 3 and the 4 pair off and the 5 is thrown clear '
      + 'at t = 61, which is the published outcome; it then fades and starts again '
      + 'perturbed by 10⁻⁶. A picture of a nonlinear system, not of the energy model.';
  }

  /* ==== choose ========================================================= */
  var KINDS = { pendulum: Pendulum, lorenz: Lorenz, threebody: ThreeBody };
  /* ?hero= pins the choice. Without it a screenshot diff is meaningless and the
     deslop rig measures a different system every run. */
  var want = (location.search.match(/[?&]hero=([a-z]+)/) || [])[1];
  var names = ['pendulum', 'lorenz', 'threebody'];
  var sys = new KINDS[KINDS[want] ? want : names[Math.floor(Math.random() * 3)]]();

  var cap = document.querySelector('.herocap');
  if (cap) cap.textContent = sys.caption;

  /* ==== sizing ========================================================= */
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === W && h === H) return;
    W = w; H = h;
    fdpr = Math.min(window.devicePixelRatio || 1, 2);
    /* The back canvas stays at dpr 1: its whole-surface erosion is the dominant
       per-frame cost (5.2M device pixels at dpr 2 on a 1440x900 screen against
       1.3M at 1) and a trail is soft anyway. The front canvas, which carries
       the crisp rods and discs, gets the real ratio. */
    back.width = W; back.height = H;
    back.style.width = front.style.width = W + 'px';
    back.style.height = front.style.height = H + 'px';
    front.width = Math.round(W * fdpr); front.height = Math.round(H * fdpr);
    fc.setTransform(fdpr, 0, 0, fdpr, 0, 0);
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.clearRect(0, 0, W, H);              /* a stretched trail is a smear */
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
     This is an eraser, not additive blending; nothing here sums. */
  function fadeBack(f) {
    bc.globalCompositeOperation = 'destination-out';
    bc.fillStyle = 'rgba(0,0,0,' + f + ')';
    bc.fillRect(0, 0, W, H);
    bc.globalCompositeOperation = 'source-over';
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
      fadeBack(wipe < WIPE_OUT ? sys.FADE + (0.25 - sys.FADE) * (wipe / WIPE_OUT) : 0.25);
      if (wipe >= WIPE_HOLD && sys.done) sys.reset();
      if (wipe >= WIPE_END) wipe = 0;
      fc.clearRect(0, 0, W, H);
      sys.draw(wipeAlpha());
      raf = requestAnimationFrame(frame);
      return;
    }

    acc += dt * 0.001 * sys.RATE;
    var n = Math.min(Math.floor(acc / sys.H), sys.CAP);
    acc -= n * sys.H;
    if (n === sys.CAP) acc = 0;      /* debt dropped, never banked: catching up
                                        after a hitch is more visible than the
                                        missing time, and compounds under load */
    fadeBack(sys.FADE);
    fc.clearRect(0, 0, W, H);
    for (var i = 0; i < n; i++) { sys.step(sys.H); sys.draw(1); }
    if (!n) sys.draw(1);
    if (sys.done) wipe = 1e-6;
    raf = requestAnimationFrame(frame);
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
    for (var i = 0; i < n; i++) { sys.step(sys.H); sys.draw(1); }
  }

  /* The loop may pause when the hero band leaves the viewport ONLY where the
     paper column is full-bleed, because that is exactly when no pixel of the
     canvas is still visible. Above the breakpoint the margins are showing and a
     stopped loop freezes visible pixels mid-scroll, which reads as a crash. The
     paper's own width is the gate - a second copy of 960 in here is the
     duplicated constant that goes stale (trap 15). */
  var io = null;
  function observe() {
    var covered = paper && paper.getBoundingClientRect().width >= window.innerWidth - 1;
    if (io) { io.disconnect(); io = null; }
    if (covered && 'IntersectionObserver' in window) {
      var band = document.querySelector('.heroband');
      if (band) {
        io = new IntersectionObserver(function (e) {
          if (e[0].isIntersecting) start(); else stop();
        }, { threshold: 0 });
        io.observe(band);
        return;
      }
    }
    start();
  }

  /* ==== wiring ========================================================= */
  document.body.classList.add('hero-live');
  resize();
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
