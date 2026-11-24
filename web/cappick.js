// Which pictures a big call shows (the video cap, net.js): pinned / big / shared screens first, then who spoke last.
// A picture that is on keeps its place unless the one taking it spoke CAP_SWAP_MS later: ranking by the exact
// millisecond swapped the pictures every 700 ms while several people talked (2026-11-24 big_test: everyone got
// 14-15 videos over 5 s with a cap of 9). Zoom and Meet hold the active speaker the same way.
export const CAP_SWAP_MS = 3000;

/**
 * items: [{ top: bool (pinned, big or a shared screen), spokeAt: ms, on: bool (shown now) }]
 * returns the Set of items that get video (at most `cap`)
 */
export function capPick(items, cap, swapMs = CAP_SWAP_MS, maxSwaps = Infinity) {
  const rank = (x) => (x.top ? 1e15 : 0) + (x.spokeAt || 0);
  const sorted = [...items].sort((a, b) => rank(b) - rank(a));
  const on = sorted.slice(0, cap);
  const won = new Set();
  let swaps = 0;
  for (const x of sorted.slice(cap)) {
    if (!x.on || x.top) continue;
    // the newcomer with the lowest rank among those taking a place that hasn't won one yet (on is sorted: from the end)
    let i = on.length - 1;
    while (i >= 0 && (on[i].on || on[i].top || won.has(on[i]))) i--;
    if (i < 0) break;
    if (swaps < maxSwaps && (on[i].spokeAt || 0) - (x.spokeAt || 0) >= swapMs) {
      won.add(on[i]);
      swaps++;
    } else on[i] = x;
  }
  const got = new Set(on);
  got.swaps = swaps;
  return got;
}

/**
 * capPick with memory, one per viewer: at most one shown picture is replaced every swapMs; a free place fills at
 * once. People talking on and off (several open microphones) each passed the CAP_SWAP_MS comparison on their own
 * turn, so the pictures still swapped all the time (2026-11-24 big_test: 194 changes in 3 s over 16 viewers).
 * returns (items, now = Date.now()) => Set
 */
export function capPicker(cap, swapMs = CAP_SWAP_MS) {
  let lastSwap = -Infinity;
  return (items, now = Date.now()) => {
    const got = capPick(items, cap, swapMs, now - lastSwap >= swapMs ? 1 : 0);
    if (got.swaps) lastSwap = now;
    return got;
  };
}
