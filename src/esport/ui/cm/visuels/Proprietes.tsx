/**
 * Panneau des propriétés de l'éditeur de visuels : calque choisi (texte FR / EN et champs dynamiques,
 * police, taille, graisse, couleur ou dégradé, alignements, ombre, contour, lueur néon, glitch, condition
 * d'affichage, forme, image, logo, liste…) ou, sans sélection, le fond et les effets du document.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { CHAMPS_LISTES, CHAMPS_TEXTE } from '../../../cm/visuels/champs';
import type { Action, SensAlignement } from '../../../cm/visuels/document';
import { aligner } from '../../../cm/visuels/document';
import { CHAMPS_IMAGE, FORMATS, FORMES, GRAISSES, SOURCES_LISTE, type Calque, type Charte, type DocumentVisuel, type Remplissage } from '../../../cm/visuels/types';
import { trVi, type CleVi } from '../../../i18n/visuels';
import { styles } from '../../commun';
import { ESP, attenue } from '../../design';
import { ChampNombre, CouleurChoix, Pastilles, PoliceChoix, Section } from './controles';

type Props = {
  theme: ThemeHub;
  doc: DocumentVisuel;
  calque: Calque | undefined;
  charte: Charte;
  onAction(a: Action, fusion?: boolean): void;
  /** Image importée ou choisie (site et PC). */
  onChoisirImage?(): void;
};

/** Couleur ou dégradé (2 couleurs + angle). */
function RemplissageChoix({ theme, libelle, valeur, charte, onChanger, testID, vide }: { theme: ThemeHub; libelle: string; valeur: Remplissage | null; charte: Charte; onChanger(r: Remplissage | null): void; testID: string; vide?: boolean }) {
  const mode = !valeur ? 'vide' : valeur.type;
  const c1 = !valeur ? 'charte:primaire' : valeur.type === 'uni' ? valeur.couleur : valeur.couleurs[0];
  const c2 = valeur?.type === 'degrade' ? valeur.couleurs[1] : 'charte:secondaire';
  return (
    <View style={{ gap: ESP.xs }}>
      <Pastilles
        theme={theme}
        libelle={libelle}
        valeur={mode}
        options={[...(vide ? ([['vide', trVi('editeur.sans_remplissage')]] as const) : []), ['uni', trVi('editeur.couleur')], ['degrade', trVi('editeur.degrade')]]}
        onChoisir={m => onChanger(m === 'vide' ? null : m === 'uni' ? { type: 'uni', couleur: c1 } : { type: 'degrade', couleurs: [c1, c2], angle: valeur?.type === 'degrade' ? valeur.angle : 90, radial: false })}
        testID={`${testID}-mode`}
      />
      {valeur ? <CouleurChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c1} charte={charte} onChanger={c => onChanger(valeur.type === 'uni' ? { type: 'uni', couleur: c } : { ...valeur, couleurs: [c, ...valeur.couleurs.slice(1)] })} testID={`${testID}-c1`} /> : null}
      {valeur?.type === 'degrade' ? (
        <>
          <CouleurChoix theme={theme} libelle={trVi('editeur.couleur2')} valeur={c2} charte={charte} onChanger={c => onChanger({ ...valeur, couleurs: [valeur.couleurs[0], c] })} testID={`${testID}-c2`} />
          <ChampNombre theme={theme} libelle={trVi('editeur.angle')} valeur={valeur.angle} min={-360} max={360} onChanger={angle => onChanger({ ...valeur, angle })} testID={`${testID}-angle`} />
        </>
      ) : null}
    </View>
  );
}

const nomType = (c: Calque): string => trVi(`editeur.calque_${c.type}` as CleVi);

