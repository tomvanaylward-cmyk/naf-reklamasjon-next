import { describe, it, expect } from 'vitest';
import { belopFraTekst } from './belop';

describe('belopFraTekst', () => {
  it('leser tusenskille med mellomrom', () => {
    expect(belopFraTekst('kostnad ble 4 300 kr')).toBe(4300);
  });
  it('leser punktum-tusenskille og komma', () => {
    expect(belopFraTekst('beløp 14.500,- totalt')).toBe(14500);
  });
  it('leser kr-prefiks', () => {
    expect(belopFraTekst('kr 5000 for jobben')).toBe(5000);
  });
  it('returnerer null når ingen beløp', () => {
    expect(belopFraTekst('ingen kostnad oppgitt')).toBeNull();
  });
});
