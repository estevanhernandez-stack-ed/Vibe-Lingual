'use client';

import { useState } from 'react';

export default function WelcomePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="welcome-panel">
      <h1>Welcome to the cosmos</h1>
      <p>Your daily reading is ready</p>
      <button aria-label="Open your reading" onClick={() => setOpen(true)}>
        Open reading
      </button>
    </div>
  );
}
