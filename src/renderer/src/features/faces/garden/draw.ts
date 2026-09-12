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
  const steps = 28;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = t * w;
    const wave =
      Math.sin(t * 4.2 + hill.seed) * hill.amplitude * h +
      Math.sin(t * 9.1 + hill.seed * 1.7) * hill.amplitude * h * 0.35 +
      sway * 2.2;
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
      ? { r: 8, g: 6, b: 22 }
      : phase === "twilight"
        ? { r: 28, g: 12, b: 48 }
        : phase === "dawn"
          ? { r: 72, g: 88, b: 148 }
          : { r: 62, g: 148, b: 214 };
  const mid =
    phase === "night"
      ? { r: 22, g: 12, b: 52 }
      : phase === "twilight"
        ? { r: 86, g: 32, b: 78 }
        : phase === "dawn"
          ? { r: 230, g: 126, b: 78 }
          : { r: 132, g: 198, b: 236 };
  const band =
    phase === "night"
      ? { r: 36, g: 22, b: 72 }
      : phase === "twilight"
        ? { r: 255, g: 118, b: 62 }
        : phase === "dawn"
          ? { r: 255, g: 196, b: 110 }
          : { r: 196, g: 230, b: 168 };
  const sky = ctx.createLinearGradient(0, 0, 0, horizon + 18);
  sky.addColorStop(0, cssRgb(zenith));
  sky.addColorStop(0.42, cssRgb(mid));
  sky.addColorStop(0.78, cssRgb(mixRgb(mid, band, 0.55)));
  sky.addColorStop(1, cssRgb(band));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.42, horizon, 8, w * 0.42, horizon, w * 0.62);
  glow.addColorStop(0, cssRgb(light.warm, light.bloom * 0.42));
  glow.addColorStop(0.45, cssRgb(light.warm, light.bloom * 0.12));
  glow.addColorStop(1, cssRgb(light.warm, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon + 24);
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
    const twinkle = 0.55 + 0.45 * Math.sin(clockMs * 0.0022 + star.twinkle);
    ctx.beginPath();
    ctx.fillStyle = `rgba(236, 230, 255, ${alpha * twinkle})`;
    ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMoon(ctx: CanvasRenderingContext2D, progress: number, w: number, h: number): void {
  const moon = moonDisk(progress, w, h);
  if (moon.alpha <= 0.02) {
    return;
  }
  const glow = ctx.createRadialGradient(moon.x, moon.y, 2, moon.x, moon.y, moon.r * 3.4);
  glow.addColorStop(0, `rgba(230, 232, 255, ${0.28 * moon.alpha})`);
  glow.addColorStop(1, "rgba(230, 232, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  const disk = ctx.createRadialGradient(
    moon.x - moon.r * 0.28,
    moon.y - moon.r * 0.3,
    moon.r * 0.2,
    moon.x,
    moon.y,
    moon.r,
  );
  disk.addColorStop(0, `rgba(246, 246, 255, ${moon.alpha})`);
  disk.addColorStop(1, `rgba(186, 190, 220, ${moon.alpha})`);
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(160, 164, 196, ${0.28 * moon.alpha})`;
  ctx.beginPath();
  ctx.arc(moon.x + moon.r * 0.22, moon.y - moon.r * 0.12, moon.r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(moon.x - moon.r * 0.18, moon.y + moon.r * 0.2, moon.r * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function drawSun(ctx: CanvasRenderingContext2D, progress: number, w: number, h: number): void {
  const sun = sunDisk(progress, w, h);
  const horizon = horizonY(h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, horizon);
  ctx.clip();

  const halo = ctx.createRadialGradient(sun.x, sun.y, 2, sun.x, sun.y, sun.r * (8 + sun.glow * 4));
  halo.addColorStop(0, `rgba(255, 236, 170, ${0.55 * sun.glow})`);
  halo.addColorStop(0.22, `rgba(255, 176, 82, ${0.22 * sun.glow})`);
  halo.addColorStop(1, "rgba(255, 160, 70, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r * 12, 0, Math.PI * 2);
  ctx.fill();

  const disk = ctx.createRadialGradient(
    sun.x - sun.r * 0.2,
    sun.y - sun.r * 0.22,
    sun.r * 0.15,
    sun.x,
    sun.y,
    sun.r,
  );
  disk.addColorStop(0, "#fff6c8");
  disk.addColorStop(0.45, "#ffe07a");
  disk.addColorStop(1, "#ff9a3a");
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, sun.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (!sun.aboveHorizon && sun.glow > 0.05) {
    const bleed = ctx.createLinearGradient(0, horizon - 10, 0, horizon + 28);
    bleed.addColorStop(0, `rgba(255, 150, 70, ${0.18 * sun.glow})`);
    bleed.addColorStop(1, "rgba(255, 150, 70, 0)");
    ctx.fillStyle = bleed;
    ctx.fillRect(0, horizon - 10, w, 40);
  }
}

function drawSunPath(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number): void {
  const horizon = horizonY(h);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 236, 200, 0.16)";
  ctx.setLineDash([3, 7]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps;
    const sun = sunDisk(p, w, h);
    if (i === 0) {
      ctx.moveTo(sun.x, Math.min(sun.y, horizon - 1));
    } else if (sun.y < horizon) {
      ctx.lineTo(sun.x, sun.y);
    }
  }
  ctx.stroke();
  ctx.restore();
  void progress;
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
    const sway = grassSway(clockMs, 0.2 + index * 0.2, index) * 0.35;
    hillPath(ctx, hill, w, h, sway);
    ctx.fillStyle = cssRgb(litColor(hill.color, light));
    ctx.fill();
  });
}

function drawTrunk(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  lean: number,
  light: TimeLight,
): void {
  const bark = litColor({ r: 92, g: 58, b: 36 }, light);
  const dark = litColor({ r: 58, g: 34, b: 22 }, light);
  ctx.beginPath();
  ctx.moveTo(x - 7 * scale, y + 8 * scale);
  ctx.quadraticCurveTo(x + lean * 18 * scale, y - 28 * scale, x + lean * 26 * scale, y - 78 * scale);
  ctx.quadraticCurveTo(x + 4 * scale, y - 30 * scale, x + 8 * scale, y + 8 * scale);
  ctx.closePath();
  const grad = ctx.createLinearGradient(x - 10 * scale, y, x + 10 * scale, y);
  grad.addColorStop(0, cssRgb(dark));
  grad.addColorStop(0.45, cssRgb(bark));
  grad.addColorStop(1, cssRgb(dark));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = cssRgb(dark, 0.7);
  ctx.lineWidth = 1.6 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + lean * 10 * scale, y - 42 * scale);
  ctx.quadraticCurveTo(x - 18 * scale, y - 58 * scale, x - 28 * scale, y - 52 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + lean * 12 * scale, y - 50 * scale);
  ctx.quadraticCurveTo(x + 22 * scale, y - 64 * scale, x + 30 * scale, y - 56 * scale);
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
): void {
  const grad = ctx.createRadialGradient(cx - rx * 0.25, cy - ry * 0.3, 4, cx, cy, Math.max(rx, ry));
  grad.addColorStop(0, cssRgb(highlight));
  grad.addColorStop(1, cssRgb(color));
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.15, 0, Math.PI * 2);
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
  const s = tree.scale * Math.min(w, h) * 0.00215;
  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();
  ctx.ellipse(0, 10 * s, 34 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = cssRgb(litColor({ r: 20, g: 28, b: 16 }, light), 0.35);
  ctx.fill();

  drawTrunk(ctx, 0, 0, s, tree.lean, light);

  const canopy = litColor({ r: 46, g: 122, b: 48 }, light);
  const deep = litColor({ r: 28, g: 78, b: 34 }, light);
  const high = litColor({ r: 118, g: 186, b: 72 }, light);
  canopyBlob(ctx, -18 * s + tree.lean * 10, -78 * s, 28 * s, 22 * s, deep, canopy);
  canopyBlob(ctx, 16 * s + tree.lean * 10, -80 * s, 26 * s, 20 * s, canopy, high);
  canopyBlob(ctx, 0, -98 * s, 30 * s, 24 * s, canopy, high);
  canopyBlob(ctx, -8 * s, -70 * s, 22 * s, 16 * s, deep, canopy);

  const apple = litColor({ r: 214, g: 48, b: 46 }, light);
  const blush = litColor({ r: 255, g: 120, b: 90 }, light);
  const count = Math.max(3, tree.apples);
  for (let i = 0; i < count; i += 1) {
    const ang = tree.seed + i * 0.82;
    const ax = Math.cos(ang) * 22 * s;
    const ay = -86 * s + Math.sin(ang * 1.3) * 16 * s;
    ctx.beginPath();
    ctx.arc(ax, ay, 3.1 * s, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(apple);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ax - 0.8 * s, ay - 0.8 * s, 1.05 * s, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(blush, 0.7);
    ctx.fill();
  }
  ctx.restore();
}

function flowerPalette(kind: FlowerKind, light: TimeLight): { petal: RGB; heart: RGB } {
  if (kind === "poppy") {
    return { petal: litColor({ r: 226, g: 46, b: 58 }, light), heart: litColor({ r: 40, g: 18, b: 18 }, light) };
  }
  if (kind === "tulip") {
    return { petal: litColor({ r: 255, g: 110, b: 72 }, light), heart: litColor({ r: 255, g: 210, b: 80 }, light) };
  }
  if (kind === "lavender") {
    return { petal: litColor({ r: 156, g: 110, b: 214 }, light), heart: litColor({ r: 120, g: 72, b: 180 }, light) };
  }
  if (kind === "cosmos") {
    return { petal: litColor({ r: 236, g: 72, b: 148 }, light), heart: litColor({ r: 255, g: 200, b: 70 }, light) };
  }
  return { petal: litColor({ r: 248, g: 246, b: 232 }, light), heart: litColor({ r: 255, g: 196, b: 48 }, light) };
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
  ctx.quadraticCurveTo(x + lean * 4, y - len * 0.5, x + lean * 8, y - len);
  ctx.strokeStyle = cssRgb(litColor({ r: 48, g: 110, b: 42 }, light));
  ctx.lineWidth = 1.4;
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
  const size = 5.2 * scale * lerp(0.55, 1, bloom);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(flower.rot);
  if (flower.kind === "lavender") {
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      ctx.ellipse(Math.sin(i) * 1.2, -i * 2.1 * scale, 2.1 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = cssRgb(palette.petal, 0.55 + bloom * 0.4);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (flower.kind === "tulip") {
    ctx.beginPath();
    ctx.moveTo(-size, 2);
    ctx.quadraticCurveTo(-size * 0.2, -size * 1.6, 0, -size * 1.35);
    ctx.quadraticCurveTo(size * 0.2, -size * 1.6, size, 2);
    ctx.quadraticCurveTo(0, size * 0.4, -size, 2);
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
    ctx.ellipse(0, -size * 0.85, size * 0.42, size * 0.78, 0, 0, Math.PI * 2);
    ctx.fillStyle = cssRgb(palette.petal);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
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
  const sway = grassSway(clockMs, flower.x, 2) * 4;
  const x = flower.x * w + sway;
  const y = flower.y * h;
  const stem = 16 + flower.scale * 10;
  drawStem(ctx, x, y, stem, flower.rot + sway * 0.02, light);
  drawFlowerHead(ctx, flower, x + flower.rot * 6, y - stem, flower.scale, light, bloom);
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
  const len = blade.len * h;
  const tipX = x + sway * 10;
  const color = litColor(
    blade.layer === 0 ? { r: 86, g: 168, b: 58 } : { r: 62, g: 132, b: 46 },
    light,
  );
  ctx.beginPath();
  ctx.moveTo(x - 1.2, y);
  ctx.quadraticCurveTo(x + sway * 4, y - len * 0.55, tipX, y - len);
  ctx.quadraticCurveTo(x + 1.4 + sway * 3, y - len * 0.5, x + 1.4, y);
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
    { y: 0.68, amp: 7, color: { r: 48, g: 102, b: 40 }, layer: 2 },
    { y: 0.76, amp: 9, color: { r: 70, g: 138, b: 48 }, layer: 1 },
    { y: 0.86, amp: 11, color: { r: 96, g: 168, b: 58 }, layer: 0 },
  ];
  for (const ribbon of ribbons) {
    const sway = grassSway(clockMs, 0.4, ribbon.layer);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, ribbon.y * h);
    const steps = 26;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = t * w;
      const wave = Math.sin(t * 10 + ribbon.layer + sway) * ribbon.amp;
      ctx.lineTo(x, ribbon.y * h + wave);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = cssRgb(litColor(ribbon.color, light));
    ctx.fill();
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
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
    glow.addColorStop(0, `rgba(220, 255, 120, ${alpha * pulse})`);
    glow.addColorStop(1, "rgba(220, 255, 120, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(240, 255, 170, ${alpha * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
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
  ctx.strokeStyle = `rgba(40, 48, 42, ${0.45 * alpha})`;
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  for (const bird of world.birds) {
    const flap = 0.35 + 0.2 * Math.sin(clockMs * 0.006 + bird.seed);
    const x = bird.x * w;
    const y = bird.y * h;
    const s = 7 * bird.scale;
    ctx.beginPath();
    ctx.moveTo(x - s, y + flap * 3);
    ctx.quadraticCurveTo(x, y - s * 0.35, x, y);
    ctx.quadraticCurveTo(x, y - s * 0.35, x + s, y + flap * 3);
    ctx.stroke();
  }
}

function drawReadout(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  phaseLabel: string,
): void {
  const pct = `${Math.round(progress * 100)}%`;
  ctx.save();
  ctx.font = "600 10px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(238, 242, 248, 0.55)";
  ctx.textAlign = "left";
  ctx.fillText("SUNRISE", 16, h - 28);
  ctx.font = "700 18px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(238, 242, 248, 0.88)";
  ctx.fillText(`${phaseLabel}  ·  ${pct}`, 16, h - 10);
  ctx.restore();
  void w;
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
  const p = sunElevationSafe(progress);
  const light = timeLight(p);
  const bloom = bloomAmount(p);

  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, w, h, p, light);
  drawStars(ctx, world, w, h, p, clockMs);
  drawMoon(ctx, p, w, h);
  drawSunPath(ctx, w, h, p);
  drawSun(ctx, p, w, h);
  drawHills(ctx, world, w, h, light, clockMs);

  const farFlowers = world.flowers.filter((flower) => flower.y < 0.78);
  const nearFlowers = world.flowers.filter((flower) => flower.y >= 0.78);
  for (const flower of farFlowers) {
    drawFlower(ctx, flower, w, h, light, bloom, clockMs);
  }
  for (const tree of world.trees) {
    drawAppleTree(ctx, tree, w, h, light);
  }

  drawGrassRibbons(ctx, w, h, light, clockMs);
  for (const blade of world.blades) {
    if (blade.layer === 1) {
      drawBlade(ctx, blade, w, h, light, clockMs);
    }
  }
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
  drawReadout(ctx, w, h, p, gardenPhaseLabel(gardenPhase(p)));
}

function sunElevationSafe(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress));
}
