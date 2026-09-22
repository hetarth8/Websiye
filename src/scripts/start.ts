/**
 * The start window.
 *
 * The opening, in order: the city is already moving behind the window (it
 * waits for `world:ready` before building anything); the glass lens settles;
 * the mark builds itself stroke by stroke while the dial draws and a light
 * runs round it; the divisions swing out; a highlight crosses the lens as the
 * mark grows into place.
 *
 * On a first visit the window then carries on into the site by itself after a
 * few seconds, shown as a line filling along "Enter the site". ANY interaction
 * — pointing at a division or a button, a key, a scroll, a tap — stops that
 * for good, and the window becomes a menu that waits. Opened on purpose from
 * the header logo, it never carries on by itself. Every exit restores the
 * page: Enter, Escape, the backdrop, or following a division link.
 *
 * Two structural notes:
 *
 *  - The window is HIDDEN, never removed. It used to delete itself on close,
 *    which was fine when it could only ever be seen once. The header logo now
 *    reopens it, so the element has to survive; `start-ready` on <html> is what
 *    decides whether it is on screen (see global.css).
 *  - Leaving the window is an animation this file owns, from the first frame
 *    to the moment the address changes. The division links carry
 *    `data-no-transition` so the global page-transition handler keeps its hands
 *    off, and this file hands over to it explicitly by setting the same
 *    sessionStorage key that handler looks for on arrival.
 *
 * Every duration is a literal in TIMING. There is deliberately no timeScale()
 * anywhere in this file — on the Param Group build a debug `timeScale(0.12)`
 * was left in and shipped a 73-second preloader.
 */
import { gsap } from 'gsap';

const TIMING = {
  rule: 0.55,
  a: 0.65,
  strokes: 0.5,
  name: 0.55,
  /** The dial draws itself before anything lands on it. */
  ring: 0.9,
  ticks: 0.5,
  /** Each division swings out around the ring, one after the next. */
  node: 0.6,
  nodeStagger: 0.085,
  detail: 0.4,
  count: 0.9,
} as const;

/**
 * The exit — the push-in through the logo.
 *
 * This is the only place a visitor waits on an animation before the page
 * changes, so the total is the number that matters: `hold` + `zoom` is what
 * they sit through. It is deliberately slower than a normal page transition
 * because it is a deliberate act ("take me in"), not incidental navigation.
 */
const EXIT = {
  /** Tiles clear the ring before the camera starts moving. */
  clear: 0.5,
  clearStagger: 0.04,
  /** The push through the mark. */
  zoom: 1.15,
  /** How far the stage scales up. Large enough to pass through the mark. */
  scale: 7.5,
  /** The window thins away over the page as the zoom ends. */
  wash: 0.55,
} as const;

/** How long a first-visit opening waits before carrying on into the site. */
const AUTO_CONTINUE_S = 5.2;

/** Longest the build waits for the city before starting without it. */
const WORLD_WAIT_MS = 1100;

/** Must match KEY in transitions.ts — it is how the next page knows to reveal. */
const TRANSITION_KEY = 'aht:transition';

/**
 * Ring sizing.
 *
 * The first version derived the radius from the VIEWPORT and gave up below
 * 768px, falling back to a vertical list. That was wrong twice over: the window
 * is often viewed in a panel far narrower than the viewport, and a plain
 * vertical list is exactly the arrangement that reads as undesigned. The radius
 * is now measured from the box the ring is actually in, so the circle holds its
 * shape wherever it is rendered.
 */
const RADIUS_MIN = 104;
const RADIUS_MAX = 300;
/** Tile footprint, derived from the space available rather than the viewport. */
const TILE_MIN = 76;
const TILE_MAX = 132;
/** Share of the box half-extent a tile may take. */
const TILE_FRACTION = 0.36;
/** Clear air between neighbouring tiles on the ring. */
const TILE_GAP = 12;

/**
 * Fixed geometry for paper.
 *
 * On screen the ring is measured from its own box. That measurement is
 * meaningless when printing: the box belongs to the display, and the paper is
 * a different shape entirely. So before the print dialog opens the ring is
 * re-laid at a size chosen for the A4 text block (about 180mm across at 96dpi),
 * and restored afterwards.
 */
const PRINT = { radius: 208, tile: 116, core: 232 } as const;

