/**
 * Assistant d'écriture (écrans) : barre « Corriger / Traduire » sous un champ, aperçu avec changements surlignés,
 * « Remplacer » / « Insérer en dessous » / « Annuler », « Annuler le remplacement », mention du moteur ; masqué sur
 * les champs confidentiels (note interne d'un ticket), quand le rôle n'est pas permis, sans client ; seul le texte du
 * champ part ; réglages du Fondateur (Administration IA).
 */

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { themeHub } from '../hub/themes';
import { ErreurEsport, type ClientEsport } from './client';
import { definirLangue } from './i18n';
import { ModeAffichageForce } from '../ui/mobile/useMobile';
import { diffMots, estRaccourciCorriger, insererDessous, type EtatEcriture, type ResultatEcriture } from './ecriture/api';
import { FournisseurEcriture, ZoneEcriture } from './ui/ecriture/ZoneEcriture';
import { ReglagesEcriture } from './ui/ecriture/ReglagesEcriture';
import { apiTickets, type DetailTicket } from './tickets/api';
import { VueTicket } from './ui/tickets/TicketsStaff';

const theme = themeHub('nuit');
afterEach(() => definirLangue('fr'));

const ETAT: EtatEcriture = { actif: true, autorise: true, disponible: true, champs: ['tickets.reponse', 'cm.post', 'messagerie'], tailleMax: 6000, modes: ['corriger', 'traduire-en', 'traduire-fr', 'reformuler'] };

type Appel = { chemin: string; methode?: string; corps?: unknown; options?: { delai?: number } };
function fauxClient({ etat = ETAT, reponse, extra }: { etat?: EtatEcriture; reponse?: (corps: { mode: string; texte: string }) => ResultatEcriture | Error; extra?: (chemin: string, methode?: string, corps?: unknown) => unknown } = {}) {
  const appels: Appel[] = [];
  const requete = async (chemin: string, methode?: string, corps?: unknown, options?: { delai?: number }): Promise<unknown> => {
    appels.push({ chemin, methode, corps, options });
    if (chemin === '/ia/ecriture' && !methode) return etat;
    if (chemin === '/ia/ecriture' && methode === 'POST') {
      const c = corps as { mode: string; texte: string };
      const r = reponse ? reponse(c) : { texte: c.texte.replace('salu', 'Salut').replace('tu vien', 'tu viens'), mode: c.mode, moteur: 'claude', fournisseur: null, inchange: false };
      if (r instanceof Error) throw r;
      return r;
    }
    const x = extra?.(chemin, methode, corps);
    if (x !== undefined) return x;
    throw new Error(`inattendu : ${methode ?? 'GET'} ${chemin}`);
  };
  return { client: { requete } as unknown as ClientEsport, appels };
}

