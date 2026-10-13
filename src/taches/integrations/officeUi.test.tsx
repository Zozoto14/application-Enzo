/**
 * Lien Tâches ↔ Claude Office, côté écran : « ＋ Créer une tâche » dans le
 * Détail d'un agent et d'un sous-agent (Fondateur, lien activé), absent pour
 * un autre compte ou lien désactivé ; fins lues dans l'activité.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DetailAgent } from '../../claudeOffice/DetailAgent';
import { deduireBureau } from '../../claudeOffice/logiqueBureau';
import type { EntreeHistorique } from '../../claudeOffice/logiqueHistorique';
import { themeHub } from '../../hub/themes';
import type { ContexteHub } from '../../hub/types';
import { changerReglages, donneesVides, ecrireDonnees, lireDonnees, tachesVivantes } from '../modele';
import { CLES_TACHES } from '../partage';
import { actionTacheOffice } from './BoutonTacheOffice';
import { finsDepuisActivite } from './officeHook';

const nuit = themeHub('nuit');
const T0 = Date.parse('2026-10-07T10:00:00Z');
const il = (min: number) => new Date(T0 - min * 60_000).toISOString();
let n = 0;
const ev = (min: number, extra: Partial<EntreeHistorique> = {}): EntreeHistorique => ({ v: 1, id: `f${++n}`, ts: il(min), type: 'demande', appareil: 'PC', appareilId: 'aaaaaaaaaaaa', session: 'sess-a', projet: 'budget', ...extra });
const admin = { stockage: { lire: () => undefined, ecrire: () => undefined }, verifierIdentite: () => undefined, etatCoffre: () => undefined };

function contexte(liens?: { office: boolean }, fondateur = true): { ctx: ContexteHub; m: Map<string, string> } {
  const m = new Map<string, string>();
  if (liens) m.set(CLES_TACHES.donnees, ecrireDonnees(changerReglages(donneesVides(), { liens }, { maintenant: T0, auteur: 'fondateur' })));
  const base = { lire: (k: string) => m.get(k), ecrire: (k: string, v: string) => void m.set(k, v) };
  const ctx: ContexteHub = fondateur ? { profil: { id: 'principal', nom: 'Enzo', admin: true, creeLe: '' }, admin, baseProfil: base, maintenant: T0 } : { profil: { id: 'leaami01', nom: 'Léa', admin: false, creeLe: '', apps: ['taches'] }, baseProfil: base, maintenant: T0 };
  return { ctx, m };
}

describe('Claude Office → Tâches', () => {
  const entrees = [ev(5, { texte: 'Corrige le test de la synchro' }), ev(4, { type: 'outil', outil: 'Edit' })];
  const agent = deduireBureau(entrees, { maintenant: T0 }).agents[0];
  it('« ＋ Créer une tâche » dans le Détail : tâche liée à la session, dans « Claude Office »', async () => {
    const { ctx, m } = contexte();
    await render(<DetailAgent theme={nuit} agent={agent} entrees={entrees} maintenant={T0} onFermer={jest.fn()} actionAgent={actionTacheOffice(ctx, nuit)} />);
    await fireEvent.press(screen.getByTestId('office-tache-creer'));
    expect(screen.getByTestId('office-tache-titre').props.value).toBe('Corrige le test de la synchro');
    await fireEvent.press(screen.getByTestId('office-tache-valider'));
    const d = lireDonnees(m.get(CLES_TACHES.donnees));
    const t = tachesVivantes(d)[0];
    expect(t).toMatchObject({ titre: 'Corrige le test de la synchro', liensOffice: [expect.objectContaining({ session: 'sess-a', projet: 'budget' })] });
    expect(d.projets[t.projetId].auto).toBe('office');
    expect(screen.getByTestId('office-tache-faite')).toHaveTextContent(/créée dans « Claude Office »/);
  });
  it('rien pour l’ami ni si le lien est désactivé', () => {
    expect(actionTacheOffice(contexte(undefined, false).ctx, nuit)).toBeUndefined();
    expect(actionTacheOffice(contexte({ office: false }).ctx, nuit)).toBeUndefined();
    expect(actionTacheOffice(contexte({ office: true }).ctx, nuit)).toBeDefined();
  });
  it('fins lues dans l’activité : agent qui a fini', () => {
    const fini = [...entrees, ev(1, { type: 'fin-reponse' })];
    const fins = finsDepuisActivite(fini, {}, T0 + 20 * 60_000);
    expect(fins.some(x => x.session === 'sess-a' && !x.sousAgent)).toBe(true);
  });
});
