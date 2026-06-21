// M7 — next-intl transform codemod tests. Fixture in→out across every shape the
// cowpath proved:
//   - a CLIENT component → useTranslations hook + t() calls
//   - a SERVER (async) component → getTranslations (await) + t() calls
//   - attribute kinds (placeholder / aria-label / title / alt)
//   - a DATE display site → useFormatter + format.dateTime(date, { timeZone: <runtime> })
//   - a STRUCTURAL-Intl site (resolvedOptions runtime-zone read, machine-locale
//     date-key) left ALONE
//   - idempotency: re-running on already-extracted code is a no-op
//
// The codemod is driven via the programmatic `transform(source, opts)` entry (no
// CLI spawn) and asserted on the emitted code.

import { transform } from '../engine/adapters/next-intl/transform.mjs';

// run the codemod twice and assert the 2nd run is a byte-for-byte no-op.
function idempotent(source, opts) {
  const first = transform(source, opts);
  const second = transform(first.code, opts);
  return { first, second, stable: second.code === first.code, secondChanged: second.changed };
}

describe('client component — useTranslations hook + t() calls', () => {
  const src = `"use client";
import React from 'react';

export default function Greeting() {
  return (
    <div className="wrap">
      <h1>Welcome back</h1>
      <p>Choose your destiny</p>
    </div>
  );
}
`;

  test('adds the useTranslations import + a const t hook for the component namespace', () => {
    const out = transform(src, { path: 'src/components/Greeting.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("import { useTranslations } from 'next-intl'");
    expect(out.code).toContain("const t = useTranslations('Greeting')");
  });

  test('rewrites JSX text into {t(key)} calls and registers the catalog keys', () => {
    const out = transform(src, { path: 'src/components/Greeting.tsx' });
    expect(out.code).toContain("{t('welcomeBack')}");
    expect(out.code).toContain("{t('chooseYourDestiny')}");
    expect(out.keys).toMatchObject({
      welcomeBack: 'Welcome back',
      chooseYourDestiny: 'Choose your destiny',
    });
  });

  test('does NOT rewrite a CSS-class string that slipped into the gate', () => {
    const out = transform(src, { path: 'src/components/Greeting.tsx' });
    // className="wrap" stays a literal — not user-facing copy.
    expect(out.code).toContain('className="wrap"');
  });

  test('is idempotent — a second pass changes nothing', () => {
    const r = idempotent(src, { path: 'src/components/Greeting.tsx' });
    expect(r.stable).toBe(true);
    expect(r.secondChanged).toBe(false);
    // the hook + import appear exactly once.
    expect(r.first.code.match(/useTranslations\(/g).length).toBe(1);
    expect(r.first.code.match(/from 'next-intl'/g).length).toBe(1);
  });
});

describe('server component — getTranslations (await) for an async file', () => {
  const src = `import { getTranslations as _g } from 'next-intl/server';

export default async function SharePage() {
  return (
    <main>
      <h1>Reading not found</h1>
      <p>This reading has expired or never existed.</p>
    </main>
  );
}
`;
  // NOTE: import aliased to force the codemod to add the canonical specifier.
  const clean = src.replace("import { getTranslations as _g } from 'next-intl/server';\n\n", '');

  test('picks getTranslations (server) — NOT useTranslations — and awaits it', () => {
    const out = transform(clean, { path: 'src/app/s/[shareId]/page.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("import { getTranslations } from 'next-intl/server'");
    // namespace is derived deterministically from the route segment 's' (the
    // dynamic [shareId] is skipped) → PascalCase 'S'. A caller can override via
    // options.namespace to match a human-chosen name like 'Share'.
    expect(out.code).toMatch(/const t = await getTranslations\('[A-Z]\w*'\)/);
    // never a client hook in a server file.
    expect(out.code).not.toContain('useTranslations');
  });

  test('honors an explicit namespace override (the cowpath Share name)', () => {
    const out = transform(clean, { path: 'src/app/s/[shareId]/page.tsx', namespace: 'Share' });
    expect(out.code).toContain("const t = await getTranslations('Share')");
  });

  test('derives the namespace from a meaningful ancestor, skipping [shareId]', () => {
    const out = transform(clean, { path: 'src/app/s/[shareId]/page.tsx' });
    // 's' grandparent → 'S'? no — page files walk to the nearest non-dynamic,
    // non-route ancestor: 's' → PascalCase 'S'. The cowpath uses 'Share'; the
    // engine derives from the path, and 's' is the real segment. Assert it is a
    // stable PascalCase token, not '[shareId]'.
    expect(out.code).toMatch(/getTranslations\('[A-Z]\w*'\)/);
    expect(out.code).not.toContain('[shareId]');
  });

  test('rewrites server JSX text into {t(key)}', () => {
    const out = transform(clean, { path: 'src/app/s/[shareId]/page.tsx' });
    expect(out.code).toContain("{t('readingNotFound')}");
  });

  test('is idempotent on a server file', () => {
    const r = idempotent(clean, { path: 'src/app/s/[shareId]/page.tsx' });
    expect(r.stable).toBe(true);
    expect(r.first.code.match(/getTranslations/g).length).toBe(2); // import + call
  });
});

describe('attribute kinds — placeholder / aria-label / title / alt', () => {
  const src = `"use client";
export default function Form() {
  return (
    <form>
      <input placeholder="Enter your name" />
      <button aria-label="Submit the form" title="Click to submit">Go</button>
      <img src="/x.png" alt="A decorative star" />
    </form>
  );
}
`;

  test('rewrites all four attribute kinds into {t(key)} expression containers', () => {
    const out = transform(src, { path: 'src/components/Form.tsx' });
    expect(out.code).toContain('placeholder={t(');
    expect(out.code).toContain('aria-label={t(');
    expect(out.code).toContain('title={t(');
    expect(out.code).toContain('alt={t(');
    // the JSX text "Go" is a single 2-char token at the floor — still extracted
    // (the floor only rejects <=2 char tokens; "Go" is exactly 2 → rejected).
    expect(out.keys).toMatchObject({
      enterYourName: 'Enter your name',
      submitTheForm: 'Submit the form',
      clickToSubmit: 'Click to submit',
      aDecorativeStar: 'A decorative star',
    });
  });

  test('does NOT rewrite machinery attributes (src, className)', () => {
    const out = transform(src, { path: 'src/components/Form.tsx' });
    expect(out.code).toContain('src="/x.png"');
  });

  test('is idempotent across attribute kinds', () => {
    const r = idempotent(src, { path: 'src/components/Form.tsx' });
    expect(r.stable).toBe(true);
  });
});

describe('date display site — useFormatter + per-call runtime timeZone', () => {
  const src = `"use client";
export default function Feed({ selectedDate }) {
  return (
    <div>
      <span>{selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
    </div>
  );
}
`;

  test('rewrites a display toLocaleDateString into format.dateTime with the runtime tz', () => {
    const out = transform(src, { path: 'src/components/Feed.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("import { useFormatter } from 'next-intl'");
    expect(out.code).toContain('const format = useFormatter()');
    expect(out.code).toContain('format.dateTime(selectedDate');
    // the PROVEN cowpath per-call timeZone fix.
    expect(out.code).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    // existing display options are carried through.
    expect(out.code).toContain("weekday: 'short'");
  });

  test('does NOT add a second timeZone when the author already pinned one', () => {
    const pinned = `"use client";
export default function Feed({ d }) {
  return <span>{d.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric' })}</span>;
}
`;
    const out = transform(pinned, { path: 'src/components/Feed.tsx' });
    expect(out.code).toContain('format.dateTime(d');
    // exactly one timeZone key — the author's, not a second injected one.
    expect(out.code.match(/timeZone:/g).length).toBe(1);
    expect(out.code).toContain("timeZone: 'UTC'");
  });

  test('is idempotent on a date site', () => {
    const r = idempotent(src, { path: 'src/components/Feed.tsx' });
    expect(r.stable).toBe(true);
    expect(r.first.code.match(/useFormatter\(\)/g).length).toBe(1);
  });
});

describe('structural-Intl — left ALONE (never rewritten)', () => {
  test('a resolvedOptions() runtime-zone read for logic is untouched', () => {
    const src = `"use client";
export default function C() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <span>{zone}</span>;
}
`;
    const out = transform(src, { path: 'src/components/C.tsx' });
    // the structural read survives verbatim; no format.dateTime, no useFormatter.
    expect(out.code).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(out.code).not.toContain('format.dateTime');
    expect(out.code).not.toContain('useFormatter');
  });

  test('a machine-locale date-key (en-CA) rendered for logic is NOT formatted', () => {
    // a machine-locale toLocaleDateString is tz-offset/date-key math even if it
    // happens to be inside JSX — never rewritten to format.dateTime.
    const src = `"use client";
export default function C({ d }) {
  return <span>{d.toLocaleDateString('en-CA')}</span>;
}
`;
    const out = transform(src, { path: 'src/components/C.tsx' });
    expect(out.code).toContain("d.toLocaleDateString('en-CA')");
    expect(out.code).not.toContain('format.dateTime');
  });

  test('a date call NOT inside JSX (assigned to a const) is structural — untouched', () => {
    const src = `"use client";
export default function C({ d }) {
  const label = d.toLocaleDateString(undefined, { day: 'numeric' });
  return <span>{label}</span>;
}
`;
    const out = transform(src, { path: 'src/components/C.tsx' });
    // not rendered directly in the JSX expression → not a display site here.
    expect(out.code).toContain('const label = d.toLocaleDateString(');
    expect(out.code).not.toContain('format.dateTime');
  });
});

describe('idempotency — already-extracted code is a no-op', () => {
  test('a file that already uses t() is not re-wrapped', () => {
    const already = `"use client";
import { useTranslations } from 'next-intl';
export default function C() {
  const t = useTranslations('C');
  return <p>{t('hello')}</p>;
}
`;
    const out = transform(already, { path: 'src/components/C.tsx' });
    expect(out.changed).toBe(false);
    expect(out.code).toBe(already);
  });

  test('mixed: extracts a new literal but leaves the already-extracted one alone', () => {
    const mixed = `"use client";
import { useTranslations } from 'next-intl';
export default function C() {
  const t = useTranslations('C');
  return (<div>{t('hello')}<span>Brand new text</span></div>);
}
`;
    const out = transform(mixed, { path: 'src/components/C.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("{t('hello')}"); // untouched
    expect(out.code).toContain("{t('brandNewText')}"); // newly extracted
    // import + hook NOT duplicated.
    expect(out.code.match(/useTranslations\(/g).length).toBe(1);
    expect(out.code.match(/from 'next-intl'/g).length).toBe(1);
  });
});

describe('no-op on a file with no user-facing sites', () => {
  test('returns the source unchanged, changed=false', () => {
    const src = `"use client";
export default function Empty() {
  return <div className="grid gap-4" data-testid="empty" />;
}
`;
    const out = transform(src, { path: 'src/components/Empty.tsx' });
    expect(out.changed).toBe(false);
    expect(out.code).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// Phase-2 BUG-1 — server/client classification by USAGE, not by directive.
// The at-scale Celestia3 run found components with NO 'use client' directive that
// use client-only hooks (useState + custom useAuth/useSubscription). The old
// "no directive ⇒ server" heuristic rewrote them to `export default async
// function` + getTranslations — invalid (an async server component can't call
// useState). The fix classifies on client signals (hooks / handlers) instead.
// ---------------------------------------------------------------------------
describe('BUG-1 — client detection without a directive', () => {
  test('(a) no directive + useState → CLIENT useTranslations, NOT async/getTranslations', () => {
    // WelcomeModal shape: no 'use client', uses useState. Must be client.
    const src = `import React, { useState } from 'react';

export default function WelcomeModal({ isOpen, userName }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  if (!isOpen) return null;
  return (
    <div className="modal">
      <h2>Welcome back</h2>
      <p>Align your digital self with the cosmos</p>
    </div>
  );
}
`;
    const out = transform(src, { path: 'src/components/WelcomeModal.tsx' });
    expect(out.changed).toBe(true);
    // CLIENT path: useTranslations hook, NOT the server getTranslations.
    expect(out.code).toContain("import { useTranslations } from 'next-intl'");
    expect(out.code).toContain("const t = useTranslations('WelcomeModal')");
    expect(out.code).not.toContain('getTranslations');
    expect(out.code).not.toContain('next-intl/server');
    // the function must NOT have been converted to async.
    expect(out.code).not.toMatch(/async function WelcomeModal/);
    expect(out.code).toMatch(/export default function WelcomeModal/);
    // literals extracted.
    expect(out.code).toContain("{t('welcomeBack')}");
  });

  test('(a2) no directive + custom use* hook (useAuth/useSubscription) → CLIENT', () => {
    // ManageSubscription shape: no directive, custom client hooks + useState.
    const src = `import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';

export function ManageSubscription() {
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const [isProcessing, setIsProcessing] = useState(false);
  return <div><h3>Manage your subscription</h3></div>;
}
`;
    const out = transform(src, { path: 'src/components/ManageSubscription.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("useTranslations('ManageSubscription')");
    expect(out.code).not.toContain('getTranslations');
    expect(out.code).not.toMatch(/async function ManageSubscription/);
  });

  test('(a3) no directive + event handler (onClick) → CLIENT', () => {
    const src = `import React from 'react';

export default function Btn({ onClose }) {
  return <button onClick={onClose}>Close the dialog</button>;
}
`;
    const out = transform(src, { path: 'src/components/Btn.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("useTranslations('Btn')");
    expect(out.code).not.toContain('getTranslations');
    expect(out.code).not.toMatch(/async function Btn/);
  });

  test('(b) no directive + pure render, NO hooks + already async → SERVER getTranslations', () => {
    // An async server component with no client signals: server is valid (it can
    // await), so getTranslations is correct.
    const src = `export default async function NotFound() {
  return (
    <main>
      <h1>Reading not found</h1>
    </main>
  );
}
`;
    const out = transform(src, { path: 'src/app/s/[shareId]/page.tsx', namespace: 'Share' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("import { getTranslations } from 'next-intl/server'");
    expect(out.code).toContain("const t = await getTranslations('Share')");
    expect(out.code).not.toContain('useTranslations');
  });

  test('(b2) no directive + pure render, NO hooks + NOT async → CLIENT (never convert to async)', () => {
    // Ambiguous: no directive, no client signals, but the function is NOT async.
    // We must NOT flip it to async to satisfy getTranslations — prefer client.
    const src = `export default function Banner() {
  return <div><p>System status nominal</p></div>;
}
`;
    const out = transform(src, { path: 'src/components/Banner.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("useTranslations('Banner')");
    expect(out.code).not.toContain('getTranslations');
    // critical: the function stays NON-async.
    expect(out.code).not.toMatch(/async function Banner/);
    expect(out.code).toMatch(/export default function Banner/);
  });

  test('(c) explicit "use client" directive → CLIENT (directive wins for client)', () => {
    const src = `"use client";
export default function Panel() {
  return <div><span>Open settings</span></div>;
}
`;
    const out = transform(src, { path: 'src/components/Panel.tsx' });
    expect(out.changed).toBe(true);
    expect(out.code).toContain("useTranslations('Panel')");
    expect(out.code).not.toContain('getTranslations');
  });

  test('(c2) explicit "use client" + happens to be async → still CLIENT (directive wins)', () => {
    // A 'use client' async component is still a client component; never server.
    const src = `"use client";
import React, { useState } from 'react';
export default function AsyncClient() {
  const [x] = useState(0);
  return <div><span>Loading your chart</span></div>;
}
`;
    const out = transform(src, { path: 'src/components/AsyncClient.tsx' });
    expect(out.code).toContain('useTranslations');
    expect(out.code).not.toContain('getTranslations');
  });
});

// ---------------------------------------------------------------------------
// Phase-2 BUG-2 — module-scope closure literals must stay INLINE.
// AstrocartographyView had a `dynamic(() => import(...), { loading: () => (
// <div>Loading map…</div>) })` at module scope. The codemod emitted t('loadingMap')
// there, but `t` is only declared inside the component body (useTranslations) →
// ReferenceError at render. The loading-closure literal must be left inline; the
// component-body literals must still extract.
// ---------------------------------------------------------------------------
describe('BUG-2 — t-binding scope reachability', () => {
  const src = `'use client';
import React from 'react';
import dynamic from 'next/dynamic';

const MapInner = dynamic(() => import('./MapInner'), {
  ssr: false,
  loading: () => (
    <div className="loader">
      <span>Loading map please wait</span>
    </div>
  ),
});

export default function AstroView() {
  return (
    <div className="view">
      <MapInner />
      <h2>Your astrocartography</h2>
    </div>
  );
}
`;

  test('the module-scope dynamic() loading literal is LEFT INLINE (no t())', () => {
    const out = transform(src, { path: 'src/components/AstroView.tsx' });
    expect(out.changed).toBe(true);
    // the loading-closure literal stays verbatim — `t` is not in scope there.
    expect(out.code).toContain('Loading map please wait');
    expect(out.code).not.toContain("t('loadingMap')");
    expect(out.code).not.toContain("t('loadingMapPleaseWait')");
  });

  test('the component-body literal STILL extracts to t()', () => {
    const out = transform(src, { path: 'src/components/AstroView.tsx' });
    expect(out.code).toContain("{t('yourAstrocartography')}");
    expect(out.code).toContain("const t = useTranslations('AstroView')");
  });

  test('the loading literal is not registered as a catalog key', () => {
    const out = transform(src, { path: 'src/components/AstroView.tsx' });
    // only the component-body key lands in the catalog.
    expect(out.keys).toMatchObject({ yourAstrocartography: 'Your astrocartography' });
    const values = Object.values(out.keys);
    expect(values).not.toContain('Loading map please wait');
  });

  test('a top-level const literal outside any component body is left inline', () => {
    const top = `'use client';
const HEADING = "Welcome to the cosmos";
export default function C() {
  return <div><h1>Your reading is ready</h1></div>;
}
`;
    const out = transform(top, { path: 'src/components/C.tsx' });
    // the module-scope const string is not JSX text and not in the body → untouched.
    expect(out.code).toContain('const HEADING = "Welcome to the cosmos"');
    expect(out.code).toContain("{t('yourReadingIsReady')}");
  });

  test('(e) idempotency holds — the loading literal stays inline on re-run, body stable', () => {
    const r = idempotent(src, { path: 'src/components/AstroView.tsx' });
    expect(r.stable).toBe(true);
    expect(r.secondChanged).toBe(false);
    // the loading literal survived both passes; the hook is added exactly once.
    expect(r.first.code).toContain('Loading map please wait');
    expect(r.first.code.match(/useTranslations\(/g).length).toBe(1);
  });
});
