"""Build a Windows resource object (.syso) for Go: icon, version info, manifest."""
import struct, sys

ico_path, out_path, version = sys.argv[1], sys.argv[2], sys.argv[3]  # version like 1.0.0.0

LANG = 0x0409

def pad4(b):
    return b + b"\0" * ((4 - len(b) % 4) % 4)

# ---------- icon ----------
ico = open(ico_path, "rb").read()
_, _, count = struct.unpack_from("<HHH", ico, 0)
icons, grp_entries = [], []
for i in range(count):
    w, h, cc, res, planes, bpp, size, off = struct.unpack_from("<BBBBHHII", ico, 6 + 16 * i)
    icons.append((i + 1, ico[off:off + size]))
    grp_entries.append(struct.pack("<BBBBHHIH", w, h, cc, res, planes, bpp, size, i + 1))
group = struct.pack("<HHH", 0, 1, count) + b"".join(grp_entries)

# ---------- version info ----------
def node(key, value=b"", vtype=0, children=b"", value_len=None):
    vl = value_len if value_len is not None else len(value)
    b = struct.pack("<HHH", 0, vl, vtype) + (key + "\0").encode("utf-16-le")
    b = pad4(b) + value
    if children:
        b = pad4(b) + children
    return struct.pack("<H", len(b)) + b[2:]

def snode(key, text):
    v = (text + "\0").encode("utf-16-le")
    return pad4(node(key, v, 1, value_len=len(text) + 1))

parts = [int(x) for x in version.split(".")]
ms, ls = (parts[0] << 16) | parts[1], (parts[2] << 16) | parts[3]
fixed = struct.pack("<13I", 0xFEEF04BD, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0)
strings = {
    "CompanyName": "Nagham",
    "FileDescription": "Nagham Music Player",
    "FileVersion": version,
    "InternalName": "Nagham",
    "LegalCopyright": "Nagham",
    "OriginalFilename": "Nagham.exe",
    "ProductName": "Nagham",
    "ProductVersion": version,
}
table = node("040904B0", vtype=1, children=b"".join(snode(k, v) for k, v in strings.items()))
sfi = node("StringFileInfo", vtype=1, children=pad4(table))
var = pad4(node("Translation", struct.pack("<HH", LANG, 0x04B0), 0))
vfi = node("VarFileInfo", vtype=1, children=var)
verinfo = node("VS_VERSION_INFO", fixed, 0, children=pad4(sfi) + pad4(vfi))

manifest = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" processorArchitecture="*" name="Nagham.MusicPlayer" type="win32"/>
  <description>Nagham Music Player</description>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application>
  </compatibility>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"""

# ---------- resource tree ----------
res = {3: icons, 14: [(1, group)], 16: [(1, verinfo)], 24: [(1, manifest)]}
types = sorted(res)

def dir_hdr(n):
    return struct.pack("<IIHHHH", 0, 0, 0, 0, 0, n)

# layout: L1 dir, then L2 dirs, then L3 dirs, then data entries, then data
l1_size = 16 + 8 * len(types)
l2_offs, off = {}, l1_size
for t in types:
    l2_offs[t] = off
    off += 16 + 8 * len(res[t])
l3_offs = {}
for t in types:
    for (i, _) in res[t]:
        l3_offs[(t, i)] = off
        off += 16 + 8
de_offs = {}
for t in types:
    for (i, _) in res[t]:
        de_offs[(t, i)] = off
        off += 16
data_offs = {}
for t in types:
    for (i, d) in res[t]:
        off = (off + 7) & ~7
        data_offs[(t, i)] = off
        off += len(d)
total = (off + 7) & ~7

buf = bytearray(total)
buf[0:16] = dir_hdr(len(types))
for k, t in enumerate(types):
    struct.pack_into("<II", buf, 16 + 8 * k, t, 0x80000000 | l2_offs[t])
    o = l2_offs[t]
    buf[o:o + 16] = dir_hdr(len(res[t]))
    for j, (i, d) in enumerate(res[t]):
        struct.pack_into("<II", buf, o + 16 + 8 * j, i, 0x80000000 | l3_offs[(t, i)])
        o3 = l3_offs[(t, i)]
        buf[o3:o3 + 16] = dir_hdr(1)
        struct.pack_into("<II", buf, o3 + 16, LANG, de_offs[(t, i)])
        struct.pack_into("<IIII", buf, de_offs[(t, i)], data_offs[(t, i)], len(d), 0, 0)
        buf[data_offs[(t, i)]:data_offs[(t, i)] + len(d)] = d

relocs = [de_offs[k] for k in sorted(de_offs, key=lambda k: de_offs[k])]

# ---------- COFF ----------
raw_ptr = 20 + 40
rel_ptr = raw_ptr + len(buf)
sym_ptr = rel_ptr + 10 * len(relocs)
out = bytearray()
out += struct.pack("<HHIIIHH", 0x8664, 1, 0, sym_ptr, 1, 0, 0)
out += struct.pack("<8sIIIIIIHHI", b".rsrc", 0, 0, len(buf), raw_ptr, rel_ptr, 0, len(relocs), 0, 0x40000040)
out += buf
for r in relocs:
    out += struct.pack("<IIH", r, 0, 3)  # IMAGE_REL_AMD64_ADDR32NB against symbol 0
out += struct.pack("<8sIhHBB", b".rsrc", 0, 1, 0, 3, 0)
out += struct.pack("<I", 4)
open(out_path, "wb").write(out)
print("wrote", out_path, len(out), "bytes;", len(relocs), "resources")
