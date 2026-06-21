"use client";

import React, { createContext, useContext } from 'react';

// Mirrors the real Celestia3 src/context/AuthContext.tsx hook-provider guard the
// M2 dogfood OVER-CAPTURED: a `new Error('useAuth must be used within ...')`
// invariant that never reaches a user. The scanner must NOT emit it as a
// localizable toast site — translating a dev assertion is pure noise.

const AuthContext = createContext<{ uid: string } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // dev-only invariant — must NOT be captured as a localization site.
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function notifyUser() {
  // a genuine user-facing error string — this one SHOULD still be captured.
  throw new Error('Could not load your account');
}
