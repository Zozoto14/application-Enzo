import { encoderLiaison } from '../src/sync/relais/liaison';
import { ab1TemporaireOuvert, codeAb1DuLien, connexionParIdentifiantActive, liaisonsAEssayer, relaisAutorise } from './liaisonTemporaire';

const JETON = 'jeton-maitre-0123456789abcdef';
const ANCIEN = 'https://ancien-relais.exemple';
const SITE = 'https://relais.appdashboard.fr';

describe('retour temporaire du code AB1', () => {
  it('se ferme après la date, ou dès que ce navigateur a constaté la connexion par identifiant', () => {
    expect(ab1TemporaireOuvert(new Date('2026-11-30T20:00:00Z'))).toBe(true);
    expect(ab1TemporaireOuvert(new Date('2026-12-01T00:00:01Z'))).toBe(false);
    expect(ab1TemporaireOuvert(new Date('2026-10-22T00:00:00Z'), true)).toBe(false);
  });

  it('relais acceptés : celui du site et le relais officiel, rien d’autre', () => {
    expect(relaisAutorise(SITE)).toBe(true);
    expect(relaisAutorise(ANCIEN)).toBe(false);
    expect(relaisAutorise('https://localhost:8941', 'https://localhost:8941')).toBe(true);
    expect(relaisAutorise('https://relais.pirate.example', SITE)).toBe(false);
    expect(relaisAutorise('https://relais.appdashboard.fr.pirate.example')).toBe(false);
  });

  it('code maître : le relais du site (même jeton), ou celui du code s’il est connu', () => {
    const local = 'https://localhost:8941';
    expect(liaisonsAEssayer(encoderLiaison({ relais: local, jeton: JETON }), local)).toEqual([{ relais: local, jeton: JETON }]);
    // Code émis pour une ancienne adresse du relais : seul le relais du site est essayé.
    expect(liaisonsAEssayer(encoderLiaison({ relais: ANCIEN, jeton: JETON }), SITE)).toEqual([{ relais: SITE, jeton: JETON }]);
    expect(liaisonsAEssayer(encoderLiaison({ relais: SITE, jeton: JETON }), SITE)).toEqual([{ relais: SITE, jeton: JETON }]);
  });

  it('refuse un code illisible, un code d’ami, un serveur inconnu', () => {
    expect(() => liaisonsAEssayer('AB1.nimporte', SITE)).toThrow(/illisible/);
    expect(() => liaisonsAEssayer(encoderLiaison({ relais: SITE, jeton: `p1.lea0000001.${'a'.repeat(64)}` }), SITE)).toThrow(/administrateur/);
    expect(() => liaisonsAEssayer(encoderLiaison({ relais: 'https://relais.pirate.example', jeton: JETON }))).toThrow(/inconnu/);
  });

  it('lit le code d’un lien #liaison= et reconnaît un coffre déjà passé à l’identifiant', () => {
    const code = encoderLiaison({ relais: SITE, jeton: JETON });
    expect(codeAb1DuLien(`#liaison=${code}`)).toBe(code);
    expect(codeAb1DuLien('#liaison=AB1.abime')).toBeUndefined();
    expect(connexionParIdentifiantActive({ canonique: true })).toBe(true);
    expect(connexionParIdentifiantActive({ version: 1 })).toBe(false);
  });
});
