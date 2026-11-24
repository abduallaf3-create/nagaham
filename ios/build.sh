#!/bin/bash
# Builds Nagham.ipa (unsigned — SideStore signs it with your Apple ID). Needs a Mac with Xcode, Go and XcodeGen.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
VERSION="${VERSION:-$(grep -o 'appVersion = "[^"]*"' server/update.go | cut -d'"' -f2)}"
BUILD="${BUILD:-1}"
echo "== Nagham for iPhone $VERSION ($BUILD)"

echo "== 0/3 Python + yt-dlp for the app"
PY_TAG="${PY_TAG:-3.14-b14}"
if [ ! -d Python.xcframework ]; then
  curl -sSfL -o /tmp/py-ios.tgz "https://github.com/beeware/Python-Apple-support/releases/download/$PY_TAG/Python-3.14-iOS-support.${PY_TAG#*-}.tar.gz"
  mkdir -p /tmp/py-ios && tar xzf /tmp/py-ios.tgz -C /tmp/py-ios
  mv /tmp/py-ios/Python.xcframework .
fi
rm -rf python/app_packages && mkdir -p python/app_packages
python3 -m pip download -q --no-deps --only-binary=:all: --python-version 3.14 --platform any -d /tmp/py-wheels yt-dlp yt-dlp-ejs mutagen certifi
python3 -m pip install -q --no-deps --target python/app_packages /tmp/py-wheels/*.whl
rm -rf python/app_packages/bin python/app_packages/share
find python -name "__pycache__" -type d -prune -exec rm -rf {} +
python3 -c "import sys; sys.path[:0]=['python/app_packages','python/app']; import yt_dlp, mutagen, certifi, yt_dlp_ejs, naghambridge; print('yt-dlp', yt_dlp.version.__version__)"

echo "== 1/3 the built-in server (Go → libnagham.a)"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
CLANG="$(xcrun --sdk iphoneos -f clang)"
mkdir -p Core
(cd server && CGO_ENABLED=1 GOOS=ios GOARCH=arm64 \
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
