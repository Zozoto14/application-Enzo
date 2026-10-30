/**
 * Publication du devblog en un clic, programmée ou automatique (Fondateur, permission du club devblog.gerer ;
 * docs/esport/devblog.md, « Publication automatique ») :
 *  - `ToutPublier` (éditeur) : « 🚀 Tout publier » = app + salons Discord par défaut, avec aperçu et confirmation ;
 *  - `Programmation` (éditeur, brouillon) : date et heure (heure de Paris), salons, @here ; modifiable, annulable ;
 *  - `ReglagesAutomatiques` (page Devblog) : mode automatique (désactivé par défaut), fréquence, heure, jour,
 *    validation avant publication, salons, @here, « Générer maintenant », prochain passage et journal.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Interrupteur, Segments } from '../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { apiDevblog, type EntreeDevblog, type EtatDiscord, type FrequenceAuto, type ReglagesAuto, type SalonDevblog, type VueAuto } from '../../devblog/api';
import { langueCourante } from '../../i18n';
import { trDv, type CleDv } from '../../i18n/devblog';
import { Retours, useAgir } from '../commun';
import { Badge, Carte, ESP, TitreCarte, attenue, texte } from '../design';
import { ApercuDiscord } from './Contenu';

/** Date et heure lisibles dans la langue du compte, à l'heure de Paris. */
export function dateHeureClub(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return d.toLocaleString(langueCourante() === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Demain à 18:00 (heure murale du club), proposé par défaut pour une programmation. */
function demain18h(): string {
  const d = new Date(Date.now() + 86_400_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${p} 18:00`;
}

/** Cases des salons Discord (club, teams). */
export function ChoixSalons({ theme, salons, choisis, onChanger, prefixe }: { theme: ThemeHub; salons: SalonDevblog[]; choisis: string[]; onChanger(c: string[]): void; prefixe: string }) {
  if (!salons.length) return <Text style={attenue(theme, 13)}>{trDv('discord_salons_aucun')}</Text>;
  return (
    <View style={{ gap: 2 }}>
      {salons.map(s => (
        <View key={s.cle} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
          <Case theme={theme} coche={choisis.includes(s.cle)} libelle={s.nom} onChanger={v => onChanger(v ? [...new Set([...choisis, s.cle])] : choisis.filter(x => x !== s.cle))} testID={`${prefixe}-${s.cle.replace(':', '-')}`} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={texte(theme, 14)} numberOfLines={1}>{`${s.genre === 'club' ? trDv('discord_club') : trDv('discord_team')} · ${s.nom}`}</Text>
            <Text style={attenue(theme, 12)} numberOfLines={1}>{[s.detail, s.invalide ? trDv('discord_invalide') : ''].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function LigneCase({ theme, coche, libelle, onChanger, testID }: { theme: ThemeHub; coche: boolean; libelle: string; onChanger(v: boolean): void; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
      <Case theme={theme} coche={coche} libelle={libelle} onChanger={onChanger} testID={testID} />
      <Text style={{ ...texte(theme, 14), flex: 1 }}>{libelle}</Text>
    </View>
  );
}

/**
 * « 🚀 Tout publier » : publier dans l'app ET sur les salons Discord cochés (ceux par défaut au départ), en une
 * action, après aperçu et confirmation.
 */
export function ToutPublier({ theme, client, entree, modifie, onPublie }: { theme: ThemeHub; client: ClientEsport; entree: EntreeDevblog; modifie: boolean; onPublie(e: EntreeDevblog): void }) {
  const api = useMemo(() => apiDevblog(client), [client]);
  const [ouvert, setOuvert] = useState(false);
  const [salons, setSalons] = useState<SalonDevblog[]>([]);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [here, setHere] = useState(true);
  const [etat, setEtat] = useState<EtatDiscord | undefined>();
  const { enCours, erreur, avis, agir } = useAgir();

  const ouvrir = () =>
    void agir('ouvrir', async () => {
      const s = await api.salons();
      setSalons(s.salons);
      setChoisis(s.defaut);
      setEtat(await api.etatDiscord(entree.id, here));
      setOuvert(true);
    });
  useEffect(() => {
    if (!ouvert) return;
    void agir('', async () => setEtat(await api.etatDiscord(entree.id, here)));
  }, [agir, api, entree.id, here, ouvert]);

  const complet = etat ? etat.complet !== false : true;
  return (
    <Carte theme={theme} testID="esport-devblog-tout" accent={theme.accent}>
      <TitreCarte theme={theme} titre={`🚀 ${trDv('tout_publier')}`} sous={trDv('tout_publier_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog-tout" />
      {modifie ? <Text style={{ ...attenue(theme, 13), color: theme.alerte }}>{trDv('enregistrer_d_abord')}</Text> : null}
      {!ouvert ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <BoutonHub theme={theme} titre={`🚀 ${trDv('tout_publier')}`} variante="plein" desactive={modifie || Boolean(enCours)} onPress={ouvrir} testID="esport-devblog-tout-ouvrir" />
        </View>
      ) : (
        <View style={{ gap: ESP.s }} testID="esport-devblog-tout-panneau">
          <Text style={texte(theme, 14)}>{`✓ ${entree.statut === 'publie' ? trDv('tout_publier_deja_app') : trDv('tout_publier_app')}`}</Text>
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('discord_salons')}</Text>
          <ChoixSalons theme={theme} salons={salons} choisis={choisis} onChanger={setChoisis} prefixe="esport-devblog-tout-salon" />
          {choisis.length === 0 ? <Text style={attenue(theme, 13)}>{trDv('tout_publier_salons_aucun')}</Text> : null}
          <LigneCase theme={theme} coche={here} libelle={trDv('discord_here')} onChanger={setHere} testID="esport-devblog-tout-here" />
          {!complet ? <Text style={{ ...attenue(theme, 13), color: theme.alerte }} testID="esport-devblog-tout-incomplet">{trDv('incomplet')}</Text> : null}
          {etat && choisis.length ? <ApercuDiscord theme={theme} en={etat.apercu.en} fr={etat.apercu.fr} testID="esport-devblog-tout-apercu" /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
            <BoutonHub
              theme={theme}
              titre={enCours === 'tout' ? '…' : `🚀 ${trDv('tout_publier_confirmer')}`}
              variante="plein"
              desactive={modifie || !complet || Boolean(enCours)}
              onPress={() =>
                void agir('tout', async () => {
                  const r = await api.toutPublier(entree.id, choisis, here);
                  setEtat(r);
                  setOuvert(false);
                  onPublie(r.entree);
                  return choisis.length ? trDv('tout_publier_fait') : trDv('tout_publier_fait_app');
                })
              }
              testID="esport-devblog-tout-confirmer"
            />
            <BoutonHub theme={theme} titre={trDv('annuler')} onPress={() => setOuvert(false)} testID="esport-devblog-tout-annuler" />
          </View>
        </View>
      )}
    </Carte>
  );
}

/** Publication programmée d'un brouillon : date et heure (Paris), salons, @here ; modifier, annuler. */
export function Programmation({ theme, client, entree, modifie, onChange }: { theme: ThemeHub; client: ClientEsport; entree: EntreeDevblog; modifie: boolean; onChange(e: EntreeDevblog): void }) {
  const api = useMemo(() => apiDevblog(client), [client]);
  const prog = entree.programmation ?? null;
  const [quand, setQuand] = useState(prog?.mural ?? demain18h());
  const [salons, setSalons] = useState<SalonDevblog[]>([]);
  const [choisis, setChoisis] = useState<string[]>(prog?.cibles ?? []);
  const [here, setHere] = useState(prog?.mentionHere ?? true);
  const { enCours, erreur, avis, agir } = useAgir();
  useEffect(() => {
    void agir('', async () => {
      const s = await api.salons();
      setSalons(s.salons);
      if (!prog) setChoisis(s.defaut);
    });
    // Chargé une fois par devblog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agir, api, entree.id]);
  if (entree.statut !== 'brouillon') return null;
  return (
    <Carte theme={theme} testID="esport-devblog-programmation">
      <TitreCarte theme={theme} titre={`🗓️ ${trDv('prog_titre')}`} sous={trDv('prog_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog-programmation" />
      {prog ? <Badge theme={theme} texte={trDv('prog_le', { date: dateHeureClub(prog.le) })} ton="accent" testID="esport-devblog-programmation-etat" /> : null}
      {modifie ? <Text style={{ ...attenue(theme, 13), color: theme.alerte }}>{trDv('enregistrer_d_abord')}</Text> : null}
      <Champ theme={theme} libelle={trDv('prog_champ')} valeur={quand} onChanger={setQuand} maxLength={16} testID="esport-devblog-programmation-quand" style={{ maxWidth: 260 }} />
      <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('discord_salons')}</Text>
      <ChoixSalons theme={theme} salons={salons} choisis={choisis} onChanger={setChoisis} prefixe="esport-devblog-programmation-salon" />
      <LigneCase theme={theme} coche={here} libelle={trDv('discord_here')} onChanger={setHere} testID="esport-devblog-programmation-here" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
        <BoutonHub
          theme={theme}
          titre={prog ? trDv('prog_modifier') : trDv('prog_programmer')}
          variante="plein"
          desactive={modifie || !quand.trim() || Boolean(enCours)}
          onPress={() =>
            void agir('programmer', async () => {
              onChange((await api.programmer(entree.id, quand.trim(), choisis, here)).entree);
              return trDv('prog_fait');
            })
          }
          testID="esport-devblog-programmation-valider"
        />
        {prog ? (
          <BoutonHub
            theme={theme}
            titre={trDv('prog_annuler')}
            desactive={Boolean(enCours)}
            onPress={() =>
              void agir('annuler', async () => {
                onChange((await api.annulerProgrammation(entree.id)).entree);
                return trDv('prog_annule');
              })
            }
            testID="esport-devblog-programmation-annuler"
          />
        ) : null}
      </View>
    </Carte>
  );
}

const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Réglages du mode automatique, « Générer maintenant », prochain passage et journal. */
export function ReglagesAutomatiques({ theme, client, onOuvrir }: { theme: ThemeHub; client: ClientEsport; onOuvrir(id: string): void }) {
  const api = useMemo(() => apiDevblog(client), [client]);
  const [vue, setVue] = useState<VueAuto | undefined>();
  const [r, setR] = useState<ReglagesAuto | undefined>();
  const [salons, setSalons] = useState<SalonDevblog[]>([]);
  const [modifie, setModifie] = useState(false);
  const { enCours, erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => {
    const [v, s] = await Promise.all([api.auto(true), api.salons()]);
    setVue(v);
    setR(v.reglages);
    setSalons(s.salons);
    setModifie(false);
  }, [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  const regler = (p: Partial<ReglagesAuto>) => {
    setR(x => (x ? { ...x, ...p } : x));
    setModifie(true);
  };
  const enregistrer = (p: Partial<ReglagesAuto> = {}) =>
    void agir('enregistrer', async () => {
      const v = await api.reglerAuto({ ...r, ...p });
      setVue(v);
      setR(v.reglages);
      setModifie(false);
      return trDv('enregistre');
    });

  return (
    <Carte theme={theme} testID="esport-devblog-auto">
      <TitreCarte theme={theme} titre={`⚙️ ${trDv('auto_titre')}`} sous={trDv('auto_aide')} />
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-devblog-auto" />
      {r && vue ? (
        <View style={{ gap: ESP.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44, padding: ESP.s, borderRadius: 12, backgroundColor: teinteTransparente(r.actif ? theme.accent : theme.attenue, 0.08) }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{trDv('auto_actif')}</Text>
              <Text style={attenue(theme, 12)}>{r.actif ? (vue.prochain && !modifie ? trDv('auto_prochain', { date: dateHeureClub(vue.prochain) }) : '') : trDv('auto_inactif')}</Text>
            </View>
            <Interrupteur theme={theme} libelle={trDv('auto_actif')} valeur={r.actif} desactive={Boolean(enCours)} onChanger={v => enregistrer({ actif: v })} testID="esport-devblog-auto-actif" />
          </View>
          {!vue.source ? <Text style={{ ...attenue(theme, 13), color: theme.alerte }}>{trDv('auto_sans_source')}</Text> : null}
          {!vue.ia ? <Text style={{ ...attenue(theme, 13), color: theme.alerte }}>{trDv('auto_sans_ia')}</Text> : null}
          {vue.enAttente ? <Text style={attenue(theme, 13)} testID="esport-devblog-auto-attente">{trDv('auto_attente', { n: vue.enAttente.retenus, lus: vue.enAttente.lus })}</Text> : null}

          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('auto_frequence')}</Text>
          <Segments<FrequenceAuto> theme={theme} libelle={trDv('auto_frequence')} valeur={r.frequence} options={[['apres_maj', trDv('auto_apres_maj')], ['hebdo', trDv('auto_hebdo')]]} onChoisir={v => regler({ frequence: v })} testID="esport-devblog-auto-frequence" />
          <Text style={attenue(theme, 12)}>{r.frequence === 'hebdo' ? trDv('auto_hebdo_aide') : trDv('auto_apres_maj_aide')}</Text>
          {r.frequence === 'hebdo' ? (
            <Segments<string> theme={theme} libelle={trDv('auto_jour')} valeur={String(r.jour)} options={JOURS.map(j => [String(j), trDv(`jour_${j}` as CleDv)] as const)} onChoisir={v => regler({ jour: Number(v) })} testID="esport-devblog-auto-jour" />
          ) : null}
          <Champ theme={theme} libelle={trDv('auto_heure')} valeur={r.heure} onChanger={v => regler({ heure: v.trim() })} maxLength={5} testID="esport-devblog-auto-heure" style={{ maxWidth: 220 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, minHeight: 44 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('auto_validation')}</Text>
              <Text style={attenue(theme, 12)}>{trDv('auto_validation_aide')}</Text>
            </View>
            <Interrupteur theme={theme} libelle={trDv('auto_validation')} valeur={r.validation} onChanger={v => regler({ validation: v })} testID="esport-devblog-auto-validation" />
          </View>

          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trDv('auto_salons')}</Text>
          <LigneCase theme={theme} coche={r.cibles === null} libelle={trDv('auto_salons_defaut')} onChanger={v => regler({ cibles: v ? null : vue.cibles })} testID="esport-devblog-auto-salons-defaut" />
          {r.cibles !== null ? <ChoixSalons theme={theme} salons={salons} choisis={r.cibles} onChanger={c => regler({ cibles: c })} prefixe="esport-devblog-auto-salon" /> : null}
          <LigneCase theme={theme} coche={r.mentionHere} libelle={trDv('auto_here')} onChanger={v => regler({ mentionHere: v })} testID="esport-devblog-auto-here" />

          <Text style={attenue(theme, 12)}>{trDv('auto_garde_fous')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ESP.xs }}>
            <BoutonHub theme={theme} titre={enCours === 'enregistrer' ? '…' : trDv('auto_enregistrer')} variante="plein" desactive={!modifie || Boolean(enCours)} onPress={() => enregistrer()} testID="esport-devblog-auto-enregistrer" />
            <BoutonHub
              theme={theme}
              titre={enCours === 'generer' ? '…' : `✨ ${trDv('auto_generer')}`}
              desactive={!vue.source || Boolean(enCours)}
              onPress={() =>
                void agir('generer', async () => {
                  const v = await api.generer();
                  setVue(v);
                  const st = v.resultat?.statut;
                  return st === 'brouillon' ? trDv('auto_resultat_brouillon') : st === 'echec' ? trDv('auto_resultat_echec') : trDv('auto_resultat_rien');
                })
              }
              testID="esport-devblog-auto-generer"
            />
          </View>
          <Text style={attenue(theme, 12)}>{trDv('auto_generer_aide')}</Text>

          <Text style={{ ...texte(theme, 14), fontWeight: '700', marginTop: ESP.xs }}>{trDv('auto_journal')}</Text>
          {vue.journal.length === 0 ? <Text style={attenue(theme, 13)}>{trDv('auto_journal_vide')}</Text> : null}
          {vue.journal.map(j => (
            <View key={j.id} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: ESP.xs, minHeight: 36 }} testID={`esport-devblog-auto-journal-${j.id}`}>
              <Text style={attenue(theme, 12)}>{dateHeureClub(j.le)}</Text>
              <Badge theme={theme} texte={trDv(`auto_statut_${j.statut}` as CleDv)} ton={j.statut === 'publie' ? 'ok' : j.statut === 'echec' ? 'critique' : j.statut === 'brouillon' ? 'alerte' : 'neutre'} />
              {j.declencheur === 'manuel' ? <Badge theme={theme} texte={trDv('auto_test')} /> : null}
              {j.commitsLus ? <Text style={attenue(theme, 12)}>{trDv('auto_commits', { r: j.commitsRetenus, n: j.commitsLus })}</Text> : null}
              {j.entree ? (
                <Pressable accessibilityRole="link" onPress={() => onOuvrir(j.entree as string)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: ESP.xs }} testID={`esport-devblog-auto-journal-${j.id}-ouvrir`}>
                  <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 14 }}>{`${trDv('auto_ouvrir')} ›`}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Carte>
  );
}
