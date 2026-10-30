# App icon source

`AppIcon.svg` renders `App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
(1024x1024, no alpha). It is the Nakata desktop icon (brand mark in cream
`#F5F0E6` on `#111111`, svelka-work `apps/desktop/brand/nakata-mark.svg`) with
the background edge to edge, since iOS draws the rounded corners itself; the
mark is scaled by 1024/864 so it keeps its size relative to the desktop tile.

```sh
rsvg-convert -w 1024 -h 1024 AppIcon.svg -o /tmp/icon.png
# then flatten onto #111111 (App Store rejects an icon with an alpha channel)
```
