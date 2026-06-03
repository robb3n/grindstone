export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let dayEndHour = 0;

export function setDayEndHour(h: number): void {
  dayEndHour = (h === 1 || h === 2) ? h : 0;
}

// Reviews before dayEndHour count toward the previous day. Returning a shifted
// Date (not just a date string) lets callers compose intervals on top.
export function logicalNow(): Date {
  if (dayEndHour === 0) return new Date();
  const d = new Date();
  if (d.getHours() < dayEndHour) {
    d.setTime(d.getTime() - dayEndHour * 3600_000);
  }
  return d;
}

export function today(): string {
  return formatDate(logicalNow());
}

export function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