export function Proprietes({ theme, doc, calque: c, charte, onAction, onChoisirImage }: Props) {
  const { largeur: W, hauteur: H } = FORMATS[doc.format];
  if (!c) {
    return (
      <View style={{ gap: ESP.s }} testID="esport-vi-proprietes-document">
        <Text style={attenue(theme)}>{trVi('editeur.aucune_selection')}</Text>
        <Section theme={theme} titre={trVi('editeur.fond')} testID="esport-vi-section-fond">
          <RemplissageChoix theme={theme} libelle={trVi('editeur.fond')} valeur={doc.fond} charte={charte} onChanger={fond => onAction({ type: 'fond', fond })} testID="esport-vi-fond" vide />
        </Section>
        <Section theme={theme} titre={trVi('editeur.effets')} testID="esport-vi-section-effets">
          <Interrupteur theme={theme} libelle={trVi('editeur.effets_charte')} valeur={!doc.effets} onChanger={v => onAction({ type: 'effets', effets: v ? null : { scanlines: charte.effets.scanlines, grain: charte.effets.grain, vignette: 0.35 } })} testID="esport-vi-effets-charte" />
          {doc.effets ? (
            <View style={[styles.ligne, { gap: ESP.xs }]}>
              {(['scanlines', 'grain', 'vignette'] as const).map(k => (
                <ChampNombre key={k} theme={theme} libelle={k === 'vignette' ? 'Vignette' : trVi(`charte.effet.${k}`)} valeur={doc.effets?.[k] ?? 0} min={0} max={1} onChanger={v => doc.effets && onAction({ type: 'effets', effets: { ...doc.effets, [k]: v } })} testID={`esport-vi-effet-${k}`} />
              ))}
            </View>
          ) : null}
        </Section>
      </View>
    );
  }
  const mod = (valeurs: Partial<Calque>, fusion = false) => onAction({ type: 'modifier', id: c.id, valeurs }, fusion);
  const id = `esport-vi-prop`;
  const champsListe = c.type === 'liste' ? CHAMPS_LISTES[c.source] : [];
  return (
    <View style={{ gap: ESP.s }} testID="esport-vi-proprietes">
      <Text style={{ color: theme.texte, fontWeight: '700' }}>{`${nomType(c)}${c.nom ? ` · ${c.nom}` : ''}`}</Text>
      <View style={[styles.ligne, { gap: 4 }]}>
        <BoutonHub theme={theme} titre={c.verrouille ? trVi('editeur.deverrouiller') : trVi('editeur.verrouiller')} onPress={() => mod({ verrouille: !c.verrouille })} testID={`${id}-verrou`} />
        <BoutonHub theme={theme} titre={trVi('editeur.dupliquer')} onPress={() => onAction({ type: 'dupliquer', id: c.id })} testID={`${id}-dupliquer`} />
        <BoutonHub theme={theme} titre={trVi('editeur.premier_plan')} onPress={() => onAction({ type: 'ordre', id: c.id, sens: 'premier' })} testID={`${id}-premier`} />
        <BoutonHub theme={theme} titre={trVi('editeur.arriere_plan')} onPress={() => onAction({ type: 'ordre', id: c.id, sens: 'dernier' })} testID={`${id}-dernier`} />
        <BoutonHub theme={theme} titre={trVi('editeur.supprimer')} variante="danger" onPress={() => onAction({ type: 'supprimer', id: c.id })} testID={`${id}-supprimer`} />
      </View>

      {c.type === 'texte' ? (
        <Section theme={theme} titre={nomType(c)} testID={`${id}-section-texte`}>
          <Champ theme={theme} libelle={trVi('editeur.texte_fr')} valeur={c.texte.fr} multiligne maxLength={600} onChanger={fr => mod({ texte: { ...c.texte, fr } }, true)} testID={`${id}-texte-fr`} />
          <Champ theme={theme} libelle={trVi('editeur.texte_en')} valeur={c.texte.en} multiligne maxLength={600} onChanger={en => mod({ texte: { ...c.texte, en } }, true)} testID={`${id}-texte-en`} />
          <Text style={attenue(theme, 12)}>{trVi('editeur.champs_aide', { liste: CHAMPS_TEXTE.map(x => `{${x}}`).join(' ') })}</Text>
          <PoliceChoix theme={theme} valeur={c.police} charte={charte} onChanger={police => mod({ police })} testID={`${id}-police`} />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampNombre theme={theme} libelle={trVi('editeur.taille')} valeur={c.taille} min={4} max={800} onChanger={taille => mod({ taille }, true)} testID={`${id}-taille`} />
            <ChampNombre theme={theme} libelle="↔" valeur={c.espacement} min={-20} max={100} onChanger={espacement => mod({ espacement }, true)} testID={`${id}-espacement`} />
            <ChampNombre theme={theme} libelle="↕" valeur={c.interligne} min={0.5} max={3} onChanger={interligne => mod({ interligne }, true)} testID={`${id}-interligne`} />
          </View>
          <Pastilles theme={theme} libelle={trVi('editeur.graisse')} valeur={c.graisse} options={GRAISSES.map(g => [g, String(g)] as const)} onChoisir={graisse => mod({ graisse })} testID={`${id}-graisse`} />
          <RemplissageChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c.couleur} charte={charte} onChanger={r => r && mod({ couleur: r })} testID={`${id}-couleur`} />
          <Pastilles theme={theme} libelle={trVi('editeur.alignement')} valeur={c.align} options={(['gauche', 'centre', 'droite'] as const).map(a => [a, trVi(`editeur.align.${a}`)] as const)} onChoisir={align => mod({ align })} testID={`${id}-align`} />
          <Pastilles theme={theme} libelle="↕" valeur={c.valign} options={[['haut', '⤒'], ['milieu', '↕'], ['bas', '⤓']] as const} onChoisir={valign => mod({ valign })} testID={`${id}-valign`} />
          <Interrupteur theme={theme} libelle={trVi('editeur.majuscules')} valeur={c.majuscules} onChanger={majuscules => mod({ majuscules })} testID={`${id}-majuscules`} />
          <Interrupteur theme={theme} libelle={trVi('editeur.ajuster')} valeur={c.ajuster} onChanger={ajuster => mod({ ajuster })} testID={`${id}-ajuster`} />
          <Interrupteur theme={theme} libelle={trVi('editeur.glitch')} valeur={c.glitch} onChanger={glitch => mod({ glitch })} testID={`${id}-glitch`} />
        </Section>
      ) : null}

      {c.type === 'liste' ? (
        <Section theme={theme} titre={nomType(c)} testID={`${id}-section-liste`}>
          <Pastilles theme={theme} libelle={trVi('editeur.liste_source')} valeur={c.source} options={SOURCES_LISTE.map(s => [s, trVi(`editeur.liste.${s}`)] as const)} onChoisir={source => mod({ source })} testID={`${id}-liste-source`} />
          <Champ theme={theme} libelle={trVi('editeur.ligne_fr')} valeur={c.ligne.fr} maxLength={600} onChanger={fr => mod({ ligne: { ...c.ligne, fr } }, true)} testID={`${id}-ligne-fr`} />
          <Champ theme={theme} libelle={trVi('editeur.ligne_en')} valeur={c.ligne.en} maxLength={600} onChanger={en => mod({ ligne: { ...c.ligne, en } }, true)} testID={`${id}-ligne-en`} />
          <Text style={attenue(theme, 12)}>{trVi('editeur.champs_aide', { liste: champsListe.map(x => `{${x}}`).join(' ') })}</Text>
          <PoliceChoix theme={theme} valeur={c.police} charte={charte} onChanger={police => mod({ police })} testID={`${id}-liste-police`} />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampNombre theme={theme} libelle={trVi('editeur.taille')} valeur={c.taille} min={4} max={400} onChanger={taille => mod({ taille }, true)} testID={`${id}-liste-taille`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.liste_pas')} valeur={c.pas} min={4} max={1000} onChanger={pas => mod({ pas }, true)} testID={`${id}-liste-pas`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.liste_max')} valeur={c.max} min={1} max={30} onChanger={max => mod({ max }, true)} testID={`${id}-liste-max`} />
          </View>
          <RemplissageChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c.couleur} charte={charte} onChanger={r => r && mod({ couleur: r })} testID={`${id}-liste-couleur`} />
          <Pastilles theme={theme} libelle={trVi('editeur.alignement')} valeur={c.align} options={(['gauche', 'centre', 'droite'] as const).map(a => [a, trVi(`editeur.align.${a}`)] as const)} onChoisir={align => mod({ align })} testID={`${id}-liste-align`} />
          <Interrupteur theme={theme} libelle={trVi('editeur.majuscules')} valeur={c.majuscules} onChanger={majuscules => mod({ majuscules })} testID={`${id}-liste-majuscules`} />
          <Interrupteur theme={theme} libelle={trVi('editeur.lueur')} valeur={Boolean(c.surligne)} onChanger={v => mod({ surligne: v ? 'charte:primaire' : null })} testID={`${id}-liste-surligne`} />
          {c.surligne ? <CouleurChoix theme={theme} libelle={trVi('editeur.couleur2')} valeur={c.surligne} charte={charte} onChanger={surligne => mod({ surligne })} testID={`${id}-liste-surligne-couleur`} /> : null}
        </Section>
      ) : null}

      {c.type === 'forme' ? (
        <Section theme={theme} titre={nomType(c)} testID={`${id}-section-forme`}>
          <Pastilles theme={theme} libelle={trVi('editeur.forme')} valeur={c.forme} options={FORMES.map(f => [f, trVi(`editeur.forme.${f}`)] as const)} onChoisir={forme => mod({ forme })} testID={`${id}-forme`} />
          <RemplissageChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c.remplissage} charte={charte} onChanger={remplissage => mod({ remplissage })} testID={`${id}-forme-remplissage`} vide />
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampNombre theme={theme} libelle={trVi('editeur.rayon')} valeur={c.rayon} min={0} max={5000} onChanger={rayon => mod({ rayon }, true)} testID={`${id}-forme-rayon`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.coupe')} valeur={c.coupe} min={0} max={2000} onChanger={coupe => mod({ coupe }, true)} testID={`${id}-forme-coupe`} />
          </View>
        </Section>
      ) : null}

      {c.type === 'image' ? (
        <Section theme={theme} titre={nomType(c)} testID={`${id}-section-image`}>
          <Text style={attenue(theme)}>{'fichier' in c.source ? trVi('editeur.image_importee') : 'champ' in c.source ? trVi('editeur.image_champ', { champ: c.source.champ }) : c.source.asset}</Text>
          {onChoisirImage ? <BoutonHub theme={theme} titre={trVi('editeur.importer_image')} onPress={onChoisirImage} testID={`${id}-image-importer`} /> : null}
          <Pastilles theme={theme} libelle={trVi('editeur.source_image')} valeur={'champ' in c.source ? c.source.champ : ''} options={CHAMPS_IMAGE.map(x => [x, x] as const)} onChoisir={champ => champ && mod({ source: { champ } })} testID={`${id}-image-champ`} />
          <Pastilles theme={theme} libelle={trVi('editeur.ajustement')} valeur={c.ajustement} options={(['couvrir', 'contenir'] as const).map(a => [a, trVi(`editeur.ajustement.${a}`)] as const)} onChoisir={ajustement => mod({ ajustement })} testID={`${id}-image-ajustement`} />
          <Pastilles theme={theme} libelle={trVi('editeur.filtre')} valeur={c.filtre} options={(['normal', 'gris', 'duotone'] as const).map(a => [a, trVi(`editeur.filtre.${a}`)] as const)} onChoisir={filtre => mod({ filtre })} testID={`${id}-image-filtre`} />
          <ChampNombre theme={theme} libelle={trVi('editeur.rayon')} valeur={c.rayon} min={0} max={5000} onChanger={rayon => mod({ rayon }, true)} testID={`${id}-image-rayon`} />
        </Section>
      ) : null}

      {c.type === 'logo' ? (
        <Pastilles theme={theme} libelle={trVi('editeur.cible')} valeur={c.cible} options={(['club', 'team', 'adversaire'] as const).map(x => [x, trVi(`editeur.cible.${x}`)] as const)} onChoisir={cible => mod({ cible })} testID={`${id}-logo-cible`} />
      ) : null}

      <Section theme={theme} titre={trVi('editeur.position')} ouverte={false} testID={`${id}-section-position`}>
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <ChampNombre theme={theme} libelle="X" valeur={c.x} min={-10000} max={10000} onChanger={x => mod({ x }, true)} testID={`${id}-x`} />
          <ChampNombre theme={theme} libelle="Y" valeur={c.y} min={-10000} max={10000} onChanger={y => mod({ y }, true)} testID={`${id}-y`} />
          <ChampNombre theme={theme} libelle="L" valeur={c.l} min={1} max={10000} onChanger={l => mod({ l }, true)} testID={`${id}-l`} />
          <ChampNombre theme={theme} libelle="H" valeur={c.h} min={1} max={10000} onChanger={h => mod({ h }, true)} testID={`${id}-h`} />
          <ChampNombre theme={theme} libelle={trVi('editeur.rotation')} valeur={c.rotation} min={-360} max={360} onChanger={rotation => mod({ rotation }, true)} testID={`${id}-rotation`} />
          <ChampNombre theme={theme} libelle={trVi('editeur.opacite')} valeur={c.opacite} min={0} max={1} onChanger={opacite => mod({ opacite }, true)} testID={`${id}-opacite`} />
        </View>
        <Text style={{ color: theme.texte, fontWeight: '600', fontSize: 13 }}>{trVi('editeur.aligner')}</Text>
        <View style={[styles.ligne, { gap: 4 }]}>
          {(['gauche', 'centreH', 'droite', 'haut', 'centreV', 'bas'] as SensAlignement[]).map(sens => (
            <BoutonHub key={sens} theme={theme} titre={trVi(`editeur.aligner.${sens}`)} onPress={() => mod(aligner(c, sens, W, H))} testID={`${id}-aligner-${sens}`} />
          ))}
        </View>
      </Section>

      <Section theme={theme} titre={trVi('editeur.effets')} ouverte={false} testID={`${id}-section-effets`}>
        <Interrupteur theme={theme} libelle={trVi('editeur.lueur')} valeur={Boolean(c.lueur)} onChanger={v => mod({ lueur: v ? { couleur: 'charte:primaire', force: 28 } : null })} testID={`${id}-lueur`} />
        {c.lueur ? (
          <>
            <CouleurChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c.lueur.couleur} charte={charte} onChanger={couleur => c.lueur && mod({ lueur: { ...c.lueur, couleur } })} testID={`${id}-lueur-couleur`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.force')} valeur={c.lueur.force} min={0} max={100} onChanger={force => c.lueur && mod({ lueur: { ...c.lueur, force } }, true)} testID={`${id}-lueur-force`} />
          </>
        ) : null}
        <Interrupteur theme={theme} libelle={trVi('editeur.contour')} valeur={Boolean(c.contour)} onChanger={v => mod({ contour: v ? { couleur: 'charte:primaire', epaisseur: 3 } : null })} testID={`${id}-contour`} />
        {c.contour ? (
          <>
            <CouleurChoix theme={theme} libelle={trVi('editeur.couleur')} valeur={c.contour.couleur} charte={charte} onChanger={couleur => c.contour && mod({ contour: { ...c.contour, couleur } })} testID={`${id}-contour-couleur`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.epaisseur')} valeur={c.contour.epaisseur} min={0} max={50} onChanger={epaisseur => c.contour && mod({ contour: { ...c.contour, epaisseur } }, true)} testID={`${id}-contour-epaisseur`} />
          </>
        ) : null}
        <Interrupteur theme={theme} libelle={trVi('editeur.ombre')} valeur={Boolean(c.ombre)} onChanger={v => mod({ ombre: v ? { couleur: '#000000', flou: 24, dx: 0, dy: 10, opacite: 0.6 } : null })} testID={`${id}-ombre`} />
        {c.ombre ? (
          <View style={[styles.ligne, { gap: ESP.xs }]}>
            <ChampNombre theme={theme} libelle={trVi('editeur.force')} valeur={c.ombre.flou} min={0} max={200} onChanger={flou => c.ombre && mod({ ombre: { ...c.ombre, flou } }, true)} testID={`${id}-ombre-flou`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.decalage_x')} valeur={c.ombre.dx} min={-500} max={500} onChanger={dx => c.ombre && mod({ ombre: { ...c.ombre, dx } }, true)} testID={`${id}-ombre-dx`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.decalage_y')} valeur={c.ombre.dy} min={-500} max={500} onChanger={dy => c.ombre && mod({ ombre: { ...c.ombre, dy } }, true)} testID={`${id}-ombre-dy`} />
            <ChampNombre theme={theme} libelle={trVi('editeur.opacite')} valeur={c.ombre.opacite} min={0} max={1} onChanger={opacite => c.ombre && mod({ ombre: { ...c.ombre, opacite } }, true)} testID={`${id}-ombre-opacite`} />
          </View>
        ) : null}
      </Section>

      <Section theme={theme} titre={trVi('editeur.condition')} ouverte={false} testID={`${id}-section-condition`}>
        <Pastilles
          theme={theme}
          libelle={trVi('editeur.condition')}
          valeur={c.si ?? ''}
          options={[
            ['', trVi('editeur.condition.toujours')],
            ['serie', trVi('editeur.condition.serie')],
            ['classement', trVi('editeur.condition.classement')],
            ...(['victoire', 'tournoi', 'mvp', 'bo', 'points', 'cashprize', 'map_1', 'agent_mvp'] as const).flatMap(x => [[`champ:${x}`, `{${x}}`] as const, [`!champ:${x}`, `!{${x}}`] as const]),
          ]}
          onChoisir={si => mod({ si: si || null })}
          testID={`${id}-condition`}
        />
      </Section>
    </View>
  );
}
