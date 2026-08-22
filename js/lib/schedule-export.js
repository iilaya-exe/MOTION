import { classesOnDay, colorClass, formatTime, layoutDayBlocks, toMinutes, weekDaysShown } from "./schedule.js";
import { DAY_FULL } from "./dates.js";

/* Schedule → image.
   Drawn onto a canvas from the same layout data the on-screen grid uses, rather
   than screenshotting the DOM. That avoids a rasteriser dependency entirely,
   and it means the export is not limited to what happens to be scrolled into
   view — the whole week is always in frame, at whatever resolution we choose. */

const SCALE = 2; // drawn at 2x, so the file is crisp on a retina screen
const PAD = 34;
const TITLE_H = 62;
const HEAD_H = 40;
const HOUR_H = 62;
const TIME_W = 86;
const DAY_W = 168;
const LEGEND_H = 46;

/**
 * Resolves CSS custom properties so the image uses the live theme's palette.
 *
 * Every name must carry a fallback. Assigning an empty string to fillStyle is
 * silently ignored by canvas, which means an unresolved variable does not throw
 * — it quietly keeps whatever colour was set last, and the export comes out
 * white-on-white with no error anywhere. Defaults make that impossible.
 *
 * @param {Record<string,string>} spec variable name → fallback colour
 */
function readVars(spec, className = "") {
  const probe = document.createElement("div");
  probe.className = className;
  probe.style.cssText = "position:absolute;left:-9999px;width:0;height:0";
  document.body.appendChild(probe);

  const cs = getComputedStyle(probe);
  const out = {};
  for (const [name, fallback] of Object.entries(spec)) {
    out[name] = (cs.getPropertyValue(name) || "").trim() || fallback;
  }

  probe.remove();
  return out;
}

/** Light-theme values, used when a variable cannot be resolved. */
const THEME_FALLBACK = {
  "--surface": "#ffffff",
  "--surface-2": "#fafafb",
  "--text": "#101014",
  "--text-2": "#4a4a55",
  "--text-3": "#74747f",
  "--border": "#e7e7ee",
  "--accent": "#5b5bd6",
};

const CLASS_FALLBACK = { "--cc": "#5b5bd6", "--cc-soft": "#eef0fe" };

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Safari < 16 has no roundRect.
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Trims with an ellipsis so a long room name cannot overflow its block. */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/**
 * Renders the whole week to a canvas.
 * @param {object[]} classes
 * @param {{opaque?: boolean}} opts — JPEG has no alpha, so it needs a filled background
 */
