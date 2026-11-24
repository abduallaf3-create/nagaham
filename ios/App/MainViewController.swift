import UIKit
import WebKit

/// Nagham's screen: the built-in server runs inside the app, this page shows its UI,
/// and YouTube Music plays hidden in a second page (like Nagham's PC window does).
final class MainViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private var ytm: YTMPlayer!
    private(set) var base = ""
    private var barStyle: UIStatusBarStyle = .lightContent
    private let loading = UIActivityIndicatorView(style: .large)
    private let errorLabel = UILabel()

    override var preferredStatusBarStyle: UIStatusBarStyle { barStyle }
    override var prefersHomeIndicatorAutoHidden: Bool { false }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x16 / 255.0, green: 0x0b / 255.0, blue: 0x2e / 255.0, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsAirPlayForMediaPlayback = true
        cfg.userContentController.add(WeakHandler(self), name: "nagham") // tells the page it's inside the iPhone app
        cfg.websiteDataStore = .default()
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = false
        web.uiDelegate = self
        web.navigationDelegate = self
        if #available(iOS 16.4, *) { web.isInspectable = true }
        view.addSubview(web)

        loading.color = .white
        loading.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        loading.autoresizingMask = [.flexibleTopMargin, .flexibleBottomMargin, .flexibleLeftMargin, .flexibleRightMargin]
        loading.startAnimating()
        view.addSubview(loading)

        ytm = YTMPlayer(host: view)
        startServer()
    }

    private func startServer() {
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nagham", isDirectory: true)
        let music = docs.appendingPathComponent("Music", isDirectory: true)
        try? fm.createDirectory(at: support, withIntermediateDirectories: true)
        try? fm.createDirectory(at: music, withIntermediateDirectories: true)
        // a note in the Music folder so people know where songs go
        let note = music.appendingPathComponent("Put your songs here.txt")
        if !fm.fileExists(atPath: note.path) {
            try? "Copy MP3 / M4A / FLAC / WAV songs into this folder, then open Nagham → Settings → Music on this iPhone → Rescan.\n".write(to: note, atomically: true, encoding: .utf8)
        }
        DispatchQueue.global(qos: .userInitiated).async {
            PythonBridge.start() // yt-dlp: ready a few seconds later; the server waits for it when needed
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let port = support.path.withCString { d in
                music.path.withCString { m in
                    NaghamStart(UnsafeMutablePointer(mutating: d), UnsafeMutablePointer(mutating: m))
                }
            }
            DispatchQueue.main.async { self.serverStarted(Int(port)) }
        }
    }

    private func serverStarted(_ port: Int) {
        guard port > 0 else {
            loading.stopAnimating()
            errorLabel.text = "Nagham couldn't start.\nClose it fully and open it again."
            errorLabel.textColor = .white
            errorLabel.numberOfLines = 0
            errorLabel.textAlignment = .center
            errorLabel.frame = view.bounds.insetBy(dx: 30, dy: 0)
            view.addSubview(errorLabel)
            return
        }
        base = "http://127.0.0.1:\(port)"
        NaghamSetNative(1) // YouTube Music can play hidden inside the app
        ytm.start(base: base) { [weak self] caption, dark in self?.applyColors(caption, dark) }
        web.load(URLRequest(url: URL(string: base + "/")!))
    }

    private func applyColors(_ caption: String, _ dark: Bool) {
        if let c = UIColor(hex: caption) { view.backgroundColor = c; view.window?.backgroundColor = c }
        let s: UIStatusBarStyle = dark ? .lightContent : .darkContent
        if s != barStyle { barStyle = s; setNeedsStatusBarAppearanceUpdate() }
    }

    // MARK: background

    func appWentToBackground() { ytm.keepPlayingInBackground() }
    func appCameBack() {
        ytm.cameBack()
        // if iOS dropped the page while away, load it again
        web.evaluateJavaScript("1") { [weak self] _, err in
            if err != nil, let s = self, !s.base.isEmpty { s.web.load(URLRequest(url: URL(string: s.base + "/")!)) }
        }
    }

    // MARK: page messages

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let u = body["open"] as? String, let url = URL(string: u) { UIApplication.shared.open(url) }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading.stopAnimating()
        loading.removeFromSuperview()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !base.isEmpty { webView.load(URLRequest(url: URL(string: base + "/")!)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let host = url.host ?? ""
        let local = host == "127.0.0.1" || host == "localhost" || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data"
        // signing in to linked accounts happens inside the app, so the answer comes back to Nagham
        let signIn = ["accounts.spotify.com", "accounts.google.com", "oauth2.googleapis.com"].contains(host) || host.hasSuffix(".google.com")
        if local || signIn || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            // other sites (Spotify / YouTube sign-in pages, GitHub…) open in Safari
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    // window.open / target=_blank → Safari
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "http" || url.scheme == "https" {
            if url.host == "127.0.0.1" { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    // microphone / camera for karaoke
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "127.0.0.1" ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        present(a, animated: true)
    }
}

/// avoids a retain cycle between the page and its message handler
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(uc, didReceive: message)
    }
}

extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}
