/** Approximate whole-credit display; never used for accounting or allocation validation. */
export function formatCreditBalance(
  value: number | string | null | undefined,
  locale: string
): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const rounded = Math.sign(amount) * Math.round(Math.abs(amount));
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(rounded) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 0,
  }).format(Object.is(rounded, -0) ? 0 : rounded);
}
