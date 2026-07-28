import { describe, it, expect } from 'vitest';
import { redactPatterns, redactKnownValues, anonymiserSak } from './anonymisering';

describe('redactPatterns', () => {
  it('fjerner e-post, tlf, regnr, fnr, orgnr', () => {
    expect(redactPatterns('kontakt ola@naf.no eller 912 34 567 om EL12345'))
      .toBe('kontakt [E-POST] eller [TLF] om [REGNR]');
    expect(redactPatterns('fnr 01018012345 orgnr 912345678')).toBe('fnr [FNR] orgnr [ORGNR]');
  });
  it('beholder beløp', () => {
    expect(redactPatterns('kompensert 4 300 kr')).toBe('kompensert 4 300 kr');
  });
});

describe('redactKnownValues', () => {
  it('fjerner kjente navn case-insensitivt', () => {
    const ut = redactKnownValues('Kari Nordmann ringte. kari nordmann var misfornøyd.', ['Kari Nordmann']);
    expect(ut).toBe('[NAVN] ringte. [NAVN] var misfornøyd.');
  });
  it('tåler null/tomme verdier og korte strenger', () => {
    expect(redactKnownValues('tekst uten treff', ['', '  ', 'ab'])).toBe('tekst uten treff');
  });
  it('escaper regex-spesialtegn i verdier', () => {
    expect(redactKnownValues('se sak (VIP) her', ['(VIP)'])).toBe('se sak [NAVN] her');
  });
});

describe('anonymiserSak', () => {
  it('kombinerer kjente verdier og mønstre', () => {
    const ut = anonymiserSak('Ola Hansen (ola@naf.no) klager på EL12345', ['Ola Hansen']);
    expect(ut).toBe('[NAVN] ([E-POST]) klager på [REGNR]');
  });
});
