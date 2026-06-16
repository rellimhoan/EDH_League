/* ==========================================================================
   STATE & CONSTANTS
   ========================================================================== */
const DEFAULT_MAIN_ITEMS = [
  "Cast your Commander 3+ times in a game",
  "Lose all life but win instead",
  "Control 6 or more Treasures",
  "Deal 21 Commander damage to an opponent",
  "Goad all creatures on the battlefield",
  "Cast a spell with Mana Value 8+",
  "Attack with 12 or more creatures",
  "Destroy 4+ non-land permanents in one turn",
  "Eliminate an opponent using Infect damage",
  "Draw 10+ cards in a single turn",
  "Gain 40 or more life in a single game",
  "Cast 4 or more spells in a single turn"
];

const DEFAULT_BONUS_ITEMS = [
  "★ WIN 20 LEAGUE POINTS ★",
  "★ GET A PHYSICAL BOOSTER PACK ★",
  "★ CHOOSE ANY CARD FROM YOUR BINDER ★",
  "★ NO COMMANDER TAX NEXT GAME ★",
  "★ TAKE AN EXTRA TURN IMMEDIATELY ★",
  "★ STEAL A RANDOM BASIC LAND ★",
  "★ FORWARD PASS A DAMAGE TRIGGER ★"
];

// Color Palette for Slices
const PALETTE = [
  "#ff007f", // Neon Magenta
  "#00f0ff", // Neon Cyan
  "#00ff66", // Neon Green
  "#9d00ff", // Neon Purple
  "#ff5e00", // Neon Orange
  "#0055ff", // Electric Blue
  "#ff0055"  // Red-Pink
];

const BONUS_COLOR = {
  bg: "#ffd700",      // Gold Background
  text: "#090611",    // Dark Purple Text
  glow: "#ffd700"
};

// Physics config
const FRICTION = 0.988; // Friction drag per frame (at 60fps)
const MIN_SPEED = 0.0015; // Speed at which the wheel stops

let state = {
  mainItems: [],
  bonusItems: [],
  volume: 0.5,
  soundEnabled: true,
  isSpinning: false,
  isBonusActive: false
};

// Web Audio API Instance
let audioCtx = null;
let soundEngine = null;

// Wheel instances & tracking
let mainWheel = {
  rotation: 0, // current angle in radians
  speed: 0,
  items: [],
  slices: [] // cached geometry
};

let bonusWheel = {
  rotation: 0,
  speed: 0,
  items: [],
  slices: []
};

// Pointer deflection spring physics
let pointer = {
  deflection: 0, // degrees
  velocity: 0,
  k: 0.25,       // spring constant
  damping: 0.15, // friction decay
  lastIndex: -1  // segment tracker for ticking
};

let particles = [];
let celebrationFrameId = null;
let activeLEDInterval = null;

/* ==========================================================================
   AUDIO SYNTH ENGINE (WEB AUDIO API)
   ========================================================================== */
