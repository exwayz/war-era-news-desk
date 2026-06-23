export function initEcg() {
  const wrap = document.getElementById("ecgWrap");
  if (!wrap) return;
  const canvas = document.createElement("canvas");
  canvas.id = "ecgCanvas";
  wrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W=0, H=0;
  let drawPos = 0;
  let scanLine = [];
  let pulseQ = [];
  let lastAutoPulse = 0;
  const SPEED = 2.2;

  function resize() {
    W = canvas.width = wrap.offsetWidth || 220;
    H = canvas.height = wrap.offsetHeight || 46;
    scanLine = new Array(W).fill(H/2);
  }

  window.ecgPulse = function(intensity=1) {
    pulseQ.push({ intensity:Math.min(2,Math.max(0.3,intensity)), at:drawPos });
  };

  function getY(x) {
    let y = H/2;
    for (const p of pulseQ) {
      const dist = x - p.at;
      if (dist<0||dist>W*0.35) continue;
      const t = dist/(W*0.12);
      let sh=0;
      if      (t<0.15) sh=0;
      else if (t<0.25) sh= 0.15*Math.sin((t-0.15)/0.1*Math.PI);
      else if (t<0.35) sh=-0.08*Math.sin((t-0.25)/0.1*Math.PI);
      else if (t<0.45) sh= 1.0 *Math.sin((t-0.35)/0.1*Math.PI);
      else if (t<0.55) sh=-0.25*Math.sin((t-0.45)/0.1*Math.PI);
      else if (t<0.75) sh= 0.08*Math.sin((t-0.55)/0.2*Math.PI);
      y -= sh * p.intensity * (H*0.32);
    }
    return Math.max(2, Math.min(H-2, y));
  }

  function draw(ts) {
    requestAnimationFrame(draw);
    if (!W||!H) { resize(); return; }
    if (ts - lastAutoPulse > 5000) { window.ecgPulse(0.45); lastAutoPulse=ts; }
    for (let s=0;s<Math.ceil(SPEED);s++) { scanLine[Math.floor(drawPos)%W] = getY(drawPos); drawPos++; }
    pulseQ = pulseQ.filter(p=>drawPos-p.at<W*0.4);
    ctx.clearRect(0,0,W,H);
    const dark = document.documentElement.dataset.theme !== "light";
    const c = dark ? "rgba(208,90,64," : "rgba(163,59,40,";
    const head = Math.floor(drawPos)%W;
    ctx.save(); ctx.lineWidth=1.5; ctx.lineJoin="round";
    for (let x=head+2;x<W-1;x++) {
      const age=(W-(x-head))/W;
      ctx.strokeStyle=c+Math.max(0,(1-age)*0.55)+")";
      ctx.beginPath(); ctx.moveTo(x,scanLine[x]); ctx.lineTo(x+1,scanLine[(x+1)%W]); ctx.stroke();
    }
    for (let x=0;x<head-1;x++) {
      const age=(head-x)/W;
      ctx.strokeStyle=c+Math.max(0,(1-age*0.7)*0.8)+")";
      ctx.beginPath(); ctx.moveTo(x,scanLine[x]); ctx.lineTo(x+1,scanLine[x+1]); ctx.stroke();
    }
    const gy=scanLine[head];
    const gr=ctx.createRadialGradient(head,gy,0,head,gy,6);
    gr.addColorStop(0,c+"0.9)"); gr.addColorStop(1,c+"0)");
    ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(head,gy,6,0,Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.clearRect((head+1)%W,0,14,H);
  }

  setTimeout(()=>{ resize(); addEventListener("resize",()=>setTimeout(resize,100), { passive: true }); requestAnimationFrame(draw); },200);
}
