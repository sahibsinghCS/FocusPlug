import {
  birdAlpha,
  bloomAmount,
  cssRgb,
  fireflyAlpha,
  gardenPhase,
  gardenPhaseLabel,
  grassSway,
  horizonY,
  lerp,
  litColor,
  mixRgb,
  moonDisk,
  starAlpha,
  sunDisk,
  sunElevation,
  timeLight,
  type RGB,
  type TimeLight,
} from "./math";
import type {
  FlowerKind,
  GardenBlade,
  GardenFlower,
  GardenHill,
  GardenTree,
  GardenWorld,
} from "./world";

function px(h: number): number {
  return h / 360;
}

function hillPath(
  ctx: CanvasRenderingContext2D,
  hill: GardenHill,
  w: number,
  h: number,
  sway: number,
): void {
  const base = hill.y * h;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, base);
  const steps = 32;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = t * w;
    const wave =
      Math.sin(t * 3.6 + hill.seed) * hill.amplitude * h +
      Math.sin(t * 8.4 + hill.seed * 1.7) * hill.amplitude * h * 0.38 +
      sway * 3;
    ctx.lineTo(x, base + wave);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  light: TimeLight,
): void {
  const horizon = horizonY(h);
  const phase = gardenPhase(progress);
  const zenith =
    phase === "night"
      ? { r: 7, g: 5, b: 24 }
      : phase === "twilight"
        ? { r: 26, g: 10, b: 52 }
        : phase === "dawn"
          ? { r: 64, g: 82, b: 152 }
          : { r: 48, g: 138, b: 210 };
  const mid =
    phase === "night"
      ? { r: 20, g: 10, b: 56 }
      : phase === "twilight"
        ? { r: 98, g: 28, b: 78 }
        : phase === "dawn"
          ? { r: 236, g: 118, b: 72 }
          : { r: 126, g: 196, b: 236 };
  const band =
    phase === "night"
      ? { r: 40, g: 20, b: 78 }
      : phase === "twilight"
        ? { r: 255, g: 112, b: 58 }
        : phase === "dawn"
          ? { r: 255, g: 198, b: 108 }
          : { r: 198, g: 232, b: 164 };
  const sky = ctx.createLinearGradient(0, 0, 0, horizon + 12);
  sky.addColorStop(0, cssRgb(zenith));
  sky.addColorStop(0.38, cssRgb(mid));
  sky.addColorStop(0.76, cssRgb(mixRgb(mid, band, 0.55)));
  sky.addColorStop(1, cssRgb(band));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const glowX = sunDisk(progress, w, h).x;
  const glow = ctx.createRadialGradient(glowX, horizon, 4, glowX, horizon, w * 0.7);
  glow.addColorStop(0, cssRgb(light.warm, light.bloom * 0.5));
  glow.addColorStop(0.4, cssRgb(light.warm, light.bloom * 0.14));
  glow.addColorStop(1, cssRgb(light.warm, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon + 30);
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  world: GardenWorld,
  w: number,
  h: number,
  progress: number,
  clockMs: number,
): void {
  const alpha = starAlpha(progress);
  if (alpha <= 0.01) {
    return;
  }
  for (const star of world.stars) {
    const twinkle = 0.5 + 0.5 * Math.sin(clockMs * 0.0022 + star.twinkle);
    ctx.beginPath();
    ctx.fillStyle = `rgba(236, 230, 255, ${alpha * twinkle})`;
    ctx.arc(star.x * w, star.y * h * 0.9, star.r * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMoon(ctx: CanvasRenderingContext2D, progress: number, w: number, h: number): void {
  const moon = moonDisk(progress, w, h);
  if (moon.alpha <= 0.02) {
    return;
  }
  const glow = ctx.createRadialGradient(moon.x, moon.y, 2, moon.x, moon.y, moon.r * 4.2);
  glow.addColorStop(0, `rgba(230, 232, 255, ${0.34 * moon.alpha})`);
  glow.addColorStop(1, "rgba(230, 232, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r * 4.2, 0, Math.PI * 2);
  ctx.fill();

  const disk = ctx.createRadialGradient(
    moon.x - moon.r * 0.28,
    moon.y - moon.r * 0.3,
    moon.r * 0.2,
    moon.x,
    moon.y,
    moon.r,
  );
  disk.addColorStop(0, `rgba(248, 248, 255, ${moon.alpha})`);
  disk.addColorStop(1, `rgba(186, 190, 220, ${moon.alpha})`);
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(160, 164, 196, ${0.3 * moon.alpha})`;
  ctx.beginPath();
  ctx.arc(moon.x + moon.r * 0.22, moon.y - moon.r * 0.12, moon.r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(moon.x - moon.r * 0.2, moon.y + moon.r * 0.22, moon.r * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawSun(ctx: CanvasRenderingContext2D, progress: number, w: number, h: number): void {
  const sun = sunDisk(progress, w, h);
  const horizon = horizonY(h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, horizon + 2);
  ctx.clip();

  const halo = ctx.createRadialGradient(sun.x, sun.y, 2, sun.x, sun.y, sun.r * (9 + sun.glow * 5));
  halo.addColorStop(0, `rgba(255, 238, 176, ${0.7 * sun.glow})`);
  halo.addColorStop(0.2, `rgba(255, 176, 78, ${0.28 * sun.glow})`);
  halo.addColorStop(1, "rgba(255, 150, 60, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r * 13, 0, Math.PI * 2);
  ctx.fill();

  const disk = ctx.createRadialGradient(
    sun.x - sun.r * 0.22,
    sun.y - sun.r * 0.24,
    sun.r * 0.12,
    sun.x,
    sun.y,
    sun.r,
  );
  disk.addColorStop(0, "#fff8d2");
  disk.addColorStop(0.42, "#ffd56a");
  disk.addColorStop(1, "#ff8c32");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSunPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const horizon = horizonY(h);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 236, 200, 0.2)";
  ctx.setLineDash([4, 8]);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 28; i += 1) {
    const sun = sunDisk(i / 28, w, h);
    if (sun.y >= horizon) {
      continue;
    }
    if (!started) {
      ctx.moveTo(sun.x, sun.y);
      started = true;
    } else {
      ctx.lineTo(sun.x, sun.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawHills(
  ctx: CanvasRenderingContext2D,
  world: GardenWorld,
  w: number,
  h: number,
  light: TimeLight,
  clockMs: number,
): void {
  world.hills.forEach((hill, index) => {
    const sway = grassSway(clockMs, 0.18 + index * 0.22, index) * 0.4;
    hillPath(ctx, hill, w, h, sway);
    const haze = mixRgb(hill.color, { r: 70, g: 90, b: 120 }, 0.28 - index * 0.1);
    ctx.fillStyle = cssRgb(litColor(haze, light));
    ctx.fill();
  });
}

function drawTrunk(
  ctx: CanvasRenderingContext2D,
  scale: number,
  lean: number,
  light: TimeLight,
): void {
  const bark = litColor({ r: 98, g: 62, b: 36 }, light);
  const dark = litColor({ r: 54, g: 32, b: 20 }, light);
  ctx.beginPath();
  ctx.moveTo(-8 * scale, 10 * scale);
  ctx.quadraticCurveTo(lean * 16 * scale, -20 * scale, lean * 10 * scale, -58 * scale);
  ctx.quadraticCurveTo(4 * scale, -22 * scale, 9 * scale, 10 * scale);
  ctx.closePath();
  const grad = ctx.createLinearGradient(-10 * scale, 0, 10 * scale, 0);
  grad.addColorStop(0, cssRgb(dark));
  grad.addColorStop(0.45, cssRgb(bark));
  grad.addColorStop(1, cssRgb(dark));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = cssRgb(dark, 0.75);
  ctx.lineWidth = Math.max(1.4, 2.1 * scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(lean * 4 * scale, -36 * scale);
  ctx.quadraticCurveTo(-22 * scale, -50 * scale, -32 * scale, -44 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lean * 6 * scale, -42 * scale);
  ctx.quadraticCurveTo(24 * scale, -56 * scale, 34 * scale, -46 * scale);
  ctx.stroke();
}

function canopyBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGB,
  highlight: RGB,
  tilt: number,
): void {
  const grad = ctx.createRadialGradient(cx - rx * 0.28, cy - ry * 0.32, 3, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, cssRgb(highlight));
  grad.addColorStop(1, cssRgb(color));
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, tilt, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawAppleTree(
  ctx: CanvasRenderingContext2D,
  tree: GardenTree,
  w: number,
  h: number,
  light: TimeLight,
): void {
  const x = tree.x * w;
  const y = tree.y * h;
  const s = tree.scale * px(h) * 1.95;
  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();
  ctx.ellipse(0, 12 * s, 40 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = cssRgb(litColor({ r: 16, g: 24, b: 14 }, light), 0.38);
  ctx.fill();

  drawTrunk(ctx, s, tree.lean, light);

  const canopy = litColor({ r: 44, g: 128, b: 50 }, light);
  const deep = litColor({ r: 24, g: 78, b: 34 }, light);
  const high = litColor({ r: 126, g: 196, b: 72 }, light);
  canopyBlob(ctx, -18 * s + tree.lean * 10, -50 * s, 28 * s, 20 * s, deep, canopy, -0.25);
  canopyBlob(ctx, 16 * s + tree.lean * 10, -52 * s, 26 * s, 18 * s, canopy, high, 0.22);
  canopyBlob(ctx, 1 * s, -68 * s, 30 * s, 22 * s, canopy, high, -0.06);
  canopyBlob(ctx, -8 * s, -42 * s, 20 * s, 14 * s, deep, canopy, 0.12);
  for (let i = 0; i < 14; i += 1) {
    const ang = tree.seed + i * 0.46;
    const rad = (12 + (i % 5) * 3) * s;
    const cx = Math.cos(ang) * rad * 0.9;
    const cy = -54 * s + Math.sin(ang * 1.3) * 14 * s;
    canopyBlob(ctx, cx, cy, (7 + (i % 3) * 2) * s, (5 + (i % 4)) * s, i % 2 === 0 ? deep : canopy, high, ang * 0.1);
  }

  const apple = litColor({ r: 220, g: 44, b: 46 }, light);
  const blush = litColor({ r: 255, g: 130, b: 92 }, light);
  const count = Math.max(4, tree.apples);
  const fruitAlpha = 0.2 + light.bloom * 0.8;
  for (let i = 0; i < count; i += 1) {
    const ang = tree.seed + i * 0.74;
    const ax = Math.cos(ang) * 26 * s;
    const ay = -54 * s + Math.sin(ang * 1.35) * 14 * s;
    ctx.beginPath();
    ctx.arc(ax, ay, 3.8 * s, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(apple, fruitAlpha);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ax - 1 * s, ay - 1 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(blush, 0.72 * fruitAlpha);
    ctx.fill();
  }
  ctx.restore();
}

function flowerPalette(kind: FlowerKind, light: TimeLight): { petal: RGB; heart: RGB } {
  if (kind === "poppy") {
    return { petal: litColor({ r: 232, g: 42, b: 56 }, light), heart: litColor({ r: 36, g: 16, b: 16 }, light) };
  }
  if (kind === "tulip") {
    return { petal: litColor({ r: 255, g: 108, b: 64 }, light), heart: litColor({ r: 255, g: 214, b: 78 }, light) };
  }
  if (kind === "lavender") {
    return { petal: litColor({ r: 164, g: 108, b: 226 }, light), heart: litColor({ r: 118, g: 68, b: 186 }, light) };
  }
  if (kind === "cosmos") {
    return { petal: litColor({ r: 240, g: 68, b: 150 }, light), heart: litColor({ r: 255, g: 204, b: 68 }, light) };
  }
  return { petal: litColor({ r: 250, g: 248, b: 234 }, light), heart: litColor({ r: 255, g: 196, b: 42 }, light) };
}

function drawStem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  lean: number,
  light: TimeLight,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * 6, y - len * 0.52, x + lean * 10, y - len);
  ctx.strokeStyle = cssRgb(litColor({ r: 42, g: 112, b: 40 }, light));
  ctx.lineWidth = 1.7;
  ctx.stroke();
}

function drawFlowerHead(
  ctx: CanvasRenderingContext2D,
  flower: GardenFlower,
  x: number,
  y: number,
  scale: number,
  light: TimeLight,
  bloom: number,
): void {
  const palette = flowerPalette(flower.kind, light);
  const size = 7.4 * scale * lerp(0.62, 1, bloom);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(flower.rot);
  if (flower.kind === "lavender") {
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      ctx.ellipse(Math.sin(i) * 1.4, -i * 2.4 * scale, 2.4 * scale, 3 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = cssRgb(palette.petal, 0.58 + bloom * 0.4);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (flower.kind === "tulip") {
    ctx.beginPath();
    ctx.moveTo(-size, 3);
    ctx.quadraticCurveTo(-size * 0.15, -size * 1.7, 0, -size * 1.45);
    ctx.quadraticCurveTo(size * 0.15, -size * 1.7, size, 3);
    ctx.quadraticCurveTo(0, size * 0.45, -size, 3);
    ctx.fillStyle = cssRgb(palette.petal);
    ctx.fill();
    ctx.restore();
    return;
  }
  const petals = flower.kind === "poppy" ? 5 : 8;
  for (let i = 0; i < petals; i += 1) {
    const ang = flower.seed + (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.9, size * 0.46, size * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(palette.petal);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = cssRgb(palette.heart);
  ctx.fill();
  ctx.restore();
}

function drawFlower(
  ctx: CanvasRenderingContext2D,
  flower: GardenFlower,
  w: number,
  h: number,
  light: TimeLight,
  bloom: number,
  clockMs: number,
): void {
  const sway = grassSway(clockMs, flower.x, 2) * 5;
  const x = flower.x * w + sway;
  const y = flower.y * h;
  const stem = (20 + flower.scale * 14) * px(h);
  const head = flower.scale * px(h) * 3.1;
  ctx.save();
  ctx.globalAlpha = 0.18 + bloom * 0.82;
  drawStem(ctx, x, y, stem, flower.rot + sway * 0.02, light);
  drawFlowerHead(ctx, flower, x + flower.rot * 7, y - stem, head, light, bloom);
  ctx.restore();
}

function drawBedWash(
  ctx: CanvasRenderingContext2D,
  flowers: readonly GardenFlower[],
  w: number,
  h: number,
  light: TimeLight,
  bloom: number,
): void {
  if (bloom < 0.12) {
    return;
  }
  for (const flower of flowers) {
    const palette = flowerPalette(flower.kind, light);
    ctx.beginPath();
    ctx.fillStyle = cssRgb(palette.petal, 0.1 + bloom * 0.12);
    ctx.ellipse(flower.x * w, flower.y * h - 10, 18 + flower.scale * 8, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlade(
  ctx: CanvasRenderingContext2D,
  blade: GardenBlade,
  w: number,
  h: number,
  light: TimeLight,
  clockMs: number,
): void {
  const sway = grassSway(clockMs, blade.x, blade.layer + blade.seed);
  const x = blade.x * w;
  const y = blade.y * h;
  const len = blade.len * h * 1.15;
  const tipX = x + sway * 12;
  const color = litColor(
    blade.layer === 0 ? { r: 92, g: 176, b: 60 } : { r: 60, g: 128, b: 44 },
    light,
  );
  ctx.beginPath();
  ctx.moveTo(x - 1.5, y);
  ctx.quadraticCurveTo(x + sway * 5, y - len * 0.55, tipX, y - len);
  ctx.quadraticCurveTo(x + 1.7 + sway * 3, y - len * 0.5, x + 1.7, y);
  ctx.closePath();
  ctx.fillStyle = cssRgb(color);
  ctx.fill();
}

function drawGrassRibbons(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  light: TimeLight,
  clockMs: number,
): void {
  const ribbons = [
    { y: 0.7, amp: 8, color: { r: 44, g: 96, b: 38 }, layer: 2 },
    { y: 0.78, amp: 10, color: { r: 68, g: 136, b: 48 }, layer: 1 },
    { y: 0.88, amp: 13, color: { r: 98, g: 172, b: 58 }, layer: 0 },
  ];
  for (const ribbon of ribbons) {
    const sway = grassSway(clockMs, 0.4, ribbon.layer);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, ribbon.y * h);
    const steps = 30;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = t * w;
      const wave = Math.sin(t * 11 + ribbon.layer + sway) * ribbon.amp;
      ctx.lineTo(x, ribbon.y * h + wave);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = cssRgb(litColor(ribbon.color, light));
    ctx.fill();
  }
  const bladeColor = cssRgb(litColor({ r: 78, g: 150, b: 52 }, light), 0.45);
  ctx.strokeStyle = bladeColor;
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  for (let i = 0; i < 90; i += 1) {
    const x = (i / 90) * w + ((i * 17) % 7);
    const base = h * (0.8 + ((i * 13) % 9) * 0.012);
    const sway = grassSway(clockMs, i / 90, 3) * 6;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.quadraticCurveTo(x + sway * 0.4, base - 10, x + sway, base - 18 - (i % 5));
    ctx.stroke();
  }
}

function drawFireflies(
  ctx: CanvasRenderingContext2D,
  world: GardenWorld,
  w: number,
  h: number,
  progress: number,
  clockMs: number,
): void {
  const alpha = fireflyAlpha(progress);
  if (alpha <= 0.02) {
    return;
  }
  for (const bug of world.fireflies) {
    const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clockMs * 0.004 + bug.seed));
    const x = bug.x * w + Math.sin(clockMs * 0.0011 + bug.seed) * 6;
    const y = bug.y * h + Math.cos(clockMs * 0.0014 + bug.seed) * 4;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 11);
    glow.addColorStop(0, `rgba(220, 255, 120, ${alpha * pulse})`);
    glow.addColorStop(1, "rgba(220, 255, 120, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(240, 255, 170, ${alpha * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBirds(
  ctx: CanvasRenderingContext2D,
  world: GardenWorld,
  w: number,
  h: number,
  progress: number,
  clockMs: number,
): void {
  const alpha = birdAlpha(progress);
  if (alpha <= 0.02) {
    return;
  }
  ctx.strokeStyle = `rgba(36, 44, 40, ${0.5 * alpha})`;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (const bird of world.birds) {
    const flap = 0.35 + 0.2 * Math.sin(clockMs * 0.006 + bird.seed);
    const x = bird.x * w;
    const y = bird.y * h;
    const s = 8 * bird.scale;
    ctx.beginPath();
    ctx.moveTo(x - s, y + flap * 3);
    ctx.quadraticCurveTo(x, y - s * 0.35, x, y);
    ctx.quadraticCurveTo(x, y - s * 0.35, x + s, y + flap * 3);
    ctx.stroke();
  }
}

function drawReadout(
  ctx: CanvasRenderingContext2D,
  h: number,
  progress: number,
  phaseLabel: string,
): void {
  const pct = `${Math.round(progress * 100)}%`;
  ctx.save();
  ctx.font = "600 10px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(238, 242, 248, 0.58)";
  ctx.textAlign = "left";
  ctx.fillText("SUNRISE", 16, h - 28);
  ctx.font = "700 18px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(238, 242, 248, 0.9)";
  ctx.fillText(`${phaseLabel}  ·  ${pct}`, 16, h - 10);
  ctx.restore();
}

export function paintGarden(
  ctx: CanvasRenderingContext2D,
  world: GardenWorld,
  width: number,
  height: number,
  progress: number,
  clockMs: number,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) {
    throw new Error("Garden paint requires a positive face size");
  }
  const w = width;
  const h = height;
  const p = sunElevation(progress);
  const light = timeLight(p);
  const bloom = bloomAmount(p);

  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, w, h, p, light);
  drawStars(ctx, world, w, h, p, clockMs);
  drawMoon(ctx, p, w, h);
  drawSunPath(ctx, w, h);
  drawSun(ctx, p, w, h);
  drawHills(ctx, world, w, h, light, clockMs);

  const farTrees = world.trees.filter((tree) => tree.scale < 0.85);
  const nearTrees = world.trees.filter((tree) => tree.scale >= 0.85);
  const farFlowers = world.flowers.filter((flower) => flower.y < 0.8);
  const nearFlowers = world.flowers.filter((flower) => flower.y >= 0.8);

  drawBedWash(ctx, farFlowers, w, h, light, bloom);
  for (const tree of farTrees) {
    drawAppleTree(ctx, tree, w, h, light);
  }
  for (const flower of farFlowers) {
    drawFlower(ctx, flower, w, h, light, bloom, clockMs);
  }
  for (const tree of nearTrees) {
    drawAppleTree(ctx, tree, w, h, light);
  }

  drawGrassRibbons(ctx, w, h, light, clockMs);
  for (const blade of world.blades) {
    if (blade.layer === 1) {
      drawBlade(ctx, blade, w, h, light, clockMs);
    }
  }
  drawBedWash(ctx, nearFlowers, w, h, light, bloom);
  for (const flower of nearFlowers) {
    drawFlower(ctx, flower, w, h, light, bloom, clockMs);
  }
  for (const blade of world.blades) {
    if (blade.layer === 0) {
      drawBlade(ctx, blade, w, h, light, clockMs);
    }
  }

  drawFireflies(ctx, world, w, h, p, clockMs);
  drawBirds(ctx, world, w, h, p, clockMs);
  drawReadout(ctx, h, p, gardenPhaseLabel(gardenPhase(p)));
}
