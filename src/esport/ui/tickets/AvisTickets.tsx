/**
 * Tickets › Avis (migration 0056, docs/esport/tickets.md, « Avis ») : les notes de satisfaction (1 à 5) et les
 * commentaires laissés par les auteurs dans le MP de fermeture. Note moyenne, nombre, répartition (barres), puis la
 * liste filtrable (catégorie, note, période, responsable) et triable (date, note). Le serveur ne rend que les catégories
 * que l'acteur gère ; un avis gardé d'un ticket supprimé est anonyme (aucun lien). Toucher un avis ouvre son ticket.
 * Temps réel : relu quand un ticket change (une note arrive).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate, langueCourante } from '../../i18n';
import { trTk, type CleTk } from '../../i18n/tickets';
import { CibleSurlignee } from '../notifications/Cible';
import { apiTickets, type AvisTicket, type FiltresAvis, type ListeAvis, type TriAvis } from '../../tickets/api';
import { useTempsReel } from '../../tempsReel/hooks';
import { Icone } from '../../../ui/icones';
import { BoutonHub } from '../../../hub/admin/ui/commun';
import { Choix, Intertitre, Panneau, Retours, styles, useAgir } from '../commun';
import { Badge, ChiffreCle, ESP, EtatVide, Grille, Squelette, attenue, texte } from '../design';

const nomCat = (c: { nom: { fr: string; en: string } }) => (langueCourante() === 'en' ? c.nom.en || c.nom.fr : c.nom.fr || c.nom.en);
const quand = (iso: string) => formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' });

/** Couleur d'une note (même échelle que les barres de taux de l'app : bon, moyen, mauvais). */
export const couleurNote = (theme: ThemeHub, note: number): string => (note >= 4 ? theme.ok : note === 3 ? theme.alerte : theme.critique);

/** Cinq étoiles monochromes (icône « etoile ») : les `note` premières pleines de couleur, les autres atténuées. */
export function Etoiles({ theme, note, taille = 16, testID }: { theme: ThemeHub; note: number; taille?: number; testID?: string }) {
  const c = couleurNote(theme, note);
  return (
    <View testID={testID} accessible accessibilityLabel={trTk('avis.etoiles', { note })} style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <View key={n} style={{ opacity: n <= note ? 1 : 0.3 }}>
          <Icone nom="etoile" taille={taille} couleur={n <= note ? c : theme.attenue} />
        </View>
      ))}
    </View>
  );
}

const PERIODES = [
  { id: 'tout', jours: 0 },
  { id: '7', jours: 7 },
  { id: '30', jours: 30 },
  { id: '90', jours: 90 },
  { id: '365', jours: 365 },
] as const;
type Periode = (typeof PERIODES)[number]['id'];
const TRIS: TriAvis[] = ['recent', 'ancien', 'note_haut', 'note_bas'];

