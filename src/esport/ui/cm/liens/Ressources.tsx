/**
 * Sous-onglet « Ressources » du groupe DATA de l'espace CM (docs/esport/cm.md) : les liens utiles de l'équipe CM.
 * Chaque lien : titre, domaine (aperçu sans aucune image externe : icône locale), description, étiquette, team
 * facultative, épinglage, ordre manuel ; recherche et filtres ; ajout et modification (cm.editer), suppression
 * (cm.gerer) ; ouverture dans un nouvel onglet (`noopener,noreferrer`) ; « où est-il lié » (cartes et dossiers du Drive
 * que le compte voit, avec un raccourci pour y aller). Tout est décidé par le serveur.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import { teinteTransparente, type ThemeHub } from '../../../../hub/themes';
import type { ClientEsport } from '../../../client';
import { apiLiens, deplacerLien, filtrerLiens, type FiltreLiens, type LienCm, type Liaisons, type ListeLiens } from '../../../cm/liens';
import { trLi, trnLi } from '../../../i18n/liens';
import { Icone } from '../../../../ui/icones';
import { useTempsReel } from '../../../tempsReel/hooks';
import { BoutonConfirme, Choix, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, MenuActions, SqueletteCartes, TitreCarte, Volet, attenue, texte } from '../../design';
import { FormLien } from './FormLien';
import { ouvrirAdresse } from './ouvrirAdresse';

export function Ressources({
  theme,
  client,
  large,
  onOuvrirTableau,
  onOuvrirDossier,
}: {
  theme: ThemeHub;
  client: ClientEsport;
  large: boolean;
  onOuvrirTableau?(tableauId: string): void;
  onOuvrirDossier?(portee: string, dossierId: string): void;
}) {
  const api = useMemo(() => apiLiens(client), [client]);
  const [liste, setListe] = useState<ListeLiens | undefined>();
  const [filtre, setFiltre] = useState<FiltreLiens>({});
  const [formulaire, setFormulaire] = useState<{ lien?: LienCm } | undefined>();
  const [ou, setOu] = useState<{ lien: LienCm; liaisons?: Liaisons } | undefined>();
  const [aSupprimer, setASupprimer] = useState<LienCm | undefined>();
  const { erreur, avis, agir } = useAgir();
  const charger = useCallback(async () => setListe(await api.lister()), [api]);
  useEffect(() => {
    void agir('', charger);
  }, [agir, charger]);
  // Temps réel : lien ajouté, modifié, épinglé, lié ou supprimé par un autre → liste relue.
  useTempsReel(client, 'cm', () => void charger().catch(() => undefined));

  const editer = liste?.droits.editer ?? false;
  const gerer = liste?.droits.gerer ?? false;
  const filtres = Boolean(filtre.q?.trim() || filtre.categorie || filtre.team || filtre.epingles);
  const affiches = useMemo(() => filtrerLiens(liste?.liens ?? [], filtre), [liste, filtre]);
  const teamsPresentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of liste?.liens ?? []) if (l.team) m.set(l.team.id, l.team.nom);
    return [...m].map(([id, nom]) => ({ id, nom }));
  }, [liste]);

  const ouvrirOu = (lien: LienCm) => {
    setOu({ lien });
    void agir('liaisons', async () => setOu({ lien, liaisons: await api.liaisons(lien.id) }));
  };
  const delier = async (lien: LienCm, genre: 'carte' | 'dossier', id: string) => {
    await agir('delier', async () => {
      setOu({ lien, liaisons: await api.delier(lien.id, genre, id) });
      await charger();
    });
  };
  const deplacer = (id: string, sens: -1 | 1) => {
    const ids = deplacerLien(liste?.liens ?? [], id, sens);
    if (ids) void agir('ordre', async () => setListe(await api.ordonner(ids)));
  };

  const ligne = (l: LienCm) => {
    const ordre = editer && !filtres;
    const premier = deplacerLien(liste?.liens ?? [], l.id, -1) === null;
    const dernier = deplacerLien(liste?.liens ?? [], l.id, 1) === null;
    return (
      <Carte key={l.id} theme={theme} dense testID={`esport-cm-lien-${l.id}`} accent={l.epingle ? theme.accent : undefined}>
        <View style={{ flexDirection: 'row', gap: ESP.s, alignItems: 'flex-start', minWidth: 0 }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: teinteTransparente(theme.accent, 0.12) }}>
            <Icone nom="globe" taille={20} couleur={theme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Pressable accessibilityRole="link" accessibilityLabel={trLi('ouvrir_lien', { titre: l.titre })} onPress={() => ouvrirAdresse(l.url)} testID={`esport-cm-lien-${l.id}-ouvrir`}>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} numberOfLines={2}>
                {l.titre}
              </Text>
            </Pressable>
            <Text style={{ ...attenue(theme, 13), color: theme.accent }} numberOfLines={1} testID={`esport-cm-lien-${l.id}-hote`}>
              {l.hote}
            </Text>
            {l.description ? (
              <Text style={attenue(theme, 14)} numberOfLines={3}>
                {l.description}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.ligne, { gap: ESP.xxs }]}>
          {l.epingle ? <Badge theme={theme} texte={trLi('epingle')} ton="accent" icone="epingle" testID={`esport-cm-lien-${l.id}-epingle`} /> : null}
          {l.categorie ? <Badge theme={theme} texte={l.categorie} testID={`esport-cm-lien-${l.id}-categorie`} /> : null}
          {l.team ? <Badge theme={theme} texte={trLi('form.team_de', { nom: l.team.nom })} testID={`esport-cm-lien-${l.id}-team`} /> : null}
          {l.liaisons ? <Badge theme={theme} texte={trnLi('lies.n', l.liaisons)} icone="lien" testID={`esport-cm-lien-${l.id}-liaisons`} /> : null}
        </View>
        <View style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]}>
          <BoutonHub theme={theme} titre={trLi('ouvrir')} icone="externe" libelle={trLi('ouvrir_lien', { titre: l.titre })} onPress={() => ouvrirAdresse(l.url)} testID={`esport-cm-lien-${l.id}-aller`} />
          <MenuActions
            theme={theme}
            testID={`esport-cm-lien-${l.id}-menu`}
            actions={[
              { titre: trLi('lies.voir'), onPress: () => ouvrirOu(l), testID: `esport-cm-lien-${l.id}-voir-liaisons` },
              editer && { titre: trLi('modifier'), onPress: () => setFormulaire({ lien: l }), testID: `esport-cm-lien-${l.id}-modifier` },
              editer && { titre: l.epingle ? trLi('desepingler') : trLi('epingler'), onPress: () => void agir('epingle', async () => { await api.modifier(l.id, { epingle: !l.epingle }); await charger(); }), testID: `esport-cm-lien-${l.id}-epingler` },
              ordre && !premier && { titre: trLi('monter'), onPress: () => deplacer(l.id, -1), testID: `esport-cm-lien-${l.id}-monter` },
              ordre && !dernier && { titre: trLi('descendre'), onPress: () => deplacer(l.id, 1), testID: `esport-cm-lien-${l.id}-descendre` },
              gerer && { titre: trLi('supprimer'), danger: true, onPress: () => setASupprimer(l), testID: `esport-cm-lien-${l.id}-supprimer` },
            ]}
          />
        </View>
      </Carte>
    );
  };

  return (
    <View style={{ gap: ESP.m }} testID="esport-cm-ressources">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-cm-ressources" />
      <View style={[styles.ligne, { gap: ESP.xs, alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trLi('recherche')} valeur={filtre.q ?? ''} onChanger={q => setFiltre({ ...filtre, q })} maxLength={80} testID="esport-cm-ressources-recherche" style={{ flex: 1, minWidth: 200 }} />
        {editer ? <BoutonHub theme={theme} titre={trLi('nouveau')} variante="plein" onPress={() => setFormulaire({})} testID="esport-cm-ressources-nouveau" /> : null}
      </View>
      {liste && (liste.categories.length || teamsPresentes.length || liste.liens.some(l => l.epingle)) ? (
        <View style={{ gap: ESP.xs }}>
          {liste.categories.length ? (
            <Choix theme={theme} libelle={trLi('filtre.categorie')} valeur={filtre.categorie ?? ''} options={[{ id: '', nom: trLi('filtre.toutes') }, ...liste.categories.map(c => ({ id: c, nom: c }))]} onChoisir={c => setFiltre({ ...filtre, categorie: c || undefined })} testID="esport-cm-ressources-categorie" />
          ) : null}
          {teamsPresentes.length ? (
            <Choix theme={theme} libelle={trLi('filtre.team')} valeur={filtre.team ?? ''} options={[{ id: '', nom: trLi('filtre.toutes') }, { id: 'club', nom: trLi('filtre.club') }, ...teamsPresentes]} onChoisir={t => setFiltre({ ...filtre, team: t || undefined })} testID="esport-cm-ressources-team" />
          ) : null}
          <Interrupteur theme={theme} libelle={trLi('filtre.epingles')} valeur={Boolean(filtre.epingles)} onChanger={v => setFiltre({ ...filtre, epingles: v || undefined })} testID="esport-cm-ressources-epingles" />
        </View>
      ) : null}
      {!liste && !erreur ? <SqueletteCartes theme={theme} n={large ? 3 : 2} large={large} /> : null}
      {liste && !liste.liens.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="lien" titre={trLi('vide')} texte={editer ? trLi('vide_texte') : undefined} testID="esport-cm-ressources-vide" />
        </Carte>
      ) : null}
      {liste?.liens.length ? (
        <>
          <Text style={attenue(theme, 13)} testID="esport-cm-ressources-compte">
            {trnLi('compte', affiches.length)}
          </Text>
          {affiches.length ? (
            <Grille min={large ? 340 : 260} testID="esport-cm-ressources-liste">
              {affiches.map(l => ligne(l))}
            </Grille>
          ) : (
            <Text style={attenue(theme, 14)} testID="esport-cm-ressources-aucun">
              {trLi('vide_filtre')}
            </Text>
          )}
        </>
      ) : null}

      {formulaire && liste ? (
        <FormLien
          theme={theme}
          lien={formulaire.lien}
          categories={liste.categories}
          teams={liste.teams}
          onFermer={() => setFormulaire(undefined)}
          onEnregistrer={async s => {
            if (formulaire.lien) await api.modifier(formulaire.lien.id, s);
            else await api.creer(s);
            await charger();
          }}
        />
      ) : null}

      {ou ? (
        <Volet theme={theme} visible titre={trLi('lies.titre')} onFermer={() => setOu(undefined)} testID="esport-cm-ressources-liaisons-volet" largeur={460}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={ou.lien.titre} />
            {!ou.liaisons ? <Text style={attenue(theme, 14)}>…</Text> : null}
            {ou.liaisons && !ou.liaisons.cartes.length && !ou.liaisons.dossiers.length ? <Text style={attenue(theme, 14)} testID="esport-cm-ressources-liaisons-vide">{trLi('lies.vide')}</Text> : null}
            {ou.liaisons?.cartes.map(c => (
              <View key={c.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
                <Icone nom="tableau" taille={18} couleur={theme.accent} />
                <Pressable accessibilityRole="link" accessibilityLabel={trLi('lies.aller_carte', { titre: c.titre })} onPress={() => onOuvrirTableau?.(c.tableauId)} disabled={!onOuvrirTableau} style={{ flex: 1, minWidth: 0 }} testID={`esport-cm-ressources-carte-${c.id}`}>
                  <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }} numberOfLines={2}>{trLi('lies.carte', { titre: c.titre, tableau: c.tableau ?? '' })}</Text>
                </Pressable>
                {editer && c.modifier ? <BoutonHub theme={theme} titre={trLi('lies.delier')} onPress={() => void delier(ou.lien, 'carte', c.id)} testID={`esport-cm-ressources-carte-${c.id}-delier`} /> : null}
              </View>
            ))}
            {ou.liaisons?.dossiers.map(d => (
              <View key={d.id} style={[styles.ligne, { gap: ESP.xs, flexWrap: 'nowrap' }]}>
                <Icone nom="dossier" taille={18} couleur={theme.accent} />
                <Pressable accessibilityRole="link" accessibilityLabel={trLi('lies.aller_dossier', { chemin: d.chemin.join(' › ') })} onPress={() => onOuvrirDossier?.(d.portee, d.id)} disabled={!onOuvrirDossier} style={{ flex: 1, minWidth: 0 }} testID={`esport-cm-ressources-dossier-${d.id}`}>
                  <Text style={{ ...texte(theme, 14), color: theme.accent, fontWeight: '600' }} numberOfLines={2}>{trLi('lies.dossier', { chemin: d.chemin.join(' › ') })}</Text>
                </Pressable>
                {editer && d.modifier ? <BoutonHub theme={theme} titre={trLi('lies.delier')} onPress={() => void delier(ou.lien, 'dossier', d.id)} testID={`esport-cm-ressources-dossier-${d.id}-delier`} /> : null}
              </View>
            ))}
          </View>
        </Volet>
      ) : null}

      {aSupprimer ? (
        <Volet theme={theme} visible titre={trLi('supprimer')} onFermer={() => setASupprimer(undefined)} testID="esport-cm-ressources-supprimer-volet" largeur={420}>
          <View style={{ gap: ESP.s, padding: ESP.l }}>
            <TitreCarte theme={theme} titre={aSupprimer.titre} />
            <Text style={attenue(theme, 14)}>{trLi('supprimer_info')}</Text>
            <BoutonConfirme
              theme={theme}
              titre={trLi('supprimer')}
              confirmation={trLi('supprimer_confirme')}
              testID="esport-cm-ressources-supprimer"
              onConfirme={() =>
                void agir('supprimer', async () => {
                  await api.supprimer(aSupprimer.id);
                  setASupprimer(undefined);
                  await charger();
                  return trLi('supprime');
                })
              }
            />
          </View>
        </Volet>
      ) : null}
    </View>
  );
}