export function initStartWindow(): void {
  const root = document.querySelector<HTMLElement>('[data-start]');
  if (!root) return;

  const rule = root.querySelector<SVGPathElement>('[data-start-rule]');
  const a = root.querySelector<SVGPathElement>('[data-start-a]');
  const strokes = root.querySelector<SVGPathElement>('[data-start-strokes]');
  const outline = root.querySelector<SVGPathElement>('[data-start-outline]');
  const guides = Array.from(root.querySelectorAll<SVGLineElement>('[data-start-guides] line'));
  const sheen = root.querySelector<SVGRectElement>('[data-start-sheen]');
  const nameEl = root.querySelector<HTMLElement>('[data-start-name]');
  const headEl = root.querySelector<HTMLElement>('[data-start-head]');
  const detail = root.querySelector<HTMLElement>('[data-start-detail]');
  const detailTitle = root.querySelector<HTMLElement>('[data-start-detail-title]');
  const detailText = root.querySelector<HTMLElement>('[data-start-detail-text]');
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-start-node]')];
  const links = [...root.querySelectorAll<HTMLAnchorElement>('.start__node-link')];
  const enterBtn = root.querySelector<HTMLButtonElement>('[data-start-enter]');
  const printBtn = root.querySelector<HTMLButtonElement>('[data-start-print]');
  const orbitEl = root.querySelector<HTMLElement>('[data-start-orbit]');
  const coreEl = root.querySelector<HTMLElement>('[data-start-core]');
  const stageEl = root.querySelector<HTMLElement>('[data-start-stage]');
  const actionsEl = root.querySelector<HTMLElement>('[data-start-actions]');
  const ringTrack = root.querySelector<SVGCircleElement>('[data-start-ring-track]');
  const ringTicks = [...root.querySelectorAll<SVGLineElement>('[data-start-ring-ticks] line')];
  const counts = [...root.querySelectorAll<HTMLElement>('[data-start-count]')];
  const glass = root.querySelector<HTMLElement>('[data-start-glass]');
  const ringGlow = root.querySelector<SVGCircleElement>('[data-start-ring-glow]');
  const progress = root.querySelector<HTMLElement>('[data-start-progress]');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * May the window MOVE? (Separate from whether it may open at all.)
   *
   * GSAP is driven by requestAnimationFrame, which a hidden tab does not run —
   * so a timeline started there stalls mid-build with the scroll locked behind
   * it. That used to be handled by refusing to open at all, which is no longer
   * enough: `/#start` is an explicit request and must be honoured even in a
   * background tab (middle-clicking the header logo does exactly that). So the
   * window still opens; it just opens already built.
   */
  const canAnimate = () => !reduceMotion.matches && document.visibilityState === 'visible';

  /** Live while the window is on screen; everything below keys off it. */
  let open = false;
  let ro: ResizeObserver | null = null;
  let intro: gsap.core.Timeline | null = null;
  /** The exit show, kept so that closing mid-exit can cancel it outright. */
  let exit: gsap.core.Timeline | null = null;
  let leaving = false;
  /** Carry on into the site by itself — first visits only, until touched. */
  let auto = false;
  let countdown: gsap.core.Tween | null = null;
  /** The light's slow circuit of the dial once the build is done. */
  let orbit: gsap.core.Tween | null = null;
  let previousOverflow = '';
  /** What had focus before the window took it, so it can be handed back. */
  let restoreFocus: HTMLElement | null = null;

  // --- layout ---------------------------------------------------------------

  /**
   * Place the nodes on the circle.
   *
   * Runs on open and whenever the ring's box changes. Below the point where a
   * circle genuinely will not fit, the CSS lays the nodes out as a two-column
   * grid and these custom properties are simply ignored, so there is nothing
   * to undo.
   */
  const layout = () => {
    const box = orbitEl?.getBoundingClientRect();
    const boxW = box?.width || window.innerWidth;
    const boxH = box?.height || window.innerHeight;

    // Half-extent of the box, minus a little air at the edge. Everything else
    // is derived from this one number.
    const half = Math.min(boxW, boxH) / 2 - 10;

    // Tiles scale with the space available, NOT with the viewport width. Tying
    // them to the viewport is what kept them small: a wide-but-short window, or
    // a narrow panel on a big screen, both got the wrong size.
    let tile = Math.round(Math.min(TILE_MAX, Math.max(TILE_MIN, half * TILE_FRACTION)));
    let radius = Math.min(RADIUS_MAX, half - tile / 2);

    // Seven tiles have to fit round the circumference without touching. If the
    // arc each one gets is too small, give the tile back some size until it
    // does - shrinking the tile is always better than overlapping them.
    for (let guard = 0; guard < 8; guard += 1) {
      const arc = (2 * Math.PI * radius) / Math.max(1, nodes.length);
      if (arc >= tile + TILE_GAP || tile <= TILE_MIN) break;
      tile = Math.max(TILE_MIN, tile - 8);
      radius = Math.min(RADIUS_MAX, half - tile / 2);
    }

    // The logo and name sit inside the ring and get whatever is left, so the
    // centre can never grow into the tiles.
    const coreMax = Math.max(140, Math.round((radius - tile / 2) * 2 - 24));
    apply(radius, tile, coreMax);
  };

  /** Write one set of geometry. Shared by the screen and paper paths. */
  const apply = (radius: number, tile: number, coreMax: number) => {
    root.style.setProperty('--tile', `${tile}px`);
    // Diameter of the drawn dial the tiles sit on.
    root.style.setProperty('--ring-d', `${Math.round(radius * 2)}px`);
    // On the root, not the core: the glass lens is the core's sibling and is
    // sized from the same clearance.
    root.style.setProperty('--core-max', `${coreMax}px`);

    // Below this the box genuinely cannot hold a circle - two columns instead.
    const compact = radius < RADIUS_MIN;
    root.classList.toggle('start--compact', compact);
    if (compact) {
      nodes.forEach((n) => {
        n.style.removeProperty('--a');
        n.style.removeProperty('--r');
      });
      return;
    }

    nodes.forEach((node, i) => {
      // Start at the top and go clockwise, so the first division reads first.
      const angle = (360 / nodes.length) * i - 90;
      node.style.setProperty('--a', `${angle}deg`);
      node.style.setProperty('--r', `${Math.round(radius)}px`);
    });
  };

  // --- the detail panel in the middle of the ring --------------------------
  const defaultTitle = detailTitle?.textContent ?? '';
  const defaultText = detailText?.textContent ?? '';

  const showDetail = (title: string, text: string) => {
    if (!detailTitle || !detailText || !detail) return;
    gsap.killTweensOf(detail);
    detailTitle.textContent = title;
    detailText.textContent = text;
    gsap.fromTo(
      detail,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: TIMING.detail, ease: 'power2.out' },
    );
  };

  // --- closing --------------------------------------------------------------

  /**
   * Put everything the animations touched back the way it was.
   *
   * Every exit runs through here, including the one that ends in a navigation
   * — if the browser cancels that navigation, or restores this page from the
   * back/forward cache, the window must not be left mid-zoom.
   */
  /** Stop every timeline — all a close needs; the window is hidden after it. */
  const halt = () => {
    // The exit is killed with everything else: killing only its tweens left an
    // empty timeline that "completed" on the next tick and navigated anyway.
    exit?.kill();
    exit = null;
    intro?.kill();
    intro = null;
    countdown?.kill();
    countdown = null;
    orbit?.kill();
    orbit = null;
  };

  const reset = () => {
    halt();
    /**
     * EVERY element either timeline touches, back to its resting value.
     *
     * The intro's opening `gsap.set` calls park things at opacity 0, a 110%
     * offset, a clipped mask and so on. If the window is then reopened without
     * animation — a hidden tab, or reduced motion — nothing ever moves them
     * off those values, and the window renders as a blank sheet with an
     * invisible dial. So the exit targets are not enough: the intro's are
     * cleared here too.
     */
    const animated = [
      stageEl,
      actionsEl,
      headEl,
      rule,
      a,
      strokes,
      nameEl,
      detail,
      glass,
      ringGlow,
      progress,
      ...ringTicks,
      ...links,
    ].filter((el): el is NonNullable<typeof el> => el !== null);
    // The core carries only a transform from the intro; clearing ALL of its
    // properties is unnecessary and it is kept out of the list for that reason.
    if (coreEl) gsap.set(coreEl, { clearProps: 'transform' });

    gsap.killTweensOf([root, ...animated]);
    if (animated.length) gsap.set(animated, { clearProps: 'all' });

    // The dial is drawn by an ATTRIBUTE, which clearProps does not govern.
    if (ringTrack) {
      gsap.killTweensOf(ringTrack);
      ringTrack.setAttribute('stroke-dashoffset', '0');
    }

    // A counter interrupted mid-run would otherwise stay on a partial number.
    counts.forEach((el) => {
      const target = Number(el.dataset.startCount);
      if (!Number.isFinite(target)) return;
      el.textContent = target.toLocaleString('en-IN') + (el.dataset.startCountSuffix ?? '');
    });

    root.classList.remove('start--leaving');
    // The exit tween writes these straight onto the element, and neither is
    // covered by clearProps above — root is deliberately not in that list,
    // because clearing ALL of its properties would also wipe the --tile and
    // --ring-d geometry that layout() just published.
    root.style.removeProperty('opacity');
    root.style.removeProperty('background-color');
  };

  const close = () => {
    if (!open) return;
    open = false;
    leaving = false;
    document.body.style.overflow = previousOverflow;
    document.documentElement.classList.remove('start-ready');
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', layout);
    root.removeEventListener('pointerover', onPointerOver);
    root.removeEventListener('pointerdown', cancelAuto);
    root.removeEventListener('wheel', cancelAuto);
    root.removeEventListener('touchstart', cancelAuto);
    auto = false;
    ro?.disconnect();
    ro = null;
    // Stop, but do not tidy: clearing every animated property also measures
    // every SVG shape of the mark (getBBox), a quarter of a second on a
    // mid-range phone in the very frame the site appears — for a window that
    // is hidden from here on. openWindow() runs the full reset() before any
    // reopening, which is when the tidy is needed.
    halt();
    gsap.killTweensOf(root);
    // No synthetic resize here any more. It used to make every scroll trigger
    // and every city scene re-measure in the very frame the site appeared — a
    // long task at the worst moment. The layout cannot have changed: the page
    // keeps its scrollbar gutter while locked (global.css, html) and the page
    // behind cannot scroll (data-lenis-prevent on the window).
    restoreFocus?.focus({ preventScroll: true });
    restoreFocus = null;
  };

  /**
   * The show: push in through the mark, white out, then go.
   *
   * `href` is null for "Enter the site", which stays on this page — there the
   * zoom is the whole point and the window simply closes underneath it.
   */
  const leave = (href: string | null) => {
    if (leaving) return;
    leaving = true;

    // Reduced motion, or a tab that is not running frames: skip the show
    // entirely rather than risk stranding anyone behind a half-played zoom.
    if (reduceMotion.matches || document.visibilityState !== 'visible') {
      if (href) window.location.href = href;
      else close();
      return;
    }

    intro?.kill();
    countdown?.kill();
    orbit?.kill();
    root.classList.add('start--leaving');
    // The city surges forward as the mark flies at the reader: leaving the
    // window is moving on through the world, not closing a dialog.
    window.dispatchEvent(new CustomEvent('world:surge', { detail: { ms: 1800 } }));

    const tl = gsap.timeline({
      onComplete: () => {
        if (!leaving) return;
        exit = null;
        if (!href) {
          close();
          return;
        }
        // Hand over to the page-transition overlay, which is already the right
        // colour, so the next page lifts a sheet instead of snapping in.
        try {
          window.sessionStorage.setItem(TRANSITION_KEY, '1');
        } catch {
          /* Private modes throw. The navigation still has to happen. */
        }
        window.location.href = href;
      },
    });
    exit = tl;

    // The ring empties first — tiles fall back towards the centre they came
    // from, so the gesture reverses the one that built it.
    if (links.length) {
      tl.to(links, {
        opacity: 0,
        scale: 0.7,
        duration: EXIT.clear,
        ease: 'power2.in',
        stagger: { each: EXIT.clearStagger, from: 'end' },
      });
    }

    // Then the camera moves. Scaling the STAGE (not the core) is what makes it
    // read as a push-in: the dial and the mark grow together and the viewer
    // passes through them.
    if (stageEl) {
      tl.to(
        stageEl,
        { scale: EXIT.scale, opacity: 0, duration: EXIT.zoom, ease: 'power2.in' },
        '-=0.28',
      );
    }

    if (actionsEl) tl.to(actionsEl, { opacity: 0, y: 12, duration: 0.4, ease: 'power2.in' }, 0);
    if (headEl) tl.to(headEl, { opacity: 0, y: -12, duration: 0.4, ease: 'power2.in' }, 0);

    // Entering the site: the whole window thins away over the home page, whose
    // own city is the same world, so the handover is continuous. Following a
    // division instead: the window stays up and surging until the page changes,
    // and the next page arrives through the travel overlay.
    if (!href) tl.to(root, { opacity: 0, duration: EXIT.wash, ease: 'power1.in' }, '-=0.55');

    // A failsafe, not a timer: if GSAP is starved of frames the visitor still
    // gets where they asked to go.
    if (href) {
      window.setTimeout(
        () => {
          if (leaving && window.location.href !== href) window.location.href = href;
        },
        (EXIT.clear + EXIT.zoom) * 1000 + 1200,
      );
    }
  };

  /** Stop carrying on by itself. Once stopped, it stays a menu. */
  const cancelAuto = () => {
    if (!auto) return;
    auto = false;
    countdown?.kill();
    countdown = null;
    if (progress) gsap.to(progress, { scaleX: 0, duration: 0.3, ease: 'power2.out' });
  };

  const startCountdown = () => {
    if (!auto || !open || leaving || !progress) return;
    countdown = gsap.fromTo(
      progress,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: AUTO_CONTINUE_S,
        ease: 'none',
        onComplete: () => {
          if (auto && open && !leaving) leave(null);
        },
      },
    );
  };

  /**
   * Leaving the tab stops it too. GSAP runs with lagSmoothing(0) so Lenis stays
   * in step, which means a timeline jumps forward by the whole time a tab was
   * hidden — a visitor who switched away mid-countdown would come back and be
   * carried straight into the site. Coming back to a waiting menu is right.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') cancelAuto();
  });

  /** Pointing at anything actionable counts as interest; moving the mouse over the city does not. */
  const onPointerOver = (event: Event) => {
    if ((event.target as Element | null)?.closest?.('a, button')) cancelAuto();
  };

  /** Everything inside the window that can take focus, in DOM order. */
  const focusables = (): HTMLElement[] =>
    [
      ...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.getClientRects().length > 0);

  const onKey = (event: KeyboardEvent) => {
    cancelAuto();
    if (event.key === 'Escape') {
      close();
      return;
    }

    /*
     * Tab has to be contained.
     *
     * This window is role="dialog" aria-modal="true" painted on an OPAQUE
     * full-screen sheet. Without containment the tab ring walked straight out
     * of it after the last tile - into the header logo, the nav, the phone
     * number, the WhatsApp button and on through the whole page, all of it
     * behind the sheet. A sighted keyboard visitor lost the focus ring
     * entirely and could activate links they could not see, while screen
     * reader users hit the mirror image of the same bug: aria-modal tells AT
     * that content does not exist, so the virtual cursor and the tab ring
     * disagreed about the page.
     *
     * close() stays the single exit, so nothing here needs unwinding.
     */
    if (event.key !== 'Tab') return;

    const items = focusables();
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !root.contains(active);

    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  };

  // --- opening --------------------------------------------------------------

  /**
   * Show the window and play the build.
   *
   * `animate: false` is the reduced-motion path: the same window, fully formed,
   * with nothing moving. It is still openable that way — the request was to be
   * spared motion, not to be denied the menu.
   */
  const openWindow = (animate = true, carryOn = false) => {
    if (open) return;
    open = true;
    leaving = false;
    auto = carryOn && animate;
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    reset();
    window.addEventListener('keydown', onKey);
    root.addEventListener('pointerover', onPointerOver, { passive: true });
    root.addEventListener('pointerdown', cancelAuto, { passive: true });
    root.addEventListener('wheel', cancelAuto, { passive: true });
    root.addEventListener('touchstart', cancelAuto, { passive: true });

    /**
     * Only NOW is the window allowed to be seen.
     *
     * It used to be revealed by an inline `js` class in the document head,
     * which meant visibility depended on "JavaScript exists" while every
     * control - Escape, the Enter button, the backdrop, and the code that
     * places the tiles on the circle - depended on THIS module having loaded.
     * Those two can come apart: a failed chunk, a blocked script, or opening
     * the built index.html straight off disk (where the absolute /_astro/
     * paths do not resolve) left the window on screen with all seven tiles
     * stacked in one spot and no way out. A visitor was simply trapped.
     */
    document.documentElement.classList.add('start-ready');

    // Must follow the reveal: the ring has no box to measure until it is
    // displayed.
    layout();

    /**
     * Re-measure whenever the ring's own box changes.
     *
     * A window `resize` listener is not enough: the start window is often
     * viewed inside a panel that can be resized without the viewport changing
     * at all, and in that case `resize` never fires and the ring keeps a radius
     * computed for a completely different width.
     */
    if (orbitEl && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => layout());
      ro.observe(orbitEl);
    } else {
      window.addEventListener('resize', layout, { passive: true });
    }

    if (!animate) {
      links[0]?.focus({ preventScroll: true });
      return;
    }

    // Build the timeline now, so everything is parked at its starting state
    // before a single frame shows the finished dial — then hold it until the
    // city is drawn and fading in, so the mark forms over a living world rather
    // than over an empty sheet.
    intro = buildIntro();
    intro.pause();
    const play = () => {
      if (open && !leaving) window.setTimeout(() => intro?.play(), 280);
    };
    if (document.documentElement.dataset.world === 'ready') play();
    else {
      let started = false;
      const once = () => {
        if (started) return;
        started = true;
        window.removeEventListener('world:ready', once);
        play();
      };
      window.addEventListener('world:ready', once);
      window.setTimeout(once, WORLD_WAIT_MS);
    }
  };

  /** The opening choreography. */
  const buildIntro = (): gsap.core.Timeline => {
    const tl = gsap.timeline();

    // The lens settles first: glass condensing over the city.
    if (glass) {
      gsap.set(glass, { opacity: 0, scale: 0.86 });
      tl.to(glass, { opacity: 1, scale: 1, duration: 0.95, ease: 'power3.out' }, 0);
    }

    // Drafting first. Three construction lines run out along the triangle's
    // sides, the way a draughtsman sets up a figure before inking it...
    if (guides.length) {
      guides.forEach((g) => {
        const len = Math.hypot(Number(g.getAttribute('x2')) - Number(g.getAttribute('x1')), Number(g.getAttribute('y2')) - Number(g.getAttribute('y1')));
        gsap.set(g, { strokeDasharray: len, strokeDashoffset: len, opacity: 0.9 });
      });
      tl.to(guides, { strokeDashoffset: 0, duration: 0.55, ease: 'power2.out', stagger: 0.09 }, 0.2);
    }

    // ...then the A's outline is drawn in pen along them...
    if (outline) {
      const len = outline.getTotalLength();
      gsap.set(outline, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
      tl.to(outline, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.inOut' }, 0.42);
    }

    if (rule) {
      const len = rule.getTotalLength();
      gsap.set(rule, { strokeDasharray: len, strokeDashoffset: len });
      tl.to(rule, { strokeDashoffset: 0, duration: TIMING.rule, ease: 'power2.inOut' }, 0.95);
    }

    // ...and the figure is built: the fill rises inside the drawn outline.
    if (a) {
      gsap.set(a, { clipPath: 'inset(100% 0% 0% 0%)' });
      tl.to(a, { clipPath: 'inset(0% 0% 0% 0%)', duration: TIMING.a, ease: 'power3.out' }, '-=0.3');
    }
    // The drafting stays only as long as it is needed.
    if (guides.length) tl.to(guides, { opacity: 0, duration: 0.6, ease: 'power1.out' }, '-=0.2');
    if (outline) tl.to(outline, { opacity: 0, duration: 0.6, ease: 'power1.out' }, '<');

    if (strokes) {
      gsap.set(strokes, { opacity: 0, yPercent: 12 });
      tl.to(
        strokes,
        { opacity: 1, yPercent: 0, duration: TIMING.strokes, ease: 'power3.out' },
        '-=0.22',
      );
    }

    if (nameEl) {
      gsap.set(nameEl, { yPercent: 110 });
      tl.to(nameEl, { yPercent: 0, duration: TIMING.name, ease: 'power4.out' }, '-=0.2');
    }

    // Once the mark stands, one run of light crosses it: polished metal.
    if (sheen) {
      gsap.set(sheen, { attr: { x: -40 }, opacity: 1 });
      tl.to(sheen, { attr: { x: 150 }, duration: 0.9, ease: 'power2.inOut' }, '-=0.1');
      tl.set(sheen, { opacity: 0 });
    }

    /**
     * The dial draws itself, clockwise from the top.
     *
     * The stroke is dashed in the stylesheet, which would fight a dashoffset
     * draw — so the draw is done on the length instead: a full-circumference
     * dash that starts fully offset. `pathLength` normalises the geometry to
     * 100 units, so this works at any radius without measuring anything.
     */
    if (ringTrack) {
      gsap.set(ringTrack, { attr: { 'stroke-dashoffset': 100 } });
      tl.to(
        ringTrack,
        { attr: { 'stroke-dashoffset': 0 }, duration: TIMING.ring, ease: 'power2.inOut' },
        '-=0.75',
      );
    }

    // A short run of light travels round the dial twice as it draws — the
    // survey instrument being set up — then dims to a slow circuit.
    if (ringGlow) {
      gsap.set(ringGlow, { opacity: 0, strokeDashoffset: 0 });
      tl.to(ringGlow, { opacity: 1, duration: 0.3, ease: 'power1.out' }, '<');
      tl.to(ringGlow, { strokeDashoffset: -200, duration: 2.2, ease: 'power1.inOut' }, '<');
      tl.to(ringGlow, { opacity: 0.55, duration: 0.6, ease: 'power1.inOut' }, '>-0.5');
    }

    if (ringTicks.length) {
      gsap.set(ringTicks, { opacity: 0 });
      tl.to(
        ringTicks,
        { opacity: 1, duration: TIMING.ticks, ease: 'power1.out', stagger: 0.05 },
        '-=0.55',
      );
    }

    // The divisions swing out from the centre, each rotating into its own place
    // on the ring. Animating `rotation` alongside the radial transform is what
    // makes it read as a circular gesture rather than seven things fading in.
    //
    //  IMPORTANT: this animates the LINKS, not the nodes. GSAP writes an inline
    //  `transform` on whatever it touches, and `.start__node` already carries
    //  the radial placement transform (rotate(--a) translate(--r) ...) from
    //  CSS. Animating the node would overwrite that inline and collapse all
    //  seven onto the centre of the screen. Node = where it sits, link = how it
    //  arrives.
    if (links.length) {
      gsap.set(links, { opacity: 0, scale: 0.6, rotation: -35 });
      tl.to(
        links,
        {
          opacity: 1,
          scale: 1,
          rotation: 0,
          duration: TIMING.node,
          ease: 'back.out(1.5)',
          stagger: TIMING.nodeStagger,
        },
        '-=0.4',
      );
    }

    if (headEl) {
      gsap.set(headEl, { opacity: 0, y: -10 });
      tl.to(headEl, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, '-=0.9');
    }

    // The action panel rises into place with the title block, once there is a
    // mark above it to act on.
    if (actionsEl) {
      gsap.set(actionsEl, { opacity: 0, y: 14 });
      tl.to(actionsEl, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '<0.1');
    }

    if (detail) {
      gsap.set(detail, { opacity: 0, y: 6 });
      tl.to(detail, { opacity: 1, y: 0, duration: TIMING.detail, ease: 'power2.out' }, '-=0.4');
    }

    counts.forEach((el) => {
      const target = Number(el.dataset.startCount);
      if (!Number.isFinite(target)) return;
      const suffix = el.dataset.startCountSuffix ?? '';
      const counter = { value: 0 };
      tl.to(
        counter,
        {
          value: target,
          duration: TIMING.count,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = Math.round(counter.value).toLocaleString('en-IN') + suffix;
          },
          onInterrupt: () => {
            el.textContent = target.toLocaleString('en-IN') + suffix;
          },
        },
        '<0.05',
      );
    });

    // Formed. A highlight crosses the lens and the mark grows into place.
    tl.addLabel('formed');
    if (glass) {
      tl.fromTo(glass, { '--sweep': '140%' }, { '--sweep': '-40%', duration: 1.35, ease: 'power2.inOut' }, 'formed');
    }
    const grow = [coreEl, glass].filter((el): el is HTMLElement => el !== null);
    if (grow.length) tl.to(grow, { scale: 1.06, duration: 1.25, ease: 'power2.inOut' }, 'formed');

    // Move focus into the window once it has settled, so a keyboard visitor is
    // not left tabbing through the page behind it.
    tl.call(() => {
      if (!open || leaving) return;
      links[0]?.focus({ preventScroll: true });
      if (ringGlow) {
        orbit = gsap.to(ringGlow, { strokeDashoffset: '-=100', duration: 9, ease: 'none', repeat: -1 });
      }
      startCountdown();
    });

    return tl;
  };

  // --- wiring ---------------------------------------------------------------

  enterBtn?.addEventListener('click', () => leave(null));

  printBtn?.addEventListener('click', () => window.print());

  links.forEach((link) => {
    const title = link.dataset.startTitle ?? '';
    const summary = link.dataset.startSummary ?? '';
    const enter = () => showDetail(title, summary);
    const exit = () => showDetail(defaultTitle, defaultText);
    link.addEventListener('pointerenter', enter);
    link.addEventListener('pointerleave', exit);
    // Keyboard parity: focusing a division tells you about it too.
    link.addEventListener('focus', enter);
    link.addEventListener('blur', exit);

    link.addEventListener('click', (event) => {
      // Anything unusual about the click is the browser's business, not ours:
      // middle-click, ctrl/cmd-click and shift-click all mean "somewhere else".
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      leave(link.href);
    });
  });

  // Clicking the backdrop closes; clicking a division must NOT — it has to be
  // allowed to navigate.
  root.addEventListener('click', (event) => {
    if (leaving) return;
    const target = event.target as HTMLElement;
    if (target.closest('.start__node-link')) return;
    if (target.closest('[data-start-enter]') || target.closest('[data-start-print]')) return;
    close();
  });

  /**
   * Paper geometry, and back again.
   *
   * `beforeprint` fires before the browser takes its snapshot, which is the
   * only moment a measured-in-pixels layout can be corrected for a sheet of
   * paper. Both events are also delivered when a headless print is triggered
   * from the print dialog's preview, so the restore is never skipped.
   */
  window.addEventListener('beforeprint', () => {
    if (!open) return;
    apply(PRINT.radius, PRINT.tile, PRINT.core);
  });
  window.addEventListener('afterprint', () => {
    if (!open) return;
    layout();
  });

  /**
   * Reopening on demand.
   *
   * The header logo asks for the window by name. From the home page that is a
   * direct call; from anywhere else the logo is an ordinary link to `/#start`,
   * and this is the half that answers it on arrival.
   */
  const openTriggers = [...document.querySelectorAll<HTMLElement>('[data-start-open]')];
  openTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      const mouse = event as MouseEvent;
      if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
      if (mouse.button && mouse.button !== 0) return;
      event.preventDefault();
      openWindow(canAnimate());
    });
  });

  // Restore the window if the browser brings this page back from the
  // back/forward cache mid-zoom — otherwise it would return frozen and blank.
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted && open) close();
  });

  // --- should it open by itself? -------------------------------------------

  /** An explicit request, from the header logo on another page. */
  const requested = window.location.hash === '#start';
  if (requested) {
    // Leave the address clean, so a refresh is not a second gate.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const autoOpen = (): boolean => {
    if (requested) return true;

    // A tab nobody is looking at does not run requestAnimationFrame, so the
    // build would stall mid-way with the scroll locked behind it.
    if (document.visibilityState !== 'visible') return false;

    // Reduced motion: no opening gate. The logo still reopens it on request.
    if (reduceMotion.matches) return false;

    // Do not gate the same visitor twice. Arriving from inside the site —
    // coming back from a division page, say — means they have already been
    // through the start window, and putting it in front of them again on every
    // return would make the site tiring to move around.
    try {
      const from = document.referrer;
      if (from && new URL(from).origin === window.location.origin) return false;
    } catch {
      /* An unparseable referrer is not a reason to skip the window. */
    }

    return true;
  };

  // A first visit carries on into the site by itself; an explicit request from
  // the header logo (`#start`) is someone asking for the menu, so it waits.
  if (autoOpen()) openWindow(canAnimate(), !requested);
}
