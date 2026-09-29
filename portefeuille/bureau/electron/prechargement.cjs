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

  fichiers: {
    lire: nom => ipcRenderer.invoke('fichier:lire', nom),
    ecrire: (nom, octets) => ipcRenderer.invoke('fichier:ecrire', nom, octets),
    existe: nom => ipcRenderer.invoke('fichier:existe', nom),
    dossier: () => ipcRenderer.invoke('fichier:dossier'),
    enregistrerSous: (nom, contenu) =>
      ipcRenderer.invoke('systeme:enregistrer-sous', nom, contenu),
  },

  systeme: {
    notifier: (titre, corps, destination) => ipcRenderer.invoke('systeme:notifier', titre, corps, destination),
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

  relais: {
    /** Relais installé par `npm run relais:deployer` sur ce PC, s'il existe. */
    config: () => ipcRenderer.invoke('relais:config'),
  },
});
