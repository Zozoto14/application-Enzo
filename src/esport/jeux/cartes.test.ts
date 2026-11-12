/**
 * Maps détaillées et données pré-remplies des profils de jeu : callouts, repères, étages, calibrage,
 * image ; capacités des agents de Valorant et modèle The Finals (fusion sans rien écraser).
 */

import type { CarteJeu, DonneesJeu } from './api';
import { ajouterNiveau, ajouterRepere, ajouterZone, avecEchelle, avecImage, cleUnique, echelleDepuis, renommer, retirer } from './cartes';
import { capacitesTheFinals, capacitesValorant, fusionnerTheFinals, preremplirCapacites } from './modeles';
import { donneesVides, fusionnerCapacites } from './profil';

const ASCENT: CarteJeu = { cle: 'ascent', nom: 'Ascent', image: null, actif: true, modes: [] };

describe('maps détaillées', () => {
  it('callouts : trois sommets au moins, clés uniques, liste retirée quand elle se vide', () => {
    let c = ajouterZone(ASCENT, 'A Main', [0, 0, 100, 0, 100, 100]);
    c = ajouterZone(c, 'A Main', [0, 0, 10, 0, 10, 10], '#22c55e');
    expect(c.zones?.map(z => z.cle)).toEqual(['a-main', 'a-main-2']);
    expect(c.zones?.[1].couleur).toBe('#22c55e');
    expect(ajouterZone(c, 'Court', [0, 0, 1, 1])).toBe(c);
    expect(ajouterZone(c, '  ', [0, 0, 1, 1, 2, 2])).toBe(c);
    c = renommer(c, 'zones', 'a-main', 'A Lobby');
    expect(c.zones?.[0].nom).toBe('A Lobby');
    c = retirer(retirer(c, 'zones', 'a-main'), 'zones', 'a-main-2');
    expect(c.zones).toBeUndefined();
    expect(cleUnique('Site A', ['site-a', 'site-a-2'])).toBe('site-a-3');
  });

  it('repères, étages, calibrage, image', () => {
    let c = ajouterRepere(ASCENT, 'Site A', 'site', 120.44, 1200, 1);
    expect(c.reperes?.[0]).toEqual({ cle: 'site-a', nom: 'Site A', type: 'site', x: 120.4, y: 1010, niveau: 1 });
    c = ajouterNiveau(ajouterNiveau(c, 'RDC'), 'Toit');
    expect(c.niveaux?.map(n => n.nom)).toEqual(['RDC', 'Toit']);
    const e = echelleDepuis([100, 100, 100, 600], 50);
    expect(e).toEqual({ pxParMetre: 10, points: [100, 100, 100, 600], distance: 50 });
    expect(echelleDepuis([0, 0, 1, 0], 50)).toBeNull();
    c = avecEchelle(c, e);
    expect(c.echelle?.pxParMetre).toBe(10);
    expect(avecEchelle(c, null).echelle).toBeUndefined();
    c = avecImage(c, '0f8e2d3c-1111-4222-8333-944455556666');
    expect(c.fichier).toBe('0f8e2d3c-1111-4222-8333-944455556666');
    expect('fichier' in avecImage(c, null)).toBe(false);
  });
});

describe('données pré-remplies (à vérifier)', () => {
  it('Valorant : quatre capacités par agent, touches C Q E X, toutes à vérifier ; personnages déjà remplis gardés', () => {
    const omen = capacitesValorant('omen');
    expect(omen.map(c => c.touche)).toEqual(['C', 'Q', 'E', 'X']);
    expect(omen.every(c => c.aVerifier)).toBe(true);
    expect(omen.find(c => c.cle === 'dark-cover')).toMatchObject({ forme: 'cercle', rayon: 4.1, duree: 15, charges: 2, categorie: 'signature' });
    expect(capacitesValorant('harbor').find(c => c.nom === 'High Tide')?.courbable).toBe(true);
    expect(capacitesValorant('inconnu')).toEqual([]);
    const d: DonneesJeu = { ...donneesVides(), personnages: [{ cle: 'omen', nom: 'Omen', classe: null, image: null, actif: true }, { cle: 'sova', nom: 'Sova', classe: null, image: null, actif: true, capacites: [{ cle: 'perso', nom: 'Perso', touche: 'E', categorie: 'basique', forme: 'point', aVerifier: false }] }] };
    const r = preremplirCapacites(d, 'valorant');
    expect(r.n).toBe(1);
    expect(r.donnees.personnages[0].capacites).toHaveLength(4);
    expect(r.donnees.personnages[1].capacites?.[0].cle).toBe('perso');
    expect(preremplirCapacites(r.donnees, 'valorant').n).toBe(0);
  });

  it('The Finals : classes, gadgets (40 au plus par classe), maps sans image avec étages ; fusion sans écraser', () => {
    for (const c of ['light', 'medium', 'heavy']) {
      const liste = capacitesTheFinals(c);
      expect(liste.length).toBeGreaterThan(10);
      expect(liste.length).toBeLessThanOrEqual(40);
      expect(new Set(liste.map(x => x.cle)).size).toBe(liste.length);
    }
    expect(capacitesTheFinals('heavy').find(x => x.nom === 'Dome Shield')).toMatchObject({ categorie: 'gadget', forme: 'cercle' });
    const existant: DonneesJeu = { ...donneesVides(), cartes: [{ cle: 'monaco', nom: 'Monaco (perso)', image: null, actif: false, modes: [], fichier: '0f8e2d3c-1111-4222-8333-944455556666' }] };
    const { donnees, ajouts } = fusionnerTheFinals(existant, ['RDC', 'Toit']);
    expect(ajouts).toBeGreaterThan(10);
    const monaco = donnees.cartes.find(c => c.cle === 'monaco');
    expect(monaco).toMatchObject({ nom: 'Monaco (perso)', actif: false, fichier: '0f8e2d3c-1111-4222-8333-944455556666' });
    expect(monaco?.niveaux?.map(n => n.nom)).toEqual(['RDC', 'Toit']);
    expect(donnees.cartes.every(c => c.image === null)).toBe(true);
    expect(donnees.formats.find(f => f.cle === '3v3v3v3')).toMatchObject({ equipes: 4, joueursParEquipe: 3 });
    expect(donnees.personnages.map(p => p.cle)).toEqual(['light', 'medium', 'heavy']);
    expect(fusionnerTheFinals(donnees, ['RDC']).ajouts).toBe(0);
  });

  it('capacités Riot rapprochées des caractéristiques par la touche ; sans Riot, emplacement Riot gardé', () => {
    const donnees = capacitesValorant('omen');
    const riot = [{ cle: 'Ability2', nom: 'Voile sombre', icone: 'https://media.valorant-api.com/x.png', touche: 'E' }];
    const f = fusionnerCapacites(riot, donnees);
    expect(f[0]).toMatchObject({ cle: 'Ability2', nom: 'Voile sombre', donnees: { cle: 'dark-cover' } });
    expect(f).toHaveLength(4);
    expect(fusionnerCapacites([], donnees).map(c => c.cle)).toEqual(['Grenade', 'Ability1', 'Ability2', 'Ultimate']);
  });
});
