// native-shell.js — the ONLY place native-app-specific behaviour lives.
//
// The website and the iOS/Android apps run the exact same HTML/CSS/JS
// (see README §9). This file is loaded last by index.html and does
// NOTHING unless it detects it is running inside the Capacitor native
// shell, so a normal browser (GitHub Pages) is completely unaffected.
//
// Capacitor injects window.Capacitor into the WebView itself, so no
// bundler or <script> tag for it is needed; native plugins are reached
// through Capacitor.registerPlugin(name), which returns a proxy to the
// plugin's native side. A plugin that isn't installed just rejects its
// calls — every call below is wrapped so that can never break the app.

(function () {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return;

  const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "native"; // "ios" | "android"

  // Hooks so any native-only CSS tweak can be scoped without touching web styling:
  //   .native-app / .native-ios / .native-android on <html>
  document.documentElement.classList.add("native-app", "native-" + platform);

  function getPlugin(name) {
    try { return cap.registerPlugin(name); } catch (e) { return null; }
  }

  // -------- status bar: follow the app's light/dark theme --------
  // The theme toggle (auth-ui.js) flips data-theme="dark" on <html>; the
  // inline script in index.html's <head> sets it before first paint.
  // "DARK" here means light text for a dark background (Capacitor's naming).
  const StatusBar = getPlugin("StatusBar");
  const BAR_BACKGROUND = { light: "#f4efe1", dark: "#14180f" }; // matches --paper in styles.css

  async function syncStatusBar() {
    if (!StatusBar) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    try { await StatusBar.setStyle({ style: dark ? "DARK" : "LIGHT" }); } catch (e) { /* plugin missing / unsupported */ }
    if (platform === "android") {
      try { await StatusBar.setBackgroundColor({ color: BAR_BACKGROUND[dark ? "dark" : "light"] }); } catch (e) { /* ignore */ }
    }
  }

  syncStatusBar();
  new MutationObserver(syncStatusBar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
})();
