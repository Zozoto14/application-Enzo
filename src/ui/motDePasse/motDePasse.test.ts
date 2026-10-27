import { evaluerMotDePasse } from '../../profils/invitation';
import { analyserMotDePasse, capsActif, lignesAide } from './regles';
import { CLES_ECRANS, CLES_TEXTES, TEXTES_ECRANS_PAR_LANGUE, TEXTES_PAR_LANGUE, texte } from './textes';

const ami = (valeur: string, plus: Partial<Parameters<typeof analyserMotDePasse>[0]> = {}) =>
  analyserMotDePasse({ profil: 'ami', valeur, confirmation: '', identifiant: 'Léa', langue: 'fr', ...plus });
const etat = (a: ReturnType<typeof ami>) => Object.fromEntries(a.regles.map(r => [r.id, r.ok]));

describe('checklist des règles (profil ami)', () => {
  it('au départ, rien n’est coché et aucun reproche n’est fait', () => {
    const a = ami('');
    expect(a.regles.every(r => !r.ok)).toBe(true);
    expect(a.problemes).toEqual([]);
    expect(a.problemeConfirmation).toBeUndefined();
    expect(a.libelleForceComplet).toMatch(/^Force :/);
  });

  it('se coche règle par règle', () => {
    expect(etat(ami('lea12345'))).toMatchObject({ longueur: false, chiffres: true, identifiant: false });
    expect(etat(ami('chat12'))).toMatchObject({ longueur: false, chiffres: true, identifiant: true });
    expect(etat(ami('1234567890123'))).toMatchObject({ longueur: true, chiffres: false });
    expect(etat(ami('chat mange 3 croquettes'))).toEqual({ longueur: true, chiffres: true, identifiant: true, courant: true, identiques: false });
    expect(etat(ami('chat mange 3 croquettes', { confirmation: '  chat mange 3 croquettes\n' })).identiques).toBe(true);
    expect(etat(ami('azerty1234567')).courant).toBe(false);
    expect(etat(ami('aaaaaaaaaaaaaaa')).courant).toBe(false);
    expect(etat(ami('Léa-2026-abc')).identifiant).toBe(false);
  });

  it('la règle de force n’apparaît que si le Fondateur l’exige', () => {
    expect(ami('x').regles.map(r => r.id)).not.toContain('force');
    const a = ami('chat mange 3 croquettes', { politique: { longueurMin: 10, forceMin: 4 } });
    expect(a.regles.map(r => r.id)).toContain('force');
    const court = ami('abcdefghijkl', { politique: { longueurMin: 10, forceMin: 4 } });
    expect(etat(court).force).toBe(false);
    expect(court.problemes.join(' ')).toMatch(/Excellent/);
  });

  it('la longueur durcie par le Fondateur est celle qui s’affiche', () => {
    const a = ami('chat mange', { politique: { longueurMin: 20, forceMin: 1 } });
    expect(a.regles[0].libelle).toBe('Au moins 20 caractères');
    expect(a.manque).toBe(10);
  });

  it('dit la même chose que le code qui valide (evaluerMotDePasse)', () => {
    const essais = ['', 'court', 'lea12345', '1234567890', '12345678901234', 'azerty123456', 'motdepasse2026', 'Léa Léa Léa Léa', 'aabbaabbaabbaab', 'mon chat mange 3 croquettes', '  mon chat mange 3 croquettes  ', 'Éléphant violet 42 !', 'x'.repeat(40)];
    for (const politique of [undefined, { longueurMin: 14, forceMin: 3 as const }, { longueurMin: 10, forceMin: 4 as const }]) {
      for (const e of essais) {
        const attendu = evaluerMotDePasse(e, 'Léa', politique);
        const a = ami(e, { politique, confirmation: e });
        expect({ e, valide: a.valide && e.length > 0 }).toEqual({ e, valide: attendu.valide && e.length > 0 });
        expect({ e, force: a.force === 0 ? 0 : a.force }).toEqual({ e, force: attendu.valide || attendu.force > 0 ? attendu.force : 0 });
      }
    }
  });
});

describe('profil coffre', () => {
  const coffre = (valeur: string, confirmation = '') => analyserMotDePasse({ profil: 'coffre', valeur, confirmation, langue: 'fr' });
  it('12 caractères, comptés tels que saisis, et rien d’autre', () => {
    expect(coffre('12345678901').regles[0]).toMatchObject({ libelle: 'Au moins 12 caractères', ok: false });
    expect(coffre('123456789012').regles[0].ok).toBe(true);
    expect(coffre('123456789012').regles.map(r => r.id)).toEqual(['longueur', 'identiques']);
    // Les espaces au bord comptent dans le coffre (ils ne sont pas retirés).
    expect(coffre('   a        ').longueur).toBe(12);
    expect(coffre('   a        ').regles[0].ok).toBe(true);
  });
  it('la confirmation se compare telle quelle', () => {
    expect(coffre('motdepassesuffisant', 'motdepassesuffisant').valide).toBe(true);
    expect(coffre('motdepassesuffisant', 'motdepassesuffisant ').valide).toBe(false);
  });
  it('sans seconde saisie, pas de règle « identiques »', () => {
    const a = analyserMotDePasse({ profil: 'coffre', valeur: 'x', avecConfirmation: false, langue: 'fr' });
    expect(a.regles.map(r => r.id)).toEqual(['longueur']);
  });
});

