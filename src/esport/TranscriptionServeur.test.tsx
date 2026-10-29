/**
 * Transcription SUR LE SERVEUR (interface) : écran de progression (en file, pourcentage, temps restant,
 * nouvel essai, échec et repli navigateur), suivi automatique jusqu'au PDF prêt, choix du mode au
 * dépôt (serveur / navigateur / API externe selon ce que le serveur propose) et Paramètres de la team.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import type { ClientEsport, Depot, QualiteProposee, TravailServeur } from './client';
import type { ReglagesTranscription, Transcription } from './medias/api';
import { phraseJournal, phraseNotification } from './libelles';
import { EditeurTranscription, PanneauTranscription } from './ui/medias/Transcription';
import { ChoixModeTranscription, ChoixQualite, ReglagesTranscriptionTeam, SUIVI_MS, dureeRestante, estimationQualite, libelleTravailServeur, modeParDefaut, modesProposes, qualiteRetenue } from './ui/medias/TranscriptionServeur';

const theme = themeHub('nuit');

const travail = (champs: Partial<TravailServeur> = {}): TravailServeur => ({
  statut: 'en_cours',
  modele: 'base',
  langue: 'fr',
  progression: 1500,
  duree: 3600,
  pourcentage: 41,
  restantS: 610,
  rang: 0,
  essais: 0,
  prochainEssai: null,
  erreur: null,
  debutLe: '2026-10-20T10:00:00.000Z',
  finLe: null,
  majLe: '2026-10-20T10:20:00.000Z',
  ...champs,
});

const depot = (transcription: Depot['transcription']): Depot => ({
  id: 'd1',
  team: { id: 't1', nom: 'Faucons' },
  titre: 'Hebdo',
  lien: '',
  type: null,
  dateReunion: '2026-10-20',
  note: '',
  statut: 'a_resumer',
  deposePar: { compte: 'lea12345', pseudo: 'Léa' },
  creeLe: '2026-10-20T08:00:00.000Z',
  majLe: '2026-10-20T08:00:00.000Z',
  resume: null,
  nouveau: false,
  vu: null,
  moi: { deposant: true, redacteur: false },
  enregistrement: { id: 'f1', nom: 'hebdo.m4a', taille: 1000, type: 'audio/mp4', media: null, supprime: false, creeLe: '' } as unknown as Depot['enregistrement'],
  transcription,
});

const transcription = (champs: Partial<Transcription>): Transcription => ({
  statut: 'serveur',
  langue: 'fr',
  moteur: '',
  segments: [],
  duree: null,
  progression: 0,
  partielle: true,
  preResume: [],
  erreur: null,
  pdf: null,
  auteur: null,
  modifiePar: null,
  majLe: null,
  enregistrement: null,
  peutModifier: true,
  externe: false,
  serveur: true,
  travail: null,
  ...champs,
});

function client(requete: jest.Mock): ClientEsport {
  return { requete } as unknown as ClientEsport;
}

describe('libellés de la transcription sur le serveur', () => {
  it('temps restant, file d’attente, en cours, reprise, nouvel essai, échec traduit', () => {
    expect(dureeRestante(20)).toBe('moins d’une minute');
    expect(dureeRestante(610)).toBe('10 min');
    expect(dureeRestante(3900)).toBe('1 h 05');
    expect(libelleTravailServeur(travail({ statut: 'attente', progression: 0, pourcentage: 0, rang: 2 }))).toBe('En file d’attente sur le serveur (2 avant)');
    expect(libelleTravailServeur(travail({ statut: 'attente', progression: 0, pourcentage: 0, rang: 0 }))).toMatch(/démarre dans les 5 minutes/);
    expect(libelleTravailServeur(travail())).toBe('Sur le serveur : 41 % (encore environ 10 min)');
    expect(libelleTravailServeur(travail({ restantS: null }))).toBe('Sur le serveur : 41 %');
    expect(libelleTravailServeur(travail({ pourcentage: 97, restantS: 20 }))).toBe('Sur le serveur : 97 % (presque fini)');
    expect(libelleTravailServeur(travail({ statut: 'attente' }))).toMatch(/^Interrompue à 41 %/);
    expect(libelleTravailServeur(travail({ statut: 'attente', prochainEssai: '2026-10-20T10:30:00.000Z' }))).toMatch(/^Problème sur le serveur : nouvel essai vers/);
    expect(libelleTravailServeur(travail({ statut: 'echec', erreur: 'Moteur en panne.' }))).toBe('Échec sur le serveur : Moteur en panne.');
  });

  it('journal et notifications : fait par le serveur, échec', () => {
    const e = (action: string, acteur: string | null) => ({ id: '1', action, acteur, entiteType: null, entiteId: null, meta: { titre: 'Hebdo' }, date: '' });
    expect(phraseJournal(e('meeting.transcription_ready', null), {})).toBe('Le serveur a terminé la transcription de « Hebdo »');
    expect(phraseJournal(e('meeting.transcription_failed', null), {})).toBe('La transcription de « Hebdo » a échoué sur le serveur');
    const n = { id: '1', type: 'transcription-echec', team: { id: 't', nom: 'Faucons' }, charge: { titre: 'Hebdo' }, lue: false, date: '' };
    expect(phraseNotification(n, {})).toBe('La transcription de « Hebdo » a échoué sur le serveur : lancez-la dans le navigateur (Faucons)');
  });

  it('modes proposés au dépôt et mode présélectionné', () => {
    const r = (mode: ReglagesTranscription['mode'], serveur: boolean, externe = false): ReglagesTranscription => ({ mode, choisi: null, defautServeur: 'serveur', disponibles: { serveur, navigateur: true, externe }, modele: 'base', modifiable: false });
    expect(modesProposes(r('serveur', true), true)).toEqual(['serveur', 'navigateur']);
    // iPhone (pas de transcription dans le navigateur) : le serveur seulement.
    expect(modesProposes(r('serveur', true), false)).toEqual(['serveur']);
    expect(modesProposes(r('navigateur', false, true), true)).toEqual(['navigateur', 'externe']);
    expect(modesProposes(undefined, false)).toEqual([]);
    expect(modeParDefaut(r('navigateur', true), ['serveur', 'navigateur'])).toBe('navigateur');
    // Serveur pas installé : le navigateur.
    expect(modeParDefaut(r('navigateur', false), modesProposes(r('navigateur', false), true))).toBe('navigateur');
    expect(modeParDefaut(r('externe', true), ['serveur'])).toBe('serveur');
  });
});

describe('écran de progression', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('en cours : pourcentage et temps restant, rafraîchi toutes les 15 s jusqu’au PDF prêt', async () => {
    let reponse = transcription({ travail: travail({ pourcentage: 75, progression: 2700, restantS: 300 }) });
    const requete = jest.fn(async () => reponse);
    const onChange = jest.fn();
    await render(<PanneauTranscription theme={theme} client={client(requete)} teamId="t1" depot={depot({ statut: 'serveur', pdf: false, peutTranscrire: true, serveur: true, travail: travail() })} onChange={onChange} />);
    expect(screen.getByTestId('esport-transcription-d1-serveur-etat').props.children).toBe('Sur le serveur : 41 % (encore environ 10 min)');
    expect(screen.getByTestId('esport-transcription-d1-statut').props.children).toBe('Transcription en cours sur le serveur');
    // Pas de bouton « Transcrire » (navigateur) pendant que le serveur travaille.
    expect(screen.queryByTestId('esport-transcription-d1-lancer')).toBeNull();
    expect(screen.queryByTestId('esport-transcription-d1-serveur-lancer')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(SUIVI_MS);
    });
    await waitFor(() => expect(screen.getByTestId('esport-transcription-d1-serveur-etat').props.children).toBe('Sur le serveur : 75 % (encore environ 5 min)'));
    expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription');
    expect(onChange).not.toHaveBeenCalled();
    reponse = transcription({ statut: 'prete', partielle: false, travail: travail({ statut: 'termine', pourcentage: 100, restantS: null }) });
    await act(async () => {
      jest.advanceTimersByTime(SUIVI_MS);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.getByTestId('esport-transcription-d1-statut').props.children).toBe('Transcription prête');
  });

  it('annuler : le travail du serveur est retiré (on transcrira autrement)', async () => {
    const requete = jest.fn(async () => transcription({ statut: 'a_faire', travail: travail({ statut: 'annule' }) }));
    await render(<PanneauTranscription theme={theme} client={client(requete)} teamId="t1" depot={depot({ statut: 'serveur', pdf: false, peutTranscrire: true, serveur: true, travail: travail({ statut: 'attente', rang: 1, progression: 0, pourcentage: 0 }) })} />);
    expect(screen.getByTestId('esport-transcription-d1-serveur-etat').props.children).toBe('En file d’attente sur le serveur (1 avant)');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-d1-serveur-annuler'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription/serveur', 'DELETE'));
    await waitFor(() => expect(screen.getByTestId('esport-transcription-d1-statut').props.children).toBe('À transcrire'));
  });

  it('échec sur le serveur : message, repli navigateur proposé, « Réessayer sur le serveur »', async () => {
    const requete = jest.fn(async () => transcription({ statut: 'serveur', travail: travail({ statut: 'attente', progression: 0, pourcentage: 0, rang: 0 }) }));
    await render(<PanneauTranscription theme={theme} client={client(requete)} teamId="t1" depot={depot({ statut: 'echec', pdf: false, peutTranscrire: true, serveur: true, travail: travail({ statut: 'echec', erreur: 'Moteur en panne.' }) })} />);
    expect(screen.getByTestId('esport-transcription-d1-serveur-echec').props.children).toMatch(/a échoué \(Moteur en panne\.\)\. Vous pouvez la lancer dans le navigateur/);
    const bouton = screen.getByTestId('esport-transcription-d1-serveur-lancer');
    expect(screen.getByText('Réessayer sur le serveur')).toBeTruthy();
    await act(async () => {
      fireEvent.press(bouton);
    });
    // Sans choix de langue ni de qualité ici : celles de la team (Paramètres), décidées par le serveur.
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription/serveur', 'POST', {}));
    await waitFor(() => expect(screen.getByTestId('esport-transcription-d1-serveur-etat').props.children).toMatch(/démarre dans les 5 minutes/));
  });

  it('serveur pas installé : pas de bouton serveur', async () => {
    await render(<PanneauTranscription theme={theme} client={client(jest.fn())} teamId="t1" depot={depot({ statut: 'a_faire', pdf: false, peutTranscrire: true, serveur: false })} />);
    expect(screen.queryByTestId('esport-transcription-d1-serveur-lancer')).toBeNull();
  });
});

describe('choix du mode', () => {
  it('au dépôt : options proposées, explication du mode, alerte si le serveur manque', async () => {
    const choisir = jest.fn();
    const { rerender } = await render(<ChoixModeTranscription theme={theme} modes={['serveur', 'navigateur']} valeur="serveur" onChoisir={choisir} serveurAbsent={false} />);
    expect(screen.getByText('Serveur (automatique)')).toBeTruthy();
    expect(screen.getByText('Navigateur (ce PC)')).toBeTruthy();
    expect(screen.getByTestId('esport-depot-mode-explication').props.children).toMatch(/vous pouvez fermer l’app, même sur iPhone/);
    await fireEvent.press(screen.getByTestId('esport-depot-mode-transcription-navigateur'));
    expect(choisir).toHaveBeenCalledWith('navigateur');
    await rerender(<ChoixModeTranscription theme={theme} modes={['navigateur']} valeur="navigateur" onChoisir={choisir} serveurAbsent />);
    expect(screen.queryByTestId('esport-depot-mode-transcription-serveur')).toBeNull();
    expect(screen.getByText(/n’est pas installée : utilisez le navigateur/)).toBeTruthy();
  });

  it('Paramètres de la team : mode par défaut changé (team.manage), retour au réglage du serveur', async () => {
    let reglages: ReglagesTranscription = { mode: 'serveur', choisi: null, defautServeur: 'serveur', disponibles: { serveur: true, navigateur: true, externe: false }, modele: 'base', modifiable: true };
    const requete = jest.fn(async (chemin: string, methode?: string, corps?: { mode: ReglagesTranscription['mode'] | null }) => {
      if (methode === 'PATCH') reglages = { ...reglages, mode: corps?.mode ?? 'serveur', choisi: corps?.mode ?? null };
      return reglages;
    });
    await render(<ReglagesTranscriptionTeam theme={theme} client={client(requete)} teamId="t1" />);
    await screen.findByTestId('esport-parametres-transcription');
    expect(screen.getByText(/Modèle Whisper du serveur : base/)).toBeTruthy();
    expect(screen.queryByTestId('esport-parametres-transcription-mode-externe')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-parametres-transcription-mode-navigateur'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { mode: 'navigateur' }));
    await act(async () => {
      fireEvent.press(await screen.findByTestId('esport-parametres-transcription-defaut'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { mode: null }));
  });

  it('Paramètres : rien pour un membre qui ne gère pas la team', async () => {
    const requete = jest.fn(async () => ({ mode: 'serveur', choisi: null, defautServeur: 'serveur', disponibles: { serveur: true, navigateur: true, externe: false }, modele: 'base', modifiable: false }));
    await render(<ReglagesTranscriptionTeam theme={theme} client={client(requete)} teamId="t1" />);
    await waitFor(() => expect(requete).toHaveBeenCalled());
    expect(screen.queryByTestId('esport-parametres-transcription')).toBeNull();
  });
});

// ------------------------------------------------------------------ Qualité (whisper.cpp), relecture par l'IA locale

const QUALITES: QualiteProposee[] = [
  { cle: 'rapide', disponible: true, moteur: 'whispercpp', modele: 'small', facteur: 0.1, mesuree: true },
  { cle: 'equilibree', disponible: true, moteur: 'whispercpp', modele: 'large-v3-turbo-q5_0', facteur: 0.2, mesuree: true },
  { cle: 'maximale', disponible: false, moteur: 'whispercpp', modele: 'large-v3-q5_0', facteur: 0.8, mesuree: false },
];

describe('qualité de la transcription', () => {
  // Le suivi du serveur rafraîchit toutes les 15 s : horloge simulée.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('qualité retenue (la demandée si disponible, sinon l’équilibrée) et durée estimée (pauses comprises)', () => {
    expect(qualiteRetenue(QUALITES, 'rapide')).toBe('rapide');
    expect(qualiteRetenue(QUALITES, 'maximale')).toBe('equilibree');
    expect(qualiteRetenue([], 'maximale')).toBeUndefined();
    // 0,2 × 3600 s × 1,25 = 15 min ; sans durée connue : par heure de réunion.
    expect(estimationQualite(QUALITES[1], 3600)).toBe('15 min');
    expect(estimationQualite(QUALITES[1], null)).toBe('15 min');
    expect(estimationQualite({ ...QUALITES[1], facteur: null }, 3600)).toBeNull();
    expect(libelleTravailServeur(travail({ etape: 'correction', correctionFaite: 32, pourcentage: 100 }))).toBe('Relecture par l’IA (orthographe, ponctuation, noms du jeu) : 32 segments relus');
  });

  it('choix : seules les qualités disponibles, explication et durée pour cet enregistrement', async () => {
    const choisir = jest.fn();
    await render(<ChoixQualite theme={theme} qualites={QUALITES} valeur="equilibree" onChoisir={choisir} dureeAudio={1800} testID="q" />);
    expect(screen.getByText('Rapide')).toBeTruthy();
    expect(screen.queryByTestId('q-segments-maximale')).toBeNull();
    expect(screen.getByTestId('q-explication').props.children.join('')).toMatch(/large-v3-turbo.*Durée estimée : environ 8 min/);
    await fireEvent.press(screen.getByTestId('q-segments-rapide'));
    expect(choisir).toHaveBeenCalledWith('rapide');
  });

  it('dépôt à transcrire : qualité choisie envoyée au serveur', async () => {
    const requete = jest.fn(async () => transcription({ statut: 'serveur', travail: travail({ statut: 'attente', progression: 0, pourcentage: 0 }) }));
    await render(<PanneauTranscription theme={theme} client={client(requete)} teamId="t1" depot={depot({ statut: 'a_faire', pdf: false, peutTranscrire: true, serveur: true, qualites: QUALITES, meilleureQualite: 'equilibree' })} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-d1-qualite-segments-rapide'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-d1-serveur-lancer'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription/serveur', 'POST', { qualite: 'rapide' }));
  });

  it('transcription prête : « Retranscrire avec la meilleure qualité »', async () => {
    const requete2 = jest.fn(async () => transcription({ statut: 'serveur', travail: travail({ statut: 'attente', progression: 0, pourcentage: 0 }) }));
    await render(<PanneauTranscription theme={theme} client={client(requete2)} teamId="t1" depot={depot({ statut: 'prete', pdf: true, peutTranscrire: true, serveur: true, qualites: QUALITES, meilleureQualite: 'equilibree' })} />);
    expect(screen.queryByTestId('esport-transcription-d1-qualite')).toBeNull();
    expect(screen.getByText('Retranscrire avec la meilleure qualité (Équilibrée)')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-d1-serveur-lancer'));
    });
    await waitFor(() => expect(requete2).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription/serveur', 'POST', { qualite: 'equilibree' }));
  });

  it('éditeur : bascule relue / brute ; garder la brute l’enregistre comme texte de la transcription', async () => {
    const lue = transcription({
      statut: 'prete',
      partielle: false,
      moteur: 'whisper.cpp large-v3-turbo (q5_0) (serveur)',
      qualite: 'equilibree',
      segments: [{ debut: 0, fin: 4, texte: 'On joue Jett sur Ascent.' }],
      segmentsBruts: [{ debut: 0, fin: 4, texte: 'on joue jet sur assent' }],
      correction: 'Relue par l’IA (IA locale, Qwen2.5-7B-Instruct (Q4_K_M)) : 1 ligne(s) corrigée(s)',
    });
    const requete = jest.fn(async (_chemin: string, methode?: string) => (methode === 'PUT' ? { ...lue, segments: lue.segmentsBruts ?? [], segmentsBruts: lue.segmentsBruts } : lue));
    await render(<EditeurTranscription theme={theme} client={client(requete)} teamId="t1" depotId="d1" />);
    await screen.findByTestId('esport-transcription-version-corrigee');
    expect(screen.getByTestId('esport-transcription-segment-0').props.value).toBe('On joue Jett sur Ascent.');
    expect(screen.getByTestId('esport-transcription-version-explication').props.children).toMatch(/^Relue par l’IA \(IA locale, Qwen.*La version brute reste disponible/);
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-version-brute'));
    });
    expect(screen.getByTestId('esport-transcription-segment-0').props.value).toBe('on joue jet sur assent');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-transcription-enregistrer'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/d1/transcription', 'PUT', expect.objectContaining({ segments: [{ debut: 0, fin: 4, texte: 'on joue jet sur assent' }] })));
  });

  it('Paramètres : langue (détection automatique), qualité, relecture par l’IA locale, glossaire', async () => {
    let reglages: ReglagesTranscription = {
      mode: 'serveur',
      choisi: null,
      defautServeur: 'serveur',
      disponibles: { serveur: true, navigateur: true, externe: false },
      modele: 'base',
      modifiable: true,
      langue: 'fr',
      qualite: 'equilibree',
      qualiteChoisie: null,
      qualites: QUALITES,
      correction: true,
      correctionDisponible: true,
      glossaire: '',
    };
    const requete = jest.fn(async (_chemin: string, methode?: string, corps?: Partial<ReglagesTranscription>) => {
      if (methode === 'PATCH') reglages = { ...reglages, ...corps };
      return reglages;
    });
    await render(<ReglagesTranscriptionTeam theme={theme} client={client(requete)} teamId="t1" />);
    await screen.findByTestId('esport-parametres-transcription');
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-parametres-transcription-langue-auto'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { langue: 'auto' }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-parametres-transcription-qualite-segments-rapide'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { qualite: 'rapide' }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-parametres-transcription-correction'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { correction: false }));
    expect(screen.queryByTestId('esport-parametres-transcription-glossaire-enregistrer')).toBeNull();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('esport-parametres-transcription-glossaire'), 'Zozoto, B main');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('esport-parametres-transcription-glossaire-enregistrer'));
    });
    await waitFor(() => expect(requete).toHaveBeenCalledWith('/teams/t1/resumes/reglages-transcription', 'PATCH', { glossaire: 'Zozoto, B main' }));
  });
});
