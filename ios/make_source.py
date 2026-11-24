"""Writes the SideStore / AltStore source for Nagham (ios/source.json)."""
import json, sys, datetime
version, build, size, tag = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
repo = "abduallaf3-create/nagaham"
raw = f"https://raw.githubusercontent.com/{repo}/main/ios"
url = f"https://github.com/{repo}/releases/download/{tag}/Nagham.ipa"
today = datetime.date.today().isoformat()
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from notes import notes
desc = notes(version)
app = {
    "name": "Nagham",
    "bundleIdentifier": "com.abood.nagham",
    "developerName": "Abood",
    "subtitle": "نغم — موسيقى بدون حدود",
    "localizedDescription": "Nagham on your iPhone: search any singer and see every song and album, follow artists, playlists, likes, lyrics, themes — and full songs from YouTube Music.",
    "iconURL": f"{raw}/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
    "tintColor": "d946ef",
    "category": "entertainment",
    "screenshotURLs": [],
    "versions": [{
        "version": version, "buildVersion": build, "date": today,
        "localizedDescription": desc, "downloadURL": url, "size": size, "minOSVersion": "15.0",
    }],
    # older SideStore / AltStore versions read these
    "version": version, "versionDate": today, "versionDescription": desc, "downloadURL": url, "size": size,
    "appPermissions": {"entitlements": [], "privacy": {
        "NSMicrophoneUsageDescription": "Karaoke uses the microphone to score your singing.",
        "NSCameraUsageDescription": "Karaoke can record a video of you singing."}},
}
print(json.dumps({
    "name": "Nagham",
    "identifier": "com.abood.nagham.source",
    "subtitle": "Nagham for iPhone",
    "description": "Add this source in SideStore to install Nagham and get its updates.",
    "iconURL": app["iconURL"],
    "website": f"https://github.com/{repo}",
    "tintColor": "d946ef",
    "apps": [app],
    "news": [],
}, ensure_ascii=False, indent=2))
