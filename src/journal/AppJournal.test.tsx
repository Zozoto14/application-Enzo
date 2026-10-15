/**
 * Écran du Journal : lecture comme un livre (jour, semaine, mois, calendrier,
 * recherche), note, humeur, épingle, export, réglages, mode valeurs masquées,
 * rattrapage à l'ouverture, 8 thèmes, bureau et téléphone.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { REGISTRE } from '../hub/registre';
import { THEMES_HUB, themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { creerEspace, creerProjet, creerTache, donneesVides, modifierTache } from '../taches/modele';
import { CLES_TACHES } from '../taches/partage';
import { definirDiscretion } from '../ui/discretion';
import { ModeAffichageForce } from '../ui/mobile';
import { AppJournal } from './AppJournal';
import { appsVisibles } from '../hub/permissions';
import { deposerEvenementJournal } from '../hub/journal/boite';
import { infoJournal, APP_JOURNAL } from './registre';
import { CLES_JOURNAL, ecrirePage, lirePage, lireReglages } from './modele';
import { baseMemoire } from './__fixtures__/outils';
import { agreger } from './agregation';
import { rediger } from './redaction';
import { journeeRemplie } from './__fixtures__/outils';
import * as impression from './export';

const local = (jour: string, h: number, m = 0) => new Date(`${jour}T00:00:00`).getTime() + (h * 60 + m) * 60_000;
const J = '2026-10-13';
const services = () => ({ stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined });
const ctx = (t: number) => ({ maintenant: t, auteur: 'fondateur' as const, alea: () => 0.5 });

/** Données de Tâches du jour : deux tâches terminées, une créée. */
function tachesDuJour(): string {
  let d = donneesVides();
  const e = creerEspace(d, 'Perso', ctx(local('2026-10-01', 9)));
  d = e.donnees;
  const p = creerProjet(d, e.espace.id, 'Clients', ctx(local('2026-10-01', 9)));
  d = p.donnees;
  for (const [titre, h] of [['Envoyer la facture', 9], ['Relire le contrat', 10]] as const) {
    const r = creerTache(d, { titre, listeId: p.liste.id }, ctx(local(J, h)));
    d = modifierTache(r.donnees, r.tache.id, { statut: 'fait' }, ctx(local(J, h + 1)));
  }
  d = creerTache(d, { titre: 'Préparer la réunion', listeId: p.liste.id }, ctx(local(J, 15))).donnees;
  return JSON.stringify(d);
}

const pageRemplie = (jour: string, extra = {}) => {
  const r = agreger(jour, journeeRemplie(jour));
  return { v: 1 as const, jour, auto: rediger(r), compteurs: r.compteurs, nbEvenements: r.evenements.length, ecritLe: `${jour}T21:00:00.000Z`, ...extra };
};

async function monter(contexte: ContexteHub, mode: 'large' | 'telephone' = 'large', theme = themeHub('nuit'), onRetour = () => undefined) {
  return await render(
    <ModeAffichageForce mode={mode}>
      <AppJournal contexte={contexte} theme={theme} registre={REGISTRE} onRetour={onRetour} />
    </ModeAffichageForce>,
  );
}
const toucher = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};

afterEach(() => definirDiscretion(false));