describe('messages d’erreur précis', () => {
  it('« il manque N caractères », au singulier comme au pluriel', () => {
    expect(ami('abcdefg').problemes).toContain('Il manque 3 caractères.');
    expect(ami('abcdefghi').problemes).toContain('Il manque 1 caractère.');
    expect(analyserMotDePasse({ profil: 'coffre', valeur: 'abc', langue: 'en' }).problemes).toEqual(['9 characters missing.']);
    expect(analyserMotDePasse({ profil: 'coffre', valeur: '12345678901', langue: 'en' }).problemes).toEqual(['1 character missing.']);
  });
  it('« les deux mots de passe ne correspondent pas »', () => {
    expect(ami('chat mange 3 croquettes', { confirmation: 'chat mange 4 croquettes' }).problemeConfirmation).toBe('Les deux mots de passe ne correspondent pas.');
    expect(ami('chat mange 3 croquettes', { confirmation: 'chat mange 4 croquettes', langue: 'en' }).problemeConfirmation).toBe('The two passwords do not match.');
    expect(ami('chat mange 3 croquettes', { confirmation: 'chat mange 3 croquettes' }).problemeConfirmation).toBeUndefined();
  });
  it('que des chiffres, identifiant repris, trop courant', () => {
    expect(ami('12345678901234').problemes.join(' ')).toMatch(/Que des chiffres/);
    expect(ami('Léa-2026-abc').problemes.join(' ')).toMatch(/identifiant/);
    expect(ami('azerty123456').problemes.join(' ')).toMatch(/Trop courant/);
  });
  it('détection de Caps Lock', () => {
    expect(capsActif({ getModifierState: (t: string) => t === 'CapsLock' })).toBe(true);
    expect(capsActif({ nativeEvent: { getModifierState: () => false } })).toBe(false);
    expect(capsActif({})).toBeUndefined();
    expect(capsActif(undefined)).toBeUndefined();
  });
  it('la force vient avec une phrase d’explication', () => {
    const a = ami('Mon chat mange 3 croquettes !');
    expect(a.libelleForceComplet).toBe('Force : Excellent');
    expect(a.explicationForce).toMatch(/impossible à deviner/);
    const b = ami('chat mange croquettes');
    expect(b.explicationForce.length).toBeGreaterThan(20);
    expect(ami('', {}).explicationForce).toBe('');
    expect(ami('Mon chat mange 3 croquettes !', { langue: 'en' }).libelleForceComplet).toBe('Strength: Excellent');
  });
});

describe('texte de l’aide', () => {
  it('décrit exactement ce que le code accepte (ami)', () => {
    const { accepte, conseil, rappel } = lignesAide('ami', 'fr');
    const tout = accepte.join('\n');
    expect(tout).toContain('Au moins 10 caractères.');
    expect(tout).toMatch(/majuscules comptent/);
    expect(tout).toMatch(/espaces au début et à la fin sont ignorés/);
    expect(tout).toMatch(/accents/);
    expect(conseil).toContain('mon chat mange 3 croquettes');
    expect(rappel).toMatch(/gestionnaire de mots de passe/);
  });
  it('coffre : 12 caractères, espaces du bord non ignorés', () => {
    const tout = lignesAide('coffre', 'fr').accepte.join('\n');
    expect(tout).toContain('Au moins 12 caractères.');
    expect(tout).not.toMatch(/sont ignorés/);
  });
  it('la politique du Fondateur est reprise', () => {
    expect(lignesAide('ami', 'fr', { politique: { longueurMin: 16, forceMin: 3 } }).accepte.join('\n')).toMatch(/Au moins 16 caractères\.[\s\S]*Solide/);
  });
});

describe('français / anglais', () => {
  it('chaque texte existe dans les deux langues, avec les mêmes variables', () => {
    const variables = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const cle of CLES_TEXTES) {
      expect(TEXTES_PAR_LANGUE.en[cle]).toBeTruthy();
      expect(variables(TEXTES_PAR_LANGUE.en[cle])).toBe(variables(TEXTES_PAR_LANGUE.fr[cle]));
    }
    for (const cle of CLES_ECRANS) {
      expect(TEXTES_ECRANS_PAR_LANGUE.en[cle]).toBeTruthy();
      expect(variables(TEXTES_ECRANS_PAR_LANGUE.en[cle])).toBe(variables(TEXTES_ECRANS_PAR_LANGUE.fr[cle]));
    }
  });
  it('l’anglais n’est pas du français recopié', () => {
    const identiques = CLES_TEXTES.filter(c => TEXTES_PAR_LANGUE.en[c] === TEXTES_PAR_LANGUE.fr[c]);
    expect(identiques).toEqual(['force.niveau.4']); // « Excellent » s'écrit pareil
  });
  it('les règles et l’aide changent de langue', () => {
    expect(ami('x', { langue: 'en' }).regles[0].libelle).toBe('At least 10 characters');
    expect(lignesAide('ami', 'en').conseil).toContain('my cat eats 3 treats');
    expect(texte('en', 'bouton.afficher')).toBe('Show');
    expect(texte('fr', 'bouton.afficher')).toBe('Afficher');
  });
});
