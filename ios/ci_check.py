"""CI check on the Mac (same JavaScriptCore as the iPhone): the bridge solves YouTube's JS challenges
and yt-dlp finds a song's audio. Not fatal — YouTube sometimes blocks cloud machines."""
import json, os, sys, threading, time, urllib.request
here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(here, "python", "app_packages"), os.path.join(here, "python", "app")]
import naghambridge as b

print("JavaScriptCore loaded:", b.JSC.lib is not None, b.JSC.err)
print("JSC 1+2 =", b.JSC.run("console.log(1+2)"))
print("JSC json =", b.JSC.run("console.log(JSON.stringify({a:[1,2,{b:'ب'}]}))"))
threading.Thread(target=b.serve, args=(41799,), daemon=True).start()
time.sleep(3)
print(urllib.request.urlopen("http://127.0.0.1:41799/health").read().decode())
for vid in ["dQw4w9WgXcQ", "kJQP7kiw5Fk"]:
    body = json.dumps({"args": ["--dump-single-json", "--no-playlist", "--ignore-config", "-v",
                                "-f", "bestaudio[ext=m4a]/bestaudio/best", "--", f"https://www.youtube.com/watch?v={vid}"]}).encode()
    t = time.time()
    lines = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:41799/run", data=body), timeout=180).read().decode().splitlines()
    out = [l[2:] for l in lines if l.startswith("o ")]
    err = [l[2:] for l in lines if l.startswith("e ")]
    code = [l[2:] for l in lines if l.startswith("x ")]
    info = {}
    for l in out:
        if l.startswith("{"):
            info = json.loads(l)
    print(f"--- {vid}: exit {code} in {time.time() - t:.1f}s  ext={info.get('ext')} protocol={info.get('protocol')} url={'yes' if info.get('url') else 'no'}")
    for l in err:
        if "jsc" in l.lower() or "javascript" in l.lower() or "challenge" in l.lower() or "error" in l.lower() or "warning" in l.lower():
            print("   ", l[:300])
