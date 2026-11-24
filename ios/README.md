# Nagham for iPhone

The iPhone app is built automatically on GitHub (Actions → "iPhone app") every time the code changes.
Each build is published as a release named `ios-vX.Y.Z` with **Nagham.ipa**, and `ios/source.json` is updated.

## Install (free, with SideStore)
1. Install **SideStore** on the iPhone (needs a computer once): https://sidestore.io
2. In SideStore: **Sources → +** and add
   `https://raw.githubusercontent.com/abduallaf3-create/nagaham/main/ios/source.json`
3. Open the Nagham source and tap **Get / Free**.
4. Updates show up in **My Apps** → tap **Update**.

Your songs go in Files → On My iPhone → Nagham → Music. Backups are in Files → On My iPhone → Nagham → Backups.

## Build it yourself (Mac)
`brew install go xcodegen` then `ios/build.sh` → `ios/Nagham.ipa`.
