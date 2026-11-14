/* scales.js - grows the mass / power-per-kilogram chart on scales.html as the reader scrolls (2026-11-13).
 *
 * Markup (written by scales/update_page.py):
 *   <figure class="ladder wide">
 *     <div class="ladder-fig"> two SVGs (.plot-wide, .plot-phone) whose layers
 *       carry data-o, the step they belong to (0 life .. 5 stars) </div>
 *     <div class="ladder-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: every layer shows. With motion on
 * (assets/motion.js), the figure sticks and the step whose card crosses the
 * screen below the stuck chart decides how many layers show: a card counts
 * once its top passes a line just under the chart's bottom edge (the chart
 * covers more than half a phone screen, so the middle of the screen, which
 * chain.js uses, would sit inside it). The step is recomputed from every
 * card's position on each scroll frame, so a jump scroll lands on the right
 * step. Layers of a later step get .off; the current step's layers get .now.
 * With motion off, or on "motionchange" to off, it tears down. The pattern is
 * chain.js's (oxygen.html).
 */
(function () {
  'use strict';
  var root = document.documentElement;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Ladder(sec) {
    var self = this;
    this.sec = sec;
    this.fig = sec.querySelector('.ladder-fig');
    this.els = [].slice.call(sec.querySelectorAll('.plot [data-o]'));
    this.steps = [].slice.call(sec.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.queued = false;
    this.onScroll = function () {
      if (self.queued) return;
      self.queued = true;
      window.requestAnimationFrame(function () { self.queued = false; self.update(); });
    };
  }
  // the line a card's top must pass: just under the stuck chart, kept between 55% and 90% of the screen
  Ladder.prototype.line = function () {
    var h = window.innerHeight, b = this.fig.getBoundingClientRect().bottom;
    return Math.min(Math.max(b + 24, 0.55 * h), 0.9 * h);
  };
  Ladder.prototype.update = function () {
    var line = this.line(), k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < line) k = +s.getAttribute('data-step'); });
    if (k !== this.cur || !this.seeded) { this.seeded = true; this.set(k); }
  };
  Ladder.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.els.forEach(function (el) {
      var o = +el.getAttribute('data-o');
      el.classList.toggle('off', o > k);
      el.classList.toggle('now', o === k);
    });
  };
  Ladder.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.seeded = false;
    this.sec.classList.add('is-live');
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
    this.update();
  };
  Ladder.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    this.sec.classList.remove('is-live');
    this.els.forEach(function (el) { el.classList.remove('off', 'now'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.ladder')).map(function (s) { return new Ladder(s); });
  function sync() { all.forEach(function (c) { if (motionOn()) c.start(); else c.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__ladder = all;   // test hook
}());
