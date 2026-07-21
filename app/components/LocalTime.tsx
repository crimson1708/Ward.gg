"use client";

import { useEffect, useState } from "react";

// Renders a timestamp in the VIEWER's own timezone. Server-side rendering
// would use the server's timezone instead, which is wrong for anyone not
// sitting next to the server — so this only fills in the real time after
// mounting in the browser. Before that it shows a neutral placeholder, which
// keeps the server-rendered and first client-rendered HTML identical (no
// hydration mismatch); the effect then swaps in the correct local time.
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  }, [iso]);

  return <span>{text ?? "--:--"}</span>;
}
