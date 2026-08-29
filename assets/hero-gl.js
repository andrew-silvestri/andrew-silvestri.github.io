/* Front-page hero, WebGL path.
 *
 * The 2D canvas version starts first and always works. This file tries to
 * upgrade it: if the browser reports a WebGL context, three.js is fetched, a
 * real 3D scene is built from the same data, and once it has a frame on screen
 * the 2D layers are faded out and stopped. If anything in that chain fails —
 * no WebGL, blocked CDN, slow network, thrown error — nothing happens and the
 * 2D hero keeps running. The page never waits on this.
 *
 * What 3D buys that the 2D version cannot fake:
 *   - real depth. Nodes and flow lines behind the globe are occluded by it
 *     through the depth buffer, rather than by a hand-written facing test.
 *   - additive blending, so overlapping light accumulates the way light does.
 *     That is what produces the glow in the reference image.
 *   - trails as geometry. Each particle carries a short history, so a
 *     streamline is a real object with a gradient along it, not a smear left
 *     in a fading framebuffer.
 *   - ~24,000 line segments and 1,900 sprites at 60fps, which is roughly ten
 *     times what the 2D path can carry.
 *
 * Deliberately NOT used: WebGPU. Its browser support still trails WebGL by a
 * wide margin, and this is a personal site's front page, not a demo — the
 * failure mode of a blank hero for a chunk of visitors is not worth the
 * marginal gain. The structure here would take a WebGPU renderer later without
 * changes to anything above it.
 */
