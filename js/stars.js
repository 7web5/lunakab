// Starfield background: small white dots, a few of which gently twinkle.
(() => {
  const cv = document.getElementById("stars"), ctx = cv.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stars = [], w = 0, h = 0;
  const build = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((w * h) / 2600);
    stars = Array.from({ length: count }, () => {
      const big = Math.random() < 0.06;
      return {
        x: Math.random() * w, y: Math.random() * h,
        r: big ? 0.9 + Math.random() * 0.7 : 0.3 + Math.random() * 0.6,
        a: big ? 0.7 + Math.random() * 0.3 : 0.2 + Math.random() * 0.5,
        tw: Math.random() < 0.25 ? 0.6 + Math.random() * 1.6 : 0, // twinkle speed (0 = steady)
        ph: Math.random() * Math.PI * 2,
      };
    });
  };
  const render = (t) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      ctx.globalAlpha = s.tw && !still ? s.a * (0.55 + 0.45 * Math.sin(t * 0.001 * s.tw + s.ph)) : s.a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  };
  // Paint straight away (don't wait for the first animation frame), then twinkle.
  build(); render(performance.now());
  addEventListener("resize", () => { build(); render(performance.now()); });
  if (!still) {
    const loop = (t) => { render(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
})();
