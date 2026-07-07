import { describe, it, expect } from 'vitest';
import { redactPatterns } from './anonymize';

describe('redactPatterns', () => {
  it('fjerner e-post', () => {
    expect(redactPatterns('kontakt ola@example.no i dag')).toBe('kontakt [E-POST] i dag');
  });
  it('fjerner norsk telefonnummer', () => {
    expect(redactPatterns('ring 912 34 567')).toBe('ring [TLF]');
    expect(redactPatterns('ring +47 91234567')).toBe('ring [TLF]');
  });
  it('fjerner bilskilt', () => {
    expect(redactPatterns('bil EL12345')).toBe('bil [REGNR]');
    expect(redactPatterns('bil DT 98765')).toBe('bil [REGNR]');
  });
  it('fjerner fødselsnummer og orgnr', () => {
    expect(redactPatterns('fnr 01018012345')).toBe('fnr [FNR]');
    expect(redactPatterns('orgnr 912345678')).toBe('orgnr [ORGNR]');
  });
  it('beholder beløp', () => {
    expect(redactPatterns('kostnad 4 300 kr')).toBe('kostnad 4 300 kr');
  });
});
