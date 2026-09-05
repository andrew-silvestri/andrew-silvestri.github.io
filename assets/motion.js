/* The motion contract.
 *
 * document.documentElement.dataset.motion is "on" or "off". A blocking snippet
 * in <head> sets it before the stylesheet loads, from prefers-reduced-motion
 * alone, so the page never paints one state and flips to the other. This file
 * keeps it true if the preference changes while the page is open, and tells
 * anything that animates by dispatching "motionchange". There is no manual
 * switch: someone who has asked their system for less motion gets a still
 * page, and someone who has not gets the hero.
 *
 * Anything that animates reads the attribute rather than the media query, and
 * listens for "motionchange" to tear itself down. A GL context left running
 * behind a page that says "static" is the failure this file exists to prevent.
 */
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (!mq) return;
  function apply() {
    var state = mq.matches ? 'off' : 'on';
    if (root.dataset.motion === state) return;
    root.dataset.motion = state;
    document.dispatchEvent(new CustomEvent('motionchange', { detail: state }));
  }
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply);
  apply();
}());
