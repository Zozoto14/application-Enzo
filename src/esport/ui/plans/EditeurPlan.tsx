/**
 * Éditeur d'un plan de match : le match (titre, événement du planning, date, adversaire, format), le veto, les maps
 * (composition, strats par side et type de round, lineups clés, conditions de victoire, tendances, calls, notes), la
 * checklist et les notes générales.
 *
 * Contenu TACTIQUE : aucun champ ne porte l'assistant d'écriture. Enregistrement protégé par le verrou optimiste
 * (un autre enregistrement entre-temps : bandeau, rien n'est écrasé).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChampDate } from '../../../ui/dates/Champs';
import { BoutonHub, Champ, Segments } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { Icone, type NomIcone } from '../../../ui/icones';
import { SelecteurRepliable } from '../../../ui/selecteurs/SelecteurRepliable';
import type { ClientEsport } from '../../client';
import { trPm, trPmModele, type ClePm } from '../../i18n/plans';
import type { Reference } from '../../lineups/api';
import { normaliser } from '../../lineups/logique';
import { ACTIONS_VETO, FORMATS_PLAN, TYPES_ROUND, type ActionVeto, type ApiPlans, type CampVeto, type CartePlan, type EtapeVeto, type FormatPlan, type LiensPlan, type LigneCompo, type Plan, type SaisieContenu, type StratPlan, type TypeRound } from '../../plans/api';
import { CHECKLIST_DEFAUT, avecVeto, carteVide, deplacer, idCourt, ligneCompo, rolesSuggeres, versSaisie, vetoType } from '../../plans/logique';
import type { Assets } from '../../strats/assets';
import { MODELES, type ModeleStrat } from '../../strats/modeles';
import { useVerrouOptimiste } from '../../tempsReel/hooks';
import { BandeauConflit } from '../../tempsReel/ui';
import { BoutonConfirme, Choix, Retours, useAgir } from '../commun';
import { ESP, EnTetePage, attenue, texte } from '../design';
import { PastillesFiltre } from '../lineups/Filtres';
import { nomSide } from '../lineups/Puces';
import { Section, SousTitre, jourPlan } from './blocs';

type CarteSaisie = CartePlan<string>;

/** Petit bouton d'icône (monter, descendre, retirer) : 36 px à la souris, élargi au doigt par hitSlop. */
function BoutonIcone({ theme, icone, libelle, onPress, desactive, testID }: { theme: ThemeHub; icone: NomIcone; libelle: string; onPress(): void; desactive?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={libelle} accessibilityState={{ disabled: Boolean(desactive) }} disabled={desactive} onPress={onPress} hitSlop={6} style={{ width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: theme.ligne, alignItems: 'center', justifyContent: 'center', opacity: desactive ? 0.35 : 1 }}>
      <Icone nom={icone} taille={16} couleur={theme.texte} />
    </Pressable>
  );
}

/** Rangée d'une liste ordonnée : numéro, contenu, monter / descendre / retirer. */
function Rangee({ theme, n, total, onDeplacer, onRetirer, libelleRetirer, children, testID }: { theme: ThemeHub; n: number; total: number; onDeplacer(sens: -1 | 1): void; onRetirer(): void; libelleRetirer: string; children: React.ReactNode; testID: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-start', padding: ESP.xs, borderRadius: 12, borderWidth: 1, borderColor: theme.ligne }}>
      <Text style={{ ...attenue(theme, 12), width: 18, textAlign: 'right', marginTop: 8 }}>{`${n + 1}.`}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: ESP.xs }}>{children}</View>
      <View style={{ gap: 4 }}>
        <BoutonIcone theme={theme} icone="chevron-haut" libelle={trPm('monter')} desactive={n === 0} onPress={() => onDeplacer(-1)} testID={`${testID}-monter`} />
        <BoutonIcone theme={theme} icone="chevron-bas" libelle={trPm('descendre')} desactive={n === total - 1} onPress={() => onDeplacer(1)} testID={`${testID}-descendre`} />
        <BoutonIcone theme={theme} icone="croix" libelle={libelleRetirer} onPress={onRetirer} testID={`${testID}-retirer`} />
      </View>
    </View>
  );
}

const refCarte = (assets: Assets | undefined, cle: string): Reference | null => {
  const c = assets?.cartes.find(x => x.cle === cle);
  return c ? { cle: c.cle, nom: c.nom } : null;
};

/** Choix d'une map du profil (ou son nom libre quand le profil ne la connaît pas). */
function ChoixCarte({ theme, assets, libelle, valeur, vide, onChoisir, testID }: { theme: ThemeHub; assets: Assets | undefined; libelle: string; valeur: Reference | null; vide?: string; onChoisir(r: Reference | null): void; testID: string }) {
  const cartes = assets?.cartes ?? [];
  if (cartes.length === 0) return <Champ theme={theme} libelle={libelle} valeur={valeur?.nom ?? ''} onChanger={v => onChoisir(v.trim() ? { cle: null, nom: v } : null)} maxLength={60} style={{ flexGrow: 1, minWidth: 160 }} testID={`${testID}-libre`} />;
  const options = [...(vide ? [{ id: '', nom: vide }] : []), ...cartes.map(c => ({ id: c.cle, nom: c.nom }))];
  return <SelecteurRepliable theme={theme} libelle={libelle} valeur={valeur?.cle ?? ''} vide={vide} options={options} onChoisir={id => onChoisir(id ? refCarte(assets, id) : null)} testID={testID} style={{ flexGrow: 1, flexBasis: 220, maxWidth: 420 }} />;
}

