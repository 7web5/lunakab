// Full-screen toggle, shown top-centre on every page. Hides the browser's tabs
// and address bar. Browsers leave full screen when a new page loads, so after
// following a link the button offers to resume it with one click.
(() => {
  const root = document.documentElement;
  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) return;

  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const enter = () => (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  const exit = () => (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  const remember = (on) => { try { sessionStorage.setItem("lk-fullscreen", on ? "1" : ""); } catch {} };
  const wanted = () => { try { return sessionStorage.getItem("lk-fullscreen") === "1"; } catch { return false; } };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "fs-toggle";

  const render = () => {
    const full = isFull();
    btn.classList.toggle("resume", !full && wanted());
    btn.textContent = full ? "EXIT FULL SCREEN" : wanted() ? "RESUME FULL SCREEN" : "FULL SCREEN";
    btn.setAttribute("aria-pressed", full);
  };

  btn.addEventListener("click", () => {
    if (isFull()) { remember(false); exit(); }
    else { remember(true); Promise.resolve(enter()).catch(() => remember(false)).finally(render); }
  });
  // Leaving with Esc means they're done with full screen; leaving because a link
  // was followed doesn't, so the next page offers to resume.
  let leaving = false;
  window.addEventListener("beforeunload", () => { leaving = true; });
  const onChange = () => { if (!isFull() && !leaving) remember(false); render(); };
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);

  render();
  document.body.appendChild(btn);
})();
