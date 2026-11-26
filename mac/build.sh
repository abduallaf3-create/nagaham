#!/bin/bash
# Builds Nagham for Mac (Apple chips + Intel in one app) → mac/build/Nagham-mac-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/mac/build"
rm -rf "$OUT"; mkdir -p "$OUT"
VERSION="$(grep -o 'appVersion = "[^"]*"' nagham/update.go | cut -d'"' -f2)"
BUILD="${BUILD:-1}"
APP="$OUT/Nagham.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== Nagham server (Go) $VERSION"
for a in arm64 amd64; do
  (cd nagham && CGO_ENABLED=0 GOOS=darwin GOARCH=$a go build -trimpath -ldflags "-s -w" -o "$OUT/server-$a" .)
done
lipo -create -output "$APP/Contents/MacOS/nagham-server" "$OUT/server-arm64" "$OUT/server-amd64"

echo "== Nagham window (Swift)"
SDK="$(xcrun --show-sdk-path --sdk macosx)"
for a in arm64 x86_64; do
  xcrun swiftc -O -parse-as-library -target "$a-apple-macos12.0" -sdk "$SDK" \
    -framework Cocoa -framework WebKit mac/Sources/*.swift -o "$OUT/app-$a"
done
lipo -create -output "$APP/Contents/MacOS/Nagham" "$OUT/app-arm64" "$OUT/app-x86_64"

sed -e "s/__VERSION__/$VERSION/g" -e "s/__BUILD__/$BUILD/g" mac/Info.plist > "$APP/Contents/Info.plist"

echo "== Icon"
ICON="ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
SET="$OUT/AppIcon.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICON" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ICON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "== Sign (ad-hoc: needed for Apple chips) and pack"
codesign --force --deep -s - "$APP"
codesign --verify --deep --strict "$APP"
lipo -info "$APP/Contents/MacOS/Nagham" "$APP/Contents/MacOS/nagham-server"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/Nagham-mac-$VERSION.zip"

echo "== Installer (.dmg): open it, drag Nagham into Applications"
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Nagham.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Nagham $VERSION" -srcfolder "$STAGE" -ov -format UDZO -fs HFS+ "$OUT/Nagham-mac-$VERSION.dmg"
rm -rf "$STAGE"
ls -la "$OUT"
