// input.js - keyboard, mouse look, pointer lock, and the fallback that keeps
// the game playable when pointer lock is unavailable (headless browsers,
// sandboxed iframes). One job: turn raw device events into a clean per-tick
// input state. The simulation reads `down` (held) and `pressed` (edge, one
// tick only); the render loop never touches events directly.

export function createInput(canvas) {
  const down = new Set();
  const pressed = new Set();
  let lookDX = 0;
  let lookDY = 0;
  let firing = false;
  let ads = false;
  let locked = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onKeyDown = (e) => {
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };
  const onKeyUp = (e) => down.delete(e.code);

  const onMouseMove = (e) => {
    if (locked) {
      lookDX += e.movementX || 0;
      lookDY += e.movementY || 0;
      return;
    }
    // Drag-look fallback: hold the left button and drag to turn.
    if (dragging) {
      lookDX += (e.clientX - lastX) * 2.2;
      lookDY += (e.clientY - lastY) * 2.2;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  };

  const onMouseDown = (e) => {
    if (e.button === 0) {
      firing = true;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    if (e.button === 2) ads = true;
  };
  const onMouseUp = (e) => {
    if (e.button === 0) {
      firing = false;
      dragging = false;
    }
    if (e.button === 2) ads = false;
  };
  const onContext = (e) => e.preventDefault();

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
  };
  const onLockError = () => {
    // Pointer lock failed (headless, denied): the drag fallback above
    // already covers look, so nothing else has to happen.
    locked = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  return {
    down,
    pressed,
    get firing() { return firing; },
    get ads() { return ads; },
    get locked() { return locked; },
    // Ask for pointer lock on the canvas; a failure is silent by design.
    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_e) { /* drag fallback covers it */ }
    },
    // Arrow keys also turn the view, so the game is playable with no mouse.
    arrowLook() {
      let dx = 0;
      let dy = 0;
      if (down.has('ArrowLeft')) dx -= 3.2;
      if (down.has('ArrowRight')) dx += 3.2;
      if (down.has('ArrowUp')) dy -= 1.6;
      if (down.has('ArrowDown')) dy += 1.6;
      return { dx, dy };
    },
    // Take the accumulated look delta for this tick and clear it.
    consumeLook() {
      const out = { dx: lookDX, dy: lookDY };
      lookDX = 0;
      lookDY = 0;
      return out;
    },
    // Clear the one-tick edge set at the end of each fixed step.
    endTick() { pressed.clear(); },
    // Test hook: drive input without a device (headless play-test).
    testSet(code, isDown) {
      if (isDown) { down.add(code); pressed.add(code); }
      else down.delete(code);
    },
    testLook(dx, dy) { lookDX += dx; lookDY += dy; },
    testFire(isDown) { firing = isDown; },
  };
}
