/** Animate a number from 0 → target inside an element (ease-out-cubic, 900ms). */
export function countUp(
  el: HTMLElement,
  target: number,
  duration = 900,
  delay = 0,
  format: (n: number) => string = String,
): void {
  if (target === 0) { el.textContent = format(0); return; }
  const start = performance.now() + delay;
  const tick = (now: number) => {
    if (!el.isConnected) return;           // element removed — stop silently
    const t = Math.max(0, Math.min(1, (now - start) / duration));
    const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    el.textContent = format(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