function Banc({ client, initial = 'salu, tu vien au scrim ?', confidentiel = false, maxLength }: { client?: ClientEsport; initial?: string; confidentiel?: boolean; maxLength?: number }) {
  const [v, setV] = useState(initial);
  return (
    <FournisseurEcriture client={client}>
      <ZoneEcriture theme={theme} champ="cm.post" valeur={v} onChanger={setV} confidentiel={confidentiel} maxLength={maxLength} testID="ec">
        <></>
      </ZoneEcriture>
      <ValeurLue v={v} />
    </FournisseurEcriture>
  );
}
const ValeurLue = ({ v }: { v: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text testID="valeur">{v}</Text>;
};

test('logique : différences mot à mot, insertion en dessous, raccourci Ctrl/Cmd+Maj+K', () => {
  expect(diffMots('salu tu vien', 'Salut tu viens')).toEqual([
    { genre: 'retrait', texte: 'salu' },
    { genre: 'ajout', texte: 'Salut' },
    { genre: 'egal', texte: ' tu ' },
    { genre: 'retrait', texte: 'vien' },
    { genre: 'ajout', texte: 'viens' },
  ]);
  expect(diffMots('a\nb', 'a\nb')).toEqual([{ genre: 'egal', texte: 'a\nb' }]);
  expect(insererDessous('Bonjour à tous  \n', 'Hello everyone')).toBe('Bonjour à tous\n\nHello everyone');
  expect(insererDessous('', 'Hello')).toBe('Hello');
  expect(estRaccourciCorriger({ key: 'K', ctrlKey: true, shiftKey: true })).toBe(true);
  expect(estRaccourciCorriger({ key: 'k', metaKey: true, shiftKey: true })).toBe(true);
  expect(estRaccourciCorriger({ key: 'k', ctrlKey: true })).toBe(false);
});

test('corriger : seul le texte du champ part (au clic), aperçu surligné, mention du moteur, Remplacer puis Annuler le remplacement', async () => {
  const { client, appels } = fauxClient();
  await render(<Banc client={client} />);
  await screen.findByTestId('ec-corriger');
  // Rien n'est envoyé sans clic.
  expect(appels.filter(a => a.methode === 'POST')).toHaveLength(0);
  await fireEvent.press(screen.getByTestId('ec-corriger'));
  await screen.findByTestId('ec-apercu');
  const post = appels.find(a => a.methode === 'POST')!;
  expect(post.chemin).toBe('/ia/ecriture');
  expect(post.corps).toEqual({ mode: 'corriger', champ: 'cm.post', texte: 'salu, tu vien au scrim ?' });
  expect(post.options?.delai).toBeGreaterThanOrEqual(60_000);
  expect(screen.getAllByTestId('ec-retrait').map(n => n.props.children)).toEqual(['salu,', 'vien']);
  expect(screen.getAllByTestId('ec-ajout').map(n => n.props.children)).toEqual(['Salut,', 'viens']);
  expect(screen.getByTestId('ec-mention')).toHaveTextContent('Texte envoyé à l’IA (Claude) pour correction');
  await fireEvent.press(screen.getByTestId('ec-remplacer'));
  expect(screen.getByTestId('valeur')).toHaveTextContent('Salut, tu viens au scrim ?');
  expect(screen.queryByTestId('ec-apercu')).toBeNull();
  await fireEvent.press(screen.getByTestId('ec-defaire'));
  expect(screen.getByTestId('valeur')).toHaveTextContent('salu, tu vien au scrim ?');
  expect(screen.queryByTestId('ec-defaire')).toBeNull();
});

test('traduire en anglais : aperçu sans surlignage, Insérer en dessous (bilingue), Annuler ferme sans rien changer', async () => {
  const { client, appels } = fauxClient({ reponse: c => ({ texte: 'Hi everyone, scrim tonight!', mode: c.mode as ResultatEcriture['mode'], moteur: 'api2', fournisseur: 'nvidia', inchange: false }) });
  await render(<Banc client={client} initial="Salut à tous, scrim ce soir !" />);
  await fireEvent.press(await screen.findByTestId('ec-traduire-en'));
  await screen.findByTestId('ec-apercu');
  expect((appels.find(a => a.methode === 'POST')!.corps as { mode: string }).mode).toBe('traduire-en');
  expect(screen.queryByTestId('ec-ajout')).toBeNull();
  expect(screen.getByTestId('ec-resultat')).toHaveTextContent('Hi everyone, scrim tonight!');
  expect(screen.getByTestId('ec-mention')).toHaveTextContent('Texte envoyé à l’IA (NVIDIA) pour traduction');
  await fireEvent.press(screen.getByTestId('ec-inserer'));
  expect(screen.getByTestId('valeur').props.children).toBe('Salut à tous, scrim ce soir !\n\nHi everyone, scrim tonight!');
  // « ⋯ » : traduire en français et reformuler.
  await fireEvent.press(screen.getByTestId('ec-plus'));
  expect(screen.getByTestId('ec-traduire-fr')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ec-reformuler'));
  await screen.findByTestId('ec-apercu');
  await fireEvent.press(screen.getByTestId('ec-annuler'));
  expect(screen.queryByTestId('ec-apercu')).toBeNull();
  expect(screen.getByTestId('valeur').props.children).toBe('Salut à tous, scrim ce soir !\n\nHi everyone, scrim tonight!');
});

test('texte déjà correct, erreur claire (plafond), longueur du champ dépassée', async () => {
  const { client } = fauxClient({ reponse: c => (c.texte === 'quota' ? new ErreurEsport('Plafond mensuel de l’IA atteint', 429, 'ecriture-quota') : { texte: c.texte, mode: 'corriger', moteur: 'claude', fournisseur: null, inchange: true }) });
  const vue = await render(<Banc client={client} initial="Tout va bien." />);
  await fireEvent.press(await screen.findByTestId('ec-corriger'));
  expect(await screen.findByTestId('ec-inchange')).toHaveTextContent(/Aucune faute trouvée/);
  expect(screen.queryByTestId('ec-remplacer')).toBeNull();
  await vue.unmount();
  await render(<Banc client={client} initial="quota" />);
  await fireEvent.press(await screen.findByTestId('ec-corriger'));
  expect(await screen.findByTestId('ec-erreur')).toHaveTextContent(/Plafond mensuel/);
  const long = fauxClient({ reponse: () => ({ texte: 'un texte bien plus long que permis', mode: 'corriger', moteur: 'claude', fournisseur: null, inchange: false }) });
  await render(<Banc client={long.client} initial="court" maxLength={10} />);
  const boutons = await screen.findAllByTestId('ec-corriger');
  await fireEvent.press(boutons[boutons.length - 1]);
  const rem = await screen.findAllByTestId('ec-remplacer');
  await fireEvent.press(rem[rem.length - 1]);
  expect((await screen.findAllByTestId('ec-erreur')).some(n => /longueur permise/.test(String(n.props.children)))).toBe(true);
});

test('masqué : champ confidentiel, rôle non permis, assistant désactivé, sans client (rien n’est demandé)', async () => {
  const conf = fauxClient();
  const v1 = await render(<Banc client={conf.client} confidentiel />);
  await waitFor(() => expect(screen.getByTestId('valeur')).toBeTruthy());
  expect(screen.queryByTestId('ec-corriger')).toBeNull();
  expect(conf.appels).toHaveLength(0);
  await v1.unmount();
  for (const etat of [{ ...ETAT, autorise: false }, { ...ETAT, actif: false }, { ...ETAT, champs: ['messagerie'] }]) {
    const f = fauxClient({ etat });
    const v = await render(<Banc client={f.client} />);
    await waitFor(() => expect(f.appels).toHaveLength(1));
    expect(screen.queryByTestId('ec-corriger')).toBeNull();
    await v.unmount();
  }
  await render(<Banc />);
  expect(screen.queryByTestId('ec-corriger')).toBeNull();
});

function detail(): DetailTicket {
  return {
    id: 't1', numero: 1, categorie: { id: 'c', nom: { fr: 'Aide', en: 'Help' }, couleur: '#5865f2', icone: 'membres', actif: true }, statut: 'ouvert', priorite: 'moyen',
    auteur: { discordId: '8001', nom: 'Léa', compte: null }, responsable: null, ouvertLe: '2026-11-04T10:00:00.000Z', derniereActivite: '2026-11-04T10:00:00.000Z', fermeLe: null, note: null, nonLu: false, permanent: false, nonLuDepuis: null,
    salon: { id: '9001', nom: 'ticket-0001', supprime: false }, reponses: [], raison: null, noteCommentaire: null, liaison: { type: 'aucune' }, liaisonCategorie: { type: 'aucune' }, purge: false,
    fermeture: { heures: 168, source: 'general', staffSeul: false, permanentPar: null, permanentLe: null }, membres: [],
    messages: [{ id: 'm1', genre: 'discord', auteur: { nom: 'Léa', discordId: '8001', compte: null }, staff: false, contenu: 'Message SECRET de la conversation', envoi: 'ok', nonPublie: false, le: '2026-11-04T10:01:00.000Z', modifieLe: null, supprimeLe: null, pieces: [] }],
    droits: { repondre: true, gerer: true },
  } as DetailTicket;
}

test('ticket : assistant sur la réponse (seul le texte tapé part, jamais la conversation), masqué en note interne', async () => {
  const { client, appels } = fauxClient({
    etat: { ...ETAT, champs: ['tickets.reponse'] },
    extra: chemin => (chemin === '/tickets/t1' ? detail() : chemin === '/tickets/t1/lu' ? { ok: true } : chemin === '/tickets/t1/assignables' ? { comptes: [] } : undefined),
  });
  await render(
    <ModeAffichageForce mode="large">
      <FournisseurEcriture client={client}>
        <VueTicket theme={theme} client={client} api={apiTickets(client)} id="t1" categories={[]} large />
      </FournisseurEcriture>
    </ModeAffichageForce>,
  );
  await fireEvent.changeText(await screen.findByTestId('esport-tk-message'), 'salu, tu vien ?');
  await fireEvent.press(await screen.findByTestId('esport-tk-ecriture-corriger'));
  await screen.findByTestId('esport-tk-ecriture-apercu');
  const post = appels.find(a => a.chemin === '/ia/ecriture' && a.methode === 'POST')!;
  expect(post.corps).toEqual({ mode: 'corriger', champ: 'tickets.reponse', texte: 'salu, tu vien ?' });
  expect(JSON.stringify(post.corps)).not.toContain('SECRET');
  await fireEvent.press(screen.getByTestId('esport-tk-ecriture-remplacer'));
  expect(screen.getByTestId('esport-tk-message').props.value).toBe('Salut, tu viens ?');
  // Note interne : assistant masqué.
  await fireEvent(screen.getByTestId('esport-tk-mode-note'), 'valueChange', true);
  expect(screen.queryByTestId('esport-tk-ecriture-corriger')).toBeNull();
});

test('réglages du Fondateur : par défaut lui seul (aucun rôle, aucune personne) ; ajouter un rôle, une personne ; désactiver', async () => {
  let reglages = { actif: true, groupes: [] as string[], comptes: [] as string[], groupesPossibles: [] as Array<{ cle: string; libelle: string }> };
  const { client, appels } = fauxClient({
    extra: (chemin, methode, corps) => {
      if (chemin !== '/ia/ecriture/reglages') return undefined;
      if (methode === 'PUT') reglages = { ...reglages, ...(corps as object) };
      return reglages;
    },
  });
  (client as unknown as { annuaire(): Promise<unknown> }).annuaire = async () => ({ comptes: [{ compte: 'principal', pseudo: 'Fondateur' }, { compte: 'max12345', pseudo: 'Max' }] });
  await render(<ReglagesEcriture theme={theme} client={client} />);
  await screen.findByTestId('esport-ecriture-reglages');
  for (const g of ['club', 'cm', 'staff_teams', 'joueurs']) expect(screen.getByTestId(`esport-ecriture-groupe-${g}`).props.accessibilityState.checked).toBe(false);
  expect(screen.getByText(/seul le Fondateur/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('esport-ecriture-groupe-staff_teams'));
  await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && JSON.stringify(a.corps) === JSON.stringify({ groupes: ['staff_teams'] }))).toBe(true));
  await fireEvent.press(await screen.findByTestId('esport-ecriture-ajouter-compte-max12345'));
  await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && JSON.stringify(a.corps) === JSON.stringify({ comptes: ['max12345'] }))).toBe(true));
  expect(await screen.findByTestId('esport-ecriture-compte-max12345-retirer')).toBeTruthy();
  await fireEvent(screen.getByTestId('esport-ecriture-actif'), 'valueChange', false);
  await waitFor(() => expect(appels.some(a => a.methode === 'PUT' && JSON.stringify(a.corps) === JSON.stringify({ actif: false }))).toBe(true));
  expect(screen.queryByTestId('esport-ecriture-groupe-club')).toBeNull();
});

test('anglais : libellés et mention traduits', async () => {
  definirLangue('en');
  const { client } = fauxClient();
  await render(<Banc client={client} />);
  expect(await screen.findByTestId('ec-corriger')).toHaveTextContent(/Correct/);
  await fireEvent.press(screen.getByTestId('ec-corriger'));
  expect(await screen.findByTestId('ec-mention')).toHaveTextContent('Text sent to the AI (Claude) for correction');
});
