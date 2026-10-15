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


/** Entrées jusqu'à Tâches V2 (2026.10.25) : les vérifications par position ci-dessous portent sur elles. */
const ANCIENNES = ENTREES.slice(ENTREES.findIndex(e => e.version === '2026.10.25'));

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
    expect(ENTREES.find(e => e.version === '2026.10.08')!.titre).toBe('Verrouillage automatique, Support et mentions légales');
    // Synchronisation dès le démarrage : l'indicateur concerne aussi les amis.
    expect(ENTREES.find(e => e.version === '2026.10.09')!.titre).toBe('Synchronisation dès le démarrage');
    expect(ENTREES.find(e => e.version === '2026.10.09')!.fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['synchro-demarrage-indicateur']);
    // Affichage téléphone : pour tout le monde.
    expect(ENTREES.find(e => e.version === '2026.10.10')!.titre).toBe('Affichage téléphone repensé (1/2)');
    expect(ENTREES.find(e => e.version === '2026.10.10')!.fonctionnalites.every(f => !f.adminSeulement && !f.gestionnaireSeulement)).toBe(true);
    // Tsuzuku, page Sources : les états vides concernent tout le monde, le reste les Fondateurs.
    expect(ENTREES.find(e => e.version === '2026.10.12')!.titre).toBe('Tsuzuku : page Sources et assistant guidé');
    expect(ENTREES.find(e => e.version === '2026.10.12')!.fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['tsuzuku-sans-source']);
    // Déverrouillage : tout concerne aussi les amis, sauf le coffre publié par le PC.
    expect(ENTREES.find(e => e.version === '2026.10.11')!.titre).toBe('Déverrouillage : diagnostic et messages plus clairs');
    expect(ENTREES.find(e => e.version === '2026.10.11')!.fonctionnalites.filter(f => f.adminSeulement).map(f => f.id)).toEqual(['deverrouillage-coffre-pc']);
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES.slice(13)).genre).toBe('afficher');
    // Pages du hub et app Abonnements : réservées à l'administration ; un ami n'a rien de vide.
    expect(ANCIENNES[12].titre).toBe('Deux pages dans le hub, et une app Abonnements');
    expect(ANCIENNES[12].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(ANCIENNES[12].fonctionnalites.find(f => f.id === 'app-abonnements')?.essayer).toEqual({ genre: 'app', app: 'abonnements' });
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES.slice(12)).genre).toBe('rien');
    // Prospects : réservée au Fondateur ; un ami n'en voit rien.
    expect(ANCIENNES[11].titre).toBe('Nouvelle app : Prospects');
    expect(ANCIENNES[11].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES.slice(11)).genre).not.toBe('afficher');
    // Claude Office : réservée au Fondateur, un ami n'en voit rien.
    expect(ANCIENNES[10].titre).toBe('Claude Office arrive dans le hub');
    expect(ANCIENNES[10].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[10]]).genre).toBe('rien');
    // Tsuzuku : la fiche trouve les épisodes (tous), sources synchronisées (administration).
    expect(ANCIENNES[9].version).toBe('2026.10.16');
    expect(ANCIENNES[9].fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['tsuzuku-fiche-sources']);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[9]]).genre).toBe('afficher');
    // Historique de Claude Office : réservé au Fondateur, un ami n'en voit rien.
    expect(ANCIENNES[8].version).toBe('2026.10.17');
    expect(ANCIENNES[8].titre).toBe('Claude Office garde l’historique de vos requêtes');
    expect(ANCIENNES[8].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[8]]).genre).toBe('rien');
    // Bureau natif de Claude Office : réservé au Fondateur, un ami n'en voit rien.
    expect(ANCIENNES[7].version).toBe('2026.10.18');
    expect(ANCIENNES[7].titre).toBe('Claude Office : le bureau des agents, partout');
    expect(ANCIENNES[7].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[7]]).genre).toBe('rien');
    // 2026.10.19 : Tsuzuku, sources des vrais sites ; le diagnostic détaillé et le test sur la fiche sont réservés à l'administration.
    expect(ANCIENNES[6].version).toBe('2026.10.19');
    expect(ANCIENNES[6].fonctionnalites.filter(f => !f.adminSeulement).map(f => f.id)).toEqual(['tsuzuku-sources-reel-lecture']);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[6]]).genre).toBe('afficher');
    // 2026.10.20 : open space de Claude Office : réservé au Fondateur, un ami n'en voit rien.
    expect(ANCIENNES[5].version).toBe('2026.10.20');
    expect(ANCIENNES[5].titre).toBe('Claude Office devient un vrai open space');
    expect(ANCIENNES[5].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[5]]).genre).toBe('rien');
    // 2026.10.21 : Tsuzuku, bouton VF | VOSTFR : visible des amis (Tsuzuku les concerne).
    expect(ANCIENNES[4].version).toBe('2026.10.21');
    expect(ANCIENNES[4].titre).toBe('Tsuzuku : VF ou VOSTFR, au choix');
    expect(ANCIENNES[4].fonctionnalites.some(f => f.adminSeulement)).toBe(false);
    expect(ANCIENNES[4].fonctionnalites[0].essayer).toEqual({ genre: 'app', app: 'tsuzuku' });
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES.slice(4)).genre).toBe('afficher');
    // 2026.10.22 : Claude Office v3 (zones, salle d'attente, attend ta réponse), Fondateur seulement.
    expect(ANCIENNES[3].version).toBe('2026.10.22');
    expect(ANCIENNES[3].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[3]]).genre).toBe('rien');
    // 2026.10.23 : Claude Office v4 (scène plein cadre, sous-agents, suivi, équipe), Fondateur seulement.
    expect(ANCIENNES[2].version).toBe('2026.10.23');
    expect(ANCIENNES[2].titre).toBe('Claude Office v4 : la scène en grand, les sous-agents et le suivi');
    expect(ANCIENNES[2].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(ANCIENNES[2].fonctionnalites.every(f => f.essayer?.genre === 'app' && f.essayer.app === 'claude-office')).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false }, [ANCIENNES[2]]).genre).toBe('rien');
    expect(decider(undefined, { profilNeuf: false, admin: true }, [ANCIENNES[2]]).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: true }, ENTREES).genre).toBe('afficher');
    // Seule la dernière entrée s'affiche d'elle-même : réservée au Fondateur, un ami n'a rien de vide
    // (la nouveauté Tsuzuku du 2026.10.21 reste lisible dans Paramètres › Nouveautés).
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES).genre).toBe('rien');
    expect(decider(undefined, { profilNeuf: false, admin: false }, ANCIENNES.slice(5)).genre).toBe('rien');
    // 2026.10.25 (dernière entrée) : Tâches V2 — Fondateur et l'ami à qui elle est ouverte (temps, notifications), personne d'autre.
    expect(ANCIENNES[0].version).toBe('2026.10.25');
    expect(decider(undefined, { profilNeuf: false, admin: true }, ANCIENNES).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['taches'] }, ANCIENNES).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['tsuzuku'] }, ANCIENNES).genre).toBe('rien');
    // 2026.10.26 : Tsuzuku plus rapide — Fondateur et amis qui ont Tsuzuku, personne d'autre.
    const rapide = ENTREES.find(e => e.version === '2026.10.26')!;
    expect(rapide.fonctionnalites.every(f => f.app === 'tsuzuku' && !f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['taches'] }, [rapide]).genre).toBe('rien');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['tsuzuku'] }, [rapide]).genre).toBe('afficher');
    // 2026.10.27 (dernière entrée) : connexion des amis — pour TOUS (l'ami voit l'invitation, le Fondateur aussi ses outils).
    const connexion = ENTREES.find(e => e.version === '2026.10.27')!;
    expect(ENTREES[3]).toBe(connexion);
    expect(connexion.titre).toBe('Connexion des amis : une invitation, ton mot de passe');
    expect(fonctionnalitesPour(connexion, false).map(f => f.id)).toEqual(['connexion-invitation', 'connexion-identifiant', 'connexion-messages']);
    expect(fonctionnalitesPour(connexion, true).map(f => f.id)).toContain('connexion-fondateur');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['taches'] }, ENTREES.slice(2)).genre).toBe('afficher');
    // 2026.10.28 : Tâches V3 — Fondateur et les membres à qui elle est ouverte, personne d'autre.
    const v3 = ENTREES.find(e => e.version === '2026.10.28')!;
    expect(ENTREES[2]).toBe(v3);
    expect(decider(undefined, { profilNeuf: false, admin: true }, [v3]).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['taches'] }, [v3]).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['tsuzuku'] }, [v3]).genre).toBe('rien');
    // 2026.10.29 : plusieurs apps ouvertes en même temps — pour tout le monde.
    expect(ENTREES[1].version).toBe('2026.10.29');
    expect(ENTREES[1].fonctionnalites.every(f => !f.adminSeulement && !f.gestionnaireSeulement && !f.app)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: false, apps: ['tsuzuku'] }, ENTREES.slice(1)).genre).toBe('afficher');
    // 2026.10.30 (dernière entrée) : Administration (invitations par e-mail, réglages) — Fondateur seulement.
    expect(ENTREES[0].version).toBe('2026.10.30');
    expect(ENTREES[0].fonctionnalites.every(f => f.adminSeulement)).toBe(true);
    expect(decider(undefined, { profilNeuf: false, admin: true }, ENTREES).genre).toBe('afficher');
    expect(decider(undefined, { profilNeuf: false, admin: false, gestionnaire: true, apps: ['taches'] }, ENTREES).genre).toBe('rien');
    expect(ENTREES.map(e => e.version)).toEqual(['2026.10.30', '2026.10.29', '2026.10.28', '2026.10.27', '2026.10.26', '2026.10.25', '2026.10.24', '2026.10.23', '2026.10.22', '2026.10.21', '2026.10.20', '2026.10.19', '2026.10.18', '2026.10.17', '2026.10.16', '2026.10.15', '2026.10.14', '2026.10.13', '2026.10.12', '2026.10.11', '2026.10.10', '2026.10.09', '2026.10.08', '2026.10.07', '2026.10.06', '2026.10.05', '2026.10.04', '2026.10.03', '2026.10.02', '2026.10.01', '2026.09.30', '2026.09.29']);
  });

  it('marquer lu est idempotent et tolère un état corrompu', () => {
    expect(lireEtat('pas du json')).toEqual({ version: 1, vues: [] });
    const a = marquerLues('pas du json', ['x']);
    expect(marquerLues(a, ['x'])).toBe(a);
  });

  it('la visite guidée réutilise les nouveautés de l’entrée', () => {
    const etapes = etapesVisite(ENTREES.find(e => e.version === '2026.10.11')!, false);
    expect(etapes[0].titre).toBe(ENTREES.find(e => e.version === '2026.10.11')!.titre);
    expect(etapes.every(e => e.id.startsWith(`devblog-${ENTREES.find(e => e.version === '2026.10.11')!.version}`))).toBe(true);
    expect(etapes.some(e => e.id.endsWith('admin-avance'))).toBe(false);
  });
});
