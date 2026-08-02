/* The world energy model — atlas application.
 *
 * Six of the seven layers live on a globe. The seventh, behaviour, lives in a
 * brain, because that is where the model says demand is decided and a map is
 * the wrong container for it.
 *
 * The propagation engine is the model of record. build_atlas_figures.py holds
 * a second implementation of the same arithmetic in sparse linear algebra, and
 * test_atlas_engine.js runs both over the real payload and requires them to
 * agree. Every published figure comes from that second implementation, so if
 * the two ever drift the figures stop describing this page.
 */
(function () {
  'use strict';
  var D = window.ATLAS, THREE = window.THREE;
  var $ = function (id) { return document.getElementById(id); };

  /* Read a CSS custom property off the root element. drawWeb wants the accent
     colour and the palette lives in the stylesheet, so the web matches the
     theme instead of hard-coding a violet that would drift from it.

     This function was called before it was written. Because the call is the
     first statement in drawWeb, and drawWeb is the first statement in select,
     every click on every node threw ReferenceError before anything visible
     happened -- while hovering, which never reaches select, went on working.
     A silent selection failure that leaves the tooltip working is exactly the
     shape of bug an interaction test catches and a glance at the screen does
     not. There is now such a test. */
  function css(name) {
    try {
      return getComputedStyle(document.documentElement)
        .getPropertyValue(name).trim();
    } catch (e) {
      return '';
    }
  }

  if (!D) return;

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
  /* Capacity and node ids are sparse: a hundred thousand nodes, of which
     thirty-five thousand have a capacity and a couple of dozen have an id
     anything refers to. Storing them as maps rather than as full-length
     arrays of zeroes and blanks is most of a megabyte. */
  var MWMAP = D.mwMap || null;
  function mwOf(i) {
    if (!MWMAP) return 0;
    var v = MWMAP[i];
    return v === undefined ? 0 : v;
  }
  var ES = Int32Array.from(D.es), ET = Int32Array.from(D.et);
  var EW = Float64Array.from(D.ew), RES = Float64Array.from(D.res);
  var steps = 0, state = null, hit = null, shocks = {};

  /* ============================================== the propagation engine ==
   * lam is the relaxation rate; a node's resilience damps what reaches it;
   * tanh keeps every value inside (-1, 1) so nothing can run away. Sixty
   * rounds is a ceiling, not a target — scenarios settle in 30 to 40.     */
  /* Four faults lived here, and each was hidden by the one before it.

     ONE. The influence arriving at a node was the SUM of its neighbours, so a
     national grid carrying four thousand plants multiplied any shock by four
     thousand. The spectral radius of the operator was 26 — the iteration could
     not converge, every scenario saturated every reachable node and hit the
     sixty-round ceiling, and the model answered "everything" to every question.

     TWO. Influence used to travel only from an edge's source to its target, so
     a grid outage reached the cities below it and never the plants that feed
     it. Most couplings here run both ways: a grid and its plants, a market and
     its supplies. Two do not. An earthquake acts on a grid and no grid causes
     an earthquake, and the same holds for the climate. So the layers carry a
     rank — climate 0, events 1, everything else 2 — and an edge is two-way
     only between equal ranks. Anything crossing a rank drives and is not
     driven.

     THREE. A node's drivers were not normalised by how many of them there
     were. The write-up said a group of plants feeding one grid shared a fixed
     budget between them; the global rebuild never implemented it. Every one of
     China's 4,235 plants was sending the grid a full 0.246, so the plants
     summed to 1,042 and China's coal supply — 54 per cent of the country's
     power — was three hundredths of one per cent of what the grid was
     listening to. Cutting it did nothing. Each edge is therefore divided by
     the number of edges arriving at the same node from the same layer, so a
     layer speaks once however many members it has, and the members split it.

     FOUR. What remains is divided by the node's total in-weight, which makes
     every node the weighted mean of its drivers and the operator's spectral
     radius exactly 1. With the tanh contraction and the resilience factor the
     iteration is a contraction and settles. */
  var KIND = D.kind.map(function (k) { return D.kinds[k]; });
  var RANK = { sun: 0, insolation: 1, weather: 2, climate: 3, event: 4 };
  function rank(i) { var r = RANK[KIND[i]]; return r === undefined ? 5 : r; }
  var ONE = new Uint8Array(ES.length);
  for (var e0 = 0; e0 < ES.length; e0++) {
    ONE[e0] = rank(ES[e0]) === rank(ET[e0]) ? 0 : 1;
  }

  /* Per-edge coefficients: fan-in share, then the row normalisation. FW is
     what an edge delivers to its target, BW what it delivers back to its
     source, and BW is zero on a one-way edge. */
  var FW = new Float64Array(ES.length), BW = new Float64Array(ES.length);
  (function () {
    var cnt = Object.create(null), e, i, k;
    function bump(node, layer) {
      k = node + '|' + layer;
      cnt[k] = (cnt[k] || 0) + 1;
    }
    for (e = 0; e < ES.length; e++) {
      bump(ET[e], KIND[ES[e]]);
      if (!ONE[e]) bump(ES[e], KIND[ET[e]]);
    }
    for (e = 0; e < ES.length; e++) {
      FW[e] = EW[e] / cnt[ET[e] + '|' + KIND[ES[e]]];
      BW[e] = ONE[e] ? 0 : EW[e] / cnt[ES[e] + '|' + KIND[ET[e]]];
    }
    var d = new Float64Array(N);
    for (e = 0; e < ES.length; e++) {
      d[ET[e]] += Math.abs(FW[e]);
      if (!ONE[e]) d[ES[e]] += Math.abs(BW[e]);
    }
    for (i = 0; i < N; i++) if (d[i] === 0) d[i] = 1;
    for (e = 0; e < ES.length; e++) {
      FW[e] /= d[ET[e]];
      if (!ONE[e]) BW[e] /= d[ES[e]];
    }
  })();

  function propagate(sh) {
    var b = new Float64Array(N);
    for (var k in sh) b[k] = sh[k];
    var s = Float64Array.from(b), lam = 0.95;
    var fh = new Int16Array(N).fill(-1);
    for (var i = 0; i < N; i++) if (Math.abs(s[i]) >= 0.02) fh[i] = 0;
    var last = 0;
    for (var r = 1; r <= 60; r++) {
      var inf = new Float64Array(N);
      for (var e = 0; e < ES.length; e++) {
        inf[ET[e]] += FW[e] * s[ES[e]];
        if (!ONE[e]) inf[ES[e]] += BW[e] * s[ET[e]];
      }
      var sn = new Float64Array(N), mx = 0;
      for (i = 0; i < N; i++) {
        sn[i] = (1 - lam) * s[i] +
                lam * Math.tanh(b[i] + (1 - RES[i] * 0.6) * inf[i]);
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

  /* The model is now complete and testable. Everything past this point draws
     it, and drawing needs a GPU. The guard sits here rather than at the top of
     the file so that a headless harness can run the engine: the checks that
     matter are true whether or not there is a canvas, and a harness that can
     only run with one is a harness that does not run. */
  if (!THREE) {
    var nogl = $('nogl');
    if (nogl) nogl.style.display = 'grid';
    return;
  }

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
    station: 0x8b7ff2, psych: 0xa98fd8,
    sun: 0xf2d98b, insolation: 0xe8c98f, weather: 0x4f9d84
  };
  var KNAME = {
    market: 'price benchmark', climate: 'climate system', grid: 'power system',
    supply: 'fuel supply', district: 'district', consumer: 'consumer group',
    event: 'recorded event', station: 'power station',
    psych: 'behaviour channel', sun: 'the sun',
    insolation: 'insolation band', weather: 'mode of variability'
  };
  /* The brain lives in its own coordinate space, so the renderer has to know
     which tab it is. This used to be the literal 6. Two tabs were then
     inserted ahead of it and the brain silently became the demand tab, which
     is the kind of break a magic number is for. Resolved by id instead. */
  var BRAIN_TAB = (function () {
    /* Found from the data: the tab the behaviour channels are on. Matching a
       list of likely tab ids would have been the same mistake one level up --
       the id is 'mind', and neither guess would have hit it. */
    var psych = D.kinds.indexOf('psych');
    for (var i = 0; i < D.kind.length; i++) {
      if (D.kind[i] === psych) return D.tab[i];
    }
    return -1;
  })();

  /* Radius by layer. The sun is not on the Earth and the insolation bands are
     not either: they are the light arriving above the atmosphere, so they are
     drawn as an arc standing off the surface, with the sun beyond them. */
  var RSHELL = { sun: 3.1, insolation: 1.42 };
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
  /* The anatomy. Every named structure of the Allen Common Coordinate
     Framework at its published centre of mass, drawn as a faint point cloud
     inside the shell. It carries no weight, no edge and no behavioural
     channel, and it is deliberately kept out of the node arrays so that
     nothing can mistake scenery for part of the model. What it buys is a
     brain that reads as a brain rather than two dozen dots in a void. */
  if (D.anatomy && D.anatomy.length) {
    var ap = [], ac = [];
    var acol = new THREE.Color(0x5a6a9c);
    for (var ai = 0; ai < D.anatomy.length; ai++) {
      var xyz = D.anatomy[ai].xyz;
      ap.push(xyz[0], xyz[1], xyz[2]);
      ac.push(acol.r, acol.g, acol.b);
    }
    var ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
    ag.setAttribute('color', new THREE.Float32BufferAttribute(ac, 3));
    var anat = new THREE.Points(ag, new THREE.PointsMaterial({
      size: 0.022, vertexColors: true, transparent: true, opacity: 0.42,
      sizeAttenuation: true, depthWrite: false }));
    anat.userData.anatomy = true;
    brainGrp.add(anat);
  }

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

  /* One extra layer that belongs to no tab: the districts that carry a
     measured population, drawn on the globe. The behaviour tab switches
     between the brain and this, so you can see which places the behaviour
     layer is actually listening to rather than only the channels themselves.
     It is built by the same code path as every other layer, so it filters,
     paints and picks identically. */
  var MINDMAP = tabIdx.length;
  var POPMAP = D.popMap || {};
  tabIdx.push(Object.keys(POPMAP).map(Number).filter(function (i) {
    return D.kinds[D.kind[i]] === 'district';
  }));

  /* which layer the pointer, the filter and the legend are looking at */
  function curLayer() {
    return (tab === BRAIN_TAB && mindMap) ? layers[MINDMAP] : layers[tab];
  }

  var layers = tabIdx.map(function (idxs, ti) {
    var pos = new Float32Array(idxs.length * 3);
    var col = new Float32Array(idxs.length * 3);
    var siz = new Float32Array(idxs.length);
    var c = new THREE.Color();
    idxs.forEach(function (n, j) {
      var v;
      if (ti === BRAIN_TAB) {
        var br = null;
        for (var b = 0; b < D.brain.length; b++) if (D.brain[b].i === n) br = D.brain[b];
        var xyz = br ? br.xyz : [0, 0, 0];
        v = new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
      } else {
        v = lonlat(D.lon[n], D.lat[n],
                   RSHELL[D.kinds[D.kind[n]]] || 1.012);
      }
      pos[j * 3] = v.x; pos[j * 3 + 1] = v.y; pos[j * 3 + 2] = v.z;
      c.setHex(KCOL[D.kinds[D.kind[n]]] || 0xaaaaaa);
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
      var k = D.kinds[D.kind[n]];
      siz[j] = k === 'sun' ? 200 : k === 'insolation' ? 70 :
               k === 'weather' ? 80 :
               k === 'station' ? 15 : k === 'event' ? 24 :
               k === 'psych' ? 90 :
               k === 'market' || k === 'climate' ? 46 : 20;
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
    (ti === BRAIN_TAB ? brainGrp : globeGrp).add(pts);
    return { pts: pts, idxs: idxs, base: col.slice(0), sizeBase: siz.slice(0) };
  });

  /* =========================================================== interaction */
  /* The opening tab was the literal 4, which was the plant layer until two
     tabs were inserted in front of it and it silently became the markets.
     Resolved by id, with a fallback that cannot land on a tab that does not
     exist. */
  /* The count is read from the payload. It said six for a long time after
     there were nine. */
  var SCEN_HINT = Object.keys(D.scenarios || {}).length +
    ' prepared changes, or click any point and push on it yourself.';

  var tab = (function () {
    for (var i = 0; i < D.tabs.length; i++) {
      if (D.tabs[i].id === 'plants') return i;
    }
    return Math.min(4, D.tabs.length - 1);
  })();
  var mindMap = false;
  var yaw = -1.4, pitch = 0.32, dist = 3.4, sel = null;
  var drag = false, lastX = 0, lastY = 0, moved = 0;

  /* The brain is only drawn when the behaviour tab is showing the brain. On
     the map view the same layer's nodes sit on the globe. */
  function isBrain() { return tab === BRAIN_TAB && !mindMap; }

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
    var L = curLayer(), best = -1, bestD = 16 * 16;
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
    if (tab !== BRAIN_TAB) mindMap = false;
    showLayer();
    [].forEach.call($('tabs').children, function (b, j) {
      b.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (isBrain()) { dist = 3.0; yaw = -0.9; pitch = 0.22; }
    else if (dist < 2) dist = 3.4;
    place();
    renderKinds();
    renderLegend();
    renderMindToggle();
  }

  function showLayer() {
    var want = (tab === BRAIN_TAB && mindMap) ? MINDMAP : tab;
    layers.forEach(function (L, j) { L.pts.visible = (j === want); });
  }

  /* The behaviour layer is the one part of the model that is not a place, and
     the two things worth looking at are the channels and the districts feeding
     them. This switches between them without changing the model. */
  function renderMindToggle() {
    var host = $('mindview');
    if (!host) return;
    if (tab !== BRAIN_TAB) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    host.innerHTML =
      '<h2>View</h2><div class="seg" id="mindseg">' +
      '<button data-v="brain"' + (mindMap ? '' : ' class="on"') +
      '>Brain</button>' +
      '<button data-v="map"' + (mindMap ? ' class="on"' : '') +
      '>Map</button></div>' +
      '<p class="note">' + (mindMap
        ? 'The districts that feed the behaviour layer, on the globe. Point ' +
          'size is population; the link into the channels is the measured ' +
          'concentration of that population.'
        : 'The behaviour channels, at their positions in the brain.') +
      '</p>';
    [].forEach.call($('mindseg').children, function (b) {
      b.onclick = function () {
        mindMap = b.getAttribute('data-v') === 'map';
        showLayer();
        if (isBrain()) { dist = 3.0; yaw = -0.9; pitch = 0.22; }
        else if (dist < 2) dist = 3.4;
        place();
        clearWeb();
        renderMindToggle();
        renderLegend();
        applyFilter();
      };
    });
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
    var mw = mwOf(i);
    if (mw > 0) return Math.min(1, Math.pow(mw / 8000, 1 / 3));
    return RES[i];
  }

  function visible(i) { return weightOf(i) >= minW; }

  function applyFilter() {
    // The slider exists in the markup whether or not the scene was built. If
    // WebGL failed there are no layers to filter, and moving it should do
    // nothing rather than throw.
    var L = (typeof layers !== 'undefined' && layers) ? curLayer() : null;
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
    curLayer().idxs.forEach(function (n) {
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
      curLayer().idxs.length.toLocaleString() + ' nodes<br>' + esc(t.sub) +
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

  /* ------------------------------------------------------- the impact web --
   * Clicking a node draws what it actually touches: every edge out of it,
   * then every edge out of those, three hops deep, with the line fading as
   * the influence does. Before this, selecting an event told you its name and
   * nothing about why it was in the model. The web is the answer to "and
   * then what", which is the only question the model exists to answer.
   */
  var webLine = null;

  function clearWeb() {
    if (webLine) {
      webLine.geometry.dispose();
      webLine.material.dispose();
      webLine.parent.remove(webLine);
      webLine = null;
    }
  }

  function drawWeb(root) {
    clearWeb();
    if (root == null || isBrain()) return;

    // adjacency, built once and kept
    if (!drawWeb.adj) {
      var adj = new Array(N);
      for (var e = 0; e < ES.length; e++) {
        (adj[ES[e]] || (adj[ES[e]] = [])).push([ET[e], EW[e]]);
        (adj[ET[e]] || (adj[ET[e]] = [])).push([ES[e], EW[e]]);
      }
      drawWeb.adj = adj;
    }
    var adj = drawWeb.adj;

    var pos = [], col = [];
    var seen = {}, frontier = [[root, 1.0]], HOPS = 3, CAP = 900;
    seen[root] = 1;
    var acc = new THREE.Color('#65b2cc');   /* sky blue */
    for (var h = 0; h < HOPS && frontier.length && pos.length < CAP * 6; h++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var a = frontier[f][0], strength = frontier[f][1];
        var out = adj[a] || [];
        for (var k = 0; k < out.length; k++) {
          var b = out[k][0], w = out[k][1];
          if (seen[b]) continue;
          seen[b] = 1;
          var s2 = strength * Math.abs(w) * 0.8;
          if (s2 < 0.03) continue;
          var pa = onGlobe(a), pb = onGlobe(b);
          if (!pa || !pb) continue;
          pos.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
          /* the web is read against a dark globe, so it is drawn
             additively and floored so a weak strand is still a
             visible strand rather than a smudge */
          var b1 = Math.min(1, 0.30 + s2 * 2.4);
          var b2 = Math.min(1, 0.20 + s2 * 1.6);
          col.push(acc.r * b1, acc.g * b1, acc.b * b1,
                   acc.r * b2, acc.g * b2, acc.b * b2);
          next.push([b, s2]);
          if (pos.length > CAP * 6) break;
        }
      }
      frontier = next;
    }
    if (!pos.length) return;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    webLine = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    globeGrp.add(webLine);
  }

  function onGlobe(i) {
    var la = D.lat[i], lo = D.lon[i];
    if (la === 0 && lo === 0) return null;
    var rad = Math.PI / 180, cl = Math.cos(la * rad);
    var r = 1.012;
    return new THREE.Vector3(r * cl * Math.sin(lo * rad),
                             r * Math.sin(la * rad),
                             r * cl * Math.cos(lo * rad));
  }

  function select(i) {
    sel = i;
    drawWeb(i);
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

  /* A handle for the interaction tests. Clicking a point is the whole point
     of this page and it broke once without anything else breaking, so it is
     now reachable from a harness rather than only from a mouse. */
  /* the scene graph, for the harness: counting what is actually in the world
     is the only way to tell a stray line object from a coastline */
  window.__atlasScene = function () {
    function walk(o, out) {
      (o.children || []).forEach(function (c) {
        var pa = c.geometry && c.geometry.attributes &&
                 c.geometry.attributes.position;
        out.push({ verts: pa ? pa.count : 0, visible: c.visible !== false });
        walk(c, out);
      });
      return out;
    }
    return { globe: walk(globeGrp, []), brain: walk(brainGrp, []),
             web: webLine ? webLine.geometry.attributes.position.count : 0 };
  };

  window.__atlasUI = {
    select: function (i) { return select(i); },
    setMindMap: function (v) { mindMap = !!v; showLayer(); place(); return mindMap; },
    layerSize: function () { return curLayer().idxs.length; },
    brainTab: function () { return BRAIN_TAB; },
    setTab: function (i) { return setTab(i); },
    selected: function () { return sel; },
    clearSel: function () { return clearSel(); },
    openTab: function () { return tab; },
    webSize: function () {
      return webLine ? webLine.geometry.attributes.position.count : 0;
    },
    tabCount: function () { return D.tabs.length; }
  };

  /* Clearing the selection has to clear what the selection drew. The web is
     a picture of one node's reach, so leaving it on the globe after the panel
     says nothing is selected is a lie the renderer tells about the model. */
  function clearSel() {
    sel = null;
    clearWeb();
    $('selbox').innerHTML = '<h2>Selection</h2><p class="empty">Nothing ' +
      'selected. Click a point to read what it is, where its number came ' +
      'from, and to push on it.</p>';
  }

  /* stress colouring: nodes keep their kind hue and gain brightness with the
     size of the effect, so a run reads as illumination rather than a repaint */
  var pulseT = 0;

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
          /* Nodes the run moved breathe. The phase is offset by index so
             the layer shimmers rather than blinking in unison, and the depth
             of the pulse scales with how hard the node was hit, so a glance
             tells you where the effect went. */
          var ph = 1 + 0.45 * a * Math.sin(pulseT * 3.2 + j * 0.7);
          siz.setX(j, L.sizeBase[j] * (1 + 1.5 * a) * ph);
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
      SCEN_HINT;
    renderShocks(); clearSel(); paint();
  };
  $('home').onclick = function () {
    yaw = -1.4; pitch = 0.32; dist = isBrain() ? 3.0 : 3.4; place();
  };

  var byId = {};
  if (D.idMap) { for (var k0 in D.idMap) byId[k0] = D.idMap[k0]; }
  else { for (var q = 0; q < N; q++) byId[D.id[q]] = q; }
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
      SCEN_HINT;
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

  $('scendesc').textContent = SCEN_HINT;
  buildTabs(); setTab(tab); clearSel(); renderShocks(); paint();
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
    if (state) { pulseT += dt; paint(); }
    renderer.render(scene, camera);
  })(0);
})();
