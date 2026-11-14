/* evmap.js - steps the evidence map on space-depression.html as the reader scrolls (2026-11-13).
 *
 * Markup (written by space-depression/update_page.py):
 *   <figure class="evmap wide">
 *     <div class="evmap-fig"> two SVGs (.evmap-wide, .evmap-phone) whose dots, notes and marks
 *       carry data-o, the step that introduces them (0 every flight .. 5 Mars) </div>
 *     <div class="evmap-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: everything shows. With motion on
 * (assets/motion.js), the figure sticks, and the step whose card crosses the
 * lower quarter of the screen sets data-step on the figure; elements introduced by a
 * later step get .off, and evmap.css dims or lights the rest by step. With
 * motion off, or on "motionchange" to off, it tears down. The same idiom as
 * assets/chain.js.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Map(fig) {
    var self = this;
    this.fig = fig;
    this.els = [].slice.call(fig.querySelectorAll('.evmap-svg [data-o]'));
    this.steps = [].slice.call(fig.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) self.set(+e.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-76% 0px -23% 0px' });   // the map sticks over the top half; read cards below it
  }
  Map.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.fig.setAttribute('data-step', String(k));
    this.els.forEach(function (el) {
      var o = +el.getAttribute('data-o');
      el.classList.toggle('off', o > k);
      el.classList.toggle('now', o === k);
    });
  };
  Map.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.fig.classList.add('is-live');
    var io = this.io;
    this.steps.forEach(function (s) { io.observe(s); });
    var mid = window.innerHeight * 0.76, k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < mid) k = +s.getAttribute('data-step'); });
    this.set(k);
  };
  Map.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    this.fig.classList.remove('is-live');
    this.fig.removeAttribute('data-step');
    this.els.forEach(function (el) { el.classList.remove('off', 'now'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.evmap')).map(function (f) { return new Map(f); });
  function sync() { all.forEach(function (m) { if (motionOn()) m.start(); else m.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__evmap = all;   // test hook
}());