class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(state.volume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  setVolume(volume) {
    if (this.masterGain) {
      this.masterGain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + 0.05);
    }
  }

  // Synthesize a quick sharp physical tick sound
  playTick(pitchFactor = 1.0) {
    if (!state.soundEnabled) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = "triangle";
    // Pitch sweep: starts high and goes low rapidly
    const startFreq = 800 * pitchFactor;
    const endFreq = 60 * pitchFactor;
    
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.04);

    gainNode.gain.setValueAtTime(0.35, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Happy ascending retro game show arpeggio
  playWinFanfare() {
    if (!state.soundEnabled) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C4, E4, G4, C5, E5, G5, C6
    
    notes.forEach((freq, index) => {
      const startTime = now + index * 0.085;
      const duration = 0.25;

      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(freq, startTime);

      gainNode.gain.setValueAtTime(0.12, startTime);
      gainNode.gain.linearRampToValueAtTime(0.12, startTime + duration - 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  // Synthesize huge sirens & retro air-horns for the Bonus Wheel landing!
  playBonusCelebration() {
    if (!state.soundEnabled) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;

    // 1. Air Horn blast (rich harmonics + square/saw detune)
    const playAirHorn = (delay, length) => {
      const frequencies = [160, 240, 320, 480]; // Major triad structure for the blast
      frequencies.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, now + delay);
        osc.frequency.setValueAtTime(freq * 1.01, now + delay + length * 0.5); // minor drift

        gainNode.gain.setValueAtTime(0, now + delay);
        gainNode.gain.linearRampToValueAtTime(0.18, now + delay + 0.05);
        gainNode.gain.setValueAtTime(0.18, now + delay + length - 0.1);
        gainNode.gain.linearRampToValueAtTime(0, now + delay + length);

        osc.connect(gainNode);
        gainNode.connect(this.masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + length);
      });
    };

    // 2. Siren Sweep (Oscillating pitch LFO)
    const playSiren = (delay, length) => {
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gainNode = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(600, now + delay);

      lfo.frequency.setValueAtTime(5, now + delay); // Vibrato speed 5Hz
      lfoGain.gain.setValueAtTime(150, now + delay); // Sweep range

      gainNode.gain.setValueAtTime(0, now + delay);
      gainNode.gain.linearRampToValueAtTime(0.15, now + delay + 0.1);
      gainNode.gain.setValueAtTime(0.15, now + delay + length - 0.2);
      gainNode.gain.linearRampToValueAtTime(0, now + delay + length);

      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(gainNode);
      gainNode.connect(this.masterGain);

      lfo.start(now + delay);
      osc.start(now + delay);
      lfo.stop(now + delay + length);
      osc.stop(now + delay + length);
    };

    // 3. Firework Explosion Pop (White noise filtered)
    const playExplosion = (delay) => {
      const bufferSize = this.ctx.sampleRate * 0.8; // 0.8 seconds
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      // Populate with random white noise
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;

      // Filter to make it sound beefier (lowpass)
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1000, now + delay);
      filter.frequency.exponentialRampToValueAtTime(100, now + delay + 0.5);

      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(0.5, now + delay);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.6);

      noiseNode.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      noiseNode.start(now + delay);
      noiseNode.stop(now + delay + 0.7);
    };

    // Trigger sequential show effects!
    playAirHorn(0, 1.2);
    playSiren(0.2, 2.5);
    playExplosion(0);
    playExplosion(0.4);
    playExplosion(0.8);
    playAirHorn(1.5, 1.5);
  }

  // Button clicks
  playClick() {
    if (!state.soundEnabled) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.setValueAtTime(200, now + 0.03);

    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.linearRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.06);
  }
}

function initAudio() {
  if (!audioCtx) {
    soundEngine = new AudioEngine();
    audioCtx = soundEngine.ctx;
  }
}

/* ==========================================================================
   STATE LOADING & SYNCHRONIZATION
   ========================================================================== */
function loadState() {
  const savedMain = localStorage.getItem("mtg_wheel_main");
  const savedBonus = localStorage.getItem("mtg_wheel_bonus");
  const savedVol = localStorage.getItem("mtg_wheel_vol");
  const savedSnd = localStorage.getItem("mtg_wheel_snd");

  state.mainItems = savedMain ? JSON.parse(savedMain) : [...DEFAULT_MAIN_ITEMS];
  state.bonusItems = savedBonus ? JSON.parse(savedBonus) : [...DEFAULT_BONUS_ITEMS];
  state.volume = savedVol !== null ? parseFloat(savedVol) : 0.5;
  state.soundEnabled = savedSnd !== null ? savedSnd === "true" : true;

  // Sync to inputs
  document.getElementById("volume-slider").value = Math.round(state.volume * 100);
  document.getElementById("sound-toggle").checked = state.soundEnabled;
}

function saveState() {
  localStorage.setItem("mtg_wheel_main", JSON.stringify(state.mainItems));
  localStorage.setItem("mtg_wheel_bonus", JSON.stringify(state.bonusItems));
  localStorage.setItem("mtg_wheel_vol", state.volume);
  localStorage.setItem("mtg_wheel_snd", state.soundEnabled);
}

function populateConfigLists() {
  const mainList = document.getElementById("main-items-list");
  const bonusList = document.getElementById("bonus-items-list");

  mainList.innerHTML = "";
  bonusList.innerHTML = "";

  // Populate main list (with permanent Bonus segment visible but undeletable)
  state.mainItems.forEach((item, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${item}</span>
      <button class="delete-item-btn" onclick="deleteMainItem(${index})">🗑️</button>
    `;
    mainList.appendChild(li);
  });

  // Display permanent bonus wheel segment as a static helper at the bottom
  const bonusLi = document.createElement("li");
  bonusLi.style.border = "1px dashed var(--neon-gold)";
  bonusLi.style.background = "rgba(255,215,0,0.08)";
  bonusLi.innerHTML = `
    <span style="color:var(--neon-gold); font-weight:700;">★ SUPER AWESOME BONUS WHEEL ★</span>
    <span style="font-size: 0.7rem; color: #888; padding: 2px 6px;">PERMANENT</span>
  `;
  mainList.appendChild(bonusLi);

  // Populate bonus list
  state.bonusItems.forEach((item, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${item}</span>
      <button class="delete-item-btn" onclick="deleteBonusItem(${index})">🗑️</button>
    `;
    bonusList.appendChild(li);
  });
}

