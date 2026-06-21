import React from 'react';

// Root layout — hardcodes <html lang="en"> (the html-lang decision target).
// Clean SSR surface: no firebase-admin import, so the locale loader CAN mount here.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
