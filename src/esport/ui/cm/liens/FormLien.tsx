/**
 * Formulaire d'un lien utile (volet) : titre, adresse https (validée ici puis par le serveur), description, étiquette,
 * team facultative, épinglage. Sert à l'onglet DATA › Ressources et à « Créer une nouvelle ressource » depuis une carte
 * ou un dossier du Drive. À la création, avec `optionsAcces` : « Qui voit la ressource » (toute l'équipe CM ou
 * restreinte, migration 0048) ; ensuite, le réglage se fait dans le menu ⋯ de la ressource.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BoutonHub, Champ, Interrupteur } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import type { NiveauAcces } from '../../../cm/api';
import { adresseLienValide, type AccesLien, type LienCm, type ReglageAccesLien, type SaisieLien } from '../../../cm/liens';
import { trLi } from '../../../i18n/liens';
import { Retours, styles, useAgir } from '../../commun';
import { ESP, Volet, attenue } from '../../design';
import { reglesDe } from '../ChoixAcces';
import { ChoixVisibilite } from './AccesRessource';

export function FormLien({
  theme,
  lien,
  categories,
  teams,
  titreBouton,
  onEnregistrer,
  onFermer,
  optionsAcces,
  prefixe = 'esport-cm-liens-form',
}: {
  theme: ThemeHub;
  lien?: LienCm;
  categories: string[];
  teams: Array<{ id: string; nom: string }>;
  /** Libellé du bouton d'envoi (« Créer et lier » depuis une carte). */
  titreBouton?: string;
  onEnregistrer(s: SaisieLien): Promise<void>;
  onFermer(): void;
  /** Création : personnes et rôles proposables pour « Qui voit la ressource » (sans lui : toute l'équipe CM). */
  optionsAcces?(teamId: string | null): Promise<ReglageAccesLien>;
  prefixe?: string;
}) {
  const [titre, setTitre] = useState(lien?.titre ?? '');
  const [url, setUrl] = useState(lien?.url ?? '');
  const [description, setDescription] = useState(lien?.description ?? '');
  const [categorie, setCategorie] = useState(lien?.categorie ?? '');
  const [teamId, setTeamId] = useState<string | null>(lien?.team?.id ?? null);
  const [epingle, setEpingle] = useState(lien?.epingle ?? false);
  const [local, setLocal] = useState<string | undefined>();
  const [reglage, setReglage] = useState<ReglageAccesLien | undefined>();
  const [acces, setAcces] = useState<AccesLien>('tous');
  const [niveaux, setNiveaux] = useState<Map<string, NiveauAcces>>(new Map());
  const { erreur, agir } = useAgir();
  const avecAcces = !lien && Boolean(optionsAcces);
  // Options relues quand la team change (une ressource de team ne se partage qu'avec qui lit son CM).
  useEffect(() => {
    if (!avecAcces || acces !== 'restreint' || !optionsAcces) return;
    let actif = true;
    optionsAcces(teamId)
      .then(r => {
        if (actif) setReglage(r);
      })
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [avecAcces, acces, optionsAcces, teamId]);
  const envoyer = () => {
    if (!titre.trim()) return setLocal(trLi('form.titre_requis'));
    const adresse = adresseLienValide(url);
    if (!adresse) return setLocal(trLi('form.url_invalide'));
    setLocal(undefined);
    void agir('lien', async () => {
      // Seulement les choix encore proposés (la team a pu changer depuis).
      const o = reglage?.options;
      const proposes = new Set(o ? [...o.personnes.map(p => `compte|${p.compte}`), ...o.rolesCm.map(r => `role_cm|${r.id}`), ...o.rolesClub.map(r => `role_club|${r.id}`), ...o.rolesTeam.map(r => `role_team|${r.id}`)] : []);
      const visibilite = avecAcces ? { acces, regles: acces === 'restreint' ? reglesDe(niveaux).filter(r => proposes.has(`${r.genre}|${r.cible}`)) : [] } : {};
      await onEnregistrer({ titre: titre.trim(), url: adresse, description: description.trim(), categorie: categorie.trim() || null, teamId, epingle, ...visibilite });
      onFermer();
    });
  };
  const suggestions = categories.filter(c => c !== categorie && (!categorie.trim() || c.toLowerCase().includes(categorie.trim().toLowerCase()))).slice(0, 8);
  return (
    <Volet theme={theme} visible titre={lien ? trLi('form.modifier') : trLi('form.nouveau')} onFermer={onFermer} testID={`${prefixe}-volet`} largeur={480}>
      <View style={{ gap: ESP.s, padding: ESP.l }}>
        <Retours theme={theme} erreur={local ?? erreur} prefixe={prefixe} />
        <Champ theme={theme} libelle={trLi('form.titre')} valeur={titre} onChanger={setTitre} maxLength={120} testID={`${prefixe}-titre`} />
        <Champ theme={theme} libelle={trLi('form.url')} valeur={url} onChanger={setUrl} maxLength={2048} placeholder="https://" testID={`${prefixe}-url`} />
        <Text style={attenue(theme, 12)}>{trLi('form.url_aide')}</Text>
        <Champ theme={theme} libelle={trLi('form.description')} valeur={description} onChanger={setDescription} maxLength={500} multiligne testID={`${prefixe}-description`} />
        <Champ theme={theme} libelle={trLi('form.categorie')} valeur={categorie} onChanger={setCategorie} maxLength={40} testID={`${prefixe}-categorie`} />
        {suggestions.length ? (
          <View style={[styles.ligne, { gap: ESP.xxs }]}>
            {suggestions.map(c => (
              <BoutonHub key={c} theme={theme} titre={c} onPress={() => setCategorie(c)} testID={`${prefixe}-categorie-${c}`} />
            ))}
          </View>
        ) : null}
        {teams.length ? (
          <View style={{ gap: ESP.xxs }}>
            <Text style={attenue(theme, 13)}>{trLi('form.team')}</Text>
            <View style={[styles.ligne, { gap: ESP.xxs }]}>
              <BoutonHub theme={theme} titre={trLi('form.team_aucune')} variante={teamId === null ? 'plein' : undefined} onPress={() => setTeamId(null)} testID={`${prefixe}-team-aucune`} />
              {teams.map(t => (
                <BoutonHub key={t.id} theme={theme} titre={t.nom} variante={teamId === t.id ? 'plein' : undefined} onPress={() => setTeamId(t.id)} testID={`${prefixe}-team-${t.id}`} />
              ))}
            </View>
          </View>
        ) : null}
        <Interrupteur theme={theme} libelle={trLi('form.epingler')} valeur={epingle} onChanger={setEpingle} testID={`${prefixe}-epingle`} />
        {avecAcces ? (
          <View style={{ gap: ESP.xs }} testID={`${prefixe}-visibilite`}>
            <ChoixVisibilite
              theme={theme}
              reglage={reglage ?? { lien: null, acces: 'tous', regles: [], effectifs: null, options: { personnes: [], rolesCm: [], rolesClub: [], rolesTeam: [] }, moi: '' }}
              acces={acces}
              onAcces={setAcces}
              niveaux={niveaux}
              onNiveaux={setNiveaux}
              testID={`${prefixe}-acces`}
            />
          </View>
        ) : null}
        <View style={[styles.ligne, { gap: ESP.xs }]}>
          <BoutonHub theme={theme} titre={titreBouton ?? (lien ? trLi('form.enregistrer') : trLi('form.ajouter'))} variante="plein" onPress={envoyer} testID={`${prefixe}-ok`} />
          <BoutonHub theme={theme} titre={trLi('form.annuler')} onPress={onFermer} testID={`${prefixe}-annuler`} />
        </View>
      </View>
    </Volet>
  );
}
