/**
 * Tickets dans l'app (docs/esport/tickets.md) : liste filtrée (catégorie, statut, priorité, responsable, dates,
 * recherche) avec les non lus, vue d'un ticket (conversation en direct, réponse depuis l'app — le bot poste « Staff ·
 * pseudo : … » —, pièces jointes de l'appareil ou du Drive, notes internes jamais envoyées sur Discord, actions,
 * transcript, liaisons), statistiques et préférences de MP. Le serveur décide de tout ; l'écran n'affiche que ce que la
 * réponse permet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import { ErreurEsport, type ClientEsport } from '../../client';
import { formaterDate, langueCourante } from '../../i18n';
import { trTk, type CleTk } from '../../i18n/tickets';
import { PRIORITES, apiTickets, type ApiTickets, type CategorieCourte, type DetailTicket, type FiltresTickets, type MessageTicket, type PieceEnvoyee, type Priorite, type ResumeTicket, type StatsTickets, type Statut } from '../../tickets/api';
import { texteDelai } from '../../tickets/fermeture';
import { couleurUrgence } from '../../cm/urgence';
import { choisirFichier, choixFichierDisponible } from '../../medias/choixFichier';
import { useTempsReel } from '../../tempsReel/hooks';
import { Glyphe } from '../../../ui/icones';
import { BoutonConfirme, Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ChiffreCle, ESP, EtatVide, Grille, Pliable, Squelette, Volet, attenue, texte } from '../design';
import { ChoixDrive } from '../cm/drive/ChoixDrive';
import { ouvrirLienDiffere } from '../ouvrirLien';

const nomCat = (c: { nom: { fr: string; en: string } }) => (langueCourante() === 'en' ? c.nom.en || c.nom.fr : c.nom.fr || c.nom.en);
const quand = (iso: string | null | undefined) => (iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const nomStatut = (s: Statut) => trTk(`statut.${s}` as CleTk);
const nomPriorite = (p: Priorite) => trTk(`priorite.${p}` as CleTk);
const TONS_STATUT: Record<Statut, 'accent' | 'ok' | 'alerte' | 'neutre'> = { ouvert: 'accent', pris_en_charge: 'ok', en_attente: 'alerte', resolu: 'ok', ferme: 'neutre' };

/** Message d'erreur : le code `ticket-<raison>` du serveur a son texte traduit, sinon le message du serveur. */
const messageErreur = (e: unknown): string => {
  if (e instanceof ErreurEsport && typeof e.code === 'string' && e.code.startsWith('ticket-')) {
    const cle = `erreur.${e.code.slice(7)}` as CleTk;
    const t = trTk(cle);
    if (t !== cle) return t;
  }
  return e instanceof Error ? e.message : String(e);
};

function duree(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 120) return trTk('duree.min', { n: min });
  const h = Math.round(min / 60);
  return h < 48 ? trTk('duree.h', { n: h }) : trTk('duree.j', { n: Math.round(h / 24) });
}

/** Encodage base64 d'octets (par tranches : jamais de pile trop profonde). */
function enBase64(octets: Uint8Array): string {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return (globalThis as unknown as { btoa(v: string): string }).btoa(s);
}

/** Fermeture automatique d'un ticket ouvert : jamais (ticket permanent, catégorie, général) ou après quel délai. */
function texteFermeture(f: DetailTicket['fermeture']): string {
  if (f.source === 'ticket') return trTk('vue.permanent_aide');
  const de = f.source === 'categorie' ? 'categorie' : 'general';
  return f.heures ? trTk(`vue.fermeture_delai_${de}` as CleTk, { delai: texteDelai(f.heures) }) : trTk(`vue.fermeture_jamais_${de}` as CleTk);
}

function PastillePriorite({ theme, priorite }: { theme: ThemeHub; priorite: Priorite }) {
  return <Badge theme={theme} couleur={couleurUrgence(priorite, Boolean(theme.sombre))} texte={nomPriorite(priorite)} testID={`esport-tk-priorite-${priorite}`} />;
}

// ------------------------------------------------------------------ Liste

