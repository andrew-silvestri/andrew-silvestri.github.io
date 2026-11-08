/* Figures for perfidy.html. Every outline and number comes from window.PERFIDY_DATA (perfidy-data.js),
   which make_perfidy_data.py writes from the fonts. Nothing here is drawn by hand.
   Motion follows the site contract (assets/motion.js): with data-motion="off" every control still
   works, but each change lands at once instead of being animated, and nothing plays on its own. */
(function () {
  var D = window.PERFIDY_DATA;
  if (!D) return;
  var NS = 'http://www.w3.org/2000/svg';
  var root = document.documentElement;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // font units -> SVG. x' = ox + (x + y*skew) * s ; y' = oy - y * s
  function pathD(c, n, s, ox, oy, skew) {
    var i = 0, out = '', k, j, x, y;
    skew = skew || 0;
    for (var m = 0; m < c.length; m++) {
      var op = c[m];
      if (op === 'Z') { out += 'Z'; continue; }
      k = op === 'Q' ? 2 : (op === 'C' ? 3 : 1);
      out += op;
      for (j = 0; j < k; j++) {
        x = n[i++]; y = n[i++];
        out += (ox + (x + y * skew) * s).toFixed(1) + ' ' + (oy - y * s).toFixed(1) + ' ';
      }
    }
    return out;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function Tween() { this.raf = 0; }
  Tween.prototype.run = function (dur, step, done) {
    cancelAnimationFrame(this.raf);
    if (!motionOn() || dur <= 0) { step(1); if (done) done(); return; }
    var t0 = null, self = this;
    function f(ts) {
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / dur);
      step(ease(t));
      if (t < 1) self.raf = requestAnimationFrame(f); else if (done) done();
    }
    this.raf = requestAnimationFrame(f);
  };
  Tween.prototype.stop = function () { cancelAnimationFrame(this.raf); };
  function onFirstView(node, fn) {
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { io.disconnect(); if (motionOn()) fn(); }
      });
    }, { threshold: 0.45 });
    io.observe(node);
  }
  function buttons(box, labels, onPick) {
    var bs = labels.map(function (lab, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = lab; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { onPick(i, true); });
      box.appendChild(b);
      return b;
    });
    return function press(i) { bs.forEach(function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); }); };
  }
  function fmt(v, d) { return v.toFixed(d); }

  /* ------------------------------------------------------------------ 1. weight */
  (function () {
    var fig = document.getElementById('pf-weight');
    if (!fig) return;
    var W = D.weight, S = W.samples, upm = W.upm, sc = W.scale;
    var lo = S[0].axis, hi = S[S.length - 1].axis;
    var svg = el('svg', { viewBox: '0 0 720 330', role: 'img',
      'aria-label': 'The letters a and n drawn from Merriweather Sans at the selected point on its weight axis, with the six Perfidy weights marked on the axis below.' }, null);
    fig.insertBefore(svg, fig.firstChild);
    var em = 260, s = em / upm * sc, base = 230;
    el('line', { x1: 40, x2: 680, y1: base, y2: base, class: 'guide' }, svg);
    el('line', { x1: 40, x2: 680, y1: base - 0.5 * em, y2: base - 0.5 * em, class: 'guide' }, svg);
    var pa = el('path', { class: 'glyph' }, svg), pn = el('path', { class: 'glyph' }, svg);
    // axis
    var ax0 = 0.02 * 720, ax1 = 0.98 * 720, ay = 300;
    function axX(v) { return ax0 + (v - lo) / (hi - lo) * (ax1 - ax0); }
    el('line', { x1: axX(lo), x2: axX(W.source_range[0]), y1: ay, y2: ay, class: 'axis ext' }, svg);
    el('line', { x1: axX(W.source_range[0]), x2: axX(hi), y1: ay, y2: ay, class: 'axis' }, svg);
    W.stops.forEach(function (st) { el('circle', { cx: axX(st.axis), cy: ay, r: 6, class: 'stop' }, svg); });
    var knob = el('circle', { cx: 0, cy: ay, r: 5, class: 'knob' }, svg);
    var range = fig.querySelector('.pf-range'), read = fig.querySelector('.pf-read');
    range.min = lo; range.max = hi; range.step = 1;
    function sampleAt(v) {
      var i = 0;
      while (i < S.length - 2 && S[i + 1].axis < v) i++;
      var a = S[i], b = S[i + 1], t = Math.max(0, Math.min(1, (v - a.axis) / (b.axis - a.axis)));
      return { a: a, b: b, t: t };
    }
    function mix(ga, gb, t) { var n = new Array(ga.n.length); for (var i = 0; i < n.length; i++) n[i] = lerp(ga.n[i], gb.n[i], t); return n; }
    var cur = 305;
    function draw(v) {
      cur = v;
      var q = sampleAt(v);
      var na = mix(q.a.a, q.b.a, q.t), nn = mix(q.a.n, q.b.n, q.t);
      var adv = lerp(q.a.a.adv, q.b.a.adv, q.t), advn = lerp(q.a.n.adv, q.b.n.adv, q.t);
      var total = (adv + advn) * s, x0 = (720 - total) / 2;
      pa.setAttribute('d', pathD(q.a.a.c, na, s, x0, base));
      pn.setAttribute('d', pathD(q.a.n.c, nn, s, x0 + adv * s, base));
      knob.setAttribute('cx', axX(v));
      range.value = Math.round(v);
      var stem = lerp(q.a.stem_xh, q.b.stem_xh, q.t);
      var near = W.stops.filter(function (st) { return Math.abs(st.axis - v) < 3; })[0];
      var zone = v < W.source_range[0] ? 'extrapolated past the lightest master' : 'inside the source design space';
      read.innerHTML = '<span class="k">weight axis</span> ' + Math.round(v) + ' &middot; <span class="k">stem &divide; x-height</span> ' + fmt(stem, 3) +
        ' &middot; ' + (near ? 'Perfidy ' + near.name + ' <span class="k">(target ' + fmt(near.target, 3) + ')</span>' : '<span class="k">' + zone + '</span>');
      press(W.stops.indexOf(near));
    }
    var tw = new Tween();
    function go(v, dur) { var from = cur; tw.run(dur, function (t) { draw(lerp(from, v, t)); }); }
    var press = buttons(fig.querySelector('.pf-ctl'), W.stops.map(function (s) { return s.name; }), function (i) { go(W.stops[i].axis, 700); });
    range.addEventListener('input', function () { tw.stop(); draw(+range.value); });
    draw(305);
    onFirstView(fig, function () {
      tw.run(1400, function (t) { draw(lerp(305, hi, t)); }, function () {
        tw.run(1800, function (t) { draw(lerp(hi, lo, t)); }, function () {
          tw.run(900, function (t) { draw(lerp(lo, 305, t)); });
        });
      });
    });
  }());

  /* ------------------------------------------------------------------ 2. x-height */
  (function () {
    var fig = document.getElementById('pf-size');
    if (!fig) return;
    var wrap = fig.querySelector('.pf-panels');
    var em = 150, base = 185, draws = [];
    D.size.forEach(function (src) {
      var panel = document.createElement('div'); panel.className = 'pf-panel';
      var svg = el('svg', { viewBox: '0 0 300 240', role: 'img',
        'aria-label': 'The letters x, h and p from ' + src.source + ', with its x-height and the 0.50 em line.' }, panel);
      var p = document.createElement('p'); panel.appendChild(p);
      wrap.appendChild(panel);
      el('line', { x1: 10, x2: 290, y1: base, y2: base, class: 'guide' }, svg);
      var target = el('line', { x1: 10, x2: 290, y1: base - 0.5 * em, y2: base - 0.5 * em, class: 'guide acc' }, svg);
      var own = el('line', { x1: 10, x2: 290, class: 'guide moss' }, svg);
      var paths = 'xhp'.split('').map(function () { return el('path', { class: 'glyph' }, svg); });
      draws.push(function (t) {
        var k = lerp(1, src.scale, t), s = em / src.upm * k;
        var gl = 'xhp'.split('').map(function (ch) { return src.glyphs[ch]; });
        var total = gl.reduce(function (a, g) { return a + g.adv; }, 0) * s, x = (300 - total) / 2;
        gl.forEach(function (g, i) { paths[i].setAttribute('d', pathD(g.c, g.n, s, x, base)); x += g.adv * s; });
        var xh = src.xh_before * k;
        own.setAttribute('y1', base - xh * em); own.setAttribute('y2', base - xh * em);
        p.innerHTML = src.source + '<br>&rarr; <b>' + src.family + '</b><br>' + fmt(src.xh_before, 3) + ' &times; ' + fmt(lerp(1, src.scale, t), 3) + ' = ' + fmt(xh, 3) + ' em';
      });
    });
    var state = 0, tw = new Tween();
    function draw(t) { draws.forEach(function (f) { f(t); }); }
    var press = buttons(fig.querySelector('.pf-ctl'), ['Source size', 'Perfidy size'], function (i) {
      var from = state; state = i; press(i); tw.run(900, function (t) { draw(lerp(from, i, t)); });
    });
    draw(0); press(0);
    onFirstView(fig, function () { setTimeout(function () { state = 1; press(1); tw.run(1100, function (t) { draw(t); }); }, 500); });
  }());

  /* ------------------------------------------------------------------ 3. spacing */
  (function () {
    var fig = document.getElementById('pf-spacing');
    if (!fig) return;
    var P = D.spacing, upm = P.upm;
    var keys = ['source', 'text', 'display'];
    var maxw = Math.max(P.width.source, P.width.text, P.width.display);
    var em = 680 / (maxw / upm) * 0.94, s = em / upm, base = 150;
    var svg = el('svg', { viewBox: '0 0 720 200', role: 'img',
      'aria-label': 'The word ' + P.word + ' with the letter positions of the selected spacing.' }, null);
    fig.insertBefore(svg, fig.firstChild);
    el('line', { x1: 10, x2: 710, y1: base, y2: base, class: 'guide' }, svg);
    var x0 = (720 - (maxw * s)) / 2;
    var paths = P.glyphs.map(function () { return el('path', { class: 'glyph' }, svg); });
    var ticks = P.glyphs.map(function () { return el('line', { y1: base + 14, y2: base + 26, class: 'tick' }, svg); });
    var endl = el('line', { y1: base - 0.72 * em, y2: base + 26, class: 'guide acc' }, svg);
    var read = fig.querySelector('.pf-read');
    var names = { source: 'source spacing', text: 'Perfidy Text', display: 'Perfidy Display' };
    var cur = { t: 'source' }, pos = P.x.source.slice(), width = P.width.source;
    function draw(xs, w) {
      P.glyphs.forEach(function (g, i) {
        paths[i].setAttribute('d', pathD(g.c, g.n, s, x0 + xs[i] * s, base));
        ticks[i].setAttribute('x1', x0 + xs[i] * s); ticks[i].setAttribute('x2', x0 + xs[i] * s);
      });
      endl.setAttribute('x1', x0 + w * s); endl.setAttribute('x2', x0 + w * s);
    }
    function label(k) {
      var tr = k === 'source' ? 0 : P.track_em[k];
      read.innerHTML = '<span class="k">' + names[k] + '</span> &middot; <span class="k">tracking</span> ' + (tr >= 0 ? '+' : '&minus;') + fmt(Math.abs(tr), 4) +
        ' em &middot; <span class="k">word width</span> ' + fmt(P.width[k] / upm, 2) + ' em';
    }
    var tw = new Tween();
    var press = buttons(fig.querySelector('.pf-ctl'), ['Source spacing', 'Perfidy Text', 'Perfidy Display'], function (i) {
      var k = keys[i], fromX = pos.slice(), fromW = width, toX = P.x[k], toW = P.width[k];
      press(i); label(k);
      tw.run(800, function (t) {
        pos = fromX.map(function (v, j) { return lerp(v, toX[j], t); }); width = lerp(fromW, toW, t); draw(pos, width);
      });
    });
    draw(pos, width); press(0); label('source');
    onFirstView(fig, function () {
      var seq = [1, 2], j = 0;
      (function next() {
        if (j >= seq.length) return;
        var i = seq[j++];
        setTimeout(function () { fig.querySelectorAll('.pf-ctl button')[i].click(); setTimeout(next, 900); }, 600);
      }());
    });
  }());

  /* ------------------------------------------------------------------ 4. italic */
  (function () {
    var fig = document.getElementById('pf-italic');
    if (!fig) return;
    var I = D.italic, upm = I.upm, em = 240, s = em / upm, base = 210;
    var svg = el('svg', { viewBox: '0 0 720 300', role: 'img',
      'aria-label': 'The letters a, v and w: upright, slanted, and in the Perfidy italic.' }, null);
    fig.insertBefore(svg, fig.firstChild);
    el('line', { x1: 20, x2: 700, y1: base, y2: base, class: 'guide' }, svg);
    var chars = ['a', 'v', 'w'], cellW = 200, x0 = (720 - cellW * 3) / 2;
    var rom = chars.map(function () { return el('path', { class: 'glyph' }, svg); });
    var ita = chars.map(function () { return el('path', { class: 'glyph', opacity: 0 }, svg); });
    var tan = Math.tan(Math.abs(I.angle) * Math.PI / 180);
    function cellX(g, i) { return x0 + i * cellW + (cellW - g.adv * s) / 2; }
    function draw(sk, fade) {
      chars.forEach(function (ch, i) {
        var r = I.roman[ch], it = I.italic[ch];
        rom[i].setAttribute('d', pathD(r.c, r.n, s, cellX(r, i), base, sk * tan));
        ita[i].setAttribute('d', pathD(it.c, it.n, s, cellX(it, i), base));
        rom[i].setAttribute('opacity', 1 - fade); ita[i].setAttribute('opacity', fade);
      });
    }
    var read = fig.querySelector('.pf-read');
    var texts = ['Upright: a two-storey a, and v and w that meet the baseline in points.',
      'The same letters slanted ' + Math.abs(I.angle) + '&deg;. A slanted upright keeps every form.',
      'Perfidy Italic: a separately drawn italic from Merriweather Sans, slanted ' + Math.abs(I.angle) + '&deg;. The a has one storey and the v and w are rounded at the base.'];
    var st = { sk: 0, fade: 0 }, tw = new Tween();
    var targets = [{ sk: 0, fade: 0 }, { sk: 1, fade: 0 }, { sk: 1, fade: 1 }];
    var press = buttons(fig.querySelector('.pf-ctl'), ['Upright', 'Slanted upright', 'Perfidy Italic'], function (i) {
      var from = { sk: st.sk, fade: st.fade }, to = targets[i];
      press(i); read.innerHTML = texts[i];
      tw.run(800, function (t) { st.sk = lerp(from.sk, to.sk, t); st.fade = lerp(from.fade, to.fade, t); draw(st.sk, st.fade); });
    });
    draw(0, 0); press(0); read.innerHTML = texts[0];
    onFirstView(fig, function () {
      var b = fig.querySelectorAll('.pf-ctl button');
      setTimeout(function () { b[1].click(); setTimeout(function () { b[2].click(); }, 1300); }, 600);
    });
  }());

  /* ------------------------------------------------------------------ 5. mono cells */
  (function () {
    var fig = document.getElementById('pf-mono');
    if (!fig) return;
    var M = D.mono, upm = M.upm, em = 230, base = 200, chars = ['m', 'i', 'l'];
    var svg = el('svg', { viewBox: '0 0 720 270', role: 'img',
      'aria-label': 'The letters m, i and l from IBM Plex Mono in their character cells, before and after Perfidy rescales them and narrows the cells.' }, null);
    fig.insertBefore(svg, fig.firstChild);
    el('line', { x1: 20, x2: 700, y1: base, y2: base, class: 'guide' }, svg);
    var xhl = el('line', { x1: 20, x2: 700, class: 'guide moss' }, svg);
    el('line', { x1: 20, x2: 700, y1: base - 0.5 * em, y2: base - 0.5 * em, class: 'guide acc' }, svg);
    var cells = chars.map(function () { return el('rect', { class: 'cell', height: em * 0.95 }, svg); });
    var paths = chars.map(function () { return el('path', { class: 'glyph' }, svg); });
    var read = fig.querySelector('.pf-read');
    function draw(t) {
      var k = lerp(1, M.scale, t), adv = lerp(M.adv_before, M.adv_after, t), s = em / upm;
      var cw = adv * s, x0 = (720 - cw * 3) / 2;
      chars.forEach(function (ch, i) {
        var g = M.glyphs[ch], x = x0 + i * cw;
        cells[i].setAttribute('x', x); cells[i].setAttribute('width', cw); cells[i].setAttribute('y', base - em * 0.72);
        paths[i].setAttribute('d', pathD(g.c, g.n, s * k, x, base));
      });
      var xh = M.xh_before * k;
      xhl.setAttribute('y1', base - xh * em); xhl.setAttribute('y2', base - xh * em);
      read.innerHTML = '<span class="k">cell</span> ' + fmt(adv / upm, 3) + ' em &middot; <span class="k">x-height</span> ' + fmt(xh, 3) + ' em';
    }
    var state = 0, tw = new Tween();
    var press = buttons(fig.querySelector('.pf-ctl'), ['IBM Plex Mono', 'Perfidy Mono'], function (i) {
      var from = state; state = i; press(i); tw.run(900, function (t) { draw(lerp(from, i, t)); });
    });
    draw(0); press(0);
    onFirstView(fig, function () { setTimeout(function () { fig.querySelectorAll('.pf-ctl button')[1].click(); }, 500); });
  }());
}());
