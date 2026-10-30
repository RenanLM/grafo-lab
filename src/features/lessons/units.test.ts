import { STUDY_UNITS } from './units';

describe('STUDY_UNITS', () => {
  it('reflete as três unidades e a carga horária da ementa (70 h)', () => {
    expect(STUDY_UNITS.map((u) => [u.number, u.hours])).toEqual([
      [1, 10],
      [2, 24],
      [3, 36],
    ]);
  });

  it('usa ids únicos', () => {
    const ids = STUDY_UNITS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
