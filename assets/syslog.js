/* A small live-log readout: the same numbers already stated in prose on this
 * page, revealed like a terminal session instead of printed as a paragraph.
 * The full text is already in the markup - this only adds the staggered
 * reveal and the blinking cursor, and only while data-motion is "on".
 */
(function () {
  var log = document.querySelector('.sys-log');
  if (!log) return;
  var lines = log.querySelectorAll('li');
  var cursor = document.querySelector('.sys-cursor');
  if (!lines.length) return;

  var timer = null;

  function showAll() {
    if (timer) { clearTimeout(timer); timer = null; }
    for (var i = 0; i < lines.length; i++) lines[i].style.opacity = '1';
    if (cursor) cursor.hidden = true;
  }

  function reveal() {
    for (var i = 0; i < lines.length; i++) lines[i].style.opacity = '0';
    if (cursor) cursor.hidden = false;
    var i = 0;
    (function next() {
      if (document.documentElement.dataset.motion !== 'on') { showAll(); return; }
      if (i >= lines.length) { timer = null; return; }
      lines[i].style.opacity = '1';
      i++;
      timer = setTimeout(next, 420);
    })();
  }

  if (document.documentElement.dataset.motion === 'on') { reveal(); } else { showAll(); }
  document.addEventListener('motionchange', function (e) {
    if (e.detail === 'on') { reveal(); } else { showAll(); }
  });
}());
