"use client";

import React from 'react';

// A component carrying the full spread of scan targets:
//   - JSX text that IS user-facing copy            (must be extracted)
//   - attribute kinds placeholder/aria-label/title/alt (must be extracted)
//   - className / data-testid / id / htmlFor strings   (false positives — must NOT)
//   - a string already wrapped in t()                  (regression oracle — must NOT)
//   - a tailwind-token className                        (false positive — must NOT)

interface ProfileCardProps {
  name: string;
}

const CARD_CLASS = 'w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3';

export default function ProfileCard({ name }: ProfileCardProps) {
  // Pretend a translation hook is in scope; the literal here is ALREADY extracted.
  const t = (k: string) => k;

  return (
    <section
      className={CARD_CLASS}
      data-testid="profile-card"
      id="profile-root"
      role="region"
    >
      <h2 className="text-lg font-bold">Welcome back, traveler</h2>

      <p className="text-sm text-slate-400">
        Your reading is ready to view.
      </p>

      {/* already extracted — the scanner must skip this, never re-flag it */}
      <span>{t('alreadyExtractedLabel')}</span>

      <label htmlFor="search-input" className="sr-only">
        Search field
      </label>
      <input
        id="search-input"
        placeholder="Search your readings"
        aria-label="Search readings input"
        className="flex items-center gap-3"
        data-cy="search-box"
      />

      <button title="Open settings panel" aria-label="Settings" className="rounded-full">
        Settings
      </button>

      <img src="/avatar.png" alt="User profile avatar" className="h-8 w-8" />
    </section>
  );
}
