/* Ambient background video loops, gated the same way hero-gl.js gates the
 * GL hero: "off" means the source is not requested, not just paused. A
 * <video class="motion-video" data-src="..."> carries no src in the
 * markup, so a reader with motion off - or JS disabled entirely - only
 * ever sees its poster image.
 */
(function () {
  var vids = document.querySelectorAll('video.motion-video');
  if (!vids.length) return;

  function wire(v) {
    function start() {
      if (document.documentElement.dataset.motion !== 'on') return;
      if (!v.getAttribute('src')) {
        v.setAttribute('src', v.dataset.src);
        v.load();
      }
      if (!document.hidden) v.play().catch(function () {});
    }
    function stop() { v.pause(); }
    function teardown() {
      stop();
      if (v.getAttribute('src')) {
        v.removeAttribute('src');
        v.load();
      }
    }

    document.addEventListener('motionchange', function (e) {
      if (e.detail === 'on') { start(); } else { teardown(); }
    });
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? start() : stop();
      }, { threshold: 0.02 }).observe(v);
    } else {
      start();
    }
  }

  for (var i = 0; i < vids.length; i++) wire(vids[i]);
}());
