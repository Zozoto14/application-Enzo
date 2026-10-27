/**
 * Visuels sur l'app iPhone / Android (sans canevas Konva) : aperçu du dernier rendu et RETOUCHE DES TEXTES
 * (français et anglais) d'un visuel ; le rendu sera refait au prochain « Générer » sur le site ou l'app PC.
 * L'éditeur complet (calques, déplacement, effets…) est dans Editeur.web.tsx.
 */

import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import { estRefDefaut, type Visuel } from '../../../cm/visuels/api';
import { lireDocument } from '../../../cm/visuels/document';
import { documentsDefaut, modeleDefaut } from '../../../cm/visuels/modeles';
import type { CalqueTexte, DocumentVisuel } from '../../../cm/visuels/types';
import { trVi } from '../../../i18n/visuels';
import { Intertitre, Panneau, Retours, styles, useAgir } from '../../commun';
import { ESP, attenue } from '../../design';
import type { PropsEditeurVisuel } from './typesEditeur';

export type { PropsEditeurVisuel };

function documentDe(p: PropsEditeurVisuel, v: Visuel | null): DocumentVisuel {
  const c = p.cible;
  if (v) return lireDocument(v.document ?? (!estRefDefaut(v.modele) && c.modele?.documents[v.format] ? c.modele.documents[v.format] : modeleDefaut(v.type, v.format)), v.format);
  if (c.genre === 'modele') return c.modele?.documents.carre ? lireDocument(c.modele.documents.carre, 'carre') : documentsDefaut(c.type).carre;
  return modeleDefaut('libre', 'carre');
}

export function EditeurVisuel(props: PropsEditeurVisuel) {
  const { theme, api, cible, onFermer } = props;
  const [visuel, setVisuel] = useState<Visuel | null>(cible.genre === 'visuel' ? cible.visuel : null);
  const [doc, setDoc] = useState<DocumentVisuel>(() => documentDe(props, cible.genre === 'visuel' ? cible.visuel : null));
  const [apercu, setApercu] = useState<string | undefined>();
  const [modifie, setModifie] = useState(false);
  const [change, setChange] = useState(false);
  const { erreur, avis, agir, enCours } = useAgir();
  useEffect(() => {
    if (!visuel?.fichierId) return;
    void api
      .lienRendu(visuel.id)
      .then(l => setApercu(l.url))
      .catch(() => undefined);
  }, [api, visuel?.id, visuel?.fichierId]);
  const textes = doc.calques.filter((c): c is CalqueTexte => c.type === 'texte' && !c.id.startsWith('deco-'));
  const changer = (id: string, langue: 'fr' | 'en', valeur: string) => {
    setDoc(d => ({ ...d, calques: d.calques.map(c => (c.id === id && c.type === 'texte' ? { ...c, texte: { ...c.texte, [langue]: valeur } } : c)) }));
    setModifie(true);
  };
  return (
    <View style={{ gap: ESP.m }} testID="esport-vi-editeur-mobile">
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={`← ${trVi('editeur.retour')}`} onPress={() => onFermer(change)} testID="esport-vi-retour" />
      </View>
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-vi-editeur" />
      <Text style={attenue(theme)}>{trVi('espace.lecture_mobile')}</Text>
      {apercu ? <Image source={{ uri: apercu }} accessibilityIgnoresInvertColors style={{ width: '100%', aspectRatio: doc.format === 'paysage' ? 16 / 9 : doc.format === 'story' ? 9 / 16 : doc.format === 'portrait' ? 4 / 5 : 1, borderRadius: 8 }} resizeMode="contain" testID="esport-vi-apercu-rendu" /> : null}
      {visuel ? (
        <Panneau theme={theme} testID="esport-vi-retouche">
          <Intertitre theme={theme}>{trVi('editeur.retouche_mobile')}</Intertitre>
          <Text style={attenue(theme)}>{trVi('editeur.retouche_mobile_aide')}</Text>
          {textes.map(c => (
            <View key={c.id} style={{ gap: ESP.xs }}>
              <Champ theme={theme} libelle={trVi('editeur.texte_fr')} valeur={c.texte.fr} multiligne maxLength={600} onChanger={v => changer(c.id, 'fr', v)} testID={`esport-vi-retouche-${c.id}-fr`} />
              <Champ theme={theme} libelle={trVi('editeur.texte_en')} valeur={c.texte.en} multiligne maxLength={600} onChanger={v => changer(c.id, 'en', v)} testID={`esport-vi-retouche-${c.id}-en`} />
            </View>
          ))}
          <BoutonHub
            theme={theme}
            titre={trVi('editeur.enregistrer')}
            variante="plein"
            desactive={!modifie || Boolean(enCours)}
            onPress={() =>
              void agir('enregistrer', async () => {
                const r = await api.modifierVisuel(visuel.id, visuel.version, { document: doc });
                setVisuel(r.visuel);
                setModifie(false);
                setChange(true);
                return trVi('editeur.enregistre');
              })
            }
            testID="esport-vi-enregistrer"
          />
        </Panneau>
      ) : null}
    </View>
  );
}
