/* The figure lightbox.
 *
 * Every img.fig on the site is rendered inside the text or wide track, which
 * is often far smaller than the figure was drawn at. This turns each one into
 * a trigger that opens the same image at its natural size, capped by the
 * viewport rather than the page column.
 *
 * One overlay element is built once and reused for every figure. Escape and
 * a click on the backdrop close it; focus is trapped on the single close
 * button while it is open (there is nothing else in the overlay to tab to)
 * and restored to the figure that opened it on close. A plain <img> carries
 * none of that for free, so this file is also what gives each trigger a
 * role, a tab stop and a label - the markup stays a bare <img class="fig">.
 *
 * Motion needs no special handling here: [data-motion="off"] already forces
 * every transition-duration to near zero (style.css), so the open/close fade
 * simply happens instantly for anyone who has asked for that.
 */
(function () {
  var figs = document.querySelectorAll('img.fig');
  if (!figs.length) return;

  var overlay = null, box = null, closeBtn = null, trigger = null;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.hidden = true;

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    box = document.createElement('img');
    box.className = 'lightbox-img';
    box.alt = '';

    overlay.appendChild(closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') { close(); return; }
      /* The overlay holds exactly one focusable control, so trapping focus
         is just refusing to let Tab leave it. */
      if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
    });
  }

  function open(img) {
    if (!overlay) build();
    trigger = img;
    box.src = img.currentSrc || img.src;
    box.alt = img.alt || '';
    overlay.hidden = false;
    /* Force layout before adding the class that starts the fade, or the
       browser coalesces the two style changes and never transitions. */
    overlay.getBoundingClientRect();
    overlay.classList.add('on');
    closeBtn.focus();
    document.addEventListener('keydown', escGuard, true);
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('on');
    document.removeEventListener('keydown', escGuard, true);
    /* Matches the CSS transition length; collapses to near-zero on its own
       when [data-motion="off"] is set, so no branch is needed here. */
    setTimeout(function () {
      overlay.hidden = true;
      box.src = '';
    }, 180);
    if (trigger) { trigger.focus(); trigger = null; }
  }

  /* A second, capturing Escape guard: overlay.addEventListener('keydown', ...)
     above only fires while focus is inside the overlay, which is always true
     here since focus is trapped on the close button, but this keeps Escape
     working even if a future change adds another focusable node. */
  function escGuard(e) {
    if (e.key === 'Escape' || e.key === 'Esc') close();
  }

  for (var i = 0; i < figs.length; i++) {
    (function (img) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label',
        img.alt ? 'Open larger: ' + img.alt : 'Open larger version of this figure');
      img.addEventListener('click', function () { open(img); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          open(img);
        }
      });
    }(figs[i]));
  }
}());
