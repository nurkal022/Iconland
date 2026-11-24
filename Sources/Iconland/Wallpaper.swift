import AppKit
import IOKit.ps

/// A borderless, click-through window at the desktop window level: above the system wallpaper,
/// below Finder's desktop icons. Shown on every Space of the main display.
final class WallpaperWindow {
    let window: NSWindow
    let web: HostWeb

    init() {
        web = HostWeb(label: "wallpaper")
        web.keepRenderingWhenOccluded()
        let frame = WallpaperWindow.mainScreen.frame
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        window.ignoresMouseEvents = true
        window.isOpaque = true
        window.hasShadow = false
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        window.contentView = web.view
        fit()
        window.orderFront(nil)
    }

    /// The screen with the menu bar; Finder's desktop coordinates are relative to its top-left corner.
    static var mainScreen: NSScreen { NSScreen.screens.first ?? NSScreen.main! }

    func fit() {
        window.setFrame(WallpaperWindow.mainScreen.frame, display: true)
    }

    func close() {
        window.orderOut(nil)
        window.contentView = nil
    }
}

/// Decides when to pause the animation: a window fills the main screen (full-screen app or a maximized window),
/// the display sleeps, the screen is locked, or the user switched to another login session.
final class PauseMonitor {
    var onChange: ((Bool) -> Void)?
    var manual = false { didSet { evaluate() } }
    var steering = false { didSet { evaluate() } }   // the user is sailing a ship on the desktop
    private(set) var paused = false

    private var asleep = false
    private var locked = false
    private var inactiveSession = false
    private var timer: Timer?

    init() {
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.asleep = true; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.asleep = false; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inactiveSession = true; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inactiveSession = false; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self?.evaluate() }
        }
        let dn = DistributedNotificationCenter.default()
        dn.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in self?.locked = true; self?.evaluate() }
        dn.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in self?.locked = false; self?.evaluate() }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.evaluate() }
        timer?.tolerance = 0.3
    }

    func evaluate() {
        var reason = ""
        if manual { reason = "manual" }
        else if asleep { reason = "display asleep" }
        else if locked { reason = "screen locked" }
        else if inactiveSession { reason = "session inactive" }
        // Finder in front means the user is on the desktop (dragging icons, "Show Desktop", click-to-reveal):
        // windows may still report full-screen bounds while they're slid away, so don't trust them then.
        else if !Self.finderIsFrontmost && !steering, let owner = Self.windowCoveringMainScreen() { reason = "covered by \(owner)" }
        let p = !reason.isEmpty
        if p != paused {
            paused = p
            Log.write(p ? "pause: \(reason)" : "resume")
            onChange?(p)
        }
    }

    static var finderIsFrontmost: Bool {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder"
    }

    /// Why the desktop can't be seen: one window covers (almost) the whole usable area of the main screen,
    /// or several windows together leave less than ~5% of it visible. Returns the frontmost covering app's name.
    static func windowCoveringMainScreen() -> String? {
        let screen = WallpaperWindow.mainScreen
        let full = CGRect(origin: .zero, size: screen.frame.size)        // CG coordinates: main screen at (0,0), y down
        let usable = screen.visibleFrame
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return nil }
        let me = ProcessInfo.processInfo.processIdentifier
        var rects: [CGRect] = [], owner: String?
        for w in list {
            guard (w[kCGWindowLayer as String] as? Int) == 0,
                  (w[kCGWindowOwnerPID as String] as? Int32) != me,
                  (w[kCGWindowAlpha as String] as? Double ?? 1) > 0.5,
                  let b = w[kCGWindowBounds as String] as? NSDictionary,
                  let r = CGRect(dictionaryRepresentation: b) else { continue }
            let i = r.intersection(full)
            if i.isNull || i.width < 40 || i.height < 40 { continue }
            let name = (w[kCGWindowOwnerName as String] as? String) ?? "?"
            if i.width >= usable.width - 4 && i.height >= usable.height - 4 { return name }
            rects.append(i)
            if owner == nil { owner = name }
        }
        guard rects.count > 1 else { return nil }
        // Sample a grid over the usable area (CG y: the menu bar is at the top, the Dock wherever visibleFrame excludes it).
        let area = CGRect(x: usable.minX - screen.frame.minX, y: screen.frame.maxY - usable.maxY,
                          width: usable.width, height: usable.height)
        let nx = 48, ny = 30
        var visible = 0
        for iy in 0..<ny {
            for ix in 0..<nx {
                let p = CGPoint(x: area.minX + (CGFloat(ix) + 0.5) * area.width / CGFloat(nx),
                                y: area.minY + (CGFloat(iy) + 0.5) * area.height / CGFloat(ny))
                if !rects.contains(where: { $0.contains(p) }) { visible += 1 }
            }
        }
        return Double(visible) / Double(nx * ny) < 0.05 ? "\(owner ?? "?") and others" : nil
    }
}

/// Picks how hard the wallpaper may work: full quality on power, fewer frames and pixels on battery,
/// and the bare minimum in Low Power Mode. ICONLAND_POWER=full|battery|low overrides it (for testing).
final class PowerMonitor {
    enum Mode: String { case full, battery, low }

    struct Profile { let fps: Int; let quality: Double }
    static func profile(_ m: Mode) -> Profile {
        switch m {
        case .full: return Profile(fps: 30, quality: 2)        // the themes' own defaults
        case .battery: return Profile(fps: 24, quality: 1.5)   // ~45% of the GPU work
        case .low: return Profile(fps: 15, quality: 1.25)      // ~20%
        }
    }

    var onChange: ((Mode) -> Void)?
    private(set) var mode: Mode = .full
    private var source: CFRunLoopSource?

    init() {
        mode = Self.current()
        Log.write("power: \(mode.rawValue)")
        NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
            self?.evaluate()
        }
        let ctx = Unmanaged.passUnretained(self).toOpaque()
        if let s = IOPSNotificationCreateRunLoopSource({ ctx in
            guard let ctx else { return }
            let me = Unmanaged<PowerMonitor>.fromOpaque(ctx).takeUnretainedValue()
            DispatchQueue.main.async { me.evaluate() }
        }, ctx)?.takeRetainedValue() {
            CFRunLoopAddSource(CFRunLoopGetMain(), s, .defaultMode)
            source = s
        }
    }

    deinit {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .defaultMode) }
    }

    func evaluate() {
        let m = Self.current()
        guard m != mode else { return }
        mode = m
        Log.write("power: \(m.rawValue)")
        onChange?(m)
    }

    static func current() -> Mode {
        if let o = ProcessInfo.processInfo.environment["ICONLAND_POWER"], let m = Mode(rawValue: o) { return m }
        if ProcessInfo.processInfo.isLowPowerModeEnabled { return .low }
        let info = IOPSCopyPowerSourcesInfo().takeRetainedValue()
        if let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?,
           type == kIOPSBatteryPowerValue { return .battery }
        return .full
    }
}
