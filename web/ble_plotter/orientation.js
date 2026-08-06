/**
 * Tilt from accel + tilt-compensated yaw from mag (no gyro fusion yet).
 * Returns radians: { roll, pitch, yaw }
 */
export function attitudeFromSensors(ax, ay, az, mx, my, mz) {
  const roll = Math.atan2(ay, az);
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az) || 1e-6);

  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const mxh = mx * cp + mz * sp;
  const myh = mx * sr * sp + my * cr - mz * sr * cp;
  const yaw = Math.atan2(-myh, mxh);

  return { roll, pitch, yaw };
}

/** Shortest signed delta between two angles (radians). */
function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class OrientationCube {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ smooth?: number }} [opts] smooth in (0,1]; lower = stickier
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.smooth = opts.smooth ?? 0.12;
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this._hasSample = false;
  }

  setAttitude(roll, pitch, yaw) {
    if (!this._hasSample) {
      this.roll = roll;
      this.pitch = pitch;
      this.yaw = yaw;
      this._hasSample = true;
      return;
    }
    const a = this.smooth;
    this.roll += a * angleDelta(this.roll, roll);
    this.pitch += a * angleDelta(this.pitch, pitch);
    this.yaw += a * angleDelta(this.yaw, yaw);
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 8;
    const size = Math.min(w, h) * 0.32;

    const verts = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ];

    const cr = Math.cos(this.roll);
    const sr = Math.sin(this.roll);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cyaw = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);

    /* Orthographic (parallel) projection — no perspective foreshortening. */
    const projected = verts.map(([x, y, z]) => {
      let x1 = x * cyaw - y * sy;
      let y1 = x * sy + y * cyaw;
      let z1 = z;

      let x2 = x1 * cp + z1 * sp;
      let y2 = y1;
      let z2 = -x1 * sp + z1 * cp;

      let x3 = x2;
      let y3 = y2 * cr - z2 * sr;
      let z3 = y2 * sr + z2 * cr;

      return {
        x: cx + x3 * size,
        y: cy - y3 * size,
        z: z3,
      };
    });

    /* High-contrast faces: +X red, +Y green, +Z blue (RGB body axes). */
    const faces = [
      { idx: [1, 2, 6, 5], color: "#e74c3ccc", edge: "#ff6b6b", label: "+X" },
      { idx: [0, 3, 7, 4], color: "#c0392bcc", edge: "#e74c3c", label: "-X" },
      { idx: [2, 3, 7, 6], color: "#27ae60cc", edge: "#2ecc71", label: "+Y" },
      { idx: [0, 1, 5, 4], color: "#1e8449cc", edge: "#27ae60", label: "-Y" },
      { idx: [4, 5, 6, 7], color: "#2980b9cc", edge: "#3498db", label: "+Z" },
      { idx: [0, 1, 2, 3], color: "#1a5276cc", edge: "#2980b9", label: "-Z" },
    ];

    faces.sort((a, b) => {
      const za = a.idx.reduce((s, i) => s + projected[i].z, 0);
      const zb = b.idx.reduce((s, i) => s + projected[i].z, 0);
      return za - zb;
    });

    for (const face of faces) {
      ctx.beginPath();
      face.idx.forEach((i, n) => {
        const p = projected[i];
        if (n === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = face.color;
      ctx.fill();
      ctx.strokeStyle = face.edge;
      ctx.lineWidth = 2;
      ctx.stroke();

      /* Face label at centroid of nearest faces */
      const cxF = face.idx.reduce((s, i) => s + projected[i].x, 0) / 4;
      const cyF = face.idx.reduce((s, i) => s + projected[i].y, 0) / 4;
      const czF = face.idx.reduce((s, i) => s + projected[i].z, 0) / 4;
      if (czF > -0.2) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(face.label, cxF, cyF);
      }
    }

    ctx.fillStyle = "#c5d0e0";
    ctx.font = "13px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      `roll ${rad2deg(this.roll).toFixed(0)}°   pitch ${rad2deg(this.pitch).toFixed(0)}°   yaw ${rad2deg(this.yaw).toFixed(0)}°`,
      12,
      12
    );
  }
}

function rad2deg(r) {
  return (r * 180) / Math.PI;
}
