import type { Cents } from '../types';

const fmt = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formate des centimes en euros : 123456 → "1 234,56 €" */
export function formatCents(c: Cents, opts: { sign?: boolean } = {}): string {
  const s = fmt.format(c / 100).replace(/ | /g, ' ');
  if (opts.sign && c > 0) return '+' + s;
  return s;
}

/** Version compacte pour les axes de graphiques */
export function formatCompact(c: Cents): string {
  const e = c / 100;
  const abs = Math.abs(e);
  if (abs >= 1_000_000) return (e / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  if (abs >= 1_000) return (e / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€';
  return e.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

/**
 * Convertit une saisie utilisateur en centimes, sans passer par les flottants.
 * Accepte "12", "12,5", "12.50", "1 234,56", "-3,2", "1.234,56".
 * Retourne null si la saisie est invalide.
 */
export function parseEuroToCents(input: string): Cents | null {
  let s = input.trim().replace(/[\s  €]/g, '');
  if (!s) return null;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  // Séparateur décimal = dernier ',' ou '.' suivi de 1 ou 2 chiffres en fin de chaîne
  const m = s.match(/^(.*?)(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  const intPart = (m[1] || '0').replace(/[.,]/g, '');
  const dec = m[2] ?? '';
  if (!/^\d+$/.test(intPart) || (dec && !/^\d+$/.test(dec))) return null;
  // Un séparateur de milliers doit être suivi de groupes de 3 chiffres
  if (/[.,]/.test(m[1] || '') && !/^\d{1,3}([.,]\d{3})+$/.test(m[1])) return null;
  // Le séparateur décimal ne peut pas aussi servir de séparateur de milliers
  if (dec && (m[1] || '').includes(s.charAt(s.length - dec.length - 1))) return null;
  if (intPart.length > 13) return null;
  const cents = parseInt(intPart, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

/** Centimes → chaîne éditable "1234,56" */
export function centsToInput(c: Cents | undefined): string {
  if (c === undefined || c === null) return '';
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? '-' : '') + Math.floor(a / 100) + ',' + String(a % 100).padStart(2, '0');
}

/** Multiplie des centimes par une quantité entière */
export function mulCents(c: Cents, qty: number): Cents {
  return Math.round(c * qty);
}

export function sumCents(values: Cents[]): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/** Pourcentage arrondi à 1 décimale, ou null si dénominateur nul */
export function percent(num: Cents, den: Cents): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}
