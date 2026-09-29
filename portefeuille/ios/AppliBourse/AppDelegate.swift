import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "AppliBourse",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // Liens applibourse://… (QR code de liaison) : transmis au JavaScript.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  // Mises à jour JavaScript sans recompiler (docs/build-ios.md, étape 3) :
  // un paquet signé posé dans Documents/maj-active est chargé à la place de
  // celui du binaire, avec retour arrière automatique s'il plante au démarrage.
  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    let gestionnaire = FileManager.default
    guard let documents = gestionnaire.urls(
      for: .documentDirectory, in: .userDomainMask
    ).first else {
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }

    let dossierMaj = documents.appendingPathComponent("maj-active")
    let paquet = dossierMaj.appendingPathComponent("main.jsbundle")
    let marqueur = dossierMaj.appendingPathComponent("en-essai")

    // Marqueur encore présent : le démarrage précédent n'a jamais abouti. La
    // mise à jour est écartée et l'application repart sur le paquet d'origine.
    if gestionnaire.fileExists(atPath: marqueur.path) {
      try? gestionnaire.removeItem(at: dossierMaj)
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    }

    if gestionnaire.fileExists(atPath: paquet.path) {
      // Posé avant de charger ; le JavaScript le retire une fois démarré.
      gestionnaire.createFile(atPath: marqueur.path, contents: nil)
      return paquet
    }

    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
