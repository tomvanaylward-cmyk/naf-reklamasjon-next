import { describe, it, expect } from 'vitest';
import { prisspenn, belopFraTekst } from './kunnskapsbase';

describe('belopFraTekst', () => {
  it('leser beløp med kr-suffiks og tusenskille', () => {
    expect(belopFraTekst('kompensert 4 300 kr')).toBe(4300);
    expect(belopFraTekst('beløp 14.500,- totalt')).toBe(14500);
    expect(belopFraTekst('kr 5000 for jobben')).toBe(5000);
    expect(belopFraTekst('delt 3000kr 50-50')).toBe(3000);
  });

  // Regresjon: ordre-/kunde-/fakturanummer er IKKE beløp. Tidligere leste
  // regexen «Ordrenr: 6190450» som 619 045 kr og blåste opp totalen 13×.
  it('leser IKKE ordrenummer som beløp', () => {
    expect(belopFraTekst('Kundenr: 12345 Ordrenr: 6190450 bilen stoppet')).toBeNull();
    expect(belopFraTekst('ordrenr:6063352 Kunde var innom')).toBeNull();
    expect(belopFraTekst('Ordre / tilbud: 6082986 se mail')).toBeNull();
  });

  it('returnerer null uten valuta-markør', () => {
    expect(belopFraTekst('ingen kostnad oppgitt')).toBeNull();
    expect(belopFraTekst('bilen har gått 150000 km')).toBeNull();
  });

  it('avviser urimelig store beløp', () => {
    expect(belopFraTekst('faktura på 900000 kr')).toBeNull();
  });

  it('velger største reelle beløp når flere er nevnt', () => {
    expect(belopFraTekst('tilbud 2 000 kr, endte på 7 500 kr')).toBe(7500);
  });
});

describe('prisspenn', () => {
  it('median/min/max/antall', () => {
    expect(prisspenn([1800, 4300, 14500])).toEqual({ median: 4300, min: 1800, max: 14500, antall: 3 });
  });
  it('ignorerer null', () => {
    expect(prisspenn([null, 5000])).toEqual({ median: 5000, min: 5000, max: 5000, antall: 1 });
  });
  it('antall 0 uten kostnader', () => {
    expect(prisspenn([null]).antall).toBe(0);
  });
});
