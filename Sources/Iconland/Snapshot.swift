import AppKit
import WebKit

/// Developer tool: renders a theme page offscreen with sample icons and saves a PNG.
///
///   Iconland --snap <page.html> <out.png> [--size 1512x982] [--wait 4] [--icons rects.json] [--settings '{"k":v}']
///                    [--move 3.0]
///
/// rects.json: [[x, y, w, h], …] in points (top-left origin). Without it a typical Mac desktop layout is used
/// (a column of icons on the right plus a few scattered ones). `--move <sec>` moves the scattered icons after
/// <sec> seconds, to check the transition; combine with a --wait that ends mid-transition.
final class SnapshotRunner: NSObject {
    private let page: String
    private let out: URL
    private var size = NSSize(width: 1512, height: 982)
    private var wait = 4.0
    private var moveAt: Double?
    private var settings: [String: Any] = [:]
    private var rects: [CGRect] = []
    private var window: NSWindow!
    private var web: HostWeb!

    init?(args: [String]) {
        guard let i = args.firstIndex(of: "--snap"), args.count > i + 2 else { return nil }
        page = args[i + 1]
        out = URL(fileURLWithPath: args[i + 2])
        super.init()
        func val(_ k: String) -> String? { args.firstIndex(of: k).flatMap { args.count > $0 + 1 ? args[$0 + 1] : nil } }
        if let s = val("--size")?.split(separator: "x"), s.count == 2, let w = Double(s[0]), let h = Double(s[1]) {
            size = NSSize(width: w, height: h)
        }
        if let w = val("--wait").flatMap(Double.init) { wait = w }
        moveAt = val("--move").flatMap(Double.init)
        if let s = val("--settings"), let d = JSON.parse(s) as? [String: Any] { settings = d }
        if let f = val("--icons"), let arr = JSON.read(URL(fileURLWithPath: f)) as? [[Double]] {
            rects = arr.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
        } else {
            rects = Self.sampleLayout(size)
        }
    }

    static func sampleLayout(_ s: NSSize) -> [CGRect] {
        var r: [CGRect] = []
        let w: CGFloat = 92, h: CGFloat = 96
        for i in 0..<6 { r.append(CGRect(x: s.width - w - 14, y: 44 + CGFloat(i) * 104, width: w, height: h)) }
        for i in 0..<3 { r.append(CGRect(x: s.width - 2 * w - 34, y: 44 + CGFloat(i) * 104, width: w, height: h)) }
        r.append(CGRect(x: s.width * 0.30, y: s.height * 0.28, width: w, height: h))
        r.append(CGRect(x: s.width * 0.30 + 104, y: s.height * 0.28, width: w, height: h))
        r.append(CGRect(x: s.width * 0.42, y: s.height * 0.62, width: w, height: h))
        return r
    }

    func run() {
        web = HostWeb(label: "snapshot")
        web.keepRenderingWhenOccluded()
        window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -20000, y: -20000), size: size),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = web.view
        window.orderFrontRegardless()
        web.onMessage = { [weak self] m in
            guard let self else { return }
            if m.contains("\"t\":\"hello\"") {           // settings page: answer like the app does
                let theme = ProcessInfo.processInfo.environment["SNAP_THEME"] ?? "meadow"
                let lang = ProcessInfo.processInfo.environment["SNAP_LANG"] ?? "en"
                let k = self.window.backingScaleFactor
                self.web.post(JSON.string(["t": "init", "theme": theme, "params": [String: Any](),
                    "screen": ["w": Int(1512 * k), "h": Int(982 * k)], "autostart": false, "autostartWarn": false,
                    "autostartSw": "", "lang": lang, "langEff": lang, "langSys": lang] as [String: Any]))
                let desk = NSSize(width: 1512, height: 982)
                let ks = k
                let r = Self.sampleLayout(desk).map { [Int($0.minX * ks), Int($0.minY * ks), Int($0.maxX * ks), Int($0.maxY * ks)] }
                self.web.post(JSON.string(["t": "icons", "vis": true, "r": r] as [String: Any]))
                DispatchQueue.main.asyncAfter(deadline: .now() + self.wait) { self.capture() }
                return
            }
            guard m == "ready" else { return }
            self.web.post(JSON.string(["t": "settings", "v": self.settings]))
            self.web.post(self.iconsJSON(self.rects))
            self.web.post(JSON.string(["t": "pause", "v": false]))
            if ProcessInfo.processInfo.environment["ICONLAND_POWER"] != nil {   // render with that power profile
                let p = PowerMonitor.profile(PowerMonitor.current())
                self.web.post("{\"t\":\"power\",\"fps\":\(p.fps),\"quality\":\(p.quality)}")
            }
            if let mv = self.moveAt {
                DispatchQueue.main.asyncAfter(deadline: .now() + mv) {
                    let moved = self.rects.enumerated().map { i, r in i >= 9 ? r.offsetBy(dx: 260, dy: 90) : r }
                    self.web.post(self.iconsJSON(moved))
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + self.wait) { self.capture() }
        }
        web.load(page.contains("?") || page.hasPrefix("settings") ? page : "\(page)?wallpaper=1")
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            FileHandle.standardError.write("snapshot: timed out waiting for the page\n".data(using: .utf8)!)
            exit(2)
        }
    }

    private func iconsJSON(_ rs: [CGRect]) -> String {
        let k = window.backingScaleFactor
        let r = rs.map { [Int($0.minX * k), Int($0.minY * k), Int($0.maxX * k), Int($0.maxY * k)] }
        return JSON.string(["t": "icons", "vis": true, "r": r] as [String: Any])
    }

    private func capture() {
        // Collect JS errors / console state to help debugging.
        if let js = ProcessInfo.processInfo.environment["SNAP_EVAL"] {      // debug: run an expression and print it
            web.view.evaluateJavaScript(js) { r, e in print("eval:", r ?? "nil", e.map { "\($0)" } ?? "") }
        }
        web.view.evaluateJavaScript("JSON.stringify({err: window.__snapErrors || [], fps: typeof fpsEMA === 'number' ? fpsEMA : null, cjk: (document.body.innerText.match(/[\\u3400-\\u9fff]+/g) || []).slice(0, 20)})") { res, _ in
            if let s = res as? String { print("page:", s) }
            let cfg = WKSnapshotConfiguration()
            cfg.afterScreenUpdates = true
            self.web.view.takeSnapshot(with: cfg) { image, error in
                guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("snapshot failed: \(error?.localizedDescription ?? "?")\n".data(using: .utf8)!)
                    exit(1)
                }
                do { try png.write(to: self.out) } catch { exit(1) }
                print("saved", self.out.path)
                exit(0)
            }
        }
    }
}
