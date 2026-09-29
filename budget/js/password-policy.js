// Passwords never leave the device, so this policy runs client-side. That is
// acceptable here because a weak master password only weakens its own account —
// unlike authorization, which is always re-checked server-side.
const MIN_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  'password', 'motdepasse', '123456', '12345678', '123456789', 'azerty', 'azertyuiop',
  'qwerty', 'qwertyuiop', 'motdepasse1', 'password1', 'password123', 'iloveyou',
  'admin', 'welcome', 'monkey', 'dragon', 'soleil', 'bonjour', 'chocolat',
  'football', 'abc123', '111111', '000000', 'loulou', 'doudou', 'nicolas',
]);

export function checkStrength(password) {
  const issues = [];
  const value = String(password || '');

  if (value.length < MIN_LENGTH) issues.push(`au moins ${MIN_LENGTH} caractères`);
  if (!/[a-z]/.test(value)) issues.push('une minuscule');
  if (!/[A-Z]/.test(value)) issues.push('une majuscule');
  if (!/[0-9]/.test(value)) issues.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(value)) issues.push('un caractère spécial');

  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COMMON_PASSWORDS.has(normalized)) {
    return { ok: false, issues: ['un mot de passe moins courant — celui-ci figure parmi les plus utilisés'] };
  }
  if (/^(.)\1+$/.test(value)) {
    return { ok: false, issues: ['des caractères variés — celui-ci répète le même caractère'] };
  }

  return { ok: issues.length === 0, issues };
}

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// k-anonymity: only the first five hash characters are sent. Neither our server
// nor the breach database ever sees enough to identify the password.
export async function checkBreach(password) {
  try {
    const hash = await sha1Hex(password);
    const response = await fetch(`/api/auth/breach-check?prefix=${hash.slice(0, 5)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return { unknown: true };
    const data = await response.json();
    if (data.unavailable) return { unknown: true };
    const suffix = hash.slice(5);
    const match = (data.suffixes || []).find((entry) => entry.startsWith(suffix));
    if (!match) return { breached: false };
    const count = Number(match.split(':')[1] || 0);
    return { breached: true, count };
  } catch (e) {
    return { unknown: true };
  }
}

export async function validatePassword(password) {
  const strength = checkStrength(password);
  if (!strength.ok) {
    return { ok: false, message: `Le mot de passe doit contenir ${strength.issues.join(', ')}.` };
  }
  const breach = await checkBreach(password);
  if (breach.breached) {
    return {
      ok: false,
      message: `Ce mot de passe apparaît dans ${breach.count.toLocaleString('fr-FR')} fuites de données connues. Choisissez-en un autre.`,
    };
  }
  return { ok: true, breachCheckUnavailable: Boolean(breach.unknown) };
}
