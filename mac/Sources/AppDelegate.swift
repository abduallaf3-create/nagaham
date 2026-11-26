import Cocoa
import WebKit

/// A view whose (0,0) is the top-left corner, like the web page's
final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// What Nagham's page wants from its window (the same state the PC window reads).
struct WinState: Decodable {
    let v: Int
    let caption: String?
    let dark: Bool?
    let ytmUrl: String?
    let ytmCmds: [Cmd]?
    let ytmCmdSeq: Int?
    let ytmVol: Double?
    let ytmVolSet: Bool?
    let ytmVisible: Bool?
    let ytmHidden: Bool?
    let acctOpen: Bool?
    let acctShow: Bool?
    let acctRect: [Int]?
    let acctNav: String?
    let acctNavSeq: Int?
    let acctReqs: [AcctReq]?
    struct Cmd: Decodable { let seq: Int; let js: String }
}

struct AcctReq: Codable {
    let seq: Int
    let kind: String
    let id: String?
    let v: String?
    let b: String?
    let svc: String?
    let type: String?
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var host: FlippedView!
    var web: WKWebView!
    var server: Process?
    var base = ""
    var ytm: YTMPlayer!
    var acct: AcctPanel!
    var quitting = false
    var extraWindows: [NSWindow] = []
    let loading = NSProgressIndicator()

    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Nagham"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 900, height: 600)
        window.backgroundColor = NSColor(hex: "#160b2e") ?? .black
        window.appearance = NSAppearance(named: .darkAqua)
        window.delegate = self
        window.isReleasedWhenClosed = false
        host = FlippedView(frame: window.contentLayoutRect)
        host.wantsLayer = true
        window.contentView = host

        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: "window.NAGHAM_MAC = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(WeakHandler(self), name: "naghamMac")
        cfg.userContentController = ucc
        web = WKWebView(frame: host.bounds, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.uiDelegate = self
        web.navigationDelegate = self
        host.addSubview(web)

        loading.style = .spinning
        loading.frame = NSRect(x: host.bounds.midX - 16, y: host.bounds.midY - 16, width: 32, height: 32)
        loading.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
        host.addSubview(loading)
        loading.startAnimation(nil)

        ytm = YTMPlayer(host: host, below: web)
        acct = AcctPanel(host: host, main: web)

        window.setFrameAutosaveName("NaghamMain")
        if !window.setFrameUsingName("NaghamMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startServer()
    }

    // MARK: the built-in server (the same Nagham server as on the PC)

    var supportDir: URL {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nagham", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    func startServer() {
        guard let exe = Bundle.main.url(forAuxiliaryExecutable: "nagham-server") ?? Bundle.main.url(forResource: "nagham-server", withExtension: nil) else {
            return fail("Nagham's server is missing from the app.")
        }
        let portFile = supportDir.appendingPathComponent("port")
        try? FileManager.default.removeItem(at: portFile)
        let p = Process()
        p.executableURL = exe
        var env = ProcessInfo.processInfo.environment
        env["NAGHAM_HEADLESS"] = "1"
        env["NAGHAM_NATIVE"] = "1"
        env["NAGHAM_DATA"] = supportDir.path
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (env["PATH"] ?? "/usr/bin:/bin")
        p.environment = env
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let s = self, !s.quitting else { return }
                s.fail("Nagham's server stopped (code \(proc.terminationStatus)). Close Nagham and open it again.")
            }
        }
        do { try p.run() } catch { return fail("Nagham couldn't start: \(error.localizedDescription)") }
        server = p
        DispatchQueue.global().async {
            for _ in 0..<200 {
                if let s = try? String(contentsOf: portFile, encoding: .utf8), let port = Int(s.trimmingCharacters(in: .whitespacesAndNewlines)), port > 0 {
                    DispatchQueue.main.async { self.serverStarted(port) }
                    return
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            DispatchQueue.main.async { self.fail("Nagham's server didn't start in time.") }
        }
    }

    func serverStarted(_ port: Int) {
        base = "http://127.0.0.1:\(port)"
        ytm.start(base: base)
        acct.start(base: base)
        waitLoop(-1)
        web.load(URLRequest(url: URL(string: base + "/")!))
    }

    func fail(_ msg: String) {
        loading.stopAnimation(nil)
        loading.removeFromSuperview()
        let a = NSAlert()
        a.messageText = "Nagham"
        a.informativeText = msg
        a.runModal()
    }

    // long-poll: the server answers when the page changes something
    func waitLoop(_ v: Int) {
        guard let u = URL(string: "\(base)/api/window/wait?v=\(v)") else { return }
        var req = URLRequest(url: u)
        req.timeoutInterval = 40
        URLSession.shared.dataTask(with: req) { [weak self] data, _, err in
            guard let self = self else { return }
            var next = v
            if let d = data, let st = try? JSONDecoder().decode(WinState.self, from: d) {
                next = st.v
                DispatchQueue.main.async { self.apply(st) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + (err == nil && data != nil ? 0 : 1)) { self.waitLoop(next) }
        }.resume()
    }

    func apply(_ st: WinState) {
        if let c = st.caption, let col = NSColor(hex: c) { window.backgroundColor = col }
        window.appearance = NSAppearance(named: (st.dark ?? true) ? .darkAqua : .aqua)
        ytm.apply(st)
        acct.apply(st)
    }

    // MARK: app life

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ n: Notification) {
        quitting = true
        server?.terminate()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender == window { NSApp.terminate(nil) }
        return true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "About Nagham", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Nagham", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit Nagham", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    @objc func reloadPage() { if !base.isEmpty { web.load(URLRequest(url: URL(string: base + "/")!)) } }

    // MARK: page messages / navigation

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let u = body["open"] as? String, let url = URL(string: u) { NSWorkspace.shared.open(url) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading.stopAnimation(nil)
        loading.removeFromSuperview()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !base.isEmpty { webView.load(URLRequest(url: URL(string: base + "/")!)) }
    }

    func isLocal(_ url: URL) -> Bool {
        let h = url.host ?? ""
        return h == "127.0.0.1" || h == "localhost" || ["about", "blob", "data"].contains(url.scheme ?? "")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        if isLocal(url) || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url) // other sites open in the browser
            decisionHandler(.cancel)
        }
    }

    // window.open: Nagham's own pages (the mini player…) get a window of their own; other sites open in the browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if !isLocal(url) { NSWorkspace.shared.open(url); return nil }
        let w = CGFloat(truncating: windowFeatures.width ?? 420), h = CGFloat(truncating: windowFeatures.height ?? 300)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        win.titlebarAppearsTransparent = true
        win.appearance = NSAppearance(named: .darkAqua)
        win.isReleasedWhenClosed = false
        win.level = .floating
        let v = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: configuration)
        v.uiDelegate = self
        v.navigationDelegate = self
        v.autoresizingMask = [.width, .height]
        win.contentView = v
        win.center()
        win.makeKeyAndOrderFront(nil)
        extraWindows.append(win)
        return v
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let w = webView.window, w != window { w.close(); extraWindows.removeAll { $0 == w } }
    }

    // <input type="file">: the Mac's open panel (adding songs, restoring a backup…)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories
        p.canChooseFiles = true
        p.begin { r in completionHandler(r == .OK ? p.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.runModal(); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); f.stringValue = defaultText ?? ""
        a.accessoryView = f
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn ? f.stringValue : nil)
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

extension NSColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}
