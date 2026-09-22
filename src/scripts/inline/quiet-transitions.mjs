/**
 * The one script that runs inline, in the head, before the page is first shown
 * (BaseLayout.astro). The browser makes a View Transition for every arrival and
 * departure (global.css, @view-transition); when one is not eligible — a typed
 * address, a reload — it rejects that transition's promises with nobody
 * listening. Harmless, but console noise that hides real errors. This listens.
 *
 * It lives here, as a string, so astro.config.mjs can hash the exact same text
 * into the Content-Security-Policy: Astro hashes the scripts it bundles, not
 * `is:inline` ones, and an unhashed inline script is simply blocked.
 */
export const QUIET_TRANSITIONS = `(function () {
  var quiet = function () {};
  var listen = function (e) {
    var t = e.viewTransition;
    if (!t) return;
    t.ready.catch(quiet);
    t.finished.catch(quiet);
    if (t.updateCallbackDone) t.updateCallbackDone.catch(quiet);
  };
  addEventListener('pagereveal', listen);
  addEventListener('pageswap', listen);
})();`;
