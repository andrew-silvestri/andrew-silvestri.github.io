/* About's contact form (D-43). The form is hidden in the markup and shown
   here, so a reader without JavaScript sees the <noscript> line pointing to
   LinkedIn instead of a form that would leave the page. Submits to Web3Forms
   with fetch and reports success or failure in place. botcheck is the
   honeypot: Web3Forms drops any submission that ticks it. */
(function () {
  var f = document.getElementById('contact-form');
  if (!f || !window.fetch) return;
  f.hidden = false;
  var status = document.getElementById('cf-status');
  var btn = f.querySelector('button[type=submit]');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (f.botcheck && f.botcheck.checked) return;
    var data = {};
    new FormData(f).forEach(function (v, k) { data[k] = v; });
    btn.disabled = true;
    status.textContent = 'Sending…';
    fetch(f.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return { success: false }; });
    }).then(function (j) {
      if (j && j.success) {
        f.reset();
        status.textContent = 'Sent. Thank you.';
      } else {
        status.textContent = 'That did not send. Please try again later, or write to me on LinkedIn.';
      }
    }).catch(function () {
      status.textContent = 'That did not send (no connection). Please try again later, or write to me on LinkedIn.';
    }).then(function () { btn.disabled = false; });
  });
})();
