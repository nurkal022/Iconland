import AppKit
import WebKit

/// Serves the theme pages from disk under iconland://app/… and shared files under iconland://share/…
/// (a custom scheme keeps fetch(), canvas export and iframes same-origin, unlike file://).
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "iconland"

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8", "json": "application/json; charset=utf-8",
        "css": "text/css; charset=utf-8", "png": "image/png", "webp": "image/webp",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml", "ico": "image/x-icon",
        "mp4": "video/mp4", "webm": "video/webm",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let root: URL
        switch url.host {
        case "share": root = Paths.share
        default: root = Paths.web
        }
        var rel = url.path
        if rel.hasPrefix("/") { rel.removeFirst() }
        let base = root.standardizedFileURL.path
        let file = root.appendingPathComponent(rel).standardizedFileURL
        guard !rel.isEmpty, file.path.hasPrefix(base + "/"), let data = try? Data(contentsOf: file) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
            task.didReceive(resp); task.didReceive(Data()); task.didFinish()
            return
        }
        let type = Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Breaks the WKUserContentController → handler retain cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

/// A WKWebView that exposes the same `window.chrome.webview` API the pages were written for (WebView2),
/// so the Windows theme pages run unchanged.
final class HostWeb: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let view: WKWebView
    var onMessage: ((String) -> Void)?
    var label: String

    private static let shim = """
    (function () {
      if (window.chrome && window.chrome.webview) return;
      const listeners = [];
      window.chrome = window.chrome || {};
      const wallpaper = /[?&]wallpaper=1/.test(location.search);
      let recording = false;                    // a share video is being recorded: always full frame rate
      window.chrome.webview = {
        postMessage(m) {
          const s = typeof m === 'string' ? m : JSON.stringify(m);
          if (s.startsWith('record|')) recording = false;
          window.webkit.messageHandlers.host.postMessage(s);
        },
        addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
        removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
      };

      // Frame governor (wallpaper only). The themes cap themselves at 30 fps by skipping frames, but their
      // requestAnimationFrame loop still wakes on every display refresh (120 Hz on ProMotion) and keeps spinning
      // while paused. Instead, sleep in a timer until the next frame is due and only then ask for a vsync-aligned
      // frame; while the page is paused, hold its callback and just check back a few times a second.
      if (wallpaper) {
        const raf = window.requestAnimationFrame.bind(window);
        let cbs = [], pending = false, last = 0;
        window.__frameMs = 1000 / 30;           // set by the host's power profile
        const pagePaused = () => { try { return paused === true; } catch (e) { return false; } };   // the theme's global
        const fire = now => {
          pending = false; last = now;
          const list = cbs; cbs = [];
          for (const cb of list) { try { cb(now); } catch (e) { console.error(e); } }
        };
        const pump = () => {
          if (pending || !cbs.length) return;
          pending = true;
          if (pagePaused() && !recording) { setTimeout(() => { pending = false; pump(); }, 250); return; }
          const wait = last + (recording ? 1000 / 30 : window.__frameMs) - performance.now() - 2;   // wake a hair early, rAF snaps to vsync
          if (wait > 1) setTimeout(() => raf(fire), wait); else raf(fire);
        };
        window.requestAnimationFrame = cb => { cbs.push(cb); pump(); return cbs.length; };
        window.cancelAnimationFrame = () => {};   // the themes never cancel their loop
      }

      // Power profile from the host: frame interval and render resolution (the themes' P.quality caps devicePixelRatio).
      function applyPower(fps, quality) {
        window.__frameMs = 1000 / fps;
        try {
          if (typeof P === 'object' && P && typeof P.quality === 'number' && P.quality !== quality) {
            P.quality = quality;
            window.dispatchEvent(new Event('resize'));   // the theme re-sizes its canvas (debounced)
          }
        } catch (e) {}
      }

      // The theme pages time the icon morph with wall-clock time but stop their frame loop while paused,
      // so a morph that starts during a pause would be "over" before the first frame is drawn and the
      // scenery would jump. Remember such a morph and restart it when the pause ends.
      let hostPaused = false, morphPending = false;
      window.__hostPost = function (s) {
        if (s.startsWith('{"t":"power"')) {
          try { const m = JSON.parse(s); applyPower(m.fps, m.quality); } catch (e) {}
          return;
        }
        if (s.startsWith('{"t":"record"')) recording = true;
        const ev = { data: s };
        for (const fn of listeners.slice()) { try { fn(ev); } catch (e) { console.error(e); } }
        if (s.startsWith('{"t":"pause"')) {
          const p = s.indexOf('true') > 0;
          if (hostPaused && !p && morphPending && typeof morphT0 === 'number' && typeof morphDur === 'number') {
            morphT0 = performance.now();          // play the deferred transition now that frames are drawn
            if (typeof curMix === 'number') curMix = 0;
          }
          if (!p) morphPending = false;
          hostPaused = p;
        } else if (s.startsWith('{"t":"icons"') && hostPaused) {
          morphPending = true;
        }
      };
      window.__ICONLAND_MAC = true;
      window.__snapErrors = [];
      window.addEventListener('error', e => window.__snapErrors.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
      if (\(diagnostics ? "true" : "false") && /[?&]wallpaper=1/.test(location.search)) {   // ICONLAND_DEBUG=1: frame rate log
        let n = 0; const tick = () => { n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        setInterval(() => { window.webkit.messageHandlers.host.postMessage('fps|' + (n / 5).toFixed(1) + '|' + document.visibilityState); n = 0; }, 5000);
      }
    })();
    """

    static let diagnostics = ProcessInfo.processInfo.environment["ICONLAND_DEBUG"] == "1"

    init(label: String) {
        self.label = label
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(LocalSchemeHandler(), forURLScheme: LocalSchemeHandler.scheme)
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let uc = WKUserContentController()
        uc.addUserScript(WKUserScript(source: Self.shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = uc
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        uc.add(WeakHandler(self), name: "host")
        view.navigationDelegate = self
        view.uiDelegate = self
        if #available(macOS 13.3, *) { view.isInspectable = true }
        view.allowsMagnification = false
    }

    /// The wallpaper window always sits under Finder's full-screen (transparent) icon window, so macOS may report it
    /// as occluded and WebKit would stop drawing frames. Our own PauseMonitor decides when to pause instead.
    func keepRenderingWhenOccluded() {
        let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if view.responds(to: sel) {
            view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
        } else {
            Log.write("[\(label)] occlusion detection SPI unavailable")
        }
    }

    deinit {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "host")
    }

    func load(_ page: String) {
        guard let url = URL(string: "\(LocalSchemeHandler.scheme)://app/\(page)") else { return }
        view.load(URLRequest(url: url))
    }

    /// Equivalent of CoreWebView2.PostWebMessageAsString.
    func post(_ json: String) {
        view.evaluateJavaScript("window.__hostPost && window.__hostPost(\(JSON.string(json)))", completionHandler: nil)
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if let s = m.body as? String { onMessage?(s) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("[\(label)] web content process terminated, reloading")
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Log.write("[\(label)] navigation failed: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Log.write("[\(label)] load failed: \(error.localizedDescription)")
    }

    // Open external links (e.g. the project site) in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let scheme = url.scheme, scheme == "http" || scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // window.alert() from the settings page.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
        completionHandler()
    }

    // <input type=file> isn't used, but downloads in browser-mode share fallbacks aren't needed either.
}
