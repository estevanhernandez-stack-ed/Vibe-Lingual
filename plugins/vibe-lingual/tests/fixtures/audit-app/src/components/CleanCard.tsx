"use client";

import React from 'react';

// Clean component — extractable copy + an attribute, no blocker. The audit must
// mark it READY (no firebase-admin, not a dynamic route, no presentational date).

export default function CleanCard() {
  return (
    <section aria-label="Account summary">
      <h2>Your account</h2>
      <p>Everything is up to date.</p>
    </section>
  );
}
