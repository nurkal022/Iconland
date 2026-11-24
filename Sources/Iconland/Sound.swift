import AppKit

/// Decides when the theme's music and ambience may play: the user's sound setting, and silence while the
/// display sleeps, the screen is locked, another login session is active or the animation is paused by hand.
/// (A window covering the desktop only pauses the picture: the music keeps playing.)
final class SoundGate {
    var onChange: ((Bool) -> Void)?
    var manualPause = false { didSet { evaluate() } }
    var enabled = true { didSet { evaluate() } }
    private(set) var audible = false

    private var asleep = false
    private var locked = false
    private var inactiveSession = false

    init() {
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.screensDidSleepNotification, object: nil, queue: .main) { [weak self] _ in self?.asleep = true; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.asleep = false; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inactiveSession = true; self?.evaluate() }
        ws.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.inactiveSession = false; self?.evaluate() }
        let dn = DistributedNotificationCenter.default()
        dn.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { [weak self] _ in self?.locked = true; self?.evaluate() }
        dn.addObserver(forName: .init("com.apple.screenIsUnlocked"), object: nil, queue: .main) { [weak self] _ in self?.locked = false; self?.evaluate() }
    }

    func evaluate() {
        let a = enabled && !manualPause && !asleep && !locked && !inactiveSession
        if a != audible { audible = a; onChange?(a) }
    }
}
