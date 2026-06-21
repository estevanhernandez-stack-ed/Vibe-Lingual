// structural-intl gotcha: tz-offset math, NOT display copy. Fixed machine locale
// ('en-US') + explicit timeZone option, consumed by formatToParts. The scanner
// flags it structuralIntl + excluded; the audit restates it as a confirm-before-
// extract INFO (the audit-time gate — extracting it corrupts the calculation).

export function tzOffsetMinutes(date: Date, timeZone: string): number {
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
