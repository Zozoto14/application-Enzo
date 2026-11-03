/**
 * Onglet « Réunions » de l'espace CM (docs/esport/cm-reunions.md), « comme Teams » : agenda de l'équipe CM (jour,
 * semaine, mois ; grille horaire sur PC, liste par jour sur téléphone), statut du moment de chacun, disponibilités
 * (les miennes, celles de l'équipe superposées), rendez-vous réservables, abonnement iCal. Une personne du club
 * invitée (hors équipe CM) ne voit que l'agenda de ses réunions. Tout est décidé par le serveur.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Segments } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { apiReunions, bloc, decaler, fuseauAppareil, joursVue, murale, type AbonnementIcalReunions, type ApiReunions, type MoiReunions, plusJours, type Reunion, type Statut, type VueAgenda } from '../../../cm/reunions';
import { formaterDate } from '../../../i18n';
import { trRe, trnRe } from '../../../i18n/reunions';
import { Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, MenuActions, Pliable, TitreCarte, Volet, attenue, texte, type EtatPresse } from '../../design';
import { copierTexte } from '../commun';
import { ChoixBoutons, PastilleStatut, jourCourt, jourLong, nomReponse, nomStatut } from './commun';
import { DetailReunion } from './DetailReunion';
import { FormReunion } from './FormReunion';
import { DisposCm } from './Dispos';
import { RendezVous } from './RendezVous';
import { useTempsReel } from '../../../tempsReel/hooks';

type Section = 'agenda' | 'dispos' | 'rdv';
const DEBUT_GRILLE = 8 * 60;
const FIN_GRILLE = 23 * 60;
const PX_MIN = 0.66;

export function Reunions({ theme, client, large, onExporter }: { theme: ThemeHub; client: ClientEsport; large: boolean; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean> }) {
  const api = useMemo(() => apiReunions(client), [client]);
  const [moi, setMoi] = useState<MoiReunions | undefined>();
  const [section, setSection] = useState<Section>('agenda');
  const { erreur, agir } = useAgir();
  const chargerMoi = useCallback(async () => setMoi(await api.moi()), [api]);
  useEffect(() => {
    void agir('', chargerMoi);
  }, [agir, chargerMoi]);
  const fuseau = moi?.profil.fuseau ?? fuseauAppareil();
  const equipe = moi?.droits.voir ?? false;
  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-reunions">
      <Retours theme={theme} erreur={erreur} prefixe="esport-cm-reunions" />
      {moi ? (
        <View style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.s }]}>
          {equipe ? <Segments theme={theme} libelle={trRe('vue.choix')} valeur={section} options={[['agenda', trRe('vue.agenda')], ['dispos', trRe('vue.dispos')], ['rdv', trRe('vue.rdv')]]} onChoisir={v => setSection(v as Section)} testID="esport-cm-reunions-section" /> : <Text style={attenue(theme, 13)}>{trRe('agenda.invite_seul')}</Text>}
          {equipe ? <MonStatut theme={theme} api={api} moi={moi} onChange={setMoi} /> : null}
        </View>
      ) : null}
      {moi && section === 'agenda' ? <Agenda theme={theme} api={api} client={client} large={large} moi={moi} fuseau={fuseau} onExporter={onExporter} onRelireMoi={() => void agir('', chargerMoi)} /> : null}
      {moi && section === 'dispos' && equipe ? <DisposCm theme={theme} api={api} large={large} fuseau={fuseau} onFuseau={() => void agir('', chargerMoi)} /> : null}
      {moi && section === 'rdv' && equipe ? <RendezVous theme={theme} api={api} large={large} moi={moi} fuseau={fuseau} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Statut du moment

function MonStatut({ theme, api, moi, onChange }: { theme: ThemeHub; api: ApiReunions; moi: MoiReunions; onChange(m: MoiReunions): void }) {
  const [ouvert, setOuvert] = useState(false);
  const moiEquipe = moi.equipe.find(m => m.compte === moi.compte);
  const actuel: Statut = moiEquipe?.statut ?? 'disponible';
  const [choix, setChoix] = useState<Statut | 'auto'>(moi.profil.statut ?? 'auto');
  const [message, setMessage] = useState(moi.profil.message);
  const [duree, setDuree] = useState<'1h' | '4h' | 'jour' | 'toujours'>('toujours');
  const { erreur, avis, agir } = useAgir();
  return (
    <View style={[styles.ligne, { gap: ESP.xs }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${trRe('statut.mon')} : ${nomStatut(actuel)}`} onPress={() => setOuvert(true)} testID="esport-cm-reunions-statut" style={(e: EtatPresse) => ({ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, paddingHorizontal: ESP.s, paddingVertical: ESP.xs, borderRadius: 999, borderWidth: 1, borderColor: theme.ligne, backgroundColor: e.hovered || e.focused ? teinteTransparente(theme.accent, 0.1) : theme.surface, minHeight: 40 })}>
        <PastilleStatut theme={theme} statut={actuel} />
        <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{nomStatut(actuel)}</Text>
        {moiEquipe?.message ? <Text style={attenue(theme, 13)} numberOfLines={1}>{`· ${moiEquipe.message}`}</Text> : null}
      </Pressable>
      {ouvert ? (
        <Volet theme={theme} visible titre={trRe('statut.changer')} onFermer={() => setOuvert(false)} testID="esport-cm-reunions-statut-volet" largeur={460}>
          <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunions-statut" />
          <ChoixBoutons theme={theme} libelle={trRe('statut.mon')} valeur={choix} options={[['auto', trRe('statut.automatique')], ['disponible', nomStatut('disponible')], ['occupe', nomStatut('occupe')], ['ne_pas_deranger', nomStatut('ne_pas_deranger')], ['absent', nomStatut('absent')]]} onChoisir={setChoix} testID="esport-cm-reunions-statut-choix" />
          {choix !== 'auto' ? (
            <>
              <Champ theme={theme} libelle={trRe('statut.message')} valeur={message} onChanger={setMessage} maxLength={140} testID="esport-cm-reunions-statut-message" />
              <ChoixBoutons theme={theme} libelle={trRe('statut.duree')} valeur={duree} options={[['1h', trRe('statut.duree.1h')], ['4h', trRe('statut.duree.4h')], ['jour', trRe('statut.duree.jour')], ['toujours', trRe('statut.duree.toujours')]]} onChoisir={setDuree} testID="esport-cm-reunions-statut-duree" />
            </>
          ) : null}
          <BoutonHub
            theme={theme}
            titre={trRe('action.enregistrer')}
            variante="plein"
            onPress={() =>
              void agir('statut', async () => {
                const t = Date.now();
                const fin = duree === '1h' ? t + 3_600_000 : duree === '4h' ? t + 4 * 3_600_000 : duree === 'jour' ? new Date(new Date(t).setHours(23, 59, 0, 0)).getTime() : null;
                onChange(await api.statut({ statut: choix === 'auto' ? null : choix, message: message.trim(), jusqua: choix !== 'auto' && fin ? new Date(fin).toISOString() : null }));
                setOuvert(false);
              })
            }
            testID="esport-cm-reunions-statut-ok"
          />
        </Volet>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Agenda

function Agenda({ theme, api, client, large, moi, fuseau, onExporter, onRelireMoi }: { theme: ThemeHub; api: ApiReunions; client: ClientEsport; large: boolean; moi: MoiReunions; fuseau: string; onExporter?(nom: string, contenu: string, type?: string): Promise<boolean>; onRelireMoi(): void }) {
  const [vue, setVue] = useState<VueAgenda>(large ? 'semaine' : 'jour');
  const [reference, setReference] = useState(() => murale(new Date().toISOString(), fuseau).date);
  const [reunions, setReunions] = useState<Reunion[] | undefined>();
  const [ouverte, setOuverte] = useState<{ id: string; cle: string } | undefined>();
  const [formulaire, setFormulaire] = useState<{ reunion?: Reunion } | undefined>();
  const [ical, setIcal] = useState(false);
  const { erreur, avis, agir } = useAgir();
  const jours = useMemo(() => joursVue(vue, reference), [vue, reference]);
  const charger = useCallback(async () => {
    // Marge d'un jour de chaque côté : les fuseaux décalent les bords de la période.
    const r = await api.agenda(plusJours(jours[0], -1), plusJours(jours[jours.length - 1], 1));
    setReunions(r.reunions);
  }, [api, jours]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : réunion créée, déplacée, annulée ou réponse d'un invité → agenda relu (docs/esport/temps-reel.md).
  useTempsReel(client, 'cm:reunions', () => void charger().catch(() => undefined));
  const parJour = useMemo(() => {
    const m = new Map<string, Array<{ r: Reunion; debut: ReturnType<typeof murale>; fin: ReturnType<typeof murale> }>>();
    for (const r of reunions ?? []) {
      const debut = murale(r.debut, fuseau);
      const fin = murale(r.fin, fuseau);
      if (!m.has(debut.date)) m.set(debut.date, []);
      m.get(debut.date)!.push({ r, debut, fin });
    }
    return m;
  }, [reunions, fuseau]);
  const aujourdhui = murale(new Date().toISOString(), fuseau).date;
  const titre = vue === 'mois' ? formaterDate(`${reference}T12:00:00Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : vue === 'semaine' ? trRe('agenda.semaine_du', { date: formaterDate(`${jours[0]}T12:00:00Z`, { day: 'numeric', month: 'long', timeZone: 'UTC' }) }) : jourLong(reference);
  const relire = () => {
    void agir('', charger);
    onRelireMoi();
  };

  const element = ({ r, debut, fin }: { r: Reunion; debut: ReturnType<typeof murale>; fin: ReturnType<typeof murale> }, compact: boolean) => {
    const annulee = r.statut === 'annulee';
    const enAttente = r.maReponse === 'attente';
    const couleur = r.genre === 'rdv' ? theme.ok : theme.accent;
    return (
      <Pressable
        key={`${r.id}-${r.cle}`}
        accessibilityRole="button"
        accessibilityLabel={trRe('agenda.ouvrir', { titre: r.titre, heure: `${debut.heure}–${fin.heure}`, reponse: annulee ? trRe('detail.annulee') : r.maReponse ? nomReponse(r.maReponse) : '' })}
        onPress={() => setOuverte({ id: r.id, cle: r.cle })}
        testID={`esport-cm-reunion-${r.id}${r.recurrence ? `-${r.cle.slice(0, 10)}` : ''}`}
        style={(e: EtatPresse) => ({
          flex: 1,
          borderLeftWidth: 3,
          borderLeftColor: couleur,
          borderWidth: enAttente ? 1 : 0,
          borderStyle: enAttente ? 'dashed' : 'solid',
          borderColor: couleur,
          backgroundColor: teinteTransparente(couleur, e.hovered || e.focused ? 0.28 : r.maReponse === 'refuse' ? 0.06 : 0.16),
          borderRadius: 6,
          paddingHorizontal: 6,
          paddingVertical: compact ? 2 : 4,
          opacity: annulee || r.maReponse === 'refuse' ? 0.55 : 1,
          overflow: 'hidden',
        })}>
        <Text style={{ ...texte(theme, 12), fontWeight: '700', textDecorationLine: annulee ? 'line-through' : 'none' }} numberOfLines={compact ? 1 : 2}>
          {compact ? `${debut.heure} ${r.titre}` : r.titre}
        </Text>
        {!compact ? <Text style={attenue(theme, 11)} numberOfLines={1}>{`${debut.heure}–${fin.heure}${r.lieuGenre !== 'aucun' ? ` · ${trRe(`form.lieu.${r.lieuGenre}`)}` : ''}`}</Text> : null}
      </Pressable>
    );
  };

  const grille = (liste: string[]) => (
    <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, overflow: 'hidden' }} testID="esport-cm-reunions-grille">
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.ligne }}>
        <View style={{ width: 52 }} />
        {liste.map(j => (
          <View key={j} style={{ flex: 1, padding: 6, borderLeftWidth: 1, borderLeftColor: theme.ligne, backgroundColor: j === aujourdhui ? teinteTransparente(theme.accent, 0.1) : 'transparent' }}>
            <Text style={{ ...attenue(theme, 12), fontWeight: '700' }}>{formaterDate(`${j}T12:00:00Z`, { weekday: 'short', timeZone: 'UTC' })}</Text>
            <Text style={{ ...texte(theme, 18), fontWeight: j === aujourdhui ? '800' : '600', color: j === aujourdhui ? theme.accent : theme.texte }}>{String(Number(j.slice(8)))}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', height: (FIN_GRILLE - DEBUT_GRILLE) * PX_MIN }}>
        <View style={{ width: 52 }}>
          {Array.from({ length: (FIN_GRILLE - DEBUT_GRILLE) / 60 }, (_, i) => (
            <Text key={i} style={{ ...attenue(theme, 11), position: 'absolute', top: i * 60 * PX_MIN - 6, right: 6 }}>{`${String(DEBUT_GRILLE / 60 + i).padStart(2, '0')}:00`}</Text>
          ))}
        </View>
        {liste.map(j => (
          <View key={j} style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: theme.ligne, position: 'relative', backgroundColor: j === aujourdhui ? teinteTransparente(theme.accent, 0.04) : 'transparent' }} testID={`esport-cm-reunions-jour-${j}`}>
            {Array.from({ length: (FIN_GRILLE - DEBUT_GRILLE) / 60 }, (_, i) => (
              <View key={i} style={{ position: 'absolute', top: i * 60 * PX_MIN, left: 0, right: 0, borderTopWidth: i ? 1 : 0, borderTopColor: teinteTransparente(theme.ligne, 0.6) }} />
            ))}
            {(parJour.get(j) ?? []).map(x => {
              const b = bloc(x.debut.minutes, x.fin.date === x.debut.date ? x.fin.minutes : 1440, DEBUT_GRILLE, FIN_GRILLE);
              if (!b) return null;
              return (
                <View key={`${x.r.id}-${x.r.cle}`} style={{ position: 'absolute', top: b.haut * PX_MIN, height: b.hauteur * PX_MIN - 2, left: 2, right: 2 }}>
                  {element(x, b.hauteur < 40)}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );

  const mois = () => (
    <View style={{ borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, overflow: 'hidden' }} testID="esport-cm-reunions-mois">
      {Array.from({ length: jours.length / 7 }, (_, s) => (
        <View key={s} style={{ flexDirection: 'row', borderTopWidth: s ? 1 : 0, borderTopColor: theme.ligne }}>
          {jours.slice(s * 7, s * 7 + 7).map(j => {
            const liste = parJour.get(j) ?? [];
            return (
              <View key={j} style={{ flex: 1, minHeight: large ? 104 : 64, padding: 4, gap: 3, borderLeftWidth: 1, borderLeftColor: theme.ligne, opacity: j.slice(0, 7) === reference.slice(0, 7) ? 1 : 0.5, backgroundColor: j === aujourdhui ? teinteTransparente(theme.accent, 0.08) : 'transparent' }} testID={`esport-cm-reunions-jour-${j}`}>
                <Text style={{ ...attenue(theme, 12), fontWeight: j === aujourdhui ? '800' : '400' }}>{String(Number(j.slice(8)))}</Text>
                {liste.slice(0, large ? 3 : 1).map(x => element(x, true))}
                {liste.length > (large ? 3 : 1) ? <Text style={attenue(theme, 11)}>{trRe('agenda.plus', { n: liste.length - (large ? 3 : 1) })}</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  const listeJours = (liste: string[]) => (
    <View style={{ gap: ESP.s }}>
      {liste.map(j => (
        <Carte key={j} theme={theme} dense testID={`esport-cm-reunions-jour-${j}`}>
          <Text style={{ ...texte(theme, 14), fontWeight: '700', color: j === aujourdhui ? theme.accent : theme.texte }}>{jourLong(j)}</Text>
          {(parJour.get(j) ?? []).length ? (
            (parJour.get(j) ?? []).map(x => (
              <View key={`${x.r.id}-${x.r.cle}`} style={{ minHeight: 44 }}>
                {element(x, false)}
              </View>
            ))
          ) : (
            <Text style={attenue(theme)}>—</Text>
          )}
        </Carte>
      ))}
    </View>
  );

  return (
    <View style={large ? { flexDirection: 'row', gap: ESP.m, alignItems: 'flex-start' } : { gap: ESP.m }}>
      <View style={{ flex: 1, gap: ESP.m, minWidth: 0 }}>
        {!large ? (
          <Text accessibilityRole="header" style={{ ...texte(theme, 18), fontWeight: '800' }} testID="esport-cm-reunions-titre">
            {titre}
          </Text>
        ) : null}
        <View style={[styles.ligne, { justifyContent: 'space-between', gap: ESP.xs }]}>
          <View style={[styles.ligne, { gap: ESP.xs, flexShrink: 1, maxWidth: '100%' }]}>
            <BoutonHub theme={theme} titre="‹" libelle={trRe('agenda.precedent')} onPress={() => setReference(decaler(vue, reference, -1))} testID="esport-cm-reunions-precedent" />
            <BoutonHub theme={theme} titre={trRe('agenda.aujourdhui')} onPress={() => setReference(aujourdhui)} testID="esport-cm-reunions-aujourdhui" />
            <BoutonHub theme={theme} titre="›" libelle={trRe('agenda.suivant')} onPress={() => setReference(decaler(vue, reference, 1))} testID="esport-cm-reunions-suivant" />
            {large ? (
              <Text accessibilityRole="header" style={{ ...texte(theme, 18), fontWeight: '800' }} testID="esport-cm-reunions-titre">
                {titre}
              </Text>
            ) : null}
          </View>
          <View style={[styles.ligne, { gap: ESP.xs, flexShrink: 1, maxWidth: '100%' }]}>
            <Segments theme={theme} libelle={trRe('agenda.vue')} valeur={vue} options={[['jour', trRe('agenda.jour')], ['semaine', trRe('agenda.semaine')], ['mois', trRe('agenda.mois')]]} onChoisir={v => setVue(v as VueAgenda)} testID="esport-cm-reunions-vue" />
            {moi.droits.voir ? <BoutonHub theme={theme} titre={trRe('agenda.nouvelle')} variante="plein" onPress={() => setFormulaire({})} testID="esport-cm-reunions-nouvelle" /> : null}
            <MenuActions
              theme={theme}
              testID="esport-cm-reunions-menu"
              actions={[
                onExporter && { titre: trRe('agenda.exporter'), onPress: () => void agir('', async () => { const f = await api.exportIcs(); await onExporter(f.nom, f.contenu, f.type); }), testID: 'esport-cm-reunions-exporter' },
                { titre: trRe('agenda.abonner'), onPress: () => setIcal(true), testID: 'esport-cm-reunions-abonner' },
              ]}
            />
          </View>
        </View>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <Text style={attenue(theme, 12)}>{trRe('agenda.fuseau', { fuseau })}</Text>
          {moi.aRepondre ? <Badge theme={theme} ton="alerte" texte={trnRe('agenda.a_repondre', moi.aRepondre)} testID="esport-cm-reunions-a-repondre" /> : null}
        </View>
        <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunions-agenda" />
        {reunions && !reunions.length && vue !== 'mois' && !large ? (
          <Carte theme={theme}>
            <EtatVide theme={theme} glyphe="◷" titre={trRe('agenda.vide')} texte={trRe('sous')} />
          </Carte>
        ) : null}
        {vue === 'mois' ? mois() : large ? grille(jours) : listeJours(jours)}
      </View>
      {moi.droits.voir ? (
        large ? (
          <View style={{ width: 290, gap: ESP.m }}>
            <PanneauEquipe theme={theme} moi={moi} />
          </View>
        ) : (
          <Pliable theme={theme} titre={trRe('equipe.titre')} resume={String(moi.equipe.length)} testID="esport-cm-reunions-equipe-pliable">
            <PanneauEquipe theme={theme} moi={moi} sansCadre />
          </Pliable>
        )
      ) : null}
      {ouverte ? <DetailReunion theme={theme} api={api} id={ouverte.id} cle={ouverte.cle} fuseau={fuseau} moi={moi} onFermer={() => setOuverte(undefined)} onModifier={r => { setOuverte(undefined); setFormulaire({ reunion: r }); }} onChange={relire} /> : null}
      {formulaire ? (
        <FormReunion
          theme={theme}
          api={api}
          moi={moi}
          fuseau={fuseau}
          reunion={formulaire.reunion}
          dateInitiale={reference}
          onFermer={() => setFormulaire(undefined)}
          onEnregistre={r => {
            setFormulaire(undefined);
            setReference(murale(r.debut, fuseau).date);
            relire();
          }}
        />
      ) : null}
      {ical ? <VoletIcal theme={theme} api={api} adresse={client.config.adresse} onFermer={() => setIcal(false)} /> : null}
    </View>
  );
}

// ------------------------------------------------------------------ Équipe CM (statuts)

function PanneauEquipe({ theme, moi, sansCadre }: { theme: ThemeHub; moi: MoiReunions; sansCadre?: boolean }) {
  const contenu = (
    <View style={{ gap: ESP.s }} testID="esport-cm-reunions-equipe">
      {!moi.equipe.length ? <Text style={attenue(theme)}>{trRe('equipe.vide')}</Text> : null}
      {moi.equipe.map(m => (
        <View key={m.compte} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start' }} testID={`esport-cm-reunions-equipe-${m.compte}`}>
          <View style={{ paddingTop: 5 }}>
            <PastilleStatut theme={theme} statut={m.statut} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '700' }} numberOfLines={1}>
              {m.pseudo ?? m.compte}
            </Text>
            <Text style={attenue(theme, 12)} numberOfLines={2}>
              {[m.enReunion && m.auto ? trRe('equipe.en_reunion') : nomStatut(m.statut), m.message].filter(Boolean).join(' · ')}
            </Text>
            {m.fuseau ? <Text style={attenue(theme, 11)}>{trRe('equipe.heure_locale', { heure: murale(new Date().toISOString(), m.fuseau).heure, fuseau: m.fuseau })}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
  if (sansCadre) return contenu;
  return (
    <Carte theme={theme}>
      <TitreCarte theme={theme} titre={trRe('equipe.titre')} />
      {contenu}
    </Carte>
  );
}

// ------------------------------------------------------------------ iCal

function VoletIcal({ theme, api, adresse, onFermer }: { theme: ThemeHub; api: ApiReunions; adresse: string; onFermer(): void }) {
  const [abonnements, setAbonnements] = useState<AbonnementIcalReunions[] | undefined>();
  const [libelle, setLibelle] = useState('');
  const [nouveau, setNouveau] = useState<string | undefined>();
  const { erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => setAbonnements((await api.abonnements()).abonnements));
  }, [agir, api]);
  return (
    <Volet theme={theme} visible titre={trRe('ical.titre')} onFermer={onFermer} testID="esport-cm-reunions-ical">
      <Text style={attenue(theme, 13)}>{trRe('ical.aide')}</Text>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-reunions-ical" />
      <Champ theme={theme} libelle={trRe('ical.libelle')} valeur={libelle} onChanger={setLibelle} maxLength={60} testID="esport-cm-reunions-ical-libelle" />
      <BoutonHub
        theme={theme}
        titre={trRe('ical.creer')}
        variante="plein"
        onPress={() =>
          void agir('', async () => {
            const r = await api.creerAbonnement(libelle.trim());
            setNouveau(`${adresse.replace(/\/+$/, '')}${r.chemin}`);
            setAbonnements((await api.abonnements()).abonnements);
          })
        }
        testID="esport-cm-reunions-ical-creer"
      />
      {nouveau ? (
        <View style={{ gap: ESP.xs }}>
          <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRe('ical.lien')}</Text>
          <Text selectable style={texte(theme, 12)} testID="esport-cm-reunions-ical-url">
            {nouveau}
          </Text>
          <BoutonHub theme={theme} titre={trRe('action.copier')} onPress={() => void agir('', async () => ((await copierTexte(nouveau)) ? trRe('ical.copie') : undefined))} testID="esport-cm-reunions-ical-copier" />
        </View>
      ) : null}
      {abonnements?.map(a => (
        <View key={a.id} style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={texte(theme, 13)}>{`${a.libelle || '—'} · ${jourCourt(a.creeLe.slice(0, 10))}`}</Text>
          {a.revoque ? <Badge theme={theme} texte={trRe('ical.revoque')} /> : <BoutonHub theme={theme} titre={trRe('ical.revoquer')} variante="danger" onPress={() => void agir('', async () => setAbonnements((await api.revoquerAbonnement(a.id)).abonnements))} testID={`esport-cm-reunions-ical-revoquer-${a.id}`} />}
        </View>
      ))}
    </Volet>
  );
}
