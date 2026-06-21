"use client";

import React from 'react';
import { toast } from 'sonner';

// Toast / error string literals (kind: toast) + one PRESENTATIONAL date site.

export function saveProfile() {
  try {
    // ...
    toast.success('Profile saved successfully');
  } catch (e) {
    toast.error('Could not save your profile');
    throw new Error('Profile save failed');
  }
}

export function ReadingDate({ date }: { date: Date }) {
  // Presentational date — rendered for the user. Included, low confidence
  // (needs a useFormatter rewrite + a timeZone decision), NOT excluded.
  return <time>{date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</time>;
}