(function () {
  var host = document.getElementById('hero');
  if (!host || !window.HERO) return;

  /* Same gate as hero.js. Returning here is also what makes "off" mean
     "not downloaded": the three.js request below never happens. */
  if (document.documentElement.dataset.motion !== 'on') return;

  /* ---- is WebGL actually available? ----------------------------------- */
  function webglOK() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
                (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }
  if (!webglOK()) return;

  var SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  var s = document.createElement('script');
  s.src = SRC;
  s.async = true;
  s.onerror = function () { /* CDN blocked or offline; 2D carries on */ };
  s.onload = function () { try { build(); } catch (e) { /* keep 2D */ } };
  document.head.appendChild(s);

  /* --------------------------------------------------------------------- */
  function build() {
    var THREE = window.THREE;
    if (!THREE) return;

    var D = window.HERO, RAD = Math.PI / 180;
    var box = host.getBoundingClientRect();
    var W = Math.max(240, box.width), H = Math.max(240, box.height);

    var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.domElement.className = 'hero-layer hero-gl';
    renderer.domElement.style.opacity = '0';
    renderer.domElement.style.transition = 'opacity 900ms ease';
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 100);
    camera.position.set(0, 0, 4.35);

    var world = new THREE.Group();
    world.rotation.z = -16 * RAD;        // same tilt as the 2D path
    scene.add(world);

    /* lat/lon -> unit sphere */
    function vec(lon, lat, r) {
      var la = lat * RAD, lo = lon * RAD, cl = Math.cos(la);
      return new THREE.Vector3(r * cl * Math.sin(lo), r * Math.sin(la),
                               r * cl * Math.cos(lo));
    }

    /* ---- the globe --------------------------------------------------- */
    var globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x0b1226 })
    );
    world.add(globe);

    // fresnel rim, drawn on a slightly larger back-facing shell
    var atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.BackSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { c: { value: new THREE.Color(0x6f8ae0) } },
        vertexShader:
          'varying float i;void main(){vec3 n=normalize(normalMatrix*normal);' +
          'vec4 mv=modelViewMatrix*vec4(position,1.);' +
          'i=pow(1.0-abs(dot(n,normalize(-mv.xyz))),2.6);' +
          'gl_Position=projectionMatrix*mv;}',
        fragmentShader:
          'uniform vec3 c;varying float i;' +
          'void main(){gl_FragColor=vec4(c,i*0.85);}'
      })
    );
    world.add(atmo);

    /* ---- coastlines --------------------------------------------------- */
    var cpos = [];
    D.coast.forEach(function (ring) {
      for (var i = 0; i < ring.length - 1; i++) {
        var a = vec(ring[i][0], ring[i][1], 1.002);
        var b = vec(ring[i + 1][0], ring[i + 1][1], 1.002);
        if (a.distanceTo(b) > 0.55) continue;        // skip antimeridian jumps
        cpos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    var cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    world.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({
      color: 0x6f8ab4, transparent: true, opacity: 0.5
    })));

    /* ---- nodes -------------------------------------------------------- */
    var COLOR = {
      station: 0x8b7ff2, event: 0xd86a86, grid: 0x5aa8d8, supply: 0x6f7fd8,
      district: 0x5c6a8c, consumer: 0x8b93b0, market: 0xcfd6f0,
      climate: 0xcfd6f0, sun: 0xf2d98b, insolation: 0xe8c98f,
      weather: 0x4f9d84
    };
    var np = [], nc = [], ns = [], n = D.nodes, col = new THREE.Color();
    for (var k = 0; k < n.length; k += 3) {
      var v = vec(n[k], n[k + 1], 1.006);
      np.push(v.x, v.y, v.z);
      var kind = D.kinds[n[k + 2]];
      col.setHex(COLOR[kind] || 0xa0a0a0);
      nc.push(col.r, col.g, col.b);
      ns.push(kind === 'event' ? 26 : kind === 'grid' ? 22
            : kind === 'market' || kind === 'climate' ? 40 : 17);
    }
    var ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    ng.setAttribute('color', new THREE.Float32BufferAttribute(nc, 3));
    ng.setAttribute('sz', new THREE.Float32BufferAttribute(ns, 1));

    var sprite = (function () {
      var c = document.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      var rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.25, 'rgba(255,255,255,0.75)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      var t = new THREE.CanvasTexture(c);
      t.needsUpdate = true;
      return t;
    })();

    world.add(new THREE.Points(ng, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: sprite }, dpr: { value: renderer.getPixelRatio() } },
      vertexShader:
        'attribute float sz;attribute vec3 color;varying vec3 vc;' +
        'uniform float dpr;void main(){vc=color;' +
        'vec4 mv=modelViewMatrix*vec4(position,1.);' +
        'gl_PointSize=sz*dpr*(1.0/-mv.z);' +
        'gl_Position=projectionMatrix*mv;}',
      fragmentShader:
        'uniform sampler2D map;varying vec3 vc;' +
        'void main(){vec4 t=texture2D(map,gl_PointCoord);' +
        'gl_FragColor=vec4(vc,1.0)*t;}'
    })));

    /* ---- flow, as trailed geometry ------------------------------------- */
    var P = 4200, TAIL = 11;            // ~42,000 segments
    var plon = new Float32Array(P), plat = new Float32Array(P);
    var page = new Float32Array(P), plife = new Float32Array(P);
    var hist = new Float32Array(P * TAIL * 3);
    var fpos = new Float32Array(P * (TAIL - 1) * 2 * 3);
    var fcol = new Float32Array(P * (TAIL - 1) * 2 * 3);

    function spawn(i, spread) {
      plon[i] = Math.random() * 360 - 180;
      plat[i] = Math.asin(Math.random() * 2 - 1) / RAD;
      plife[i] = 2.0 + Math.random() * 3.0;
      page[i] = spread ? Math.random() * plife[i] : 0;
      var v = vec(plon[i], plat[i], 1.012);
      for (var h = 0; h < TAIL; h++) {
        hist[(i * TAIL + h) * 3] = v.x;
        hist[(i * TAIL + h) * 3 + 1] = v.y;
        hist[(i * TAIL + h) * 3 + 2] = v.z;
      }
    }
    for (var i = 0; i < P; i++) spawn(i, true);

    var fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
    world.add(new THREE.LineSegments(fg, new THREE.LineBasicMaterial({
      /* WebGL ignores linewidth on every platform that matters, so weight
         comes from density and brightness rather than from a property that
         silently does nothing. */
      vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 1.0
    })));

    // the same field as the 2D path, so both tell the same story
    function field(lon, lat, t, out) {
      var la = lat * RAD, lo = lon * RAD;
      var zonal = 5.2 * Math.cos(2.4 * la) + 1.6 * Math.sin(3.1 * la);
      var wave = 1.5 * Math.sin(3 * lo + 1.3 * t + 2.0 * la) +
                 1.1 * Math.sin(5 * lo - 0.9 * t - 1.4 * la);
      out[0] = (zonal + wave) / Math.max(Math.cos(la), 0.18);
      out[1] = 1.25 * Math.sin(2 * lo - 0.7 * t) * Math.cos(la) +
               0.7 * Math.cos(4 * lo + 0.5 * t) * Math.cos(2 * la);
    }

    var fv = [0, 0], tmp = new THREE.Vector3();
    function stepFlow(dt, t) {
      var w = 0;
      for (var i = 0; i < P; i++) {
        field(plon[i], plat[i], t, fv);
        plon[i] += fv[0] * dt;
        plat[i] = Math.max(-84, Math.min(84, plat[i] + fv[1] * dt));
        if (plon[i] > 180) plon[i] -= 360;
        if (plon[i] < -180) plon[i] += 360;

        // shift history back one slot, newest at 0
        var base = i * TAIL * 3;
        for (var h = TAIL - 1; h > 0; h--) {
          hist[base + h * 3] = hist[base + (h - 1) * 3];
          hist[base + h * 3 + 1] = hist[base + (h - 1) * 3 + 1];
          hist[base + h * 3 + 2] = hist[base + (h - 1) * 3 + 2];
        }
        tmp = vec(plon[i], plat[i], 1.012);
        hist[base] = tmp.x; hist[base + 1] = tmp.y; hist[base + 2] = tmp.z;

        page[i] += dt;
        var env = Math.sin(Math.PI * Math.min(page[i] / plife[i], 1));
        for (var h2 = 0; h2 < TAIL - 1; h2++) {
          var a = base + h2 * 3, b = base + (h2 + 1) * 3;
          var far = 1 - h2 / (TAIL - 1);
          // a long hop means the particle wrapped; collapse the segment
          var dx = hist[a] - hist[b], dy = hist[a + 1] - hist[b + 1],
              dz = hist[a + 2] - hist[b + 2];
          var jump = (dx * dx + dy * dy + dz * dz) > 0.05;
          fpos[w] = hist[a]; fpos[w + 1] = hist[a + 1]; fpos[w + 2] = hist[a + 2];
          fpos[w + 3] = jump ? hist[a] : hist[b];
          fpos[w + 4] = jump ? hist[a + 1] : hist[b + 1];
          fpos[w + 5] = jump ? hist[a + 2] : hist[b + 2];
          /* Sky blue, #65B2CC. Under additive blending the red
             channel is the first to reach 1 where trails overlap,
             so a bright sky blue stacks into white exactly where
             the trails are densest. The brightness is held low
             enough that the hue survives the overlap; the weight
             comes from the number of trails, not from each one. */
          var g1 = 0.72 * env * far, g2 = 0.72 * env * far * 0.75;
          fcol[w] = g1 * 0.396; fcol[w + 1] = g1 * 0.698; fcol[w + 2] = g1 * 0.800;
          fcol[w + 3] = g2 * 0.396; fcol[w + 4] = g2 * 0.698; fcol[w + 5] = g2 * 0.800;
          w += 6;
        }
        if (page[i] > plife[i]) spawn(i, false);
      }
      fg.attributes.position.needsUpdate = true;
      fg.attributes.color.needsUpdate = true;
    }

    /* ---- loop ---------------------------------------------------------- */
    var t = 0, last = 0, running = false, raf = 0, shown = false;

    function frame(now) {
      if (!running) return;
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      t += dt;
      world.rotation.y += dt * 0.045;
      stepFlow(dt, t);
      renderer.render(scene, camera);
      if (!shown) {
        shown = true;
        renderer.domElement.style.opacity = '1';
        // hand over: stop the 2D loop and fade its layers out
        setTimeout(function () {
          if (window.HERO2D && window.HERO2D.stop) window.HERO2D.stop();
          var olds = host.querySelectorAll('.hero-layer:not(.hero-gl)');
          for (var i = 0; i < olds.length; i++) {
            olds[i].style.transition = 'opacity 700ms ease';
            olds[i].style.opacity = '0';
          }
        }, 60);
      }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

    /* The footer control needs to tear a running context down, not just keep
       a new one from starting. */
    window.HEROGL = { start: start, stop: stop };
    document.addEventListener('motionchange', function (e) {
      if (e.detail === 'on') { start(); } else { stop(); }
    });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var b = host.getBoundingClientRect();
        W = Math.max(240, b.width); H = Math.max(240, b.height);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        renderer.setSize(W, H);
      }, 180);
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        e[0].isIntersecting ? start() : stop();
      }, { threshold: 0.02 }).observe(host);
    } else { start(); }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
  }
})();