// Global functions for list management (called from inline onclick)
window.deleteMainItem = function(index) {
  initAudio();
  soundEngine.playClick();
  state.mainItems.splice(index, 1);
  saveState();
  populateConfigLists();
  calculateWheelGeometry();
  drawWheel(mainWheel, "main-wheel-canvas");
};

window.deleteBonusItem = function(index) {
  initAudio();
  soundEngine.playClick();
  state.bonusItems.splice(index, 1);
  saveState();
  populateConfigLists();
  calculateWheelGeometry();
  drawWheel(bonusWheel, "bonus-wheel-canvas");
};

/* ==========================================================================
   WHEEL GEOMETRY & MATH
   ========================================================================== */
function calculateWheelGeometry() {
  // 1. Calculate Main Wheel Geometry
  // Permanent Bonus segment has 15 degrees (~0.2618 radians)
  const bonusAngle = (15 * Math.PI) / 180;
  const remainingAngle = 2 * Math.PI - bonusAngle;
  const numMain = state.mainItems.length;
  const mainAngle = numMain > 0 ? remainingAngle / numMain : remainingAngle;

  mainWheel.slices = [];
  let currentAngle = 0;

  // Add custom main items
  if (numMain > 0) {
    state.mainItems.forEach((item, i) => {
      const start = currentAngle;
      const end = currentAngle + mainAngle;
      mainWheel.slices.push({
        text: item,
        start: start,
        end: end,
        color: PALETTE[i % PALETTE.length],
        isBonus: false
      });
      currentAngle = end;
    });
  } else {
    // Fallback if list is empty
    mainWheel.slices.push({
      text: "No items! Add some in panel ⚙️",
      start: 0,
      end: remainingAngle,
      color: "#333333",
      isBonus: false
    });
    currentAngle = remainingAngle;
  }

  // Add the permanent Bonus segment at the end
  mainWheel.slices.push({
    text: "★ BONUS WHEEL ★",
    start: currentAngle,
    end: currentAngle + bonusAngle,
    color: BONUS_COLOR.bg,
    isBonus: true
  });

  // 2. Calculate Bonus Wheel Geometry (Equal subdivisions of all items)
  const numBonus = state.bonusItems.length;
  const angleBonus = numBonus > 0 ? (2 * Math.PI) / numBonus : 2 * Math.PI;

  bonusWheel.slices = [];
  currentAngle = 0;
  if (numBonus > 0) {
    state.bonusItems.forEach((item, i) => {
      const start = currentAngle;
      const end = currentAngle + angleBonus;
      bonusWheel.slices.push({
        text: item,
        start: start,
        end: end,
        color: i % 2 === 0 ? "#110800" : "#2d1803", // alternating luxury carbon/gold segments
        isBonus: true
      });
      currentAngle = end;
    });
  } else {
    bonusWheel.slices.push({
      text: "No rare rewards! Add some in panel ⚙️",
      start: 0,
      end: 2 * Math.PI,
      color: "#222222",
      isBonus: true
    });
  }
}

/* ==========================================================================
   CANVAS RENDERING
   ========================================================================== */
