import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Profil, RoleProfil } from '../profils/profils';
import { appsAttribuables, appsVisibles, etatTuile } from '../hub/permissions';
import { REGISTRE } from '../hub/registre';
import { themeHub } from '../hub/themes';
import type { ContexteHub } from '../hub/types';
import { ClaudeOffice } from './Racine';
import { APP_CLAUDE_OFFICE, ID_CLAUDE_OFFICE } from './registre';
import { COMMANDE_HOOKS, type EtatClaudeOffice, type PontClaudeOffice } from './pont';

const theme = themeHub('nuit');
const principal: Profil = { id: 'principal', nom: 'Moi', admin: true, creeLe: '' };
const compte = (role?: RoleProfil, apps: string[] = [ID_CLAUDE_OFFICE]): Profil => ({
  id: 'abcdef1234', nom: 'Lucas', admin: false, creeLe: '', apps, actif: true, role,
});
const controle = { onCreerCompte: () => undefined } as unknown as ContexteHub['profils'];
const voit = (profil?: Profil) => appsVisibles(REGISTRE, { profil, profils: controle }).some(app => app.id === ID_CLAUDE_OFFICE);

describe('Claude Office dans le registre', () => {
  it('a sa tuile : nom, icône, description, catégorie Admin, écran racine', () => {
    const app = REGISTRE.find(a => a.id === ID_CLAUDE_OFFICE);
    expect(app).toBe(APP_CLAUDE_OFFICE);
    expect(app).toMatchObject({ nom: 'Claude Office', categorie: 'Admin', adminSeulement: true });
    expect(app?.icone).toBeTruthy();
    expect(app?.description).toMatch(/Claude Code/);
    expect(app?.Racine).toBe(ClaudeOffice);
  });

  it('droits par rang : seul le Fondateur voit la tuile ; un ami jamais, même si la liste est retouchée', () => {
    expect(voit(undefined)).toBe(true);
    expect(voit(principal)).toBe(true);
    expect(voit(compte('fondateur'))).toBe(true);
    expect(voit(compte('administrateur'))).toBe(false);
    expect(voit(compte('gestionnaire'))).toBe(false);
    expect(voit(compte('ami'))).toBe(false);
    expect(voit(compte(undefined))).toBe(false);
    // Jamais proposée dans les autorisations d'un ami.
    expect(appsAttribuables(REGISTRE).map(a => a.id)).not.toContain(ID_CLAUDE_OFFICE);
    expect(etatTuile(APP_CLAUDE_OFFICE, { profil: compte('ami') }).niveau).toBe('aucun');
  });
});

const ETAT: EtatClaudeOffice = {
  url: 'http://127.0.0.1:3334',
  dossier: 'D:/AppDashboard/Claude Office',
  hooks: 'absents',
  serveur: { joignable: true, agents: 2, clients: 1 },
};

function fauxPont(): jest.Mocked<PontClaudeOffice> {
  return {
    etat: jest.fn(async () => ETAT),
    choisirDossier: jest.fn(async () => ({ ok: false })),
    reglerUrl: jest.fn(async (url: string) => ({ ok: true, url })),
    apercuHooks: jest.fn(async () => ({
      ok: true,
      plan: { fichier: '~/.claude/settings.json', existe: true, commande: 'node x', change: true, ajouts: ['PreToolUse'], retraits: [], description: '  + PreToolUse : ajoute' },
    })),
    installerHooks: jest.fn(async () => ({ ok: true, ecrit: true, sauvegarde: 'settings.json.bak' })),
    ouvrir: jest.fn(async () => true),
  };
}

const globalPont = globalThis as { applibourse?: unknown };

describe('écran Claude Office', () => {
  afterEach(() => {
    delete globalPont.applibourse;
  });

  it('sur le site ou le téléphone : seulement la commande à lancer sur le PC, aucun bouton d’installation', async () => {
    await render(<ClaudeOffice contexte={{}} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
    expect(screen.getByTestId('claude-office-commande-site').props.children).toBe(COMMANDE_HOOKS);
    expect(screen.queryByTestId('claude-office-installer')).toBeNull();
    expect(screen.queryByTestId('claude-office-ouvrir')).toBeNull();
  });

  it('sur le PC : état du serveur, aperçu, puis installation seulement au clic', async () => {
    const pont = fauxPont();
    globalPont.applibourse = { bureau: true, claudeOffice: pont };
    await render(<ClaudeOffice contexte={{}} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
    await act(async () => undefined);
    expect(screen.getByTestId('claude-office-etat').props.children).toContain('2 agents actifs');
    expect(screen.getByTestId('claude-office-dossier').props.children).toBe(ETAT.dossier);
    // Rien d'installé à l'ouverture.
    expect(pont.installerHooks).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('claude-office-apercu'));
    expect(pont.apercuHooks).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('claude-office-plan').props.children).toContain('PreToolUse');
    expect(pont.installerHooks).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('claude-office-installer'));
    expect(pont.installerHooks).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('claude-office-message').props.children).toContain('Sauvegarde');
    await fireEvent.press(screen.getByTestId('claude-office-ouvrir'));
    expect(pont.ouvrir).toHaveBeenCalledTimes(1);
  });

  it('serveur arrêté : « Ouvrir » désactivé, l’état le dit', async () => {
    const pont = fauxPont();
    pont.etat.mockResolvedValue({ ...ETAT, serveur: { joignable: false }, hooks: 'installes' });
    globalPont.applibourse = { bureau: true, claudeOffice: pont };
    await render(<ClaudeOffice contexte={{}} theme={theme} registre={REGISTRE} onRetour={jest.fn()} />);
    await act(async () => undefined);
    expect(screen.getByTestId('claude-office-etat').props.children).toContain('injoignable');
    expect(screen.getByTestId('claude-office-ouvrir').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId('claude-office-hooks-etat').props.children).toMatch(/Installés/);
  });
});
