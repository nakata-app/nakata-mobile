import AVFoundation
import UIKit
import WebKit
import Capacitor

private final class WeakAudioMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?

    init(_ owner: AppDelegate) {
        self.owner = owner
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let dict = message.body as? [String: Any]
        let active = (dict?["active"] as? Bool) ?? false
        DispatchQueue.main.async { [weak owner = self.owner] in
            owner?.setVoiceCallActive(active)
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var voiceCallActive = false
    private var observersInstalled = false
    private var observerTokens: [NSObjectProtocol] = []
    private var lastResumeNotifyAt: TimeInterval = 0
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private weak var attachedWebView: WKWebView?

    private func configureAudioSession(active: Bool) {
        let session = AVAudioSession.sharedInstance()
        #if compiler(>=6.2)
        let bluetooth: AVAudioSession.CategoryOptions = .allowBluetoothHFP
        #else
        let bluetooth: AVAudioSession.CategoryOptions = .allowBluetooth
        #endif
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, bluetooth])
        if active {
            try? session.setActive(true, options: [])
        }
    }

    private func notifyJsAudioResumed() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.voiceCallActive, let webView = self.attachedWebView else { return }
            let now = Date.timeIntervalSinceReferenceDate
            guard now - self.lastResumeNotifyAt >= 0.75 else { return }
            self.lastResumeNotifyAt = now
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('nakata:audio-resumed'));", completionHandler: nil)
        }
    }

    private func endVoiceBackgroundTask() {
        if bgTask != .invalid {
            UIApplication.shared.endBackgroundTask(bgTask)
            bgTask = .invalid
        }
    }

    private func installAudioObserversIfNeeded() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let nc = NotificationCenter.default
        observerTokens.append(
            nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
                guard let self = self, self.voiceCallActive,
                      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      let kind = AVAudioSession.InterruptionType(rawValue: raw),
                      kind == .ended else { return }
                self.configureAudioSession(active: true)
                self.notifyJsAudioResumed()
            }
        )
        observerTokens.append(
            nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, self.voiceCallActive else { return }
                self.configureAudioSession(active: true)
                self.notifyJsAudioResumed()
            }
        )
        observerTokens.append(
            nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
                guard let self = self, self.voiceCallActive,
                      let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                      let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
                // Never call setCategory inside routeChangeNotification (.categoryChange/.override loops with WebKit WebRTC).
                if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable {
                    self.notifyJsAudioResumed()
                }
            }
        )
    }

    private func attachAudioBridgeIfNeeded() {
        guard let vc = window?.rootViewController as? CAPBridgeViewController,
              let webView = vc.bridge?.webView,
              attachedWebView !== webView else { return }
        attachedWebView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "nakataAudio")
        ucc.add(WeakAudioMessageHandler(self), name: "nakataAudio")
    }

    func setVoiceCallActive(_ active: Bool) {
        attachAudioBridgeIfNeeded()
        voiceCallActive = active
        if active {
            configureAudioSession(active: true)
        } else {
            endVoiceBackgroundTask()
            lastResumeNotifyAt = 0
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        installAudioObserversIfNeeded()
        DispatchQueue.main.async { [weak self] in
            self?.attachAudioBridgeIfNeeded()
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        if voiceCallActive {
            configureAudioSession(active: true)
        }
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        guard voiceCallActive else { return }
        configureAudioSession(active: true)
        endVoiceBackgroundTask()
        bgTask = application.beginBackgroundTask(withName: "nakata-voice-transition") {
            DispatchQueue.main.async { [weak self] in
                self?.endVoiceBackgroundTask()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.endVoiceBackgroundTask()
        }
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        endVoiceBackgroundTask()
        if voiceCallActive {
            configureAudioSession(active: true)
        }
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        attachAudioBridgeIfNeeded()
        if voiceCallActive {
            configureAudioSession(active: true)
            notifyJsAudioResumed()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
