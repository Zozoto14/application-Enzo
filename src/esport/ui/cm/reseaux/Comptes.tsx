/**
 * Page Réseaux › Comptes : comptes du club et des teams (réseau, identifiant @, profil, team, actif), leurs
 * relevés datés (abonnés, publications, vues, impressions) et, pour le gestionnaire (cm.gerer), l'annonce
 * Discord de chaque compte : salons cibles, rôle mentionné, modèles anglais / français, aperçu, test.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { BoutonHub, Champ } from '../../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../../hub/themes';
import { METRIQUES_COMPTE, variablesInconnues, type ApercuMessage, type ApiReseaux, type CompteReseau, type DetailCompte, type EtatReseaux, type MetriqueCompte, type ReseauCompte } from '../../../cm/reseauxApi';
import { traduireServeur } from '../../../i18n/erreurs';
import { trRs, type CleRs } from '../../../i18n/reseaux';
import { BoutonConfirme, Choix, Panneau, Retours, styles, useAgir } from '../../commun';
import { Badge, Carte, ESP, EtatVide, Grille, TitreCarte, Volet, attenue, texte } from '../../design';
import { Courbe } from '../../graphiquesUsage/Courbe';
import { Aide } from '../commun';
import { FormulaireReleve, LigneInterrupteur, Pastille, jourCourt, nb } from './commun';

type Ouvert = { genre: 'releves' | 'annonce' | 'modifier'; id: string } | undefined;

export function Comptes({ theme, api, etat, large, onChange }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; large: boolean; onChange(): void }) {
  const [ouvert, setOuvert] = useState<Ouvert>();
  const [nouveau, setNouveau] = useState<{ reseau: ReseauCompte; url: string; identifiant: string; nom: string; teamId: string } | undefined>();
  const { erreur, avis, agir } = useAgir();
  const gerer = etat.droits.gerer;
  const nomTeam = (id: string | null) => (id ? (etat.teams.find(t => t.id === id)?.nom ?? '?') : trRs('c.club'));
  const compte = ouvert ? etat.comptes.find(c => c.id === ouvert.id) : undefined;
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-comptes">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-comptes" />
      {gerer ? (
        <View style={styles.ligne}>
          <BoutonHub theme={theme} titre={trRs('comptes.ajouter')} variante="plein" onPress={() => setNouveau({ reseau: 'x', url: '', identifiant: '', nom: '', teamId: '' })} testID="esport-rs-compte-ajouter" />
        </View>
      ) : null}
      {!etat.comptes.length ? (
        <Carte theme={theme}>
          <EtatVide theme={theme} glyphe="@" titre={trRs('comptes.vide')} texte={gerer ? trRs('comptes.ajouter_aide') : ''} />
        </Carte>
      ) : (
        <Grille min={large ? 300 : 240} testID="esport-rs-comptes-liste">
          {etat.comptes.map(c => (
            <Carte key={c.id} theme={theme} dense testID={`esport-rs-compte-${c.id}`}>
              <View style={[styles.ligne, { gap: ESP.xxs }]}>
                <Pastille theme={theme} etat={etat} reseau={c.reseau} />
                {!c.actif ? <Badge theme={theme} ton="alerte" texte={trRs('comptes.inactif')} /> : null}
                {c.annonce ? <Badge theme={theme} ton={c.annonce.active ? 'ok' : 'neutre'} texte={c.annonce.active ? trRs('comptes.annonce_active') : trRs('comptes.annonce_inactive')} /> : null}
              </View>
              <Text style={{ ...texte(theme, 16), fontWeight: '800' }} accessibilityRole="link" onPress={() => void Linking.openURL(c.url)}>{`@${c.identifiant}`}</Text>
              <Text style={attenue(theme)}>{[c.nom, nomTeam(c.teamId)].filter(Boolean).join(' · ')}</Text>
              {c.dernierReleve?.abonnes !== null && c.dernierReleve?.abonnes !== undefined ? <Text style={texte(theme, 13)}>{trRs('comptes.abonnes', { n: nb(c.dernierReleve.abonnes), jour: jourCourt(c.dernierReleve.jour) })}</Text> : null}
              <View style={[styles.ligne, { gap: ESP.xs }]}>
                <BoutonHub theme={theme} titre={trRs('comptes.releves')} onPress={() => setOuvert({ genre: 'releves', id: c.id })} testID={`esport-rs-compte-${c.id}-releves`} />
                {gerer ? <BoutonHub theme={theme} titre={trRs('comptes.regler_annonce')} onPress={() => setOuvert({ genre: 'annonce', id: c.id })} testID={`esport-rs-compte-${c.id}-annonce`} /> : null}
                {gerer ? <BoutonHub theme={theme} titre={trRs('c.modifier')} onPress={() => setOuvert({ genre: 'modifier', id: c.id })} testID={`esport-rs-compte-${c.id}-modifier`} /> : null}
              </View>
            </Carte>
          ))}
        </Grille>
      )}
      {ouvert && compte && ouvert.genre === 'releves' ? (
        <Volet theme={theme} visible titre={`${trRs('comptes.releves')} · @${compte.identifiant}`} onFermer={() => setOuvert(undefined)} largeur={680} testID="esport-rs-compte-volet">
          <RelevesCompte theme={theme} api={api} id={compte.id} large={large} onChange={onChange} />
        </Volet>
      ) : null}
      {ouvert && compte && ouvert.genre === 'annonce' ? (
        <Volet theme={theme} visible titre={trRs('annonce.titre', { compte: compte.identifiant })} onFermer={() => setOuvert(undefined)} largeur={760} testID="esport-rs-annonce-volet">
          <ReglageAnnonce theme={theme} api={api} etat={etat} compte={compte} onChange={onChange} />
        </Volet>
      ) : null}
      {ouvert && compte && ouvert.genre === 'modifier' ? (
        <Volet theme={theme} visible titre={`${trRs('c.modifier')} · @${compte.identifiant}`} onFermer={() => setOuvert(undefined)} testID="esport-rs-compte-modifier-volet">
          <ModifierCompte
            theme={theme}
            api={api}
            etat={etat}
            compte={compte}
            onFini={() => {
              setOuvert(undefined);
              onChange();
            }}
          />
        </Volet>
      ) : null}
      {nouveau ? (
        <Volet theme={theme} visible titre={trRs('comptes.ajouter')} onFermer={() => setNouveau(undefined)} testID="esport-rs-compte-nouveau">
          <Aide theme={theme}>{trRs('comptes.ajouter_aide')}</Aide>
          <Choix theme={theme} libelle={trRs('c.reseau')} valeur={nouveau.reseau} options={etat.reseaux.map(r => ({ id: r.cle, nom: r.nom }))} onChoisir={reseau => setNouveau({ ...nouveau, reseau })} testID="esport-rs-compte-nouveau-reseau" />
          <Champ theme={theme} libelle={trRs('comptes.url')} valeur={nouveau.url} onChanger={url => setNouveau({ ...nouveau, url })} maxLength={300} placeholder="https://x.com/…" testID="esport-rs-compte-nouveau-url" />
          <Champ theme={theme} libelle={trRs('comptes.identifiant')} valeur={nouveau.identifiant} onChanger={identifiant => setNouveau({ ...nouveau, identifiant })} maxLength={40} testID="esport-rs-compte-nouveau-identifiant" />
          <Champ theme={theme} libelle={trRs('comptes.nom')} valeur={nouveau.nom} onChanger={nom => setNouveau({ ...nouveau, nom })} maxLength={80} testID="esport-rs-compte-nouveau-nom" />
          <Choix theme={theme} libelle={trRs('comptes.team')} valeur={nouveau.teamId || 'club'} options={[{ id: 'club', nom: trRs('c.club') }, ...etat.teams.map(t => ({ id: t.id, nom: t.nom }))]} onChoisir={t => setNouveau({ ...nouveau, teamId: t === 'club' ? '' : t })} testID="esport-rs-compte-nouveau-team" />
          <Retours theme={theme} erreur={erreur} prefixe="esport-rs-compte-nouveau" />
          <BoutonHub
            theme={theme}
            titre={trRs('c.ajouter')}
            variante="plein"
            desactive={!nouveau.url.trim()}
            onPress={() =>
              void agir('creer', async () => {
                await api.creerCompte({ reseau: nouveau.reseau, url: nouveau.url.trim(), ...(nouveau.identifiant.trim() ? { identifiant: nouveau.identifiant.trim() } : {}), nom: nouveau.nom.trim(), teamId: nouveau.teamId || null });
                setNouveau(undefined);
                onChange();
                return trRs('c.enregistre');
              })
            }
            testID="esport-rs-compte-nouveau-ok"
          />
        </Volet>
      ) : null}
    </View>
  );
}

function ModifierCompte({ theme, api, etat, compte, onFini }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; compte: CompteReseau; onFini(): void }) {
  const [s, setS] = useState({ url: compte.url, nom: compte.nom, teamId: compte.teamId ?? '', actif: compte.actif });
  const { erreur, agir } = useAgir();
  return (
    <View style={{ gap: ESP.s }} testID="esport-rs-compte-modifier">
      <Champ theme={theme} libelle={trRs('comptes.url')} valeur={s.url} onChanger={url => setS({ ...s, url })} maxLength={300} testID="esport-rs-compte-modifier-url" />
      <Champ theme={theme} libelle={trRs('comptes.nom')} valeur={s.nom} onChanger={nom => setS({ ...s, nom })} maxLength={80} testID="esport-rs-compte-modifier-nom" />
      <Choix theme={theme} libelle={trRs('comptes.team')} valeur={s.teamId || 'club'} options={[{ id: 'club', nom: trRs('c.club') }, ...etat.teams.map(t => ({ id: t.id, nom: t.nom }))]} onChoisir={t => setS({ ...s, teamId: t === 'club' ? '' : t })} testID="esport-rs-compte-modifier-team" />
      <LigneInterrupteur theme={theme} libelle={trRs('comptes.actif')} valeur={s.actif} onChanger={actif => setS({ ...s, actif })} testID="esport-rs-compte-modifier-actif" />
      <Retours theme={theme} erreur={erreur} prefixe="esport-rs-compte-modifier" />
      <BoutonHub
        theme={theme}
        titre={trRs('c.enregistrer')}
        variante="plein"
        onPress={() =>
          void agir('modifier', async () => {
            await api.modifierCompte(compte.id, { ...(s.url.trim() !== compte.url ? { url: s.url.trim() } : {}), nom: s.nom.trim(), teamId: s.teamId || null, actif: s.actif });
            onFini();
          })
        }
        testID="esport-rs-compte-modifier-ok"
      />
      <Aide theme={theme}>{trRs('comptes.supprimer_aide')}</Aide>
      <BoutonConfirme theme={theme} titre={trRs('c.supprimer')} confirmation={trRs('c.confirmer_suppression')} onConfirme={() => void agir('supprimer', async () => (await api.supprimerCompte(compte.id), onFini()))} testID="esport-rs-compte-supprimer" />
    </View>
  );
}

const libelleMetrique = (m: MetriqueCompte): string => trRs(`metrique.${m}` as CleRs);

function RelevesCompte({ theme, api, id, large, onChange }: { theme: ThemeHub; api: ApiReseaux; id: string; large: boolean; onChange(): void }) {
  const [d, setD] = useState<DetailCompte | undefined>();
  const [saisie, setSaisie] = useState<Partial<Record<MetriqueCompte | 'jour', string>>>({});
  const { erreur, avis, agir, enCours } = useAgir();
  useEffect(() => {
    void agir('', async () => setD(await api.relevesCompte(id)));
  }, [agir, api, id]);
  if (!d) return <Retours theme={theme} erreur={erreur} prefixe="esport-rs-releves-compte" />;
  return (
    <View style={{ gap: ESP.m }} testID="esport-rs-releves-compte">
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-releves-compte" />
      {d.evolution.serie.length > 1 ? (
        <Carte theme={theme}>
          <TitreCarte theme={theme} titre={trRs('tdb.comptes')} />
          <Courbe theme={theme} points={d.evolution.serie.map(p => ({ jour: p.jour, valeur: p.abonnes, detail: trRs('tdb.point', { jour: jourCourt(p.jour), n: nb(p.abonnes) }) }))} testID="esport-rs-compte-courbe" />
        </Carte>
      ) : null}
      <Carte theme={theme}>
        {d.releves.length === 0 ? <Text style={attenue(theme)}>{trRs('c.aucune_donnee')}</Text> : null}
        {[...d.releves].reverse().map(r => (
          <View key={r.id} style={[styles.ligne, { gap: ESP.xs, justifyContent: 'space-between' }]} testID={`esport-rs-releve-compte-${r.jour}`}>
            <Text style={{ ...texte(theme, 13), flex: 1, minWidth: 200 }}>{trRs('comptes.ligne_releve', { jour: jourCourt(r.jour), abonnes: nb(r.abonnes), publications: nb(r.publications), vues: nb(r.vues), impressions: nb(r.impressions) })}</Text>
            {d.editer ? <BoutonConfirme theme={theme} titre={trRs('c.supprimer')} confirmation={trRs('c.confirmer_suppression')} onConfirme={() => void agir('supprimer', async () => setD(await api.supprimerReleveCompte(r.id)))} testID={`esport-rs-releve-compte-${r.jour}-supprimer`} /> : null}
          </View>
        ))}
      </Carte>
      {d.editer ? (
        <Panneau theme={theme}>
          <TitreCarte theme={theme} titre={trRs('comptes.nouveau_releve')} sous={trRs('pub.releve_aide')} />
          <FormulaireReleve
            theme={theme}
            champs={METRIQUES_COMPTE}
            libelle={libelleMetrique}
            valeurs={saisie}
            onChanger={setSaisie}
            large={large}
            desactive={Boolean(enCours)}
            testID="esport-rs-releve-compte"
            onEnregistrer={() =>
              void agir('relever', async () => {
                const { jour, ...valeurs } = saisie;
                setD(await api.releverCompte(id, { ...(jour?.trim() ? { jour: jour.trim() } : {}), ...Object.fromEntries(Object.entries(valeurs).filter(([, v]) => (v ?? '').trim())) }));
                setSaisie({});
                onChange();
                return trRs('c.enregistre');
              })
            }
          />
        </Panneau>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ Annonce Discord d'un compte

function ReglageAnnonce({ theme, api, etat, compte, onChange }: { theme: ThemeHub; api: ApiReseaux; etat: EtatReseaux; compte: CompteReseau; onChange(): void }) {
  const a = compte.annonce;
  const [s, setS] = useState({
    active: a?.active ?? false,
    modeleEn: a?.modeleEn ?? '',
    modeleFr: a?.modeleFr ?? '',
    roleMention: a?.roleMention ?? '',
    cibles: new Set((a?.cibles ?? []).map(c => c.cle)),
  });
  const [apercu, setApercu] = useState<{ en: ApercuMessage; fr: ApercuMessage } | undefined>();
  const [resultats, setResultats] = useState<Array<{ cible: string; ok: boolean; motif?: string }> | undefined>();
  const { erreur, avis, agir, enCours } = useAgir();
  const options = [
    ...etat.teams.map(t => ({ cle: `team:${t.id}`, genre: 'team' as const, id: t.id, nom: trRs(`annonce.team_${t.discord ?? 'sans'}` as CleRs, { team: t.nom }), pret: t.discord === 'bot' || t.discord === 'webhook' })),
    ...(etat.salons ?? []).map(x => ({ cle: `salon:${x.id}`, genre: 'salon' as const, id: x.id, nom: trRs('annonce.salon', { nom: x.nom }), pret: !x.invalide })),
  ];
  const inconnues = [...variablesInconnues(s.modeleEn, etat.variables), ...variablesInconnues(s.modeleFr, etat.variables)];
  const nomCible = (cle: string) => options.find(o => o.cle === cle)?.nom ?? cle;
  const basculer = (cle: string) => {
    const c = new Set(s.cibles);
    if (c.has(cle)) c.delete(cle);
    else c.add(cle);
    setS({ ...s, cibles: c });
  };
  const enregistrer = () =>
    agir('enregistrer', async () => {
      await api.reglerAnnonce(compte.id, {
        active: s.active,
        modeleEn: s.modeleEn,
        modeleFr: s.modeleFr,
        roleMention: s.roleMention,
        cibles: options.filter(o => s.cibles.has(o.cle)).map(o => ({ genre: o.genre, id: o.id })),
      });
      onChange();
      return trRs('c.enregistre');
    });
  return (
    <View style={{ gap: ESP.s }} testID="esport-rs-annonce">
      <Aide theme={theme}>{trRs('annonce.aide')}</Aide>
      <LigneInterrupteur theme={theme} libelle={trRs('annonce.active')} valeur={s.active} onChanger={active => setS({ ...s, active })} testID="esport-rs-annonce-active" />
      <Text style={{ ...texte(theme, 13), fontWeight: '600' }}>{trRs('annonce.cibles')}</Text>
      <Aide theme={theme}>{trRs('annonce.cibles_aide')}</Aide>
      {options.length === 0 ? <Text style={attenue(theme)}>{trRs('annonce.aucune_cible')}</Text> : null}
      {options.map(o => (
        <LigneInterrupteur key={o.cle} theme={theme} libelle={o.nom} valeur={s.cibles.has(o.cle)} onChanger={() => basculer(o.cle)} desactive={!o.pret && !s.cibles.has(o.cle)} testID={`esport-rs-annonce-cible-${o.cle.replace(':', '-')}`} />
      ))}
      <Champ theme={theme} libelle={trRs('annonce.role')} valeur={s.roleMention} onChanger={roleMention => setS({ ...s, roleMention })} maxLength={25} placeholder="123456789012345678" testID="esport-rs-annonce-role" />
      <Aide theme={theme}>{trRs('annonce.role_aide')}</Aide>
      <Champ theme={theme} libelle={trRs('annonce.modele_en')} valeur={s.modeleEn} onChanger={modeleEn => setS({ ...s, modeleEn })} multiligne maxLength={500} placeholder={etat.modelesDefaut.en} testID="esport-rs-annonce-modele-en" />
      <Champ theme={theme} libelle={trRs('annonce.modele_fr')} valeur={s.modeleFr} onChanger={modeleFr => setS({ ...s, modeleFr })} multiligne maxLength={500} placeholder={etat.modelesDefaut.fr} testID="esport-rs-annonce-modele-fr" />
      <Text style={attenue(theme)}>{trRs('annonce.variables', { variables: etat.variables.map(v => `{${v}}`).join(', ') })}</Text>
      {inconnues.length ? <Text style={{ ...texte(theme, 13), color: theme.critique }} testID="esport-rs-annonce-inconnues">{trRs('annonce.variables_inconnues', { variables: [...new Set(inconnues)].map(v => `{${v}}`).join(', ') })}</Text> : null}
      <Retours theme={theme} erreur={erreur} avis={avis} prefixe="esport-rs-annonce" />
      <View style={[styles.ligne, { gap: ESP.xs }]}>
        <BoutonHub theme={theme} titre={trRs('c.enregistrer')} variante="plein" desactive={inconnues.length > 0 || Boolean(enCours)} onPress={() => void enregistrer()} testID="esport-rs-annonce-enregistrer" />
        <BoutonHub
          theme={theme}
          titre={trRs('annonce.apercu')}
          desactive={inconnues.length > 0}
          onPress={() => void agir('apercu', async () => setApercu(await api.apercu({ reseau: compte.reseau, identifiant: compte.identifiant, url: compte.url, teamId: compte.teamId, modeleEn: s.modeleEn, modeleFr: s.modeleFr, roleMention: s.roleMention })))}
          testID="esport-rs-annonce-apercu"
        />
        <BoutonHub
          theme={theme}
          titre={trRs('annonce.tester')}
          desactive={!(a?.cibles.length)}
          onPress={() =>
            void agir('tester', async () => {
              const r = await api.tester(compte.id);
              setResultats(r.resultats);
            })
          }
          testID="esport-rs-annonce-tester"
        />
      </View>
      {resultats ? (
        <View style={{ gap: 2 }} testID="esport-rs-annonce-resultats">
          {resultats.map(r => (
            <Text key={r.cible} style={{ ...texte(theme, 13), color: r.ok ? theme.texte : theme.critique }}>
              {trRs('annonce.test_resultat', { cible: nomCible(r.cible), resultat: r.ok ? trRs('annonce.test_reussi') : traduireServeur(r.motif ?? '') })}
            </Text>
          ))}
        </View>
      ) : null}
      {apercu ? (
        <View style={{ gap: ESP.s, flexDirection: 'row', flexWrap: 'wrap' }} testID="esport-rs-annonce-apercu-messages">
          {(['en', 'fr'] as const).map(l => (
            <View key={l} style={{ flexBasis: 300, flexGrow: 1, gap: ESP.xxs, borderLeftWidth: 4, borderLeftColor: etat.reseaux.find(r => r.cle === compte.reseau)?.couleur ?? theme.accent, paddingLeft: ESP.s }}>
              <Text style={{ ...attenue(theme), fontWeight: '700' }}>{trRs(l === 'en' ? 'annonce.apercu_en' : 'annonce.apercu_fr')}</Text>
              {apercu[l].mention ? <Text style={{ ...texte(theme, 13), color: theme.accent }}>{apercu[l].mention}</Text> : null}
              {apercu[l].embed.author?.name ? <Text style={attenue(theme)}>{apercu[l].embed.author?.name}</Text> : null}
              <Text style={{ ...texte(theme, 15), fontWeight: '800' }}>{apercu[l].embed.title}</Text>
              <Text style={texte(theme, 14)} testID={`esport-rs-annonce-apercu-${l}`}>
                {apercu[l].embed.description}
              </Text>
              {(apercu[l].embed.fields ?? []).map(f => (
                <Text key={f.name} style={attenue(theme)}>{`${f.name} : ${f.value}`}</Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
