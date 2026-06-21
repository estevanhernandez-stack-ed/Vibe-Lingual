import React from 'react';

// SSR dynamic route — the [shareId] glob case the guard must handle with `*`.
// Carries one un-extracted JSX-text heading.

interface Props {
  params: Promise<{ shareId: string }>;
}

export default async function SharePage({ params }: Props) {
  const { shareId } = await params;
  if (!shareId) {
    return <h1>Reading not found</h1>;
  }
  return (
    <main>
      <h1>Shared reading</h1>
    </main>
  );
}
