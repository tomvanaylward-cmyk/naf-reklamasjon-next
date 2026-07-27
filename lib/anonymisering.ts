// lib/anonymisering.ts
//
// Runtime-anonymisering for kunnskapsbasen. For appens egne saker kjenner vi
// PII-en strukturert (customer_name, customer_email, customer_phone, reg_nr
// på saken; ansattnavn i profiles) — kjente-verdier-redaksjon er derfor
// sterkere enn NER her. Regex-mønstrene (portert fra spiken) er sikkerhetsnett.
// NER kjøres kun i den lokale legacy-importen (liknende-saker/).

export function redactPatterns(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-POST]')
    .replace(/\b\d{11}\b/g, '[FNR]')
    .replace(/\b\d{9}\b/g, '[ORGNR]')
    .replace(/\b[A-Z]{2}\s?\d{5}\b/g, '[REGNR]')
    .replace(/(\+47\s?)?\b\d{3}\s?\d{2}\s?\d{3}\b/g, '[TLF]');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Erstatter alle forekomster av kjente verdier (kundenavn, ansattnavn, …)
 * med [NAVN], case-insensitivt. Verdier under 3 tegn ignoreres (støy).
 */
export function redactKnownValues(text: string, values: (string | null | undefined)[]): string {
  let out = text;
  for (const v of values) {
    const trimmed = (v ?? '').trim();
    if (trimmed.length < 3) continue;
    out = out.replace(new RegExp(escapeRegex(trimmed), 'gi'), '[NAVN]');
  }
  return out;
}

/** Full runtime-anonymisering: kjente verdier først, deretter mønstre. */
export function anonymiserSak(text: string, kjenteNavn: (string | null | undefined)[]): string {
  return redactPatterns(redactKnownValues(text, kjenteNavn));
}