function drawWheel(wheelState, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const radius = width / 2;
  const center = radius;

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(wheelState.rotation);

  const slices = wheelState.slices;

  slices.forEach((slice) => {
    // 1. Draw segment path
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius - 8, slice.start, slice.end);
    ctx.closePath();

    ctx.fillStyle = slice.color;
    ctx.fill();

    // Border line inside wheel
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.stroke();

    // Neon highlight for special Bonus slice
    if (slice.isBonus && canvasId === "main-wheel-canvas") {
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.stroke();
    }

    // 2. Draw text inside segment
    ctx.save();
    const midAngle = slice.start + (slice.end - slice.start) / 2;
    ctx.rotate(midAngle);

    // Font settings: dynamically scaled to canvas radius (enlarged for maximum legibility)
    const fontSize = Math.max(12, Math.round(radius * 0.042));
    const bonusFontSize = Math.max(11, Math.round(radius * 0.036));
    ctx.font = `900 ${slice.isBonus ? bonusFontSize : fontSize}px 'Inter', sans-serif`;
    ctx.fillStyle = slice.isBonus && canvasId === "main-wheel-canvas" ? BONUS_COLOR.text : "#ffffff";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    // Text wrapping or scaling for narrow slices
    let text = slice.text;
    const textRadius = radius - Math.max(25, Math.round(radius * 0.1));

    // If it's a bonus segment on the main wheel, let's format it with a glowing look
    if (slice.isBonus && canvasId === "main-wheel-canvas") {
      ctx.font = `900 ${bonusFontSize}px 'Inter', sans-serif`;
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 4;
    }

    // Wrap and draw text lines to fit inside pie segment
    const maxTextWidth = radius * 0.52;
    const lineHeight = Math.max(13, Math.round(fontSize * 1.15));
    const useStroke = !(slice.isBonus && canvasId === "main-wheel-canvas");
    wrapSegmentText(ctx, text, textRadius, maxTextWidth, lineHeight, useStroke);

    ctx.restore();
  });

  // 3. Draw outer divider pins (pegs) for indicator to hit
  slices.forEach((slice) => {
    ctx.save();
    ctx.rotate(slice.start);
    ctx.beginPath();
    ctx.arc(radius - 12, 0, 4, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  });

  ctx.restore();

  // 4. Draw Center Cap (Hub)
  ctx.beginPath();
  ctx.arc(center, center, 32, 0, 2 * Math.PI);
  // Gold vs Cyan hub theme
  if (canvasId === "main-wheel-canvas") {
    ctx.fillStyle = "#090611";
    ctx.strokeStyle = "var(--neon-magenta)";
  } else {
    ctx.fillStyle = "#0f0800";
    ctx.strokeStyle = "var(--neon-gold)";
  }
  ctx.lineWidth = 5;
  ctx.fill();
  ctx.stroke();

  // Center glass dome shine
  const shineGrad = ctx.createRadialGradient(center - 8, center - 8, 2, center, center, 28);
  shineGrad.addColorStop(0, "rgba(255,255,255,0.45)");
  shineGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shineGrad;
  ctx.beginPath();
  ctx.arc(center, center, 28, 0, 2 * Math.PI);
  ctx.fill();
}

// Draw wrapped text inside narrow pie slices
function wrapSegmentText(ctx, text, startX, maxWidth, lineHeight, useStroke) {
  const words = text.split(" ");
  let lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);

  // Draw lines starting from outer radius inward
  const numLines = lines.length;
  lines.forEach((line, index) => {
    const yOffset = (index - (numLines - 1) / 2) * lineHeight;
    if (useStroke) {
      ctx.save();
      ctx.strokeStyle = "#090611"; // high-contrast dark border outline
      ctx.lineWidth = 4.5;
      ctx.lineJoin = "round";
      ctx.strokeText(line, startX, yOffset);
      ctx.restore();
    }
    ctx.fillText(line, startX, yOffset);
  });
}

/* ==========================================================================
   PHYSICS PHYSICS & TICK COLLISION DETECTION
   ========================================================================== */
function updatePointerSpring(wheelState, numSlices) {
  const pointerElement = document.getElementById(
    state.isBonusActive ? "bonus-wheel-overlay" : "wheel-pointer"
  );
  const pointerObj = document.querySelector(
    state.isBonusActive ? ".gold-pointer" : ".wheel-pointer"
  );

  // Normalize current rotation to [0, 2PI)
  const totalRotation = wheelState.rotation % (2 * Math.PI);
  
  // The physical pointer is at 12 o'clock (-PI/2 radians).
  // Position of pointer relative to the spinning wheel (moving opposite direction):
  const pointerAngle = (2.5 * Math.PI - totalRotation) % (2 * Math.PI);

  // Determine current active slice index
  let activeIndex = -1;
  const slices = wheelState.slices;
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    if (pointerAngle >= slice.start && pointerAngle < slice.end) {
      activeIndex = i;
      break;
    }
  }

  // Trigger deflection on boundary crossing (whenever the slice index changes)
  if (activeIndex !== pointer.lastIndex && pointer.lastIndex !== -1) {
    // Determine spin direction. Typically clockwise (positive speed)
    if (wheelState.speed > 0) {
      // Deflect the pointer to the left (negative degrees)
      pointer.deflection = -24 * Math.min(1.0, wheelState.speed * 4);
    } else if (wheelState.speed < 0) {
      // Deflect to the right
      pointer.deflection = 24 * Math.min(1.0, Math.abs(wheelState.speed) * 4);
    }
    // Play tick sound, modulating frequency based on current speed
    soundEngine.playTick(Math.max(0.7, Math.min(1.6, wheelState.speed * 8)));
  }
  pointer.lastIndex = activeIndex;

  // Run spring simulation: F = -kx - cv
  const springForce = -pointer.k * pointer.deflection;
  const dampingForce = -pointer.damping * pointer.velocity;
  const acc = springForce + dampingForce;
  
  pointer.velocity += acc;
  pointer.deflection += pointer.velocity;

  // Apply deflection style to the DOM node
  if (pointerObj) {
    pointerObj.style.transform = `translateX(-50%) rotate(${pointer.deflection}deg)`;
  }
}

