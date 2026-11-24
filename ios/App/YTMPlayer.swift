import UIKit
import WebKit

/// What Nagham's page wants from the window (same as the PC window process reads).
struct WinState: Decodable {
    let v: Int
    let caption: String?
    let dark: Bool?
    let ytmUrl: String?
    let ytmRect: [Int]?
    let ytmVisible: Bool?
    let ytmHidden: Bool?
    let ytmCmds: [Cmd]?
    let ytmCmdSeq: Int?
    let ytmVol: Double?
    let ytmVolSet: Bool?
    struct Cmd: Decodable { let seq: Int; let js: String }
}

/// YouTube Music playing hidden inside the app: a second page that Nagham's page controls
/// through the built-in server (the same way the PC version does it).
final class YTMPlayer: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var host: UIView?
    private var page: WKWebView?
    private var base = ""
    private var urlNow = ""
    private var cmdNow = -1
    private var vol: Double = -1
    private var stateJS = ""
    private var polling = false
    private var pollAt = Date.distantPast
    private var lastPaused = true
    private var timer: Timer?
    private var onColors: ((String, Bool) -> Void)?
    private var lastCaption = ""
    private var lastDark = true

    // the desktop YouTube Music site (the phone site keeps asking to open the YouTube app)
    private let desktopUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"

    private var adRules: WKContentRuleList?

    init(host: UIView) {
        self.host = host
        super.init()
        // the backup player (YouTube Music) only: block ad servers; the page script skips any ad that still comes
        let rules = #"""
        [{"trigger":{"url-filter":"doubleclick\\.net"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"googleadservices\\.com"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"googlesyndication\\.com"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/pagead/"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/api/stats/ads"},"action":{"type":"block"}},
         {"trigger":{"url-filter":"/get_midroll_"},"action":{"type":"block"}}]
        """#
        WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: "nagham-ads", encodedContentRuleList: rules) { [weak self] list, err in
            if let list = list { DispatchQueue.main.async { self?.adRules = list } }
        }
    }

    func start(base: String, onColors: @escaping (String, Bool) -> Void) {
        self.base = base
        self.onColors = onColors
        loadStateJS()
        waitLoop(0)
        timer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    private func loadStateJS() {
        guard let u = URL(string: base + "/api/ytm/js") else { return }
        URLSession.shared.dataTask(with: u) { [weak self] data, _, _ in
            guard let self = self else { return }
            if let d = data, let s = String(data: d, encoding: .utf8), s.contains("__VOL__") {
                DispatchQueue.main.async { self.stateJS = s }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.loadStateJS() }
            }
        }.resume()
    }

    // long-poll: the server answers when the page changes something
    private func waitLoop(_ v: Int) {
        guard let u = URL(string: "\(base)/api/window/wait?v=\(v)") else { return }
        var req = URLRequest(url: u)
        req.timeoutInterval = 40
        URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
            guard let self = self else { return }
            var nextV = v
            if let d = data, let st = try? JSONDecoder().decode(WinState.self, from: d) {
                nextV = st.v
                DispatchQueue.main.async { self.apply(st) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + (err == nil && data != nil ? 0 : 1)) { self.waitLoop(nextV) }
        }.resume()
    }

    private func apply(_ st: WinState) {
        let caption = st.caption ?? "#160b2e", dark = st.dark ?? true
        if caption != lastCaption || dark != lastDark {
            lastCaption = caption; lastDark = dark
            onColors?(caption, dark)
        }
        vol = (st.ytmVolSet ?? false) ? (st.ytmVol ?? -1) : -1
        let url = st.ytmUrl ?? ""
        let visible = st.ytmVisible ?? false, hidden = st.ytmHidden ?? false
        // stopped, or another song: never reuse a page that has been playing
        if page != nil && !urlNow.isEmpty && url != urlNow { close() }
        if page == nil {
            guard !url.isEmpty && (visible || hidden) else { return }
            create()
        }
        guard let page = page, let host = host else { return }
        let r = st.ytmRect ?? [0, 0, 0, 0]
        let scale = UIScreen.main.scale
        if visible && r.count == 4 && r[2] >= 50 && r[3] >= 50 {
            // "Show video": drawn where the page's video box is (the page gives physical pixels)
            page.frame = CGRect(x: CGFloat(r[0]) / scale, y: CGFloat(r[1]) / scale, width: CGFloat(r[2]) / scale, height: CGFloat(r[3]) / scale)
            page.alpha = 1
            page.isUserInteractionEnabled = true
            host.bringSubviewToFront(page)
        } else {
            // still "on screen" for WebKit (so it keeps playing), but 2 points in a corner
            page.frame = CGRect(x: 0, y: host.bounds.height - 2, width: 2, height: 2)
            page.alpha = 0.02
            page.isUserInteractionEnabled = false
        }
        if !url.isEmpty && url != urlNow, let u = URL(string: url) {
            urlNow = url
            page.load(URLRequest(url: u))
        }
        if cmdNow < 0 { cmdNow = st.ytmCmdSeq ?? 0 } // commands from before this page existed don't apply
        for c in st.ytmCmds ?? [] where c.seq > cmdNow {
            cmdNow = c.seq
            page.evaluateJavaScript(c.js, completionHandler: nil)
        }
    }

    private func create() {
        guard let host = host else { return }
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsAirPlayForMediaPlayback = true
        cfg.allowsPictureInPictureMediaPlayback = true
        cfg.websiteDataStore = .default() // a YouTube sign-in stays
        if let r = adRules { cfg.userContentController.add(r) }
        let w = WKWebView(frame: CGRect(x: 0, y: host.bounds.height - 2, width: 2, height: 2), configuration: cfg)
        w.customUserAgent = desktopUA
        w.navigationDelegate = self
        w.uiDelegate = self
        w.alpha = 0.02
        w.isUserInteractionEnabled = false
        w.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { w.isInspectable = true }
        host.addSubview(w)
        page = w
        cmdNow = -1
        polling = false
    }

    // closes the player completely (a page that is playing can refuse to navigate away)
    private func close() {
        guard let p = page else { return }
        p.evaluateJavaScript("document.querySelectorAll('video,audio').forEach(v=>{try{v.pause();v.removeAttribute('src');v.load()}catch(e){}})", completionHandler: nil)
        p.stopLoading()
        p.navigationDelegate = nil
        p.uiDelegate = nil
        p.removeFromSuperview()
        page = nil
        urlNow = ""
        cmdNow = -1
        polling = false
        lastPaused = true
    }

    // asks the YouTube Music page what it's doing and passes it to Nagham (twice a second)
    private func poll() {
        guard let page = page, !urlNow.isEmpty, !stateJS.isEmpty else { return }
        if polling && Date().timeIntervalSince(pollAt) < 3 { return }
        polling = true
        pollAt = Date()
        let js = stateJS.replacingOccurrences(of: "__VOL__", with: String(format: "%.3f", vol))
        page.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self else { return }
            self.polling = false
            guard let dict = result as? [String: Any],
                  let body = try? JSONSerialization.data(withJSONObject: dict),
                  let u = URL(string: self.base + "/api/ytm/state") else { return }
            if let p = dict["p"] as? Bool { self.lastPaused = p }
            var req = URLRequest(url: u)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            req.timeoutInterval = 3
            URLSession.shared.dataTask(with: req).resume()
        }
    }

    /// iOS pauses web videos when the app goes to the background: start the song again right away
    func keepPlayingInBackground() {
        guard page != nil, !lastPaused else { return }
        let js = "(()=>{const v=document.querySelector('video');if(v&&v.paused&&!window.__ngEnd){v.play();return 1}return 0})()"
        for d in [0.2, 0.6, 1.2, 2.0, 3.5, 6.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + d) { [weak self] in
                self?.page?.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }

    func cameBack() { polling = false }

    // YouTube Music's own popups / new windows: keep them in the same page
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    // "leave site?" and other dialogs nobody can see in a hidden player
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // the player crashed: Nagham's page notices the song stopped and starts it again
        close()
    }
}
