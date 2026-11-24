"""What's new in this version (from Nagham's own changelog, web/whatsnew.js)."""
import re, sys, pathlib
def notes(version):
    js = (pathlib.Path(__file__).resolve().parent.parent / "nagham" / "web" / "whatsnew.js").read_text(encoding="utf-8")
    m = re.search(r'\{\s*v:\s*"' + re.escape(version) + r'",\s*items:\s*\[(.*?)\]\s*\}', js, re.S)
    if not m:
        return f"Nagham {version}"
    items = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
    return "\n".join("• " + i.replace('\\"', '"') for i in items)
if __name__ == "__main__":
    print(notes(sys.argv[1]))
