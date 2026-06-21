"use client";

import React from 'react';

// timezone-decision gotcha: a PRESENTATIONAL locale-sensitive date rendered in JSX.
// Its useFormatter rewrite needs a timeZone choice the plugin must SURFACE, not
// auto-resolve (a global fixed tz shifts dates a day for distant viewers). The
// scanner includes it (not excluded) at low confidence; the audit emits a timezone
// WARN for the site + a REQUIRED timezone decision.

export default function EventList({ events }: { events: { id: string; at: Date }[] }) {
  return (
    <ul aria-label="Upcoming events">
      {events.map((e) => (
        <li key={e.id}>
          Starts {e.at.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </li>
      ))}
    </ul>
  );
}
