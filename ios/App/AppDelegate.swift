import UIKit
import AVFoundation

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // music keeps playing with the screen locked or in another app
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)

        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = MainViewController()
        w.backgroundColor = UIColor(red: 0x16 / 255.0, green: 0x0b / 255.0, blue: 0x2e / 255.0, alpha: 1)
        w.makeKeyAndVisible()
        window = w
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
        (window?.rootViewController as? MainViewController)?.appWentToBackground()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        (window?.rootViewController as? MainViewController)?.appCameBack()
    }
}
