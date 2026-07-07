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
 * Task 3 adds a local NER pass for person names and exposes a combined
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

/**
 * Local, offline NER pass for person names.
 *
 * Uses `@xenova/transformers` running a multilingual BERT NER model entirely
 * on-device (WASM/ONNX) — no text is ever sent to a remote API. The model
 * is downloaded once by the transformers.js runtime and cached on disk
 * (~/.cache or node_modules/.cache depending on environment) for subsequent
 * runs.
 *
 * The pipeline instance is created lazily on first use and memoized in
 * `nerPipelinePromise` so repeated calls to `redactNames`/`anonymize` reuse
 * the same loaded model instead of re-instantiating it every time.
 */

// Minimal shape we rely on from transformers.js token-classification output.
// `start`/`end` are optional because not all model/pipeline versions surface
// character offsets — we handle both cases below.
interface NerToken {
  entity: string;
  score: number;
  index: number;
  word: string;
  start?: number;
  end?: number;
}

type TokenClassificationPipeline = (
  text: string,
  options?: { ignore_labels?: string[] }
) => Promise<NerToken[]>;

let nerPipelinePromise: Promise<TokenClassificationPipeline> | null = null;

function getNerPipeline(): Promise<TokenClassificationPipeline> {
  if (!nerPipelinePromise) {
    nerPipelinePromise = import('@xenova/transformers').then(({ pipeline }) =>
      pipeline(
        'token-classification',
        'Xenova/bert-base-multilingual-cased-ner-hrl'
      )
    ) as unknown as Promise<TokenClassificationPipeline>;
  }
  return nerPipelinePromise;
}

/**
 * transformers.js (v2.17) returns `start`/`end` as `null` for this
 * pipeline/model combination — character offsets are not populated even
 * though the type surface allows them. We reconstruct offsets ourselves by
 * walking the token stream and locating each token's `word` (stripping a
 * leading `##` continuation marker) in the original text, searching from
 * just after the end of the previous token. This is robust to BERT's
 * wordpiece splitting (e.g. "Snakket" -> "S" + "##nak" + "##ket") because we
 * only need *some* tokens (the person ones) to resolve to real spans, and
 * search is strictly left-to-right/monotonic so it can't backtrack into
 * already-consumed text.
 */
function resolveOffsets(text: string, tokens: NerToken[]): NerToken[] {
  const lowerText = text.toLowerCase();
  let cursor = 0;
  return tokens.map((t) => {
    const isContinuation = t.word.startsWith('##');
    const needle = (isContinuation ? t.word.slice(2) : t.word).toLowerCase();
    if (!needle) return { ...t, start: cursor, end: cursor };

    const foundAt = lowerText.indexOf(needle, cursor);
    if (foundAt === -1) {
      // Shouldn't normally happen, but fail safe: don't claim a span.
      return { ...t, start: undefined, end: undefined };
    }
    cursor = foundAt + needle.length;
    return { ...t, start: foundAt, end: cursor };
  });
}

const PERSON_LABEL = /^[BI]-PER$/;

/**
 * Collapse any leftover `[NAVN]` fragments, whitespace, and stray subword
 * pieces (e.g. `##mann`) into a single `[NAVN]` marker. This is the safety
 * net for the word-based fallback path (used when the pipeline output has
 * no character offsets), and is also run after the span-based path as a
 * cheap no-op-if-clean pass.
 */
function collapseAdjacentNavn(text: string): string {
  return text.replace(/\[NAVN\](\s*##\S*|\s+\[NAVN\])*/g, '[NAVN]');
}

export async function redactNames(text: string): Promise<string> {
  if (!text.trim()) return text;

  const classify = await getNerPipeline();
  // Request every token (not just non-"O" ones) so we can walk the full
  // stream left-to-right and derive reliable character offsets even though
  // this model/pipeline combo reports `start`/`end` as `null`.
  const rawTokens = await classify(text, { ignore_labels: [] });
  const tokens = resolveOffsets(text, rawTokens);

  const personTokens = tokens.filter(
    (t) =>
      PERSON_LABEL.test(t.entity) &&
      typeof t.start === 'number' &&
      typeof t.end === 'number'
  );
  if (personTokens.length === 0) return text;

  // Merge consecutive/adjacent person spans into single spans, then replace
  // back-to-front so earlier offsets remain valid as we mutate the string.
  const sorted = [...personTokens].sort((a, b) => a.start! - b.start!);
  const merged: { start: number; end: number }[] = [];
  for (const t of sorted) {
    const last = merged[merged.length - 1];
    if (last && t.start! <= last.end) {
      // Adjacent or overlapping (e.g. wordpiece continuations)
      last.end = Math.max(last.end, t.end!);
    } else {
      merged.push({ start: t.start!, end: t.end! });
    }
  }

  // Extend merges across whitespace-only gaps between separate merged spans
  // (e.g. "Kari" and "Nordmann" as two distinct word-level entities with a
  // space between them that isn't covered by any token span).
  const finalSpans: { start: number; end: number }[] = [];
  for (const span of merged) {
    const last = finalSpans[finalSpans.length - 1];
    if (last) {
      const between = text.slice(last.end, span.start);
      if (/^\s*$/.test(between)) {
        last.end = span.end;
        continue;
      }
    }
    finalSpans.push({ ...span });
  }

  let result = text;
  for (let i = finalSpans.length - 1; i >= 0; i--) {
    const { start, end } = finalSpans[i];
    result = result.slice(0, start) + '[NAVN]' + result.slice(end);
  }
  return collapseAdjacentNavn(result);
}

/**
 * Full anonymization pipeline: fast regex redaction first, then local NER
 * for person names. Order matters — running patterns first means the NER
 * model sees fewer distracting digit/e-mail tokens and can't accidentally
 * "restore" something the regex pass already redacted.
 */
export async function anonymize(text: string): Promise<string> {
  const withoutPatterns = redactPatterns(text);
  return redactNames(withoutPatterns);
}
