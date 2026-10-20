/**
 * Système de langues de l'Esport : dictionnaires cohérents (mêmes clés, mêmes variables, pluriels
 * complets), interpolation, pluriels, dates et nombres selon la langue, catalogue et messages
 * d'erreur traduits.
 */

import { CATALOGUE, nomJeu, nomModule, nomPoste, nomRole, descriptionPreset, nomGroupe, libellePermission, lignesMatrice } from '../client';
import { dateCourte, dateJour, tailleLisible, texteAlerte } from '../libelles';
import { dateCourteJour, dateLongue, joursCourts, joursSemaine, nomMois, resumeRecurrence } from '../planning/libelles';
import { quandCourt } from '../ui/Dashboard';
import {
  categoriePluriel,
  definirLangue,
  existe,
  formaterDate,
  formaterNombre,
  interpoler,
  langueAppareil,
  langueCourante,
  localeCourante,
  tr,
  trOu,
  traduire,
  trn,
} from './index';
import { traduireServeur } from './erreurs';
import { en } from './en';
import { fr } from './fr';

afterEach(() => {
  definirLangue('fr');
  delete (globalThis as { __ESPORT_LANGUE_APPAREIL__?: string }).__ESPORT_LANGUE_APPAREIL__;
  (globalThis as { __ESPORT_LANGUE_APPAREIL__?: string }).__ESPORT_LANGUE_APPAREIL__ = 'fr';
});

