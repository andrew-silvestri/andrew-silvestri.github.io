/* origins.js - lights one state of the membrane hero on origins.html as the reader scrolls (2026-11-13).
 *
 * Markup (written by origins/update_page.py):
 *   <figure class="grad wide">
 *     <div class="grad-fig"> two SVGs (.hero-wide, .hero-phone) whose panels are <g class="st" data-s="k">,
 *       k = 0 vent .. 4 equilibrium </div>
 *     <div class="grad-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: every state shows. With motion on (assets/motion.js), the
 * figure sticks, and the step whose card crosses the middle of the screen is lit: its panel gets .now,
 * later panels get .off. With motion off, or on "motionchange" to off, it tears down. The idiom is
 * chain.js's.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Grad(sec) {
    var self = this;
    this.sec = sec;
    this.els = [].slice.call(sec.querySelectorAll('.og .st[data-s]'));
    this.steps = [].slice.call(sec.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) self.set(+e.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-50% 0px -49% 0px' });
  }
  Grad.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.els.forEach(function (el) {
      var s = +el.getAttribute('data-s');
      el.classList.toggle('off', s > k);
      el.classList.toggle('now', s === k);
    });
  };
  Grad.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.sec.classList.add('is-live');
    var io = this.io;
    this.steps.forEach(function (s) { io.observe(s); });
    var mid = window.innerHeight / 2, k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < mid) k = +s.getAttribute('data-step'); });
    this.set(k);
  };
  Grad.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    this.sec.classList.remove('is-live');
    this.els.forEach(function (el) { el.classList.remove('off', 'now'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.grad')).map(function (s) { return new Grad(s); });
  function sync() { all.forEach(function (g) { if (motionOn()) g.start(); else g.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__grad = all;   // test hook
}());
