# Iconland

A live wallpaper for macOS that builds its scenery around your desktop icons. Move a file and the shoreline, the clouds or the islands slowly reshape to follow it.

Iconland is a macOS port of [Deskland Preview](https://github.com/BLEZZ0102/Deskland), an adaptive wallpaper for Windows. It is an independent project and is not affiliated with or endorsed by the Deskland authors.

## Themes

| | Theme | What your icons become |
|---|---|---|
| <img src="web/thumbs/beach.webp" width="160"> | **Beach** | The shoreline curves around your files as waves roll up the sand. |
| <img src="web/thumbs/meadow.webp" width="160"> | **Meadow** | A pen-and-wash meadow; icons hide in white clouds that cast dark green shadows. |
| <img src="web/thumbs/woods.webp" width="160"> | **Woods** | A storybook forest from above; icons rest in sunny clearings joined by dirt paths. |
| <img src="web/thumbs/highsea.webp" width="160"> | **High Sea** | The open ocean from straight above; icons rest in big clouds over deep blue water. |
| <img src="web/thumbs/pond.webp" width="160"> | **Pond** | A watercolor pond; icons sit on grassy banks among lily pads and dragonflies. |
| <img src="web/thumbs/cloudsky.webp" width="160"> | **Cloud Sky** | A cartoon sky that follows your clock from blue day to sunset to starry night. |
| <img src="web/thumbs/archipelago.webp" width="160"> | **Archipelago** | Icons become lush islands ringed by surf, with sailing ships voyaging between them. |
| <img src="web/thumbs/oldmap.webp" width="160"> | **Old Sea Chart** | An antique inked sea chart. Click a ship to take the helm: WASD or arrows to sail, click to set a course, Esc to let it go. |
| <img src="web/thumbs/oldland.webp" width="160"> | **Old Land Map** | An antique map of forests, mountains and towns; icons rest in lakes or on open plains. |
| <img src="web/thumbs/anthill.webp" width="160"> | **Ant Colony** | A sunny patch of forest floor; every group of icons becomes an anthill, and ants carry crumbs and berries along trails between the nests. |
| <img src="web/thumbs/winterlake.webp" width="160"> | **Winter Lake** | Icons melt pools of open water in the ice; skaters glide around them and leave traces while snow falls. |
| <img src="web/thumbs/blockworld.webp" width="160"> | **Block World** | A blocky pixel-art world: icons stand in flat clearings joined by paths, and the land is rebuilt block by block when they move. |
| <img src="web/thumbs/space.webp" width="160"> | **Deep Space** | Icons sit in the dark heart of glowing nebulae among stars, comets, a ringed planet and a small rocket. |
| <img src="web/thumbs/cyberpunk.webp" width="160"> | **Cyberpunk** | A rainy neon megacity from above; icons stand on dark plazas rimmed with neon while traffic and flying cars pass. |

Every theme has its own sliders in the settings window, with a live preview.

## Requirements

- macOS 13 (Ventura) or later.
- To build: a Swift 5.9+ toolchain (Xcode or the Command Line Tools).

## Build and install

```sh
scripts/build-app.sh              # builds build/Iconland.app
scripts/build-app.sh --install    # also copies it to ~/Applications
scripts/build-app.sh --install --run
scripts/make-dmg.sh               # builds build/Iconland-<version>.dmg
```

The app is built for the architecture of the Mac you build on and is ad-hoc signed, not notarized. A copy you build yourself runs without warnings. A copy downloaded from elsewhere is blocked by Gatekeeper until the quarantine flag is removed; the `Установить.command` script on the DMG does that as part of installing.

## Using it

Iconland lives in the menu bar (mountain icon) and has no Dock icon unless the settings window is open.

- **First launch** opens the settings window. macOS asks whether Iconland may control Finder; allow it, or the scenery cannot follow your icons. You can change this later in System Settings → Privacy & Security → Automation.
- **Menu bar menu**: Settings, Theme, Pause animation, Sound, Reload, Start with Mac, Quit.
- **Sound**: most themes play their own generated music and nature sounds (no recordings, nothing downloaded). Turn it off or set the volume in the menu or the settings window; it goes quiet while the display sleeps, the screen is locked or the animation is paused by hand.
- **Share** buttons in the settings window save a picture or a short clip of the current scenery to `~/Pictures/Iconland` and put it on the clipboard.
- The animation pauses by itself when a window covers the whole screen, several windows together hide almost all of the desktop, the display sleeps or the screen is locked.
- **Battery saving**: on power the wallpaper draws 30 frames a second at full resolution, on battery 24 at reduced resolution, and in Low Power Mode 15.

The interface is in English and Russian and follows the system language unless you pick one in settings.

### Privacy

Iconland asks Finder only for the positions of the items on your desktop and the icon and label size. It does not read file names or file contents, and it makes no network requests. Shared pictures and clips are drawn by the theme with sample icons and colored blocks in place of names; nothing is screenshotted.

### Files it writes

| Path | Contents |
|---|---|
| `~/Library/Application Support/Iconland/settings.json` | Theme, per-theme sliders, language |
| `~/Library/Application Support/Iconland/settings.corrupt.json` | Copy of a settings file that could not be read, kept before defaults replace it |
| `~/Library/Application Support/Iconland/host.log` | Log, deleted and restarted when it passes 1 MB |
| `~/Pictures/Iconland/` | Shared pictures and clips |

## Limitations

- Only the main display (the one with the menu bar) gets the wallpaper; icons on other displays are ignored.
- Label sizes are estimated from Finder's icon and text size, so the scenery around a long file name is approximate.
- The build is single-architecture: build on Apple silicon for Apple silicon, on Intel for Intel.
- No automatic updates.

## How it works

- `Sources/Iconland/` is the host, a small AppKit app.
  - `Wallpaper.swift` puts a borderless, click-through window at the desktop level, above the system wallpaper and below Finder's icons, decides when to pause, and picks the power profile.
  - `Sound.swift` decides when the theme's sound may play; the sound itself is generated in `web/sound.js`.
  - `IconReader.swift` asks Finder for icon positions over Apple Events about once a second.
  - `HostWeb.swift` wraps `WKWebView`, serves `web/` under the `iconland://` scheme and gives pages the `window.chrome.webview` messaging API that the upstream Windows host provides, so theme pages run unchanged.
  - `Steering.swift` handles taking the helm of a ship in Old Sea Chart.
  - `AppController.swift` ties it together: menu, settings window, sharing.
- `web/` holds the themes. Each one is a single self-contained HTML page that renders with WebGL 2. `themes.json` lists the themes and their sliders, `i18n/` holds the translations, `settings.html` is the settings window.

## Development

```sh
swift build                                         # debug build; logs also go to stderr
ICONLAND_WEB="$PWD/web" swift run Iconland          # run against the working copy of web/
ICONLAND_DEBUG=1 build/Iconland.app/Contents/MacOS/Iconland   # log frame rate and icon counts to host.log
ICONLAND_POWER=battery build/Iconland.app/Contents/MacOS/Iconland   # force a power profile: full, battery or low
```

Web Inspector is enabled for both web views: Safari → Develop → *your Mac* → Iconland.

Render a theme offscreen to a PNG, with sample icons, and print any JavaScript errors from the page (run `swift build -c release` first):

```sh
scripts/snap.sh woods.html out.png --wait 4 --size 1512x982
scripts/snap.sh oldmap.html out.png --settings '{"key": 1}' --icons rects.json --move 3
```

Register a new theme page in `themes.json` and `i18n/`, and make its thumbnail (needs Python 3 with Pillow):

```sh
scripts/add-theme.py spec.json --thumb snapshot.png
```

The spec format is described at the top of `scripts/add-theme.py`. `scripts/make-icon.py` rebuilds `assets/AppIcon.icns` from a render of `assets/icon/icon.html`.

## License and credits

Iconland is licensed under the GNU General Public License, version 3. See [LICENSE](LICENSE).

It is based on [Deskland Preview](https://github.com/BLEZZ0102/Deskland), Copyright (C) 2026 Deskland authors, at the commit recorded in [UPSTREAM_COMMIT](UPSTREAM_COMMIT). Changes made in this fork in 2026:

- A native macOS host written in Swift replaces the Windows host.
- The app has its own name and icon, as the upstream trademark policy asks of modified versions.
- Twelve themes were added to upstream's Beach and Meadow: Woods, High Sea, Pond, Cloud Sky, Archipelago, Old Sea Chart, Old Land Map, Ant Colony, Winter Lake, Block World, Deep Space and Cyberpunk.
- Generated music and ambience for the themes, and power profiles that save battery.
- A Russian translation was added; the Chinese one is not included.

[NOTICE.upstream](NOTICE.upstream) is the upstream notice, kept verbatim. The `THIRD_PARTY_NOTICES.md` and `TRADEMARKS.md` it mentions are files in the upstream repository; they are not copied here because the third-party components they cover (WebView2, NSIS) belong to the Windows host, which this port does not use. Iconland itself has no third-party dependencies beyond the system frameworks.
