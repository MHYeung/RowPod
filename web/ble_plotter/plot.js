const CAPACITY = 300;
const PAD_L = 48;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 8;
const PLOT_GRID = "#5f535d";
const PLOT_ZERO = "#7c707a";
const PLOT_TEXT = "#e0e4d5";

export class MultiPlot {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string[]} channelKeys base channel keys (ax, ay, ...)
   * @param {{unit?: string, tickCount?: number}} [opts]
   */
  constructor(canvas, channelKeys, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.channelKeys = channelKeys;
    this.unit = opts.unit || "";
    this.tickCount = opts.tickCount ?? 5;
    /** @type {Map<string,{color:string,enabled:boolean,buffers:Record<string,Float32Array>,write:number,count:number}>} */
    this.series = new Map();
    this.channelEnabled = Object.fromEntries(channelKeys.map((k) => [k, true]));
  }

  ensureSeries(id, color) {
    if (this.series.has(id)) {
      const s = this.series.get(id);
      s.color = color;
      return;
    }
    this.series.set(id, {
      color,
      enabled: true,
      buffers: Object.fromEntries(
        this.channelKeys.map((k) => [k, new Float32Array(CAPACITY)])
      ),
      write: 0,
      count: 0,
    });
  }

  removeSeries(id) {
    this.series.delete(id);
  }

  setSeriesEnabled(id, on) {
    const s = this.series.get(id);
    if (s) s.enabled = on;
  }

  setChannelEnabled(key, on) {
    if (key in this.channelEnabled) this.channelEnabled[key] = on;
  }

  /** @deprecated single-pod API */
  setEnabled(key, on) {
    this.setChannelEnabled(key, on);
  }

  /**
   * @param {string} id series/pod id
   * @param {Record<string,number>} sample engineering units for channelKeys
   */
  pushSeries(id, sample) {
    const s = this.series.get(id);
    if (!s) return;
    for (const k of this.channelKeys) {
      s.buffers[k][s.write] = sample[k] ?? 0;
    }
    s.write = (s.write + 1) % CAPACITY;
    s.count = Math.min(s.count + 1, CAPACITY);
  }

  /** @deprecated single-pod API — uses first series or creates "default" */
  push(sample) {
    if (!this.series.has("default")) {
      this.ensureSeries("default", "#3d9cf0");
    }
    this.pushSeries("default", sample);
  }

  _range() {
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.series.values()) {
      if (!s.enabled) continue;
      for (const k of this.channelKeys) {
        if (!this.channelEnabled[k]) continue;
        for (let i = 0; i < s.count; i++) {
          const v = s.buffers[k][i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
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

    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let t = 0; t < this.tickCount; t++) {
      const frac = t / (this.tickCount - 1);
      const val = max - frac * span;
      const y = PAD_T + frac * plotH;
      ctx.strokeStyle = PLOT_GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(w - PAD_R, y);
      ctx.stroke();
      ctx.fillStyle = PLOT_TEXT;
      const label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(2);
      ctx.fillText(label, PAD_L - 6, y);
    }

    if (min < 0 && max > 0) {
      const y0 = PAD_T + ((max - 0) / span) * plotH;
      ctx.strokeStyle = PLOT_ZERO;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y0);
      ctx.lineTo(w - PAD_R, y0);
      ctx.stroke();
    }

    for (const s of this.series.values()) {
      if (!s.enabled || s.count < 2) continue;
      for (const k of this.channelKeys) {
        if (!this.channelEnabled[k]) continue;
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < s.count; i++) {
          const idx = (s.write - s.count + i + CAPACITY) % CAPACITY;
          const x = PAD_L + (i / (CAPACITY - 1)) * plotW;
          const y = PAD_T + ((max - s.buffers[k][idx]) / span) * plotH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (this.unit) {
      ctx.fillStyle = PLOT_TEXT;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(this.unit, PAD_L + 4, 2);
    }
  }
}
