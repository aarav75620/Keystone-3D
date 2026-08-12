// Pointer parallax for the CSS 3D layer.
//
// Deliberately standalone - it imports nothing. If a locked-down school network
// blocks the Three.js CDN, the WebGL backdrop is gone but the panels still tilt
// and the UI still reads as dimensional. The cheap layer is the resilient one.
//
// Writes two custom properties on <html> and nothing else. All the actual
// transform maths lives in CSS, so this stays one rAF-throttled assignment per
// frame no matter how many elements react to it.

const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const target = { x: 0, y: 0 };
const current = { x: 0, y: 0 };

let frame = 0;
let settled = true;

function tick() {
  // Ease toward the pointer instead of tracking it exactly, so the panels feel
  // like they have mass rather than being welded to the cursor.
  current.x += (target.x - current.x) * 0.09;
  current.y += (target.y - current.y) * 0.09;

  root.style.setProperty('--pointer-x', current.x.toFixed(4));
  root.style.setProperty('--pointer-y', current.y.toFixed(4));

  const distance = Math.abs(target.x - current.x) + Math.abs(target.y - current.y);

  if (distance < 0.0008) {
    // Close enough to stop. Restarting on the next pointer move costs nothing
    // and this keeps an idle lobby at zero CPU.
    settled = true;
    frame = 0;
    return;
  }

  frame = requestAnimationFrame(tick);
}

function wake() {
  if (!settled) return;
  settled = false;
  frame = requestAnimationFrame(tick);
}

function onPointerMove(event) {
  if (reducedMotion.matches) return;
  target.x = (event.clientX / window.innerWidth) * 2 - 1;
  target.y = (event.clientY / window.innerHeight) * 2 - 1;
  wake();
}

function recentre() {
  target.x = 0;
  target.y = 0;
  wake();
}

window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerleave', recentre, { passive: true });
window.addEventListener('blur', recentre);

// Honour a mid-session change to the OS motion setting rather than only
// checking it once at load.
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    target.x = 0;
    target.y = 0;
    current.x = 0;
    current.y = 0;
    root.style.setProperty('--pointer-x', '0');
    root.style.setProperty('--pointer-y', '0');
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    settled = true;
  }
});

root.style.setProperty('--pointer-x', '0');
root.style.setProperty('--pointer-y', '0');