// ------------------------------------------------------------------ Composition

/** Éditeur d'une composition : une ligne par joueur (membre de la team ou nom libre), son personnage, son rôle. */
export function EditeurCompo({ theme, modele, assets, membres, compo, onChanger, testID = 'esport-plan-form-compo' }: { theme: ThemeHub; modele: ModeleStrat; assets: Assets | undefined; membres: LiensPlan['membres']; compo: LigneCompo[]; onChanger(c: LigneCompo[]): void; testID?: string }) {
  const maj = (id: string, p: Partial<LigneCompo>) => onChanger(compo.map(l => (l.id === id ? { ...l, ...p } : l)));
  const agents = assets?.agents ?? [];
  const finals = modele === 'thefinals';
  return (
    <View testID={testID} style={{ gap: ESP.xs }}>
      {compo.map((l, i) => {
        const agent = agents.find(a => a.cle === l.personnage?.cle);
        const parCategorie = (categorie: string) => (agent?.capacites ?? []).filter(c => c.donnees?.categorie === categorie).map(c => c.nom);
        const champEquipement = (libelle: string, valeur: string, options: string[], changer: (v: string) => void, id: string) =>
          options.length ? (
            <SelecteurRepliable theme={theme} libelle={libelle} valeur={options.includes(valeur) ? valeur : ''} vide={valeur || trPm('choix.aucun')} options={[{ id: '', nom: trPm('choix.aucun') }, ...options.map(o => ({ id: o, nom: o }))]} onChoisir={changer} testID={`${testID}-${id}-${i}`} style={{ flexGrow: 1, flexBasis: 180, maxWidth: 320 }} />
          ) : (
            <Champ theme={theme} libelle={libelle} valeur={valeur} onChanger={changer} maxLength={40} style={{ flexGrow: 1, flexBasis: 150, maxWidth: 260 }} testID={`${testID}-${id}-${i}`} />
          );
        return (
          <View key={l.id} testID={`${testID}-ligne-${i}`} style={{ gap: ESP.xs, padding: ESP.xs, borderRadius: 12, borderWidth: 1, borderColor: theme.ligne }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ESP.xs }}>
              <SousTitre theme={theme}>{trPm('compo.ligne', { n: i + 1 })}</SousTitre>
              <BoutonIcone theme={theme} icone="croix" libelle={trPm('compo.retirer', { n: i + 1 })} onPress={() => onChanger(compo.filter(x => x.id !== l.id))} testID={`${testID}-retirer-${i}`} />
            </View>
            <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {membres.length ? (
                <SelecteurRepliable
                  theme={theme}
                  libelle={trPm('compo.joueur')}
                  nature="membre"
                  valeur={l.membre ?? ''}
                  vide={trPm('compo.joueur.aucun')}
                  options={[{ id: '', nom: trPm('compo.joueur.aucun') }, ...membres.map(m => ({ id: m.compte, nom: m.pseudo }))]}
                  onChoisir={id => maj(l.id, { membre: id || null, nom: id ? (membres.find(m => m.compte === id)?.pseudo ?? '') : l.nom })}
                  testID={`${testID}-joueur-${i}`}
                  style={{ flexGrow: 1, flexBasis: 200, maxWidth: 320 }}
                />
              ) : null}
              {!l.membre ? <Champ theme={theme} libelle={trPm('compo.joueur.libre')} valeur={l.nom} onChanger={v => maj(l.id, { nom: v })} maxLength={40} style={{ flexGrow: 1, flexBasis: 160, maxWidth: 260 }} testID={`${testID}-nom-${i}`} /> : null}
              {agents.length ? (
                <SelecteurRepliable
                  theme={theme}
                  libelle={trPmModele('compo.personnage', modele)}
                  valeur={l.personnage?.cle ?? ''}
                  vide={l.personnage?.nom ?? trPm('choix.aucun')}
                  options={[{ id: '', nom: trPm('choix.aucun') }, ...agents.map(a => ({ id: a.cle, nom: a.nom, detail: a.role ?? undefined }))]}
                  onChoisir={id => {
                    const a = agents.find(x => x.cle === id);
                    maj(l.id, { personnage: a ? { cle: a.cle, nom: a.nom } : null });
                  }}
                  testID={`${testID}-personnage-${i}`}
                  style={{ flexGrow: 1, flexBasis: 200, maxWidth: 320 }}
                />
              ) : (
                <Champ theme={theme} libelle={trPmModele('compo.personnage', modele)} valeur={l.personnage?.nom ?? ''} onChanger={v => maj(l.id, { personnage: v.trim() ? { cle: null, nom: v } : null })} maxLength={60} style={{ flexGrow: 1, flexBasis: 160, maxWidth: 260 }} testID={`${testID}-personnage-${i}`} />
              )}
              <Champ theme={theme} libelle={trPm('compo.role')} valeur={l.role} onChanger={v => maj(l.id, { role: v })} placeholder={trPm('compo.role.aide')} maxLength={30} style={{ flexGrow: 1, flexBasis: 130, maxWidth: 200 }} testID={`${testID}-role-${i}`} />
            </View>
            <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
              {rolesSuggeres(modele).map(r => (
                <Pressable key={r} testID={`${testID}-role-${i}-${normaliser(r).replace(/\s+/g, '-')}`} accessibilityRole="button" accessibilityLabel={`${trPm('compo.role')} : ${r}`} accessibilityState={{ selected: l.role === r }} onPress={() => maj(l.id, { role: l.role === r ? '' : r })} style={{ minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: l.role === r ? theme.accent : theme.ligne }}>
                  <Text style={{ ...texte(theme, 12), fontWeight: l.role === r ? '700' : '500' }}>{r}</Text>
                </Pressable>
              ))}
            </View>
            {finals ? (
              <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {champEquipement(trPm('compo.arme'), l.arme, parCategorie('arme'), v => maj(l.id, { arme: v }), 'arme')}
                {champEquipement(trPm('compo.specialisation'), l.specialisation, parCategorie('specialisation'), v => maj(l.id, { specialisation: v }), 'specialisation')}
                {[0, 1, 2].map(g =>
                  champEquipement(trPm('compo.gadget', { n: g + 1 }), l.gadgets[g] ?? '', parCategorie('gadget'), v => maj(l.id, { gadgets: [0, 1, 2].map(k => (k === g ? v : (l.gadgets[k] ?? ''))) }), `gadget${g}`),
                )}
                <Champ theme={theme} libelle={trPm('compo.reserve')} valeur={l.reserve.join(', ')} onChanger={v => maj(l.id, { reserve: v.split(',').map(x => x.trimStart()).slice(0, 6) })} placeholder={trPm('compo.reserve.aide')} maxLength={200} style={{ flexGrow: 1, flexBasis: 220 }} testID={`${testID}-reserve-${i}`} />
              </View>
            ) : null}
            <Champ theme={theme} libelle={trPm('compo.note')} valeur={l.note} onChanger={v => maj(l.id, { note: v })} maxLength={200} testID={`${testID}-note-${i}`} />
          </View>
        );
      })}
      {compo.length < 8 ? (
        <View style={{ flexDirection: 'row' }}>
          <BoutonHub theme={theme} titre={trPm('compo.ajouter')} icone="plus" onPress={() => onChanger([...compo, ligneCompo()])} testID={`${testID}-ajouter`} />
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Une map

function EditeurCarte({ theme, modele, assets, liens, carte, precedente, onChanger, onRetirer }: { theme: ThemeHub; modele: ModeleStrat; assets: Assets | undefined; liens: LiensPlan | undefined; carte: CarteSaisie; precedente: CarteSaisie | undefined; onChanger(c: CarteSaisie): void; onRetirer(): void }) {
  const maj = (p: Partial<CarteSaisie>) => onChanger({ ...carte, ...p });
  const sides = MODELES[modele]?.sides ? ['attaque', 'defense'] : [...(MODELES[modele]?.modes ?? [])];
  const memeCarte = (nom: string | null | undefined) => normaliser(nom) === normaliser(carte.carte.nom);
  // Strats et entrées du playbook : celles de cette map d'abord.
  const sources = useMemo(() => {
    const tri = <T extends { carte: string | null }>(l: readonly T[]) => [...l].sort((a, b) => Number(memeCarte(b.carte)) - Number(memeCarte(a.carte)));
    return [
      ...tri(liens?.strats ?? []).map(s => ({ id: `s:${s.id}`, nom: s.titre, detail: s.carte, groupe: trPm('strats.source.strat') })),
      ...tri(liens?.playbook ?? []).map(e => ({ id: `p:${e.id}`, nom: e.titre, detail: e.carte ?? undefined, groupe: trPm('strats.source.playbook') })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépend du nom de la map
  }, [liens, carte.carte.nom]);
  const lineupsDispo = (liens?.lineups ?? []).filter(l => memeCarte(l.carte));
  const majStrat = (id: string, p: Partial<StratPlan>) => maj({ strats: carte.strats.map(s => (s.id === id ? { ...s, ...p } : s)) });
  const texteLong = (cle: 'conditions' | 'tendances' | 'calls' | 'notes') => <Champ theme={theme} libelle={trPm(cle)} valeur={carte[cle]} onChanger={v => maj({ [cle]: v } as Partial<CarteSaisie>)} placeholder={cle === 'notes' ? trPm('notes.aide') : trPm(`${cle}.aide` as ClePm)} maxLength={1500} multiligne testID={`esport-plan-form-${cle}`} />;
  return (
    <View testID={`esport-plan-form-carte-${carte.id}`} style={{ gap: ESP.m }}>
      {MODELES[modele]?.modes.length ? (
        <Segments<string> theme={theme} libelle={trPm('carte.mode')} valeur={carte.mode} options={[['', trPm('carte.mode.aucun')], ...MODELES[modele].modes.map(m => [m, nomSide(m)] as const)]} onChoisir={v => maj({ mode: v })} testID="esport-plan-form-mode" />
      ) : null}

      <View style={{ gap: ESP.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.s, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trPm('compo')}</Text>
            <Text style={attenue(theme, 12)}>{trPm('compo.aide')}</Text>
          </View>
          {precedente ? <BoutonHub theme={theme} titre={trPm('compo.reprendre', { nom: precedente.carte.nom })} onPress={() => maj({ compo: precedente.compo.map(l => ({ ...l, id: idCourt() })) })} testID="esport-plan-form-compo-reprendre" /> : null}
        </View>
        <EditeurCompo theme={theme} modele={modele} assets={assets} membres={liens?.membres ?? []} compo={carte.compo} onChanger={compo => maj({ compo })} />
      </View>

      <View style={{ gap: ESP.xs }} testID="esport-plan-form-strats">
        <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trPm('strats')}</Text>
        <Text style={attenue(theme, 12)}>{trPm('strats.aide')}</Text>
        {carte.strats.map((s, i) => (
          <Rangee key={s.id} theme={theme} n={i} total={carte.strats.length} onDeplacer={sens => maj({ strats: deplacer(carte.strats, i, sens) })} onRetirer={() => maj({ strats: carte.strats.filter(x => x.id !== s.id) })} libelleRetirer={trPm('strats.retirer', { n: i + 1 })} testID={`esport-plan-form-strat-${i}`}>
            <View style={{ gap: ESP.xs, alignItems: 'flex-start', maxWidth: '100%' }}>
              {sides.length ? <Segments<string> theme={theme} libelle={trPm(MODELES[modele]?.sides ? 'strats.side' : 'strats.mode')} valeur={s.side} options={[['', trPm('strats.side.')], ...sides.map(x => [x, nomSide(x)] as const)]} onChoisir={v => majStrat(s.id, { side: v })} testID={`esport-plan-form-strat-side-${i}`} /> : null}
              <Choix<TypeRound> theme={theme} libelle={trPm('strats.type')} valeur={s.type} repliable={false} options={TYPES_ROUND.map(t => ({ id: t, nom: trPm(`strats.type.${t}` as ClePm) }))} onChoisir={v => majStrat(s.id, { type: v })} testID={`esport-plan-form-strat-type-${i}`} />
            </View>
            {sources.length ? (
              <SelecteurRepliable
                theme={theme}
                libelle={trPm('strats.source')}
                valeur={s.strat ? `s:${s.strat}` : s.playbook ? `p:${s.playbook}` : ''}
                vide={trPm('strats.source.aucune')}
                options={[{ id: '', nom: trPm('strats.source.aucune') }, ...sources]}
                onChoisir={id => {
                  const source = sources.find(x => x.id === id);
                  majStrat(s.id, { strat: id.startsWith('s:') ? id.slice(2) : null, playbook: id.startsWith('p:') ? id.slice(2) : null, titre: source?.nom ?? s.titre });
                }}
                testID={`esport-plan-form-strat-source-${i}`}
                style={{ maxWidth: 520 }}
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap' }}>
              {!s.strat && !s.playbook ? <Champ theme={theme} libelle={trPm('strats.titre')} valeur={s.titre} onChanger={v => majStrat(s.id, { titre: v })} placeholder={trPm('strats.titre.aide')} maxLength={80} style={{ flexGrow: 1, flexBasis: 220 }} testID={`esport-plan-form-strat-titre-${i}`} /> : null}
              <Champ theme={theme} libelle={trPm('strats.note')} valeur={s.note} onChanger={v => majStrat(s.id, { note: v })} placeholder={trPm('strats.note.aide')} maxLength={300} style={{ flexGrow: 1, flexBasis: 220 }} testID={`esport-plan-form-strat-note-${i}`} />
            </View>
          </Rangee>
        ))}
        {carte.strats.length < 30 ? (
          <View style={{ flexDirection: 'row' }}>
            <BoutonHub theme={theme} titre={trPm('strats.ajouter')} icone="plus" onPress={() => maj({ strats: [...carte.strats, { id: idCourt(), side: carte.strats[carte.strats.length - 1]?.side ?? (MODELES[modele]?.sides ? 'attaque' : ''), type: 'defaut', strat: null, playbook: null, titre: '', note: '' }] })} testID="esport-plan-form-strat-ajouter" />
          </View>
        ) : null}
      </View>

      {liens?.lineups.length || carte.lineups.length ? (
        <View style={{ gap: ESP.xs }} testID="esport-plan-form-lineups">
          <Text style={{ ...texte(theme, 14), fontWeight: '700' }}>{trPm('lineups')}</Text>
          <Text style={attenue(theme, 12)}>{trPm('lineups.aide')}</Text>
          {carte.lineups.map(id => {
            const l = liens?.lineups.find(x => x.id === id);
            const titre = l?.titre ?? '…';
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, minHeight: 44, paddingLeft: ESP.xs, borderRadius: 10, borderWidth: 1, borderColor: theme.ligne }}>
                <Icone nom="viseur" taille={16} couleur={theme.attenue} />
                <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <Text numberOfLines={1} style={{ ...texte(theme, 14), fontWeight: '600' }}>
                    {titre}
                  </Text>
                  {l && (l.personnage || l.capacite) ? (
                    <Text numberOfLines={1} style={attenue(theme, 12)}>
                      {[l.personnage, l.capacite].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <BoutonIcone theme={theme} icone="croix" libelle={trPm('lineups.retirer', { titre })} onPress={() => maj({ lineups: carte.lineups.filter(x => x !== id) })} testID={`esport-plan-form-lineup-retirer-${id}`} />
              </View>
            );
          })}
          {lineupsDispo.filter(l => !carte.lineups.includes(l.id)).length ? (
            <SelecteurRepliable
              theme={theme}
              libelle={trPm('lineups.ajouter')}
              valeur=""
              vide={trPm('lineups.ajouter')}
              options={lineupsDispo.filter(l => !carte.lineups.includes(l.id)).map(l => ({ id: l.id, nom: l.titre, detail: [l.personnage, l.capacite].filter(Boolean).join(' · ') }))}
              onChoisir={id => id && carte.lineups.length < 20 && maj({ lineups: [...carte.lineups, id] })}
              testID="esport-plan-form-lineup-ajouter"
              style={{ maxWidth: 520 }}
            />
          ) : lineupsDispo.length === 0 ? (
            <Text style={attenue(theme, 12)}>{trPm('lineups.aucun_dispo')}</Text>
          ) : null}
        </View>
      ) : null}

      {texteLong('conditions')}
      {texteLong('tendances')}
      {texteLong('calls')}
      {texteLong('notes')}
      <View style={{ flexDirection: 'row' }}>
        <BoutonConfirme theme={theme} titre={trPm('carte.retirer', { nom: carte.carte.nom })} confirmation={trPm('carte.retirer.confirmer', { nom: carte.carte.nom })} onConfirme={onRetirer} testID="esport-plan-form-carte-retirer" />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Éditeur

interface Etat {
  titre: string;
  format: FormatPlan;
  /** « <evenementId>|<occurrence> », ou vide. */
  evenement: string;
  date: string;
  adversaireId: string;
  adversaireNom: string;
  tournoiMatchId: string;
  contenu: SaisieContenu;
}

const etatDe = (p: Plan): Etat => ({
  titre: p.titre,
  format: p.format,
  evenement: p.evenement ? `${p.evenement.id}|${p.evenement.occurrence}` : '',
  date: p.dateMatch ?? '',
  adversaireId: p.adversaire?.id ?? '',
  adversaireNom: p.adversaire?.nom ?? '',
  tournoiMatchId: p.tournoiMatch?.id ?? '',
  contenu: versSaisie(p.contenu),
});

export function EditeurPlan({ theme, client, api, teamId, plan, assets, modele, large, onAnnuler, onFini }: { theme: ThemeHub; client: ClientEsport; api: ApiPlans; teamId: string; plan: Plan; assets: Assets | undefined; modele: ModeleStrat; large: boolean; onAnnuler(): void; onFini(p: Plan): void }) {
  const [courant, setCourant] = useState(plan);
  const [s, setS] = useState<Etat>(() => etatDe(plan));
  const [liens, setLiens] = useState<LiensPlan | undefined>();
  const [carteId, setCarteId] = useState<string | undefined>(plan.contenu.cartes[0]?.id);
  const [nouvelleCarte, setNouvelleCarte] = useState('');
  const { enCours, erreur, agir } = useAgir();
  const verrou = useVerrouOptimiste(client, `/teams/${teamId}/plans/${courant.id}`);
  const maj = (p: Partial<Etat>) => setS(x => ({ ...x, ...p }));
  const majContenu = (p: Partial<SaisieContenu>) => setS(x => ({ ...x, contenu: { ...x.contenu, ...p } }));
  useEffect(() => {
    void agir('', async () => setLiens(await api.liens(teamId)));
  }, [agir, api, teamId]);

  const cartes = s.contenu.cartes;
  const carte = cartes.find(c => c.id === carteId) ?? cartes[0];
  const index = carte ? cartes.indexOf(carte) : -1;
  const ajouterCarte = (ref: Reference | null) => {
    if (!ref || cartes.length >= 9) return;
    const c = carteVide(ref, modele, cartes[cartes.length - 1]?.compo);
    majContenu({ cartes: [...cartes, c] });
    setCarteId(c.id);
    setNouvelleCarte('');
  };
  const majVeto = (id: string, p: Partial<EtapeVeto>) => majContenu({ veto: s.contenu.veto.map(v => (v.id === id ? { ...v, ...p } : v)) });
  const evenements = liens?.evenements ?? [];
  // L'événement déjà lié reste proposé même s'il est passé.
  const optionsEvenements = [
    { id: '', nom: trPm('edit.evenement.aucun') },
    ...(plan.evenement && !evenements.some(e => `${e.id}|${e.occurrence}` === s.evenement) && s.evenement ? [{ id: s.evenement, nom: plan.evenement.titre, detail: jourPlan(plan.dateMatch) ?? undefined }] : []),
    ...evenements.map(e => ({ id: `${e.id}|${e.occurrence}`, nom: e.titre, detail: `${trPm(`edit.type.${e.type}` as ClePm)} · ${trPm('date.a', { jour: jourPlan(e.jour, { weekday: 'short', day: 'numeric', month: 'short' }) ?? e.jour, heure: e.heure })}` })),
  ];
  const complet = s.titre.trim().length >= 2;

  const corps = () => {
    const [evenementId, occurrence] = s.evenement ? s.evenement.split('|') : [null, null];
    return {
      titre: s.titre.trim(),
      format: s.format,
      evenementId,
      occurrence,
      ...(evenementId ? {} : { date: s.date || null }),
      adversaireId: s.adversaireId || null,
      ...(s.adversaireId ? {} : { adversaireNom: s.adversaireNom.trim() }),
      tournoiMatchId: s.tournoiMatchId || null,
      // Lignes de composition et strats laissées vides : écartées (le serveur refuserait une strat sans titre).
      contenu: { ...s.contenu, cartes: cartes.map(c => ({ ...c, strats: c.strats.filter(x => x.strat || x.playbook || x.titre.trim()) })), checklist: s.contenu.checklist.filter(e => e.texte.trim()) },
    };
  };
  const enregistrer = () =>
    void agir('enregistrement', async () => {
      if (!complet) throw new Error(trPm('edit.incomplet'));
      try {
        const p = await api.modifier(teamId, courant.id, corps());
        setCourant(p);
        onFini(p);
      } catch (e) {
        if (verrou.signalerConflit(e)) return undefined;
        throw e;
      }
      return undefined;
    });
  const recharger = async () => {
    const p = await api.detail(teamId, courant.id);
    setCourant(p);
    setS(etatDe(p));
  };

  const boutons = (suffixe = '') => (
    <View style={{ flexDirection: 'row', gap: ESP.xs, flexWrap: 'wrap' }}>
      <BoutonHub theme={theme} titre={trPm('enregistrer')} variante="plein" icone="coche" desactive={Boolean(enCours)} onPress={enregistrer} testID={`esport-plan-form-enregistrer${suffixe}`} />
      <BoutonHub theme={theme} titre={trPm('annuler')} onPress={onAnnuler} testID={`esport-plan-form-annuler${suffixe}`} />
    </View>
  );

  return (
    <View testID="esport-plan-form" style={{ gap: ESP.m }}>
      <EnTetePage theme={theme} large={large} titre={trPm('edit.titre')} action={large ? boutons('-haut') : undefined} />
      <BandeauConflit theme={theme} verrou={verrou} onRecharger={recharger} testID="esport-plan-form-conflit" />
      <Retours theme={theme} erreur={erreur} prefixe="esport-plan-form" />

      <Section theme={theme} titre={trPm('edit.general')} testID="esport-plan-form-general">
        <Champ theme={theme} libelle={trPm('edit.nom')} valeur={s.titre} onChanger={v => maj({ titre: v })} maxLength={80} testID="esport-plan-form-titre" />
        {!plan.estModele ? (
          <>
            {optionsEvenements.length > 1 ? (
              <SelecteurRepliable
                theme={theme}
                libelle={trPm('edit.evenement')}
                aide={trPm('edit.evenement.aide')}
                valeur={s.evenement}
                vide={trPm('edit.evenement.aucun')}
                options={optionsEvenements}
                onChoisir={id => {
                  const e = evenements.find(x => `${x.id}|${x.occurrence}` === id);
                  // L'adversaire de l'événement est repris si le plan n'en a pas.
                  maj({ evenement: id, ...(e ? { date: e.jour } : {}), ...(e?.adversaireId && !s.adversaireId && !s.adversaireNom ? { adversaireId: e.adversaireId, adversaireNom: liens?.adversaires.find(a => a.id === e.adversaireId)?.nom ?? '' } : {}) });
                }}
                testID="esport-plan-form-evenement"
                style={{ maxWidth: 560 }}
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {!s.evenement ? <ChampDate theme={theme} libelle={trPm('edit.date')} valeur={s.date} onChanger={date => maj({ date })} style={{ flexGrow: 1, minWidth: 160, maxWidth: 260 }} testID="esport-plan-form-date" /> : null}
              {liens?.adversaires.length ? (
                <SelecteurRepliable
                  theme={theme}
                  libelle={trPm('edit.adversaire')}
                  valeur={s.adversaireId}
                  vide={trPm('edit.adversaire.aucun')}
                  options={[{ id: '', nom: trPm('edit.adversaire.aucun') }, ...liens.adversaires.map(a => ({ id: a.id, nom: a.nom }))]}
                  onChoisir={id => maj({ adversaireId: id, adversaireNom: liens.adversaires.find(a => a.id === id)?.nom ?? (id ? s.adversaireNom : '') })}
                  testID="esport-plan-form-adversaire"
                  style={{ flexGrow: 1, flexBasis: 220, maxWidth: 360 }}
                />
              ) : null}
              {!s.adversaireId ? <Champ theme={theme} libelle={trPm('edit.adversaire.nom')} valeur={s.adversaireNom} onChanger={v => maj({ adversaireNom: v })} maxLength={60} style={{ flexGrow: 1, flexBasis: 200, maxWidth: 320 }} testID="esport-plan-form-adversaire-nom" /> : null}
            </View>
            {liens?.matchs.length ? (
              <SelecteurRepliable theme={theme} libelle={trPm('edit.tournoi')} valeur={s.tournoiMatchId} vide={trPm('edit.tournoi.aucun')} options={[{ id: '', nom: trPm('edit.tournoi.aucun') }, ...liens.matchs.map(m => ({ id: m.id, nom: [m.tournoi, m.tour].filter(Boolean).join(' · ') }))]} onChoisir={id => maj({ tournoiMatchId: id })} testID="esport-plan-form-tournoi" style={{ maxWidth: 520 }} />
            ) : null}
          </>
        ) : null}
        {avecVeto(modele) ? <Segments<FormatPlan> theme={theme} libelle={trPm('format')} valeur={s.format} options={FORMATS_PLAN.map(f => [f, trPm(`format.${f}` as ClePm)] as const)} onChoisir={v => maj({ format: v })} testID="esport-plan-form-format" /> : null}
      </Section>

      {avecVeto(modele) ? (
        <Section
          theme={theme}
          titre={trPm('veto')}
          aide={trPm('veto.aide')}
          testID="esport-plan-form-veto"
          action={s.format && s.contenu.veto.length === 0 ? <BoutonHub theme={theme} titre={trPm('veto.type', { format: trPm(`format.${s.format}` as ClePm) })} onPress={() => majContenu({ veto: vetoType(s.format) })} testID="esport-plan-form-veto-type" /> : undefined}>
          {s.contenu.veto.length === 0 ? <Text style={attenue(theme, 13)}>{trPm('veto.vide')}</Text> : null}
          {s.contenu.veto.map((v, i) => (
            <Rangee key={v.id} theme={theme} n={i} total={s.contenu.veto.length} onDeplacer={sens => majContenu({ veto: deplacer(s.contenu.veto, i, sens) })} onRetirer={() => majContenu({ veto: s.contenu.veto.filter(x => x.id !== v.id) })} libelleRetirer={`${trPm('retirer')} : ${trPm('veto.etape', { n: i + 1 })}`} testID={`esport-plan-form-veto-${i}`}>
              <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Segments<CampVeto> theme={theme} libelle={trPm('veto.camp')} valeur={v.camp} options={[['nous', trPm('veto.camp.nous')], ['eux', trPm('veto.camp.eux')]]} onChoisir={camp => majVeto(v.id, { camp })} testID={`esport-plan-form-veto-camp-${i}`} />
                <Segments<ActionVeto> theme={theme} libelle={trPm('veto.action')} valeur={v.action} options={ACTIONS_VETO.map(a => [a, trPm(`veto.action.${a}` as ClePm)] as const)} onChoisir={action => majVeto(v.id, { action })} testID={`esport-plan-form-veto-action-${i}`} />
              </View>
              <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <ChoixCarte theme={theme} assets={assets} libelle={trPm('veto.carte')} valeur={v.carte} vide={trPm('veto.carte.libre')} onChoisir={carteVeto => majVeto(v.id, { carte: carteVeto })} testID={`esport-plan-form-veto-carte-${i}`} />
                {v.replis.map((r, k) => (
                  <ChoixCarte key={k} theme={theme} assets={assets} libelle={`${trPm('veto.replis')} ${k + 1}`} valeur={r} vide={trPm('choix.aucun')} onChoisir={ref => majVeto(v.id, { replis: ref ? v.replis.map((x, j) => (j === k ? ref : x)) : v.replis.filter((_, j) => j !== k) })} testID={`esport-plan-form-veto-repli-${i}-${k}`} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {v.carte && v.replis.length < 3 && (assets?.cartes.length ?? 0) > 0 ? <BoutonHub theme={theme} titre={trPm('veto.repli.ajouter')} onPress={() => majVeto(v.id, { replis: [...v.replis, { cle: null, nom: '' }] })} testID={`esport-plan-form-veto-repli-ajouter-${i}`} /> : null}
                <Champ theme={theme} libelle={trPm('veto.note')} valeur={v.note} onChanger={note => majVeto(v.id, { note })} placeholder={trPm('veto.note.aide')} maxLength={200} style={{ flexGrow: 1, flexBasis: 220 }} testID={`esport-plan-form-veto-note-${i}`} />
              </View>
            </Rangee>
          ))}
          {s.contenu.veto.length < 14 ? (
            <View style={{ flexDirection: 'row' }}>
              <BoutonHub theme={theme} titre={trPm('veto.ajouter')} icone="plus" onPress={() => majContenu({ veto: [...s.contenu.veto, { id: idCourt(), action: 'ban', camp: s.contenu.veto.length % 2 === 0 ? 'nous' : 'eux', carte: null, replis: [], note: '' }] })} testID="esport-plan-form-veto-ajouter" />
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section theme={theme} titre={trPm('page.maps')} testID="esport-plan-form-maps">
        {cartes.length ? <PastillesFiltre theme={theme} libelle={trPm('page.maps')} valeur={carte?.id ?? ''} tout="" sansTout dense={large} options={cartes.map(c => ({ id: c.id, nom: c.carte.nom }))} onChoisir={setCarteId} testID="esport-plan-form-onglet" /> : <Text style={attenue(theme, 13)}>{trPm('page.sans_map')}</Text>}
        {cartes.length < 9 ? (
          <View style={{ flexDirection: 'row', gap: ESP.s, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {(assets?.cartes.length ?? 0) > 0 ? (
              <SelecteurRepliable
                theme={theme}
                libelle={trPmModele('carte.ajouter', modele)}
                valeur=""
                vide={trPmModele('carte.choisir', modele)}
                options={(assets?.cartes ?? []).filter(c => !cartes.some(x => x.carte.cle === c.cle)).map(c => ({ id: c.cle, nom: c.nom }))}
                onChoisir={id => ajouterCarte(refCarte(assets, id))}
                testID="esport-plan-form-carte-ajouter"
                style={{ flexGrow: 1, flexBasis: 220, maxWidth: 360 }}
              />
            ) : null}
            <Champ theme={theme} libelle={(assets?.cartes.length ?? 0) > 0 ? trPm('carte.libre') : trPmModele('carte.ajouter', modele)} valeur={nouvelleCarte} onChanger={setNouvelleCarte} maxLength={60} style={{ flexGrow: 1, flexBasis: 180, maxWidth: 280 }} testID="esport-plan-form-carte-libre" />
            <BoutonHub theme={theme} titre={trPm('ajouter')} desactive={nouvelleCarte.trim().length < 2} onPress={() => ajouterCarte({ cle: null, nom: nouvelleCarte.trim() })} testID="esport-plan-form-carte-libre-ok" />
          </View>
        ) : null}
        {carte ? (
          <View style={{ gap: ESP.s, paddingTop: ESP.s, borderTopWidth: 1, borderTopColor: theme.ligne }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, flexWrap: 'wrap' }}>
              <Text accessibilityRole="header" style={{ ...texte(theme, 17), fontWeight: '800', flex: 1, minWidth: 120 }}>
                {carte.carte.nom}
              </Text>
              <BoutonIcone theme={theme} icone="chevron-gauche" libelle={trPm('monter')} desactive={index <= 0} onPress={() => majContenu({ cartes: deplacer(cartes, index, -1) })} testID="esport-plan-form-carte-avant" />
              <BoutonIcone theme={theme} icone="chevron-droite" libelle={trPm('descendre')} desactive={index >= cartes.length - 1} onPress={() => majContenu({ cartes: deplacer(cartes, index, 1) })} testID="esport-plan-form-carte-apres" />
            </View>
            <EditeurCarte
              key={carte.id}
              theme={theme}
              modele={modele}
              assets={assets}
              liens={liens}
              carte={carte}
              precedente={index > 0 ? cartes[index - 1] : undefined}
              onChanger={c => majContenu({ cartes: cartes.map(x => (x.id === c.id ? c : x)) })}
              onRetirer={() => {
                majContenu({ cartes: cartes.filter(x => x.id !== carte.id) });
                setCarteId(cartes.find(x => x.id !== carte.id)?.id);
              }}
            />
          </View>
        ) : null}
      </Section>

      <Section
        theme={theme}
        titre={trPm('checklist')}
        aide={trPm('checklist.aide')}
        testID="esport-plan-form-checklist"
        action={s.contenu.checklist.length === 0 ? <BoutonHub theme={theme} titre={trPm('checklist.type')} onPress={() => majContenu({ checklist: CHECKLIST_DEFAUT.map(cle => ({ id: idCourt(), texte: trPm(cle) })) })} testID="esport-plan-form-checklist-type" /> : undefined}>
        {s.contenu.checklist.length === 0 ? <Text style={attenue(theme, 13)}>{trPm('checklist.vide')}</Text> : null}
        {s.contenu.checklist.map((e, i) => (
          <View key={e.id} style={{ flexDirection: 'row', gap: ESP.xs, alignItems: 'flex-end' }}>
            <Champ theme={theme} libelle={trPm('checklist.element', { n: i + 1 })} valeur={e.texte} onChanger={v => majContenu({ checklist: s.contenu.checklist.map(x => (x.id === e.id ? { ...x, texte: v } : x)) })} maxLength={120} style={{ flex: 1, minWidth: 0 }} testID={`esport-plan-form-checklist-${i}`} />
            <BoutonIcone theme={theme} icone="croix" libelle={trPm('checklist.retirer', { n: i + 1 })} onPress={() => majContenu({ checklist: s.contenu.checklist.filter(x => x.id !== e.id) })} testID={`esport-plan-form-checklist-retirer-${i}`} />
          </View>
        ))}
        {s.contenu.checklist.length < 30 ? (
          <View style={{ flexDirection: 'row' }}>
            <BoutonHub theme={theme} titre={trPm('checklist.ajouter')} icone="plus" onPress={() => majContenu({ checklist: [...s.contenu.checklist, { id: idCourt(), texte: '' }] })} testID="esport-plan-form-checklist-ajouter" />
          </View>
        ) : null}
      </Section>

      <Section theme={theme} titre={trPm('notes.globales')} testID="esport-plan-form-notes-section">
        <Champ theme={theme} libelle={trPm('notes')} valeur={s.contenu.notes} onChanger={v => majContenu({ notes: v })} placeholder={trPm('notes.aide')} maxLength={4000} multiligne testID="esport-plan-form-notes" />
      </Section>
      <Retours theme={theme} erreur={erreur} prefixe="esport-plan-form-bas" />
      {boutons()}
    </View>
  );
}
