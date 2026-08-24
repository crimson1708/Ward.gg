"use client";

import { useSyncExternalStore } from "react";

// No-op subscribe — this value only ever changes via re-render (a new `iso`
// prop), never asynchronously, so there's nothing to subscribe to.
function subscribe() {
  return () => {};
}

// Renders a timestamp in the VIEWER's own timezone. Server-side rendering
// would use the server's timezone instead, which is wrong for anyone not
// sitting next to the server — so the real time is only ever read on the
// client (getSnapshot), while the server snapshot stays a neutral
// placeholder. That keeps server-rendered and first client-rendered HTML
// identical (no hydration mismatch) without needing an effect + setState.
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    () => null
  );

  return <span>{text ?? "--:--"}</span>;
}
