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

  // Regresjon: ordrenummer er ikke beløp (ga tidligere 619 045 kr).
  it('leser IKKE ordre-/kundenummer som beløp', () => {
    expect(belopFraTekst('Kundenr: 12345 Ordrenr: 6190450 bilen stoppet')).toBeNull();
    expect(belopFraTekst('ordrenr:6063352 Kunde var innom')).toBeNull();
  });

  it('krever valuta-markør', () => {
    expect(belopFraTekst('bilen har gått 150000 km')).toBeNull();
  });

  it('velger største reelle beløp', () => {
    expect(belopFraTekst('tilbud 2 000 kr, endte på 7 500 kr')).toBe(7500);
  });
});
