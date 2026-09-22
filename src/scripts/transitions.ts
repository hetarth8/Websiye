/**
 * Drives the page-transition overlay.
 *
 * Deliberately conservative: this intercepts navigation, so every failure mode
 * has to end with the visitor on the page they asked for.
 *  - reduced motion, no overlay, or no sessionStorage → never intercepts;
 *  - anything unusual about the click (modifier keys, new tab, downloads,
 *    external hosts, same-page anchors) → left to the browser;
 *  - if navigation stalls, the overlay clears itself rather than trapping
 *    the visitor behind an amber panel.
 */
const KEY = 'aht:transition';
const STALL_MS = 4000;

/**
 * Must match the transition durations in PageTransition.astro.
 *
 * `cover` is the only figure a visitor waits on, so it stays modest. `reveal`
 * runs after the next page has already rendered underneath, which is why the
 * crane can afford a slow, weighty hoist without costing anyone time.
 */
const TIMING: Record<string, { cover: number; reveal: number }> = {
  sweep: { cover: 380, reveal: 460 },
  truck: { cover: 420, reveal: 500 },
  crane: { cover: 520, reveal: 1000 },
  // No reveal: the View Transition carries the motion into the next page.
  world: { cover: 460, reveal: 0 },
};

const DEFAULT_TIMING = TIMING.crane;

type State = 'idle' | 'covering' | 'revealing';

export function initTransitions(): void {
  const overlay = document.querySelector<HTMLElement>('[data-transition]');
  if (!overlay) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // sessionStorage throws in some privacy modes; a transition is not worth
  // breaking navigation over.
  let store: Storage | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null;
  }

  if (prefersReducedMotion) {
    store?.removeItem(KEY);
    return;
  }

  const timing = TIMING[overlay.dataset.variant ?? ''] ?? DEFAULT_TIMING;

  const setState = (state: State) => {
    overlay.dataset.state = state;
  };

  /** Play the arrival half: start covered, then lift away. */
  const reveal = () => {
    setState('covering');
    // Two frames: one to commit the covered state without a transition, the
    // next to animate out of it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setState('revealing');
        window.setTimeout(() => setState('idle'), timing.reveal);
      }),
    );
  };

  const variant = overlay.dataset.variant ?? '';

  if (store?.getItem(KEY)) {
    store.removeItem(KEY);
    // The world variant arrives through the browser's View Transition, not a
    // second cover — covering on arrival would flash the new page first.
    if (variant !== 'world') reveal();
  }

  /** Everything that means "let the browser handle this normally". */
  const shouldIgnore = (event: MouseEvent, link: HTMLAnchorElement): boolean => {
    if (event.defaultPrevented || event.button !== 0) return true;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
    if (link.target && link.target !== '_self') return true;
    if (link.hasAttribute('download')) return true;
    if (link.dataset.noTransition !== undefined) return true;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return true;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return true;
    // Same page, different anchor — that is a scroll, not a navigation.
    if (url.pathname === location.pathname && url.search === location.search) return true;
    // Let the CMS load without our overlay in the way.
    if (url.pathname.startsWith('/admin')) return true;

    return false;
  };

  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a');
    if (!(link instanceof HTMLAnchorElement)) return;
    if (shouldIgnore(event, link)) return;

    event.preventDefault();
    store?.setItem(KEY, '1');
    // The world portal opens from the point that was clicked. The origin has to
    // be COMMITTED before the state changes: set in the same frame, the browser
    // animated the circle's centre from the old default in the middle of the
    // screen, so the portal slid across from the centre instead of opening
    // where the visitor clicked. Reading the computed clip-path forces that.
    overlay.style.setProperty('--tx', `${event.clientX}px`);
    overlay.style.setProperty('--ty', `${event.clientY}px`);
    const portal = overlay.querySelector('.world');
    if (portal) void getComputedStyle(portal).clipPath;
    setState('covering');

    const go = () => {
      window.location.href = link.href;
    };
    window.setTimeout(go, timing.cover);
    // If the new document never arrives, don't leave the visitor stranded.
    window.setTimeout(() => setState('idle'), STALL_MS);
  });

  // Coming back via the bfcache restores the covered overlay — clear it.
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) {
      store?.removeItem(KEY);
      setState('idle');
    }
  });
}