export function ListeTickets({ theme, client, large, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [f, setF] = useState<FiltresTickets>({ statut: 'ouverts' });
  const [q, setQ] = useState('');
  const [donnees, setDonnees] = useState<{ tickets: ResumeTicket[]; categories: CategorieCourte[] } | undefined>();
  const [ouvert, setOuvert] = useState<string | undefined>();
  const [version, setVersion] = useState(0);
  const { erreur, agir } = useAgir();
  const relire = useCallback(() => setVersion(v => v + 1), []);
  useTempsReel(client, 'tickets', relire);
  useEffect(() => {
    let vivant = true;
    void agir('liste', async () => {
      const r = await api.liste({ ...f, q: q.trim() || undefined });
      if (vivant) setDonnees(r);
    });
    return () => {
      vivant = false;
    };
  }, [api, f, q, version, agir]);
  const statuts: Array<{ id: string; nom: string }> = [{ id: 'ouverts', nom: trTk('f.ouverts') }, ...(['ouvert', 'pris_en_charge', 'en_attente', 'resolu', 'ferme'] as Statut[]).map(s => ({ id: s, nom: nomStatut(s) })), { id: 'tous', nom: trTk('f.tous') }];
  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-liste">
      <Preferences theme={theme} api={api} />
      <Champ theme={theme} libelle={trTk('liste.recherche')} valeur={q} onChanger={setQ} maxLength={80} testID="esport-tk-recherche" />
      <Choix theme={theme} libelle={trTk('f.statut')} valeur={f.statut ?? 'ouverts'} options={statuts} onChoisir={statut => setF({ ...f, statut })} testID="esport-tk-f-statut" />
      <Pliable theme={theme} titre={trTk('liste.plus_filtres')} testID="esport-tk-filtres">
        <Choix theme={theme} libelle={trTk('f.categorie')} valeur={f.categorie ?? ''} options={[{ id: '', nom: trTk('f.toutes') }, ...(donnees?.categories ?? []).map(c => ({ id: c.id, nom: nomCat(c), couleur: c.couleur }))]} onChoisir={categorie => setF({ ...f, categorie: categorie || undefined })} testID="esport-tk-f-categorie" />
        <Choix theme={theme} libelle={trTk('f.priorite')} valeur={f.priorite ?? ''} options={[{ id: '', nom: trTk('f.toutes') }, ...PRIORITES.map(p => ({ id: p, nom: nomPriorite(p) }))]} onChoisir={priorite => setF({ ...f, priorite: priorite || undefined })} testID="esport-tk-f-priorite" />
        <Choix theme={theme} libelle={trTk('f.responsable')} valeur={f.responsable ?? ''} options={[{ id: '', nom: trTk('f.tous') }, { id: 'moi', nom: trTk('f.moi') }, { id: 'personne', nom: trTk('f.personne') }]} onChoisir={responsable => setF({ ...f, responsable: responsable || undefined })} testID="esport-tk-f-responsable" />
        <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trTk('f.du')} valeur={f.du ?? ''} onChanger={du => setF({ ...f, du: /^\d{4}-\d{2}-\d{2}$/.test(du) ? du : undefined })} maxLength={10} testID="esport-tk-f-du" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
          <Champ theme={theme} libelle={trTk('f.au')} valeur={f.au ?? ''} onChanger={au => setF({ ...f, au: /^\d{4}-\d{2}-\d{2}$/.test(au) ? au : undefined })} maxLength={10} testID="esport-tk-f-au" style={{ flexGrow: 1, flexBasis: 160, minWidth: 0 }} />
        </View>
      </Pliable>
      <Retours theme={theme} erreur={erreur} prefixe="esport-tk-liste" />
      {!donnees ? <Squelette theme={theme} lignes={4} /> : null}
      {donnees && !donnees.tickets.length ? <EtatVide theme={theme} glyphe="billets" titre={trTk('liste.vide')} /> : null}
      <View style={{ gap: ESP.xs }}>
        {(donnees?.tickets ?? []).map(tk => (
          <LigneTicket key={tk.id} theme={theme} tk={tk} onPress={() => setOuvert(tk.id)} />
        ))}
      </View>
      {ouvert ? (
        <Volet theme={theme} visible titre={trTk('vue.titre', { numero: donnees?.tickets.find(x => x.id === ouvert)?.numero ?? '' })} onFermer={() => (setOuvert(undefined), relire())} largeur={large ? 820 : 560} testID="esport-tk-volet">
          <VueTicket theme={theme} client={client} api={api} id={ouvert} onChange={relire} onExporter={onExporter} categories={donnees?.categories ?? []} />
        </Volet>
      ) : null}
    </View>
  );
}

