const LS_SFX_VOL = "wa-nd-sfx-vol";
const LS_SFX_ENABLED = "wa-nd-sfx-enabled";

let _sfxVolume = parseFloat(localStorage.getItem(LS_SFX_VOL)) || 1;
let _sfxEnabled = localStorage.getItem(LS_SFX_ENABLED) === "1";

function audio(path) {
  const a = new Audio(path);
  a.preload = "auto";
  return a;
}

function playSfx(a) {
  if (!a || !_sfxEnabled) return;
  const clone = a.cloneNode();
  clone.volume = _sfxVolume;
  clone.play().catch(() => {});
}

function playClick()   { playSfx(audio("assets/audios/click.mp3")); }
function playRead()    { playSfx(audio("assets/audios/read.mp3")); }
function playCopy()    { playSfx(audio("assets/audios/copy.mp3")); }
function playApiSaved(){ playSfx(audio("assets/audios/api_saved.mp3")); }
function playCapture() { playSfx(audio("assets/audios/capture.mp3")); }

function getSfxVolume() { return _sfxVolume; }

function setSfxVolume(v) {
  _sfxVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_SFX_VOL, String(_sfxVolume));
}

function getSfxEnabled() { return _sfxEnabled; }

function setSfxEnabled(on) {
  _sfxEnabled = !!on;
  localStorage.setItem(LS_SFX_ENABLED, _sfxEnabled ? "1" : "0");
}

export {
  playClick, playRead, playCopy, playApiSaved, playCapture,
  setSfxVolume, getSfxVolume, setSfxEnabled, getSfxEnabled,
};
