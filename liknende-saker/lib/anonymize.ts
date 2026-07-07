/**
 * Regex-based PII redaction for Norwegian free text.
 *
 * Replacement order matters:
 *  1. E-post  — must go before digit patterns (@ symbol makes it unambiguous)
 *  2. FNR (11 digits) — before ORGNR (9) and TLF (8) so longer sequences are caught first
 *  3. ORGNR (9 digits)
 *  4. Regnr  — letter-digit patterns before pure-digit patterns
 *  5. TLF    — last, catches 8-digit Norwegian numbers with optional +47 prefix
 *
 * Task 3 will add a local NER pass for person names and expose a combined
 * `anonymize()` function. Keep `redactPatterns` exported as a named export.
 */
export function redactPatterns(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-POST]')
    .replace(/\b\d{11}\b/g, '[FNR]')
    .replace(/\b\d{9}\b/g, '[ORGNR]')
    .replace(/\b[A-Z]{2}\s?\d{5}\b/g, '[REGNR]')
    .replace(/(\+47\s?)?\b\d{3}\s?\d{2}\s?\d{3}\b/g, '[TLF]');
}
