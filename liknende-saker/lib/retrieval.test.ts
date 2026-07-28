import { describe, it, expect } from 'vitest';
import { cosine, prisspenn } from './retrieval';

describe('cosine', () => {
  it('1 for identiske vektorer', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
  });
  it('0 for ortogonale', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('prisspenn', () => {
  it('median, min og max fra kostnader', () => {
    expect(prisspenn([1800, 4300, 14500])).toEqual({ median: 4300, min: 1800, max: 14500, antall: 3 });
  });
  it('ignorerer null-kostnader', () => {
    expect(prisspenn([null, 5000, null])).toEqual({ median: 5000, min: 5000, max: 5000, antall: 1 });
  });
  it('antall 0 når ingen kostnad', () => {
    expect(prisspenn([null, null]).antall).toBe(0);
  });
});