export function renderScheduleCanvas(classes, { opaque = true } = {}) {
  if (!classes.length) return null;

  const theme = readVars(THEME_FALLBACK);

  const days = weekDaysShown(classes);
  const fromHr = Math.floor(Math.min(...classes.map((c) => toMinutes(c.start))) / 60);
  let toHr = Math.ceil(Math.max(...classes.map((c) => toMinutes(c.end))) / 60);
  if (toHr <= fromHr) toHr = fromHr + 1;
  const hours = toHr - fromHr;

  const gridW = TIME_W + days.length * DAY_W;
  const width = PAD * 2 + gridW;
  const height = PAD * 2 + TITLE_H + HEAD_H + hours * HOUR_H + LEGEND_H;

  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;

  const ctx = canvas.getContext("2d");
  // Browsers may hand back null (canvas disabled, or too many live contexts).
  // Better to report "export unavailable" than to throw mid-draw.
  if (!ctx) return null;

  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "middle";

  const font = (size, weight = 400) =>
    `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  // Background — always filled, so a PNG dropped on a dark page still reads.
  ctx.fillStyle = theme["--surface"];
  if (opaque) ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = theme["--text"];
  ctx.font = font(24, 700);
  ctx.fillText("Weekly Schedule", PAD, PAD + 14);

  ctx.fillStyle = theme["--text-3"];
  ctx.font = font(12, 500);
  ctx.fillText(
    `${classes.length} class${classes.length === 1 ? "" : "es"} · exported ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`,
    PAD,
    PAD + 38
  );

  const gridTop = PAD + TITLE_H;

  // Header band
  ctx.fillStyle = theme["--surface-2"];
  ctx.fillRect(PAD, gridTop, gridW, HEAD_H);

  ctx.fillStyle = theme["--text-2"];
  ctx.font = font(13, 650);
  ctx.textAlign = "center";
  days.forEach((d, i) => {
    ctx.fillText(DAY_FULL[d], PAD + TIME_W + i * DAY_W + DAY_W / 2, gridTop + HEAD_H / 2);
  });

  // Hour rows and their labels
  const bodyTop = gridTop + HEAD_H;
  ctx.strokeStyle = theme["--border"];
  ctx.lineWidth = 1;

  for (let h = 0; h <= hours; h++) {
    const y = bodyTop + h * HOUR_H;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 0.5);
    ctx.lineTo(PAD + gridW, y + 0.5);
    ctx.stroke();

    if (h < hours) {
      const hr = fromHr + h;
      const h12 = hr % 12 === 0 ? 12 : hr % 12;
      ctx.fillStyle = theme["--text-3"];
      ctx.font = font(11, 600);
      ctx.textAlign = "right";
      ctx.fillText(`${h12}:00 ${hr >= 12 ? "PM" : "AM"}`, PAD + TIME_W - 12, y + HOUR_H / 2);
    }
  }

  // Column separators
  for (let i = 0; i <= days.length; i++) {
    const x = PAD + TIME_W + i * DAY_W;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, gridTop);
    ctx.lineTo(x + 0.5, bodyTop + hours * HOUR_H);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(PAD + TIME_W + 0.5, gridTop);
  ctx.lineTo(PAD + TIME_W + 0.5, bodyTop + hours * HOUR_H);
  ctx.stroke();

  // Class blocks — same lane packing as the on-screen grid
  days.forEach((d, dayIndex) => {
    const items = classesOnDay(classes, d).map((c) => ({
      c, s: toMinutes(c.start), e: toMinutes(c.end),
    }));

    layoutDayBlocks(items).forEach((it) => {
      const colors = readVars(CLASS_FALLBACK, colorClass(it.c));
      const laneW = (DAY_W - 8) / it.lanes;
      const x = PAD + TIME_W + dayIndex * DAY_W + 4 + it.lane * laneW;
      const y = bodyTop + ((it.s - fromHr * 60) / 60) * HOUR_H + 2;
      const w = laneW - 4;
      const h = Math.max(((it.e - it.s) / 60) * HOUR_H - 4, 26);

      roundRect(ctx, x, y, w, h, 7);
      ctx.fillStyle = colors["--cc-soft"];
      ctx.fill();
      ctx.strokeStyle = colors["--cc"];
      ctx.lineWidth = 1;
      ctx.stroke();

      // Colour spine down the left edge
      ctx.fillStyle = colors["--cc"];
      roundRect(ctx, x, y, 3.5, h, 2);
      ctx.fill();

      ctx.textAlign = "left";
      const textX = x + 10;
      const textW = w - 16;

      ctx.fillStyle = colors["--cc"];
      ctx.font = font(12, 700);
      const label = (it.c.emoji ? it.c.emoji + " " : "") + it.c.subject +
        (it.c.section ? `-${it.c.section}` : "");
      ctx.fillText(fit(ctx, label, textW), textX, y + 15);

      if (h > 34) {
        ctx.fillStyle = theme["--text-2"];
        ctx.font = font(10.5, 500);
        ctx.fillText(
          fit(ctx, `${formatTime(it.c.start)} – ${formatTime(it.c.end)}`, textW),
          textX,
          y + 31
        );
      }
      if (h > 50 && it.c.room) {
        ctx.fillStyle = theme["--text-3"];
        ctx.font = font(10.5, 500);
        ctx.fillText(fit(ctx, it.c.room, textW), textX, y + 46);
      }
    });
  });

  // Legend
  ctx.textAlign = "left";
  let lx = PAD;
  const ly = bodyTop + hours * HOUR_H + 26;
  ctx.font = font(11, 600);

  [...classes]
    .sort((a, b) => a.subject.localeCompare(b.subject))
    .forEach((c) => {
      const colors = readVars(CLASS_FALLBACK, colorClass(c));
      const label = c.subject + (c.section ? `-${c.section}` : "");
      const w = ctx.measureText(label).width + 22;

      if (lx + w > PAD + gridW) return; // silently drop what will not fit on one line

      ctx.fillStyle = colors["--cc"];
      roundRect(ctx, lx, ly - 4, 9, 9, 3);
      ctx.fill();

      ctx.fillStyle = theme["--text-2"];
      ctx.fillText(label, lx + 14, ly);
      lx += w;
    });

  return canvas;
}

/**
 * Renders and downloads the schedule.
 * @param {"png"|"jpeg"} format
 * @returns {Promise<boolean>} false if there was nothing to export
 */
export function exportSchedule(classes, format = "png") {
  const canvas = renderScheduleCanvas(classes, { opaque: true });
  if (!canvas) return Promise.resolve(false);

  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const ext = format === "jpeg" ? "jpg" : "png";

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(false);

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `motion-schedule-${new Date().toISOString().slice(0, 10)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        // Revoking immediately can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        resolve(true);
      },
      mime,
      format === "jpeg" ? 0.92 : undefined
    );
  });
}
