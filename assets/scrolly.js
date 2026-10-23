/* scrolly.js - the insight kit's scroll scaffold (R1, 2026-10-23).
 *
 * Markup (written by insight.py, never by hand):
 *
 *   <section class="scrolly wide" id="...">
 *     <script type="application/json" class="scrolly-spec">{chart spec}</script>
 *     <div class="scrolly-stage" role="img" aria-label="..."></div>
 *     <div class="scrolly-steps">
 *       <div class="step" data-state='{"t":0.4}'>
 *         <p>...</p>
 *         <figure class="step-fig">static SVG at two widths</figure>
 *       </div> ...
 *     </div>
 *   </section>
 *
 * The page works with none of this running. scrolly.js makes a section live
 * only when motion is on (the motion contract, assets/motion.js): it renders
 * the chart into the stage, adds .is-live, and from then on the chart's state
 * follows the reader. Between two steps the state is interpolated by how far
 * the incoming step has travelled up the screen, so a line draws as you
 * scroll rather than jumping. On "motionchange" to off it tears down and the
 * section is the stacked figures again.
 *
 * IntersectionObserver gates the work: the scroll handler is attached only
 * while a section is on screen, and runs at most once per frame. Off screen,
 * a section costs nothing.
 *
 * Also here, because they share the motion contract and the observer:
 *   a.counter  counts up to the value it already shows, once, on first view.
 *   figure.clip  a play button on the poster; a short loop plays muted while
 *                in view.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window) || !window.Charts) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  /* ---------------------------------------------------------- scrolly --- */
  function Scrolly(sec) {
    this.sec = sec;
    this.spec = JSON.parse(sec.querySelector('.scrolly-spec').textContent);
    this.stage = sec.querySelector('.scrolly-stage');
    this.steps = [].slice.call(sec.querySelectorAll('.step'));
    this.states = this.steps.map(function (s) { return JSON.parse(s.getAttribute('data-state') || '{}'); });
    this.from = JSON.parse(sec.getAttribute('data-from') || '{}');
    this.live = false; this.raf = 0; this.width = 0;
    var self = this;
    this.onScroll = function () { if (!self.raf) self.raf = requestAnimationFrame(function () { self.raf = 0; self.tick(); }); };
    this.onResize = function () { if (self.live) { self.draw(); self.tick(); } };
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { window.addEventListener('scroll', self.onScroll, { passive: true }); self.tick(); }
        else window.removeEventListener('scroll', self.onScroll);
      });
    });
  }
  Scrolly.prototype.draw = function () {
    var w = Math.max(Charts.PHONE, Math.min(this.stage.clientWidth || this.sec.clientWidth, 1140));
    this.width = w;
    this.stage.innerHTML = Charts.render(this.spec, this.state || this.from, { width: w, suffix: '-live' });
    this.svg = this.stage.querySelector('svg');
  };
  /* Which state the chart should be in, from where the steps are. */
  Scrolly.prototype.target = function () {
    var vh = window.innerHeight, sb = this.stage.getBoundingClientRect().bottom;
    var span = Math.max(80, 0.7 * (vh - sb)), prev = this.from, out = this.from, active = -1;
    for (var i = 0; i < this.steps.length; i++) {
      var top = this.steps[i].getBoundingClientRect().top;
      if (top >= vh) break;
      var p = Math.min(1, Math.max(0, (vh - top) / span));
      out = Charts.lerp(prev, this.states[i], p);
      prev = this.states[i]; active = i;
    }
    return { state: out, active: active };
  };
  Scrolly.prototype.tick = function () {
    if (!this.live) return;
    var t = this.target();
    this.state = t.state;
    Charts.update(this.svg, this.spec, t.state);
    for (var i = 0; i < this.steps.length; i++) this.steps[i].classList.toggle('is-active', i === t.active);
  };
  Scrolly.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.sec.classList.add('is-live');
    this.draw();
    this.io.observe(this.sec);
    window.addEventListener('resize', this.onResize);
    this.tick();
  };
  Scrolly.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    this.sec.classList.remove('is-live');
    this.stage.innerHTML = '';
    this.svg = null;
  };

  /* ---------------------------------------------------------- counter --- */
  /* The element already reads the final value. Counting up is decoration on
     a number that is correct without it, so it runs once, only with motion
     on, and ends on exactly the text the page shipped with. */
  function count(el) {
    var to = parseFloat(el.getAttribute('data-value')), dec = +(el.getAttribute('data-decimals') || 0);
    var final = el.textContent, t0 = null, dur = 900;
    if (!isFinite(to)) return;
    function f(now) {
      if (t0 === null) t0 = now;
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? Charts.fmt(to * e, dec) : final;
      if (p < 1 && motionOn()) requestAnimationFrame(f); else el.textContent = final;
    }
    requestAnimationFrame(f);
  }

  /* ------------------------------------------------------------- clip --- */
  function Clip(fig) {
    var v = fig.querySelector('video'), btn = fig.querySelector('.clip-play'), loop = fig.getAttribute('data-loop') === '1';
    if (!v || !btn) return;
    v.removeAttribute('controls');
    btn.hidden = false;
    function play() { btn.hidden = true; v.setAttribute('controls', ''); var p = v.play(); if (p && p.catch) p.catch(function () { btn.hidden = false; }); }
    btn.addEventListener('click', play);
    v.addEventListener('ended', function () { if (!v.loop) btn.hidden = false; });
    if (!loop) return;
    v.muted = true; v.loop = true;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && motionOn()) { v.preload = 'auto'; btn.hidden = true; var p = v.play(); if (p && p.catch) p.catch(function () { btn.hidden = false; }); }
        else if (!v.paused) v.pause();
      });
    }, { threshold: 0.5 }).observe(v);
    document.addEventListener('motionchange', function (e) { if (e.detail === 'off' && !v.paused) { v.pause(); btn.hidden = false; } });
  }

  /* ------------------------------------------------------------- boot --- */
  var all = [].slice.call(document.querySelectorAll('section.scrolly')).map(function (s) { return new Scrolly(s); });
  function sync() { all.forEach(function (s) { if (motionOn()) s.start(); else s.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();

  var counters = [].slice.call(document.querySelectorAll('a.counter[data-value]'));
  if (counters.length) {
    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { cio.unobserve(e.target); if (motionOn()) count(e.target); } });
    }, { threshold: 1 });
    counters.forEach(function (c) { cio.observe(c); });
  }
  [].forEach.call(document.querySelectorAll('figure.clip'), Clip);

  // test hook, as atlas-app.js exposes __atlasUI: the live scaffolds
  window.__scrolly = all;
}());
