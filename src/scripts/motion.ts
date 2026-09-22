/**
 * Scroll behaviour and choreography.
 *
 * Three things, all of which switch themselves off under `prefers-reduced-motion`:
 *   - Lenis for eased scrolling, which is most of why a page feels considered
 *     rather than mechanical;
 *   - GSAP ScrollTrigger for staggered reveals, replacing the hand-rolled
 *     IntersectionObserver now that GSAP is here anyway;
 *   - counters that animate to their final figure once, on first sight.
 *
 * The reveal CSS lives in global.css and only applies when <html> carries
 * .js-reveal, which this file adds — so a visitor without JavaScript sees
 * everything immediately rather than a blank page.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const REVEALED = 'is-revealed';

export function initMotion(): void {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced) return;

  gsap.registerPlugin(ScrollTrigger);

  // --- eased scrolling ----------------------------------------------------
  // Only where the device can carry it. Lenis moves the page from THIS thread,
  // so when a frame here runs long, scrolling itself stutters. Measured on a
  // laptop at half this machine's CPU speed: under Lenis the page moved at
  // 28 fps; with the browser's own scrolling, which the compositor does on
  // another thread, it moved at a true 60 while the page's effects caught up.
  // So weak hardware scrolls natively from the start, and a watcher hands
  // scrolling back to the browser if eased scrolling cannot hold ~48 fps —
  // remembered for the rest of the visit, so no later page repeats the stutter.
  const NATIVE_KEY = 'aht:native-scroll';
  const hw = navigator as Navigator & { deviceMemory?: number };
  let native = (hw.hardwareConcurrency ?? 8) <= 4 || (hw.deviceMemory ?? 8) <= 4;
  try {
    native ||= window.sessionStorage.getItem(NATIVE_KEY) === '1';
  } catch {
    /* Private modes throw; decide from the hardware alone. */
  }

  let lenis: Lenis | null = native
    ? null
    : new Lenis({
        // Tuned down from the default feel: a longer glide that settles
        // unhurriedly, and a wheel that travels less per notch. Together these
        // make scrolling calmer and more controlled rather than darting.
        duration: 1.45,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 0.8,
        touchMultiplier: 1.5,
      });

  if (lenis) {
    lenis.on('scroll', ScrollTrigger.update);
    const drive = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(drive);

    const frames: number[] = [];
    let last = 0;
    let strikes = 0;
    // Not judged while the page is still settling: the first seconds after
    // load, or after the welcome window closes and the page takes over, are
    // busy for reasons that say nothing about scrolling.
    let graceUntil = performance.now() + 3000;
    new MutationObserver(() => {
      if (!root.classList.contains('start-ready')) graceUntil = performance.now() + 2500;
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
    const watch = (time: number) => {
      const t = time * 1000;
      const dt = last ? t - last : 0;
      last = t;
      // Only frames in which Lenis itself is moving the page count.
      if (!lenis || lenis.isScrolling !== 'smooth' || dt <= 0 || dt > 250) return;
      if (performance.now() < graceUntil || root.classList.contains('start-ready')) return;
      frames.push(dt);
      if (frames.length < 45) return;
      const sorted = [...frames].sort((a, b) => a - b);
      frames.length = 0;
      // Two slow samples in a row, not one: a single busy moment is not a slow device.
      if (sorted[sorted.length >> 1]! <= 21) {
        strikes = 0;
        return;
      }
      strikes += 1;
      if (strikes < 2) return;
      // Hand scrolling back to the browser.
      gsap.ticker.remove(drive);
      gsap.ticker.remove(watch);
      lenis.destroy();
      lenis = null;
      try {
        window.sessionStorage.setItem(NATIVE_KEY, '1');
      } catch {
        /* Just this page, then. */
      }
    };
    gsap.ticker.add(watch);
  }
  gsap.ticker.lagSmoothing(0);

  // --- scroll progress ----------------------------------------------------
  // A hairline brand-ramp bar across the top that fills as the page is read —
  // a small, constant signal of where you are that reads as considered.
  const progress = document.querySelector<HTMLElement>('[data-scroll-progress]');
  if (progress) {
    gsap.set(progress, { scaleX: 0, transformOrigin: 'left center' });
    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => gsap.set(progress, { scaleX: self.progress }),
    });
  }

  // Anchor links have to go through Lenis while it runs, or they jump while it
  // eases. With native scrolling the browser's own smooth scroll (html
  // scroll-behavior and scroll-padding-top in global.css) already does it.
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href*="/#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!lenis) return;
      const hash = link.href.split('#')[1];
      if (!hash) return;
      const target = document.getElementById(hash);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target, { offset: -88 });
    });
  });

  // --- reveals ------------------------------------------------------------
  root.classList.add('js-reveal');

  /**
   * The welcome window covers the page at load. The first screen's reveals
   * used to play underneath it, restyled and repainted on every frame of the
   * window's own animation for nobody to see.
   */
  const welcomeUp = root.classList.contains('start-ready');

  /** Run `fn` now — or, if the welcome window is up, the moment it closes. */
  const afterWelcome = (fn: () => void) => {
    if (!root.classList.contains('start-ready')) {
      fn();
      return;
    }
    const watch = new MutationObserver(() => {
      if (root.classList.contains('start-ready')) return;
      watch.disconnect();
      fn();
    });
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });
  };

  /**
   * A reveal has come to rest. The city behind each section clears itself
   * under every word (terrain.ts), and it measured those words while they were
   * still offset for their slide-in — so it is told to measure again.
   */
  const settled = (els: Element[]) => window.dispatchEvent(new CustomEvent('reveal:settled', { detail: els }));

  const groups = document.querySelectorAll<HTMLElement>('[data-reveal-group]');
  groups.forEach((group) => {
    const items = group.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!items.length) return;
    ScrollTrigger.batch(items, {
      start: 'top 88%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.55,
          ease: 'power3.out',
          stagger: 0.07,
          onStart: () => batch.forEach((el) => el.classList.add(REVEALED)),
          onComplete: () => settled(batch),
        }),
    });
  });

  // Anything not inside a group reveals on its own.
  const loose = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter(
    (el) => !el.closest('[data-reveal-group]'),
  );
  loose.forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        el.classList.add(REVEALED);
        gsap.to(el, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', onComplete: () => settled([el]) });
      },
    });
  });

  /**
   * The first screen.
   *
   * ScrollTrigger fires onEnter when a trigger CROSSES its start line. Anything
   * already on screen when the page loads never crosses anything, so it never
   * entered — and with `once: true` it never would. The result was that at
   * scroll position 0 not one of the 131 reveal elements had fired, the 2500ms
   * failsafe below concluded the effect was broken and stripped `js-reveal`,
   * and from then on every LATER reveal added its class to a stylesheet rule
   * that no longer applied. The site's entire reveal animation was dead, on
   * every visit, and the failsafe is what hid the evidence by leaving the
   * content correctly visible.
   *
   * So: whatever is already in view at load is revealed here, on the same
   * stagger, which both animates the first screen and satisfies the failsafe.
   * It runs after a frame so Lenis and ScrollTrigger have measured the page,
   * and after the welcome window if one is open.
   */
  requestAnimationFrame(() => {
    ScrollTrigger.refresh();
    revealFirstScreen(welcomeUp);
  });

  /**
   * `instantly` when the welcome window covers the page: the first screen is
   * put in its finished state at once and never animated underneath. It paints
   * straight away (the page's largest paint is not held back to the window's
   * closing), it costs the window's own animation nothing, and the window's
   * exit — the page seen through its fading glass — is the reveal.
   */
  function revealFirstScreen(instantly: boolean): void {
    const onScreen = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => {
      if (el.classList.contains(REVEALED)) return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.95 && rect.bottom > 0;
    });

    if (!onScreen.length) return;

    if (instantly) {
      onScreen.forEach((el) => el.classList.add(REVEALED));
      gsap.set(onScreen, { opacity: 1, y: 0, scale: 1 });
      afterWelcome(() => settled(onScreen));
      return;
    }

    gsap.to(onScreen, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.55,
      ease: 'power3.out',
      stagger: 0.07,
      onStart: () => onScreen.forEach((el) => el.classList.add(REVEALED)),
      onComplete: () => settled(onScreen),
    });
  }

  // --- headline word reveal -----------------------------------------------
  // The hero headline rises word by word from behind a mask. Done by wrapping
  // each word in a clipping span, so it is pure layout — no plugin needed, and
  // the text stays intact in the DOM for search engines and screen readers.
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    const walk = (node: HTMLElement) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent ?? '';
          if (!text.trim()) return;
          const frag = document.createDocumentFragment();
          text.split(/(\s+)/).forEach((part) => {
            if (!part.trim()) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            const mask = document.createElement('span');
            mask.className = 'split-mask';
            const inner = document.createElement('span');
            inner.className = 'split-word';
            inner.textContent = part;
            mask.appendChild(inner);
            frag.appendChild(mask);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child as HTMLElement);
        }
      });
    };
    walk(el);

    const words = el.querySelectorAll('.split-word');
    if (!words.length) return;
    // Behind the welcome window the headline is simply in place: it used to
    // rise unseen, costing the window's animation frames for nothing.
    if (welcomeUp) return;
    gsap.fromTo(
      words,
      { yPercent: 115 },
      { yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.055, delay: 0.15 },
    );
  });

  // --- parallax depth -----------------------------------------------------
  // Elements drift at their own rate as they cross the viewport, so the page
  // gains real z-depth on scroll instead of moving as one flat sheet. Each
  // element declares its own speed; backdrops sit deep, accents shallow.
  gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
    const speed = Number(el.dataset.parallax) || 0.2;
    gsap.fromTo(
      el,
      { yPercent: -speed * 50 },
      {
        yPercent: speed * 50,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
      },
    );
  });

  // --- scroll-linked scenes -----------------------------------------------
  // These are SCRUBBED rather than triggered: tied to scroll POSITION, so the
  // page keeps moving under the reader's hand instead of playing once on entry
  // and then sitting still. Together with the camera dolly inside terrain.ts
  // (Config.scrollDolly), this is what makes scrolling feel like travelling
  // through the site rather than past it.
  //
  // One rule throughout: never scrub a property another system already owns.
  //   [data-reveal]  -> reveal tweens own opacity / y / scale
  //   .card          -> initTilt owns rotationX / rotationY / y
  //   .orbit, .beam  -> the orbit-drift and beam-sweep keyframes own `transform`
  // GSAP writes an inline transform, which would silently kill a CSS keyframe
  // animating the same property. So the scrubs below drive the .orbits
  // CONTAINER (which no keyframe touches) and images, never those elements.

  // Ring clusters drift and turn against the scroll at their own rates, so the
  // decorative layer has depth instead of being pinned to the page.
  gsap.utils.toArray<HTMLElement>('.orbits').forEach((cluster, i) => {
    const depth = 0.14 + (i % 3) * 0.05;
    gsap.fromTo(
      cluster,
      { yPercent: -depth * 42, rotate: -3 },
      {
        yPercent: depth * 42,
        rotate: 3,
        ease: 'none',
        scrollTrigger: {
          trigger: cluster.parentElement ?? cluster,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.9,
        },
      },
    );
  });

  // Photographs ease out of a slow push-in as they cross the viewport. The
  // scale only ever runs from >1 down to 1, never below, so a full-bleed
  // object-cover image can never reveal an edge.
  gsap.utils.toArray<HTMLElement>('[data-scroll-zoom]').forEach((el) => {
    const from = Number(el.dataset.scrollZoom) || 1.1;
    gsap.fromTo(
      el,
      { scale: from },
      {
        scale: 1,
        ease: 'none',
        transformOrigin: '50% 50%',
        scrollTrigger: {
          trigger: el.parentElement ?? el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.7,
        },
      },
    );
  });

  // Hairlines draw themselves across as their section arrives.
  gsap.utils.toArray<HTMLElement>('[data-scroll-rule]').forEach((el) => {
    gsap.fromTo(
      el,
      { scaleX: 0, transformOrigin: 'left center' },
      {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 55%', scrub: 0.5 },
      },
    );
  });

  // --- counters -----------------------------------------------------------
  document.querySelectorAll<HTMLElement>('[data-countup]').forEach((el) => {
    const target = Number(el.dataset.countup);
    if (!Number.isFinite(target)) return;
    const prefix = el.dataset.countupPrefix ?? '';
    const suffix = el.dataset.countupSuffix ?? '';
    /* A YEAR is a label, not a quantity, so it must not be grouped — the
       founding year was rendering as "2,001". Opt out with data-countup-plain
       rather than guessing from the value, because 2,180 km genuinely does
       want its separator and is the same order of magnitude. */
    const plain = el.dataset.countupPlain !== undefined;
    const format = (n: number) => (plain ? String(n) : n.toLocaleString('en-IN'));
    const counter = { value: 0 };

    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () =>
        gsap.to(counter, {
          value: target,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = prefix + format(Math.round(counter.value)) + suffix;
          },
        }),
    });
  });

  // --- staged arrival -----------------------------------------------------
  // Project pages don't dump every fact the instant they load. The crane has
  // just set the page down, so the content settles in the same order a load
  // would: the label and title first, then the photograph, then the spec rows
  // dropping in one after another. It's choreography, not concealment —
  // everything is in the HTML and visible to search engines and screen
  // readers, and the whole sequence is skipped under reduced motion.
  const staged = document.querySelector('[data-stage-sequence]');
  if (staged) {
    const steps = [...staged.querySelectorAll<HTMLElement>('[data-stage]')].sort(
      (a, b) => Number(a.dataset.stage) - Number(b.dataset.stage),
    );

    if (steps.length) {
      gsap.set(steps, { opacity: 0, y: 26 });

      const tl = gsap.timeline({
        // Starts as the crane's sheet finishes lifting, so the two read as
        // one movement rather than two competing ones.
        delay: 0.35,
        defaults: { ease: 'power3.out' },
      });

      steps.forEach((step, index) => {
        const isRow = step.dataset.stageKind === 'row';
        tl.to(
          step,
          {
            opacity: 1,
            y: 0,
            duration: isRow ? 0.45 : 0.75,
          },
          index === 0 ? 0 : isRow ? '-=0.32' : '-=0.42',
        );
      });
    }
  }

  // Late-loading images change the page height; recalculate once they settle.
  window.addEventListener('load', () => ScrollTrigger.refresh());

  // Safety net: if nothing has revealed shortly after load, drop the effect
  // entirely rather than leave content hidden. "After load" counts from the
  // welcome window closing, since the first screen now waits for that.
  afterWelcome(() =>
    window.setTimeout(() => {
      if (document.querySelector(`[data-reveal].${REVEALED}`)) return;
      root.classList.remove('js-reveal');
    }, 2500),
  );
}