const variables = (texte: string) => [...texte.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const espacesNormaux = (s: string) => s.replace(/[  ]/g, ' ');

describe('dictionnaires', () => {
  const clesFr = Object.keys(fr) as Array<keyof typeof fr>;

  it('en contient exactement les clés de fr', () => {
    expect(Object.keys(en).sort()).toEqual([...clesFr].sort());
  });

  it('chaque clé garde les mêmes variables {x} dans les deux langues', () => {
    const ecarts = clesFr.filter(k => JSON.stringify(variables(fr[k])) !== JSON.stringify(variables(en[k]))).map(k => `${k}: ${variables(fr[k])} / ${variables(en[k])}`);
    expect(ecarts).toEqual([]);
  });

  it('aucun texte vide, aucune traduction laissée telle quelle sur les phrases', () => {
    for (const k of clesFr) {
      expect(en[k].trim()).not.toBe('');
      // Une phrase de plus de 40 caractères identique au français n'a pas été traduite.
      if (fr[k].length > 40) expect(`${k}: ${en[k]}`).not.toBe(`${k}: ${fr[k]}`);
    }
  });

  it('les pluriels sont complets : toute clé x.one a son x.other (et l’inverse)', () => {
    for (const k of clesFr) {
      if (k.endsWith('.one')) expect(existe(`${k.slice(0, -4)}.other`)).toBe(true);
      if (k.endsWith('.other')) expect(existe(`${k.slice(0, -6)}.one`)).toBe(true);
    }
  });
});

describe('interpolation et pluriels', () => {
  it('remplace les variables et laisse celles qu’on ne fournit pas', () => {
    expect(interpoler('Bonjour {nom}, {n} messages {x}', { nom: 'Léa', n: 3 })).toBe('Bonjour Léa, 3 messages {x}');
    expect(tr('dashboard.bonjour', { pseudo: 'Léa' })).toBe('Bonjour Léa');
    definirLangue('en');
    expect(tr('dashboard.bonjour', { pseudo: 'Léa' })).toBe('Hello Léa');
  });

  it('pluriels : 1 joueur / 2 joueurs ; 1 player / 2 players', () => {
    expect(trn('scouting.joueurs', 1)).toBe('1 joueur');
    expect(trn('scouting.joueurs', 2)).toBe('2 joueurs');
    expect(trn('scouting.joueurs', 0)).toBe('0 joueur'); // règle française : 0 et 1 au singulier
    definirLangue('en');
    expect(trn('scouting.joueurs', 1)).toBe('1 player');
    expect(trn('scouting.joueurs', 2)).toBe('2 players');
    expect(trn('scouting.joueurs', 0)).toBe('0 players');
  });

  it('pluriels invariables en anglais (« called up »), accords en français', () => {
    expect(trn('planning.convocations.convoques', 1)).toBe('1 convoqué');
    expect(trn('planning.convocations.convoques', 6)).toBe('6 convoqués');
    definirLangue('en');
    expect(trn('planning.convocations.convoques', 6)).toBe('6 called up');
    expect(trn('journal.annees', 1)).toBe('1 year');
    expect(trn('journal.annees', 2)).toBe('2 years');
  });

  it('catégories de pluriel par langue', () => {
    expect(categoriePluriel('fr', 0)).toBe('one');
    expect(categoriePluriel('fr', 1.5)).toBe('one');
    expect(categoriePluriel('fr', 2)).toBe('other');
    expect(categoriePluriel('en', 0)).toBe('other');
    expect(categoriePluriel('en', 1)).toBe('one');
  });

  it('traduire() cible une langue sans toucher la langue courante ; trOu() garde le secours', () => {
    expect(traduire('en', 'dashboard.dashboard')).toBe('Dashboard');
    expect(traduire('fr', 'discord.fermer')).toBe('Fermer');
    expect(langueCourante()).toBe('fr');
    expect(trOu('cat.inconnu.x', 'secours')).toBe('secours');
  });
});

describe('langue de l’appareil', () => {
  const regler = (l?: string) => ((globalThis as { __ESPORT_LANGUE_APPAREIL__?: string }).__ESPORT_LANGUE_APPAREIL__ = l);
  it('anglais si la langue de l’appareil est en*, sinon français', () => {
    regler('en-US');
    expect(langueAppareil()).toBe('en');
    regler('en');
    expect(langueAppareil()).toBe('en');
    regler('fr-FR');
    expect(langueAppareil()).toBe('fr');
    regler('de-DE');
    expect(langueAppareil()).toBe('fr');
    regler('english');
    expect(langueAppareil()).toBe('fr');
  });
});

describe('dates et nombres selon la langue', () => {
  it('nombres', () => {
    expect(espacesNormaux(formaterNombre(1234.5))).toBe('1 234,5');
    definirLangue('en');
    expect(formaterNombre(1234.5)).toBe('1,234.5');
    expect(localeCourante()).toBe('en-GB');
  });

  it('tailles de fichiers', () => {
    expect(tailleLisible(3 * 1024 * 1024)).toBe('3,0 Mo');
    expect(tailleLisible(1536)).toBe('2 Ko');
    definirLangue('en');
    expect(tailleLisible(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(tailleLisible(1536)).toBe('2 KB');
    expect(tailleLisible(12)).toBe('12 B');
  });

  it('dates civiles : mois, jours longs et courts', () => {
    expect(nomMois('2026-10-01')).toBe('octobre 2026');
    expect(dateLongue('2026-10-20')).toBe('mardi 20 octobre');
    expect(dateCourteJour('2026-10-20')).toBe('mar. 20/10');
    expect(joursSemaine()[0]).toBe('lundi');
    expect(joursCourts()).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    definirLangue('en');
    expect(nomMois('2026-10-01')).toBe('October 2026');
    expect(dateLongue('2026-10-20')).toBe('Tuesday 20 October');
    expect(dateCourteJour('2026-10-20')).toBe('Tue 20/10');
    expect(joursSemaine()[6]).toBe('Sunday');
    expect(joursCourts()).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('dates et heures locales : « 20/10 à 14:05 » / « 20/10 at 14:05 », « jeu. 22/10 · 20:00 » / « Thu 22/10 · 20:00 »', () => {
    const d = new Date(2026, 9, 22, 20, 0);
    expect(dateCourte(d.toISOString())).toBe('22/10 à 20:00');
    expect(quandCourt(d.toISOString())).toBe('jeu. 22/10 · 20:00');
    expect(formaterDate(d, { day: 'numeric', month: 'long' })).toBe('22 octobre');
    definirLangue('en');
    expect(dateCourte(d.toISOString())).toBe('22/10 at 20:00');
    expect(quandCourt(d.toISOString())).toBe('Thu 22/10 · 20:00');
    expect(formaterDate(d, { day: 'numeric', month: 'long' })).toBe('22 October');
    expect(dateJour('2026-10-19')).toBe('19/10/2026');
  });

  it('récurrence et alertes du Dashboard suivent la langue', () => {
    const r = { freq: 'hebdo', intervalle: 2, jours: [2, 4], jusqua: '2026-12-20', nombre: null } as { freq: 'hebdo'; intervalle: number; jours: number[]; jusqua: string; nombre: null };
    expect(resumeRecurrence(r)).toBe('Toutes les 2 semaines : mardi, jeudi · jusqu’au 20/12/2026');
    expect(texteAlerte({ genre: 'taches', teamId: 't', teamNom: 'T', nombre: 2, texte: 'x' })).toBe('2 tâches en retard');
    definirLangue('en');
    expect(resumeRecurrence(r)).toBe('Every 2 weeks: Tuesday, Thursday · until 20/12/2026');
    expect(texteAlerte({ genre: 'taches', teamId: 't', teamNom: 'T', nombre: 1, texte: 'x' })).toBe('1 overdue task');
    expect(texteAlerte({ genre: 'presence', teamId: 't', teamNom: 'T', nombre: 55, texte: 'x' })).toBe('Attendance at 55% over 14 days');
  });
});

describe('catalogue (modules, permissions, rôles, presets, jeux)', () => {
  it('chaque nom du catalogue a une clé dans les deux langues, et le français suit catalogue.json', () => {
    const attendues: Array<[string, string]> = [];
    for (const m of CATALOGUE.modules) attendues.push([`cat.module.${m.cle}.nom`, m.nom], [`cat.module.${m.cle}.description`, m.description]);
    for (const g of CATALOGUE.groupes) {
      attendues.push([`cat.groupe.${g.cle}`, g.nom]);
      for (const p of g.permissions) attendues.push([`cat.perm.${p.cle}`, p.libelle]);
    }
    for (const r of CATALOGUE.rolesSysteme) attendues.push([`cat.role.${r.cle}.nom`, r.nom], [`cat.role.${r.cle}.description`, r.description]);
    for (const p of CATALOGUE.presets) attendues.push([`cat.preset.${p.cle}.nom`, p.nom], [`cat.preset.${p.cle}.description`, p.description]);
    for (const j of CATALOGUE.jeux) attendues.push([`cat.jeu.${j.cle}`, j.nom]);
    expect(attendues.length).toBeGreaterThan(90);
    for (const [cle, texteFr] of attendues) {
      expect(existe(cle)).toBe(true);
      expect(`${cle}: ${traduire('fr', cle as keyof typeof fr)}`).toBe(`${cle}: ${texteFr}`);
      expect(traduire('en', cle as keyof typeof fr).length).toBeGreaterThan(0);
    }
  });

  it('les noms et libellés sont traduits à l’affichage', () => {
    expect(nomModule('video_review')).toBe('Review vidéo');
    expect(nomRole('Joueur')).toBe('Joueur');
    expect(nomPoste('Duelliste')).toBe('Duelliste');
    definirLangue('en');
    expect(nomModule('video_review')).toBe('Video review');
    expect(nomModule('inconnu')).toBe('inconnu');
    expect(nomRole('Joueur')).toBe('Player');
    expect(nomRole('Coach')).toBe('Coach');
    expect(nomRole('Capitaine')).toBe('Capitaine'); // rôle créé par la team : jamais traduit
    expect(nomPoste('Duelliste')).toBe('Duelist');
    expect(nomPoste('Poste maison')).toBe('Poste maison');
    expect(nomJeu('valorant')).toBe('Valorant');
    expect(descriptionPreset(CATALOGUE.presets[0])).toBe('All modules.');
    const ligne = lignesMatrice(['planning'])[0];
    expect(nomGroupe(ligne)).toBe('Team');
    expect(libellePermission(CATALOGUE.groupes[0].permissions[0])).toBe('Edit the team');
  });
});

describe('messages d’erreur de l’API', () => {
  it('le français est inchangé ; l’anglais traduit la phrase exacte ou le motif à variables', () => {
    expect(traduireServeur('Entrée introuvable.', 'fr')).toBe('Entrée introuvable.');
    expect(traduireServeur('Entrée introuvable.', 'en')).toBe('Entry not found.');
    expect(traduireServeur('Modèle trop long (500 caractères au plus).', 'en')).toBe('Template too long (500 characters at most).');
    expect(traduireServeur('Max est déjà membre de Faucons, Nova.', 'en')).toBe('Max is already a member of Faucons, Nova.');
    expect(traduireServeur('Message inconnu du dictionnaire.', 'en')).toBe('Message inconnu du dictionnaire.');
  });

  it('suit la langue courante par défaut', () => {
    expect(traduireServeur('Tâche introuvable.')).toBe('Tâche introuvable.');
    definirLangue('en');
    expect(traduireServeur('Tâche introuvable.')).toBe('Task not found.');
  });
});
