/* charts.js - the insight kit's chart primitives (R1, 2026-10-23).
 *
 * Four charts and a number formatter, enough for the reworked pages:
 *   series  a time series that draws as the reader scrolls; annotations
 *           appear when the line reaches their date; an optional band fills
 *           the gap between two series, in one colour where the first is
 *           above the second and another where it is below. spec.under adds
 *           panels below the plot on the same x scale (bars by year, or a
 *           second line on its own y), revealed with the lines.
 *   split   one bar, the total, that opens into its parts ("where it goes").
 *   strip   a cross-section as a histogram, with lit overlays, a shaded
 *           range and marks (R3, lostgas.html).
 *   days    one bar per day of a year, two years blended, a running
 *           counter and a lit subset of days (R4, storage.html).
 *
 * ONE IMPLEMENTATION, TWO CONSUMERS. render(spec, state, opt) returns an SVG
 * string and touches no DOM, so the build runs it in node (kit_render.js) to
 * write the figure each step shows when there is no JS or the reader has
 * asked for less motion, and the browser runs the same code for the live
 * chart. The static story and the animated one cannot disagree because they
 * are the same function.
 *
 * update(svg, spec, state) moves a live chart to a new state by setting
 * attributes, never by rebuilding. Every attribute it sets comes from dyn(),
 * the same function render() writes them from, and tests/test_kit.js asserts
 * that update() from any state lands byte-equal to render() of the target.
 *
 * Text is drawn at the size it is served. All chart text is IBM Plex Mono,
 * whose advance is 0.6 em, so a label's width is known here without a DOM
 * (FS and CW below). scrolly.css sets the same sizes on .chart text, and
 * test_kit.js measures rendered labels against these widths, so a stylesheet
 * that stops applying fails a test rather than overlapping labels (trap 31).
 *
 * Layout that cannot fit throws when opt.strict is set: the build renders
 * every spec strictly at both shipped widths and Charts.check() sweeps the
 * widths in between, so a label that collides fails the build, never ships as
 * the least-bad placement (trap 37). The browser renders non-strict at the
 * container's width, which the sweep has already covered.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Charts = factory();
}(this, function () {
  'use strict';

  var FS = 12;            // chart text, px. scrolly.css: .chart text { font-size: 12px }
  var FS_BIG = 14.5;      // the date readout. scrolly.css: .chart .ch-now
  var CW = 0.6 * FS;      // Plex Mono advance at FS
  var CW_BIG = 0.6 * FS_BIG;
  var LANE = 18;          // height of one annotation lane
  var MAXLANE = 4;        // annotation lanes before a layout fails
  var WIDE = 720, PHONE = 320;   // the two widths the static figures ship at
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* A number as the site prints it: grouped thousands, a true minus sign. */
  function fmt(v, decimals) {
    var d = decimals == null ? 0 : decimals;
    var s = Math.abs(v).toFixed(d), parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    s = parts.join('.');
    return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? '−' : '') + s;
  }

  /* 'YYYY-MM' or 'YYYY' or a number -> decimal year. */
  function xval(x) {
    if (typeof x === 'number') return x;
    var m = /^(\d{4})(?:-(\d{2}))?$/.exec(x);
    if (!m) throw new Error('charts: date not YYYY or YYYY-MM: ' + x);
    return +m[1] + (m[2] ? (+m[2] - 1) / 12 : 0);
  }
  function xlabel(v) {
    var y = Math.floor(v + 1e-9), m = Math.round((v - y) * 12);
    if (m === 12) { y++; m = 0; }
    return MONTHS[m] + ' ' + y;
  }

  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), best = p;
    [1, 2, 2.5, 5, 10].forEach(function (k) { if (k * p <= raw * 1.0001) best = k * p; });
    return best;
  }
  function decimalsOf(step) {
    var d = 0; while (d < 6 && Math.abs(Math.round(step * Math.pow(10, d)) - step * Math.pow(10, d)) > 1e-9) d++;
    return d;
  }

  /* ------------------------------------------------------------ series --- */

  function seriesLayout(spec, w, strict) {
    if (!spec.x || !spec.x.length) throw new Error('charts: series ' + spec.id + ' has no x');
    var xs = spec.x.map(xval), n = xs.length;
    spec.series.forEach(function (s) {
      if (s.values.length !== n) throw new Error('charts: series ' + s.key + ' has ' + s.values.length + ' values for ' + n + ' dates');
    });
    var lo = spec.y && spec.y.min != null ? spec.y.min : 0, hi = -Infinity;
    spec.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null && v > hi) hi = v; if (v != null && v < lo) lo = v; }); });
    var step = niceStep(hi - lo, 4);
    hi = spec.y && spec.y.max != null ? spec.y.max : Math.ceil(hi / step - 1e-9) * step;
    lo = Math.floor(lo / step + 1e-9) * step;
    var dec = decimalsOf(step), yt = [];
    for (var v = lo; v <= hi + step * 1e-6; v += step) yt.push(r2(v * 1e6) / 1e6);
    var ylab = yt.map(function (v) { return fmt(v, dec); });
    var pl = Math.max.apply(null, ylab.map(function (s) { return s.length; })) * CW + 8;
    var pr = 8;

    // legend: one row of swatch + label, wrapping
    var legend = [], lx = 0, ly = 0, items = spec.series.map(function (s) { return { label: s.label, cls: 'c-' + s.color, kind: 'line' }; });
    if (spec.band) ['pos', 'neg'].forEach(function (k) { if (spec.band[k] && spec.band[k].label) items.push({ label: spec.band[k].label, cls: 'f-' + spec.band[k].color, kind: 'fill' }); });
    items.forEach(function (it) {
      var iw = 22 + it.label.length * CW + 14;
      if (lx > 0 && lx + iw > w) { lx = 0; ly += LANE; }
      if (iw > w && strict) throw new Error('charts: legend label wider than ' + w + 'px: ' + it.label);
      legend.push({ x: lx, y: ly, it: it }); lx += iw;
    });
    var top = ly + LANE + 4;

    // the date readout ("Sep 2024", eight characters at FS_BIG)
    var nowW = 8 * CW_BIG;

    // annotation lanes, greedy, in date order
    // an annotation may carry a "short" text for charts narrower than 560px
    var anns = (spec.annotations || []).map(function (a) { return { at: xval(a.at), text: w < 560 && a.short ? a.short : a.text }; })
      .sort(function (a, b) { return a.at - b.at; });
    var x0 = xs[0], x1 = xs[n - 1], pw = w - pl - pr;
    function X(v) { return pl + (v - x0) / (x1 - x0) * pw; }
    var lanes = [], placed = [];
    anns.forEach(function (a, i) {
      var tw = a.text.length * CW, ax = X(a.at), anchor, tx, L, R, lane = -1;
      function side(an) { anchor = an; tx = an === 'start' ? ax + 3 : ax - 3; L = an === 'start' ? tx : tx - tw; R = L + tw; }
      // Each annotation's rule runs from its own lane down to the axis, so a
      // label in lane k must not straddle the rule of anything in a lane
      // above it, and this one's rule must not cross a label in a lane below.
      function clear(k) {
        return lanes[k].every(function (s) { return R + 6 <= s[0] || L >= s[1] + 6; }) &&
          placed.every(function (p) {
            var pL = p.anchor === 'start' ? p.tx : p.tx - p.text.length * CW, pR = pL + p.text.length * CW;
            if (p.lane < k && p.x >= L - 4 && p.x <= R + 4) return false;
            if (p.lane > k && ax >= pL - 4 && ax <= pR + 4) return false;
            return true;
          });
      }
      // in each lane, right of the rule first, then left of it; a side that
      // leaves the canvas is not a candidate
      for (var k = 0; k < MAXLANE && lane < 0; k++) {
        if (!lanes[k]) lanes[k] = [];
        side('start'); if (R <= w && clear(k)) { lane = k; break; }
        side('end'); if (L >= 0 && clear(k)) { lane = k; break; }
      }
      if (lane < 0) side(ax + 3 + tw > w ? 'end' : 'start');
      if (lane < 0) {
        if (strict) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: annotation "' + a.text + '" fits no lane');
        lane = MAXLANE - 1;
      }
      if (L < 0 && strict) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: annotation "' + a.text + '" runs off the left edge');
      lanes[lane].push([L, R]);
      placed.push({ i: i, at: a.at, x: ax, tx: tx, anchor: anchor, lane: lane, text: a.text });
    });
    var nl = Math.max(1, lanes.length);
    // a row of its own under the lanes for the unit (left) and the date
    // readout (right), so neither can sit on an annotation
    var rowY = top + nl * LANE + 14;
    var ptop = rowY + 10;
    if (strict && ((spec.y && spec.y.label ? spec.y.label.length * CW : 0) + nowW + 12 > w - pl))
      throw new Error('charts: ' + spec.id + ' at ' + w + 'px: unit label and date readout collide');
    // the plot gets its own height; the legend, lanes and readout row sit
    // above it, so a phone chart is not all header
    var h = Math.round(ptop + (spec.plotH || Math.min(Math.max(w * 0.42, 190), 330)) + 22);
    var pb = h - 22;
    function Y(v) { return pb - (v - lo) / (hi - lo) * (pb - ptop); }

    // x ticks: whole years, at a step that keeps labels apart
    var pxYear = pw / (x1 - x0), ystep = [1, 2, 5, 10, 20].filter(function (k) { return k * pxYear >= 4 * CW + 12; })[0] || 50;
    var xt = [];
    for (var yv = Math.ceil(x0 - 1e-9); yv <= x1 + 1e-9; yv++) if (yv % ystep === 0) xt.push(yv);

    // panels under the plot (R2, 2026-10-23): same x scale, own y, drawn
    // inside the same reveal clip so they move in step with the lines. They
    // carry no state, so update()/render() parity is untouched.
    var under = (spec.under || []).map(function (u) {
      var PH = u.height || 64, top0 = h + 6, ly = top0 + 12, py0 = top0 + LANE + 4, py1 = py0 + PH;
      if (strict && u.label.length * CW > w) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: panel label wider than the chart: ' + u.label);
      var P = { u: u, ly: ly, py0: py0, py1: py1 };
      if (u.kind === 'bars') {
        var mx = Math.max.apply(null, u.bars.map(function (b) { return b.value; })) || 1;
        P.bars = u.bars.map(function (b) {
          var a = Math.max(xval(b.at), x0), z = Math.min(xval(b.at) + 1, x1);
          var bx = X(a) + 1, bw = Math.max(X(z) - X(a) - 2, 1), bh = (PH - LANE) * b.value / mx;
          var tw = String(b.text).length * CW;
          if (strict && tw > X(z) - X(a) + 4) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: bar label "' + b.text + '" wider than its year');
          return { x: bx, w: bw, y: py1 - bh, h: bh, tx: bx + bw / 2, ty: py1 - bh - 4, text: b.text };
        });
      } else if (u.kind === 'line') {
        var vmax = Math.max.apply(null, u.values.filter(function (v) { return v != null; }));
        var st = niceStep(vmax, 2), top = Math.ceil(vmax / st - 1e-9) * st;
        P.Y = function (v) { return py1 - v / top * (PH - 6); };
        P.top = top; P.dec = decimalsOf(st);
      } else throw new Error('charts: unknown panel kind ' + u.kind);
      h = Math.round(py1 + 18);
      return P;
    });

    return { w: w, h: h, xs: xs, X: X, Y: Y, pl: pl, pr: pr, pw: pw, ptop: ptop, pb: pb, under: under,
             yt: yt, ylab: ylab, xt: xt, legend: legend, anns: placed, laneTop: top, nowW: nowW, rowY: rowY, lo: lo, hi: hi };
  }

  function pathOf(L, xs, vals, i0, i1) {
    var d = '', pen = false;
    for (var i = i0; i <= i1; i++) {
      if (vals[i] == null) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + r2(L.X(xs[i])) + ' ' + r2(L.Y(vals[i]));
      pen = true;
    }
    return d;
  }

  /* The gap between series a and b as two sets of polygons: where a > b
     (pos) and where a < b (neg), split exactly at each crossing. */
  function bandPaths(L, a, b) {
    var xs = L.xs, pos = '', neg = '', run = null;
    function close(r) {
      if (!r || r.top.length < 2) return;
      var d = 'M' + r.top.map(function (p) { return r2(L.X(p[0])) + ' ' + r2(L.Y(p[1])); }).join('L');
      d += 'L' + r.bot.slice().reverse().map(function (p) { return r2(L.X(p[0])) + ' ' + r2(L.Y(p[1])); }).join('L') + 'Z';
      if (r.sign > 0) pos += d; else neg += d;
    }
    for (var i = 0; i < xs.length; i++) {
      if (a[i] == null || b[i] == null) { close(run); run = null; continue; }
      var s = a[i] > b[i] ? 1 : a[i] < b[i] ? -1 : 0;
      if (run && s !== 0 && s !== run.sign) {
        // crossing between i-1 and i
        var d0 = a[i - 1] - b[i - 1], d1 = a[i] - b[i], f = d0 / (d0 - d1);
        var xc = xs[i - 1] + f * (xs[i] - xs[i - 1]), yc = a[i - 1] + f * (a[i] - a[i - 1]);
        run.top.push([xc, yc]); run.bot.push([xc, yc]); close(run);
        run = { sign: s, top: [[xc, yc]], bot: [[xc, yc]] };
      } else if (!run) run = { sign: s || 1, top: [], bot: [] };
      else if (run.sign === 0) run.sign = s;
      run.top.push([xs[i], a[i]]); run.bot.push([xs[i], b[i]]);
    }
    close(run);
    return { pos: pos, neg: neg };
  }

  function valueAt(xs, vals, xv) {
    for (var i = 1; i < xs.length; i++) {
      if (xv <= xs[i] + 1e-12) {
        if (vals[i - 1] == null || vals[i] == null) return vals[i] != null ? vals[i] : vals[i - 1];
        var f = (xv - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return vals[i - 1] + f * (vals[i] - vals[i - 1]);
      }
    }
    return vals[vals.length - 1];
  }

  /* Every attribute that depends on state, keyed by data-k. render() writes
     these; update() sets them. Nothing else changes between states. */
  function seriesDyn(spec, L, st) {
    var t = clamp(st.t == null ? 1 : st.t, 0, 1);
    var xv = L.xs[0] + t * (L.xs[L.xs.length - 1] - L.xs[0]);
    var rx = L.pl + t * L.pw;
    var o = {};
    o.clip = { width: r2(Math.max(rx - L.pl, 0) + 3) };
    L.anns.forEach(function (a) { o['a' + a.i] = { opacity: a.x <= rx + 0.5 ? 1 : 0 }; });
    spec.series.forEach(function (s, j) {
      var v = valueAt(L.xs, s.values, xv);
      o['dot' + j] = { cx: r2(rx), cy: r2(L.Y(v)), opacity: t > 0 ? 1 : 0 };
    });
    o.now = { _text: xlabel(xv) };
    return o;
  }

  function renderSeries(spec, st, w, opt) {
    var L = seriesLayout(spec, w, opt.strict), id = esc(spec.id + (opt.suffix || ''));
    var D = seriesDyn(spec, L, st), s = [];
    function A(k) {
      var a = D[k], out = '';
      for (var n in a) if (n !== '_text') out += ' ' + n + '="' + esc(a[n]) + '"';
      return ' data-k="' + k + '"' + out;
    }
    s.push('<svg class="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" role="img" aria-label="' + esc(spec.title) + '">');
    s.push('<defs><clipPath id="' + id + '-clip"><rect data-k="clip" x="' + r2(L.pl - 3) + '" y="0" width="' + D.clip.width + '" height="' + L.h + '"/></clipPath></defs>');
    // legend
    L.legend.forEach(function (g) {
      var y = g.y + 12;
      s.push(g.it.kind === 'line'
        ? '<line class="ch-line ' + g.it.cls + '" x1="' + g.x + '" y1="' + (y - 4) + '" x2="' + (g.x + 16) + '" y2="' + (y - 4) + '"/>'
        : '<rect class="ch-band ' + g.it.cls + '" x="' + g.x + '" y="' + (y - 10) + '" width="16" height="10"/>');
      s.push('<text class="ch-leg" x="' + (g.x + 22) + '" y="' + y + '">' + esc(g.it.label) + '</text>');
    });
    // grid and y ticks
    L.yt.forEach(function (v, i) {
      var y = r2(L.Y(v));
      s.push('<line class="ch-grid" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + y + '" y2="' + y + '"/>');
      s.push('<text class="ch-tick" x="' + (L.pl - 8) + '" y="' + r2(y + 4) + '" text-anchor="end">' + esc(L.ylab[i]) + '</text>');
    });
    if (spec.y && spec.y.label) s.push('<text class="ch-tick ch-unit" x="' + L.pl + '" y="' + L.rowY + '">' + esc(spec.y.label) + '</text>');
    L.xt.forEach(function (v) {
      var x = r2(L.X(v));
      s.push('<line class="ch-axis" x1="' + x + '" x2="' + x + '" y1="' + L.pb + '" y2="' + (L.pb + 4) + '"/>');
      s.push('<text class="ch-tick" x="' + x + '" y="' + (L.pb + 17) + '" text-anchor="middle">' + v + '</text>');
    });
    s.push('<line class="ch-axis" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + L.pb + '" y2="' + L.pb + '"/>');
    // annotations: rule from the lane to the axis, label in its lane
    L.anns.forEach(function (a) {
      var ly = L.laneTop + a.lane * LANE + 12;
      s.push('<g class="ch-ann"' + A('a' + a.i) + '>' +
        '<line x1="' + r2(a.x) + '" x2="' + r2(a.x) + '" y1="' + (ly + 4) + '" y2="' + L.pb + '"/>' +
        '<text x="' + r2(a.tx) + '" y="' + ly + '" text-anchor="' + a.anchor + '">' + esc(a.text) + '</text></g>');
    });
    // data, clipped to the reveal
    s.push('<g clip-path="url(#' + id + '-clip)">');
    if (spec.band) {
      var ka = spec.series.filter(function (x) { return x.key === spec.band.a; })[0];
      var kb = spec.series.filter(function (x) { return x.key === spec.band.b; })[0];
      if (!ka || !kb) throw new Error('charts: band names a series that is not there');
      var bp = bandPaths(L, ka.values, kb.values);
      if (spec.band.pos && bp.pos) s.push('<path class="ch-band f-' + spec.band.pos.color + '" d="' + bp.pos + '"/>');
      if (spec.band.neg && bp.neg) s.push('<path class="ch-band f-' + spec.band.neg.color + '" d="' + bp.neg + '"/>');
    }
    spec.series.forEach(function (sr) {
      s.push('<path class="ch-line c-' + sr.color + '" d="' + pathOf(L, L.xs, sr.values, 0, L.xs.length - 1) + '"/>');
    });
    L.under.forEach(function (P) {
      if (P.bars) P.bars.forEach(function (b) {
        s.push('<rect class="ch-bar f-' + P.u.color + '" x="' + r2(b.x) + '" y="' + r2(b.y) + '" width="' + r2(b.w) + '" height="' + r2(b.h) + '"/>');
      });
      else s.push('<path class="ch-line c-' + P.u.color + '" d="' + pathOf({ X: L.X, Y: P.Y }, L.xs, P.u.values, 0, L.xs.length - 1) + '"/>');
    });
    s.push('</g>');
    // panel frames and labels sit outside the reveal, so the reader sees
    // what each panel will hold before the line reaches it
    L.under.forEach(function (P) {
      s.push('<text class="ch-leg" x="0" y="' + P.ly + '">' + esc(P.u.label) + '</text>');
      s.push('<line class="ch-axis" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + r2(P.py1) + '" y2="' + r2(P.py1) + '"/>');
      // a bar's count sits outside the reveal: clipped mid-label, "17"
      // read as "1" on the phone chart (R2 preview, 2026-10-23)
      if (P.bars) P.bars.forEach(function (b) {
        s.push('<text class="ch-tick" x="' + r2(b.tx) + '" y="' + r2(b.ty) + '" text-anchor="middle">' + esc(b.text) + '</text>');
      });
      if (P.Y) {
        s.push('<line class="ch-grid" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + r2(P.Y(P.top)) + '" y2="' + r2(P.Y(P.top)) + '"/>');
        s.push('<text class="ch-tick" x="' + (L.pl - 8) + '" y="' + r2(P.Y(P.top) + 4) + '" text-anchor="end">' + esc(fmt(P.top, P.dec)) + '</text>');
        s.push('<text class="ch-tick" x="' + (L.pl - 8) + '" y="' + r2(P.py1 + 4) + '" text-anchor="end">0</text>');
      }
    });
    spec.series.forEach(function (sr, j) { s.push('<circle class="ch-dot f-' + sr.color + '" r="3.5"' + A('dot' + j) + '/>'); });
    s.push('<text class="ch-now" x="' + L.w + '" y="' + L.rowY + '" text-anchor="end" data-k="now">' + esc(D.now._text) + '</text>');
    s.push('</svg>');
    return s.join('');
  }

  /* ------------------------------------------------------------- split --- */

  function splitLayout(spec, w, strict) {
    var tot = spec.parts.reduce(function (a, p) { return a + p.value; }, 0);
    if (spec.total && spec.total.value != null && Math.abs(spec.total.value - tot) > 1e-9 * Math.max(1, Math.abs(tot)))
      throw new Error('charts: split ' + spec.id + ' parts sum to ' + tot + ', total says ' + spec.total.value);
    var dec = spec.decimals == null ? 0 : spec.decimals, unit = spec.unit ? ' ' + spec.unit : '';
    var labels = spec.parts.map(function (p) {
      return { l1: p.label, l2: fmt(p.value, dec) + unit + ' · ' + fmt(100 * p.value / tot, 0) + '%' };
    });
    var GAP = 10, n = spec.parts.length, top = LANE + 8, barH = 34;
    // labels sit in lanes below the bar, each at its part's start at full split
    var widthFull = w - (n - 1) * GAP, x = 0, lanes = [], placed = [];
    spec.parts.forEach(function (p, i) {
      var pw = p.value / tot * widthFull, cx = x;
      var tw = Math.max(labels[i].l1.length, labels[i].l2.length) * CW;
      // the text sits 5px inside its leader line (renderSplit), so the
      // lane test uses the text's own box, offset included
      var anchor = 'start', tx = cx;
      if (tx + 5 + tw > w) { anchor = 'end'; tx = cx + pw; }
      var Lx = anchor === 'start' ? tx + 5 : tx - 5 - tw, Rx = Lx + tw, lane = -1;
      if (Lx < 0 && strict) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: "' + p.label + '" runs off the left edge');
      for (var k = 0; k < n && lane < 0; k++) {
        if (!lanes[k]) lanes[k] = [];
        if (lanes[k].every(function (s) { return Rx + 8 <= s[0] || Lx >= s[1] + 8; })) lane = k;
      }
      lanes[lane].push([Lx, Rx]);
      placed.push({ x: cx, w: pw, tx: tx, anchor: anchor, lane: lane });
      x += pw + GAP;
    });
    var h = top + barH + 14 + lanes.length * 2 * LANE + 4;
    return { w: w, h: h, tot: tot, labels: labels, parts: placed, GAP: GAP, top: top, barH: barH, dec: dec, unit: unit };
  }

  function splitDyn(spec, L, st) {
    var s = clamp(st.s == null ? 1 : st.s, 0, 1), o = {};
    var n = spec.parts.length, gap = s * L.GAP, scale = (L.w - (n - 1) * gap) / L.tot, x = 0;
    spec.parts.forEach(function (p, i) {
      var pw = p.value * scale;
      o['p' + i] = { x: r2(x), width: r2(Math.max(pw, 0.5)) };
      o['l' + i] = { opacity: r2(clamp((s - 0.5) * 2, 0, 1)) };
      x += pw + gap;
    });
    o.tot = { opacity: r2(clamp(1 - s * 2, 0, 1)) };
    return o;
  }

  function renderSplit(spec, st, w, opt) {
    var L = splitLayout(spec, w, opt.strict), D = splitDyn(spec, L, st), s = [];
    function A(k) { var a = D[k], out = ''; for (var n in a) out += ' ' + n + '="' + esc(a[n]) + '"'; return ' data-k="' + k + '"' + out; }
    s.push('<svg class="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" role="img" aria-label="' + esc(spec.title) + '">');
    if (spec.total) s.push('<text class="ch-leg" x="0" y="' + (L.top - 8) + '"' + A('tot') + '>' + esc(spec.total.label + ' ' + fmt(L.tot, L.dec) + L.unit) + '</text>');
    spec.parts.forEach(function (p, i) {
      s.push('<rect class="ch-part f-' + p.color + '" y="' + L.top + '" height="' + L.barH + '"' + A('p' + i) + '/>');
    });
    spec.parts.forEach(function (p, i) {
      var P = L.parts[i], y = L.top + L.barH + 14 + P.lane * 2 * LANE;
      s.push('<g class="ch-plab"' + A('l' + i) + '>' +
        '<line x1="' + r2(P.anchor === 'start' ? P.x : P.x + P.w) + '" x2="' + r2(P.anchor === 'start' ? P.x : P.x + P.w) + '" y1="' + (L.top + L.barH + 2) + '" y2="' + (y + 2 * LANE - 14) + '"/>' +
        '<text x="' + r2(P.tx + (P.anchor === 'start' ? 5 : -5)) + '" y="' + (y + 10) + '" text-anchor="' + P.anchor + '">' + esc(L.labels[i].l1) + '</text>' +
        '<text class="ch-v" x="' + r2(P.tx + (P.anchor === 'start' ? 5 : -5)) + '" y="' + (y + 10 + LANE - 2) + '" text-anchor="' + P.anchor + '">' + esc(L.labels[i].l2) + '</text></g>');
    });
    s.push('</svg>');
    return s.join('');
  }

  /* ------------------------------------------------------------- strip --- */
  /* A cross-section as a histogram (R3, 2026-10-23): every report in one
     year, binned by its value. spec.bins = [{a, b, n, <key>: count, ...}],
     right-inclusive (a, b]; a null a or b is an end bin that gathers a tail,
     drawn apart from the rest and labelled with its count. Overlays light the
     part of each bin a step is about (spec.lights: [{key, color, state}]), a
     shaded range (spec.range: {lo, hi, label, state}) sits behind the bars,
     and marks (spec.marks: [{at, label, state}]) are rules with a label in a
     lane above the plot. Every state key runs 0..1; t grows the bars. */

  function stripLayout(spec, w, strict) {
    var bins = spec.bins, n = bins.length;
    if (!n) throw new Error('charts: strip ' + spec.id + ' has no bins');
    var mx = Math.max.apply(null, bins.map(function (b) { return b.n; }));
    var step = niceStep(mx, 4), top = Math.ceil(mx / step - 1e-9) * step;
    var yt = []; for (var v = 0; v <= top + 1e-9; v += step) yt.push(v);
    var ylab = yt.map(function (v) { return fmt(v, 0); });
    var pl = Math.max.apply(null, ylab.map(function (s) { return s.length; })) * CW + 8, pr = 8;
    var GAP = 6, inner = bins.filter(function (b) { return b.a != null && b.b != null; });
    var a0 = inner[0].a, b1 = inner[inner.length - 1].b;
    var ends = (bins[0].a == null ? 1 : 0) + (bins[n - 1].b == null ? 1 : 0);
    var bw = (w - pl - pr - ends * GAP) / n;
    if (strict && bw < 2) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: bins under 2px');
    var xIn0 = pl + (bins[0].a == null ? bw + GAP : 0);
    function X(v) { return xIn0 + (v - a0) / (b1 - a0) * inner.length * bw; }
    var bx = bins.map(function (b, i) {
      if (b.a == null) return pl;
      if (b.b == null) return X(b1) + GAP;
      return X(b.a);
    });
    // label lanes above the plot: one per mark and one for the range, in
    // order, each label clamped to the canvas and refused if wider than it
    var labs = [];
    if (spec.range) labs.push({ k: 'rl', x: (X(spec.range.lo) + X(spec.range.hi)) / 2, text: spec.range.label, mid: true });
    (spec.marks || []).forEach(function (m, i) { labs.push({ k: 'ml' + i, x: X(m.at), text: m.label }); });
    labs.forEach(function (l, i) {
      var tw = l.text.length * CW;
      if (tw > w && strict) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: label wider than the chart: ' + l.text);
      var L = l.mid ? l.x - tw / 2 : l.x + 3;
      if (!l.mid && L + tw > w) L = l.x - 3 - tw;
      l.L = clamp(L, 0, Math.max(w - tw, 0)); l.lane = i; l.y = i * LANE + 12;
    });
    var ptop = labs.length * LANE + 26;
    var pb = Math.round(ptop + (spec.plotH || Math.min(Math.max(w * 0.4, 180), 300)));
    function Y(c) { return pb - c / top * (pb - ptop); }
    // x ticks at whole values inside the inner range, at a step that keeps them apart
    var span = b1 - a0, pxu = inner.length * bw / span;
    var xs = [1, 2, 5, 10, 20].filter(function (k) { return k * pxu >= 5 * CW + 10; })[0] || 50, xt = [];
    for (var t = Math.ceil(a0 / xs) * xs; t <= b1 + 1e-9; t += xs) xt.push(t);
    var h = pb + 22 + (spec.x && spec.x.label ? LANE : 0);
    if (strict && spec.x && spec.x.label && spec.x.label.length * CW > w) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: x label wider than the chart');
    return { w: w, h: h, pl: pl, pr: pr, pb: pb, ptop: ptop, X: X, Y: Y, bx: bx, bw: bw, top: top, yt: yt, ylab: ylab,
             xt: xt, labs: labs, b1: b1, GAP: GAP };
  }

  function stripDyn(spec, L, st) {
    var t = clamp(st.t == null ? 1 : st.t, 0, 1), o = {};
    function sv(k) { return clamp(st[k] == null ? 0 : st[k], 0, 1); }
    spec.bins.forEach(function (b, i) {
      var y = L.Y(b.n * t);
      o['b' + i] = { y: r2(y), height: r2(L.pb - y) };
      (spec.lights || []).forEach(function (lt, j) {
        var yy = L.Y((b[lt.key] || 0) * t);
        o['l' + j + '_' + i] = { y: r2(yy), height: r2(L.pb - yy) };
      });
    });
    (spec.lights || []).forEach(function (lt, j) { o['lg' + j] = { opacity: r2(sv(lt.state)) }; });
    if (spec.range) {
      var p = sv(spec.range.state), c = (L.X(spec.range.lo) + L.X(spec.range.hi)) / 2, hw = (L.X(spec.range.hi) - L.X(spec.range.lo)) / 2 * p;
      o.range = { x: r2(c - hw), width: r2(2 * hw) };
      o.rl = { opacity: r2(p) };
    }
    (spec.marks || []).forEach(function (m, i) { o['m' + i] = { opacity: r2(sv(m.state)) }; });
    return o;
  }

  function renderStrip(spec, st, w, opt) {
    var L = stripLayout(spec, w, opt.strict), D = stripDyn(spec, L, st), s = [];
    function A(k) { var a = D[k], out = ''; for (var n in a) out += ' ' + n + '="' + esc(a[n]) + '"'; return ' data-k="' + k + '"' + out; }
    s.push('<svg class="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" role="img" aria-label="' + esc(spec.title) + '">');
    if (spec.range) s.push('<rect class="ch-band f-moss" y="' + L.ptop + '" height="' + (L.pb - L.ptop) + '"' + A('range') + '/>');
    L.yt.forEach(function (v, i) {
      var y = r2(L.Y(v));
      s.push('<line class="ch-grid" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + y + '" y2="' + y + '"/>');
      s.push('<text class="ch-tick" x="' + (L.pl - 8) + '" y="' + r2(y + 4) + '" text-anchor="end">' + esc(L.ylab[i]) + '</text>');
    });
    if (spec.y && spec.y.label) s.push('<text class="ch-tick ch-unit" x="' + L.pl + '" y="' + (L.ptop - 8) + '">' + esc(spec.y.label) + '</text>');
    spec.bins.forEach(function (b, i) {
      s.push('<rect class="ch-bar f-dim" x="' + r2(L.bx[i] + 0.5) + '" width="' + r2(Math.max(L.bw - 1, 1)) + '"' + A('b' + i) + '/>');
    });
    (spec.lights || []).forEach(function (lt, j) {
      s.push('<g class="ch-light"' + A('lg' + j) + '>');
      spec.bins.forEach(function (b, i) {
        s.push('<rect class="ch-bar f-' + lt.color + '" x="' + r2(L.bx[i] + 0.5) + '" width="' + r2(Math.max(L.bw - 1, 1)) + '"' + A('l' + j + '_' + i) + '/>');
      });
      s.push('</g>');
    });
    s.push('<line class="ch-axis" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + L.pb + '" y2="' + L.pb + '"/>');
    L.xt.forEach(function (v) {
      var x = r2(L.X(v));
      s.push('<line class="ch-axis" x1="' + x + '" x2="' + x + '" y1="' + L.pb + '" y2="' + (L.pb + 4) + '"/>');
      s.push('<text class="ch-tick" x="' + x + '" y="' + (L.pb + 17) + '" text-anchor="middle">' + esc(fmt(v, 0)) + '</text>');
    });
    // the end bins carry their counts, since their height is a tail, not a
    // bin; anchored inward so a count never runs off the canvas
    spec.bins.forEach(function (b, i) {
      if (b.a != null && b.b != null) return;
      var x = b.a == null ? r2(L.bx[i]) : r2(L.bx[i] + L.bw);
      s.push('<text class="ch-tick" x="' + x + '" y="' + r2(L.Y(b.n) - 4) + '" text-anchor="' + (b.a == null ? 'start' : 'end') + '">' + fmt(b.n, 0) + '</text>');
    });
    if (spec.x && spec.x.label) s.push('<text class="ch-tick" x="' + L.pl + '" y="' + (L.pb + 17 + LANE) + '">' + esc(spec.x.label) + '</text>');
    (spec.marks || []).forEach(function (m, i) {
      var x = r2(L.X(m.at)), lb = L.labs.filter(function (l) { return l.k === 'ml' + i; })[0];
      s.push('<g class="ch-ann"' + A('m' + i) + '><line x1="' + x + '" x2="' + x + '" y1="' + (lb.y + 4) + '" y2="' + L.pb + '"/>' +
        '<text x="' + r2(lb.L) + '" y="' + lb.y + '">' + esc(m.label) + '</text></g>');
    });
    if (spec.range) {
      var rl = L.labs[0];
      s.push('<text class="ch-rl"' + A('rl') + ' x="' + r2(rl.L) + '" y="' + rl.y + '">' + esc(spec.range.label) + '</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  /* -------------------------------------------------------------- days --- */
  /* One bar per day of a year (R4, storage.html): what a battery made that
     day. Two years in one spec, spec.a and spec.b, each {label, start
     'YYYY-MM-DD', values: [per day], half: [day indices]}; the state blends
     the bar heights from a to b (mix), reveals the days left to right (t),
     and dims every day outside the year's "half" set (lit). Both years share
     one y scale, so a quiet year looks quiet beside a loud one. A counter in
     the header sums the days revealed so far; its text, the year label and
     the half label are the only text that changes. Every state key is 0..1. */

  function daysLayout(spec, w, strict) {
    var A = spec.a, B = spec.b || spec.a, n = Math.max(A.values.length, B.values.length);
    if (!n) throw new Error('charts: days ' + spec.id + ' has no days');
    var all = A.values.concat(B.values), hi = Math.max.apply(null, all), lo = Math.min(0, Math.min.apply(null, all));
    var step = niceStep(hi - lo, 4);
    hi = Math.ceil(hi / step - 1e-9) * step; lo = Math.floor(lo / step + 1e-9) * step;
    var dec = decimalsOf(step), yt = [];
    for (var v = lo; v <= hi + step * 1e-6; v += step) yt.push(r2(v * 1e6) / 1e6);
    var ylab = yt.map(function (v) { return fmt(v, dec); });
    var pl = Math.max.apply(null, ylab.map(function (s) { return s.length; })) * CW + 8, pr = 8;
    // header: year label and counter on one row (left), the half label on the next
    // the counter's widest text is the larger year's sum of its positive days
    function posSum(vs) { return vs.reduce(function (a, v) { return a + (v > 0 ? v : 0); }, 0); }
    var c = spec.counter || {}, cmax = Math.max(posSum(A.values), posSum(B.values));
    var cntW = ((c.prefix || '') + fmt(cmax, c.decimals || 0)).length * CW_BIG +
      Math.max(String(c.unit || '').length, String(c.unitDone || '').length) * CW_BIG;
    var yrW = Math.max(String(A.label).length, String(B.label).length) * CW_BIG + 12;
    if (strict && yrW + cntW > w) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: year and counter do not fit one row');
    var hw = Math.max(String(A.halfText || '').length, String(B.halfText || '').length) * CW;
    if (strict && hw > w) throw new Error('charts: ' + spec.id + ' at ' + w + 'px: half label wider than the chart');
    var row1 = 16, row2 = row1 + LANE + 4, unitY = row2 + LANE;
    var ptop = unitY + 10;
    var pb = Math.round(ptop + (spec.plotH || Math.min(Math.max(w * 0.38, 170), 300)));
    var pw = w - pl - pr, bw = pw / n;
    function X(i) { return pl + i * bw; }
    function Y(v) { return pb - (v - lo) / (hi - lo) * (pb - ptop); }
    // month ticks from the first year's calendar; labels thinned to fit
    var m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(A.start);
    if (!m0) throw new Error('charts: days start not YYYY-MM-DD: ' + A.start);
    var mt = [], day = 0, yy = +m0[1];
    for (var m = 0; m < 12; m++) {
      mt.push({ i: day, label: MONTHS[m] });
      day += [31, (yy % 4 === 0 && (yy % 100 !== 0 || yy % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
    }
    var every = [1, 2, 3, 6].filter(function (k) { return k * 30 * bw >= 3 * CW + 8; })[0] || 12;
    mt = mt.filter(function (t, k) { return k % every === 0; });
    var h = pb + 22;
    return { w: w, h: h, n: n, pl: pl, pr: pr, pw: pw, bw: bw, ptop: ptop, pb: pb, X: X, Y: Y, yt: yt, ylab: ylab,
             mt: mt, row1: row1, row2: row2, unitY: unitY, lo: lo, hi: hi };
  }

  function daysDyn(spec, L, st) {
    var t = clamp(st.t == null ? 1 : st.t, 0, 1), mix = clamp(st.mix == null ? 0 : st.mix, 0, 1);
    var lit = clamp(st.lit == null ? 0 : st.lit, 0, 1), A = spec.a, B = spec.b || spec.a;
    var cur = mix < 0.5 ? A : B, half = {}, o = {}, sum = 0, shown = Math.round(t * L.n);
    (cur.half || []).forEach(function (i) { half[i] = 1; });
    for (var i = 0; i < L.n; i++) {
      var a = A.values[i] || 0, b = B.values[i] || 0, v = a + (b - a) * mix;
      var y0 = L.Y(0), y1 = L.Y(v);
      o['d' + i] = { y: r2(Math.min(y0, y1)), height: r2(Math.abs(y0 - y1)),
                     opacity: r2(half[i] ? 1 : 1 - 0.75 * lit) };
      if (i < shown) sum += v;
    }
    var c = spec.counter || {};
    o.clip = { width: r2(t * L.pw + 1) };
    // the counter says "so far" while days remain to draw, and its unitDone once they are all drawn
    o.cnt = { _text: (c.prefix || '') + fmt(sum, c.decimals || 0) + ((shown >= L.n && c.unitDone != null) ? c.unitDone : (c.unit || '')) };
    o.yr = { _text: String(cur.label) };
    o.hl = { opacity: r2(lit), _text: (cur.halfText || '') };
    return o;
  }

  function renderDays(spec, st, w, opt) {
    var L = daysLayout(spec, w, opt.strict), D = daysDyn(spec, L, st), s = [], id = esc(spec.id + (opt.suffix || ''));
    function A(k) { var a = D[k], out = ''; for (var n in a) if (n !== '_text') out += ' ' + n + '="' + esc(a[n]) + '"'; return ' data-k="' + k + '"' + out; }
    s.push('<svg class="chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" role="img" aria-label="' + esc(spec.title) + '">');
    s.push('<defs><clipPath id="' + id + '-clip"><rect data-k="clip" x="' + L.pl + '" y="0" width="' + D.clip.width + '" height="' + L.h + '"/></clipPath></defs>');
    s.push('<text class="ch-now" x="0" y="' + L.row1 + '"' + A('yr') + '>' + esc(D.yr._text) + '</text>');
    s.push('<text class="ch-now ch-cnt" x="' + L.w + '" y="' + L.row1 + '" text-anchor="end"' + A('cnt') + '>' + esc(D.cnt._text) + '</text>');
    s.push('<text class="ch-rl" x="0" y="' + L.row2 + '"' + A('hl') + '>' + esc(D.hl._text) + '</text>');
    L.yt.forEach(function (v, i) {
      var y = r2(L.Y(v));
      s.push('<line class="ch-grid" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + y + '" y2="' + y + '"/>');
      s.push('<text class="ch-tick" x="' + (L.pl - 8) + '" y="' + r2(y + 4) + '" text-anchor="end">' + esc(L.ylab[i]) + '</text>');
    });
    if (spec.y && spec.y.label) s.push('<text class="ch-tick ch-unit" x="' + L.pl + '" y="' + L.unitY + '">' + esc(spec.y.label) + '</text>');
    s.push('<g clip-path="url(#' + id + '-clip)">');
    var bw = r2(Math.max(L.bw - (L.bw > 2 ? 0.5 : 0), 0.6));
    for (var i = 0; i < L.n; i++) s.push('<rect class="ch-bar f-acc" x="' + r2(L.X(i)) + '" width="' + bw + '"' + A('d' + i) + '/>');
    s.push('</g>');
    s.push('<line class="ch-axis" x1="' + L.pl + '" x2="' + (L.w - L.pr) + '" y1="' + r2(L.Y(0)) + '" y2="' + r2(L.Y(0)) + '"/>');
    L.mt.forEach(function (m) {
      var x = r2(L.X(m.i));
      s.push('<line class="ch-axis" x1="' + x + '" x2="' + x + '" y1="' + L.pb + '" y2="' + (L.pb + 4) + '"/>');
      s.push('<text class="ch-tick" x="' + x + '" y="' + (L.pb + 17) + '">' + m.label + '</text>');
    });
    s.push('</svg>');
    return s.join('');
  }

  /* ------------------------------------------------------------ public --- */

  var KINDS = { series: { render: renderSeries, layout: seriesLayout, dyn: seriesDyn },
                split: { render: renderSplit, layout: splitLayout, dyn: splitDyn },
                strip: { render: renderStrip, layout: stripLayout, dyn: stripDyn },
                days: { render: renderDays, layout: daysLayout, dyn: daysDyn } };

  function kind(spec) {
    var k = KINDS[spec.type];
    if (!k) throw new Error('charts: unknown type ' + spec.type);
    return k;
  }

  function render(spec, state, opt) {
    opt = opt || {};
    return kind(spec).render(spec, state || {}, Math.round(opt.width || WIDE), opt);
  }

  /* Set every state-dependent attribute on a live chart. The width must be
     the one it was rendered at; the scaffold re-renders on resize. */
  function update(svg, spec, state) {
    var k = kind(spec), w = +svg.getAttribute('width');
    var D = k.dyn(spec, k.layout(spec, w, false), state || {});
    // One lookup table per drawn svg, built on its first update: a days
    // chart carries 365 keyed bars, and a querySelector per key per frame made
    // every scroll frame scan the whole svg 365 times (R4, 2026-10-23).
    var map = svg.__keyed;
    if (!map) {
      map = svg.__keyed = {};
      var all = svg.querySelectorAll('[data-k]');
      for (var j = 0; j < all.length; j++) map[all[j].getAttribute('data-k')] = all[j];
    }
    for (var key in D) {
      var el = map[key];
      if (!el) continue;
      for (var n in D[key]) {
        if (n === '_text') { if (el.textContent !== D[key][n]) el.textContent = D[key][n]; }
        else el.setAttribute(n, String(D[key][n]));
      }
    }
  }

  /* Render strictly at every width from PHONE to the widest column, in 10px
     steps, and return what failed. The build calls this; the browser never
     needs to. */
  function check(spec, maxW) {
    var bad = [];
    for (var w = PHONE; w <= (maxW || 1140); w += 10) {
      try { render(spec, {}, { width: w, strict: true }); } catch (e) { bad.push(e.message); }
    }
    return bad;
  }

  /* Linear interpolation between two states, key by key. Keys that are not
     numbers switch at the midpoint. */
  function lerp(a, b, p) {
    var o = {}, k;
    for (k in b) {
      var av = a && a[k] != null ? a[k] : b[k];
      o[k] = typeof b[k] === 'number' && typeof av === 'number' ? av + (b[k] - av) * p : (p < 0.5 ? av : b[k]);
    }
    return o;
  }

  return { render: render, update: update, check: check, lerp: lerp, fmt: fmt, xlabel: xlabel,
           FS: FS, FS_BIG: FS_BIG, CW: CW, WIDE: WIDE, PHONE: PHONE };
}));
