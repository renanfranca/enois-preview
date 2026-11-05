// Included only in the demo bundle. No timers, polling or synthetic events renew activity.
export function trackDemoActivity(target, send, now = () => Date.now()) {
  let lastSent = -Infinity;
  let inFlight = false;
  const onInteraction = (event) => {
    if (
      !event.isTrusted ||
      target.visibilityState !== "visible" ||
      inFlight ||
      now() - lastSent < 15_000
    )
      return;
    inFlight = true;
    lastSent = now();
    Promise.resolve()
      .then(send)
      .catch(() => {
        // The next human action may retry; background retries must not renew the lease.
        lastSent = -Infinity;
      })
      .finally(() => {
        inFlight = false;
      });
  };
  const events = ["keydown", "pointerdown", "pointermove", "touchstart", "wheel"];
  for (const name of events) target.addEventListener(name, onInteraction, { passive: true });
  return () => {
    for (const name of events) target.removeEventListener(name, onInteraction);
  };
}
