"use strict";
/* Nagham – Spotify account linking was removed (3.19.0). Spotify *links* still work (pasted in Download / Albums),
   they are read from Spotify's public pages. These names stay so older saved data can't break anything. */
const SP = { loaded: true, configured: false, connected: false, premium: false, deviceId: null };
const SPP = { paused: true, pos: 0, dur: 0 };
const SP_LOGO = "";
const spCanStream = () => false;
const isSp = id => !!id && id.startsWith("sp:");
const SPF = {};
function spLoad() { return { data: null }; }
async function spEnsure() { return { ids: [] }; }
function spCtxTracks() { return null; }
async function spPlayCtx() { toast("Spotify account playlists aren't in Nagham any more"); }
function spPlaylistTile() { return ""; }
function spAlbumTile() { return ""; }
function spArtistTile() { return ""; }
async function spRefreshStatus() { return SP; }
async function spGetTrack() { return null; }
function spPos() { return 0; }
function spSeek() {}
function spResume() {}
function spPauseSdk() {}
function spSetVolume() {}
async function spPlayUri() { throw new Error("Spotify playback was removed"); }
function spErrorNote(m) { return esc(m || ""); }
