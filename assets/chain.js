/* chain.js - grows the causal tree on oxygen.html as the reader scrolls (2026-11-07).
 *
 * Markup (written by oxygen/update_page.py):
 *   <figure class="chain wide">
 *     <div class="chain-fig"> two SVGs (.tree-wide, .tree-phone) whose nodes and
 *       links carry data-o, the order they belong to (0 policy .. 4 beyond) </div>
 *     <div class="chain-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: every node shows. With motion on
 * (assets/motion.js), the section goes live: the figure sticks, and the step
 * whose card crosses the middle of the screen decides how far the tree has
 * grown. Elements of a later order get .off; the current order's nodes get
 * .now. With motion off, or on "motionchange" to off, it tears down.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Chain(sec) {
    var self = this;
    this.sec = sec;
    this.els = [].slice.call(sec.querySelectorAll('.tree [data-o]'));
    this.steps = [].slice.call(sec.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) self.set(+e.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-50% 0px -49% 0px' });
  }
  Chain.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.els.forEach(function (el) {
      var o = +el.getAttribute('data-o');
      el.classList.toggle('off', o > k);
      el.classList.toggle('now', o === k);
    });
  };
  Chain.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.sec.classList.add('is-live');
    var io = this.io;
    this.steps.forEach(function (s) { io.observe(s); });
    // before any card reaches the middle, show what is above the reader
    var mid = window.innerHeight / 2, k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < mid) k = +s.getAttribute('data-step'); });
    this.set(k);
  };
  Chain.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    this.sec.classList.remove('is-live');
    this.els.forEach(function (el) { el.classList.remove('off', 'now'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.chain')).map(function (s) { return new Chain(s); });
  function sync() { all.forEach(function (c) { if (motionOn()) c.start(); else c.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__chain = all;   // test hook
}());
