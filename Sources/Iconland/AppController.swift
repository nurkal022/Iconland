import AppKit
import ServiceManagement
import WebKit

final class AppController: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate {
    private let settings = Settings()
    private var themes: [ThemeInfo] = []
    private var wallpaper: WallpaperWindow?
    private let steering = Steering()
    private let reader = IconReader()
    private let pause = PauseMonitor()
    private let soundGate = SoundGate()
    private let power = PowerMonitor()
    private var iconTimer: Timer?
    private var lastIcons = ""                 // last "icons" JSON (physical pixels)
    private var wallReady = false
    private var finderDenied = false
    private var deniedAlertShown = false
    private var ticks = 0

    private var statusItem: NSStatusItem!
    private var settingsWindow: NSWindow?
    private var settingsWeb: HostWeb?

    private var snapshotDone: ((Result<(thumb: String, png: String), ShareError>) -> Void)?
    private var recordDone: ((Result<(mime: String, poster: String, video: String), ShareError>) -> Void)?
    private var snapshotTimeout: DispatchWorkItem?     // one per operation: a snapshot must not disarm a recording
    private var recordTimeout: DispatchWorkItem?
    private var lastShare: URL?

    private var lang: String { Lang.effective(settings.lang) }

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ note: Notification) {
        let firstRun = !FileManager.default.fileExists(atPath: Paths.support.appendingPathComponent("settings.json").path)
        Log.write("start \(appName), web root: \(Paths.web.path)")
        themes = ThemeRegistry.load(lang: lang)
        if !themes.contains(where: { $0.id == settings.theme }) { settings.theme = themes.first?.id ?? "beach" }

        DistributedNotificationCenter.default().addObserver(
            forName: .init("local.iconland.showSettings"), object: nil, queue: .main) { [weak self] _ in self?.showSettings() }

        setupStatusItem()
        pause.onChange = { [weak self] p in self?.postPause(p) }
        soundGate.enabled = settings.sound
        soundGate.onChange = { [weak self] _ in self?.postSound() }
        power.onChange = { [weak self] _ in self?.postPower() }
        startWallpaper()

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.wallpaper?.fit()
            self?.lastIcons = ""
            self?.pollIcons()
        }

        iconTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            // While paused (screen covered, asleep, locked) icons can't be seen moving: check less often.
            self.ticks += 1
            if self.pause.paused && self.ticks % 3 != 0 { return }
            self.pollIcons()
        }
        iconTimer?.tolerance = 0.2

        if firstRun || CommandLine.arguments.contains("--settings") { showSettings() }
        settings.saveNow()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSettings()
        return true
    }

    func applicationWillTerminate(_ note: Notification) {
        settings.saveNow()
        wallpaper?.close()
        Log.write("quit")
    }

    // MARK: - Wallpaper

    private func startWallpaper() {
        let w = WallpaperWindow()
        w.web.onMessage = { [weak self] m in self?.onWallMessage(m) }
        wallpaper = w
        steering.post = { [weak self] m in self?.wallpaper?.web.post(m) }
        steering.onActiveChange = { [weak self] on in self?.pause.steering = on }
        steering.start()
        loadTheme()
    }

    private func loadTheme() {
        guard let page = themes.first(where: { $0.id == settings.theme })?.page else { return }
        wallReady = false
        steering.end(tellPage: false)
        // The page that owed us an answer is going away: fail now instead of leaving "busy" until the timeout.
        completeSnapshot(.failure(ShareError(message: "wallpaper reloaded")))
        completeRecord(.failure(ShareError(message: "wallpaper reloaded")))
        wallpaper?.web.load("\(page)?wallpaper=1")
    }

    private func onWallMessage(_ m: String) {
        if m.hasPrefix("snapshot|") { onSnapshot(m); return }
        if m.hasPrefix("recprogress|") {
            let p = Double(m.dropFirst("recprogress|".count)) ?? 0
            settingsWeb?.post(JSON.string(["t": "recProgress", "p": p]))
            return
        }
        if m.hasPrefix("record|") { onRecord(m); return }
        if m == "steer|on" { steering.lang = lang; steering.begin(); return }
        if m == "steer|off" { steering.end(tellPage: false); return }
        if m.hasPrefix("steer|miss") { Log.write("click: \(m)"); return }
        if m.hasPrefix("fps|") { Log.write("wallpaper \(m) paused=\(pause.paused)"); return }
        guard m == "ready" else { Log.write("wallpaper: unknown message \(m.prefix(80))"); return }
        // Settings first (the coastline depends on them), then icons and pause state.
        wallReady = true
        Log.write("wallpaper page ready: \(settings.theme)")
        wallpaper?.web.post(JSON.string(["t": "settings", "v": settings.values(for: settings.theme)]))
        lastIcons = ""
        pollIcons()
        postPower()
        postPause(pause.paused, force: true)
        postSound()
    }

    /// Music + ambience of the theme page: on/off and volume (see SoundGate for when it goes quiet).
    private func postSound() {
        guard wallReady else { return }
        wallpaper?.web.post(JSON.string(["t": "sound", "on": soundGate.audible, "vol": settings.volume] as [String: Any]))
    }

    private func setSound(on: Bool? = nil, volume: Double? = nil) {
        if let on { settings.sound = on; soundGate.enabled = on }
        if let volume { settings.volume = min(max(volume, 0), 1) }
        settings.saveSoon()
        postSound()
        updateMenuState()
    }

    /// Frame rate and render resolution for the current power source (see PowerMonitor).
    private func postPower() {
        guard wallReady else { return }
        let p = PowerMonitor.profile(power.mode)
        wallpaper?.web.post("{\"t\":\"power\",\"fps\":\(p.fps),\"quality\":\(p.quality)}")
    }

    private var lastPause: Bool?
    private func postPause(_ p: Bool, force: Bool = false) {
        if !force && lastPause == p { return }
        lastPause = p
        wallpaper?.web.post(JSON.string(["t": "pause", "v": p]))
        updateMenuState()
    }

    // MARK: - Icons

    private func pollIcons() {
        reader.read { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let snap):
                if finderDenied { finderDenied = false; rebuildMenu() }
                publish(snap)
            case .failure(let e):
                switch e.failure {
                case .notAuthorized:
                    if !finderDenied {
                        finderDenied = true
                        Log.write("Finder automation not authorized")
                        rebuildMenu()
                        publish(.init(visible: true, rects: []))
                        if !deniedAlertShown { deniedAlertShown = true; showFinderAccessAlert() }
                    }
                case .other(let msg):
                    Log.write("icon read failed: \(msg)")
                }
            }
        }
    }

    private func publish(_ snap: IconReader.Snapshot) {
        let screen = WallpaperWindow.mainScreen
        let k = screen.backingScaleFactor
        let bounds = CGRect(origin: .zero, size: screen.frame.size)
        let rects = snap.rects.filter { $0.intersects(bounds) }.map { r -> [Int] in
            [Int((r.minX * k).rounded()), Int((r.minY * k).rounded()), Int((r.maxX * k).rounded()), Int((r.maxY * k).rounded())]
        }
        let json = JSON.string(["t": "icons", "vis": snap.visible, "r": rects] as [String: Any])
        if json == lastIcons { return }
        lastIcons = json
        if HostWeb.diagnostics { Log.write("icons: \(rects.count) visible=\(snap.visible)") }
        if wallReady { wallpaper?.web.post(json) }
        settingsWeb?.post(json)
    }

    private func showFinderAccessAlert() {
        let ru = lang == "ru"
        let a = NSAlert()
        a.messageText = ru ? "Нужен доступ к Finder" : "\(appName) needs access to Finder"
        a.informativeText = ru
            ? "\(appName) читает расположение значков рабочего стола через Finder. Разрешите это в «Системные настройки → Конфиденциальность и безопасность → Автоматизация», затем перезапустите приложение."
            : "\(appName) reads desktop icon positions from Finder. Allow it in System Settings → Privacy & Security → Automation, then relaunch the app."
        a.addButton(withTitle: ru ? "Открыть настройки" : "Open System Settings")
        a.addButton(withTitle: ru ? "Позже" : "Later")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertFirstButtonReturn { openAutomationSettings() }
    }

    @objc private func openAutomationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: - Status item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = statusItem.button {
            let img = NSImage(systemSymbolName: "mountain.2.fill", accessibilityDescription: appName)
                ?? NSImage(systemSymbolName: "photo", accessibilityDescription: appName)
            img?.isTemplate = true
            b.image = img
            b.toolTip = appName
        }
        rebuildMenu()
    }

    private var pauseItem: NSMenuItem?
    private var soundItem: NSMenuItem?
    private var autostartItem: NSMenuItem?

    private func rebuildMenu() {
        let l = lang
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(item(Lang.menu("settings", l), #selector(showSettings), key: ","))
        if finderDenied { menu.addItem(item(Lang.menu("noAccess", l), #selector(openAutomationSettings))) }

        let themesItem = NSMenuItem(title: Lang.menu("themes", l), action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for t in themes {
            let i = item(t.name, #selector(pickTheme(_:)))
            i.representedObject = t.id
            i.state = t.id == settings.theme ? .on : .off
            sub.addItem(i)
        }
        themesItem.submenu = sub
        menu.addItem(themesItem)
        menu.addItem(.separator())

        pauseItem = item(Lang.menu("pause", l), #selector(togglePause))
        menu.addItem(pauseItem!)
        soundItem = item(Lang.menu("sound", l), #selector(toggleSound))
        menu.addItem(soundItem!)
        menu.addItem(item(Lang.menu("reload", l), #selector(reload), key: "r"))
        autostartItem = item(Lang.menu("autostart", l), #selector(toggleAutostart))
        menu.addItem(autostartItem!)
        menu.addItem(.separator())
        menu.addItem(item(Lang.menu("quit", l), #selector(quit), key: "q"))
        statusItem.menu = menu
        updateMenuState()
    }

    func menuWillOpen(_ menu: NSMenu) { updateMenuState() }

    private func updateMenuState() {
        pauseItem?.state = pause.manual ? .on : .off
        soundItem?.state = settings.sound ? .on : .off
        autostartItem?.state = isAutostart ? .on : .off
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    @objc private func pickTheme(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        switchTheme(id)
        settingsWeb?.post(JSON.string(["t": "themeChanged", "id": id]))
    }

    @objc private func togglePause() { pause.manual.toggle(); soundGate.manualPause = pause.manual }

    @objc private func toggleSound() {
        setSound(on: !settings.sound)
        settingsWeb?.post(JSON.string(["t": "sound", "on": settings.sound, "vol": settings.volume] as [String: Any]))
    }

    @objc private func reload() {
        themes = ThemeRegistry.load(lang: lang)
        rebuildMenu()
        loadTheme()
        settingsWeb?.view.reload()
    }

    @objc private func toggleAutostart() { setAutostart(!isAutostart) }

    @objc private func quit() { NSApp.terminate(nil) }

    // MARK: - Autostart (login item)

    private var isAutostart: Bool { SMAppService.mainApp.status == .enabled }

    private func setAutostart(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            Log.write("login item \(on ? "register" : "unregister") failed: \(error.localizedDescription)")
            if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        }
        updateMenuState()
        settingsWeb?.post(JSON.string(["t": "autostart", "v": isAutostart]))
    }

    // MARK: - Theme / settings

    private func switchTheme(_ id: String) {
        guard themes.contains(where: { $0.id == id }), id != settings.theme else { return }
        settings.theme = id
        settings.saveSoon()
        loadTheme()
        rebuildMenu()
        Log.write("theme: \(id)")
    }

    @objc func showSettings() {
        if let w = settingsWindow {
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            return
        }
        let web = HostWeb(label: "settings")
        web.onMessage = { [weak self] m in self?.onSettingsMessage(m) }
        let visible = (NSScreen.main ?? WallpaperWindow.mainScreen).visibleFrame
        let size = NSSize(width: min(1120, visible.width - 80), height: min(860, visible.height - 60))
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: size),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = appName
        w.minSize = NSSize(width: 720, height: 560)
        w.isReleasedWhenClosed = false
        w.contentView = web.view
        w.delegate = self
        w.center()
        w.setFrameAutosaveName("SettingsWindow")
        settingsWindow = w
        settingsWeb = web
        web.load("settings.html")
        NSApp.setActivationPolicy(.regular)       // Dock icon + Cmd-Tab while settings are open
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ note: Notification) {
        guard (note.object as? NSWindow) === settingsWindow else { return }
        // Drop the settings web view entirely: its live preview renders a second copy of the theme.
        settingsWindow?.contentView = nil
        settingsWindow = nil
        settingsWeb = nil
        NSApp.setActivationPolicy(.accessory)
    }

    private func onSettingsMessage(_ s: String) {
        guard let m = JSON.parse(s) as? [String: Any], let t = m["t"] as? String, let web = settingsWeb else { return }
        switch t {
        case "hello":
            let screen = WallpaperWindow.mainScreen
            let k = screen.backingScaleFactor
            web.post(JSON.string([
                "t": "init", "theme": settings.theme, "params": settings.params,
                "screen": ["w": Int(screen.frame.width * k), "h": Int(screen.frame.height * k)],
                "autostart": isAutostart, "autostartWarn": false, "autostartSw": "",
                "lang": settings.lang, "langEff": lang, "langSys": Lang.system,
                "sound": settings.sound, "volume": settings.volume,
            ] as [String: Any]))
            if !lastIcons.isEmpty { web.post(lastIcons) }
        case "set":
            guard let theme = m["theme"] as? String, let key = m["key"] as? String, let value = m["value"] else { return }
            settings.set(theme: theme, key: key, value: value)
            if theme == settings.theme {
                wallpaper?.web.post(JSON.string(["t": "settings", "v": [key: value]]))
            }
        case "reset":
            guard let theme = m["theme"] as? String else { return }
            settings.reset(theme: theme)
            if theme == settings.theme { wallpaper?.web.post(JSON.string(["t": "reset"])) }
        case "theme":
            guard let id = m["id"] as? String, themes.contains(where: { $0.id == id }) else {
                web.post(JSON.string(["t": "themeChanged", "id": settings.theme]))
                return
            }
            switchTheme(id)
        case "lang":
            guard let v = m["v"] as? String else { return }
            settings.lang = v
            settings.saveSoon()
            themes = ThemeRegistry.load(lang: lang)
            rebuildMenu()
            web.post(JSON.string(["t": "lang", "v": v, "eff": lang, "sys": Lang.system]))
        case "sound":
            setSound(on: m["on"] as? Bool, volume: (m["vol"] as? NSNumber)?.doubleValue)
        case "autostart":
            setAutostart(m["v"] as? Bool ?? false)
        case "share":
            requestSnapshot()
        case "shareVideo":
            requestRecording()
        case "openShare":
            if let u = lastShare { NSWorkspace.shared.open(u) }
        case "revealShare":
            if let u = lastShare { NSWorkspace.shared.activateFileViewerSelecting([u]) }
        case "openWebsite":
            NSWorkspace.shared.open(URL(string: "https://deskland.app/")!)
        default:
            break
        }
    }

    // MARK: - Sharing (the page draws sample icons and color-block names; nothing is screenshotted)

    struct ShareError: Error { let message: String }

    private func timeout(_ seconds: Double, _ fire: @escaping () -> Void) -> DispatchWorkItem {
        let w = DispatchWorkItem(block: fire)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: w)
        return w
    }

    private func requestSnapshot() {
        guard wallReady, snapshotDone == nil else { return postShareFail(video: false, "busy or not ready") }
        snapshotDone = { [weak self] r in self?.finishImage(r) }
        snapshotTimeout = timeout(20) { [weak self] in self?.completeSnapshot(.failure(ShareError(message: "timeout"))) }
        wallpaper?.web.post(JSON.string(["t": "snapshot"]))
    }

    private func onSnapshot(_ m: String) {
        let p = m.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        if p.count < 3 { return completeSnapshot(.failure(ShareError(message: "bad data"))) }
        if p[1] == "error" { return completeSnapshot(.failure(ShareError(message: p[2]))) }
        completeSnapshot(.success((thumb: p[1], png: p[2])))
    }

    private func completeSnapshot(_ r: Result<(thumb: String, png: String), ShareError>) {
        snapshotTimeout?.cancel()
        snapshotTimeout = nil
        let done = snapshotDone
        snapshotDone = nil
        done?(r)
    }

    private func finishImage(_ r: Result<(thumb: String, png: String), ShareError>) {
        switch r {
        case .failure(let e): postShareFail(video: false, e.message)
        case .success(let v):
            guard let data = Self.dataURL(v.png) else { return postShareFail(video: false, "bad image") }
            do {
                let url = try saveShare(data, ext: "png")
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setData(data, forType: .png)
                settingsWeb?.post(JSON.string(["t": "shareResult", "ok": true, "thumb": v.thumb, "path": url.path]))
            } catch { postShareFail(video: false, error.localizedDescription) }
        }
    }

    private func requestRecording() {
        guard wallReady, recordDone == nil else { return postShareFail(video: true, "busy or not ready") }
        recordDone = { [weak self] r in self?.finishVideo(r) }
        recordTimeout = timeout(45) { [weak self] in self?.completeRecord(.failure(ShareError(message: "timeout"))) }
        wallpaper?.web.post(JSON.string(["t": "record"]))
    }

    private func onRecord(_ m: String) {
        let p = m.split(separator: "|", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
        if p.count >= 3 && p[1] == "error" { return completeRecord(.failure(ShareError(message: p.dropFirst(2).joined(separator: "|")))) }
        if p.count < 4 { return completeRecord(.failure(ShareError(message: "bad data"))) }
        completeRecord(.success((mime: p[1], poster: p[2], video: p[3])))
    }

    private func completeRecord(_ r: Result<(mime: String, poster: String, video: String), ShareError>) {
        recordTimeout?.cancel()
        recordTimeout = nil
        let done = recordDone
        recordDone = nil
        done?(r)
    }

    private func finishVideo(_ r: Result<(mime: String, poster: String, video: String), ShareError>) {
        switch r {
        case .failure(let e): postShareFail(video: true, e.message)
        case .success(let v):
            guard let data = Self.dataURL(v.video) else { return postShareFail(video: true, "bad video") }
            do {
                let url = try saveShare(data, ext: v.mime.hasPrefix("video/webm") ? "webm" : "mp4")
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.writeObjects([url as NSURL])
                let name = url.lastPathComponent.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.lastPathComponent
                settingsWeb?.post(JSON.string(["t": "shareResult", "ok": true, "kind": "video", "thumb": v.poster,
                                               "path": url.path, "url": "\(LocalSchemeHandler.scheme)://share/\(name)"]))
            } catch { postShareFail(video: true, error.localizedDescription) }
        }
    }

    private func saveShare(_ data: Data, ext: String) throws -> URL {
        try FileManager.default.createDirectory(at: Paths.share, withIntermediateDirectories: true)
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HHmmss"
        let url = Paths.share.appendingPathComponent("\(appName) \(f.string(from: Date())).\(ext)")
        try data.write(to: url)
        lastShare = url
        Log.write("shared: \(url.path)")
        return url
    }

    private func postShareFail(video: Bool, _ msg: String) {
        Log.write("share failed: \(msg)")
        var m: [String: Any] = ["t": "shareResult", "ok": false, "msg": msg]
        if video { m["kind"] = "video" }
        settingsWeb?.post(JSON.string(m))
    }

    private static func dataURL(_ s: String) -> Data? {
        guard let comma = s.firstIndex(of: ",") else { return Data(base64Encoded: s) }
        return Data(base64Encoded: String(s[s.index(after: comma)...]))
    }
}