function LigneTicket({ theme, tk, onPress }: { theme: ThemeHub; tk: ResumeTicket; onPress(): void }) {
  return (
    <Pressable
      testID={`esport-tk-ticket-${tk.numero}`}
      accessibilityRole="button"
      accessibilityLabel={`${trTk('vue.titre', { numero: tk.numero })} · ${nomCat(tk.categorie)} · ${nomStatut(tk.statut)}${tk.nonLu ? ` · ${trTk('non_lu')}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: theme.ligne, borderLeftWidth: 4, borderLeftColor: tk.categorie.couleur, borderRadius: 10, padding: ESP.s, gap: ESP.xxs, backgroundColor: pressed ? teinteTransparente(theme.attenue, 0.08) : theme.surface })}
    >
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flex: 1, minWidth: 0 }}>
          {tk.nonLu ? <View testID={`esport-tk-ticket-${tk.numero}-non-lu`} accessibilityLabel={trTk('non_lu')} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D' }} /> : null}
          <Glyphe valeur={tk.categorie.icone} taille={14} couleur={theme.attenue} />
          <Text style={{ ...texte(theme), fontWeight: tk.nonLu ? '800' : '600', flexShrink: 1 }} numberOfLines={1}>
            {trTk('numero', { numero: tk.numero })} · {tk.auteur.nom || tk.auteur.discordId}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: ESP.xxs, alignItems: 'center' }}>
          {tk.permanent ? <Badge theme={theme} ton="accent" icone="epingle" texte={trTk('vue.permanent')} testID={`esport-tk-ticket-${tk.numero}-permanent`} /> : null}
          <Badge theme={theme} ton={TONS_STATUT[tk.statut]} texte={nomStatut(tk.statut)} />
        </View>
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Text style={attenue(theme)} numberOfLines={1}>
          {nomCat(tk.categorie)}
        </Text>
        <PastillePriorite theme={theme} priorite={tk.priorite} />
        <Text style={{ ...attenue(theme), flexShrink: 1 }} numberOfLines={1}>
          {tk.responsable ? trTk('pris_par', { nom: tk.responsable.nom }) : trTk('personne')} · {trTk('activite', { quand: quand(tk.derniereActivite) })}
        </Text>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Vue d'un ticket

