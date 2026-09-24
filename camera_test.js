// ─────────────────────────────────────────────────────────────────────────────
// camera_test.js  –  MediaPipe Hands: landmark drawing + gesture detection
//
// Exposes detected gesture as window.cameraGesture (null or 0 / 1 / 2)
// so that index.html can read it for EMG auto-recording.
//
// Gestures detected (thumb tip vs. finger tip distance threshold):
//   Gesture 0 → thumb touching index  finger
//   Gesture 1 → thumb touching middle finger
//   Gesture 2 → thumb touching ring   finger
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Grab DOM elements ──────────────────────────────────────────────────────
const videoElement  = document.getElementById("input-video");
const canvasElement = document.getElementById("output-canvas");
const canvasCtx     = canvasElement.getContext("2d");

// Shared gesture state — read by index.html's gestureLoop() every frame
window.cameraGesture = null;

// ── 2. MediaPipe landmark indices we care about ───────────────────────────────
// Full landmark map: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
const THUMB_TIP  = 4;
const INDEX_TIP  = 8;
const MIDDLE_TIP = 12;
const RING_TIP   = 16;

// ── 3. Distance threshold (in normalised 0-1 coordinates) ─────────────────────
// If the distance between two landmarks is below this value we call it a "touch".
// You may need to tweak this value slightly depending on your camera / hand size.
const TOUCH_THRESHOLD = 0.07;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Euclidean distance between two MediaPipe landmarks
// Each landmark has .x and .y properties in the range [0, 1]
// ─────────────────────────────────────────────────────────────────────────────
function landmarkDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─────────────────────────────────────────────────────────────────────────────
// Gesture detection
// Returns 0, 1, 2 or null (no recognised gesture)
//
// Fix (was first-match): previously this checked index, then middle, then ring
// in a fixed order and returned on the first one under threshold. During a
// ring pinch the middle fingertip is often also within TOUCH_THRESHOLD of the
// thumb, so those frames were silently mislabeled as "middle" (gesture 1).
// Now all three distances are computed and the CLOSEST one under threshold
// wins, which matches what's actually happening in the hand.
//
// window.lastGestureDistances is also exposed (index/middle/ring, in
// normalised units) so saved sessions can be audited later if needed.
// ─────────────────────────────────────────────────────────────────────────────
function detectGesture(landmarks) {
  const thumb  = landmarks[THUMB_TIP];
  const index  = landmarks[INDEX_TIP];
  const middle = landmarks[MIDDLE_TIP];
  const ring   = landmarks[RING_TIP];

  const dIndex  = landmarkDistance(thumb, index);
  const dMiddle = landmarkDistance(thumb, middle);
  const dRing   = landmarkDistance(thumb, ring);

  window.lastGestureDistances = { index: dIndex, middle: dMiddle, ring: dRing };

  const candidates = [
    { gesture: 0, dist: dIndex },
    { gesture: 1, dist: dMiddle },
    { gesture: 2, dist: dRing },
  ].filter(c => c.dist < TOUCH_THRESHOLD);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].gesture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback called by MediaPipe every time a new frame is processed
// ─────────────────────────────────────────────────────────────────────────────
function onResults(results) {
  // -- Clear the canvas before drawing the new frame -------------------------
  canvasCtx.save();

  // Flip horizontally so the image acts like a mirror
  // (translate to right edge, then scale x by -1)
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.translate(canvasElement.width, 0);
  canvasCtx.scale(-1, 1);

  // Draw the camera frame onto the canvas
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

  // -- Draw landmarks if a hand was found ------------------------------------
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {

    // We only look at the first detected hand (index 0)
    const landmarks = results.multiHandLandmarks[0];

    // Draw the connections (bones) between landmarks
    drawConnectors(
      canvasCtx,
      landmarks,
      HAND_CONNECTIONS,          // built-in MediaPipe connection list
      { color: "#00FF00", lineWidth: 3 }
    );

    // Draw each landmark dot
    drawLandmarks(
      canvasCtx,
      landmarks,
      { color: "#FF0000", lineWidth: 1, radius: 4 }
    );

    // Detect the gesture and update shared state for index.html
    const gesture = detectGesture(landmarks);
    window.cameraGesture = gesture;

  } else {
    // No hand in frame
    window.cameraGesture = null;
  }

  canvasCtx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Initialise MediaPipe Hands
// ─────────────────────────────────────────────────────────────────────────────
const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
});

hands.setOptions({
  maxNumHands: 1,          // we only need one hand for now
  modelComplexity: 1,      // 0 = lite (faster), 1 = full (more accurate)
  minDetectionConfidence: 0.7,
  minTrackingConfidence:  0.5,
});

// Register our result handler
hands.onResults(onResults);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Start the webcam using MediaPipe Camera utility
//    This handles requesting camera permission + feeding frames to MediaPipe
// ─────────────────────────────────────────────────────────────────────────────
const camera = new Camera(videoElement, {
  onFrame: async () => {
    // Send each video frame to the MediaPipe Hands model
    await hands.send({ image: videoElement });
  },
  width:  640,
  height: 480,
});

camera.start();

// ─────────────────────────────────────────────────────────────────────────────
// That's it! Flow summary:
//   camera.start()  →  onFrame()  →  hands.send()  →  onResults()
//   onResults draws landmarks and calls detectGesture() on every frame
// ─────────────────────────────────────────────────────────────────────────────
