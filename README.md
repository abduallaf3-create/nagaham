# Nagham (نغم)

A music player for Windows: your own music, songs from around the world, YouTube Music and Spotify, with themes.

## Download
Get **NaghamSetup.exe** from the [Releases](../../releases/latest) page and run it.
Nagham checks this page by itself and offers new versions when they're published.

## Source
- `nagham/` – the app (Go, no outside packages; the UI is in `nagham/web`)
- `nagham-setup/` – the installer

Build (needs Go 1.22+):
```
cd nagham && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui -s -w" -o Nagham.exe .
copy Nagham.exe ..\nagham-setup\payload\
cd ..\nagham-setup && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui -s -w" -o NaghamSetup.exe .
```

No API keys or secrets are stored in this repository — each user enters their own in the app.
