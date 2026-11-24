#!/bin/bash
# Builds Nagham.ipa (unsigned — SideStore signs it with your Apple ID). Needs a Mac with Xcode, Go and XcodeGen.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
VERSION="${VERSION:-$(grep -o 'appVersion = "[^"]*"' ../nagham/update.go | cut -d'"' -f2)}"
BUILD="${BUILD:-1}"
echo "== Nagham for iPhone $VERSION ($BUILD)"

echo "== 1/3 the built-in server (Go → libnagham.a)"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
CLANG="$(xcrun --sdk iphoneos -f clang)"
mkdir -p Core
(cd ../nagham && CGO_ENABLED=1 GOOS=ios GOARCH=arm64 \
  CC="$CLANG -isysroot $SDK -arch arm64 -miphoneos-version-min=15.0" \
  CGO_CFLAGS="-isysroot $SDK -arch arm64 -miphoneos-version-min=15.0" \
  CGO_LDFLAGS="-isysroot $SDK -arch arm64 -miphoneos-version-min=15.0" \
  go build -buildmode=c-archive -trimpath -ldflags "-s -w" -o "$ROOT/Core/libnagham.a" .)
ls -la Core

echo "== 2/3 the app (Xcode)"
xcodegen generate
xcodebuild -project Nagham.xcodeproj -scheme Nagham -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath build \
  MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build | tee build.log | grep -E "error:|warning: .*Nagham|BUILD (SUCCEEDED|FAILED)" || true
test -d build/Build/Products/Release-iphoneos/Nagham.app

echo "== 3/3 Nagham.ipa"
rm -rf Payload Nagham.ipa
mkdir Payload
cp -R build/Build/Products/Release-iphoneos/Nagham.app Payload/
zip -qry Nagham.ipa Payload
ls -la Nagham.ipa
