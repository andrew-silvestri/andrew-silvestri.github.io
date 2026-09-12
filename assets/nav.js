/* The collapsed nav's one enhancement: Escape closes it.
 *
 * EVERYTHING ELSE IS THE PLATFORM'S. The control is a <details> holding only
 * its <summary>, and the nav items are its siblings, revealed by
 * `details[open] ~ *` in style.css's 620px block. So with this file absent, or
 * with JavaScript off entirely:
 *
 *   - closed is the default on load, because <details> has no open attribute;
 *   - the summary toggles it open and shut, natively, on tap and on click;
 *   - Enter and Space toggle it, natively, because <summary> is focusable;
 *   - it does not persist across navigation, because nothing stores it;
 *   - assistive technology announces its expanded state, because it is a
 *     disclosure rather than something imitating one.
 *
 * Only Escape needs script: no browser closes a <details> on Escape, unlike
 * <dialog> or a popover. That is the whole of what is lost without this file,
 * which is the #nogl and #noaudio shape - the feature degrades to a working
 * page rather than a broken one.
 *
 * WHY THIS IS NOT ON :focus-within, WHICH IS WHAT IT REPLACED. The previous
 * control was an <a href="#"> whose open state was held by
 * `nav.top:not(:focus-within)`. Measured in WebKit 26.5 on 2026-09-12 with a
 * real page.tap(): WebKit does not focus an anchor on activation, by tap OR by
 * click - the active element afterwards is BODY - so the control never opened
 * and every link below 620px sat behind it. Andrew found it on an iPhone. The
 * whole mechanism was reverted the same day; this is its replacement.
 */
(function () {
  'use strict';
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    var d = document.querySelector('nav.top > details.navmore[open]');
    if (!d) return;
    d.open = false;
    /* Focus goes back to the control that opened it, not nowhere: a reader who
       dismisses a menu with the keyboard should still know where they are. */
    var s = d.querySelector('summary');
    if (s && typeof s.focus === 'function') s.focus();
  });
}());
