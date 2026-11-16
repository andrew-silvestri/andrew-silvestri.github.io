/* The home page's hero since 2026-11-15: the first 30 seconds of a
 * piano-studio render (a skeleton playing a nocturne), looped, and muted until
 * the reader presses the Sound button (added 2026-11-15, Andrew's request).
 *
 * SOUND. Browsers autoplay only muted video, so it starts muted and the button
 * (.herosound, in index.html, outside #hero because #hero is aria-hidden and
 * pointer-events:none) unmutes it - a click is the gesture that allows audio.
 * The button exists only while the film can play: hidden with JS off, under
 * reduced motion and under Data Saver, as the film is. With sound on, leaving
 * the band still pauses it: sound from a picture nobody can see, with its
 * control scrolled away, is the worse failure. The audio fades out over the
 * last 1.5 s so the loop does not cut mid-phrase.
 *
 * THIS REVERSES A DECISION hero.js's header records - "Nothing is a video" -
 * and the reversal is Andrew's own, made on 2026-11-15. hero.js is kept, unloaded,
 * in assets/: putting it back is swapping the <script> tag in index.html and
 * emptying #hero. Its captions are still checked by verify_hero_systems.js.
 *
 * What carries over from hero.js, because each one was a bug or a measurement:
 *  - This is a plain <script src> with no defer and no async, so it runs before
 *    first paint and the band has its height when the page first paints (CLS 0,
 *    measured for hero.js on 2026-09-07). Do not make it async.
 *  - The band is measured, not computed from a constant: the navband's height
 *    changes when the nav collapses below 620.
 *  - Leaving the band FADES the hero (body.hero-idle, 300ms in style.css) and
 *    pauses it after the fade; a stopped picture in the margins reads as a crash,
 *    a fade reads as a departure.
 *  - The motion contract (motion.js): with data-motion="off" nothing plays and
 *    nothing is downloaded but the poster, which is the video's first frame.
 *    "motionchange" tears playback down or brings it back.
 *
 * What is new: the band is min(viewport less navband, width * 9/16). hero.js
 * filled the whole first screen because a simulation can be drawn at any
 * aspect; a 16:9 film cover-cropped into a 390x793 phone band shows 28% of its
 * width. The rule is now "the whole picture on arrival, never more than the
 * screen", and on a 1440x900 desktop the two rules differ by 13px.
 *
 * Three files, and each viewer downloads one (the <source> order in index.html
 * picks it): 1080p AV1 8.4 MB for wide screens that decode AV1, 720p H.264
 * 6.9 MB for wide screens that do not (most Safari), 540p H.264 4.3 MB under
 * 700px, where the band is ~390x219. Each carries the same 128 kbps AAC track
 * (0.47 MB); the picture streams are unchanged from the silent version. The render's ground "boils" - 10% of its
 * pixels change every other frame - and noise is what codecs cannot shrink:
 * 1080p was 19.8 MB in H.264 at CRF 24 and 16.2 MB in AV1 at CRF 36, and 720p
 * AV1 (5.9 MB) saved too little over 720p H.264 to earn a fourth file. All are
 * cropped 7.4% (top and sides, still 16:9) to drop the renderer's version stamp.
 *
 * The sources are in the markup as data-src, not src, so bust_cache.py stamps
 * them (it rewrites src / data-src / poster attributes in HTML; it cannot see a
 * URL written in this file) and nothing downloads until this decides to play.
 */
(function () {
  var hero = document.getElementById('hero');
  var v = hero && hero.querySelector('video');
  if (!v) return;
  var root = document.documentElement;
  var nb = document.querySelector('.navband');
  var band = document.querySelector('.heroband');
  var btn = document.querySelector('.herosound button');

  /* Data Saver asks for exactly this: no 30 seconds of video nobody clicked. */
  var save = !!(navigator.connection && navigator.connection.saveData);
  var still = root.dataset.motion !== 'on' || save;
  var loaded = false, inView = false;

  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    var top = nb ? nb.getBoundingClientRect().height : 0;
    var h = Math.max(0, Math.min(H - top, W * 9 / 16));
    if (band) band.style.height = h + 'px';
    v.style.top = top + 'px';
    v.style.height = h + 'px';
  }

  function load() {
    if (loaded) return;
    loaded = true;
    var s = v.querySelectorAll('source');
    for (var i = 0; i < s.length; i++) s[i].src = s[i].getAttribute('data-src');
    v.preload = 'auto';
    v.load();
  }
  function play() {
    if (still || document.hidden || !inView) return;
    load();
    var p = v.play();
    /* Refused autoplay (iOS Low Power Mode, a browser setting) leaves the
       poster, which is the first frame: the page is a still, not broken. */
    if (p && p.catch) p.catch(function () {});
  }

  var fadeT = 0;
  function hide() {
    inView = false;
    document.body.classList.add('hero-idle');
    clearTimeout(fadeT);
    fadeT = setTimeout(function () { v.pause(); }, 380);
  }
  function show() {
    inView = true;
    clearTimeout(fadeT);
    document.body.classList.remove('hero-idle');
    play();
  }

  var io = null;
  function observe() {
    if (io) return;
    if ('IntersectionObserver' in window && band) {
      io = new IntersectionObserver(function (e) {
        if (e[0].isIntersecting) show(); else hide();
      }, { threshold: 0 });
      io.observe(band);
    } else show();
  }

  function sound(on) {
    v.muted = !on;
    if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (btn) btn.addEventListener('click', function () {
    sound(v.muted);
    /* Also the way back from a refused autoplay: this click is a gesture. */
    if (!v.muted) play();
  });

  document.body.classList.add('hero-live');
  resize();
  if (!still) observe();
  if (btn) btn.hidden = still;

  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 180);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) v.pause(); else play();
  });
  document.addEventListener('motionchange', function (e) {
    still = e.detail !== 'on' || save;
    if (btn) btn.hidden = still;
    if (still) {
      sound(false);
      if (io) { io.disconnect(); io = null; }
      clearTimeout(fadeT);
      document.body.classList.remove('hero-idle');
      v.pause();
      if (loaded) v.currentTime = 0;   /* back to the poster's frame */
    } else observe();
  });
}());
