"use client";

// The app's space dots (app/src/switchMotion.ts: starLayers and the opening), on a canvas behind Coming Soon: fine white
// dots of a few sizes and brightnesses, the same every visit (a seeded random), gathering in six waves that each sweep
// in round the orbit's centre along ellipses shaped like it. The app's dots then stop; here they drift on slowly the
// same way round as the cards, each wave at its own pace, so the page keeps turning. Still when reduced motion is set.
import { useEffect, useRef } from "react";
import styles from "./page.module.css";

const LAYERS = 6;
const DENSITY = 26 / (390 * 844); // the app's: 26 dots a wave on a 390 × 844 phone
const FLAT = 0.25; // the ellipses' height over width, about the orbit's tilt seen from the front
// The opening, in seconds, as the app's: waves start STEP apart, fade in over FADE and sweep in over SWEEP.
const OPEN_AT = 0.15;
const FADE = 0.55;
const SWEEP = 0.9;
const STEP = (1.6 - OPEN_AT - SWEEP) / (LAYERS - 1);
const DRIFT = (2 * Math.PI) / 240; // radians a second: a turn in four minutes, slower than the cards' minute

type Dot = { u: number; v: number; r: number; o: number };

const phase = (t: number, at: number, dur: number) => Math.min(Math.max((t - at) / dur, 0), 1);
const cubicOut = (p: number) => 1 - (1 - p) ** 3;
const quartOut = (p: number) => 1 - (1 - p) ** 4;

// The dots of every wave, as offsets from the centre before the ellipse's squash, over a square big enough that the
// page stays covered however far they turn.
function makeDots(width: number, height: number): Dot[][] {
  let s = 7; // mulberry32, the app's seed
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const half = Math.hypot(width / 2, height / 2 / FLAT);
  const each = Math.round(DENSITY * (2 * half) * (2 * half * FLAT)); // the app's density, on screen
  return Array.from({ length: LAYERS }, () =>
    Array.from({ length: each }, () => {
      const big = rand() < 0.12; // a few brighter ones, as in the splash photo
      return {
        u: (rand() * 2 - 1) * half,
        v: (rand() * 2 - 1) * half,
        r: big ? 1 + rand() * 0.6 : 0.4 + rand() * 0.5,
        o: big ? 0.8 + rand() * 0.2 : 0.25 + rand() * 0.45,
      };
    }),
  );
}

export function SpaceDots() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[][] = [];
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;

    // Sized to the page, centred on the middle (the block marked data-orbit).
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const orbit = canvas.parentElement?.querySelector("[data-orbit]")?.getBoundingClientRect();
      cx = orbit ? orbit.left - box.left + orbit.width / 2 : w / 2;
      cy = orbit ? orbit.top - box.top + orbit.height / 2 : h / 2;
      dots = makeDots(w, h);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      dots.forEach((layer, k) => {
        const at = OPEN_AT + k * STEP;
        const fade = still ? 1 : cubicOut(phase(t, at, FADE));
        if (fade === 0) return;
        // Still to sweep in (the app's: 150° less 12° a wave), plus the drift so far, a little faster for later waves.
        const sweep = still ? 0 : ((-(150 - k * 12) * Math.PI) / 180) * (1 - quartOut(phase(t, at, SWEEP)));
        const a = sweep + (still ? 0 : DRIFT * (1 + 0.15 * k) * t);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        for (const d of layer) {
          const x = cx + d.u * cos - d.v * sin;
          const y = cy + FLAT * (d.u * sin + d.v * cos);
          if (x < -2 || x > w + 2 || y < -2 || y > h + 2) continue;
          ctx.globalAlpha = fade * d.o;
          ctx.beginPath();
          ctx.arc(x, y, d.r, 0, 2 * Math.PI);
          ctx.fill();
        }
      });
    };

    measure();
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      draw((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    const resized = () => {
      measure();
      if (still) draw(0);
    };
    if (still) draw(0);
    else frame = requestAnimationFrame(tick);
    addEventListener("resize", resized);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resized);
    };
  }, []);

  return <canvas ref={ref} className={styles.dots} aria-hidden="true" />;
}
