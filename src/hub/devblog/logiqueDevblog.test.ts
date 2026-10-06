import { decider, etapesVisite, fonctionnalitesPour, lireEtat, marquerLues } from './logiqueDevblog';
import { ENTREES, type EntreeDevblog } from './entrees';

const v2: EntreeDevblog = {
  version: '2099.12.31',
  date: '2099-12-31',
  titre: 'Suivante',
  resume: 'r',
  illustration: 'hub',
  fonctionnalites: [{ id: 'a', emoji: '*', titre: 'A', texte: 't' }],
};
const liste = [v2, ...ENTREES];

describe('devblog', () => {
  it('les entrées ont des versions uniques, datées, et au moins une nouveauté', () => {
    const versions = ENTREES.map(e => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    ENTREES.forEach(e => {
      expect(e.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      expect(e.fonctionnalites.length).toBeGreaterThan(0);
    });
    expect(ENTREES.find(e => e.version === '2026.09.29')?.fonctionnalites.map(f => f.id)).toEqual(
      expect.arrayContaining(['admin-avance', 'isolation', 'acces-admin', 'maj-parametres', 'themes', 'personnalisation']),
    );
  });

  it('affiche la dernière version une seule fois par profil', () => {
    const premiere = decider(undefined, { profilNeuf: false, admin: true }, liste);
    expect(premiere).toEqual({ genre: 'afficher', entree: v2 });
    const lu = marquerLues(undefined, [v2.version]);
    expect(decider(lu, { profilNeuf: false, admin: true }, liste)).toEqual({ genre: 'rien' });
    // Un autre profil a son propre état : il la voit à son tour.
    expect(decider(undefined, { profilNeuf: false, admin: false }, liste).genre).toBe('afficher');
  });

  it('jamais pour un profil neuf : tout est marqué lu, rien d’ancien ne ressort', () => {
    const d = decider(undefined, { profilNeuf: true, admin: true }, liste);
    expect(d.genre).toBe('marquer');
    const valeur = d.genre === 'marquer' ? d.valeur : '';
    expect(lireEtat(valeur)?.vues.sort()).toEqual(liste.map(e => e.version).sort());
    expect(decider(valeur, { profilNeuf: false, admin: true }, liste)).toEqual({ genre: 'rien' });
  });

  it('seule la dernière entrée s’affiche d’office, jamais une ancienne', () => {
    const d = decider(marquerLues(undefined, [v2.version]), { profilNeuf: false, admin: true }, liste);
    expect(d.genre).toBe('rien');
  });

  it('jamais d’écran vide : une entrée sans nouveauté visible pour ce profil ne s’affiche pas', () => {
    const adminSeul: EntreeDevblog = { ...v2, fonctionnalites: [{ ...v2.fonctionnalites[0], adminSeulement: true }] };
    expect(decider(undefined, { profilNeuf: false, admin: false }, [adminSeul])).toEqual({ genre: 'rien' });
    expect(decider(undefined, { profilNeuf: false, admin: true }, [adminSeul]).genre).toBe('afficher');
  });

  it('un ami ne voit pas les nouveautés réservées à l’administrateur', () => {
    const entree = ENTREES.find(e => e.version === '2026.09.29')!;
    expect(fonctionnalitesPour(entree, false).some(f => f.id === 'admin-avance')).toBe(false);
    expect(fonctionnalitesPour(entree, true).some(f => f.id === 'admin-avance')).toBe(true);
  });

  it('« tu es gestionnaire » n’est vue que d’un gestionnaire ; l’administrateur voit la nouveauté d’attribution', () => {
    const entree = ENTREES.find(e => e.version === '2026.09.30')!;
    const ids = (admin: boolean, gestionnaire: boolean) => fonctionnalitesPour(entree, admin, gestionnaire).map(f => f.id);
    expect(ids(false, true)).toEqual(['roles', 'tu-es-gestionnaire']);
    expect(ids(false, false)).toEqual(['roles']);
    expect(ids(true, false)).toEqual(expect.arrayContaining(['role-gestionnaire']));
    expect(ids(true, false)).not.toContain('tu-es-gestionnaire');
    // Un simple ami voit l'information générale, pas « tu es gestionnaire ».
    expect(decider(undefined, { profilNeuf: false, admin: false }, [entree]).genre).toBe('afficher');
    // La synchronisation est réservée à l'administrateur : rien pour un ami.
    const synchro = ENTREES.find(e => e.version === '2026.10.01')!;
    expect(decider(undefined, { profilNeuf: false, admin: false }, [synchro]).genre).toBe('rien');
    // « Paramètres réunis et thème unique » concerne tout le monde.
    expect(ENTREES.find(e => e.version === '2026.10.02')!.titre).toBe('Paramètres réunis et thème unique');
    // Le site comme le PC : « relier un navigateur » concerne aussi les amis.
    expect(ENTREES.find(e => e.version === '2026.10.03')!.titre).toBe('Le site, exactement comme le PC');
    expect(ENTREES.find(e => e.version === '2026.10.04')!.titre).toBe('Tsuzuku arrive dans le hub');
    // Les rangs : la transparence concerne aussi les amis.
    expect(ENTREES.find(e => e.version === '2026.10.05')!.titre).toBe('Rangs : Fondateur, Administrateur, Gestionnaire');
    // Les abonnements : un rappel amical concerne aussi les amis.
    expect(ENTREES.find(e => e.version === '2026.10.06')!.titre).toBe('Gestion des abonnements');
    // Tsuzuku : les sources partagées concernent aussi les amis.
    const tsuzuku = ENTREES.find(e => e.version === '2026.10.07')!;
    expect(tsuzuku.titre).toBe('Tsuzuku : sources partagées et assistant d’ajout');
    expect(tsuzuku.fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['tsuzuku-sources-partagees', 'tsuzuku-design']);
    // Verrouillage automatique, Support et mentions légales : pour tout le monde.
    expect(ENTREES[4].titre).toBe('Verrouillage automatique, Support et mentions légales');
    // Synchronisation dès le démarrage : l'indicateur concerne aussi les amis.
    expect(ENTREES[3].titre).toBe('Synchronisation dès le démarrage');
    expect(ENTREES[3].fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['synchro-demarrage-indicateur']);
    // Affichage téléphone : pour tout le monde.
    expect(ENTREES[2].titre).toBe('Affichage téléphone repensé (1/2)');
    expect(ENTREES[2].fonctionnalites.every(f => !f.adminSeulement && !f.gestionnaireSeulement)).toBe(true);
    // Déverrouillage (dernière entrée) : tout concerne aussi les amis, sauf le coffre publié par le PC.
    expect(ENTREES[1].titre).toBe('Déverrouillage : diagnostic et messages plus clairs');
    expect(ENTREES[1].fonctionnalites.filter(f => f.adminSeulement).map(f => f.id)).toEqual(['deverrouillage-coffre-pc']);
    expect(decider(undefined, { profilNeuf: false, admin: false }, ENTREES).genre).toBe('afficher');
    expect(ENTREES.map(e => e.version)).toEqual(['2026.10.11', '2026.10.10', '2026.10.09', '2026.10.08', '2026.10.07', '2026.10.06', '2026.10.05', '2026.10.04', '2026.10.03', '2026.10.02', '2026.10.01', '2026.09.30', '2026.09.29']);
  });

  it('marquer lu est idempotent et tolère un état corrompu', () => {
    expect(lireEtat('pas du json')).toEqual({ version: 1, vues: [] });
    const a = marquerLues('pas du json', ['x']);
    expect(marquerLues(a, ['x'])).toBe(a);
  });

  it('la visite guidée réutilise les nouveautés de l’entrée', () => {
    const etapes = etapesVisite(ENTREES[0], false);
    expect(etapes[0].titre).toBe(ENTREES[0].titre);
    expect(etapes.every(e => e.id.startsWith(`devblog-${ENTREES[0].version}`))).toBe(true);
    expect(etapes.some(e => e.id.endsWith('admin-avance'))).toBe(false);
  });
});
