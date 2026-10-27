/**
 * Pipeline des prospects, façon Kanban : une colonne par étape (nombre, valeur estimée), une carte par prospect
 * (contact, valeur, priorité, prochaine action — en rouge si elle est passée). Sur PC, les colonnes défilent
 * côte à côte ; sur téléphone, une étape à la fois (onglets). Déplacement accessible par le menu ⋯ de la carte
 * (monter, descendre, étape précédente / suivante, déplacer vers…) ; vers « Perdu », la raison est demandée ;
 * vers « Signé », la conversion en partenaire est proposée.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import { PRIORITES, type ApiSponsors, type Etape, type Pipeline as DonneesPipeline, type Priorite, type ResumeProspect } from '../../sponsors/api';
import { cibleDeplacement, etapesVisibles, formaterMontant, nomEtape, prospectsDe } from '../../sponsors/regles';
import { trSp, trnSp, type CleSp } from '../../i18n/sponsors';
import { Retours, styles, useAgir } from '../commun';
import { Badge, Carte, ESP, EtatVide, MenuActions, Onglets, SqueletteCartes, Volet, attenue, texte } from '../design';
import { quand } from '../cm/commun';
import { BadgePriorite, nomCompte } from './commun';

export function Pipeline({
  theme,
  api,
  large,
  version,
  onOuvrir,
  onNouveau,
  onConvertir,
}: {
  theme: ThemeHub;
  api: ApiSponsors;
  large: boolean;
  /** Change quand une fiche a été modifiée (rechargement). */
  version: number;
  onOuvrir(id: string): void;
  onNouveau(): void;
  onConvertir(id: string): void;
}) {
  const [d, setD] = useState<DonneesPipeline | undefined>();
  const [q, setQ] = useState('');
  const [priorite, setPriorite] = useState<Priorite | ''>('');
  const [etapeMobile, setEtapeMobile] = useState<string | undefined>();
  const [perte, setPerte] = useState<{ id: string; etapeId: string; index: number; raison: string } | undefined>();
  const [signe, setSigne] = useState<ResumeProspect | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setD(await api.pipeline({ q: q.trim() || undefined, priorite: priorite || undefined })), [api, q, priorite]);
  useEffect(() => {
    const t = setTimeout(() => void agir('', charger), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [agir, charger, version, q]);
  const etapes = useMemo(() => (d ? etapesVisibles(d.etapes, d.prospects) : []), [d]);
  const deplacer = (p: ResumeProspect, cible: { etapeId: string; index: number }, raisonPerte?: string) =>
    agir('deplacer', async () => {
      const r = await api.deplacerProspect(p.id, { ...cible, ...(raisonPerte ? { raisonPerte } : {}) });
      setPerte(undefined);
      await charger();
      if (r.convertible) setSigne(p);
    });
  const demander = (p: ResumeProspect, cible: { etapeId: string; index: number }) => {
    const e = d?.etapes.find(x => x.id === cible.etapeId);
    if (e?.issue === 'perdue' && p.etapeId !== e.id) setPerte({ id: p.id, ...cible, raison: '' });
    else void deplacer(p, cible);
  };
  const colonne = (e: Etape) => {
    const liste = d ? prospectsDe(d.prospects, e.id) : [];
    const valeur = liste.reduce((s, p) => s + p.valeurEstimee, 0);
    return (
      <View key={e.id} style={{ width: large ? 290 : '100%', gap: ESP.xs }} testID={`esport-sp-colonne-${e.cle ?? e.id}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: ESP.xs, borderTopWidth: 4, borderTopColor: e.couleur, paddingTop: ESP.xs }}>
          <Text accessibilityRole="header" style={{ ...texte(theme, 15), fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
            {nomEtape(e)}
          </Text>
          <Badge theme={theme} texte={String(liste.length)} />
          {valeur ? <Text style={attenue(theme)}>{formaterMontant(valeur)}</Text> : null}
        </View>
        {!liste.length ? <Text style={attenue(theme)}>{trSp('pipeline.colonne_vide')}</Text> : null}
        {liste.map(p => (
          <CarteProspect key={p.id} theme={theme} p={p} d={d!} gerer={Boolean(d?.gerer)} onOuvrir={() => onOuvrir(p.id)} onDeplacer={c => demander(p, c)} />
        ))}
      </View>
    );
  };
  const choisie = etapes.find(e => e.id === etapeMobile) ?? etapes[0];
  return (
    <View style={{ gap: ESP.m }} testID="esport-sp-pipeline">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-sp-pipeline" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <Champ theme={theme} libelle={trSp('pipeline.rechercher')} valeur={q} onChanger={setQ} maxLength={80} testID="esport-sp-pipeline-recherche" style={{ flex: 1, minWidth: 200 }} />
        <MenuActions
          theme={theme}
          titreBouton={priorite ? trSp(`priorite.${priorite}` as CleSp) : trSp('pipeline.toutes_priorites')}
          libelle={trSp('champ.priorite')}
          testID="esport-sp-pipeline-priorite"
          actions={[{ titre: trSp('pipeline.toutes_priorites'), onPress: () => setPriorite('') }, ...PRIORITES.map(x => ({ titre: trSp(`priorite.${x}` as CleSp), onPress: () => setPriorite(x), testID: `esport-sp-pipeline-priorite-${x}` }))]}
        />
        {d?.gerer ? <BoutonHub theme={theme} titre={trSp('pipeline.nouveau')} variante="plein" onPress={onNouveau} testID="esport-sp-prospect-nouveau" /> : null}
      </View>
      {!d && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {d && !d.prospects.length && !q && !priorite ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="◎" titre={trSp('pipeline.vide')} texte={trSp('pipeline.vide_texte')} action={d.gerer ? { titre: trSp('pipeline.nouveau'), onPress: onNouveau, testID: 'esport-sp-pipeline-vide-nouveau' } : undefined} />
        </Carte>
      ) : null}
      {d && (d.prospects.length || q || priorite) ? (
        large ? (
          <ScrollView horizontal contentContainerStyle={{ gap: ESP.m, paddingBottom: ESP.s, alignItems: 'flex-start' }} testID="esport-sp-kanban">
            {etapes.map(colonne)}
          </ScrollView>
        ) : (
          <View style={{ gap: ESP.s }} testID="esport-sp-kanban">
            <Onglets theme={theme} prefixe="esport-sp-etape" actif={choisie?.id ?? ''} onChoisir={setEtapeMobile} entrees={etapes.map(e => ({ id: e.id, libelle: `${nomEtape(e)} (${prospectsDe(d.prospects, e.id).length})` }))} defilant />
            {choisie ? colonne(choisie) : null}
          </View>
        )
      ) : null}
      {perte && d ? (
        <Volet theme={theme} visible titre={trSp('prospect.raison_perte')} onFermer={() => setPerte(undefined)} testID="esport-sp-perte">
          <Champ theme={theme} libelle={trSp('prospect.raison_perte')} valeur={perte.raison} onChanger={raison => setPerte({ ...perte, raison })} maxLength={300} testID="esport-sp-perte-raison" />
          <BoutonHub
            theme={theme}
            titre={trSp('prospect.marquer_perdu')}
            variante="danger"
            desactive={perte.raison.trim().length < 2}
            onPress={() => {
              const p = d.prospects.find(x => x.id === perte.id);
              if (p) void deplacer(p, { etapeId: perte.etapeId, index: perte.index }, perte.raison.trim());
            }}
            testID="esport-sp-perte-ok"
          />
        </Volet>
      ) : null}
      {signe ? (
        <Volet theme={theme} visible titre={trSp('pipeline.signe_titre', { nom: signe.nom })} onFermer={() => setSigne(undefined)} testID="esport-sp-signe">
          <Text style={texte(theme)}>{trSp('prospect.signe_aide')}</Text>
          <BoutonHub
            theme={theme}
            titre={trSp('prospect.convertir')}
            variante="plein"
            onPress={() => {
              setSigne(undefined);
              onConvertir(signe.id);
            }}
            testID="esport-sp-signe-convertir"
          />
          <BoutonHub theme={theme} titre={trSp('pipeline.plus_tard')} onPress={() => setSigne(undefined)} testID="esport-sp-signe-plus-tard" />
        </Volet>
      ) : null}
    </View>
  );
}

function CarteProspect({ theme, p, d, gerer, onOuvrir, onDeplacer }: { theme: ThemeHub; p: ResumeProspect; d: DonneesPipeline; gerer: boolean; onOuvrir(): void; onDeplacer(c: { etapeId: string; index: number }): void }) {
  const menu = (sens: 'haut' | 'bas' | 'precedente' | 'suivante', cle: CleSp) => {
    const c = cibleDeplacement(d.etapes, d.prospects, p.id, sens);
    return c ? { titre: trSp(cle), onPress: () => onDeplacer({ etapeId: c.etapeId, index: c.index }), testID: `esport-sp-carte-${p.id}-${sens}` } : null;
  };
  return (
    <Carte theme={theme} dense testID={`esport-sp-carte-${p.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: ESP.xs }}>
        <BoutonTitre theme={theme} titre={p.nom} onPress={onOuvrir} testID={`esport-sp-carte-${p.id}-ouvrir`} />
        {gerer ? (
          <MenuActions
            theme={theme}
            libelle={trSp('pipeline.deplacer_nom', { nom: p.nom })}
            testID={`esport-sp-carte-${p.id}-menu`}
            actions={[
              menu('haut', 'pipeline.monter'),
              menu('bas', 'pipeline.descendre'),
              menu('precedente', 'pipeline.etape_precedente'),
              menu('suivante', 'pipeline.etape_suivante'),
              ...d.etapes
                .filter(e => !e.archive && e.id !== p.etapeId)
                .map(e => ({ titre: trSp('pipeline.vers', { etape: nomEtape(e) }), onPress: () => onDeplacer({ etapeId: e.id, index: prospectsDe(d.prospects, e.id).length }), testID: `esport-sp-carte-${p.id}-vers-${e.cle ?? e.id}` })),
            ]}
          />
        ) : null}
      </View>
      {p.contact ? <Text style={attenue(theme)} numberOfLines={1}>{[p.contact.nom, p.contact.role].filter(Boolean).join(' · ')}</Text> : null}
      <View style={[styles.ligne, { gap: ESP.xxs }]}>
        <BadgePriorite theme={theme} priorite={p.priorite} />
        {p.valeurEstimee ? <Badge theme={theme} texte={formaterMontant(p.valeurEstimee)} /> : null}
        {p.secteur ? <Badge theme={theme} texte={p.secteur} /> : null}
        {p.partenaireId ? <Badge theme={theme} ton="ok" texte={trSp('prospect.converti')} /> : null}
      </View>
      {p.prochaineAction || p.prochaineActionLe ? (
        <Text style={p.actionEnRetard ? { ...texte(theme, 13), color: theme.critique } : texte(theme, 13)} testID={`esport-sp-carte-${p.id}-action`}>
          {`${p.actionEnRetard ? '⚠ ' : '→ '}${[p.prochaineAction, quand(p.prochaineActionLe)].filter(Boolean).join(' · ')}`}
        </Text>
      ) : null}
      {p.raisonPerte ? <Text style={attenue(theme)} numberOfLines={2}>{p.raisonPerte}</Text> : null}
      {p.responsable ? <Text style={attenue(theme)}>{trSp('pipeline.suivi_par', { qui: nomCompte(d.noms, p.responsable) })}</Text> : null}
      {p.teams.length ? <Text style={attenue(theme)} numberOfLines={1}>{p.teams.map(t => d.teams[t] ?? '?').join(', ')}</Text> : null}
    </Carte>
  );
}

function BoutonTitre({ theme, titre, onPress, testID }: { theme: ThemeHub; titre: string; onPress(): void; testID: string }) {
  return (
    <Text accessibilityRole="button" onPress={onPress} testID={testID} style={{ ...texte(theme, 15), fontWeight: '700', flex: 1, minHeight: 32, textDecorationLine: 'underline' }} numberOfLines={2}>
      {titre}
    </Text>
  );
}

export const libelleNombreProspects = (n: number) => trnSp('pipeline.n_prospects', n);
