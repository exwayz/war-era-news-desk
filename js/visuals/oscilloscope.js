export function initOsc() {
  const canvas = document.getElementById("oscilloscopeCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let W, H;

  const waves = [
    { center:0.22, freq:0.005, amp:0.08, speed:0.03, phase:0, lw:1.2, alpha:0.18 },
    { center:0.38, freq:0.0038, amp:0.12, speed:0.02, phase:1.7, lw:1.6, alpha:0.32 },
    { center:0.50, freq:0.0045, amp:0.15, speed:0.04, phase:0.8, lw:2.2, alpha:0.55 },
    { center:0.64, freq:0.0035, amp:0.11, speed:0.025, phase:2.1, lw:1.5, alpha:0.28 },
    { center:0.80, freq:0.0055, amp:0.07, speed:0.03, phase:3.2, lw:1.0, alpha:0.15 }
  ];

  function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }

  function draw(ts) {
    requestAnimationFrame(draw);
    const dark = document.documentElement.dataset.theme !== "light";
    const gridColor = dark ? "rgba(208,90,64,0.035)" : "rgba(163,59,40,0.025)";
    const lineBase = dark ? "rgba(208,90,64," : "rgba(163,59,40,";
    ctx.clearRect(0,0,W,H);

    ctx.save();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i=1;i<24;i++){ ctx.beginPath(); ctx.moveTo(W/24*i,0); ctx.lineTo(W/24*i,H); ctx.stroke(); }
    for (let i=1;i<14;i++){ ctx.beginPath(); ctx.moveTo(0,H/14*i); ctx.lineTo(W,H/14*i); ctx.stroke(); }
    ctx.restore();

    const t = ts*0.001;
    for (const w of waves) {
      const phase = w.phase + t*w.speed;
      const pulse = 1 + Math.sin(t*0.22+w.phase)*0.15;
      const amp = w.amp*pulse;
      const baseY = H*w.center + Math.sin(t*0.08+w.phase)*10;
      ctx.beginPath();
      ctx.strokeStyle = lineBase+w.alpha+")";
      ctx.lineWidth = w.lw;
      for (let x=0;x<=W;x+=2) {
        const a = x*w.freq+phase;
        const tri = (2/Math.PI)*Math.asin(Math.sin(a*Math.PI));
        const signal = tri*0.75+Math.sin(a)*0.25;
        const y = baseY+signal*amp*H;
        if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = w.alpha*0.18;
      ctx.lineWidth = w.lw*4;
      ctx.stroke();
      ctx.restore();
    }
  }

  resize();
  addEventListener("resize", resize, { passive: true });
  if (!matchMedia("(prefers-reduced-motion:reduce)").matches) requestAnimationFrame(draw);
}