/* ==========================================================================
   SPINNING ACTIONS
   ========================================================================== */
function spinMainWheel() {
  if (state.isSpinning) return;
  initAudio();
  soundEngine.playClick();

  // Reset display banner
  const readout = document.getElementById("scoreboard-readout");
  readout.classList.remove("win-flash", "bonus-flash");
  readout.textContent = "SPINNING... PLACE YOUR BETS!";

  // Disable controls
  state.isSpinning = true;
  document.getElementById("spin-main-btn").disabled = true;
  document.getElementById("open-drawer-btn").disabled = true;
  document.getElementById("reset-defaults-btn").disabled = true;

  // Give initial kick
  mainWheel.speed = 0.28 + Math.random() * 0.16; // Radians per frame
  pointer.lastIndex = -1;

  animateMainSpin();
}

function animateMainSpin() {
  if (!state.isSpinning) return;

  // Apply friction
  mainWheel.speed *= FRICTION;
  mainWheel.rotation += mainWheel.speed;

  // Render and update physics wiggles
  drawWheel(mainWheel, "main-wheel-canvas");
  updatePointerSpring(mainWheel, mainWheel.slices.length);

  // Stop condition
  if (mainWheel.speed < MIN_SPEED) {
    mainWheel.speed = 0;
    state.isSpinning = false;
    processMainLanding();
  } else {
    requestAnimationFrame(animateMainSpin);
  }
}

function processMainLanding() {
  // Find which slice aligned at the top pointer (90 deg or 1.5 * PI)
  const totalRotation = mainWheel.rotation % (2 * Math.PI);
  const pointerAngle = (2.5 * Math.PI - totalRotation) % (2 * Math.PI);
  
  let winner = mainWheel.slices.find(slice => pointerAngle >= slice.start && pointerAngle < slice.end);
  if (!winner) winner = mainWheel.slices[0]; // fallback safety

  const readout = document.getElementById("scoreboard-readout");

  if (winner.isBonus) {
    // 1. Landing on the Super Awesome Bonus Wheel!
    readout.classList.add("bonus-flash");
    readout.textContent = "★ LANDED ON BONUS WHEEL! ★";
    
    // Trigger intense sound, shake screen and firework burst
    soundEngine.playBonusCelebration();
    document.body.classList.add("screenshake");
    startCelebrationLoop("bonus");

    setTimeout(() => {
      document.body.classList.remove("screenshake");
      openBonusOverlay();
    }, 1800);
  } else {
    // 2. Standard landing challenge/points
    readout.classList.add("win-flash");
    readout.textContent = `LANDED ON: ${winner.text}`;
    soundEngine.playWinFanfare();
    startCelebrationLoop("normal");

    // Enable buttons
    document.getElementById("spin-main-btn").disabled = false;
    document.getElementById("open-drawer-btn").disabled = false;
    document.getElementById("reset-defaults-btn").disabled = false;
  }
}

// ----------------------------------------------------
// Bonus Spin
// ----------------------------------------------------
function spinBonusWheel() {
  if (state.isSpinning) return;
  initAudio();
  soundEngine.playClick();

  const readout = document.getElementById("bonus-scoreboard-readout");
  readout.textContent = "SPINNING FOR GLORY...";

  state.isSpinning = true;
  document.getElementById("spin-bonus-btn").disabled = true;
  document.getElementById("close-bonus-btn").disabled = true;

  bonusWheel.speed = 0.28 + Math.random() * 0.16;
  pointer.lastIndex = -1;

  animateBonusSpin();
}

function animateBonusSpin() {
  if (!state.isSpinning) return;

  bonusWheel.speed *= FRICTION;
  bonusWheel.rotation += bonusWheel.speed;

  drawWheel(bonusWheel, "bonus-wheel-canvas");
  updatePointerSpring(bonusWheel, bonusWheel.slices.length);

  if (bonusWheel.speed < MIN_SPEED) {
    bonusWheel.speed = 0;
    state.isSpinning = false;
    processBonusLanding();
  } else {
    requestAnimationFrame(animateBonusSpin);
  }
}

