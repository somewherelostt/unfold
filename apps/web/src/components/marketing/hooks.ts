"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const documentVisible = () => !document.hidden;
const serverMotion = () => false;
const serverVisible = () => true;

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
}

/**
 * True once `amount` of the element is visible (once=true keeps it true: demos start once and keep their
 * final state when you scroll back up). once=false tracks visibility, used to pause loops off screen.
 */
export function useInView<T extends Element>(ref: RefObject<T | null>, { amount = 0.35, once = true }: { amount?: number; once?: boolean } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && e.intersectionRatio >= amount) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) setInView(false);
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount, once]);
  return inView;
}

/** A scope pauses its loops while off screen, inactive, or in a background tab. */
export function useMotionScope<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  const visible = useInView(ref, { amount: 0.1, once: false });
  const reduce = useReducedMotion();
  const foreground = useSyncExternalStore(subscribeVisibility, documentVisible, serverVisible);
  return { ref, visible, live: active && visible && foreground && !reduce, reduce };
}

/** Resumes a scripted demo from its existing step; reduced motion shows its final state. */
export function useTimedProgress(target: number, active: boolean, interval = 24, delay = 0) {
  const [progress, setProgress] = useState(0);
  const current = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      const finish = setTimeout(() => {
        current.current = target;
        setProgress(target);
      }, 0);
      return () => clearTimeout(finish);
    }
    if (!active || current.current >= target) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        current.current = Math.min(target, current.current + 1);
        setProgress(current.current);
        if (current.current >= target) clearInterval(timer);
      }, interval);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [target, active, interval, delay, reduce]);
  return reduce ? target : progress;
}

/** True after the page has scrolled past `px` (frosted header). */
export function useScrolled(px = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > px);
    const first = requestAnimationFrame(on);
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", on);
    };
  }, [px]);
  return scrolled;
}

/**
 * Scroll-linked parallax: as the element passes through the viewport ("start end" → "end start"),
 * translate it from `from` to `to` px. Writes the style directly, no re-render. Reverses on scroll up.
 */
export function useParallax<T extends HTMLElement>(from = 48, to = -24) {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.style.removeProperty("transform");
      return;
    }
    let raf = 0;
    let offset = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight - (r.top - offset)) / (window.innerHeight + r.height)));
      offset = from + (to - from) * p;
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [from, to, reduce]);
  return ref;
}

/**
 * Pinned-section progress: for a tall section with a sticky child, returns which of `count` steps the
 * scroll is on (0…count-1). Scrolling back up steps back. Returns -1 when not pinned (small screens).
 */
export function usePinnedStep<T extends HTMLElement>(count: number, minWidth = 1024) {
  const ref = useRef<T>(null);
  const [step, setStep] = useState(-1);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (window.innerWidth < minWidth || window.innerHeight < 700 || reduce) return setStep(-1);
      const r = el.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? Math.min(0.9999, Math.max(0, -r.top / travel)) : 0;
      setStep(Math.floor(p * count));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, [count, minWidth, reduce]);
  return { ref, step };
}

/** Counts 0 → target with an ease-out once `active`, like a damped spring. */
export function useCountUp(target: number, active: boolean, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) {
      const t = setTimeout(() => setV(target), 0);
      return () => clearTimeout(t);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, ms]);
  return v;
}

/** Advances 0…n-1 every `ms` while `on` (pauses when off screen). */
export function useTicker(n: number, ms: number, on: boolean) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!on || reduce) return;
    const id = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(id);
  }, [n, ms, on, reduce]);
  return i;
}
