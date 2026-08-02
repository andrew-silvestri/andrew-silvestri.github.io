/* The world energy model — atlas application.
 *
 * Six of the seven layers live on a globe. The seventh, behaviour, lives in a
 * brain, because that is where the model says demand is decided and a map is
 * the wrong container for it.
 *
 * The propagation engine below is carried over unchanged from the previous
 * atlas. Only the presentation was rebuilt. Any run here returns the same
 * numbers the old flat-map version returned, which is checked by
 * test_atlas_engine.js against an independent Python implementation.
 */
(function () {
  'use strict';
  var D = window.ATLAS, THREE = window.THREE;
  var $ = function (id) { return document.getElementById(id); };

  if (!D) return;
  if (!THREE) { $('nogl').style.display = 'grid'; return; }

  /* ================================================================= data */
  var N = D.n;

  /* Provenance is dictionary-encoded: twenty thousand plants share a few
     thousand distinct source strings, and storing one copy each rather than
     one copy per node is two thirds of the payload. Read through an accessor
     so nothing downstream has to know. */
  function srcOf(i) {
    if (!D.srcDict) return D.src[i] || '';
    return D.srcDict[D.src[i]] || '';
  }
  var MW = D.mw ? Float64Array.from(D.mw) : null;
  var ES = Int32Array.from(D.es), ET = Int32Array.from(D.et);
  var EW = Float64Array.from(D.ew), RES = Float64Array.from(D.res);
  var steps = 0, state = null, hit = null, shocks = {};

  /* ============================================== the propagation engine ==
   * Unchanged from the previous atlas. lam is the relaxation rate; a node's
   * resilience damps what reaches it; tanh keeps every value inside (-1, 1)
   * so nothing can run away. Sixty rounds is a ceiling, not a target — most
   * scenarios settle in well under twenty.                                */
  function propagate(sh) {
    var b = new Float64Array(N);
    for (var k in sh) b[k] = sh[k];
    var s = Float64Array.from(b), lam = 0.55;
    var fh = new Int16Array(N).fill(-1);
    for (var i = 0; i < N; i++) if (Math.abs(s[i]) >= 0.02) fh[i] = 0;
    var last = 0;
    for (var r = 1; r <= 60; r++) {
      var inf = new Float64Array(N);
      for (var e = 0; e < ES.length; e++) inf[ET[e]] += EW[e] * s[ES[e]];
      var sn = new Float64Array(N), mx = 0;
      for (i = 0; i < N; i++) {
        sn[i] = (1 - lam) * s[i] + lam * Math.tanh(b[i] + (1 - RES[i]) * inf[i]);
        if (fh[i] < 0 && Math.abs(sn[i]) >= 0.02) fh[i] = r;
        var d = Math.abs(sn[i] - s[i]);
        if (d > mx) mx = d;
      }
      s = sn; last = r;
      if (mx < 1e-5) break;
    }
    steps = last;
    return [s, fh];
  }
  function touched(s) {
    var c = 0;
    for (var i = 0; i < N; i++) if (Math.abs(s[i]) >= 0.02) c++;
    return c;
  }
  window.__atlasEngine = { propagate: propagate, touched: touched,
                           getSteps: function () { return steps; } };

  /* A handle for the test harness. It is attached before the renderer is
     built, because the checks that matter - the data is global, the filter
     hides what it says it hides - are true whether or not there is a GPU, and
     a harness that can only run with one is a harness that does not run. */
  window.__atlas = {
    D: D, N: N, srcOf: srcOf,
    weightOf: function (i) { return weightOf(i); },
    visible: function (i) { return visible(i); },
    setMin: function (v) { minW = v; if (typeof applyFilter === 'function') applyFilter(); },
    getMin: function () { return minW; }
  };

  /* =============================================================== scene */
  var view = $('view'), canvas = $('gl');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true,
                                         alpha: true });
  } catch (err) { $('nogl').style.display = 'grid'; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);
  var globeGrp = new THREE.Group(), brainGrp = new THREE.Group();
  scene.add(globeGrp); scene.add(brainGrp);
  brainGrp.visible = false;

  var KCOL = {
    market: 0xcfd6f0, climate: 0xdfe4f8, grid: 0x5aa8d8, supply: 0x6f7fd8,
    district: 0x5c6a8c, consumer: 0x8b93b0, event: 0xd86a86,
    station: 0x8b7ff2, psych: 0xa98fd8
  };
  var KNAME = {
    market: 'price benchmark', climate: 'climate system', grid: 'power system',
    supply: 'fuel supply', district: 'district', consumer: 'consumer group',
    event: 'recorded event', station: 'power station',
    psych: 'behaviour channel'
  };
  var RAD = Math.PI / 180;

  function lonlat(lon, lat, r) {
    var la = lat * RAD, lo = lon * RAD, cl = Math.cos(la);
    return new THREE.Vector3(r * cl * Math.sin(lo), r * Math.sin(la),
                             r * cl * Math.cos(lo));
  }

  /* ---- globe body ---- */
  globeGrp.add(new THREE.Mesh(new THREE.SphereGeometry(1, 72, 54),
    new THREE.MeshBasicMaterial({ color: 0x0b1226 })));
  globeGrp.add(new THREE.Mesh(new THREE.SphereGeometry(1.05, 72, 54),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { c: { value: new THREE.Color(0x6f8ae0) } },
      vertexShader: 'varying float i;void main(){vec3 n=normalize(normalMatrix*normal);' +
        'vec4 mv=modelViewMatrix*vec4(position,1.);' +
        'i=pow(1.0-abs(dot(n,normalize(-mv.xyz))),2.8);' +
        'gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'uniform vec3 c;varying float i;' +
        'void main(){gl_FragColor=vec4(c,i*0.8);}'
    })));

  var cpos = [];
  D.coast.forEach(function (ring) {
    for (var i = 0; i < ring.length - 1; i++) {
      var a = lonlat(ring[i][0], ring[i][1], 1.003);
      var b = lonlat(ring[i + 1][0], ring[i + 1][1], 1.003);
      if (a.distanceTo(b) > 0.5) continue;
      cpos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  var cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
  globeGrp.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({
    color: 0x6f8ab4, transparent: true, opacity: 0.44 })));

  // graticule, every 30 degrees, so rotation is readable
  var gpos = [];
  for (var g = -150; g <= 180; g += 30) {
    for (var la = -80; la < 80; la += 5) {
      var a1 = lonlat(g, la, 1.001), b1 = lonlat(g, la + 5, 1.001);
      gpos.push(a1.x, a1.y, a1.z, b1.x, b1.y, b1.z);
    }
  }
  for (var lat2 = -60; lat2 <= 60; lat2 += 30) {
    for (var lo = -180; lo < 180; lo += 5) {
      var a2 = lonlat(lo, lat2, 1.001), b2 = lonlat(lo + 5, lat2, 1.001);
      gpos.push(a2.x, a2.y, a2.z, b2.x, b2.y, b2.z);
    }
  }
  var gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  globeGrp.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({
    color: 0x2a3352, transparent: true, opacity: 0.5 })));

  /* ---- a schematic brain, built rather than traced ----------------------
   * An ellipsoid with a midline fissure and a few folds, plus a cerebellum
   * and a stem. It is a solid that reads as a brain at a glance; it is not
   * anatomy and the page says so. The six channels sit at defensible
   * positions inside it.                                                   */
  function brainMesh() {
    var geo = new THREE.SphereGeometry(1, 96, 72);
    var p = geo.attributes.position, v = new THREE.Vector3();
    for (var i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      var x = v.x, y = v.y, z = v.z;
      v.set(x * 0.80, y * 0.74, z * 1.02);
      // gyri: a few high-frequency terms, damped near the midline
      var f = 0.030 * Math.sin(9.0 * x + 3.1 * z) * Math.cos(7.5 * y)
            + 0.024 * Math.sin(11.0 * z - 4.0 * y)
            + 0.018 * Math.cos(13.0 * y + 5.0 * x);
      var away = Math.min(1, Math.abs(x) / 0.22);
      v.multiplyScalar(1 + f * away);
      // longitudinal fissure
      var mid = Math.exp(-(x * x) / 0.0022);
      v.multiplyScalar(1 - 0.085 * mid * Math.max(0, y));
      // occipital taper and frontal narrowing
      v.z *= 1 - 0.10 * Math.max(0, -z);
      v.x *= 1 - 0.16 * Math.max(0, z) * Math.max(0, z);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }
  var brainMat = new THREE.MeshLambertMaterial({
    color: 0x6a5f96, transparent: true, opacity: 0.34, side: THREE.DoubleSide,
    depthWrite: false });
  brainGrp.add(new THREE.Mesh(brainMesh(), brainMat));
  brainGrp.add(new THREE.LineSegments(
    new THREE.WireframeGeometry(brainMesh()),
    new THREE.LineBasicMaterial({ color: 0x9d86d8, transparent: true,
                                  opacity: 0.05 })));
  var cere = new THREE.Mesh(new THREE.SphereGeometry(0.34, 40, 28), brainMat);
  cere.position.set(0, -0.50, -0.62); cere.scale.set(1.25, 0.72, 0.90);
  brainGrp.add(cere);
  var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.62, 20),
                            brainMat);
  stem.position.set(0, -0.62, -0.20); stem.rotation.x = 0.42;
  brainGrp.add(stem);
  brainGrp.add(new THREE.AmbientLight(0xffffff, 0.55));
  var dl = new THREE.DirectionalLight(0xc8d4ff, 0.9);
  dl.position.set(2, 3, 4); brainGrp.add(dl);

  /* ---- node points, one object per tab ---- */
  var sprite = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g2 = c.getContext('2d');
    var rg = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = rg; g2.fillRect(0, 0, 64, 64);
    var t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  })();

  var tabIdx = [];                       // tabIdx[t] = [node indices]
  for (var t = 0; t < D.tabs.length; t++) tabIdx.push([]);
  for (var i2 = 0; i2 < N; i2++) tabIdx[D.tab[i2]].push(i2);

  var layers = tabIdx.map(function (idxs, ti) {
    var pos = new Float32Array(idxs.length * 3);
    var col = new Float32Array(idxs.length * 3);
    var siz = new Float32Array(idxs.length);
    var c = new THREE.Color();
    idxs.forEach(function (n, j) {
      var v;
      if (ti === 6) {
        var br = null;
        for (var b = 0; b < D.brain.length; b++) if (D.brain[b].i === n) br = D.brain[b];
        var xyz = br ? br.xyz : [0, 0, 0];
        v = new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
      } else {
        v = lonlat(D.lon[n], D.lat[n], 1.012);
      }
      pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
      c.setHex(KCOL[D.kinds[D.kind[n]]] || 0xaaaaaa);
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
      var k = D.kinds[D.kind[n]];
      siz[j] = k === 'station' ? 15 : k === 'event' ? 24 :
               k === 'psych' ? 90 : k === 'market' || k === 'climate' ? 46 : 20;
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('sz', new THREE.BufferAttribute(siz, 1));
    var mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: sprite }, dpr: { value: renderer.getPixelRatio() } },
      vertexShader:
        'attribute float sz;attribute vec3 color;varying vec3 vc;uniform float dpr;' +
        'void main(){vc=color;vec4 mv=modelViewMatrix*vec4(position,1.);' +
        'gl_PointSize=sz*dpr*(1.0/-mv.z);gl_Position=projectionMatrix*mv;}',
      fragmentShader:
        'uniform sampler2D map;varying vec3 vc;void main(){' +
        'vec4 t=texture2D(map,gl_PointCoord);gl_FragColor=vec4(vc,1.0)*t;}'
    });
    var pts = new THREE.Points(geo, mat);
    pts.visible = false;
    (ti === 6 ? brainGrp : globeGrp).add(pts);
    return { pts: pts, idxs: idxs, base: col.slice(0), sizeBase: siz.slice(0) };
  });

  /* =========================================================== interaction */
  var tab = 4, yaw = -1.4, pitch = 0.32, dist = 3.4, sel = null;
  var drag = false, lastX = 0, lastY = 0, moved = 0;

  function isBrain() { return tab === 6; }

  function place() {
    globeGrp.visible = !isBrain();
    brainGrp.visible = isBrain();
    var r = isBrain() ? Math.max(dist, 2.2) : dist;
    camera.position.set(
      r * Math.cos(pitch) * Math.sin(yaw),
      r * Math.sin(pitch),
      r * Math.cos(pitch) * Math.cos(yaw));
    camera.lookAt(0, 0, 0);
  }

  function resize() {
    var w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  canvas.addEventListener('pointerdown', function (e) {
    drag = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', function (e) {
    drag = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (x) {}
    if (moved < 5) pick(e.clientX, e.clientY, true);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (drag) {
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX; lastY = e.clientY;
      yaw -= dx * 0.005;
      pitch = Math.max(-1.35, Math.min(1.35, pitch + dy * 0.005));
      place();
    } else {
      pick(e.clientX, e.clientY, false);
    }
  });
  canvas.addEventListener('pointerleave', function () {
    drag = false; $('tip').style.display = 'none';
  });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    dist = Math.max(1.35, Math.min(9, dist * (1 + Math.sign(e.deltaY) * 0.11)));
    place();
  }, { passive: false });

  /* screen-space picking: project this layer's nodes and take the nearest
     within a tolerance. Cheaper and more forgiving than raycasting points. */
  var proj = new THREE.Vector3();
  function pick(clientX, clientY, commit) {
    var r = canvas.getBoundingClientRect();
    var mx = clientX - r.left, my = clientY - r.top;
    var L = layers[tab], best = -1, bestD = 16 * 16;
    // a hidden point is not there as far as the pointer is concerned
    var grp = isBrain() ? brainGrp : globeGrp;
    var posAttr = L.pts.geometry.attributes.position;
    for (var j = 0; j < L.idxs.length; j++) {
      if (!visible(L.idxs[j])) continue;   // hidden points are not pickable
      proj.set(posAttr.getX(j), posAttr.getY(j), posAttr.getZ(j));
      grp.localToWorld(proj);
      var wx = proj.x, wy = proj.y, wz = proj.z;
      proj.project(camera);
      if (proj.z > 1) continue;
      // hide points on the far side of the globe
      if (!isBrain()) {
        var toCam = camera.position.clone().sub(new THREE.Vector3(wx, wy, wz));
        if (toCam.dot(new THREE.Vector3(wx, wy, wz)) < 0) continue;
      }
      var sx = (proj.x * 0.5 + 0.5) * r.width;
      var sy = (-proj.y * 0.5 + 0.5) * r.height;
      var d2 = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
      if (d2 < bestD) { bestD = d2; best = L.idxs[j]; }
    }
    var tip = $('tip');
    if (best < 0) { tip.style.display = 'none'; return; }
    if (commit) { select(best); tip.style.display = 'none'; return; }
    tip.innerHTML = '<b>' + esc(D.name[best]) + '</b><span>' +
      esc(KNAME[D.kinds[D.kind[best]]] || '') +
      (state ? ' · effect ' + state[best].toFixed(3) : '') + '</span>';
    tip.style.display = 'block';
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var lx = Math.min(clientX + 14, window.innerWidth - tw - 8);
    var ly = Math.min(clientY + 16, window.innerHeight - th - 8);
    tip.style.left = Math.max(8, lx) + 'px';
    tip.style.top = Math.max(8, ly) + 'px';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================================================================== ui */
  function buildTabs() {
    var host = $('tabs');
    host.innerHTML = '';
    D.tabs.forEach(function (t, i) {
      var b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === tab ? 'true' : 'false');
      b.innerHTML = '<b>' + esc(t.name) + '</b><small>' + esc(t.sub) +
                    '</small><span class="ct" id="ct' + i + '"></span>';
      b.onclick = function () { setTab(i); };
      host.appendChild(b);
    });
  }

  function setTab(i) {
    tab = i;
    layers.forEach(function (L, j) { L.pts.visible = (j === i); });
    [].forEach.call($('tabs').children, function (b, j) {
      b.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (isBrain()) { dist = 3.0; yaw = -0.9; pitch = 0.22; }
    else if (dist < 2) dist = 3.4;
    place();
    renderKinds();
    renderLegend();
  }

  /* ------------------------------------------------------- weight filter --
   * Twenty-four thousand points is more than anyone can read at once. The
   * threshold hides everything whose weight in the system falls below it,
   * which for a power plant is its capacity and for everything else is its
   * resilience: the quantity the propagation engine actually uses. Hidden
   * nodes are hidden, not deleted. They keep taking part in the propagation,
   * because a filter that changed the answer would be a different model
   * rather than a clearer view of this one.
   */
  var minW = 0;

  function weightOf(i) {
    // capacity where a node has one, resilience otherwise; both normalised
    if (MW && MW[i] > 0) return Math.min(1, Math.pow(MW[i] / 8000, 1 / 3));
    return RES[i];
  }

  function visible(i) { return weightOf(i) >= minW; }

  function applyFilter() {
    // The slider exists in the markup whether or not the scene was built. If
    // WebGL failed there are no layers to filter, and moving it should do
    // nothing rather than throw.
    var L = (typeof layers !== 'undefined' && layers && layers[tab]) || null;
    var lab = $('wlab');
    if (lab && L) {
      var shown = 0, total = L.idxs.length;
      L.idxs.forEach(function (n) { if (visible(n)) shown++; });
      lab.textContent = minW <= 0
        ? total.toLocaleString() + ' of ' + total.toLocaleString() + ' shown'
        : shown.toLocaleString() + ' of ' + total.toLocaleString() +
          ' shown · hiding below ' + (minW * 100).toFixed(0) + '%';
    }
    if (!L) return;
    paint();
    renderKinds();
  }

  function renderKinds() {
    var counts = {};
    layers[tab].idxs.forEach(function (n) {
      if (!visible(n)) return;
      var k = D.kinds[D.kind[n]];
      counts[k] = (counts[k] || 0) + 1;
    });
    var html = '';
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
      .forEach(function (k) {
        html += '<li><i style="background:#' +
          ('000000' + (KCOL[k] || 0xaaaaaa).toString(16)).slice(-6) +
          '"></i>' + esc(KNAME[k] || k) + '<span>' +
          counts[k].toLocaleString() + '</span></li>';
      });
    $('kinds').innerHTML = html;
  }

  function renderLegend() {
    var t = D.tabs[tab];
    $('legend').innerHTML = '<b>' + esc(t.name) + '</b> · ' +
      layers[tab].idxs.length.toLocaleString() + ' nodes<br>' + esc(t.sub) +
      (isBrain()
        ? '<br><span style="opacity:.75">a schematic solid, not anatomy</span>'
        : '');
  }

  function renderShocks() {
    var keys = Object.keys(shocks);
    $('shockbox').style.display = keys.length ? 'block' : 'none';
    $('run').disabled = !keys.length;
    $('shocks').innerHTML = keys.map(function (k) {
      return '<li><b>' + esc(D.name[k]) + '</b><code>' +
        (shocks[k] > 0 ? '+' : '') + shocks[k].toFixed(2) + '</code></li>';
    }).join('');
  }

  function select(i) {
    sel = i;
    var box = $('selbox');
    var cur = shocks[i] != null ? shocks[i] : 0.8;
    box.innerHTML =
      '<h2>Selection</h2>' +
      '<h3>' + esc(D.name[i]) + '</h3>' +
      '<div class="sub">' + esc(KNAME[D.kinds[D.kind[i]]] || '') +
        (srcOf(i) ? ' · ' + esc(srcOf(i)) : '') + '</div>' +
      '<dl>' +
        '<div><dt>Effect now</dt><dd id="d-val">' +
          (state ? state[i].toFixed(4) : '—') + '</dd></div>' +
        '<div><dt>Resilience</dt><dd>' + D.res[i].toFixed(2) + '</dd></div>' +
        (hit && hit[i] >= 0
          ? '<div><dt>Reached at step</dt><dd>' + hit[i] + '</dd></div>' : '') +
      '</dl>' +
      '<div style="margin-top:12px">' +
        '<label style="font-size:11.5px;color:var(--dim)">Change size ' +
        '<b id="d-amt" style="color:var(--ink);font-family:var(--mono)">' +
        cur.toFixed(2) + '</b></label>' +
        '<input type="range" id="d-rng" min="-1" max="1" step="0.05" value="' +
        cur + '">' +
      '</div>' +
      '<div class="row2">' +
        '<button class="pri" id="d-add">Push here</button>' +
        '<button id="d-clr">Clear this</button>' +
      '</div>';
    var rng = $('d-rng');
    rng.oninput = function () { $('d-amt').textContent = (+rng.value).toFixed(2); };
    $('d-add').onclick = function () {
      var v = +rng.value;
      if (v === 0) delete shocks[i]; else shocks[i] = v;
      renderShocks();
    };
    $('d-clr').onclick = function () { delete shocks[i]; renderShocks(); };
  }

  function clearSel() {
    sel = null;
    $('selbox').innerHTML = '<h2>Selection</h2><p class="empty">Nothing ' +
      'selected. Click a point to read what it is, where its number came ' +
      'from, and to push on it.</p>';
  }

  /* stress colouring: nodes keep their kind hue and gain brightness with the
     size of the effect, so a run reads as illumination rather than a repaint */
  function paint() {
    layers.forEach(function (L) {
      var col = L.pts.geometry.attributes.color;
      var siz = L.pts.geometry.attributes.sz;
      for (var j = 0; j < L.idxs.length; j++) {
        var n = L.idxs[j], base = L.base;
        if (!visible(n)) {          // filtered out: drawn at zero size
          siz.setX(j, 0);
          col.setXYZ(j, base[j * 3], base[j * 3 + 1], base[j * 3 + 2]);
          continue;
        }
        if (!state) {
          col.setXYZ(j, base[j * 3], base[j * 3 + 1], base[j * 3 + 2]);
          siz.setX(j, L.sizeBase[j]);
        } else {
          var a = Math.min(1, Math.abs(state[n]) / 0.6);
          var lift = 1 + 1.7 * a;
          col.setXYZ(j, Math.min(1, base[j * 3] * lift + 0.32 * a),
                        Math.min(1, base[j * 3 + 1] * lift + 0.08 * a),
                        Math.min(1, base[j * 3 + 2] * lift * (1 - 0.25 * a)));
          siz.setX(j, L.sizeBase[j] * (1 + 1.5 * a));
        }
      }
      col.needsUpdate = true; siz.needsUpdate = true;
    });
    // per-tab counts on the tab strip
    D.tabs.forEach(function (t, i) {
      var el = $('ct' + i);
      if (!el) return;
      if (!state) { el.textContent = ''; return; }
      var c = 0;
      layers[i].idxs.forEach(function (n) {
        if (Math.abs(state[n]) >= 0.02) c++;
      });
      el.textContent = c ? c.toLocaleString() + ' hit' : '';
    });
  }

  function run() {
    if (!Object.keys(shocks).length) return;
    var out = propagate(shocks);
    state = out[0]; hit = out[1];
    var mx = 0;
    for (var i = 0; i < N; i++) if (Math.abs(state[i]) > Math.abs(mx)) mx = state[i];
    $('s-touch').textContent = touched(state).toLocaleString();
    $('s-steps').textContent = steps;
    $('s-max').textContent = mx.toFixed(3);
    if (sel != null && $('d-val')) $('d-val').textContent = state[sel].toFixed(4);
    paint();
  }

  (function () {
    var sl = $('wmin');
    if (sl) {
      sl.addEventListener('input', function () {
        minW = +this.value / 100;
        applyFilter();
      });
      applyFilter();
    }
  })();

  $('run').onclick = run;
  $('reset').onclick = function () {
    shocks = {}; state = null; hit = null;
    $('s-touch').textContent = '—';
    $('s-steps').textContent = '—';
    $('s-max').textContent = '—';
    $('scen').value = '';
    $('scendesc').textContent =
      'Six prepared changes, or click any point and push on it yourself.';
    renderShocks(); clearSel(); paint();
  };
  $('home').onclick = function () {
    yaw = -1.4; pitch = 0.32; dist = isBrain() ? 3.0 : 3.4; place();
  };

  var byId = {};
  for (var q = 0; q < N; q++) byId[D.id[q]] = q;
  var sc = $('scen');
  Object.keys(D.scenarios).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k;
    o.textContent = k.replace(/_/g, ' ').replace(/^./, function (c) {
      return c.toUpperCase(); });
    sc.appendChild(o);
  });
  sc.onchange = function () {
    var s = D.scenarios[sc.value];
    if (!s) { $('scendesc').textContent =
      'Six prepared changes, or click any point and push on it yourself.';
      return; }
    shocks = {};
    Object.keys(s.shocks).forEach(function (id) {
      if (byId[id] != null) shocks[byId[id]] = s.shocks[id];
    });
    $('scendesc').textContent = s.desc;
    renderShocks();
  };

  /* ================================================================ boot */
  $('sub').textContent = N.toLocaleString() + ' nodes and ' +
    ES.length.toLocaleString() + ' weighted links. Every position is a real ' +
    'coordinate. Every parameter comes from a public data set.';

  buildTabs(); setTab(4); clearSel(); renderShocks(); paint();
  resize(); place();
  window.addEventListener('resize', function () { resize(); place(); });

  var spin = true;
  canvas.addEventListener('pointerdown', function () { spin = false; });
  var lastT = 0;
  (function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0.016;
    lastT = now;
    if (spin && !isBrain()) { yaw -= dt * 0.055; place(); }
    renderer.render(scene, camera);
  })(0);
})();
