import React from 'react';
import { getFirestore } from 'firebase-admin/firestore';

// firebase-admin-ssr gotcha: this App Router page imports firebase-admin, which is
// banned in Turbopack SSR (safe only in functions/). The locale loader must NOT
// mount here — the audit must flag this BLOCK and mark the file blocked.

export default async function AdminPage() {
  const db = getFirestore();
  await db.collection('audit').get();
  return (
    <main>
      <h1>Admin console</h1>
    </main>
  );
}