describe('Journal : écran', () => {
  it('sans base de profil : message clair, rien d’autre', async () => {
    await monter({ maintenant: local(J, 12) });
    expect(screen.getByTestId('app-journal-refus')).toBeTruthy();
    expect(screen.queryByTestId('app-journal')).toBeNull();
  });

  it('la tuile existe pour qui a un profil ouvert ; l’ami la voit seulement si l’Administration lui a ouvert l’app', () => {
    const b = baseMemoire();
    expect(appsVisibles([APP_JOURNAL], { baseProfil: b }).map(a => a.id)).toEqual(['journal']);
    expect(appsVisibles([APP_JOURNAL], { baseProfil: b, profil: { id: 'amie0001', nom: 'Léa', admin: false, creeLe: '', apps: [] } })).toEqual([]);
    expect(appsVisibles([APP_JOURNAL], { baseProfil: b, profil: { id: 'amie0001', nom: 'Léa', admin: false, creeLe: '', apps: ['journal'] } }).map(a => a.id)).toEqual(['journal']);
    expect(appsVisibles([APP_JOURNAL], {})).toEqual([]);
  });

  it('avant l’heure : pas de page, on peut l’écrire à la demande ; la page lit Tâches, note l’heure et les chiffres', async () => {
    const b = baseMemoire({ [CLES_TACHES.donnees]: tachesDuJour() });
    await monter({ baseProfil: b, admin: services(), maintenant: local(J, 15) });
    expect(screen.getByTestId('journal-vide')).toBeTruthy();
    await toucher('journal-ecrire-jour');
    await waitFor(() => expect(screen.getByTestId('journal-texte')).toBeTruthy());
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Mardi 13 octobre 2026');
    expect(screen.getByTestId('journal-section-taches')).toHaveTextContent(/Envoyer la facture/);
    expect(screen.getByTestId('journal-chiffre-taches-finies')).toHaveTextContent(/^2Tâches/);
    expect(screen.getByTestId('journal-avis')).toHaveTextContent(/est écrite/);
    expect(lirePage(b, J)?.nbEvenements).toBe(5);
    // Écrite avant la fin de la journée : le texte le dit.
    expect(lirePage(b, J)?.auto.cloture).toContain('avant la fin de la journée');
  });

  it('première ouverture le lendemain : la page d’hier est rattrapée toute seule', async () => {
    const b = baseMemoire({ [CLES_TACHES.donnees]: tachesDuJour(), [CLES_JOURNAL.reglages]: JSON.stringify({ v: 1, actif: true, heure: 21, depuis: J, ia: false }) });
    await monter({ baseProfil: b, admin: services(), maintenant: local('2026-10-14', 8, 30) });
    await waitFor(() => expect(lirePage(b, J)).toBeTruthy());
    expect(lirePage(b, J)?.auto.moteur).toBe('modeles');
    await waitFor(() => expect(screen.getByTestId('journal-avis')).toHaveTextContent(/vient d’être écrite/));
    // Aujourd'hui (14) n'est pas encore dû : on voit un jour sans page ; hier est un tap en arrière.
    await toucher('journal-precedent');
    await waitFor(() => expect(screen.getByTestId('journal-texte')).toBeTruthy());
  });

  it('note, humeur, épingle : enregistrées dans la base du profil', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    await fireEvent.changeText(screen.getByTestId('journal-note'), 'Journée forte en émotions.');
    await toucher('journal-note-enregistrer');
    await toucher('journal-humeur-4');
    await toucher('journal-epingler');
    const p = lirePage(b, J)!;
    expect(p).toMatchObject({ note: 'Journée forte en émotions.', humeur: 4, epingle: true });
    expect(screen.getByTestId('journal-humeur-4').props.accessibilityState.checked).toBe(true);
    // Retirer l'humeur en la touchant de nouveau.
    await toucher('journal-humeur-4');
    expect(lirePage(b, J)?.humeur).toBeUndefined();
  });

  it('naviguer par jour : précédent, suivant (bloqué après aujourd’hui), retour à aujourd’hui', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J));
    ecrirePage(b, pageRemplie('2026-10-12'));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    expect(screen.getByTestId('journal-suivant').props.accessibilityState.disabled).toBe(true);
    await toucher('journal-precedent');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Lundi 12 octobre 2026');
    expect(screen.getByTestId('journal-suivant').props.accessibilityState.disabled).toBe(false);
    await toucher('journal-aujourdhui');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Mardi 13 octobre 2026');
  });

  it('semaine : récap, une ligne par jour, un tap ouvre le jour', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie('2026-10-12', { humeur: 5 }));
    ecrirePage(b, pageRemplie(J));
    await monter({ baseProfil: b, maintenant: local('2026-10-14', 8) });
    await toucher('journal-onglet-semaine');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('semaine du 12 au 18 octobre 2026');
    expect(screen.getByTestId('journal-recap')).toHaveTextContent(/2 pages/);
    expect(screen.getByTestId('journal-recap-pages')).toHaveTextContent(/^2\/3/);
    expect(screen.getAllByTestId(/^journal-semaine-2026-10-1/)).toHaveLength(7);
    await toucher('journal-semaine-2026-10-12');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Lundi 12 octobre 2026');
    expect(screen.getByTestId('journal-humeur-5').props.accessibilityState.checked).toBe(true);
  });

  it('mois : récap du mois et journées épinglées', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie('2026-10-12', { epingle: true }));
    ecrirePage(b, pageRemplie(J));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    await toucher('journal-onglet-mois');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('octobre 2026');
    expect(screen.getByTestId('journal-recap')).toBeTruthy();
    expect(screen.getByTestId('journal-epinglee-2026-10-12')).toBeTruthy();
    await toucher('journal-precedent');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('septembre 2026');
    expect(screen.getByTestId('journal-recap')).toHaveTextContent(/Aucune page|Rien/);
  });

  it('calendrier : cases du mois, pages écrites marquées, humeur, tap pour ouvrir ; les jours futurs sont inactifs', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie('2026-10-12', { humeur: 5, epingle: true }));
    ecrirePage(b, pageRemplie(J));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    await toucher('journal-onglet-calendrier');
    expect(screen.getAllByTestId(/^journal-cellule-2026-10-/)).toHaveLength(31);
    expect(screen.getByTestId('journal-cellule-2026-10-12').props.accessibilityLabel).toMatch(/page écrite, épinglée/);
    expect(screen.getByTestId('journal-cellule-2026-10-20').props.accessibilityState?.disabled).toBe(true);
    await toucher('journal-cellule-2026-10-12');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Lundi 12 octobre 2026');
  });

  it('recherche : mots, accents, notes ; épinglées en l’absence de requête', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie('2026-10-12', { epingle: true }));
    ecrirePage(b, pageRemplie(J, { note: 'Rendez-vous chez le médecin' }));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    await toucher('journal-onglet-recherche');
    expect(screen.getByTestId('journal-epinglees')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('journal-recherche-champ'), 'MEDECIN');
    expect(screen.getByTestId('journal-recherche-compte')).toHaveTextContent('1 page trouvée');
    await toucher('journal-resultat-2026-10-13');
    expect(screen.getByTestId('journal-titre')).toHaveTextContent('Mardi 13 octobre 2026');
    await toucher('journal-onglet-recherche');
    await fireEvent.changeText(screen.getByTestId('journal-recherche-champ'), 'zzz introuvable');
    expect(screen.getByTestId('journal-recherche-vide')).toBeTruthy();
  });

  it('réglages : heure réglable (bornée), écriture désactivable, IA désactivée tant qu’aucun rédacteur n’est branché', async () => {
    const b = baseMemoire();
    await monter({ baseProfil: b, maintenant: local(J, 10) });
    await toucher('journal-reglages-ouvrir');
    expect(screen.getByTestId('journal-heure')).toHaveTextContent('21 h');
    await toucher('journal-heure-plus');
    await toucher('journal-heure-plus');
    await toucher('journal-heure-plus');
    expect(screen.getByTestId('journal-heure')).toHaveTextContent('23 h');
    expect(screen.getByTestId('journal-heure-plus').props.accessibilityState.disabled).toBe(true);
    await toucher('journal-heure-moins');
    expect(lireReglages(b)?.heure).toBe(22);
    expect(screen.getByTestId('journal-prochaine')).toHaveTextContent(/ce soir à 22 h/);
    await toucher('journal-actif');
    expect(lireReglages(b)?.actif).toBe(false);
    expect(screen.getByTestId('journal-actif').props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId('journal-ia').props.accessibilityState.disabled).toBe(true);
    expect(lireReglages(b)?.ia).toBe(false);
  });

  it('mode valeurs masquées : les montants disparaissent du texte, les pourcentages restent', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J));
    definirDiscretion(true);
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    const tout = JSON.stringify(screen.toJSON());
    expect(tout).not.toMatch(/1 234,50/);
    expect(tout).toContain('••••');
    expect(tout).toContain('+1,25');
  });

  it('une source en panne : la page l’indique sans rien casser', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J, { sourcesEnEchec: ['Claude Office'] }));
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    expect(screen.getByTestId('journal-echecs')).toHaveTextContent(/Écrite sans : Claude Office/);
  });

  it('export Markdown : fichier proposé à l’enregistrement, contenu de la page (note comprise)', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J, { note: 'Ma note exportée', humeur: 5 }));
    const enregistrerFichier = jest.fn(async () => true);
    await monter({ baseProfil: b, maintenant: local(J, 22), enregistrerFichier });
    await toucher('journal-exporter-md');
    await waitFor(() => expect(enregistrerFichier).toHaveBeenCalled());
    const [nom, contenu, type] = enregistrerFichier.mock.calls[0] as unknown as [string, string, string];
    expect(nom).toBe('journal-2026-10-13.md');
    expect(type).toContain('markdown');
    expect(contenu).toContain('# Mardi 13 octobre 2026');
    expect(contenu).toContain('Ma note exportée');
    await waitFor(() => expect(screen.getByTestId('journal-avis')).toHaveTextContent(/exporté/));
  });

  it('export PDF : ouvre la fenêtre d’impression d’un document échappé', async () => {
    const b = baseMemoire();
    ecrirePage(b, pageRemplie(J, { note: '<b>gras</b>' }));
    const imprimer = jest.spyOn(impression, 'imprimerDocument').mockReturnValue(true);
    await monter({ baseProfil: b, maintenant: local(J, 22) });
    await toucher('journal-exporter-pdf');
    await waitFor(() => expect(imprimer).toHaveBeenCalledTimes(1));
    const html = imprimer.mock.calls[0][0];
    expect(html).toContain('Mardi 13 octobre 2026');
    expect(html).toContain('&lt;b&gt;gras&lt;/b&gt;');
    imprimer.mockRestore();
  });

  it('export d’une période vide : message, pas de fichier', async () => {
    const enregistrerFichier = jest.fn(async () => true);
    await monter({ baseProfil: baseMemoire(), maintenant: local(J, 10), enregistrerFichier });
    await toucher('journal-exporter-md');
    await waitFor(() => expect(screen.getByTestId('journal-avis')).toHaveTextContent(/Rien à exporter/));
    expect(enregistrerFichier).not.toHaveBeenCalled();
  });

  it('une page déposée par une autre app (décision, météo) apparaît le soir venu', async () => {
    const b = baseMemoire({ [CLES_JOURNAL.reglages]: JSON.stringify({ v: 1, actif: true, heure: 21, depuis: J, ia: false }) });
    deposerEvenementJournal(b, { id: 'dec-1', famille: 'decisions', genre: 'decision', jour: J, titre: 'Garder le plan d’épargne' });
    deposerEvenementJournal(b, { id: 'meteo', famille: 'meteo', genre: 'meteo', jour: J, titre: 'Pluie fine, 12 °C' });
    await monter({ baseProfil: b, maintenant: local(J, 21, 30) });
    await waitFor(() => expect(screen.getByTestId('journal-section-decisions')).toHaveTextContent(/Garder le plan d’épargne/));
    expect(screen.getByTestId('journal-texte')).toHaveTextContent(/Pluie fine, 12 °C/);
  });

  it('tuile : état avant/après l’écriture, pages et épinglées', () => {
    const b = baseMemoire();
    expect(infoJournal({ baseProfil: b, maintenant: local(J, 10) })?.sousTitre).toMatch(/chaque soir/);
    b.m.set(CLES_JOURNAL.reglages, JSON.stringify({ v: 1, actif: true, heure: 21, depuis: J, ia: false }));
    expect(infoJournal({ baseProfil: b, maintenant: local(J, 10) })?.sousTitre).toBe('Prochaine page ce soir à 21 h.');
    ecrirePage(b, pageRemplie(J, { epingle: true }));
    const info = infoJournal({ baseProfil: b, maintenant: local(J, 22) })!;
    expect(info.sousTitre).toBe('La page d’aujourd’hui est écrite.');
    expect(info.indicateurs).toEqual([{ libelle: 'Pages', valeur: '1' }, { libelle: 'Épinglées', valeur: '1' }]);
    expect(infoJournal({})).toBeUndefined();
  });
});

describe('Journal : 8 thèmes, bureau et téléphone', () => {
  for (const theme of THEMES_HUB) {
    for (const mode of ['large', 'telephone'] as const) {
      it(`${theme.nom}, ${mode === 'large' ? 'bureau' : 'téléphone'} : la page, les onglets et le calendrier s’affichent`, async () => {
        const b = baseMemoire();
        ecrirePage(b, pageRemplie(J, { humeur: 4 }));
        await monter({ baseProfil: b, maintenant: local(J, 22) }, mode, theme);
        expect(screen.getByTestId('app-journal')).toBeTruthy();
        expect(screen.getByTestId('journal-marquant')).toBeTruthy();
        expect(screen.getByTestId('journal-chiffres')).toBeTruthy();
        await toucher('journal-onglet-calendrier');
        expect(screen.getByTestId('journal-calendrier')).toBeTruthy();
        await toucher('journal-onglet-semaine');
        expect(screen.getByTestId('journal-recap')).toBeTruthy();
      });
    }
  }
});
