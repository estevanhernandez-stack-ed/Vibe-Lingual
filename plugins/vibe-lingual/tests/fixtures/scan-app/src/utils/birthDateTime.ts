// Structural Intl — tz-offset math, NOT display copy. Mirrors the real Celestia3
// src/utils/birthDateTime.ts shape: fixed machine locales ('en-US' / 'en-CA') with
// an explicit timeZone option, used to extract/normalize offsets. The scanner MUST
// flag these structuralIntl + excluded; extracting them corrupts the calculation.

export function tzOffsetMinutes(date: Date, timeZone: string): number {
  // en-US + explicit timeZone → tz-offset extraction. Structural.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

export function isoLocalDate(date: Date, timeZone: string): string {
  // en-CA yields ISO-ordered YYYY-MM-DD — locale-invariant parsing. Structural.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
