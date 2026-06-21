"use client";

import React from 'react';
import { useFormatter } from 'next-intl';

// Mirrors the real Celestia3 shapes the M2 dogfood MISCLASSIFIED:
//
//   1. RUNTIME-TIMEZONE IDIOM — `Intl.DateTimeFormat().resolvedOptions().timeZone`
//      feeds the `timeZone` option of an already-extracted next-intl
//      `format.dateTime(...)` formatter. It produces a tz STRING FOR LOGIC, never
//      display copy. It must be flagged structuralIntl + excluded even though it
//      sits INSIDE JSX (Celestia3 TransitFeed.tsx:352 — one of the 4 cowpath-
//      localized surfaces; re-flagging it as an includable date-intl site breaks
//      the M2 regression oracle).
//
//   2. SECONDARY INTL LEAK — `birthDateObj.toLocaleTimeString([], {...})` bound to
//      a `timeString` const, then `${timeString}` interpolated into a backtick
//      LLM-prompt context string (NOT rendered in JSX). Bare `[]` locale, no
//      machine-locale arg. It is machinery for the model, not chrome for the user
//      (Celestia3 CosmicInsightPanel.tsx:91). Must be structural + excluded.

export default function TransitFeed({ selectedDate }: { selectedDate: Date }) {
  const format = useFormatter();

  // SECONDARY LEAK: bare-locale toLocaleTimeString → const → non-JSX template.
  const birthDateObj = new Date();
  const timeString = birthDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const promptContext = `
    [ASTRONOMICAL_CONTEXT]
    - Birth Time: ${timeString}
    - Time Zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
  `;
  void promptContext;

  return (
    <div>
      <span>Target date</span>
      <span>
        {/* RUNTIME-TIMEZONE IDIOM inside an extracted formatter — structural. */}
        {format.dateTime(selectedDate, {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </span>
    </div>
  );
}
