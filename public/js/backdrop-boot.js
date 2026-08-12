// Boots the WebGL backdrop and wires the graphics toggle.
//
// Kept apart from lobby.js on purpose. This module imports Three.js from a CDN,
// and if that request fails - blocked network, offline laptop - the failure is
// contained here. lobby.js has no import of it and reaches the backdrop only
// through an optional global, so the lobby keeps working with no 3D at all.

import { createBackdrop } from './backdrop.js';
import { revealToggle } from './graphics.js';

const canvas = document.getElementById('backdrop');

if (canvas) {
  const backdrop = createBackdrop(canvas);

  if (backdrop) {
    window.keystoneBackdrop = backdrop;
    canvas.classList.add('is-live');
    // graphics.js owns the button's label and click behaviour; this only says
    // that something is now rendering, so the control governs something real.
    revealToggle();
  } else {
    // No WebGL context. Remove the canvas rather than leaving a dead black
    // rectangle, and leave the toggle hidden - it would govern nothing.
    canvas.remove();
  }
}