export function AvisTicketsPage({ theme, client, onOuvrir, ticket }: { theme: ThemeHub; client: ClientEsport; /** Ouvrir le ticket d'un avis (tickets.voir). */ onOuvrir?(id: string, numero: number): void; /** Avis d'un seul ticket (lien d'une notification d'avis) : « Tous les avis » le retire. */ ticket?: string }) {
  const api = useMemo(() => apiTickets(client), [client]);
  const [f, setF] = useState<{ categorie?: string; note?: string; responsable?: string; ticket?: string; tri: TriAvis }>({ tri: 'recent', ticket });
  const [periode, setPeriode] = useState<Periode>('tout');
  const [d, setD] = useState<ListeAvis | undefined>();
  const [version, setVersion] = useState(0);
  const { erreur, agir } = useAgir();
  // Une note (ou un commentaire) qui arrive annonce « le ticket a changé » : la liste est relue.
  useTempsReel(client, 'tickets', () => setVersion(v => v + 1));
  useEffect(() => {
    let vivant = true;
    const jours = PERIODES.find(p => p.id === periode)?.jours ?? 0;
    const filtres: FiltresAvis = { ...f, ...(jours ? { du: new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10) } : {}) };
    void agir('avis', async () => {
      const r = await api.avis(filtres);
      if (vivant) setD(r);
    });
    return () => {
      vivant = false;
    };
  }, [api, f, periode, version, agir]);
  if (!d) return <View>{erreur ? <Retours theme={theme} erreur={erreur} prefixe="esport-tk-avis" /> : <Squelette theme={theme} lignes={4} />}</View>;
  const max = Math.max(1, ...d.repartition);
  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-avis">
      <Text style={attenue(theme)}>{trTk('avis.aide')}</Text>
      <Retours theme={theme} erreur={erreur} prefixe="esport-tk-avis" />
      <Grille min={150}>
        <ChiffreCle theme={theme} libelle={trTk('avis.moyenne')} valeur={d.moyenne === null ? '—' : `${d.moyenne.toFixed(1)}/5`} glyphe="etoile" testID="esport-tk-avis-moyenne" testIDValeur="esport-tk-avis-moyenne-valeur" />
        <ChiffreCle theme={theme} libelle={trTk('avis.nombre')} valeur={String(d.total)} testIDValeur="esport-tk-avis-nombre" />
      </Grille>
      <Panneau theme={theme} testID="esport-tk-avis-repartition">
        <Intertitre theme={theme}>{trTk('avis.repartition')}</Intertitre>
        {[5, 4, 3, 2, 1].map(note => {
          const n = d.repartition[note - 1] ?? 0;
          return (
            <View key={note} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s }} accessible accessibilityLabel={trTk('avis.repartition_ligne', { note, n })} testID={`esport-tk-avis-barre-${note}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, width: 44 }}>
                <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{note}</Text>
                <Icone nom="etoile" taille={13} couleur={theme.attenue} />
              </View>
              <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: teinteTransparente(theme.attenue, 0.18), overflow: 'hidden' }}>
                <View style={{ width: `${Math.round((n / max) * 100)}%`, height: 8, backgroundColor: couleurNote(theme, note) }} />
              </View>
              <Text style={{ ...attenue(theme), width: 36, textAlign: 'right' }}>{n}</Text>
            </View>
          );
        })}
      </Panneau>

      <Choix theme={theme} libelle={trTk('f.categorie')} valeur={f.categorie ?? ''} options={[{ id: '', nom: trTk('f.toutes') }, ...d.categories.map(c => ({ id: c.id, nom: nomCat(c), couleur: c.couleur }))]} onChoisir={categorie => setF({ ...f, categorie: categorie || undefined })} testID="esport-tk-avis-f-categorie" />
      <Choix theme={theme} libelle={trTk('avis.note')} valeur={f.note ?? ''} options={[{ id: '', nom: trTk('avis.toutes_notes') }, ...['5', '4', '3', '2', '1'].map(n => ({ id: n, nom: `${n}/5` }))]} onChoisir={note => setF({ ...f, note: note || undefined })} testID="esport-tk-avis-f-note" />
      <Choix theme={theme} libelle={trTk('avis.periode')} valeur={periode} options={PERIODES.map(p => ({ id: p.id, nom: trTk(`avis.p_${p.id}` as CleTk) }))} onChoisir={p => setPeriode(p as Periode)} testID="esport-tk-avis-f-periode" />
      {d.responsables.length ? <Choix theme={theme} libelle={trTk('avis.responsable')} valeur={f.responsable ?? ''} options={[{ id: '', nom: trTk('f.tous') }, ...d.responsables.map(r => ({ id: r.cle, nom: r.nom }))]} onChoisir={responsable => setF({ ...f, responsable: responsable || undefined })} testID="esport-tk-avis-f-responsable" /> : null}
      <Choix theme={theme} libelle={trTk('avis.tri')} valeur={f.tri} options={TRIS.map(t => ({ id: t, nom: trTk(`avis.tri_${t}` as CleTk) }))} onChoisir={tri => setF({ ...f, tri: tri as TriAvis })} testID="esport-tk-avis-tri" />

      {f.ticket ? (
        <View style={[styles.ligne, { justifyContent: 'space-between' }]} testID="esport-tk-avis-f-ticket">
          <Text style={{ ...attenue(theme), flex: 1, minWidth: 0 }}>{trTk('avis.un_ticket')}</Text>
          <BoutonHub theme={theme} titre={trTk('avis.tous_les_avis')} onPress={() => setF({ ...f, ticket: undefined })} testID="esport-tk-avis-f-ticket-tous" />
        </View>
      ) : null}
      {!d.avis.length ? <EtatVide theme={theme} glyphe="etoile" titre={trTk('avis.vide')} /> : null}
      <View style={{ gap: ESP.xs }}>
        {d.avis.map(a => (
          <CibleSurlignee key={a.id} theme={theme} cle={`tk-avis:${a.ticketId ?? a.id}`}><LigneAvis theme={theme} a={a} onPress={a.ticketId && a.numero !== null && d.voirTickets && onOuvrir ? () => onOuvrir(a.ticketId as string, a.numero as number) : undefined} /></CibleSurlignee>
        ))}
      </View>
    </View>
  );
}

function LigneAvis({ theme, a, onPress }: { theme: ThemeHub; a: AvisTicket; onPress?(): void }) {
  const titre = a.anonyme ? trTk('avis.anonyme') : `${trTk('numero', { numero: a.numero ?? '' })}${a.salon ? ` · ${a.salon}` : ''}`;
  const contenu = (
    <>
      <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
        <Text style={{ ...texte(theme), fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
          {titre}
        </Text>
        <Etoiles theme={theme} note={a.note} testID={`esport-tk-avis-${a.id}-etoiles`} />
      </View>
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Badge theme={theme} couleur={a.categorie.couleur} texte={nomCat(a.categorie)} />
        <Text style={{ ...attenue(theme), flexShrink: 1 }} numberOfLines={2}>
          {[a.anonyme ? null : a.auteur || trTk('avis.auteur_inconnu'), a.responsable ? trTk('pris_par', { nom: a.responsable.nom }) : trTk('personne'), trTk('avis.le', { quand: quand(a.le) })].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={a.commentaire ? { ...texte(theme), fontStyle: 'italic' } : attenue(theme)} selectable>
        {a.commentaire || trTk('avis.sans_commentaire')}
      </Text>
    </>
  );
  const cadre = { borderWidth: 1, borderColor: theme.ligne, borderLeftWidth: 4, borderLeftColor: couleurNote(theme, a.note), borderRadius: 10, padding: ESP.s, gap: ESP.xxs };
  if (!onPress)
    return (
      <View testID={`esport-tk-avis-${a.id}`} style={{ ...cadre, backgroundColor: theme.surface }}>
        {contenu}
      </View>
    );
  return (
    <Pressable
      testID={`esport-tk-avis-${a.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${trTk('avis.ouvrir', { numero: a.numero ?? '' })} · ${trTk('avis.etoiles', { note: a.note })}`}
      onPress={onPress}
      style={({ pressed }) => ({ ...cadre, backgroundColor: pressed ? teinteTransparente(theme.attenue, 0.08) : theme.surface })}>
      {contenu}
    </Pressable>
  );
}
