import { extraireExpiration, joursRestants, rappelsExpiration } from './signature';

const PROFIL = `0\u0082garbage<?xml version="1.0"?><plist><dict>
<key>CreationDate</key>
<date>2026-09-26T08:00:00Z</date>
<key>ExpirationDate</key>
<date>2026-10-03T08:00:00Z</date>
</dict></plist>\u0000 `;

describe('signature AltStore', () => {
  it('lit la date d’expiration du profil embarqué', () => {
    expect(extraireExpiration(PROFIL)).toBe('2026-10-03T08:00:00.000Z');
    expect(extraireExpiration('rien')).toBeUndefined();
  });

  it('programme les rappels encore à venir seulement', () => {
    const rappels = rappelsExpiration('2026-10-03T08:00:00Z', new Date('2026-10-01T12:00:00Z'));
    expect(rappels.map(r => r.identifiant)).toEqual(['expiration-j1', 'expiration-h3']);
    expect(rappels[0].quand.toISOString()).toBe('2026-10-02T08:00:00.000Z');
    expect(rappels[0].corps).toMatch(/Wi-Fi/);
  });

  it('compte les jours restants', () => {
    expect(joursRestants('2026-10-03T08:00:00Z', new Date('2026-09-30T09:00:00Z'))).toBe(2);
    expect(joursRestants('2026-10-03T08:00:00Z', new Date('2026-10-04T09:00:00Z'))).toBe(-2);
  });
});
