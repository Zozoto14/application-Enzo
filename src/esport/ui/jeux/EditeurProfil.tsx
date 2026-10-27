/**
 * Éditeur d'un profil de jeu (création à la main, modification, RELECTURE d'un brouillon de l'IA) :
 * en-tête (nom, clé, couleur, icône), formats de match, système de score, modes, maps (pool), classes et
 * personnages, roster, rôles des joueurs, champs libres, mots du jeu, sources.
 *
 * Brouillon de l'IA : les points incertains (confiance) sont signalés sur leur section ou leur élément,
 * les éléments écartés par la validation sont listés, les pages lues sont citées. Les images ne sont pas
 * chargées d'office (adresse et site affichés ; « Aperçu » sur demande) : une image proposée par une IA
 * peut servir à pister qui la regarde. Rien n'est enregistré avant « Enregistrer » / « Valider ».
 */

import React, { useMemo, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { BoutonHub, Case, Champ, Segments } from '../../../hub/admin/ui/commun';
import { police, type ThemeHub } from '../../../hub/themes';
import type { Avertissement, ChampLibre, DonneesJeu, Incertitude, SaisieJeu, SourceJeu, TypeChamp, TypeScore } from '../../jeux/api';
import { cleDe, hote, libelleFormat } from '../../jeux/profil';
import { trJeux, type CleJeux } from '../../i18n/jeux';
import { Choix, Retours, styles } from '../commun';
import { Badge, Carte, ESP, Pliable, TitreCarte, attenue, texte } from '../design';

export interface MetaBrouillon {
  incertitudes: Incertitude[];
  avertissements: Avertissement[];
  pagesLues: SourceJeu[];
  pagesEchecs: Array<{ url: string; raison: string }>;
}

const BO = [1, 2, 3, 5, 7];
const TYPES_SCORE: TypeScore[] = ['rounds', 'points', 'placement', 'manches'];
const TYPES_CHAMPS: TypeChamp[] = ['texte', 'nombre', 'booleen', 'liste'];
const MOTIF_COULEUR = /^#[0-9a-fA-F]{6}$/;

/** Nombre saisi (vide : NaN, refusé par le serveur avec le chemin du champ). */
const nombre = (v: string): number => (v.trim() === '' ? Number.NaN : Number(v.replace(',', '.')));
const enTexte = (n: number | undefined | null): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');
/** Clé effective d'un élément : la sienne, sinon celle que le serveur dérivera du nom. */
const cleDeLigne = (e: { cle: string; nom: string }): string => e.cle || cleDe(e.nom);

/** Libellé lisible d'un chemin (« cartes.3.image » → « Maps › n° 4 › image »). */
export function libelleChemin(chemin: string): string {
  const [section, ...reste] = chemin.split('.');
  const nom = trJeuxOu(`jeux.section.${section}`, section);
  return [nom, ...reste.map(x => (/^\d+$/.test(x) ? trJeux('jeux.element_numero', { n: Number(x) + 1 }) : trJeuxOu(`jeux.champ.${x}`, x)))].join(' › ');
}

export function libelleRaison(raison: string): string {
  return trJeuxOu(`jeux.raison.${raison}`, raison);
}

function trJeuxOu(cle: string, secours: string): string {
  const t = trJeux(cle as CleJeux);
  return t === cle ? secours : t;
}

/** Badge « à vérifier » d'un point incertain du brouillon. */
function Doutes({ theme, liste, testID }: { theme: ThemeHub; liste: Incertitude[]; testID?: string }) {
  if (liste.length === 0) return null;
  return (
    <View style={{ gap: 4 }} testID={testID}>
      {liste.map((i, n) => (
        <View key={`${i.chemin}-${n}`} style={[styles.ligne, { gap: 6, alignItems: 'flex-start' }]}>
          <Badge theme={theme} texte={trJeux('jeux.a_verifier', { confiance: trJeux(`jeux.confiance.${i.confiance}`) })} ton={i.confiance === 'haute' ? 'neutre' : 'alerte'} />
          {i.note ? <Text style={[attenue(theme, 12), { flex: 1, minWidth: 160 }]}>{i.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Adresse d'image : texte + site ; l'image n'est chargée que sur demande. */
function ChampImage({ theme, valeur, onChanger, testID }: { theme: ThemeHub; valeur: string | null; onChanger(v: string | null): void; testID: string }) {
  const [apercu, setApercu] = useState(false);
  const site = hote(valeur);
  return (
    <View style={{ gap: 4, minWidth: 200, flex: 1 }}>
      <Champ theme={theme} libelle={trJeux('jeux.image')} valeur={valeur ?? ''} onChanger={v => onChanger(v.trim() ? v.trim() : null)} placeholder="https://" maxLength={500} testID={testID} />
      {valeur ? (
        <View style={[styles.ligne, { gap: 6 }]}>
          <Text style={attenue(theme, 12)}>{site ? trJeux('jeux.image_site', { site }) : trJeux('jeux.image_invalide')}</Text>
          {site ? (
            <Pressable accessibilityRole="button" onPress={() => setApercu(a => !a)} hitSlop={8} testID={`${testID}-apercu`}>
              <Text style={{ color: theme.accent, fontSize: 12, ...police(theme.policeTexte) }}>{apercu ? trJeux('jeux.masquer') : trJeux('jeux.apercu')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {apercu && site ? <Image testID={`${testID}-vue`} source={{ uri: valeur as string }} accessibilityLabel={trJeux('jeux.image')} style={{ width: 96, height: 54, borderRadius: 6 }} resizeMode="contain" /> : null}
    </View>
  );
}

/** Pastilles à cocher (BO, formats d'un mode, modes d'une map). */
function Bascules<T extends string | number>({ theme, libelle, options, valeurs, onChanger, testID }: { theme: ThemeHub; libelle: string; options: ReadonlyArray<{ id: T; nom: string }>; valeurs: T[]; onChanger(v: T[]): void; testID: string }) {
  if (options.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ ...attenue(theme, 12), fontWeight: '600' }}>{libelle}</Text>
      <View style={[styles.ligne, { gap: 4 }]} accessibilityLabel={libelle}>
        {options.map(o => {
          const coche = valeurs.includes(o.id);
          return (
            <Pressable
              key={String(o.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: coche }}
              accessibilityLabel={`${libelle} : ${o.nom}`}
              onPress={() => onChanger(coche ? valeurs.filter(v => v !== o.id) : [...valeurs, o.id])}
              hitSlop={6}
              testID={`${testID}-${o.id}`}
              style={{ minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: coche ? theme.accent : theme.ligne, backgroundColor: coche ? theme.accent : theme.surface }}>
              <Text style={{ color: coche ? theme.surAccent : theme.texte, fontSize: 13, fontWeight: coche ? '700' : '500', ...police(theme.policeTexte) }}>{o.nom}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Une ligne d'élément : champs, retrait, points incertains. */
function Ligne({ theme, children, onRetirer, doutes, testID }: { theme: ThemeHub; children: React.ReactNode; onRetirer(): void; doutes: Incertitude[]; testID: string }) {
  return (
    <View testID={testID} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.s, ...(doutes.length ? { borderLeftWidth: 3, borderLeftColor: theme.alerte, paddingLeft: ESP.xs } : {}) }}>
      <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>{children}</View>
      <Doutes theme={theme} liste={doutes} />
      <View style={{ alignSelf: 'flex-start' }}>
        <BoutonHub theme={theme} titre={trJeux('jeux.retirer')} onPress={onRetirer} testID={`${testID}-retirer`} />
      </View>
    </View>
  );
}

export function EditeurProfil({
  theme,
  large,
  initial,
  nouveau,
  meta,
  titreAction,
  enCours,
  erreur,
  onEnregistrer,
  onAnnuler,
  testID = 'esport-jeu-editeur',
}: {
  theme: ThemeHub;
  large: boolean;
  initial: SaisieJeu;
  /** La clé du jeu est encore modifiable (création, brouillon d'un nouveau jeu). */
  nouveau: boolean;
  meta?: MetaBrouillon;
  titreAction: string;
  enCours?: boolean;
  erreur?: string;
  onEnregistrer(s: SaisieJeu): void;
  onAnnuler(): void;
  testID?: string;
}) {
  const [nom, setNom] = useState(initial.nom);
  const [cle, setCle] = useState(initial.cle ?? '');
  const [couleur, setCouleur] = useState(initial.couleur);
  const [icone, setIcone] = useState<string | null>(initial.icone);
  const [d, setD] = useState<DonneesJeu>(() => structuredCloneSur(initial.donnees));
  const doutes = meta?.incertitudes ?? [];

  /** Points incertains d'une section (`cartes`) ou d'un élément (`cartes.ascent`, `cartes.3`). */
  const doutesDe = (section: string, e?: { cle: string; nom: string }, i?: number): Incertitude[] =>
    doutes.filter(x => {
      const [s, k] = x.chemin.split('.');
      if (s !== section) return false;
      if (e) return k === cleDeLigne(e) || k === String(i);
      // Niveau de la section : le chemin ne désigne aucun élément de la liste (ou un champ du score, du roster…).
      const liste = (d as unknown as Record<string, unknown>)[section];
      return k === undefined || !Array.isArray(liste) || !liste.some((y, j) => cleDeLigne(y as { cle: string; nom: string }) === k || String(j) === k);
    });

  type Liste = 'formats' | 'modes' | 'cartes' | 'classes' | 'personnages' | 'rolesJoueurs' | 'champs';
  function maj<S extends Liste>(section: S, i: number, champs: Partial<DonneesJeu[S][number]>) {
    setD(x => ({ ...x, [section]: (x[section] as Array<DonneesJeu[S][number]>).map((e, j) => (j === i ? { ...e, ...champs } : e)) }));
  }
  function ajouter<S extends Liste>(section: S, e: DonneesJeu[S][number]) {
    setD(x => ({ ...x, [section]: [...(x[section] as Array<DonneesJeu[S][number]>), e] }));
  }
  function retirer(section: Liste, i: number) {
    setD(x => ({ ...x, [section]: (x[section] as unknown[]).filter((_, j) => j !== i) }));
  }

  const formats = useMemo(() => d.formats.map(f => ({ id: cleDeLigne(f), nom: f.nom || libelleFormat(f) })), [d.formats]);
  const modes = useMemo(() => d.modes.map(m => ({ id: cleDeLigne(m), nom: m.nom })), [d.modes]);
  const classes = useMemo(() => d.classes.map(c => ({ id: cleDeLigne(c), nom: c.nom })), [d.classes]);

  /** Données à envoyer : chaque élément reçoit sa clé effective (les références restent cohérentes). */
  const saisie = (): SaisieJeu => {
    const avecCles = <T extends { cle: string; nom: string }>(l: T[]): T[] => l.map(e => ({ ...e, cle: cleDeLigne(e) }));
    return {
      ...(nouveau ? { cle: cle.trim() || cleDe(nom) } : {}),
      nom: nom.trim(),
      couleur,
      icone,
      donnees: {
        ...d,
        formats: avecCles(d.formats),
        modes: avecCles(d.modes),
        cartes: avecCles(d.cartes),
        classes: avecCles(d.classes),
        personnages: avecCles(d.personnages),
        rolesJoueurs: avecCles(d.rolesJoueurs),
        champs: avecCles(d.champs),
      },
      ...(initial.version !== undefined ? { version: initial.version } : {}),
    };
  };

  const section = (cleSection: Liste | 'score' | 'roster' | 'libelles' | 'sources', n: number | undefined, contenu: React.ReactNode) => (
    <Pliable theme={theme} titre={trJeux(`jeux.section.${cleSection}`)} resume={n !== undefined ? String(n) : undefined} ouvertParDefaut={doutes.some(x => x.chemin.split('.')[0] === cleSection)} testID={`${testID}-section-${cleSection}`}>
      <Carte theme={theme}>
        <Text style={attenue(theme, 13)}>{trJeux(`jeux.aide.${cleSection}`)}</Text>
        <Doutes theme={theme} liste={doutesDe(cleSection)} testID={`${testID}-doutes-${cleSection}`} />
        {contenu}
      </Carte>
    </Pliable>
  );

  const score = d.score;
  const majScore = (champs: Partial<NonNullable<DonneesJeu['score']>>) => setD(x => ({ ...x, score: { ...(x.score ?? { type: 'rounds', notes: '' }), ...champs } }));

  return (
    <View style={{ gap: ESP.m }} testID={testID}>
      {meta ? (
        <Carte theme={theme} testID={`${testID}-meta`}>
          <TitreCarte theme={theme} titre={trJeux('jeux.brouillon_relecture')} sous={trJeux('jeux.brouillon_relecture_aide')} />
          {meta.pagesLues.length ? <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trJeux('jeux.pages_lues')}</Text> : <Text style={attenue(theme, 13)}>{trJeux('jeux.aucune_page_lue')}</Text>}
          {meta.pagesLues.map(p => (
            <Pressable key={p.url} accessibilityRole="link" onPress={() => void Linking.openURL(p.url)} testID={`${testID}-page`}>
              <Text style={{ color: theme.accent, fontSize: 13, ...police(theme.policeTexte) }}>{`${hote(p.url)}${p.titre ? ` · ${p.titre}` : ''}`}</Text>
            </Pressable>
          ))}
          {meta.pagesEchecs.length ? <Text style={attenue(theme, 12)}>{trJeux('jeux.pages_echecs', { liste: meta.pagesEchecs.map(e => hote(e.url) || e.url).join(', ') })}</Text> : null}
          {doutes.length ? <Badge theme={theme} texte={trJeux('jeux.points_incertains', { n: doutes.length })} ton="alerte" testID={`${testID}-nb-doutes`} /> : null}
          {meta.avertissements.length ? (
            <View style={{ gap: 2 }} testID={`${testID}-ecartes`}>
              <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trJeux('jeux.elements_ecartes')}</Text>
              {meta.avertissements.slice(0, 20).map((a, i) => (
                <Text key={`${a.chemin}-${i}`} style={attenue(theme, 12)}>{`${libelleChemin(a.chemin)} : ${libelleRaison(a.raison)}`}</Text>
              ))}
            </View>
          ) : null}
        </Carte>
      ) : null}

      <Carte theme={theme} testID={`${testID}-entete`}>
        <TitreCarte theme={theme} titre={trJeux('jeux.identite')} />
        <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
          <Champ theme={theme} libelle={trJeux('jeux.nom_du_jeu')} valeur={nom} onChanger={setNom} maxLength={40} testID={`${testID}-nom`} style={{ minWidth: 200, flex: 1 }} />
          {nouveau ? <Champ theme={theme} libelle={trJeux('jeux.cle')} valeur={cle} onChanger={v => setCle(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder={cleDe(nom)} maxLength={40} testID={`${testID}-cle`} style={{ minWidth: 160 }} /> : null}
          <Champ theme={theme} libelle={trJeux('jeux.couleur')} valeur={couleur} onChanger={setCouleur} maxLength={7} placeholder={trJeux('jeux.exemple_couleur')} testID={`${testID}-couleur`} style={{ width: 120 }} />
          <View style={{ width: 28, height: 28, borderRadius: 14, marginBottom: 8, backgroundColor: MOTIF_COULEUR.test(couleur) ? couleur : theme.ligne }} />
        </View>
        <ChampImage theme={theme} valeur={icone} onChanger={setIcone} testID={`${testID}-icone`} />
      </Carte>

      {section(
        'formats',
        d.formats.length,
        <>
          {d.formats.map((f, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('formats', i)} doutes={doutesDe('formats', f, i)} testID={`${testID}-format-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={f.nom} onChanger={v => maj('formats', i, { nom: v })} maxLength={40} testID={`${testID}-format-${i}-nom`} style={{ minWidth: 140, flex: 1 }} />
              <Champ theme={theme} libelle={trJeux('jeux.equipes')} valeur={enTexte(f.equipes)} onChanger={v => maj('formats', i, { equipes: nombre(v) })} clavier="number-pad" maxLength={2} testID={`${testID}-format-${i}-equipes`} style={{ width: 110 }} />
              <Champ theme={theme} libelle={trJeux('jeux.joueurs_par_equipe')} valeur={enTexte(f.joueursParEquipe)} onChanger={v => maj('formats', i, { joueursParEquipe: nombre(v) })} clavier="number-pad" maxLength={2} testID={`${testID}-format-${i}-joueurs`} style={{ width: 130 }} />
              <Badge theme={theme} texte={Number.isFinite(f.equipes) && Number.isFinite(f.joueursParEquipe) ? libelleFormat(f) : '?'} ton="accent" testID={`${testID}-format-${i}-libelle`} />
              <Bascules theme={theme} libelle={trJeux('jeux.bo')} options={BO.map(b => ({ id: b, nom: `BO${b}` }))} valeurs={f.bo} onChanger={bo => maj('formats', i, { bo: [...bo].sort((a, b) => a - b) })} testID={`${testID}-format-${i}-bo`} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_format')} onPress={() => ajouter('formats', { cle: '', nom: '', equipes: 2, joueursParEquipe: 5, bo: [1], notes: '' })} testID={`${testID}-ajouter-format`} />
        </>,
      )}

      {section(
        'score',
        undefined,
        <>
          {score ? (
            <View style={{ gap: ESP.s }}>
              <Segments<TypeScore> theme={theme} libelle={trJeux('jeux.type_score')} valeur={score.type} options={TYPES_SCORE.map(t => [t, trJeux(`jeux.score.${t}`)] as const)} onChoisir={type => majScore({ type })} testID={`${testID}-score-type`} />
              <View style={[styles.ligne, { gap: ESP.s }]}>
                {score.type === 'rounds' ? (
                  <>
                    <Champ theme={theme} libelle={trJeux('jeux.rounds_gagnants')} valeur={enTexte(score.roundsGagnants)} onChanger={v => majScore({ roundsGagnants: nombre(v) })} clavier="number-pad" maxLength={3} testID={`${testID}-score-rounds`} style={{ width: 160 }} />
                    <Champ theme={theme} libelle={trJeux('jeux.rounds_mi_temps')} valeur={enTexte(score.roundsParMiTemps)} onChanger={v => majScore({ roundsParMiTemps: v.trim() ? nombre(v) : undefined })} clavier="number-pad" maxLength={3} testID={`${testID}-score-mi-temps`} style={{ width: 160 }} />
                  </>
                ) : null}
                {score.type === 'points' ? <Champ theme={theme} libelle={trJeux('jeux.points_cible')} valeur={enTexte(score.pointsCible)} onChanger={v => majScore({ pointsCible: v.trim() ? nombre(v) : undefined })} clavier="number-pad" maxLength={7} testID={`${testID}-score-points`} style={{ width: 160 }} /> : null}
                {score.type === 'manches' ? <Champ theme={theme} libelle={trJeux('jeux.manches_gagnantes')} valeur={enTexte(score.manchesGagnantes)} onChanger={v => majScore({ manchesGagnantes: v.trim() ? nombre(v) : undefined })} clavier="number-pad" maxLength={2} testID={`${testID}-score-manches`} style={{ width: 160 }} /> : null}
              </View>
              {score.type === 'rounds' ? (
                <View style={[styles.ligne, { gap: ESP.s, alignItems: 'center' }]}>
                  <Case theme={theme} coche={Boolean(score.prolongations?.active)} libelle={trJeux('jeux.prolongations')} onChanger={v => majScore({ prolongations: { active: v, regle: score.prolongations?.regle ?? '' } })} testID={`${testID}-score-prolongations`} />
                  <Text style={texte(theme, 14)}>{trJeux('jeux.prolongations')}</Text>
                  {score.prolongations?.active ? <Champ theme={theme} libelle={trJeux('jeux.regle_prolongations')} valeur={score.prolongations.regle} onChanger={v => majScore({ prolongations: { active: true, regle: v } })} maxLength={200} testID={`${testID}-score-regle`} style={{ flex: 1, minWidth: 200 }} /> : null}
                </View>
              ) : null}
              {score.type === 'placement' ? (
                <View style={{ gap: ESP.xs }}>
                  <Text style={{ ...texte(theme, 14), fontWeight: '600' }}>{trJeux('jeux.bareme')}</Text>
                  {(score.bareme ?? []).map((b, i) => (
                    <View key={i} style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
                      <Champ theme={theme} libelle={trJeux('jeux.place')} valeur={enTexte(b.place)} onChanger={v => majScore({ bareme: (score.bareme ?? []).map((x, j) => (j === i ? { ...x, place: nombre(v) } : x)) })} clavier="number-pad" maxLength={3} testID={`${testID}-bareme-${i}-place`} style={{ width: 90 }} />
                      <Champ theme={theme} libelle={trJeux('jeux.points')} valeur={enTexte(b.points)} onChanger={v => majScore({ bareme: (score.bareme ?? []).map((x, j) => (j === i ? { ...x, points: nombre(v) } : x)) })} maxLength={6} testID={`${testID}-bareme-${i}-points`} style={{ width: 110 }} />
                      <BoutonHub theme={theme} titre={trJeux('jeux.retirer')} onPress={() => majScore({ bareme: (score.bareme ?? []).filter((_, j) => j !== i) })} testID={`${testID}-bareme-${i}-retirer`} />
                    </View>
                  ))}
                  <View style={{ alignSelf: 'flex-start' }}>
                    <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_place')} onPress={() => majScore({ bareme: [...(score.bareme ?? []), { place: (score.bareme?.length ?? 0) + 1, points: 0 }] })} testID={`${testID}-ajouter-place`} />
                  </View>
                </View>
              ) : null}
              <Champ theme={theme} libelle={trJeux('jeux.notes')} valeur={score.notes} onChanger={v => majScore({ notes: v })} multiligne maxLength={500} testID={`${testID}-score-notes`} />
              <View style={{ alignSelf: 'flex-start' }}>
                <BoutonHub theme={theme} titre={trJeux('jeux.retirer_score')} onPress={() => setD(x => ({ ...x, score: null }))} testID={`${testID}-score-retirer`} />
              </View>
            </View>
          ) : (
            <BoutonHub theme={theme} titre={trJeux('jeux.definir_score')} onPress={() => majScore({ type: 'rounds', roundsGagnants: 13, notes: '' })} testID={`${testID}-score-definir`} />
          )}
        </>,
      )}

      {section(
        'modes',
        d.modes.length,
        <>
          {d.modes.map((m, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('modes', i)} doutes={doutesDe('modes', m, i)} testID={`${testID}-mode-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={m.nom} onChanger={v => maj('modes', i, { nom: v })} maxLength={60} testID={`${testID}-mode-${i}-nom`} style={{ minWidth: 160, flex: 1 }} />
              <Champ theme={theme} libelle={trJeux('jeux.description')} valeur={m.description} onChanger={v => maj('modes', i, { description: v })} maxLength={300} testID={`${testID}-mode-${i}-description`} style={{ minWidth: 200, flex: 2 }} />
              <Bascules theme={theme} libelle={trJeux('jeux.section.formats')} options={formats} valeurs={m.formats} onChanger={v => maj('modes', i, { formats: v })} testID={`${testID}-mode-${i}-formats`} />
              <ActifCase theme={theme} libelle={trJeux('jeux.mode_actif')} valeur={m.actif} onChanger={actif => maj('modes', i, { actif })} testID={`${testID}-mode-${i}-actif`} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_mode')} onPress={() => ajouter('modes', { cle: '', nom: '', description: '', formats: [], actif: true })} testID={`${testID}-ajouter-mode`} />
        </>,
      )}

      {section(
        'cartes',
        d.cartes.length,
        <>
          {d.cartes.map((c, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('cartes', i)} doutes={doutesDe('cartes', c, i)} testID={`${testID}-carte-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={c.nom} onChanger={v => maj('cartes', i, { nom: v })} maxLength={40} testID={`${testID}-carte-${i}-nom`} style={{ minWidth: 160, flex: 1 }} />
              <ChampImage theme={theme} valeur={c.image} onChanger={image => maj('cartes', i, { image })} testID={`${testID}-carte-${i}-image`} />
              <ActifCase theme={theme} libelle={trJeux('jeux.dans_le_pool')} valeur={c.actif} onChanger={actif => maj('cartes', i, { actif })} testID={`${testID}-carte-${i}-actif`} />
              <Bascules theme={theme} libelle={trJeux('jeux.section.modes')} options={modes} valeurs={c.modes} onChanger={v => maj('cartes', i, { modes: v })} testID={`${testID}-carte-${i}-modes`} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_carte')} onPress={() => ajouter('cartes', { cle: '', nom: '', image: null, actif: true, modes: [] })} testID={`${testID}-ajouter-carte`} />
        </>,
      )}

      {section(
        'classes',
        d.classes.length,
        <>
          {d.classes.map((c, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('classes', i)} doutes={doutesDe('classes', c, i)} testID={`${testID}-classe-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={c.nom} onChanger={v => maj('classes', i, { nom: v })} maxLength={40} testID={`${testID}-classe-${i}-nom`} style={{ minWidth: 160, flex: 1 }} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_classe')} onPress={() => ajouter('classes', { cle: '', nom: '' })} testID={`${testID}-ajouter-classe`} />
        </>,
      )}

      {section(
        'personnages',
        d.personnages.length,
        <>
          {d.personnages.map((p, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('personnages', i)} doutes={doutesDe('personnages', p, i)} testID={`${testID}-personnage-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={p.nom} onChanger={v => maj('personnages', i, { nom: v })} maxLength={40} testID={`${testID}-personnage-${i}-nom`} style={{ minWidth: 140, flex: 1 }} />
              {classes.length ? <Choix theme={theme} libelle={trJeux('jeux.classe')} valeur={p.classe ?? ''} options={[{ id: '', nom: trJeux('jeux.aucune') }, ...classes]} onChoisir={v => maj('personnages', i, { classe: v || null })} testID={`${testID}-personnage-${i}-classe`} /> : null}
              <ChampImage theme={theme} valeur={p.image} onChanger={image => maj('personnages', i, { image })} testID={`${testID}-personnage-${i}-image`} />
              <ActifCase theme={theme} libelle={trJeux('jeux.jouable')} valeur={p.actif} onChanger={actif => maj('personnages', i, { actif })} testID={`${testID}-personnage-${i}-actif`} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_personnage')} onPress={() => ajouter('personnages', { cle: '', nom: '', classe: null, image: null, actif: true })} testID={`${testID}-ajouter-personnage`} />
        </>,
      )}

      {section(
        'roster',
        undefined,
        d.roster ? (
          <View style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]}>
            <Champ theme={theme} libelle={trJeux('jeux.titulaires')} valeur={enTexte(d.roster.titulaires)} onChanger={v => setD(x => ({ ...x, roster: { titulaires: nombre(v), remplacants: x.roster?.remplacants ?? 0 } }))} clavier="number-pad" maxLength={2} testID={`${testID}-roster-titulaires`} style={{ width: 130 }} />
            <Champ theme={theme} libelle={trJeux('jeux.remplacants')} valeur={enTexte(d.roster.remplacants)} onChanger={v => setD(x => ({ ...x, roster: { titulaires: x.roster?.titulaires ?? 1, remplacants: nombre(v) } }))} clavier="number-pad" maxLength={2} testID={`${testID}-roster-remplacants`} style={{ width: 130 }} />
            <BoutonHub theme={theme} titre={trJeux('jeux.retirer')} onPress={() => setD(x => ({ ...x, roster: null }))} testID={`${testID}-roster-retirer`} />
          </View>
        ) : (
          <BoutonHub theme={theme} titre={trJeux('jeux.definir_roster')} onPress={() => setD(x => ({ ...x, roster: { titulaires: d.formats[0]?.joueursParEquipe || 5, remplacants: 1 } }))} testID={`${testID}-roster-definir`} />
        ),
      )}

      {section(
        'rolesJoueurs',
        d.rolesJoueurs.length,
        <>
          {d.rolesJoueurs.map((r, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('rolesJoueurs', i)} doutes={doutesDe('rolesJoueurs', r, i)} testID={`${testID}-role-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={r.nom} onChanger={v => maj('rolesJoueurs', i, { nom: v })} maxLength={40} testID={`${testID}-role-${i}-nom`} style={{ minWidth: 160, flex: 1 }} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_role')} onPress={() => ajouter('rolesJoueurs', { cle: '', nom: '' })} testID={`${testID}-ajouter-role`} />
        </>,
      )}

      {section(
        'champs',
        d.champs.length,
        <>
          {d.champs.map((c, i) => (
            <Ligne key={i} theme={theme} onRetirer={() => retirer('champs', i)} doutes={doutesDe('champs', c, i)} testID={`${testID}-champ-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.nom')} valeur={c.nom} onChanger={v => maj('champs', i, { nom: v })} maxLength={60} testID={`${testID}-champ-${i}-nom`} style={{ minWidth: 160, flex: 1 }} />
              <Segments<TypeChamp> theme={theme} libelle={trJeux('jeux.type_champ')} valeur={c.type} options={TYPES_CHAMPS.map(t => [t, trJeux(`jeux.type.${t}`)] as const)} onChoisir={type => maj('champs', i, { type, valeur: valeurParDefaut(type) })} testID={`${testID}-champ-${i}-type`} />
              <ValeurChamp theme={theme} champ={c} onChanger={valeur => maj('champs', i, { valeur })} testID={`${testID}-champ-${i}-valeur`} />
            </Ligne>
          ))}
          <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_champ')} onPress={() => ajouter('champs', { cle: '', nom: '', type: 'texte', valeur: '' })} testID={`${testID}-ajouter-champ`} />
        </>,
      )}

      {section(
        'libelles',
        undefined,
        <View style={[styles.ligne, { gap: ESP.s }]}>
          {(['personnages', 'classes', 'cartes'] as const).map(k => (
            <Champ key={k} theme={theme} libelle={trJeux(`jeux.libelle.${k}`)} valeur={d.libelles[k] ?? ''} onChanger={v => setD(x => ({ ...x, libelles: { ...x.libelles, [k]: v } }))} maxLength={30} testID={`${testID}-libelle-${k}`} style={{ minWidth: 160, flex: 1 }} />
          ))}
        </View>,
      )}

      {section(
        'sources',
        d.sources.length,
        <>
          {d.sources.map((s, i) => (
            <View key={i} style={[styles.ligne, { gap: ESP.s, alignItems: 'flex-end' }]} testID={`${testID}-source-${i}`}>
              <Champ theme={theme} libelle={trJeux('jeux.adresse')} valeur={s.url} onChanger={url => setD(x => ({ ...x, sources: x.sources.map((y, j) => (j === i ? { ...y, url: url.trim() } : y)) }))} placeholder="https://" maxLength={500} testID={`${testID}-source-${i}-url`} style={{ minWidth: 220, flex: 2 }} />
              <Champ theme={theme} libelle={trJeux('jeux.titre_source')} valeur={s.titre} onChanger={titre => setD(x => ({ ...x, sources: x.sources.map((y, j) => (j === i ? { ...y, titre } : y)) }))} maxLength={120} testID={`${testID}-source-${i}-titre`} style={{ minWidth: 140, flex: 1 }} />
              <BoutonHub theme={theme} titre={trJeux('jeux.retirer')} onPress={() => setD(x => ({ ...x, sources: x.sources.filter((_, j) => j !== i) }))} testID={`${testID}-source-${i}-retirer`} />
            </View>
          ))}
          {d.sources.length < 20 ? <BoutonHub theme={theme} titre={trJeux('jeux.ajouter_source')} onPress={() => setD(x => ({ ...x, sources: [...x.sources, { url: '', titre: '' }] }))} testID={`${testID}-ajouter-source`} /> : null}
        </>,
      )}

      <Retours theme={theme} erreur={erreur} prefixe={testID} />
      <View style={[styles.ligne, { justifyContent: large ? 'flex-end' : 'flex-start', gap: ESP.s }]}>
        <BoutonHub theme={theme} titre={trJeux('jeux.annuler')} onPress={onAnnuler} testID={`${testID}-annuler`} />
        <BoutonHub theme={theme} titre={enCours ? trJeux('jeux.enregistrement') : titreAction} variante="plein" desactive={Boolean(enCours) || nom.trim().length < 2} onPress={() => onEnregistrer(saisie())} testID={`${testID}-enregistrer`} />
      </View>
    </View>
  );
}

function ActifCase({ theme, libelle, valeur, onChanger, testID }: { theme: ThemeHub; libelle: string; valeur: boolean; onChanger(v: boolean): void; testID: string }) {
  return (
    <View style={[styles.ligne, { gap: 8, alignItems: 'center', minHeight: 44 }]}>
      <Case theme={theme} coche={valeur} libelle={libelle} onChanger={onChanger} testID={testID} />
      <Text style={texte(theme, 14)}>{libelle}</Text>
    </View>
  );
}

const valeurParDefaut = (t: TypeChamp): ChampLibre['valeur'] => (t === 'nombre' ? 0 : t === 'booleen' ? false : t === 'liste' ? [] : '');

function ValeurChamp({ theme, champ, onChanger, testID }: { theme: ThemeHub; champ: ChampLibre; onChanger(v: ChampLibre['valeur']): void; testID: string }) {
  if (champ.type === 'booleen') return <ActifCase theme={theme} libelle={trJeux('jeux.valeur_oui')} valeur={champ.valeur === true} onChanger={onChanger} testID={testID} />;
  if (champ.type === 'nombre') return <Champ theme={theme} libelle={trJeux('jeux.valeur')} valeur={enTexte(champ.valeur as number)} onChanger={v => onChanger(nombre(v))} maxLength={12} testID={testID} style={{ width: 140 }} />;
  if (champ.type === 'liste') {
    const liste = Array.isArray(champ.valeur) ? champ.valeur : [];
    return <Champ theme={theme} libelle={trJeux('jeux.valeur_liste')} valeur={liste.join(', ')} onChanger={v => onChanger(v.split(',').map(x => x.trim()).filter(Boolean))} maxLength={1000} testID={testID} style={{ minWidth: 200, flex: 1 }} />;
  }
  return <Champ theme={theme} libelle={trJeux('jeux.valeur')} valeur={String(champ.valeur ?? '')} onChanger={onChanger} maxLength={500} testID={testID} style={{ minWidth: 200, flex: 1 }} />;
}

/** Copie profonde des données (le formulaire ne modifie jamais l'objet reçu). */
function structuredCloneSur(d: DonneesJeu): DonneesJeu {
  return JSON.parse(JSON.stringify(d)) as DonneesJeu;
}
