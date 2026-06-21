"use client";

import React from 'react';

// Mirrors the real Celestia3 src/components/DashboardShell.tsx shapes the M2
// dogfood surfaced as misses:
//
//   1. KTD-5 structural miss — a BARE machine-locale date-key call
//      (`new Date().toLocaleDateString('en-CA')`, NO timeZone option) assigned to
//      a const and compared against a stored ISO date. It is date-KEY LOGIC, not
//      display copy. The scanner must flag it structuralIntl + excluded even
//      though there is no timeZone option, because it is NOT rendered in JSX.
//      A later useFormatter rewrite would break the streak/daily-key comparison.
//
//   2. A PRESENTATIONAL machine-locale date that IS rendered in JSX text stays
//      INCLUDED (low confidence) — it is display copy, not a key.

interface DashboardShellProps {
  lastSeenDailyNoteDate: string | null;
  onStreak: () => void;
}

export default function DashboardShell({ lastSeenDailyNoteDate, onStreak }: DashboardShellProps) {
  // STRUCTURAL: bare en-CA ISO date key, compared to a stored date. Not display.
  const todayStr = new Date().toLocaleDateString('en-CA');
  if (lastSeenDailyNoteDate !== todayStr) {
    onStreak();
  }

  // STRUCTURAL: a second bare en-CA date key used as a recompute trigger.
  const todayKey = new Date().toLocaleDateString('en-CA');

  return (
    <section>
      <h1>Today&apos;s sky</h1>
      {/* PRESENTATIONAL: this en-US date IS rendered for the user — stays included. */}
      <time data-key={todayKey}>
        {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
      </time>
    </section>
  );
}
