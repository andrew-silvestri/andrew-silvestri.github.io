/* Sitewide graph background for the atlas/model page cluster - a real,
 * physically-simulated node-link graph instead of a hand-drawn static one.
 *
 * "Don't reinvent the wheel": this loads force-graph (vasturiano, MIT), a
 * real physics engine (wraps d3-force) with a canvas renderer already
 * built, the same way hero-gl.js already loads three.js - a runtime-
 * injected <script> from a CDN, gated by the motion contract, with the
 * page's existing static body::before SVG wash as the built-in fallback if
 * the CDN never loads or the browser has no canvas support. Nothing here
 * is invented: window.FORCE_GRAPH_DATA (assets/force-graph-data.js) is a
 * real connected subgraph of the published atlas, walked outward from a
 * real seed node by build_force_graph_data.py - same BFS build_bg_graph.py
 * already used for the old static SVG, just handed to a real simulation
 * instead of being hand-projected once.
 */
(function () {
  if (document.documentElement.dataset.motion !== 'on') return;
  var D = window.FORCE_GRAPH_DATA;
  if (!D || !D.nodes || !D.nodes.length) return;

  var KCOL = {
    sun: '#f2d98b', insolation: '#e8c98f', weather: '#4f9d84',
    climate: '#cfd6f0', event: '#d86a86', market: '#4f9d84',
    supply: '#6f7fd8', grid: '#5aa8d8', station: '#8b7ff2',
    district: '#5c6a8c', consumer: '#8b93b0', psych: '#a98fd8'
  };

  var host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:0;pointer-events:none';
  document.body.appendChild(host);

  /* ---- cut a hole over the text column ---------------------------------
   * The graph paints at ctx.globalAlpha=0.5 (below) with nothing opaque in
   * main's prose above it, so without this the node/link mesh reads straight
   * through every serif glyph for the whole scroll. A CSS mask on the host
   * div is cheaper than teaching the canvas renderer to avoid a region, and
   * it can be feathered for free.
   *
   * The geometry here is the same parse margin-scene.js does at its
   * measureBands() (~line 83) - read the live track widths off main's own
   * grid rather than hard-code a column width. Duplicated rather than lifted
   * into a shared file: the two scripts are loaded independently by
   * different page sets (force-bg.js only on atlas.html/model.html,
   * margin-scene.js on the rest) and there is no existing shared-helper
   * script tag on any page to hang a third file off without editing every
   * page that loads either one, which is outside this file's remit. Keep the
   * two in sync if main's grid-template-columns ever changes shape.
   */
  function textColumn() {
    var main = document.querySelector('main');
    if (!main) return null;
    var rect = main.getBoundingClientRect();
    var cs = getComputedStyle(main);
    var tracks = cs.gridTemplateColumns.split(' ')
      .filter(function (s) { return s.indexOf('[') !== 0; })
      .map(parseFloat);
    if (tracks.length < 5) return null;
    var outerL = tracks[0], padL = tracks[1], text = tracks[2];
    var left = rect.left + outerL + padL;
    return { left: left, right: left + text };
  }

  function applyMask() {
    var col = textColumn();
    var img;
    if (!col) {
      // Fewer than 5 tracks means the grid has collapsed to one column
      // (mobile) and the "text" track runs edge to edge - there is no margin
      // left to show the graph in, so hide it outright rather than let it
      // show through the prose with nothing left to feather against.
      img = 'linear-gradient(transparent, transparent)';
    } else {
      var f = 40; // feather, px, each side of the cut - no hard edge
      var cutL = Math.max(0, col.left - f);
      img = 'linear-gradient(to right,' +
        ' #000 0, #000 ' + cutL + 'px,' +
        ' transparent ' + col.left + 'px, transparent ' + col.right + 'px,' +
        ' #000 ' + (col.right + f) + 'px, #000 100%)';
    }
    host.style.maskImage = img;
    host.style.webkitMaskImage = img;
  }

  var SRC = 'https://cdn.jsdelivr.net/npm/force-graph@1.51.4/dist/force-graph.min.js';
  var s = document.createElement('script');
  s.src = SRC;
  s.async = true;
  s.onerror = function () { /* CDN blocked or offline; static SVG wash carries on */ };
  s.onload = function () { try { build(); } catch (e) { /* keep the static wash */ } };
  document.head.appendChild(s);

  function build() {
    if (!window.ForceGraph) return;

    var links = D.links.map(function (l) {
      return { source: l.source, target: l.target };
    });
    var nodes = D.nodes.map(function (n) {
      return { id: n.id, kind: n.kind, name: n.name };
    });

    var graph = new ForceGraph(host)
      .graphData({ nodes: nodes, links: links })
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeColor(function (n) { return KCOL[n.kind] || '#8b93b0'; })
      .nodeVal(2.4)
      .nodeLabel(null)
      .linkColor(function () { return 'rgba(139,147,176,0.25)'; })
      .linkWidth(1)
      .enableNodeDrag(false)
      .enableZoomInteraction(false)
      .enablePanInteraction(false)
      .enablePointerInteraction(false)
      .cooldownTime(Infinity)     // keep drifting gently, never fully freeze
      .d3AlphaDecay(0.003)        // slow settle - most of the life is here
      .d3VelocityDecay(0.35)
      .width(window.innerWidth)
      .height(window.innerHeight);

    // d3-force's defaults (charge strength -30, link distance 30) assume a
    // small SVG container - at full-viewport size they collapse 70 nodes
    // into a tight clump near the center. Scale both to the real canvas so
    // the graph actually fills the page it is the background of.
    //
    // Scaled off the shorter side (min(width,height)) this clump still
    // landed entirely inside the text column on an ordinary wide desktop
    // window - exactly the region applyMask() now cuts away, so the graph
    // vanished instead of framing the prose. Scaling off the width, and
    // pushing both constants up, spreads the cluster wide enough that it
    // actually reaches into the margins the mask leaves visible.
    var spread = window.innerWidth;
    graph.d3Force('charge').strength(-spread * 0.9);
    graph.d3Force('link').distance(spread * 0.16);

    // Only now - graph fully constructed with no exception thrown - does
    // the static SVG fallback step aside. If anything above throws, this
    // line is never reached and the page keeps its real static wash
    // instead of going blank.
    document.body.classList.add('force-graph-live');

    // Node/link opacity lives on the canvas, not the DOM - force-graph
    // exposes onRenderFramePre/Post for exactly this kind of global tweak.
    graph.onRenderFramePre(function (ctx) {
      ctx.globalAlpha = 0.5;
    });

    applyMask();

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        graph.width(window.innerWidth).height(window.innerHeight);
        applyMask();
      }, 180);
    });

    // force-graph has no documented stop/start toggle for the simulation
    // loop; the closest safe lever without fighting its internals is
    // hiding the canvas so it stops compositing while off-screen/hidden -
    // the physics tick itself is cheap at 70 nodes either way.
    document.addEventListener('motionchange', function (e) {
      host.style.display = e.detail === 'on' ? '' : 'none';
    });
    document.addEventListener('visibilitychange', function () {
      host.style.visibility = document.hidden ? 'hidden' : 'visible';
    });
  }
})();
