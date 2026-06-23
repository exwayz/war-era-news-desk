const LS_SFX_VOL = "wa-nd-sfx-vol";

let _sfxVolume = parseFloat(localStorage.getItem(LS_SFX_VOL)) || 1;

let _actx;
function ctx() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  return _actx;
}

function playSfx(fn) {
  if (!fn) return;
  try { fn(ctx(), _sfxVolume); } catch {}
}

function playClick() {
  playSfx((ac, vol) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1200, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(400, ac.currentTime + 0.08);
    g.gain.setValueAtTime(vol * 0.3, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.1);
  });
}

function playRead() {
  playSfx((ac, vol) => {
    const len = ac.sampleRate * 0.15;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol * 0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
    src.connect(g).connect(ac.destination);
    src.start();
  });
}

function playCopy() {
  playSfx((ac, vol) => {
    const t = ac.currentTime;
    // Shutter open
    const o1 = ac.createOscillator(); const g1 = ac.createGain();
    o1.type = "triangle";
    o1.frequency.setValueAtTime(800, t); o1.frequency.exponentialRampToValueAtTime(200, t + 0.04);
    g1.gain.setValueAtTime(vol * 0.25, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o1.connect(g1).connect(ac.destination); o1.start(t); o1.stop(t + 0.05);
    // Shutter close
    const o2 = ac.createOscillator(); const g2 = ac.createGain();
    o2.type = "triangle";
    o2.frequency.setValueAtTime(1000, t + 0.08); o2.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    g2.gain.setValueAtTime(vol * 0.25, t + 0.08); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o2.connect(g2).connect(ac.destination); o2.start(t + 0.08); o2.stop(t + 0.13);
  });
}

function getSfxVolume() { return _sfxVolume; }

function setSfxVolume(v) {
  _sfxVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem(LS_SFX_VOL, String(_sfxVolume));
}

export {
  playClick, playRead, playCopy,
  setSfxVolume, getSfxVolume,
};
