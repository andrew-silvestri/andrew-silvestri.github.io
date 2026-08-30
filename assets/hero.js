/* Front-page hero: the calibrated model on a rotating globe.
 *
 * Two stacked canvases. The back one carries flow trails and is faded rather
 * than cleared each frame, which is what makes the streamlines read as motion
 * instead of dots. The front one is cleared and redrawn, so coastlines and
 * nodes stay crisp instead of smearing into the trails.
 *
 * Everything drawn is real: coastlines from the country polygon set, and the
 * of the model's 7,192 nodes at their recorded coordinates. Nothing is placed
 * for looks.
 *
 * Degrades in three steps. No canvas support, or no data: the block stays
 * empty and the page reads normally. Reduced-motion preference: one static
 * frame, no animation loop. Off-screen: the loop pauses.
 */
(function () {
  var host = document.getElementById('hero');
  if (!host || !window.HERO) return;

  var flow = document.createElement('canvas');
  var globe = document.createElement('canvas');
  flow.className = 'hero-layer';
  globe.className = 'hero-layer';
  host.appendChild(flow);
  host.appendChild(globe);

  var fc = flow.getContext && flow.getContext('2d');
  var gc = globe.getContext && globe.getContext('2d');
  if (!fc || !gc) return;

  var D = window.HERO;
  var RAD = Math.PI / 180;
  /* The contract, not the media query: prefers-reduced-motion is only the
     default behind this attribute, and the footer control overrides it. */
  var still = document.documentElement.dataset.motion !== 'on';

  /* node colours by kind, in the order build_hero.py wrote them */
  var COLOR = {
    station:  [139, 127, 242],
    event:    [216, 106, 134],
    grid:     [ 90, 168, 216],
    supply:   [111, 127, 216],
    district: [ 92, 106, 140],
    consumer: [139, 147, 176],
    market:   [207, 214, 240],
    climate:  [207, 214, 240],
    sun:        [242, 217, 139],
    insolation: [232, 201, 143],
    weather:    [ 79, 157, 132]
  };
  var kindColor = D.kinds.map(function (k) {
    return COLOR[k] || [160, 160, 160];
  });
  var kindSize = D.kinds.map(function (k) {
    return k === 'event' ? 1.25 : k === 'grid' ? 1.15
         : k === 'market' || k === 'climate' ? 1.8 : 0.95;
  });

  var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;

  function resize() {
    var box = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(240, box.width);
    H = Math.max(240, box.height);
    [flow, globe].forEach(function (c) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gc.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.42;
    cx = W / 2;
    cy = H / 2;
    fc.clearRect(0, 0, W, H);
    seed();
  }

  /* ---- orthographic projection ---------------------------------------- */
  var rot = 0;                         // current longitude at centre
  var TILT = 16 * RAD;                 // a little north-up tilt
  var sinT = Math.sin(TILT), cosT = Math.cos(TILT);

  function project(lon, lat, out) {
    var la = lat * RAD, lo = (lon - rot) * RAD;
    var cl = Math.cos(la);
    var x = cl * Math.sin(lo);
    var y = Math.sin(la);
    var z = cl * Math.cos(lo);
    var y2 = y * cosT - z * sinT;
    var z2 = y * sinT + z * cosT;
    out[0] = cx + R * x;
    out[1] = cy - R * y2;
    out[2] = z2;                       // >0 means facing us
    return out;
  }

  /* ---- a smooth pseudo-wind field -------------------------------------
   * Not a physical model and not claimed to be one. Zonal flow that reverses
   * with latitude, plus a few travelling waves, which is enough to produce
   * the banded, eddying look that real wind has.                          */
  function field(lon, lat, t, out) {
    var la = lat * RAD, lo = lon * RAD;
    var zonal = 5.2 * Math.cos(2.4 * la) + 1.6 * Math.sin(3.1 * la);
    var wave = 1.5 * Math.sin(3 * lo + 1.3 * t + 2.0 * la)
             + 1.1 * Math.sin(5 * lo - 0.9 * t - 1.4 * la);
    var merid = 1.25 * Math.sin(2 * lo - 0.7 * t) * Math.cos(la)
              + 0.7 * Math.cos(4 * lo + 0.5 * t) * Math.cos(2 * la);
    var shrink = Math.max(Math.cos(la), 0.18);   // degrees per unit near poles
    out[0] = (zonal + wave) / shrink;
    out[1] = merid;
    return out;
  }

  /* ---- particles ------------------------------------------------------- */
  var N = 0, px = null, py = null, age = null, life = null;

  function seed() {
    N = Math.round(Math.min(1400, Math.max(420, (W * H) / 620)));
    px = new Float32Array(N);
    py = new Float32Array(N);
    age = new Float32Array(N);
    life = new Float32Array(N);
    for (var i = 0; i < N; i++) respawn(i, true);
  }

  function respawn(i, spread) {
    px[i] = Math.random() * 360 - 180;
    // area-correct latitude, so particles do not bunch at the poles
    py[i] = Math.asin(Math.random() * 2 - 1) / RAD;
    life[i] = 90 + Math.random() * 150;
    age[i] = spread ? Math.random() * life[i] : 0;
  }

  /* ---- drawing --------------------------------------------------------- */
  var p0 = [0, 0, 0], p1 = [0, 0, 0], v = [0, 0];

  function drawFlow(dt, t) {
    // fade rather than clear: this is the trail
    fc.globalCompositeOperation = 'destination-out';
    fc.fillStyle = 'rgba(0,0,0,0.032)';
    fc.fillRect(0, 0, W, H);
    fc.globalCompositeOperation = 'source-over';
    fc.lineWidth = 1.9;
    fc.lineCap = 'round';

    for (var i = 0; i < N; i++) {
      var lon = px[i], lat = py[i];
      field(lon, lat, t, v);
      var nlon = lon + v[0] * dt;
      var nlat = lat + v[1] * dt;
      if (nlat > 84) { nlat = 84; }
      if (nlat < -84) { nlat = -84; }
      if (nlon > 180) nlon -= 360;
      if (nlon < -180) nlon += 360;

      project(lon, lat, p0);
      project(nlon, nlat, p1);
      var wrapped = Math.abs(p1[0] - p0[0]) > R;
      if (p0[2] > 0.02 && p1[2] > 0.02 && !wrapped) {
        // fade at the limb and with age, so trails are born and die softly
        var limb = Math.min(1, p0[2] * 2.4);
        var a = age[i] / life[i];
        var envelope = Math.sin(Math.PI * Math.min(a, 1));
        var alpha = 0.78 * limb * envelope;
        if (alpha > 0.004) {
          // born violet (--acc), fades to cool blue (--cool) as it ages -
          // the same head-to-tail story as the GL path's per-vertex gradient
          var tr = Math.round(90 + (139 - 90) * (1 - a));
          var tg = Math.round(168 + (127 - 168) * (1 - a));
          var tb = Math.round(216 + (242 - 216) * (1 - a));
          fc.strokeStyle = 'rgba(' + tr + ',' + tg + ',' + tb + ',' + alpha.toFixed(3) + ')';
          fc.beginPath();
          fc.moveTo(p0[0], p0[1]);
          fc.lineTo(p1[0], p1[1]);
          fc.stroke();
        }
      }
      px[i] = nlon;
      py[i] = nlat;
      age[i] += dt * 60;
      if (age[i] > life[i]) respawn(i, false);
    }
  }

  function drawGlobe() {
    gc.clearRect(0, 0, W, H);

    // the sphere itself, lit from upper left
    var g = gc.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.06,
                                    cx, cy, R * 1.02);
    g.addColorStop(0, 'rgba(30,40,74,0.95)');
    g.addColorStop(0.55, 'rgba(13,18,38,0.95)');
    g.addColorStop(1, 'rgba(5,7,15,0.98)');
    gc.beginPath();
    gc.arc(cx, cy, R, 0, 6.2832);
    gc.fillStyle = g;
    gc.fill();

    // coastlines
    gc.lineWidth = 0.72;
    gc.strokeStyle = 'rgba(110,150,200,0.5)';
    var coast = D.coast, pt = [0, 0, 0], prev = null;
    for (var r = 0; r < coast.length; r++) {
      var ring = coast[r];
      gc.beginPath();
      prev = null;
      for (var i = 0; i < ring.length; i++) {
        project(ring[i][0], ring[i][1], pt);
        if (pt[2] <= 0) { prev = null; continue; }
        if (prev === null) gc.moveTo(pt[0], pt[1]);
        else gc.lineTo(pt[0], pt[1]);
        prev = 1;
      }
      gc.stroke();
    }

    // nodes - each entry is [lon, lat, kindIndex], same nested-array shape
    // D.coast already uses below, not a flat lon/lat/kind run
    var nodes = D.nodes;
    for (var k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      project(n[0], n[1], pt);
      if (pt[2] <= 0.015) continue;
      var ki = n[2];
      var c = kindColor[ki];
      var limb = Math.min(1, pt[2] * 2.2);
      gc.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ','
                   + (0.85 * limb).toFixed(3) + ')';
      gc.beginPath();
      gc.arc(pt[0], pt[1], kindSize[ki] * (0.7 + 0.5 * limb), 0, 6.2832);
      gc.fill();
    }

    // limb glow, drawn last so it sits over everything
    var rim = gc.createRadialGradient(cx, cy, R * 0.93, cx, cy, R * 1.12);
    rim.addColorStop(0, 'rgba(120,140,230,0)');
    rim.addColorStop(0.55, 'rgba(120,140,230,0.15)');
    rim.addColorStop(1, 'rgba(120,140,230,0)');
    gc.beginPath();
    gc.arc(cx, cy, R * 1.12, 0, 6.2832);
    gc.fillStyle = rim;
    gc.fill();
  }

  /* ---- loop ------------------------------------------------------------ */
  var last = 0, t = 0, running = false, raf = 0;

  function frame(now) {
    if (!running) return;
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    t += dt;
    rot = (rot + dt * 2.6) % 360;
    drawFlow(dt, t);
    drawGlobe();
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

  /* The WebGL path upgrades this hero when three.js arrives. It needs a way to
     stop this loop rather than leave two renderers running over each other. */
  window.HERO2D = { start: start, stop: stop };

  resize();
  drawGlobe();

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); drawGlobe(); }, 180);
  });

  if (still) {
    // one static pass so the hero is not an empty circle
    for (var s = 0; s < 90; s++) drawFlow(0.016, s * 0.016);
    drawGlobe();
    return;
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? start() : stop();
    }, { threshold: 0.02 }).observe(host);
  } else {
    start();
  }
  document.addEventListener('visibilitychange', function () {
    document.hidden ? stop() : start();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on';
    if (still) { stop(); } else { start(); }
  });
})();
