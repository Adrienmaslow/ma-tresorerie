import type { ISODate } from '../types';

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

const dfShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dfLong = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dfMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
const dfDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function fmtDate(s?: ISODate): string {
  if (!s) return '—';
  const d = parseISODate(s);
  return d.getFullYear() === new Date().getFullYear() ? dfShort.format(d) : dfLong.format(d);
}
export function fmtDateLong(s: ISODate): string {
  const t = dfDay.format(parseISODate(s));
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function fmtMonth(ym: string): string {
  return dfMonth.format(parseISODate(ym + '-01'));
}

export type PeriodKey = '7d' | '30d' | '3m' | '1y' | 'all' | 'custom';

export function periodRange(p: PeriodKey, custom?: { from: ISODate; to: ISODate }, earliest?: ISODate): { from: ISODate; to: ISODate } {
  const t = today();
  switch (p) {
    case '7d':
      return { from: addDays(t, -6), to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case '3m':
      return { from: addMonths(t, -3), to: t };
    case '1y':
      return { from: addMonths(t, -12), to: t };
    case 'all':
      return { from: earliest && earliest < t ? earliest : addDays(t, -29), to: t };
    case 'custom':
      return custom ?? { from: addDays(t, -29), to: t };
  }
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 4000) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
