/**
 * Pointer-reactive behaviour.
 *
 * The brief was that the site felt basic — that it looked finished but did not
 * respond to being used. Two behaviours fix most of that without turning a
 * contractor's tender site into a showreel:
 *
 *   1. cards light up under the cursor,
 *   2. the primary controls lean toward it.
 *
 * (A third — a client marquee reacting to scroll velocity — was dropped: the
 * `.ticker` class it would have driven is dead CSS, used by no component, and
 * the client wall is deliberately a static trophy wall rather than a marquee.)
 *
 * Everything here is gated three ways and each gate matters:
 *
 *   - `prefers-reduced-motion` switches the whole module off. A visitor who has
 *     asked their system for less movement gets a completely static page.
 *   - `(hover: hover) and (pointer: fine)` gates the cursor work. On a phone
 *     there is no pointer to follow, `:hover` sticks after a tap, and running
 *     any of it would burn battery for nothing.
 *   - every listener is `passive` and every write is batched into a rAF, so
 *     none of this can make scrolling janky.
 *
 * Element styles are written through CSSOM (`el.style.setProperty`), which the
 * site's hash-based CSP permits — unlike a server-rendered `style` attribute,
 * which cannot be hashed and is dropped silently.
 */
import { gsap } from 'gsap';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * A soft wash that follows the cursor across a card.
 *
 * The gradient itself lives in CSS (`.spot::after`); all this does is publish
 * the pointer position as percentages. Listeners are attached per card rather
 * than one on the document, because a single document-level handler would have
 * to hit-test every card on every mouse move.
 */
function initSpotlight(): void {
  const cards = document.querySelectorAll<HTMLElement>('.spot');
  if (!cards.length) return;

  cards.forEach((card) => {
    let frame = 0;

    card.addEventListener(
      'pointermove',
      (event) => {
        if (frame) return; // one write per frame, no matter how fast the mouse moves
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const rect = card.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          card.style.setProperty('--mx', `${x}%`);
          card.style.setProperty('--my', `${y}%`);
        });
      },
      { passive: true },
    );

    // Park the wash back in the middle so the next hover starts from centre
    // rather than snapping from wherever the pointer happened to leave.
    card.addEventListener(
      'pointerleave',
      () => {
        if (frame) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
        card.style.setProperty('--mx', '50%');
        card.style.setProperty('--my', '50%');
      },
      { passive: true },
    );
  });
}

/**
 * Controls that lean toward the cursor as it comes near.
 *
 * Deliberately restrained: MAX_PULL is small, and the element returns to rest
 * the moment the pointer leaves. A button that runs away from the cursor is a
 * usability bug, not a flourish — this only ever moves toward it, and never far
 * enough that the pointer misses the real hit area.
 */
function initMagnetic(): void {
  const targets = document.querySelectorAll<HTMLElement>('.magnetic');
  if (!targets.length) return;

  const MAX_PULL = 6; // px
  const RADIUS = 90; // px beyond the element's box where the pull begins

  // ONE pointer listener for all of them, measured at most once a frame. It
  // used to be a window listener per control, each measuring its control on
  // every mouse move — a forced layout per control per event, many events a
  // frame (the browser synthesises more while scrolling) — and each restarting
  // a return-to-rest tween on controls that were already at rest.
  const items = [...targets].map((el) => ({
    el,
    xTo: gsap.quickTo(el, 'x', { duration: 0.45, ease: 'power3.out' }),
    yTo: gsap.quickTo(el, 'y', { duration: 0.45, ease: 'power3.out' }),
    pulled: false,
  }));
  let px = 0;
  let py = 0;
  let frame = 0;

  const release = (it: (typeof items)[number]) => {
    if (!it.pulled) return;
    it.pulled = false;
    it.xTo(0);
    it.yTo(0);
  };

  const update = () => {
    frame = 0;
    for (const it of items) {
      const rect = it.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const distance = Math.hypot(dx, dy);
      const reach = Math.max(rect.width, rect.height) / 2 + RADIUS;
      if (distance > reach) {
        release(it);
        continue;
      }
      // Falls off with distance, so the pull is strongest right on the control.
      const strength = 1 - distance / reach;
      it.pulled = true;
      it.xTo((dx / reach) * MAX_PULL * strength * 4);
      it.yTo((dy / reach) * MAX_PULL * strength * 4);
    }
  };

  window.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (!frame) frame = window.requestAnimationFrame(update);
    },
    { passive: true },
  );

  items.forEach((it) => {
    const reset = () => {
      it.pulled = true;
      release(it);
    };
    it.el.addEventListener('pointerleave', reset, { passive: true });
    // Never leave a control displaced once it has been used.
    it.el.addEventListener('blur', reset);
    it.el.addEventListener('click', reset);
  });
}

/**
 * Cards lean toward the cursor — a few degrees, never more.
 *
 * `transformPerspective` is set on the FIRST pointerenter, not up front: the
 * cards also carry `[data-reveal]`, whose start state is a stylesheet
 * `translateY(24px) scale(.985)`. A `gsap.set` at init would write an inline
 * transform that overrides that start state and the card would simply appear
 * instead of rising in. Waiting for the pointer means the reveal has run.
 *
 * The 2px hover lift is carried by the tween (`y: -2`) rather than left to
 * `.card:hover`, because GSAP's inline transform would otherwise override the
 * stylesheet's. Without JavaScript the CSS rule still lifts the card.
 */
function initTilt(): void {
  const cards = document.querySelectorAll<HTMLElement>('.card, .panel-light');
  if (!cards.length) return;

  const MAX_DEG = 4;

  cards.forEach((card) => {
    let primed = false;
    let frame = 0;
    const rx = gsap.quickTo(card, 'rotationX', { duration: 0.35, ease: 'power3.out' });
    const ry = gsap.quickTo(card, 'rotationY', { duration: 0.35, ease: 'power3.out' });
    const yy = gsap.quickTo(card, 'y', { duration: 0.35, ease: 'power3.out' });

    card.addEventListener(
      'pointerenter',
      () => {
        if (primed) return;
        primed = true;
        // Drops `transform` from the card's CSS transition list (see .tilt-live
        // in global.css); otherwise each per-frame write starts a 260ms
        // transition and the lean trails the pointer.
        card.classList.add('tilt-live');
        gsap.set(card, { transformPerspective: 900, transformOrigin: '50% 50%' });
      },
      { passive: true },
    );

    card.addEventListener(
      'pointermove',
      (event) => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const rect = card.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
          ry(nx * MAX_DEG);
          rx(-ny * MAX_DEG);
          yy(-2);
        });
      },
      { passive: true },
    );

    card.addEventListener(
      'pointerleave',
      () => {
        if (frame) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
        rx(0);
        ry(0);
        yy(0);
      },
      { passive: true },
    );
  });
}

export function initInteractions(): void {
  if (REDUCED()) return;
  if (FINE_POINTER()) {
    initSpotlight();
    initMagnetic();
    initTilt();
  }
}
