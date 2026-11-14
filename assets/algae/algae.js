/* algae.js - steps the carbon funnel on algae.html as the reader scrolls.
 *
 * Markup (written by algae/update_page.py):
 *   <figure class="funnelfig wide">
 *     <div class="funnel-fig"> two SVGs (.f-wide, .f-phone). Bars, whiskers and cost lines carry
 *       data-o, the stage they belong to (0 fixed, 1 deep, 2 net, 3 cost). Each row has one value
 *       text per stage: .v0 and .v1 carry data-only, .v2 is the final value. </div>
 *     <div class="funnel-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: every bar and the final values show. With motion on
 * (assets/motion.js) the figure goes live: it sticks, and the step whose card crosses a line 82 percent of
 * the way down the screen sets the stage: the drawing sticks at the top and covers the middle. Elements of a later stage get .off; the value text of the current
 * stage (the final one from stage 2 on) gets .on. With motion off, or on "motionchange" to off,
 * it tears down.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Funnel(fig) {
    var self = this;
    this.fig = fig;
    this.els = [].slice.call(fig.querySelectorAll('.funnel [data-o]'));
    this.vals = [].slice.call(fig.querySelectorAll('.funnel .val'));
    this.steps = [].slice.call(fig.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) self.set(+e.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-82% 0px -17% 0px' });
  }
  Funnel.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.els.forEach(function (el) { el.classList.toggle('off', +el.getAttribute('data-o') > k); });
    var shown = Math.min(k, 2);
    this.vals.forEach(function (el) {
      el.classList.toggle('on', el.classList.contains('v' + shown));
    });
  };
  Funnel.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.fig.classList.add('is-live');
    var io = this.io;
    this.steps.forEach(function (s) { io.observe(s); });
    var mid = window.innerHeight * 0.82, k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < mid) k = +s.getAttribute('data-step'); });
    this.set(k);
  };
  Funnel.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    this.fig.classList.remove('is-live');
    this.els.forEach(function (el) { el.classList.remove('off'); });
    this.vals.forEach(function (el) { el.classList.remove('on'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.funnelfig')).map(function (f) { return new Funnel(f); });
  function sync() { all.forEach(function (f) { if (motionOn()) f.start(); else f.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__funnel = all;   // test hook
}());
