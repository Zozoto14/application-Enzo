import {
  REGLAGES,
  SECTIONS,
  correspond,
  normaliser,
  rechercher,
  reglage,
  reglagesDeSection,
  reglagesDisponibles,
  sectionDe,
  sectionsVisibles,
  type IdReglage,
} from './recensement';

const TOUS = REGLAGES.map(r => r.id);

describe('recensement des réglages', () => {
  it('range chaque réglage dans une section existante, une seule fois', () => {
    const ids = REGLAGES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REGLAGES) {
      expect(SECTIONS.map(s => s.id)).toContain(r.section);
      expect(r.titre.length).toBeGreaterThan(2);
      expect(r.description.length).toBeGreaterThan(10);
    }
  });

  it('a les dix sections demandées, dans l’ordre, et aucune n’est vide', () => {
    expect(SECTIONS.map(s => s.titre)).toEqual([
      'Général',
      'Synchronisation',
      'Sécurité',
      'Portefeuille',
      'Administration',
      'Tsuzuku',
      'Tâches',
      'Nouveautés',
      'Support',
      'À propos',
    ]);
    for (const s of SECTIONS) {
      expect(reglagesDeSection(s.id, TOUS).length).toBeGreaterThan(0);
    }
  });

  it('retrouve où chaque ancien réglage a été déplacé', () => {
    const attendu: Record<string, IdReglage> = {
      'Hub › Paramètres › Apparence': 'theme',
      'Portefeuille › Paramètres › Apparence': 'theme',
      'Administration › Réglages › Apparence du hub': 'theme',
      'Hub › Paramètres › Synchronisation': 'synchro-etat',
      'Portefeuille › Paramètres › Synchronisation entre appareils': 'synchro-appareils',
      'Portefeuille › Paramètres › Codes de récupération': 'codes-recuperation',
      'Portefeuille › Sauvegarde › Sauvegarde automatique': 'sauvegarde-auto',
      'Portefeuille › Paramètres › Cours automatiques': 'cours-intervalle',
      'Portefeuille › Paramètres › Fournisseur': 'cours-fournisseur',
      'Portefeuille › Paramètres › Symboles de cotation': 'symboles',
      'Portefeuille › Paramètres › Historique des cours': 'historique-cours',
      'Portefeuille › Paramètres › Exporter': 'export-excel',
      'Portefeuille › barre latérale (Masquer les €)': 'discretion',
      'Portefeuille › Alertes (écran Notifications)': 'notifications',
      'Portefeuille › Podcast › Préparer automatiquement': 'podcast',
      'Portefeuille › Paramètres › Profils': 'admin-comptes',
      'Administration › Réglages': 'admin-reglages',
      'Hub › Paramètres › Nouveautés': 'nouveautes',
      'Hub › Paramètres › Session': 'compte',
      'Hub › Mettre à jour': 'mise-a-jour',
      'Portefeuille › Paramètres › Revoir la visite': 'visite',
    };
    for (const [ancien, id] of Object.entries(attendu)) {
      expect(reglage(id).ancienEmplacement).toContain(ancien);
    }
  });

  it('range les réglages du portefeuille dans la section Portefeuille et la sécurité dans Sécurité', () => {
    for (const id of ['cours-intervalle', 'cours-fournisseur', 'symboles', 'historique-cours', 'export-excel', 'discretion', 'notifications', 'podcast', 'visite'] as const) {
      expect(sectionDe(id)).toBe('portefeuille');
    }
    for (const id of ['securite-coffre', 'codes-recuperation', 'sauvegarde-auto', 'sauvegardes'] as const) {
      expect(sectionDe(id)).toBe('securite');
    }
    expect(sectionDe('theme')).toBe('general');
    expect(sectionDe('mise-a-jour')).toBe('apropos');
  });
});

describe('visibilité selon la plateforme et le rôle', () => {
  it('ne propose que les réglages déclarés disponibles, dans l’ordre des sections', () => {
    const amis: IdReglage[] = ['version', 'theme', 'cours-intervalle', 'compte'];
    expect(reglagesDisponibles(amis).map(r => r.id)).toEqual(['theme', 'compte', 'cours-intervalle', 'version']);
  });

  it('cache une section quand aucun de ses réglages n’est disponible', () => {
    const sansAdmin = TOUS.filter(id => sectionDe(id) !== 'administration');
    expect(sectionsVisibles(sansAdmin).map(s => s.id)).not.toContain('administration');
    expect(sectionsVisibles(sansAdmin)).toHaveLength(SECTIONS.length - 1);
    expect(sectionsVisibles([])).toEqual([]);
  });
});

describe('recherche dans les paramètres', () => {
  it('ignore la casse, les accents et l’ordre des mots', () => {
    expect(normaliser('  Récupération   d’URGENCE ')).toBe('recuperation d urgence');
    expect(rechercher('RECUPERATION', TOUS).flatMap(g => g.reglages.map(r => r.id))).toContain('codes-recuperation');
    expect(rechercher('sauvegarde automatique', TOUS).flatMap(g => g.reglages.map(r => r.id))[0]).toBe('sauvegarde-auto');
    expect(rechercher('automatique sauvegarde', TOUS).flatMap(g => g.reglages.map(r => r.id))).toContain('sauvegarde-auto');
  });

  it('trouve par mot-clé, par nom de section et regroupe par section', () => {
    const themes = rechercher('sauge', TOUS);
    expect(themes.map(g => g.section.id)).toEqual(['general']);
    expect(themes[0].reglages.map(r => r.id)).toEqual(['theme']);
    const securite = rechercher('sécurité', TOUS);
    expect(securite.map(g => g.section.id)).toContain('securite');
    const podcast = rechercher('podcast', TOUS).flatMap(g => g.reglages.map(r => r.id));
    expect(podcast).toContain('podcast');
  });

  it('ne rend rien pour une requête sans correspondance, et tout pour une requête vide', () => {
    expect(rechercher('zzzzqqq', TOUS)).toEqual([]);
    expect(rechercher('   ', TOUS).flatMap(g => g.reglages)).toHaveLength(REGLAGES.length);
    expect(correspond(reglage('theme'), '')).toBe(true);
  });

  it('ne cherche que parmi les réglages disponibles', () => {
    expect(rechercher('excel', ['theme', 'version'])).toEqual([]);
    expect(rechercher('excel', ['export-excel']).flatMap(g => g.reglages.map(r => r.id))).toEqual(['export-excel']);
  });
});
