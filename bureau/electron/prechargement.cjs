/**
 * Pont entre la fenêtre et le système.
 *
 * C'est la **totalité** de ce que l'interface peut demander au disque et au
 * système. Elle n'a ni `require`, ni `fs`, ni chemin : elle nomme un fichier
 * logique — « portefeuille », « coffre » — et le processus principal décide
 * seul de ce que ce nom désigne.
 *
 * Le fichier est en CommonJS à dessein : un préchargement de bac à sable ne
 * charge pas de module ES.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('applibourse', {
  /** Vrai dans l'application installée, absent dans un simple navigateur. */
  bureau: true,

  /** Portée du compte ouvert : ses fichiers seulement (voir principal.mjs). */
  profil: {
    ouvrir: id => ipcRenderer.invoke('profil:ouvrir', id),
    /** Quitte le compte : la fenêtre se recharge. */
    fermer: () => ipcRenderer.invoke('profil:fermer'),
    /** Gestionnaire : ajoute à sa portée les fichiers d'un compte qu'il crée ou régénère. */
    etendre: id => ipcRenderer.invoke('profil:etendre', id),
  },

  fichiers: {
    lire: nom => ipcRenderer.invoke('fichier:lire', nom),
    ecrire: (nom, octets) => ipcRenderer.invoke('fichier:ecrire', nom, octets),
    existe: nom => ipcRenderer.invoke('fichier:existe', nom),
    dossier: () => ipcRenderer.invoke('fichier:dossier'),
    enregistrerSous: (nom, contenu) =>
      ipcRenderer.invoke('systeme:enregistrer-sous', nom, contenu),
  },

  systeme: {
    notifier: (titre, corps, destination, options) => ipcRenderer.invoke('systeme:notifier', titre, corps, destination, options && typeof options === 'object' ? { silencieux: options.silencieux === true } : undefined),
    /** Appelé avec la destination quand on clique sur une notification ; rend de quoi se désabonner. */
    surNotificationOuverte: rappel => {
      const ecouteur = (_evenement, destination) => rappel(String(destination));
      ipcRenderer.on('notification:ouvrir', ecouteur);
      return () => ipcRenderer.removeListener('notification:ouvrir', ecouteur);
    },
    ouvrir: url => ipcRenderer.invoke('systeme:ouvrir', url),
    /** Barre de titre claire ou sombre, selon le thème. */
    theme: sombre => ipcRenderer.invoke('systeme:theme', Boolean(sombre)),
    /** Ouverture au démarrage de Windows : lit l'état, ou le change si un booléen est donné. */
    demarrage: activer => ipcRenderer.invoke('systeme:demarrage', activer),
    /** Texte au survol de l'icône près de l'horloge. */
    infobulle: texte => ipcRenderer.invoke('systeme:infobulle', texte),
    /** Rester près de l'horloge quand on ferme la fenêtre : lit, ou change si un booléen est donné. */
    plateau: activer => ipcRenderer.invoke('systeme:plateau', activer),
  },

  /** Sauvegardes chiffrées, rangées dans Documents\\AppliBourse Sauvegardes. */
  sauvegardes: {
    dossier: () => ipcRenderer.invoke('sauvegardes:dossier'),
    lister: () => ipcRenderer.invoke('sauvegardes:lister'),
    existe: nom => ipcRenderer.invoke('sauvegardes:existe', nom),
    lire: nom => ipcRenderer.invoke('sauvegardes:lire', nom),
    ecrire: (nom, contenu) => ipcRenderer.invoke('sauvegardes:ecrire', nom, contenu),
    supprimer: nom => ipcRenderer.invoke('sauvegardes:supprimer', nom),
    ouvrirDossier: () => ipcRenderer.invoke('sauvegardes:ouvrir-dossier'),
  },

  yahoo: {
    /** Réponse JSON d'une adresse Yahoo Finance autorisée. */
    json: url => ipcRenderer.invoke('yahoo:json', url),
    /** Résultats du screener de Yahoo pour une requête composée par l'interface. */
    screener: corps => ipcRenderer.invoke('yahoo:screener', corps),
  },

  tsuzuku: {
    /** Requête réseau du moteur (garde anti-SSRF côté processus principal ; redirections non suivies). */
    requete: requete => ipcRenderer.invoke('tsuzuku:requete', requete),
    /** Déclare le site d'un lecteur (iframe) : le processus principal ne le laisse charger qu'après ça. */
    lecteur: url => ipcRenderer.invoke('tsuzuku:lecteur', url),
  },

  medias: {
    /** Texte d'un flux RSS de la revue de presse (liste fermée). */
    flux: url => ipcRenderer.invoke('medias:flux', url),
    /** HTML d'une page d'article d'un média connu, pour en tirer l'essentiel. */
    page: url => ipcRenderer.invoke('medias:page', url),
  },

  voix: {
    /** Voix naturelles proposées. */
    liste: () => ipcRenderer.invoke('voix:liste'),
    /** MP3 d'une phrase lue par une voix naturelle. */
    synthetiser: (texte, voix, vitesse) => ipcRenderer.invoke('voix:synthetiser', texte, voix, vitesse),
  },

  maj: {
    /** Compare la version installée à celle de GitHub. */
    verifier: () => ipcRenderer.invoke('maj:verifier'),
    /** Lance `npm run maj-pc` dans une fenêtre, puis ferme l'application. */
    installer: () => ipcRenderer.invoke('maj:installer'),
    /** Interroge GitHub maintenant, application ouverte. */
    chercher: () => ipcRenderer.invoke('maj:chercher'),
    /** Redémarre : le lanceur récupère le code et reconstruit l'interface. */
    redemarrer: () => ipcRenderer.invoke('maj:redemarrer'),
  },

  /** Claude Office : serveur local et hooks de Claude Code (écriture seulement après confirmation native). */
  claudeOffice: {
    etat: () => ipcRenderer.invoke('claude-office:etat'),
    choisirDossier: () => ipcRenderer.invoke('claude-office:choisir-dossier'),
    reglerUrl: url => ipcRenderer.invoke('claude-office:regler-url', String(url)),
    apercuHooks: desinstaller => ipcRenderer.invoke('claude-office:apercu-hooks', desinstaller === true),
    installerHooks: desinstaller => ipcRenderer.invoke('claude-office:installer-hooks', desinstaller === true),
    ouvrir: () => ipcRenderer.invoke('claude-office:ouvrir'),
    /** Historique : journal local des requêtes (lecture, réglages, import ; suppression et hook sur confirmation native). */
    historique: {
      lire: () => ipcRenderer.invoke('claude-office:historique-lire'),
      /** Activité récente pour l'onglet « Bureau » (lecture seule ; signature : texte court, sinon ignorée). */
      activite: connu => ipcRenderer.invoke('claude-office:historique-activite', typeof connu === 'string' ? connu.slice(0, 200) : ''),
      reglages: changements => ipcRenderer.invoke('claude-office:historique-reglages', changements),
      supprimer: critere => ipcRenderer.invoke('claude-office:historique-supprimer', critere),
      importer: () => ipcRenderer.invoke('claude-office:historique-importer'),
      apercuHooks: desinstaller => ipcRenderer.invoke('claude-office:historique-apercu-hooks', desinstaller === true),
      installerHooks: desinstaller => ipcRenderer.invoke('claude-office:historique-installer-hooks', desinstaller === true),
    },
  },

  /** Tâches : aide de l'IA (API Claude) et état des PR GitHub, appelés par le processus principal. */
  taches: {
    ia: requete => ipcRenderer.invoke('taches:ia', requete),
    github: requete => ipcRenderer.invoke('taches:github', requete),
  },

  relais: {
    /** Relais installé par `npm run relais:deployer` sur ce PC, s'il existe. */
    config: () => ipcRenderer.invoke('relais:config'),
  },
});