function processBonusLanding() {
  const totalRotation = bonusWheel.rotation % (2 * Math.PI);
  const pointerAngle = (2.5 * Math.PI - totalRotation) % (2 * Math.PI);
  
  let winner = bonusWheel.slices.find(slice => pointerAngle >= slice.start && pointerAngle < slice.end);
  if (!winner) winner = bonusWheel.slices[0];

  const readout = document.getElementById("bonus-scoreboard-readout");
  readout.innerHTML = `<span class="neon-rainbow">${winner.text}</span>`;
  
  // Extra fanfare
  soundEngine.playWinFanfare();
  startCelebrationLoop("bonus");

  // Enable close return button
  const closeBtn = document.getElementById("close-bonus-btn");
  closeBtn.disabled = false;
  closeBtn.classList.remove("disabled-btn");
}

/* ==========================================================================
   BONUS MODAL DRAWERS
   ========================================================================== */
function openBonusOverlay() {
  state.isBonusActive = true;
  const overlay = document.getElementById("bonus-wheel-overlay");
  overlay.classList.remove("hidden");

  // Reset values
  document.getElementById("bonus-scoreboard-readout").textContent = "SPIN FOR RARE REWARDS!";
  document.getElementById("spin-bonus-btn").disabled = false;
  
  const closeBtn = document.getElementById("close-bonus-btn");
  closeBtn.disabled = true;
  closeBtn.classList.add("disabled-btn");

  // Re-draw bonus wheel shape
  calculateWheelGeometry();
  drawWheel(bonusWheel, "bonus-wheel-canvas");
}

function closeBonusOverlay() {
  initAudio();
  soundEngine.playClick();
  
  state.isBonusActive = false;
  const overlay = document.getElementById("bonus-wheel-overlay");
  overlay.classList.add("hidden");

  // Re-enable main board
  document.getElementById("spin-main-btn").disabled = false;
  document.getElementById("open-drawer-btn").disabled = false;
  document.getElementById("reset-defaults-btn").disabled = false;

  stopCelebrationLoop();
  
  // Draw main wheel back
  drawWheel(mainWheel, "main-wheel-canvas");
}

/* ==========================================================================
   CELEBRATION CANVAS EFFECT (FIREWORKS & CONFETTI)
   ========================================================================== */
class Particle {
  constructor(x, y, color, isFireworkShell = false) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.isShell = isFireworkShell;
    
    if (this.isShell) {
      // Launch parameters
      this.vx = (Math.random() - 0.5) * 4;
      this.vy = -12 - Math.random() * 6;
      this.radius = 4;
      this.alpha = 1;
      this.decay = 0;
    } else {
      // Exploded spark parameters
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.radius = Math.random() * 3 + 1;
      this.alpha = 1;
      this.decay = 0.01 + Math.random() * 0.02; // lifespan decay
      this.gravity = 0.16;
    }
  }

  update() {
    if (this.isShell) {
      this.x += this.vx;
      this.y += this.vy;
      // Fade out slowly near peak apex
      if (this.vy >= -2) {
        this.decay = 1; // force explosion trigger
      }
      this.vy += 0.18; // gravity
    } else {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += this.gravity;
      this.alpha -= this.decay;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
    ctx.fillStyle = this.color;
    // Glow effect for sparks
    ctx.shadowColor = this.color;
    ctx.shadowBlur = this.isShell ? 0 : 8;
    ctx.fill();
    ctx.restore();
  }
}

class ConfettiParticle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.w = Math.random() * 7 + 4;
    this.h = Math.random() * 12 + 6;
    this.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.vx = (Math.random() - 0.5) * 3;
    this.vy = Math.random() * 4 + 2;
    this.rotation = Math.random() * 360;
    this.rotationSpeed = (Math.random() - 0.5) * 10;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotationSpeed;
    this.vy += 0.03; // terminal velocity gravity
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

function startCelebrationLoop(type) {
  stopCelebrationLoop();
  particles = [];
  const canvas = document.getElementById("celebration-canvas");
  const ctx = canvas.getContext("2d");
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Spawning celebration particles
    if (type === "bonus") {
      // Launch fireworks shells at random times
      if (Math.random() < 0.05) {
        const shellX = Math.random() * canvas.width * 0.6 + canvas.width * 0.2;
        const col = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        particles.push(new Particle(shellX, canvas.height, col, true));
      }
    } else {
      // Spawning confetti
      if (particles.length < 80 && Math.random() < 0.35) {
        particles.push(new ConfettiParticle(Math.random() * canvas.width, -20));
      }
    }

    // Process update and drawing
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.update();
      p.draw(ctx);

      // Handle Firework Shell Explosion
      if (p.isShell && p.decay >= 1) {
        // Explode: remove shell and create sparks
        particles.splice(i, 1);
        const sparkCount = 35 + Math.floor(Math.random() * 20);
        for (let s = 0; s < sparkCount; s++) {
          particles.push(new Particle(p.x, p.y, p.color, false));
        }
        continue;
      }

      // Remove faded out particles or off-screen confetti
      if (p.alpha <= 0 || p.y > canvas.height + 20) {
        particles.splice(i, 1);
      }
    }

    celebrationFrameId = requestAnimationFrame(loop);
  }

  loop();
}

