import { describe, expect, it } from 'vitest';
import { hoursLine, profileLinks } from './storefront-content.js';

describe('profileLinks', () => {
  it('labels known sites, puts Facebook first, and drops duplicates and non-https links', () => {
    expect(
      profileLinks({
        facebookUrl: 'https://www.facebook.com/almara',
        sameAs: ['https://g.page/almara', 'https://www.facebook.com/almara', 'http://insecure.test', 'https://www.example.ph/'],
      }),
    ).toEqual([
      { label: 'Facebook', href: 'https://www.facebook.com/almara' },
      { label: 'Google', href: 'https://g.page/almara' },
      { label: 'example.ph', href: 'https://www.example.ph/' },
    ]);
  });
});

describe('hoursLine', () => {
  it('reads a run of days as a range, and anything else as a list', () => {
    expect(hoursLine({ openTime: '07:00', closeTime: '17:00', openDays: [6, 1, 2, 3, 4, 5] })).toBe('Mon–Sat, 07:00–17:00');
    expect(hoursLine({ openTime: '08:00', closeTime: '12:00', openDays: [1, 3] })).toBe('Mon, Wed, 08:00–12:00');
    expect(hoursLine({ openTime: '08:00', closeTime: '12:00', openDays: [] })).toBeNull();
    expect(hoursLine(null)).toBeNull();
  });
});
