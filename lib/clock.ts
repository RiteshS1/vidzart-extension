/**
 * High-resolution "epoch ms" that is comparable across extension contexts.
 *
 * The recorder runs in the offscreen document and the event logger in the
 * page. Each context's performance.now() starts at its own timeOrigin, so
 * raw now() values can't be compared, but timeOrigin + now() can (to within
 * a few ms on the same machine). See CLAUDE.md → Clock sync.
 */
export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}