function stopCelebrationLoop() {
  if (celebrationFrameId) {
    cancelAnimationFrame(celebrationFrameId);
    celebrationFrameId = null;
  }
  const canvas = document.getElementById("celebration-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  particles = [];
}

/* ==========================================================================
   LED CHASING LIGHT SYSTEM
   ========================================================================== */
function setupLEDLights() {
  const outerRing = document.getElementById("led-outer-ring");
  const bonusRing = document.getElementById("bonus-led-ring");
  
  createLEDs(outerRing, 28);
  createLEDs(bonusRing, 20);

  startLEDChase("idle");
}

function createLEDs(container, count) {
  if (!container) return;
  container.innerHTML = "";
  
  const radius = 50; // percentage based radius
  for (let i = 0; i < count; i++) {
    const angle = (i * 360 / count) * Math.PI / 180;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);

    const bulb = document.createElement("div");
    bulb.className = "led-bulb";
    bulb.style.left = `${x}%`;
    bulb.style.top = `${y}%`;
    container.appendChild(bulb);
  }
}

function startLEDChase(mode) {
  if (activeLEDInterval) clearInterval(activeLEDInterval);

  let tick = 0;
  const delay = mode === "spin" ? 60 : mode === "celebrate" ? 120 : 400;

  activeLEDInterval = setInterval(() => {
    tick++;
    const bulbs = document.querySelectorAll(".led-bulb");
    
    bulbs.forEach((bulb, index) => {
      // Reset classes
      bulb.className = "led-bulb";

      if (mode === "celebrate") {
        // Fast flashing party patterns
        const patternIndex = (index + tick) % 3;
        if (patternIndex === 0) bulb.classList.add("active-a");
        else if (patternIndex === 1) bulb.classList.add("active-b");
        else bulb.classList.add("active-c");
      } else if (mode === "spin") {
        // Chasing tail pattern
        const chaser = (index - tick) % 8;
        if (chaser === 0) bulb.classList.add("active-c");
        else if (chaser === 1 || chaser === -7) bulb.classList.add("active-a");
        else if (chaser === 2 || chaser === -6) bulb.classList.add("active-b");
      } else {
        // Slow Alternating Idle pattern
        const isEven = index % 2 === 0;
        const cycle = tick % 2 === 0;
        if (isEven === cycle) {
          bulb.classList.add("active-a");
        } else {
          bulb.classList.add("active-b");
        }
      }
    });
  }, delay);
}

