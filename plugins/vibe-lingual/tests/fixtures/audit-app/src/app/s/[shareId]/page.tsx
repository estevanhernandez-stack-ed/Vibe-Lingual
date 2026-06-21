import React from 'react';

// dynamic-route-glob gotcha: the [shareId] segment dir. ESLint flat-config treats
// [shareId] as a minimatch char class, so a guard files entry with the literal
// path silently never matches — the guard must glob it with `*` (s/*/page.tsx).
// Carries one un-extracted heading (real extraction work), so the file is in the
// localization surface AND blocked on the glob.

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