export function VueTicket({ theme, client, api, id, onChange, onExporter, categories }: { theme: ThemeHub; client: ClientEsport; api: ApiTickets; id: string; onChange?(): void; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>; categories: CategorieCourte[] }) {
  const [d, setD] = useState<DetailTicket | undefined>();
  const [texteMsg, setTexteMsg] = useState('');
  const [note, setNote] = useState(false);
  const [pieces, setPieces] = useState<PieceEnvoyee[]>([]);
  const [drive, setDrive] = useState<Array<{ id: string; nom: string }>>([]);
  const [choixDrive, setChoixDrive] = useState(false);
  const [raison, setRaison] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [assignables, setAssignables] = useState<Array<{ compte: string; pseudo: string | null }>>([]);
  const { erreur, avis, agir: agirBrut, enCours, setErreur } = useAgir();
  const agir = useCallback(
    (libelle: string, action: () => Promise<string | void>) =>
      agirBrut(libelle, async () => {
        try {
          return await action();
        } catch (e) {
          throw new Error(messageErreur(e));
        }
      }),
    [agirBrut],
  );
  const relire = useCallback(async () => {
    const r = await api.detail(id);
    setD(r);
    await api.lu(id).catch(() => undefined);
  }, [api, id]);
  useEffect(() => {
    void agir('detail', relire);
  }, [agir, relire]);
  useTempsReel(client, 'tickets', () => void relire().catch(() => undefined));
  useEffect(() => {
    if (!d?.droits.gerer) return;
    api
      .assignables(id)
      .then(r => setAssignables(r.comptes))
      .catch(() => setAssignables([]));
  }, [api, id, d?.droits.gerer]);
  if (!d) return <Squelette theme={theme} lignes={5} testID="esport-tk-vue-chargement" />;
  const ouvert = d.statut !== 'ferme';
  const faire = (nom: string, corps: Record<string, unknown> = {}) =>
    void agir(nom, async () => {
      setD(await api.action(id, nom, corps));
      onChange?.();
    });
  const joindre = () =>
    void agir('joindre', async () => {
      const f = await choisirFichier('image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,video/mp4,application/zip', 'esport-tk-fichier');
      if (!f) return;
      if (f.taille > 5 * 1024 * 1024) throw new Error(trTk('erreur.trop_gros'));
      setPieces([...pieces, { nom: f.nom, type: f.type || 'application/octet-stream', base64: enBase64(await f.lire(0, f.taille)) }]);
    });
  const envoyer = () =>
    void agir('envoyer', async () => {
      setD(note ? await api.noter(id, texteMsg) : await api.repondre(id, { texte: texteMsg, pieces, drive: drive.map(x => x.id) }));
      setTexteMsg('');
      setPieces([]);
      setDrive([]);
      setErreur(undefined);
      onChange?.();
    });
  const lier = (type: 'sponsors' | 'cm' | 'fiche' | 'aucune') =>
    void agir('lier', async () => {
      setD(await api.lier(id, { type }));
    });
  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-vue">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-tk-vue" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Badge theme={theme} ton={TONS_STATUT[d.statut]} texte={nomStatut(d.statut)} testID="esport-tk-vue-statut" />
        <PastillePriorite theme={theme} priorite={d.priorite} />
        <Badge theme={theme} couleur={d.categorie.couleur} texte={nomCat(d.categorie)} />
        {d.note ? <Badge theme={theme} ton="accent" texte={trTk('vue.note', { note: d.note })} /> : null}
        {d.permanent ? <Badge theme={theme} ton="accent" icone="epingle" texte={trTk('vue.permanent')} testID="esport-tk-vue-permanent" /> : null}
      </View>
      <Text style={texte(theme)}>{trTk('vue.auteur', { nom: d.auteur.nom || d.auteur.discordId })}</Text>
      {d.salon ? <Text style={attenue(theme)}>{d.salon.supprime ? trTk('vue.salon_supprime') : trTk('vue.salon', { nom: d.salon.nom })}</Text> : null}
      <Text style={attenue(theme)}>{d.responsable ? trTk('pris_par', { nom: d.responsable.nom }) : trTk('personne')}</Text>
      {d.raison ? <Text style={attenue(theme)}>{trTk('vue.raison_fermeture', { raison: d.raison === 'inactivite' ? '—' : d.raison })}</Text> : null}
      {d.noteCommentaire ? <Text style={{ ...texte(theme), fontStyle: 'italic' }}>{d.noteCommentaire}</Text> : null}
      {ouvert ? (
        <Text style={attenue(theme)} testID="esport-tk-vue-fermeture">
          {texteFermeture(d.fermeture)}
        </Text>
      ) : null}
      {d.permanent && d.fermeture.permanentPar && d.fermeture.permanentLe ? <Text style={attenue(theme)}>{trTk('vue.permanent_par', { nom: d.fermeture.permanentPar, quand: quand(d.fermeture.permanentLe) })}</Text> : null}
      {d.fermeture.staffSeul ? <Text style={attenue(theme)}>{trTk('vue.staff_seul')}</Text> : null}
      {d.droits.gerer ? (
        <View style={[styles.ligne, { justifyContent: 'space-between' }]} testID="esport-tk-vue-permanent-bloc">
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('vue.permanent_interrupteur')}</Text>
          <Interrupteur theme={theme} libelle={trTk('vue.permanent_interrupteur')} valeur={d.permanent} onChanger={permanent => faire('permanent', { permanent })} testID="esport-tk-permanent" />
        </View>
      ) : null}

      {d.droits.repondre ? (
        <View style={styles.ligne} testID="esport-tk-vue-actions">
          {ouvert && !d.responsable?.moi ? <BoutonHub theme={theme} titre={trTk('vue.prendre')} onPress={() => faire('prendre')} testID="esport-tk-prendre" /> : null}
          {ouvert && d.responsable ? <BoutonHub theme={theme} titre={trTk('vue.liberer')} onPress={() => faire('liberer')} testID="esport-tk-liberer" /> : null}
          {ouvert && d.statut !== 'en_attente' ? <BoutonHub theme={theme} titre={trTk('vue.attente')} onPress={() => faire('attente')} testID="esport-tk-attente" /> : null}
          {ouvert && d.statut !== 'resolu' ? <BoutonHub theme={theme} titre={trTk('vue.resolu')} onPress={() => faire('statut', { statut: 'resolu' })} testID="esport-tk-resolu" /> : null}
          {!ouvert && !d.purge ? <BoutonHub theme={theme} titre={trTk('vue.rouvrir')} onPress={() => faire('rouvrir')} testID="esport-tk-rouvrir" /> : null}
          {d.droits.gerer && onExporter ? <BoutonHub theme={theme} titre={trTk('vue.transcript')} onPress={() => void agir('transcript', async () => {
                const tr = await api.transcript(id);
                await onExporter(tr.nom, tr.contenu, tr.type);
              })} testID="esport-tk-transcript" /> : null}
        </View>
      ) : (
        <Text style={attenue(theme)}>{trTk('vue.lecture_seule')}</Text>
      )}
      {d.droits.repondre && ouvert ? <Choix theme={theme} libelle={trTk('vue.priorite')} valeur={d.priorite} options={PRIORITES.map(p => ({ id: p, nom: nomPriorite(p) }))} onChoisir={priorite => faire('priorite', { priorite })} testID="esport-tk-vue-priorite" /> : null}
      {d.droits.gerer && ouvert && assignables.length ? <Choix theme={theme} libelle={trTk('vue.assigner')} valeur={d.responsable?.compte ?? undefined} options={assignables.map(a => ({ id: a.compte, nom: a.pseudo ?? a.compte }))} onChoisir={compte => faire('assigner', { compte })} testID="esport-tk-vue-assigner" /> : null}
      {d.droits.gerer && ouvert ? <Choix theme={theme} libelle={trTk('vue.categorie')} valeur={d.categorie.id} options={categories.filter(c => c.actif).map(c => ({ id: c.id, nom: nomCat(c), couleur: c.couleur }))} onChoisir={categorie => faire('categorie', { categorie })} testID="esport-tk-vue-categorie" /> : null}

      {d.reponses.length ? (
        <Panneau theme={theme} testID="esport-tk-vue-formulaire">
          <Intertitre theme={theme}>{trTk('vue.formulaire')}</Intertitre>
          {d.reponses.map(r => (
            <View key={r.id} style={{ gap: 2 }}>
              <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{langueCourante() === 'en' ? r.libelle?.en || r.libelle?.fr : r.libelle?.fr || r.libelle?.en}</Text>
              <Text style={texte(theme)}>{r.valeur || '—'}</Text>
            </View>
          ))}
        </Panneau>
      ) : null}

      <Intertitre theme={theme}>{trTk('vue.conversation')}</Intertitre>
      {d.purge ? <Text style={attenue(theme)}>{trTk('vue.purge')}</Text> : null}
      {!d.messages.length && !d.purge ? <Text style={attenue(theme)}>{trTk('vue.vide')}</Text> : null}
      <View style={{ gap: ESP.xs }} testID="esport-tk-vue-messages">
        {d.messages.map(m => (
          <Bulle key={m.id} theme={theme} m={m} api={api} ticketId={id} />
        ))}
      </View>

      {d.droits.repondre && ouvert ? (
        <Panneau theme={theme} testID="esport-tk-vue-reponse">
          <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('vue.mode_note')}</Text>
            <Interrupteur theme={theme} libelle={trTk('vue.mode_note')} valeur={note} onChanger={setNote} testID="esport-tk-mode-note" />
          </View>
          {!note ? <Text style={attenue(theme)}>{trTk('vue.repondre_aide', { pseudo: '…' })}</Text> : <Text style={attenue(theme)}>{trTk('vue.note_interne_aide')}</Text>}
          <Champ theme={theme} libelle={trTk('vue.message')} valeur={texteMsg} onChanger={setTexteMsg} multiligne maxLength={note ? 4000 : 1800} testID="esport-tk-message" />
          {!note ? (
            <View style={styles.ligne}>
              {choixFichierDisponible ? <BoutonHub theme={theme} titre={trTk('vue.joindre')} icone="trombone" onPress={joindre} desactive={pieces.length + drive.length >= 3} testID="esport-tk-joindre" /> : null}
              <BoutonHub theme={theme} titre={trTk('vue.joindre_drive')} icone="dossier" onPress={() => setChoixDrive(true)} desactive={pieces.length + drive.length >= 3} testID="esport-tk-joindre-drive" />
            </View>
          ) : null}
          {[...pieces.map((p, i) => ({ cle: `p${i}`, nom: p.nom, retirer: () => setPieces(pieces.filter((_, j) => j !== i)) })), ...drive.map((x, i) => ({ cle: `d${i}`, nom: x.nom, retirer: () => setDrive(drive.filter((_, j) => j !== i)) }))].map(p => (
            <View key={p.cle} style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={1}>
                {p.nom}
              </Text>
              <BoutonHub theme={theme} titre={trTk('vue.retirer_piece')} onPress={p.retirer} testID={`esport-tk-piece-${p.cle}-retirer`} />
            </View>
          ))}
          <ChoixDrive theme={theme} client={client} visible={choixDrive} accepter={f => f.taille <= 5 * 1024 * 1024} onChoisir={f => (setDrive([...drive, { id: f.id, nom: f.nom }]), setChoixDrive(false))} onFermer={() => setChoixDrive(false)} testID="esport-tk-drive" />
          <BoutonHub theme={theme} variante="plein" titre={note ? trTk('vue.enregistrer_note') : trTk('vue.envoyer')} onPress={envoyer} desactive={Boolean(enCours) || (!texteMsg.trim() && !pieces.length && !drive.length)} testID="esport-tk-envoyer" />
        </Panneau>
      ) : d.droits.repondre ? (
        <Text style={attenue(theme)}>{trTk('vue.ferme_aide')}</Text>
      ) : null}

      {d.droits.repondre && ouvert ? (
        <Pliable theme={theme} titre={trTk('vue.fermer')} testID="esport-tk-vue-fermer">
          <Champ theme={theme} libelle={trTk('vue.raison')} valeur={raison} onChanger={setRaison} maxLength={300} testID="esport-tk-raison" />
          <BoutonConfirme theme={theme} titre={trTk('vue.fermer')} confirmation={trTk('vue.confirmer_fermer')} onConfirme={() => faire('fermer', { raison })} testID="esport-tk-fermer" />
        </Pliable>
      ) : null}

      {d.droits.gerer ? (
        <Pliable theme={theme} titre={trTk('vue.membres')} testID="esport-tk-vue-membres">
          {!d.membres.length ? <Text style={attenue(theme)}>{trTk('vue.aucun_membre')}</Text> : null}
          {d.membres.map(m => (
            <View key={m.discordId} style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }} numberOfLines={1}>
                {m.nom || m.discordId}
              </Text>
              {ouvert ? <BoutonHub theme={theme} titre={trTk('vue.retirer')} onPress={() => faire('retirer', { discordId: m.discordId })} testID={`esport-tk-membre-${m.discordId}-retirer`} /> : null}
            </View>
          ))}
          {ouvert ? (
            <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
              <Champ theme={theme} libelle={trTk('vue.discord_id')} valeur={discordId} onChanger={v => setDiscordId(v.replace(/\D/g, ''))} clavier="number-pad" maxLength={20} testID="esport-tk-membre-id" style={{ flexGrow: 1, flexBasis: 180, minWidth: 0 }} />
              <BoutonHub theme={theme} titre={trTk('vue.ajouter_membre')} onPress={() => (faire('ajouter', { discordId }), setDiscordId(''))} desactive={discordId.length < 17} testID="esport-tk-membre-ajouter" />
            </View>
          ) : null}
        </Pliable>
      ) : null}

      {d.droits.repondre ? (
        <View style={{ gap: ESP.xs }} testID="esport-tk-vue-liaison">
          <Intertitre theme={theme}>{trTk('vue.liaison')}</Intertitre>
          {d.liaison.type !== 'aucune' ? (
            <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
              <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('vue.lie_a', { titre: d.liaison.titre ?? d.liaison.id ?? '' })}</Text>
              <BoutonHub theme={theme} titre={trTk('vue.delier')} onPress={() => lier('aucune')} testID="esport-tk-delier" />
            </View>
          ) : (
            <View style={styles.ligne}>
              {d.liaisonCategorie.type === 'sponsors' ? <BoutonHub theme={theme} titre={trTk('vue.lier_sponsors')} onPress={() => lier('sponsors')} testID="esport-tk-lier-sponsors" /> : null}
              {d.liaisonCategorie.type === 'cm' ? <BoutonHub theme={theme} titre={trTk('vue.lier_cm')} onPress={() => lier('cm')} testID="esport-tk-lier-cm" /> : null}
              {d.auteur.compte ? <BoutonHub theme={theme} titre={trTk('vue.lier_fiche')} onPress={() => lier('fiche')} testID="esport-tk-lier-fiche" /> : null}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Bulle({ theme, m, api, ticketId }: { theme: ThemeHub; m: MessageTicket; api: ApiTickets; ticketId: string }) {
  const couleur = m.genre === 'note' ? '#E8A23A' : m.genre === 'systeme' ? theme.attenue : m.staff ? theme.accent : theme.ligne;
  return (
    <View testID={`esport-tk-msg-${m.id}`} style={{ borderLeftWidth: 3, borderLeftColor: couleur, paddingLeft: ESP.s, paddingVertical: ESP.xxs, gap: 2, backgroundColor: m.genre === 'note' ? teinteTransparente('#E8A23A', 0.1) : 'transparent', borderRadius: 4 }}>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Text style={{ ...texte(theme, 13), fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
          {m.auteur.nom || '—'}
        </Text>
        {m.genre === 'note' ? <Badge theme={theme} ton="alerte" texte={trTk('vue.note_interne')} testID={`esport-tk-msg-${m.id}-note`} /> : null}
        {m.genre === 'systeme' ? <Badge theme={theme} texte={trTk('vue.bot')} /> : null}
        {m.genre === 'app' ? <Badge theme={theme} ton="accent" texte={trTk('vue.app')} /> : null}
        <Text style={attenue(theme, 12)}>
          {quand(m.le)}
          {m.modifieLe ? ` · ${trTk('vue.modifie')}` : ''}
          {m.supprimeLe ? ` · ${trTk('vue.supprime_discord')}` : ''}
          {m.envoi === 'echec' ? ` · ${trTk('vue.echec_envoi')}` : ''}
        </Text>
      </View>
      {m.contenu ? <Text style={{ ...texte(theme), opacity: m.supprimeLe ? 0.6 : 1 }} selectable>{m.contenu}</Text> : null}
      {m.pieces.map(p =>
        p.copiee ? (
          <BoutonHub key={p.id} theme={theme} titre={trTk('vue.piece_ouvrir', { nom: p.nom })} icone="trombone" onPress={() => void ouvrirLienDiffere(async () => (await api.lienPiece(ticketId, p.id)).url)} testID={`esport-tk-piece-${p.id}`} />
        ) : (
          <Text key={p.id} style={attenue(theme)} selectable>
            {trTk('vue.piece_lien', { nom: p.nom })}
          </Text>
        ),
      )}
    </View>
  );
}

// ------------------------------------------------------------------ Préférences

function Preferences({ theme, api }: { theme: ThemeHub; api: ApiTickets }) {
  const [p, setP] = useState<{ mpNouveau: boolean; mpMessage: boolean } | undefined>();
  useEffect(() => {
    api
      .preferences()
      .then(setP)
      .catch(() => undefined);
  }, [api]);
  if (!p) return null;
  const changer = (v: { mpNouveau: boolean; mpMessage: boolean }) => {
    setP(v);
    api.changerPreferences(v).catch(() => undefined);
  };
  return (
    <Pliable theme={theme} titre={trTk('pref.titre')} testID="esport-tk-prefs">
      <Text style={attenue(theme)}>{trTk('pref.aide')}</Text>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('pref.mp_nouveau')}</Text>
        <Interrupteur theme={theme} libelle={trTk('pref.mp_nouveau')} valeur={p.mpNouveau} onChanger={mpNouveau => changer({ ...p, mpNouveau })} testID="esport-tk-pref-nouveau" />
      </View>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('pref.mp_message')}</Text>
        <Interrupteur theme={theme} libelle={trTk('pref.mp_message')} valeur={p.mpMessage} onChanger={mpMessage => changer({ ...p, mpMessage })} testID="esport-tk-pref-message" />
      </View>
    </Pliable>
  );
}

// ------------------------------------------------------------------ Statistiques

export function StatsTicketsPage({ theme, client }: { theme: ThemeHub; client: ClientEsport }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [s, setS] = useState<StatsTickets | undefined>();
  const { erreur, agir } = useAgir();
  useEffect(() => {
    void agir('stats', async () => setS(await api.stats()));
  }, [api, agir]);
  if (!s) return <View>{erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-tk-stats" /> : <Squelette theme={theme} lignes={4} />}</View>;
  const ligne = (b: StatsTickets['total'] | StatsTickets['parCategorie'][number] | StatsTickets['parResponsable'][number]) =>
    `${trTk('stats.crees')} ${b.crees} · ${trTk('stats.fermes')} ${b.fermes} · ${trTk('stats.premiere')} ${duree(b.premiereReponseMs)} · ${trTk('stats.resolution')} ${duree(b.resolutionMs)} · ${trTk('stats.satisfaction')} ${b.satisfaction === null ? '—' : `${b.satisfaction.toFixed(1)}/5`} (${trTk('stats.notes', { n: b.notes })})`;
  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-stats">
      <Text style={attenue(theme)}>{trTk('stats.periode', { du: s.du, au: s.au })}</Text>
      <Grille min={150}>
        <ChiffreCle theme={theme} libelle={trTk('stats.ouverts')} valeur={String(s.total.ouverts)} testID="esport-tk-stats-ouverts" />
        <ChiffreCle theme={theme} libelle={trTk('stats.crees')} valeur={String(s.total.crees)} />
        <ChiffreCle theme={theme} libelle={trTk('stats.premiere')} valeur={duree(s.total.premiereReponseMs)} />
        <ChiffreCle theme={theme} libelle={trTk('stats.resolution')} valeur={duree(s.total.resolutionMs)} />
        <ChiffreCle theme={theme} libelle={trTk('stats.satisfaction')} valeur={s.total.satisfaction === null ? '—' : `${s.total.satisfaction.toFixed(1)}/5`} detail={trTk('stats.notes', { n: s.total.notes })} />
      </Grille>
      <Intertitre theme={theme}>{trTk('stats.par_categorie')}</Intertitre>
      {!s.parCategorie.length ? <Text style={attenue(theme)}>{trTk('stats.vide')}</Text> : null}
      {s.parCategorie.map(c => (
        <View key={c.categorie.id} style={{ gap: 2 }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>
            {nomCat(c.categorie)} · {trTk('stats.ouverts')} {c.ouverts}
          </Text>
          <Text style={attenue(theme)}>{ligne(c)}</Text>
        </View>
      ))}
      <Intertitre theme={theme}>{trTk('stats.par_responsable')}</Intertitre>
      {s.parResponsable.map(r => (
        <View key={`${r.compte ?? r.nom}`} style={{ gap: 2 }}>
          <Text style={{ ...texte(theme), fontWeight: '700' }}>{r.nom}</Text>
          <Text style={attenue(theme)}>{ligne(r)}</Text>
        </View>
      ))}
    </View>
  );
}
