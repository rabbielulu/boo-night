(() => {
  "use strict";

  const canvas = document.querySelector("#world");
  const ctx = canvas.getContext("2d", { alpha: false });
  const moonButton = document.querySelector("#moonButton");
  const soundButton = document.querySelector("#soundButton");
  const magicButton = document.querySelector("#magicButton");
  const parentButton = document.querySelector("#parentButton");
  const parentDialog = document.querySelector("#parentDialog");
  const sleepCurtain = document.querySelector("#sleepCurtain");
  const sleepGhostCanvas = document.querySelector("#sleepGhost");
  const wakeButton = document.querySelector("#wakeButton");
  const toast = document.querySelector("#toast");

  const TAU = Math.PI * 2;
  const pointerMap = new Map();
  const ghosts = [];
  const particles = [];
  const stars = [];
  const clouds = [];
  const ghostSprites = new Map();
  const GHOST_SPRITE_ATLAS = "./assets/ghosts/expression-sheet.png";
  const SLEEP_GHOST_ASSET = "./assets/ghosts/sleeping.png";
  const GHOST_SPRITE_FRAMES = {
    laugh: { x: 42, y: 52, width: 440, height: 400 },
    shy: { x: 528, y: 52, width: 450, height: 400, keepComponents: 3 },
    surprised: { x: 1018, y: 52, width: 450, height: 400 },
    spinning: { x: 42, y: 525, width: 440, height: 395 },
    sleepy: { x: 528, y: 525, width: 450, height: 395 },
    cheeky: { x: 1018, y: 525, width: 450, height: 395 },
  };
  const SOUND_ASSETS = {
    touch: ["./assets/audio/touch-1.wav", "./assets/audio/touch-2.wav"],
    shy: ["./assets/audio/shy.wav"],
    bump: ["./assets/audio/bump-1.wav", "./assets/audio/bump-2.wav"],
    whoosh: ["./assets/audio/whoosh.wav"],
    appear: ["./assets/audio/appear.wav"],
    pop: ["./assets/audio/pop.wav"],
    magic: ["./assets/audio/magic.wav"],
    bubble: ["./assets/audio/bubble.wav"],
    moon: ["./assets/audio/moon.wav"],
  };
  const SOUND_LEVELS = {
    touch: 0.16,
    shy: 0.14,
    bump: 0.09,
    whoosh: 0.11,
    appear: 0.14,
    pop: 0.14,
    magic: 0.13,
    bubble: 0.13,
    moon: 0.11,
  };
  const SOUND_COOLDOWNS = {
    touch: 45,
    shy: 120,
    bump: 90,
    whoosh: 180,
    appear: 120,
    pop: 120,
    magic: 180,
    bubble: 180,
    moon: 180,
  };
  const soundBuffers = new Map();
  const lastSoundTimes = new Map();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastTime = performance.now();
  let worldTime = 0;
  let lightOn = false;
  let soundOn = localStorage.getItem("boo-sound") !== "off";
  let sleeping = false;
  let playStartedAt = Date.now();
  let restMinutes = Number(localStorage.getItem("boo-rest") ?? 10);
  let audioContext = null;
  let soundLoadPromise = null;
  let parentHoldTimer = 0;
  let toastTimer = 0;
  let magicIndex = 0;
  let lastSkyTap = { time: 0, x: 0, y: 0 };
  let spotlight = { x: 0, y: 0 };
  let motionPermissionRequested = false;
  let motionListening = false;
  let lastMotionSample = null;
  let lastShakeAt = 0;
  let dizzyTimer = 0;

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function extractCleanSprite(image, frame) {
    const surface = document.createElement("canvas");
    surface.width = frame.width;
    surface.height = frame.height;
    const surfaceContext = surface.getContext("2d", { willReadFrequently: true });
    surfaceContext.drawImage(
      image,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );

    const pixels = surfaceContext.getImageData(0, 0, surface.width, surface.height);
    const data = pixels.data;
    const pixelCount = surface.width * surface.height;
    const background = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let head = 0;
    let tail = 0;

    const enqueueBackground = (pixelIndex) => {
      if (background[pixelIndex]) return;
      background[pixelIndex] = 1;
      queue[tail] = pixelIndex;
      tail += 1;
    };

    for (let x = 0; x < surface.width; x += 1) {
      enqueueBackground(x);
      enqueueBackground((surface.height - 1) * surface.width + x);
    }
    for (let y = 1; y < surface.height - 1; y += 1) {
      enqueueBackground(y * surface.width);
      enqueueBackground(y * surface.width + surface.width - 1);
    }

    const canFlow = (fromPixel, toPixel) => {
      const from = fromPixel * 4;
      const to = toPixel * 4;
      const red = data[from] - data[to];
      const green = data[from + 1] - data[to + 1];
      const blue = data[from + 2] - data[to + 2];
      const targetBrightness = (data[to] + data[to + 1] + data[to + 2]) / 3;
      return targetBrightness < 185 && red * red + green * green + blue * blue < 900;
    };

    const tryBackgroundNeighbor = (pixelIndex, neighbor) => {
      if (!background[neighbor] && canFlow(pixelIndex, neighbor)) enqueueBackground(neighbor);
    };

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      const x = pixelIndex % surface.width;
      const y = Math.floor(pixelIndex / surface.width);
      if (x > 0) tryBackgroundNeighbor(pixelIndex, pixelIndex - 1);
      if (x < surface.width - 1) tryBackgroundNeighbor(pixelIndex, pixelIndex + 1);
      if (y > 0) tryBackgroundNeighbor(pixelIndex, pixelIndex - surface.width);
      if (y < surface.height - 1) tryBackgroundNeighbor(pixelIndex, pixelIndex + surface.width);
    }

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (background[pixelIndex]) data[pixelIndex * 4 + 3] = 0;
    }

    const visited = new Uint8Array(pixelCount);
    const components = [];
    for (let start = 0; start < pixelCount; start += 1) {
      if (visited[start] || data[start * 4 + 3] === 0) continue;
      const component = [];
      head = 0;
      tail = 0;
      visited[start] = 1;
      queue[tail] = start;
      tail += 1;

      const enqueueComponent = (neighbor) => {
        if (!visited[neighbor] && data[neighbor * 4 + 3] > 0) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      };

      while (head < tail) {
        const pixelIndex = queue[head];
        head += 1;
        component.push(pixelIndex);
        const x = pixelIndex % surface.width;
        const y = Math.floor(pixelIndex / surface.width);
        if (x > 0) enqueueComponent(pixelIndex - 1);
        if (x < surface.width - 1) enqueueComponent(pixelIndex + 1);
        if (y > 0) enqueueComponent(pixelIndex - surface.width);
        if (y < surface.height - 1) enqueueComponent(pixelIndex + surface.width);
      }
      components.push(component);
    }

    const keep = new Uint8Array(pixelCount);
    components
      .sort((first, second) => second.length - first.length)
      .slice(0, frame.keepComponents ?? 1)
      .forEach((component) => {
        component.forEach((pixelIndex) => {
          keep[pixelIndex] = 1;
        });
      });
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (!keep[pixelIndex]) data[pixelIndex * 4 + 3] = 0;
    }

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const offset = pixelIndex * 4;
      if (data[offset + 3] === 0) continue;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const brightness = (red + green + blue) / 3;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (brightness < 105 && chroma < 48) {
        data[offset] = 52;
        data[offset + 1] = 64;
        data[offset + 2] = 88;
      } else if (brightness > 220 && chroma < 36) {
        const softWhite = Math.round(214 + ((brightness - 220) / 35) * 20);
        data[offset] = softWhite;
        data[offset + 1] = softWhite + 3;
        data[offset + 2] = Math.min(242, softWhite + 7);
      }
    }


    surfaceContext.putImageData(pixels, 0, 0);
    return surface;
  }

  async function loadGhostSprites() {
    try {
      const image = new Image();
      image.src = GHOST_SPRITE_ATLAS;
      await image.decode();
      Object.entries(GHOST_SPRITE_FRAMES).forEach(([key, frame]) => {
        ghostSprites.set(key, extractCleanSprite(image, frame));
      });
    } catch {
      ghostSprites.clear();
    }
  }

  async function loadSleepGhost() {
    try {
      const image = new Image();
      image.src = SLEEP_GHOST_ASSET;
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = image.naturalWidth;
      surface.height = image.naturalHeight;
      const surfaceContext = surface.getContext("2d", { willReadFrequently: true });
      surfaceContext.drawImage(image, 0, 0);
      const pixels = surfaceContext.getImageData(0, 0, surface.width, surface.height);
      const data = pixels.data;
      let left = surface.width;
      let top = surface.height;
      let right = -1;
      let bottom = -1;

      for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const greenExcess = green - Math.max(red, blue);
        if (greenExcess > 18) {
          data[offset + 3] = clamp(Math.round((78 - greenExcess) / 60 * 255), 0, 255);
          data[offset + 1] = Math.min(green, Math.max(red, blue) + 12);
        }
        if (data[offset + 3] > 16) {
          const pixelIndex = offset / 4;
          const x = pixelIndex % surface.width;
          const y = Math.floor(pixelIndex / surface.width);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }

      if (right < left || bottom < top) return;
      surfaceContext.putImageData(pixels, 0, 0);
      const subjectWidth = right - left + 1;
      const subjectHeight = bottom - top + 1;
      const cropSize = Math.max(subjectWidth, subjectHeight) * 1.14;
      const centerX = (left + right) * 0.5;
      const centerY = (top + bottom) * 0.5;
      const sleepContext = sleepGhostCanvas.getContext("2d");
      sleepContext.clearRect(0, 0, sleepGhostCanvas.width, sleepGhostCanvas.height);
      sleepContext.drawImage(
        surface,
        centerX - cropSize * 0.5,
        centerY - cropSize * 0.5,
        cropSize,
        cropSize,
        0,
        0,
        sleepGhostCanvas.width,
        sleepGhostCanvas.height,
      );
      sleepGhostCanvas.classList.add("ready");
    } catch {
      sleepGhostCanvas.classList.remove("ready");
    }
  }

  function resize() {
    const oldWidth = width || innerWidth;
    const oldHeight = height || innerHeight;
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    spotlight.x = spotlight.x || width * 0.5;
    spotlight.y = spotlight.y || height * 0.45;

    if (!stars.length) {
      const count = clamp(Math.round((width * height) / 9000), 45, 120);
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: Math.random(),
          y: Math.random() * 0.82,
          size: random(0.6, 2.1),
          phase: random(0, TAU),
          speed: random(0.5, 1.7),
        });
      }
      for (let i = 0; i < 4; i += 1) {
        clouds.push({
          x: random(-0.2, 1),
          y: random(0.08, 0.7),
          size: random(70, 150),
          speed: random(0.003, 0.008),
          alpha: random(0.025, 0.08),
        });
      }
    }

    ghosts.forEach((ghost) => {
      ghost.x = clamp((ghost.x / oldWidth) * width, ghost.size * 0.5, width - ghost.size * 0.5);
      ghost.y = clamp((ghost.y / oldHeight) * height, ghost.size * 0.5, height - ghost.size * 0.6);
    });
  }

  class Ghost {
    constructor(x, y, size, options = {}) {
      this.x = x;
      this.y = y;
      this.size = size;
      this.baseSize = size;
      this.vx = options.vx ?? random(-22, 22);
      this.vy = options.vy ?? random(-16, 16);
      this.phase = random(0, TAU);
      this.floatSpeed = random(0.7, 1.25);
      this.personality = random(0.8, 1.2);
      this.direction = this.vx < 0 ? -1 : 1;
      this.heldBy = null;
      this.holdStart = 0;
      this.dragX = x;
      this.dragY = y;
      this.lastDragX = x;
      this.lastDragY = y;
      this.lastDragAt = performance.now();
      this.shyUntil = options.shy ? performance.now() + 1200 : 0;
      this.squash = 0;
      this.stretch = 0;
      this.spin = 0;
      this.blink = random(1.5, 5);
      this.blinkAmount = 0;
      this.blinking = false;
      this.blush = 0;
      this.sleepiness = 0;
      this.eyeTargetX = 0;
      this.eyeTargetY = 0;
      this.popArmed = false;
      this.popInAt = options.popIn ? performance.now() : 0;
      this.dizzyUntil = 0;
      this.variant = options.variant ?? Math.floor(random(0, 3));
    }

    contains(x, y) {
      return distance(x, y, this.x, this.y) < this.size * 0.58;
    }

    shy(duration = 1200) {
      this.shyUntil = performance.now() + duration;
      this.vx *= 0.45;
      this.vy *= 0.45;
      burst(this.x, this.y - this.size * 0.15, 5, "heart");
      playSound("shy", this.size);
    }

    update(dt, now) {
      const dizzy = this.dizzyUntil > now;
      const shy = !dizzy && (this.shyUntil > now || (lightOn && distance(this.x, this.y, spotlight.x, spotlight.y) < Math.max(width, height) * 0.34));
      if (this.heldBy !== null) {
        const pullX = this.dragX - this.x;
        const pullY = this.dragY - this.y;
        this.vx += pullX * 34 * dt;
        this.vy += pullY * 34 * dt;
        this.vx *= Math.pow(0.025, dt);
        this.vy *= Math.pow(0.025, dt);
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const heldFor = now - this.holdStart;
        const targetGrow = heldFor > 430 ? clamp((heldFor - 430) / 1400, 0, 0.65) : 0;
        this.size += (this.baseSize * (1 + targetGrow) - this.size) * Math.min(1, dt * 8);
        this.blush += (targetGrow - this.blush) * Math.min(1, dt * 7);
        this.popArmed = heldFor > 1250;
        this.stretch += (clamp(Math.hypot(pullX, pullY) / (this.size * 1.2), 0, 0.38) - this.stretch) * Math.min(1, dt * 12);
        this.spin = clamp(this.vx / 850, -0.25, 0.25);
      } else {
        this.size += (this.baseSize - this.size) * Math.min(1, dt * 5);
        this.blush += (0 - this.blush) * Math.min(1, dt * 3);
        this.stretch += (0 - this.stretch) * Math.min(1, dt * 7);
        this.spin += (0 - this.spin) * Math.min(1, dt * 5);
        this.vx += Math.sin(worldTime * 0.34 + this.phase) * 2.6 * dt;
        this.vy += Math.cos(worldTime * 0.46 + this.phase) * 2.1 * dt;
        if (shy) {
          this.vx *= Math.pow(0.18, dt);
          this.vy *= Math.pow(0.18, dt);
        } else {
          this.vx *= Math.pow(0.84, dt);
          this.vy *= Math.pow(0.84, dt);
        }
        this.x += this.vx * dt;
        this.y += (this.vy + Math.sin(worldTime * this.floatSpeed + this.phase) * 8) * dt;
      }

      const margin = this.size * 0.42;
      if (this.x < margin) {
        this.x = margin;
        this.vx = Math.abs(this.vx) * 0.72 + 18;
        this.squash = 0.22;
        if (!dizzy) playSound("bump", this.size);
      } else if (this.x > width - margin) {
        this.x = width - margin;
        this.vx = -Math.abs(this.vx) * 0.72 - 18;
        this.squash = 0.22;
        if (!dizzy) playSound("bump", this.size);
      }
      if (this.y < margin + 42) {
        this.y = margin + 42;
        this.vy = Math.abs(this.vy) * 0.68 + 10;
        this.squash = -0.16;
      } else if (this.y > height - margin - 65) {
        this.y = height - margin - 65;
        this.vy = -Math.abs(this.vy) * 0.68 - 12;
        this.squash = -0.16;
      }

      this.squash += (0 - this.squash) * Math.min(1, dt * 8);
      if (Math.abs(this.vx) > 5) this.direction = this.vx < 0 ? -1 : 1;

      this.blink -= dt;
      if (this.blink < 0 && !shy) {
        this.blinking = true;
        this.blinkAmount += dt * 9;
        if (this.blinkAmount >= 1) {
          this.blinkAmount = 1;
          this.blinking = false;
        }
      } else if (!this.blinking && this.blinkAmount > 0) {
        this.blinkAmount -= dt * 8;
        if (this.blinkAmount <= 0) {
          this.blinkAmount = 0;
          this.blink = random(2, 6);
        }
      }

      const nearest = nearestPointer(this.x, this.y);
      if (nearest && !shy) {
        this.eyeTargetX += (clamp((nearest.x - this.x) / this.size, -0.14, 0.14) - this.eyeTargetX) * Math.min(1, dt * 9);
        this.eyeTargetY += (clamp((nearest.y - this.y) / this.size, -0.1, 0.1) - this.eyeTargetY) * Math.min(1, dt * 9);
      } else {
        this.eyeTargetX += (0 - this.eyeTargetX) * Math.min(1, dt * 3);
        this.eyeTargetY += (0 - this.eyeTargetY) * Math.min(1, dt * 3);
      }
    }

    draw(now) {
      const dizzy = this.dizzyUntil > now;
      const shy = !dizzy && (this.shyUntil > now || (lightOn && distance(this.x, this.y, spotlight.x, spotlight.y) < Math.max(width, height) * 0.34));
      const s = this.size;
      const squeezeX = 1 + this.stretch + this.squash;
      const squeezeY = 1 - this.stretch * 0.5 - this.squash * 0.58;
      const popProgress = this.popInAt ? clamp((now - this.popInAt) / 620, 0, 1) : 1;
      const popOffset = popProgress - 1;
      const popScale = 1 + 2.70158 * popOffset ** 3 + 1.70158 * popOffset ** 2;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.spin + (dizzy ? Math.sin(worldTime * 13 + this.phase) * 0.12 : 0));
      ctx.scale(this.direction * squeezeX * popScale, squeezeY * popScale);

      ctx.shadowColor = lightOn ? "rgba(238,225,171,.28)" : "rgba(190,204,226,.18)";
      ctx.shadowBlur = s * 0.16;
      const speed = Math.hypot(this.vx, this.vy);
      const sleepyMoment = Math.sin(worldTime * 0.42 + this.phase) > 0.93;
      const spriteKey = dizzy
        ? "spinning"
        : shy
        ? "shy"
        : this.popArmed
          ? "surprised"
          : this.heldBy !== null
            ? "cheeky"
            : speed > 240
              ? "spinning"
              : sleepyMoment
                ? "sleepy"
                : "laugh";
      const sprite = ghostSprites.get(spriteKey);
      if (!sprite) {
        ctx.restore();
        return;
      }

      const spriteSize = s * 1.48;
      ctx.drawImage(sprite, -spriteSize * 0.5, -spriteSize * 0.5, spriteSize, spriteSize);
      ctx.shadowBlur = 0;
      if (this.popArmed) {
        ctx.fillStyle = `rgba(255, 226, 105, ${0.45 + Math.sin(worldTime * 10) * 0.3})`;
        for (let i = 0; i < 4; i += 1) {
          const angle = worldTime * 1.8 + i * TAU / 4;
          starPath(Math.cos(angle) * s * 0.68, Math.sin(angle) * s * 0.6, s * 0.055, 0.45);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function createGhosts() {
    ghosts.length = 0;
    const count = width < 500 ? 3 : 4;
    for (let i = 0; i < count; i += 1) {
      const large = i === 0;
      const size = large ? clamp(width * 0.34, 120, 185) : random(58, clamp(width * 0.21, 78, 125));
      ghosts.push(new Ghost(
        large ? width * 0.5 : random(size * 0.7, width - size * 0.7),
        large ? height * 0.44 : random(95 + size * 0.5, height - 120 - size * 0.5),
        size,
      ));
    }
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, lightOn ? "#52617b" : "#3b4862");
    gradient.addColorStop(0.62, lightOn ? "#6d7b91" : "#59677e");
    gradient.addColorStop(1, lightOn ? "#8993a4" : "#748094");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      const alpha = 0.18 + Math.sin(worldTime * star.speed + star.phase) * 0.1;
      ctx.fillStyle = `rgba(231, 230, 211, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.size, 0, TAU);
      ctx.fill();
    }

    clouds.forEach((cloud) => {
      cloud.x += cloud.speed * 0.016;
      if (cloud.x > 1.25) cloud.x = -0.35;
      ctx.save();
      ctx.globalAlpha = cloud.alpha;
      ctx.fillStyle = "#a7b4e3";
      const x = cloud.x * width;
      const y = cloud.y * height;
      ctx.beginPath();
      ctx.ellipse(x, y, cloud.size, cloud.size * 0.22, 0, 0, TAU);
      ctx.ellipse(x - cloud.size * 0.44, y + 3, cloud.size * 0.54, cloud.size * 0.17, 0, 0, TAU);
      ctx.ellipse(x + cloud.size * 0.48, y + 5, cloud.size * 0.6, cloud.size * 0.16, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    });

    ctx.fillStyle = "#4b5368";
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height * 0.87);
    for (let x = 0; x <= width + 40; x += 40) {
      ctx.lineTo(x, height * 0.87 - Math.sin(x * 0.013) * 15);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    if (lightOn) {
      const beam = ctx.createRadialGradient(spotlight.x, spotlight.y, 12, spotlight.x, spotlight.y, Math.max(width, height) * 0.48);
      beam.addColorStop(0, "rgba(240,231,190,.18)");
      beam.addColorStop(0.55, "rgba(232,221,175,.06)");
      beam.addColorStop(1, "rgba(232,221,175,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height);
    }
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.rotation += p.spin * dt;
      const reachedTop = p.kind === "bubble" && p.y < height * 0.06;
      const reachedBottom = p.kind === "falling-star" && p.y - p.size > height;
      if (p.life <= 0 || reachedTop || reachedBottom) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.kind === "bubble"
        ? clamp((p.y - height * 0.06) / (height * 0.12), 0, 1)
        : clamp(p.life / p.maxLife, 0, 1);
      if (p.kind === "heart") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, p.size * 0.35);
        ctx.bezierCurveTo(-p.size * 0.9, -p.size * 0.25, -p.size * 0.45, -p.size, 0, -p.size * 0.42);
        ctx.bezierCurveTo(p.size * 0.45, -p.size, p.size * 0.9, -p.size * 0.25, 0, p.size * 0.35);
        ctx.fill();
      } else if (p.kind === "bubble") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.beginPath();
        ctx.arc(-p.size * 0.32, -p.size * 0.35, p.size * 0.16, 0, TAU);
        ctx.fill();
      } else if (p.kind === "ring") {
        const progress = 1 - p.life / p.maxLife;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(2, 7 * (1 - progress));
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (0.45 + progress * 1.35), 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        starPath(0, 0, p.size, 0.46);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function starPath(x, y, radius, inset) {
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 === 0 ? radius : radius * inset;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function burst(x, y, count = 8, kind = "star") {
    for (let i = 0; i < count; i += 1) {
      const angle = random(0, TAU);
      const speed = random(35, 120);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        gravity: kind === "bubble" ? -18 : 45,
        life: random(0.6, 1.15),
        maxLife: 1.15,
        size: random(5, 12),
        rotation: random(0, TAU),
        spin: random(-4, 4),
        kind,
        color: kind === "heart"
          ? ["#ff7891", "#ff9eb0", "#ffd5dd"][i % 3]
          : kind === "bubble"
            ? ["#aeefff", "#ffd0ef", "#fff3a8"][i % 3]
            : ["#ffe36b", "#ff8b70", "#9eeeff"][i % 3],
      });
    }
  }

  function nearestPointer(x, y) {
    let nearest = null;
    let best = Infinity;
    pointerMap.forEach((pointer) => {
      const d = distance(x, y, pointer.x, pointer.y);
      if (d < best) {
        best = d;
        nearest = pointer;
      }
    });
    return nearest;
  }

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function findGhost(x, y) {
    for (let i = ghosts.length - 1; i >= 0; i -= 1) {
      if (ghosts[i].contains(x, y) && ghosts[i].heldBy === null) return ghosts[i];
    }
    return null;
  }

  function onPointerDown(event) {
    if (sleeping) return;
    event.preventDefault();
    ensureAudio();
    requestMotionPermission();
    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    const ghost = findGhost(point.x, point.y);
    pointerMap.set(event.pointerId, {
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      startAt: performance.now(),
      ghost,
    });
    spotlight.x = point.x;
    spotlight.y = point.y;
    if (ghost) {
      ghost.heldBy = event.pointerId;
      ghost.holdStart = performance.now();
      ghost.dragX = point.x;
      ghost.dragY = point.y;
      ghost.lastDragX = point.x;
      ghost.lastDragY = point.y;
      ghost.lastDragAt = performance.now();
      ghosts.splice(ghosts.indexOf(ghost), 1);
      ghosts.push(ghost);
      playSound("touch", ghost.size);
    } else {
      burst(point.x, point.y, 4, "star");
    }
  }

  function onPointerMove(event) {
    const pointer = pointerMap.get(event.pointerId);
    if (!pointer) return;
    const point = getPoint(event);
    pointer.x = point.x;
    pointer.y = point.y;
    spotlight.x += (point.x - spotlight.x) * 0.38;
    spotlight.y += (point.y - spotlight.y) * 0.38;
    if (pointer.ghost) {
      const ghost = pointer.ghost;
      const now = performance.now();
      const elapsed = Math.max(8, now - ghost.lastDragAt);
      ghost.dragX = point.x;
      ghost.dragY = point.y;
      ghost.vx = (point.x - ghost.lastDragX) / elapsed * 1000;
      ghost.vy = (point.y - ghost.lastDragY) / elapsed * 1000;
      ghost.lastDragX = point.x;
      ghost.lastDragY = point.y;
      ghost.lastDragAt = now;
    }
  }

  function onPointerUp(event) {
    const pointer = pointerMap.get(event.pointerId);
    if (!pointer) return;
    const now = performance.now();
    const travel = distance(pointer.startX, pointer.startY, pointer.x, pointer.y);
    const heldFor = now - pointer.startAt;
    if (pointer.ghost) {
      const ghost = pointer.ghost;
      ghost.heldBy = null;
      ghost.baseSize = clamp(ghost.baseSize, 48, 190);
      if (ghost.popArmed) {
        splitGhost(ghost);
      } else if (heldFor < 240 && travel < 16) {
        ghost.shy();
      } else {
        ghost.vx = clamp(ghost.vx, -850, 850);
        ghost.vy = clamp(ghost.vy, -850, 850);
        playSound("whoosh", ghost.size);
      }
      ghost.popArmed = false;
    } else if (heldFor < 250 && travel < 18) {
      const isDouble = now - lastSkyTap.time < 360 && distance(lastSkyTap.x, lastSkyTap.y, pointer.x, pointer.y) < 45;
      if (isDouble) {
        spawnGhost(pointer.x, pointer.y, random(48, 72), true);
        lastSkyTap.time = 0;
      } else {
        lastSkyTap = { time: now, x: pointer.x, y: pointer.y };
      }
    }
    pointerMap.delete(event.pointerId);
  }

  function splitGhost(ghost) {
    const index = ghosts.indexOf(ghost);
    if (ghosts.length < 14 && ghost.baseSize > 72) {
      burst(ghost.x, ghost.y, 16, "star");
      playSound("pop", ghost.size);
      const babySize = clamp(ghost.baseSize * 0.46, 45, 68);
      for (let i = 0; i < 3; i += 1) {
        const angle = -Math.PI * 0.82 + i * Math.PI * 0.32;
        ghosts.push(new Ghost(ghost.x, ghost.y, babySize, {
          vx: Math.cos(angle) * 165,
          vy: Math.sin(angle) * 165,
          shy: true,
        }));
      }
      ghost.baseSize *= 0.72;
      ghost.size = ghost.baseSize;
    } else {
      burst(ghost.x, ghost.y, 12, "heart");
      ghost.shy(1800);
    }
    if (index >= 0) ghosts.splice(index, 1);
    ghosts.push(ghost);
    vibrate([18, 25, 18]);
  }

  function spawnGhost(x = random(70, width - 70), y = random(120, height - 160), size = random(58, 92), shy = false, options = {}) {
    if (ghosts.length >= 16) {
      ghosts[0].shy(1600);
      return;
    }
    const ghost = new Ghost(clamp(x, size * 0.5, width - size * 0.5), clamp(y, size * 0.5 + 50, height - size * 0.5 - 70), size, {
      ...options,
      shy,
      vy: options.vy ?? -80,
    });
    ghosts.push(ghost);
    if (options.popIn) {
      particles.push({
        x: ghost.x,
        y: ghost.y,
        vx: 0,
        vy: 0,
        gravity: 0,
        life: 0.62,
        maxLife: 0.62,
        size: size * 0.62,
        rotation: 0,
        spin: 0,
        kind: "ring",
        color: "rgba(231, 230, 211, .72)",
      });
      burst(ghost.x, ghost.y, 14, "star");
    } else {
      burst(ghost.x, ghost.y, 10, "bubble");
    }
    playSound("appear", size);
    vibrate(15);
  }

  function magicEvent() {
    if (sleeping) return;
    ensureAudio();
    magicIndex = (magicIndex + 1) % 3;
    if (magicIndex === 0) {
      for (let i = 0; i < 28; i += 1) {
        particles.push({
          x: random(0, width),
          y: random(-80, -5),
          vx: random(-16, 16),
          vy: random(80, 180),
          gravity: 25,
          life: 12,
          maxLife: 12,
          size: random(6, 13),
          rotation: random(0, TAU),
          spin: random(-3, 3),
          kind: "falling-star",
          color: ["#ffe36b", "#ff8b70", "#9eeeff"][i % 3],
        });
      }
      ghosts.forEach((ghost) => {
        ghost.vy -= random(35, 100);
      });
      showToast("星星雨");
      playSound("magic");
    } else if (magicIndex === 1) {
      for (let i = 0; i < 12; i += 1) {
        particles.push({
          x: random(0, width),
          y: height + random(10, 70),
          vx: random(-25, 25),
          vy: random(-180, -110),
          gravity: -4,
          life: 12,
          maxLife: 12,
          size: random(16, 44),
          rotation: 0,
          spin: 0,
          kind: "bubble",
          color: ["#aeefff", "#ffd0ef", "#fff3a8"][i % 3],
        });
      }
      showToast("泡泡来啦");
      playSound("bubble");
    } else {
      const giantSize = Math.min(width * 0.94, height * 0.88) / 1.48;
      spawnGhost(width * 0.5, height * 0.44, giantSize, true, { popIn: true });
      showToast("大幽灵来玩啦");
    }
  }

  function toggleLight() {
    lightOn = !lightOn;
    moonButton.classList.toggle("active", lightOn);
    moonButton.setAttribute("aria-pressed", String(lightOn));
    if (lightOn) {
      ghosts.forEach((ghost) => ghost.shyUntil = performance.now() + 650);
      showToast("月光照过来啦");
      playSound("moon");
    }
    vibrate(12);
  }

  function screenMotionVector(x, y) {
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    if (angle === 90) return { x: -y, y: x };
    if (angle === 270 || angle === -90) return { x: y, y: -x };
    if (Math.abs(angle) === 180) return { x: -x, y: -y };
    return { x, y };
  }

  function makeGhostsDizzy(deltaX, deltaY, intensity) {
    if (sleeping || !ghosts.length) return;
    const now = performance.now();
    const firstShake = !ghosts.some((ghost) => ghost.dizzyUntil > now);
    const motion = screenMotionVector(deltaX, deltaY);
    ghosts.forEach((ghost, index) => {
      const scatter = intensity * (index % 2 === 0 ? 7 : -7);
      ghost.vx = clamp(ghost.vx + motion.x * 18 + scatter + random(-45, 45), -520, 520);
      ghost.vy = clamp(ghost.vy + motion.y * 18 - scatter + random(-45, 45), -520, 520);
      ghost.spin = clamp(ghost.spin + random(-0.9, 0.9), -0.9, 0.9);
      ghost.shyUntil = 0;
      ghost.dizzyUntil = now + 3000;
    });
    document.documentElement.classList.add("ghosts-dizzy");
    clearTimeout(dizzyTimer);
    dizzyTimer = setTimeout(() => document.documentElement.classList.remove("ghosts-dizzy"), 3000);
    if (firstShake) {
      showToast("幽灵们转晕啦");
      playSound("whoosh");
      vibrate([12, 35, 12]);
    }
  }

  function handleDeviceMotion(event) {
    const source = event.acceleration?.x != null ? event.acceleration : event.accelerationIncludingGravity;
    if (!source) return;
    const sample = {
      x: Number(source.x) || 0,
      y: Number(source.y) || 0,
      z: Number(source.z) || 0,
    };
    if (!lastMotionSample) {
      lastMotionSample = sample;
      return;
    }
    const deltaX = sample.x - lastMotionSample.x;
    const deltaY = sample.y - lastMotionSample.y;
    const deltaZ = sample.z - lastMotionSample.z;
    const intensity = Math.hypot(deltaX, deltaY, deltaZ);
    lastMotionSample = sample;
    const now = performance.now();
    if (intensity < 6.5 || now - lastShakeAt < 90) return;
    lastShakeAt = now;
    makeGhostsDizzy(deltaX, deltaY, clamp(intensity, 6.5, 24));
  }

  function installMotionListener() {
    if (motionListening) return;
    motionListening = true;
    window.addEventListener("devicemotion", handleDeviceMotion);
  }

  async function requestMotionPermission() {
    installMotionListener();
    if (motionPermissionRequested) return;
    const requestPermission = globalThis.DeviceMotionEvent?.requestPermission;
    if (typeof requestPermission !== "function") return;
    motionPermissionRequested = true;
    try {
      await requestPermission.call(globalThis.DeviceMotionEvent);
    } catch {
      motionPermissionRequested = false;
    }
  }

  function loadSoundAssets() {
    if (!audioContext || soundLoadPromise) return soundLoadPromise;
    const urls = [...new Set(Object.values(SOUND_ASSETS).flat())];
    document.documentElement.dataset.soundAssets = "loading";
    soundLoadPromise = Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to load ${url}`);
        const bytes = await response.arrayBuffer();
        const buffer = await new Promise((resolve, reject) => {
          audioContext.decodeAudioData(bytes, resolve, reject);
        });
        soundBuffers.set(url, buffer);
        return true;
      } catch {
        return false;
      }
    })).then((results) => {
      document.documentElement.dataset.soundAssets = results.every(Boolean) ? "ready" : "partial";
      return results;
    });
    return soundLoadPromise;
  }

  function ensureAudio() {
    if (!soundOn) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioContext && navigator.userActivation && !navigator.userActivation.isActive) return;
    if (!audioContext && AudioContext) audioContext = new AudioContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    loadSoundAssets();
  }

  function playBufferedSound(kind, size, now) {
    const candidates = (SOUND_ASSETS[kind] || []).filter((url) => soundBuffers.has(url));
    if (!candidates.length) return false;
    const url = candidates[Math.floor(Math.random() * candidates.length)];
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = soundBuffers.get(url);
    const pitchScale = clamp(95 / size, 0.88, 1.12) * random(0.97, 1.03);
    source.playbackRate.setValueAtTime(pitchScale, now);
    gain.gain.setValueAtTime(SOUND_LEVELS[kind] ?? 0.12, now);
    source.connect(gain).connect(audioContext.destination);
    source.start(now);
    return true;
  }

  function playSound(kind, size = 90) {
    if (!soundOn) return;
    const nowMs = performance.now();
    if (nowMs - (lastSoundTimes.get(kind) ?? -Infinity) < (SOUND_COOLDOWNS[kind] ?? 60)) return;
    lastSoundTimes.set(kind, nowMs);
    ensureAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    if (playBufferedSound(kind, size, now)) return;
    const gain = audioContext.createGain();
    const oscillator = audioContext.createOscillator();
    const pitchScale = clamp(95 / size, 0.62, 1.7);
    const presets = {
      touch: [260, 340, 0.08, "sine"],
      shy: [430, 280, 0.15, "triangle"],
      bump: [170, 130, 0.05, "sine"],
      whoosh: [190, 90, 0.12, "sine"],
      appear: [330, 610, 0.18, "sine"],
      pop: [520, 160, 0.16, "square"],
      magic: [360, 760, 0.35, "triangle"],
      bubble: [480, 720, 0.24, "sine"],
      moon: [300, 460, 0.28, "sine"],
    };
    const preset = presets[kind] || presets.touch;
    oscillator.type = preset[3];
    oscillator.frequency.setValueAtTime(preset[0] * pitchScale, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, preset[1] * pitchScale), now + preset[2]);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "bump" ? 0.025 : 0.055, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + preset[2]);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + preset[2] + 0.02);
  }

  function toggleSound() {
    soundOn = !soundOn;
    localStorage.setItem("boo-sound", soundOn ? "on" : "off");
    soundButton.classList.toggle("muted", !soundOn);
    soundButton.setAttribute("aria-label", soundOn ? "关闭声音" : "打开声音");
    if (soundOn) {
      ensureAudio();
      playSound("appear");
    } else if (audioContext?.state === "running") {
      audioContext.suspend().catch(() => {});
    }
  }

  function vibrate(pattern) {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1200);
  }

  function startParentHold(event) {
    event.preventDefault();
    parentButton.classList.add("holding");
    parentHoldTimer = setTimeout(openParentDialog, 1200);
  }

  function cancelParentHold() {
    clearTimeout(parentHoldTimer);
    parentButton.classList.remove("holding");
  }

  function openParentDialog() {
    cancelParentHold();
    const selected = parentDialog.querySelector(`input[name="timer"][value="${restMinutes}"]`);
    if (selected) selected.checked = true;
    parentDialog.showModal();
    vibrate(20);
  }

  function saveParentSettings() {
    const selected = parentDialog.querySelector('input[name="timer"]:checked');
    if (selected) {
      restMinutes = Number(selected.value);
      localStorage.setItem("boo-rest", String(restMinutes));
    }
    wakeUp();
  }

  function goToSleep() {
    sleeping = true;
    pointerMap.clear();
    ghosts.forEach((ghost) => ghost.heldBy = null);
    sleepCurtain.hidden = false;
    showToast("");
  }

  function wakeUp() {
    sleeping = false;
    playStartedAt = Date.now();
    sleepCurtain.hidden = true;
    ghosts.forEach((ghost) => {
      ghost.vy = random(-80, -30);
      ghost.shyUntil = performance.now() + 700;
    });
  }

  function checkRestTimer() {
    if (!sleeping && restMinutes > 0 && Date.now() - playStartedAt >= restMinutes * 60 * 1000) {
      goToSleep();
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    worldTime += dt;
    drawBackground();
    if (!sleeping) {
      ghosts.forEach((ghost) => ghost.update(dt, now));
      ghosts.forEach((ghost) => ghost.draw(now));
      drawParticles(dt);
      checkRestTimer();
    }
    requestAnimationFrame(frame);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  moonButton.addEventListener("click", toggleLight);
  soundButton.addEventListener("click", toggleSound);
  magicButton.addEventListener("click", () => {
    requestMotionPermission();
    magicEvent();
  });
  parentButton.addEventListener("pointerdown", startParentHold);
  parentButton.addEventListener("pointerup", cancelParentHold);
  parentButton.addEventListener("pointercancel", cancelParentHold);
  parentButton.addEventListener("pointerleave", cancelParentHold);
  wakeButton.addEventListener("click", saveParentSettings);
  parentDialog.addEventListener("close", () => {
    const selected = parentDialog.querySelector('input[name="timer"]:checked');
    if (selected) {
      restMinutes = Number(selected.value);
      localStorage.setItem("boo-rest", String(restMinutes));
    }
  });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    lastTime = performance.now();
  });

  soundButton.classList.toggle("muted", !soundOn);
  soundButton.setAttribute("aria-label", soundOn ? "关闭声音" : "打开声音");
  resize();
  createGhosts();
  loadGhostSprites();
  loadSleepGhost();
  installMotionListener();
  requestAnimationFrame(frame);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  }
})();
