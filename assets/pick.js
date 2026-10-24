/* pick.js - the one control a page may carry (_INSIGHT rule 3): "your state".
 * (R3, 2026-10-23)
 *
 * Markup, written by the page generator: a .pick container holding a hidden
 * .pick-ctl row of buttons (data-val) and one block per value (data-when).
 * Without JS every block shows and the buttons stay hidden, so the page reads
 * whole. With JS the buttons show and only the chosen block does. Buttons are
 * native <button>s, so keyboard and screen readers get them for free;
 * aria-pressed carries the state.
 */
(function () {
  'use strict';
  function wire(box) {
    var ctl = box.querySelector('.pick-ctl');
    if (!ctl) return;
    var btns = ctl.querySelectorAll('button[data-val]'), blocks = box.querySelectorAll('[data-when]');
    function set(v) {
      Array.prototype.forEach.call(btns, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-val') === v ? 'true' : 'false'); });
      Array.prototype.forEach.call(blocks, function (el) { el.hidden = el.getAttribute('data-when') !== v; });
    }
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () { set(b.getAttribute('data-val')); });
    });
    var first = ctl.querySelector('button[aria-pressed="true"]') || btns[0];
    ctl.hidden = false;
    set(first.getAttribute('data-val'));
  }
  function init() { Array.prototype.forEach.call(document.querySelectorAll('.pick'), wire); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
