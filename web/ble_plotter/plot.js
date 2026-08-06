const CAPACITY = 300;
const PAD_L = 48;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 8;

export class MultiPlot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string[]} keys
   * @param {Record<string,string>} colors
   * @param {{fixedMin?: number, fixedMax?: number, unit?: string, tickCount?: number}} [opts]
   */
  constructor(canvas, keys, colors, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.keys = keys;
    this.colors = colors;
    this.fixedMin = opts.fixedMin;
    this.fixedMax = opts.fixedMax;
    this.unit = opts.unit || "";
    this.tickCount = opts.tickCount ?? 5;
    this.enabled = Object.fromEntries(keys.map((k) => [k, true]));
    this.buffers = Object.fromEntries(keys.map((k) => [k, new Float32Array(CAPACITY)]));
    this.write = 0;
    this.count = 0;
  }

  setEnabled(key, on) {
    if (key in this.enabled) this.enabled[key] = on;
  }

  push(sample) {
    for (const k of this.keys) {
      this.buffers[k][this.write] = sample[k] ?? 0;
    }
    this.write = (this.write + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  _range() {
    if (Number.isFinite(this.fixedMin) && Number.isFinite(this.fixedMax)) {
      return { min: this.fixedMin, max: this.fixedMax };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const k of this.keys) {
      if (!this.enabled[k]) continue;
      for (let i = 0; i < this.count; i++) {
        const v = this.buffers[k][i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = -1;
      max = 1;
    }
    const pad = (max - min) * 0.1 || 0.1;
    return { min: min - pad, max: max + pad };
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const plotW = w - PAD_L - PAD_R;
    const plotH = h - PAD_T - PAD_B;
    ctx.clearRect(0, 0, w, h);

    const { min, max } = this._range();
    const span = max - min || 1;

    /* Grid + Y labels */
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let t = 0; t < this.tickCount; t++) {
      const frac = t / (this.tickCount - 1);
      const val = max - frac * span;
      const y = PAD_T + frac * plotH;
      ctx.strokeStyle = "#243044";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(w - PAD_R, y);
      ctx.stroke();
      ctx.fillStyle = "#8b9bb4";
      const label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(2);
      ctx.fillText(label, PAD_L - 6, y);
    }

    /* Zero line when in range */
    if (min < 0 && max > 0) {
      const y0 = PAD_T + ((max - 0) / span) * plotH;
      ctx.strokeStyle = "#3a4a63";
      ctx.beginPath();
      ctx.moveTo(PAD_L, y0);
      ctx.lineTo(w - PAD_R, y0);
      ctx.stroke();
    }

    /* Traces */
    for (const k of this.keys) {
      if (!this.enabled[k] || this.count < 2) continue;
      ctx.strokeStyle = this.colors[k];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < this.count; i++) {
        const idx = (this.write - this.count + i + CAPACITY) % CAPACITY;
        const x = PAD_L + (i / (CAPACITY - 1)) * plotW;
        const y = PAD_T + ((max - this.buffers[k][idx]) / span) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (this.unit) {
      ctx.fillStyle = "#8b9bb4";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(this.unit, PAD_L + 4, 2);
    }
  }
}
