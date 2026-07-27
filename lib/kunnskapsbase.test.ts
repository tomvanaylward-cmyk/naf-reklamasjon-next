import { describe, it, expect } from 'vitest';
import { prisspenn } from './kunnskapsbase';

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