/* ==========================================================================
   UI HANDLERS & INITIALIZATION
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  // 1. Initial Load
  loadState();
  calculateWheelGeometry();
  setupLEDLights();

  // Draw initial canvases
  drawWheel(mainWheel, "main-wheel-canvas");
  drawWheel(bonusWheel, "bonus-wheel-canvas");
  populateConfigLists();

  // 2. Event Listeners
  // Drawer Open/Close toggle
  document.getElementById("open-drawer-btn").addEventListener("click", () => {
    initAudio();
    soundEngine.playClick();
    document.getElementById("config-drawer").classList.add("open");
  });

  document.getElementById("close-drawer-btn").addEventListener("click", () => {
    initAudio();
    soundEngine.playClick();
    document.getElementById("config-drawer").classList.remove("open");
  });

  // Tabs toggle supporting Main, Bonus, and Sync
  const tabs = ["main", "bonus", "sync"];
  tabs.forEach(tab => {
    const btn = document.getElementById(`tab-${tab}-btn`);
    if (btn) {
      btn.addEventListener("click", () => {
        initAudio();
        soundEngine.playClick();
        tabs.forEach(t => {
          document.getElementById(`tab-${t}-btn`).classList.toggle("active", t === tab);
          document.getElementById(`tab-${t}-content`).classList.toggle("active", t === tab);
        });
      });
    }
  });

  // Export configuration (JSON download)
  document.getElementById("export-config-btn").addEventListener("click", () => {
    initAudio();
    soundEngine.playClick();

    const configData = {
      mainItems: state.mainItems,
      bonusItems: state.bonusItems
    };

    const blob = new Blob([JSON.stringify(configData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `edh_wheel_config_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  // Import configuration file selection
  const importInput = document.getElementById("import-file-input");
  const importName = document.getElementById("import-file-name");
  const importApplyBtn = document.getElementById("import-config-btn");

  importInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      importName.textContent = e.target.files[0].name;
      importApplyBtn.style.display = "block";
    } else {
      importName.textContent = "No file chosen";
      importApplyBtn.style.display = "none";
    }
  });

  // Apply imported configuration
  importApplyBtn.addEventListener("click", () => {
    initAudio();
    const file = importInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        
        // Validate imported schema
        if (Array.isArray(importedData.mainItems) && Array.isArray(importedData.bonusItems)) {
          state.mainItems = importedData.mainItems;
          state.bonusItems = importedData.bonusItems;

          saveState();
          calculateWheelGeometry();
          drawWheel(mainWheel, "main-wheel-canvas");
          drawWheel(bonusWheel, "bonus-wheel-canvas");
          populateConfigLists();

          soundEngine.playWinFanfare();
          alert("Import successful! Your custom wheel config has been loaded.");

          // Reset upload form
          importInput.value = "";
          importName.textContent = "No file chosen";
          importApplyBtn.style.display = "none";
        } else {
          throw new Error("Invalid structure. Missing mainItems or bonusItems array.");
        }
      } catch (err) {
        soundEngine.playClick();
        alert(`Import Error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });

  // Add Item Forms
  document.getElementById("add-main-item-form").addEventListener("submit", (e) => {
    e.preventDefault();
    initAudio();
    const input = document.getElementById("new-main-item");
    const val = input.value.trim();
    if (val) {
      soundEngine.playClick();
      state.mainItems.push(val);
      input.value = "";
      saveState();
      populateConfigLists();
      calculateWheelGeometry();
      drawWheel(mainWheel, "main-wheel-canvas");
    }
  });

  document.getElementById("add-bonus-item-form").addEventListener("submit", (e) => {
    e.preventDefault();
    initAudio();
    const input = document.getElementById("new-bonus-item");
    const val = input.value.trim();
    if (val) {
      soundEngine.playClick();
      state.bonusItems.push(val);
      input.value = "";
      saveState();
      populateConfigLists();
      calculateWheelGeometry();
      drawWheel(bonusWheel, "bonus-wheel-canvas");
    }
  });

  // Settings Controls
  document.getElementById("volume-slider").addEventListener("input", (e) => {
    state.volume = parseFloat(e.target.value) / 100;
    saveState();
    if (soundEngine) {
      soundEngine.setVolume(state.volume);
    }
  });

  document.getElementById("sound-toggle").addEventListener("change", (e) => {
    state.soundEnabled = e.target.checked;
    saveState();
    initAudio();
    soundEngine.playClick();
  });

  document.getElementById("reset-defaults-btn").addEventListener("click", () => {
    if (confirm("Are you sure you want to reset all configurations to defaults?")) {
      initAudio();
      soundEngine.playClick();
      state.mainItems = [...DEFAULT_MAIN_ITEMS];
      state.bonusItems = [...DEFAULT_BONUS_ITEMS];
      saveState();
      populateConfigLists();
      calculateWheelGeometry();
      drawWheel(mainWheel, "main-wheel-canvas");
      drawWheel(bonusWheel, "bonus-wheel-canvas");
    }
  });

  // Spin Actions
  document.getElementById("spin-main-btn").addEventListener("click", () => {
    spinMainWheel();
    startLEDChase("spin");
  });

  document.getElementById("spin-bonus-btn").addEventListener("click", () => {
    spinBonusWheel();
    startLEDChase("spin");
  });

  document.getElementById("close-bonus-btn").addEventListener("click", () => {
    closeBonusOverlay();
    startLEDChase("idle");
  });

  document.getElementById("force-bonus-btn").addEventListener("click", () => {
    // Close the drawer first so the user sees the celebration on the main screen
    document.getElementById("config-drawer").classList.remove("open");

    initAudio();
    soundEngine.playClick();

    // Reset spin states in case wheel was active
    state.isSpinning = false;
    mainWheel.speed = 0;

    // Trigger the landing sequence directly
    const readout = document.getElementById("scoreboard-readout");
    readout.classList.remove("win-flash");
    readout.classList.add("bonus-flash");
    readout.textContent = "★ FORCED BONUS WHEEL! ★";

    soundEngine.playBonusCelebration();
    document.body.classList.add("screenshake");
    startCelebrationLoop("bonus");
    startLEDChase("celebrate");

    setTimeout(() => {
      document.body.classList.remove("screenshake");
      openBonusOverlay();
    }, 1800);
  });

  // Handle browser resize for particle canvas
  window.addEventListener("resize", () => {
    const canvas = document.getElementById("celebration-canvas");
    if (canvas && celebrationFrameId) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
  });
});
