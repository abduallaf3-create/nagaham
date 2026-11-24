// Nagham's server, built from the Go code as a static library (Core/libnagham.a)
#ifndef NAGHAM_BRIDGING_HEADER_H
#define NAGHAM_BRIDGING_HEADER_H
extern int NaghamStart(char *data, char *music);
extern void NaghamSetNative(int on);

// Python (with yt-dlp) embedded in the app
#include <Python/Python.h>
#endif
