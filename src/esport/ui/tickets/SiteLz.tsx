/**
 * Tickets › Configuration › Site LZ : équipes des tournois du site LigneZero et roster LZ (modifiables), rôles et
 * salons Discord créés automatiquement pour chaque équipe, inscriptions reçues par ticket à valider.
 * Le serveur vérifie tout (identifiants Discord, droits) ; l'écran n'affiche que la réponse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Avis, BoutonHub, Champ, Interrupteur } from '../../../hub/admin/ui/commun';
import type { ThemeHub } from '../../../hub/themes';
import type { ClientEsport } from '../../client';
import { formaterDate } from '../../i18n';
import { trTk } from '../../i18n/tickets';
import { apiSite, type EquipeSite, type JoueurSite, type VueSite } from '../../tickets/api';
import { Choix, Intertitre, Panneau as Bloc, styles } from '../commun';
import { Badge, ESP, Squelette, attenue, texte } from '../design';

type Agir = (libelle: string, action: () => Promise<string | void>) => Promise<boolean>;
const quand = (iso: string | null | undefined) => (iso ? formaterDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function SectionSiteLz({ theme, client, agir }: { theme: ThemeHub; client: ClientEsport; agir: Agir }) {
  const api = useMemo(() => apiSite(client), [client]);
  const [vue, setVue] = useState<VueSite | undefined>();
  const [lienCat, setLienCat] = useState<string | undefined>();
  const [lienTournoi, setLienTournoi] = useState<string | undefined>();
  useEffect(() => {
    void agir('site', async () => setVue(await api.vue()));
  }, [agir, api]);
  const changer = useCallback((c: Partial<VueSite['reglages']>) => void agir('site-reglages', async () => (setVue(await api.changer(c)), trTk('enregistre'))), [agir, api]);
  if (!vue) return <Squelette theme={theme} lignes={4} testID="esport-tk-site-chargement" />;
  const r = vue.reglages;
  const tournois = vue.donnees?.tournois ?? [];
  const nomCat = (id: string) => vue.categories.find(c => c.id === id)?.nom ?? '?';
  const nomTournoi = (id: string) => tournois.find(t => t.id === id)?.nom ?? '?';

  return (
    <View style={{ gap: ESP.m }} testID="esport-tk-conf-site">
      <Bloc theme={theme}>
        <Text style={attenue(theme)}>{trTk('site.aide')}</Text>
        {vue.erreur ? <Avis theme={theme} genre="critique" texte={trTk('site.erreur', { erreur: vue.erreur })} testID="esport-tk-site-erreur" /> : null}
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('site.discord_actif')}</Text>
          <Interrupteur theme={theme} libelle={trTk('site.discord_actif')} valeur={r.discordActif} onChanger={v => changer({ discordActif: v })} testID="esport-tk-site-discord" />
        </View>
        <View style={[styles.ligne, { justifyContent: 'space-between' }]}>
          <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>{trTk('site.roster_actif')}</Text>
          <Interrupteur theme={theme} libelle={trTk('site.roster_actif')} valeur={r.rosterActif} onChanger={v => changer({ rosterActif: v })} testID="esport-tk-site-roster" />
        </View>
        <Text style={attenue(theme)}>{trTk('site.discord_aide')}</Text>
        {vue.etat ? (
          <Text style={attenue(theme)} testID="esport-tk-site-dernier">
            {trTk('site.dernier', { le: quand(vue.etat.le), crees: String(vue.etat.crees), supprimes: String(vue.etat.supprimes), absents: String(vue.etat.absents) })}
          </Text>
        ) : null}
        {vue.etat?.erreurs?.length ? <Avis theme={theme} genre="alerte" texte={trTk('site.erreurs', { liste: vue.etat.erreurs.join(' ; ') })} testID="esport-tk-site-erreurs" /> : null}
        <BoutonHub
          theme={theme}
          titre={trTk('site.synchro')}
          onPress={() =>
            void agir('site-synchro', async () => {
              const s = await api.synchroniser();
              setVue(s);
              return trTk('site.synchro_ok', { crees: String(s.bilan.crees), supprimes: String(s.bilan.supprimes), membres: String(s.bilan.membres) });
            })
          }
          testID="esport-tk-site-synchro"
        />
      </Bloc>

      <Bloc theme={theme} testID="esport-tk-site-inscriptions">
        <Intertitre theme={theme}>{trTk('site.inscriptions_titre')}</Intertitre>
        <Text style={attenue(theme)}>{trTk('site.inscriptions_aide')}</Text>
        {r.inscriptions.map(l => (
          <View key={l.categorieId} style={[styles.ligne, { justifyContent: 'space-between' }]}>
            <Text style={{ ...texte(theme), flex: 1, minWidth: 0 }}>
              {nomCat(l.categorieId)} → {nomTournoi(l.tournoiId)}
            </Text>
            <BoutonHub theme={theme} titre={trTk('site.lien_retirer')} onPress={() => changer({ inscriptions: r.inscriptions.filter(x => x.categorieId !== l.categorieId) })} testID={`esport-tk-site-lien-retirer-${l.categorieId}`} />
          </View>
        ))}
        <Choix theme={theme} libelle={trTk('site.lien_categorie')} valeur={lienCat} options={vue.categories.map(c => ({ id: c.id, nom: c.nom }))} onChoisir={setLienCat} testID="esport-tk-site-lien-cat" />
        <Choix theme={theme} libelle={trTk('site.lien_tournoi')} valeur={lienTournoi} options={tournois.map(t => ({ id: t.id, nom: t.nom }))} onChoisir={setLienTournoi} testID="esport-tk-site-lien-tournoi" />
        <BoutonHub
          theme={theme}
          titre={trTk('site.lien_ajouter')}
          onPress={() => lienCat && lienTournoi && changer({ inscriptions: [...r.inscriptions.filter(x => x.categorieId !== lienCat), { categorieId: lienCat, tournoiId: lienTournoi }] })}
          testID="esport-tk-site-lien-ajouter"
        />
        <Text style={{ ...texte(theme, 13), fontWeight: '700' }}>{trTk('site.attente')}</Text>
        {!vue.inscriptions.length ? <Text style={attenue(theme)}>{trTk('site.aucune_attente')}</Text> : null}
        {vue.inscriptions.map(i => (
          <View key={i.id} style={{ gap: ESP.xs, borderTopWidth: 1, borderTopColor: theme.ligne, paddingTop: ESP.xs }} testID={`esport-tk-site-inscription-${i.id}`}>
            <Text style={{ ...texte(theme), fontWeight: '700' }}>
              {i.donnees.tag ? `[${i.donnees.tag}] ` : ''}
              {i.donnees.equipe} · {nomTournoi(i.tournoi_id)}
            </Text>
            <Text style={attenue(theme)}>{trTk('site.ticket', { numero: String(i.donnees.numero ?? '?'), contact: i.donnees.contact?.nom ?? '' })}</Text>
            {[...i.donnees.joueurs, ...(i.donnees.remplacants ?? []), ...(i.donnees.coach ?? [])].map((j, n) => (
              <Text key={n} style={attenue(theme)}>
                • {j.pseudo} — {j.discordId ?? trTk('site.sans_discord')}
                {j.embarkId ? ` — ${j.embarkId}` : ''}
              </Text>
            ))}
            <View style={styles.ligne}>
              <BoutonHub theme={theme} variante="plein" titre={trTk('site.valider')} onPress={() => void agir('site-valider', async () => (setVue(await api.inscription(i.id, 'valider')), trTk('site.valide')))} testID={`esport-tk-site-valider-${i.id}`} />
              <BoutonHub theme={theme} titre={trTk('site.refuser')} onPress={() => void agir('site-refuser', async () => setVue(await api.inscription(i.id, 'refuser')))} testID={`esport-tk-site-refuser-${i.id}`} />
            </View>
          </View>
        ))}
      </Bloc>

      <Bloc theme={theme} testID="esport-tk-site-equipes">
        <Intertitre theme={theme}>{trTk('site.equipes_titre')}</Intertitre>
        {!tournois.length ? <Text style={attenue(theme)}>{trTk('site.aucun_tournoi')}</Text> : null}
        {tournois.map(t => (
          <View key={t.id} style={{ gap: ESP.s }}>
            <View style={styles.ligne}>
              <Text style={{ ...texte(theme, 15), fontWeight: '700' }}>{t.nom}</Text>
              <Badge theme={theme} ton={t.ouvert ? 'ok' : 'neutre'} texte={t.ouvert ? trTk('site.ouvert') : trTk('site.ferme')} />
            </View>
            {t.equipes.map(e => (
              <CarteEquipe key={e.id} theme={theme} equipe={e} agir={agir} onVue={setVue} api={api} />
            ))}
          </View>
        ))}
      </Bloc>

      {vue.donnees?.roster.length ? (
        <Bloc theme={theme} testID="esport-tk-site-roster-liste">
          <Intertitre theme={theme}>{trTk('site.roster_titre')}</Intertitre>
          {vue.donnees.roster.map(g => (
            <View key={g.id} style={{ gap: ESP.xs }}>
              <Text style={{ ...texte(theme), fontWeight: '700' }}>{g.nom}</Text>
              {g.joueurs.map(j => (
                <LigneJoueur key={j.id} theme={theme} joueur={j} roster onEnregistrer={c => agir('site-roster', async () => (setVue(await api.modifier({ type: 'roster', id: j.id, discordId: c.discordId || null })), trTk('enregistre')))} />
              ))}
            </View>
          ))}
        </Bloc>
      ) : null}
    </View>
  );
}

function CarteEquipe({ theme, equipe, agir, onVue, api }: { theme: ThemeHub; equipe: EquipeSite; agir: Agir; onVue(v: VueSite): void; api: ReturnType<typeof apiSite> }) {
  const [nom, setNom] = useState(equipe.nom);
  const [tag, setTag] = useState(equipe.tag ?? '');
  const [nouveau, setNouveau] = useState('');
  const faire = (libelle: string, f: () => Promise<VueSite>) => void agir(libelle, async () => (onVue(await f()), trTk('enregistre')));
  return (
    <View style={{ gap: ESP.xs, borderWidth: 1, borderColor: theme.ligne, borderRadius: 10, padding: ESP.s }} testID={`esport-tk-site-equipe-${equipe.id}`}>
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trTk('site.nom')} valeur={nom} onChanger={setNom} maxLength={60} testID={`esport-tk-site-equipe-nom-${equipe.id}`} style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
        <Champ theme={theme} libelle={trTk('site.tag')} valeur={tag} onChanger={setTag} maxLength={6} testID={`esport-tk-site-equipe-tag-${equipe.id}`} style={{ width: 90 }} />
        <BoutonHub theme={theme} titre={trTk('enregistrer')} onPress={() => faire('site-equipe', () => api.modifier({ type: 'equipe', id: equipe.id, nom, tag: tag || null }))} testID={`esport-tk-site-equipe-ok-${equipe.id}`} />
      </View>
      {equipe.joueurs.map(j => (
        <LigneJoueur
          key={j.id}
          theme={theme}
          joueur={j}
          onEnregistrer={c => faire('site-joueur', () => api.modifier({ type: 'joueur', id: j.id, pseudo: c.pseudo, discordId: c.discordId || null, embarkId: c.embarkId || null }))}
          onRetirer={() => faire('site-retrait', () => api.modifier({ type: 'retrait_joueur', id: j.id }))}
        />
      ))}
      <View style={[styles.ligne, { alignItems: 'flex-end' }]}>
        <Champ theme={theme} libelle={trTk('site.ajouter_joueur')} valeur={nouveau} onChanger={setNouveau} maxLength={40} testID={`esport-tk-site-ajout-${equipe.id}`} style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }} />
        <BoutonHub
          theme={theme}
          titre={trTk('ajouter')}
          onPress={() => nouveau.trim() && (faire('site-ajout', () => api.modifier({ type: 'ajout_joueur', id: equipe.id, pseudo: nouveau.trim(), ordre: equipe.joueurs.length })), setNouveau(''))}
          testID={`esport-tk-site-ajout-ok-${equipe.id}`}
        />
      </View>
    </View>
  );
}

function LigneJoueur({ theme, joueur, roster, onEnregistrer, onRetirer }: { theme: ThemeHub; joueur: JoueurSite; roster?: boolean; onEnregistrer(c: { pseudo: string; discordId: string; embarkId: string }): void; onRetirer?(): void }) {
  const [pseudo, setPseudo] = useState(joueur.pseudo);
  const [discordId, setDiscordId] = useState(joueur.discordId ?? '');
  const [embarkId, setEmbarkId] = useState(joueur.embarkId ?? '');
  return (
    <View style={[styles.ligne, { alignItems: 'flex-end' }]} testID={`esport-tk-site-joueur-${joueur.id}`}>
      {roster ? (
        <Text style={{ ...texte(theme), flexGrow: 1, flexBasis: 140 }}>{joueur.pseudo}</Text>
      ) : (
        <Champ theme={theme} libelle={trTk('site.pseudo')} valeur={pseudo} onChanger={setPseudo} maxLength={40} testID={`esport-tk-site-joueur-pseudo-${joueur.id}`} style={{ flexGrow: 1, flexBasis: 140, minWidth: 0 }} />
      )}
      <Champ theme={theme} libelle={trTk('site.discord_id')} valeur={discordId} onChanger={setDiscordId} maxLength={25} clavier="number-pad" testID={`esport-tk-site-joueur-discord-${joueur.id}`} style={{ flexGrow: 1, flexBasis: 170, minWidth: 0 }} />
      {!roster ? <Champ theme={theme} libelle={trTk('site.embark_id')} valeur={embarkId} onChanger={setEmbarkId} maxLength={60} testID={`esport-tk-site-joueur-embark-${joueur.id}`} style={{ flexGrow: 1, flexBasis: 150, minWidth: 0 }} /> : null}
      <BoutonHub theme={theme} titre={trTk('enregistrer')} onPress={() => onEnregistrer({ pseudo, discordId, embarkId })} testID={`esport-tk-site-joueur-ok-${joueur.id}`} />
      {onRetirer ? <BoutonHub theme={theme} titre={trTk('site.retirer')} onPress={onRetirer} testID={`esport-tk-site-joueur-retirer-${joueur.id}`} /> : null}
    </View>
  );
}
