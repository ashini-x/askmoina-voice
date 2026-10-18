(() => {
  "use strict";
  const opener = document.querySelector("#openAppMenu");
  const sheet = document.querySelector("#nativeMenuSheet");
  const scrim = document.querySelector("#nativeMenuScrim");
  const panel = sheet?.querySelector(".native-menu-panel");
  const grabber = sheet?.querySelector(".native-menu-grabber");
  const closer = document.querySelector("#nativeMenuClose");
  if (!opener || !sheet || !panel) return;

  const motion = () => window.__askmoinaFluidMotion;
  let returnFocus = null;
  let isClosing = false;
  let closeEpoch = 0;

  const open = () => {
    closeEpoch++;
    const wasClosing = isClosing;
    isClosing = false;
    if (!wasClosing) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : opener;
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    opener.setAttribute("aria-expanded", "true");
    document.body.classList.add("native-menu-open");

    const engine = motion();
    if (engine) {
      engine.animate(panel, { y: 0, opacity: 1 }, engine.profiles.sheet,
        { ...(wasClosing ? {} : { from: { y: 24, opacity: 0.72 } }), persistTarget: true });
      if (scrim) engine.animate(scrim, { opacity: 1 }, engine.profiles.sheet,
        { ...(wasClosing ? {} : { from: { opacity: 0.01 } }), persistTarget: true });
    }
    closer?.focus({ preventScroll: true });
  };

  const close = (exitVelocityY = 0) => {
    if (sheet.hidden || isClosing) return;
    isClosing = true;
    const epoch = ++closeEpoch;
    opener.setAttribute("aria-expanded", "false");
    sheet.setAttribute("aria-hidden", "true");
    const engine = motion();
    if (!engine) {
      finishClose(epoch);
      return;
    }

    let remaining = scrim ? 2 : 1;
    const oneFinished = () => {
      remaining--;
      if (remaining === 0) finishClose(epoch);
    };
    engine.animate(panel, { y: 24, opacity: 0.72 }, engine.profiles.exit, {
      velocity: { y: Math.max(0, exitVelocityY), opacity: exitVelocityY > 0 ? -0.12 : 0 },
      onComplete: oneFinished
    });
    if (scrim) engine.animate(scrim, { opacity: 0 }, engine.profiles.exit, { onComplete: oneFinished });
  };

  function finishClose(epoch) {
    if (epoch !== closeEpoch || !isClosing) return;
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
    panel.style.translate = "";
    panel.style.opacity = "";
    if (scrim) scrim.style.opacity = "";
    opener.setAttribute("aria-expanded", "false");
    document.body.classList.remove("native-menu-open");
    isClosing = false;
    if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
  }


  let drag = null;
  if (grabber) {
    grabber.style.touchAction = "none";
    grabber.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false || sheet.hidden) return;
      const engine = motion();
      // A finger takes ownership immediately; stop the spring at its rendered position.
      if (engine) {
        engine.stop(panel, false);
        if (scrim) engine.stop(scrim, false);
      }
      const existingTranslate = panel.style.translate.match(/(-?[\\d.]+)px\\s*$/);
      const baseY = existingTranslate ? Number(existingTranslate[1]) : 0;
      drag = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY,
        lastTime: performance.now(), baseY, y: baseY, velocityY: 0 };
      try { grabber.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
    });
    grabber.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const now = performance.now();
      const y = Math.max(0, drag.baseY + event.clientY - drag.startY);
      const elapsed = Math.max(1, now - drag.lastTime);
      const instantaneousVelocity = (event.clientY - drag.lastY) * 1000 / elapsed;
      drag.velocityY = drag.velocityY * 0.58 + instantaneousVelocity * 0.42;
      drag.lastY = event.clientY;
      drag.lastTime = now;
      drag.y = y;
      panel.style.translate = "0px " + y + "px";
      if (scrim) scrim.style.opacity = String(Math.max(0.12, 1 - y / 360));
      event.preventDefault();
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const released = drag;
      drag = null;
      try { grabber.releasePointerCapture(event.pointerId); } catch (_) {}
      if (released.y > 96 || released.velocityY > 680) {
        close(released.velocityY);
        return;
      }
      const engine = motion();
      if (!engine) {
        panel.style.translate = "";
        if (scrim) scrim.style.opacity = "";
        return;
      }
      engine.animate(panel, { y: 0, opacity: 1 }, engine.profiles.sheet, {
        velocity: { y: Math.min(0, released.velocityY) }, persistTarget: true
      });
      if (scrim) engine.animate(scrim, { opacity: 1 }, engine.profiles.sheet, { persistTarget: true });
    };
    grabber.addEventListener("pointerup", finishDrag);
    grabber.addEventListener("pointercancel", finishDrag);
  }

  opener.setAttribute("aria-haspopup", "dialog");
  opener.setAttribute("aria-expanded", "false");
  opener.addEventListener("click", open);
  scrim?.addEventListener("click", close);
  closer?.addEventListener("click", close);
  sheet.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
    opener.setAttribute("aria-expanded", "false");
  }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !sheet.hidden) close();
    if (event.key === "Tab" && !sheet.hidden) {
      const focusable = Array.from(sheet.querySelectorAll('a[href], button:not([disabled])')).filter(el => el instanceof HTMLElement);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
})();
