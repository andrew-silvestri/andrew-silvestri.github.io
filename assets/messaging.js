/* messaging.js - shows the field trials on messaging.html group by group as the reader scrolls (2026-11-13).
 *
 * Markup (written by messaging/update_page.py):
 *   <figure class="msg wide">
 *     <div class="msg-fig"> two SVGs (.msg-wide, .msg-phone) whose rows and
 *       group headings carry data-o, the step they belong to (0 words .. 3 electricity) </div>
 *     <div class="msg-steps"> <div class="step" data-step="k"> ... </div> ... </div>
 *   </figure>
 *
 * The page is complete without this file: every row shows. With motion on
 * (assets/motion.js), the section goes live: the figure sticks, and the step
 * whose card crosses a line 72 percent of the way down the screen, below the
 * sticky chart, decides how many groups have
 * appeared. Rows of a later step get .off; the current step's rows get
 * .now. With motion off, or on "motionchange" to off, it tears down.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  if (!('IntersectionObserver' in window)) return;
  function motionOn() { return root.dataset.motion !== 'off'; }

  function Msg(sec) {
    var self = this;
    this.sec = sec;
    this.els = [].slice.call(sec.querySelectorAll('.dots [data-o]'));
    this.steps = [].slice.call(sec.querySelectorAll('.step[data-step]'));
    this.cur = 0;
    this.live = false;
    this.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) self.set(+e.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-72% 0px -27% 0px' });   // below the sticky chart, so the card is in view
  }
  Msg.prototype.set = function (k) {
    this.cur = k;
    if (!this.live) return;
    this.els.forEach(function (el) {
      var o = +el.getAttribute('data-o');
      el.classList.toggle('off', o > k);
      el.classList.toggle('now', o === k);
    });
  };
  Msg.prototype.start = function () {
    if (this.live) return;
    this.live = true;
    this.sec.classList.add('is-live');
    var io = this.io;
    this.steps.forEach(function (s) { io.observe(s); });
    // before any card reaches the middle, show what is above the reader
    var mid = window.innerHeight * 0.72, k = 0;
    this.steps.forEach(function (s) { if (s.getBoundingClientRect().top < mid) k = +s.getAttribute('data-step'); });
    this.set(k);
  };
  Msg.prototype.stop = function () {
    if (!this.live) return;
    this.live = false;
    this.io.disconnect();
    this.sec.classList.remove('is-live');
    this.els.forEach(function (el) { el.classList.remove('off', 'now'); });
  };

  var all = [].slice.call(document.querySelectorAll('figure.msg')).map(function (s) { return new Msg(s); });
  function sync() { all.forEach(function (c) { if (motionOn()) c.start(); else c.stop(); }); }
  document.addEventListener('motionchange', sync);
  sync();
  window.__msg = all;   // test hook
}());
