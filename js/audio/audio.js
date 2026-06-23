const LS_SFX_VOL = "wa-nd-sfx-vol";

let _sfxVolume = parseFloat(localStorage.getItem(LS_SFX_VOL)) || 1;

function audio(path) {
  const a = new Audio(path);
  a.preload = "auto";
  return a;
}

function playSfx(a) {
  if (!a) return;
  const clone = a.cloneNode();
  clone.volume = _sfxVolume;
  clone.play().catch(() => {});
}

function getSfxVolume() { return _sfxVolume; }

function setSfxVolume(v) {
  _sfxVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_SFX_VOL, String(_sfxVolume));
}

function playClick()  { playSfx(audio("assets/audios/click.mp3")); }
function playRead()   { playSfx(audio("assets/audios/read.mp3")); }
function playCopy()   { playSfx(audio("assets/audios/copy.mp3")); }

function playIntro() {
  const a = audio("assets/audios/intro.mp3");
  a.volume = _sfxVolume;
  a.play().catch(() => {});
}

function playApiSaved() {
  const a = audio("assets/audios/api_saved.mp3");
  a.volume = _sfxVolume;
  a.play().catch(() => {});
}

export {
  playClick, playRead, playCopy,
  playIntro, playApiSaved,
  setSfxVolume, getSfxVolume,
};
