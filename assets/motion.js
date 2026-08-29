/* The motion contract.
 *
 * document.documentElement.dataset.motion is "on" or "off". A blocking snippet
 * in <head> sets it before the stylesheet loads, so the page never paints one
 * state and flips to the other.
 *
 * prefers-reduced-motion supplies the default; the footer control overrides it,
 * not the other way round. Someone who has asked their system for less motion
 * gets a still page without touching anything, and can still turn it on here.
 *
 * Anything that animates reads this attribute rather than the media query, and
 * listens for "motionchange" to tear itself down. A GL context left running
 * behind a page that says "static" is the failure this file exists to prevent.
 */
(function () {
  var root = document.documentElement;

  function apply(state, persist) {
    root.dataset.motion = state;
    if (persist) { try { localStorage.setItem('motion', state); } catch (e) {} }
    var on = state === 'on';
    var btns = document.querySelectorAll('.motion-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].hidden = false;          // hidden in the markup: with JS off the
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      var s = btns[i].querySelector('.motion-state');
      if (s) s.textContent = on ? 'on' : 'off';
    }
    document.dispatchEvent(new CustomEvent('motionchange', { detail: state }));
  }

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.motion-toggle');
    if (!b) return;
    e.preventDefault();
    apply(root.dataset.motion === 'on' ? 'off' : 'on', true);
  });

  /* The head snippet has already set the attribute. This only reveals the
     control and syncs its label; it does not persist, because at this point
     nothing has been chosen. */
  apply(root.dataset.motion === 'on' ? 'on' : 'off', false);
}());
