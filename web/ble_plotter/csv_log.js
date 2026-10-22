/**
 * CSV v8 columns. v2 pods have no magnetometer and send raw gyro, so the
 * quaternion and magnetometer columns appear only when a pod carries them.
 */
const BASE_COLUMNS = [
  "position", "device_id", "rate_hz", "sample_index", "sample_ms",
  "arrival_ms", "capture_phase", "stationary",
  "ax_g", "ay_g", "az_g", "gx_dps", "gy_dps", "gz_dps",
];
const QUAT_COLUMNS = ["qw", "qx", "qy", "qz"];
const MAG_COLUMNS = ["mx_G", "my_G", "mz_G"];
const PHASES = ["bias_start", "motion", "bias_end", "drain"];

/** ~4.5 min at 4 pods × 224 Hz, or ~9 min at one pod × 448 Hz. */
const DEFAULT_CAPACITY = 240000;

/**
 * Ring-buffer capture logger.
 *
 * Samples go into preallocated typed arrays and become text only on
 * download. Building a string per frame put ~150 B of garbage per sample
 * on the same thread that receives the BLE notifications. Newest samples
 * overwrite the oldest once capacity is reached.
 */
export class CsvLogger {
  /**
   * @param {{capacity?: number}} [opts]
   */
  constructor(opts = {}) {
    this.capacity = opts.capacity || DEFAULT_CAPACITY;
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = false;
    this.t0 = 0;
    /** @type {string[]} */
    this.headerLines = [];
    /** @type {Array<{position:string,deviceId:string,rateHz:number,firstSeq:number,hasMag:boolean,fused:boolean,integrity:object}>} */
    this.pods = [];
    this.podIndex = new Map();
    this.onChange = null;
    this._session = null;
    this.phase = "idle";
    this.state = "idle";
    this.stillnessMs = 2000;
    this._ext = false;
    this._allocated = false;
  }

  _alloc(ext) {
    if (this._allocated && this._ext === ext) return;
    const cap = this.capacity;
    this.podIx = new Uint8Array(cap);
    this.phaseIx = new Uint8Array(cap);
    this.idx = new Uint32Array(cap);
    this.arrival = new Float32Array(cap);
    /* ax ay az (g), gx gy gz (dps) */
    this.eng = new Float32Array(cap * 6);
    /* qw qx qy qz, mx my mz: only for pods with a magnetometer */
    this.ext = ext ? new Float32Array(cap * 7) : null;
    this._ext = ext;
    this._allocated = true;
  }

  /**
   * @param {{
   *   liveRateHz:number,
   *   logRateHz:number,
   *   batchFrames?:number,
   *   pods:Array<{id:string,position:string,podId:number,sync?:object,caps?:object}>
   * }} session
   */
  start(session) {
    this._alloc((session.pods || []).some((p) => p.caps?.hasMag));
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = true;
    this.t0 = performance.now();
    this.pods = [];
    this.podIndex.clear();
    this._session = session;
    this.phase = "bias_start";
    this.state = "bias_start";
    this.stillnessMs = session.stillnessMs || 2000;
    this.headerLines = this._buildHeader(session);
    this._emit();
  }

  stop() {
    this.recording = false;
    this.phase = "idle";
    this.state = "idle";
    this._emit();
  }

  beginEndStillness() {
    if (this.recording) {
      this.phase = "bias_end";
      this.state = "stop_requested";
    }
  }

  beginDrain() {
    if (this.recording) {
      this.phase = "drain";
      this.state = "draining";
    }
  }

  finalize() {
    if (this.recording) this.state = "finalized";
  }

  clear() {
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = false;
    this.headerLines = [];
    this.pods = [];
    this.podIndex.clear();
    this._session = null;
    this.phase = "idle";
    this.state = "idle";
    this._emit();
  }

  /**
   * @param {{seq:number, sampleIndex?:number, eng:object, quat?:{qw:number,qx:number,qy:number,qz:number}}} frame
   * @param {{position:string,deviceId:string,rateHz:number,hasMag?:boolean,fused?:boolean,sessionStatus?:object,missingFrames?:number,gapEvents?:number}} pod
   */
  push(frame, pod) {
    if (!this.recording) return;
    if (this._session?.captureId &&
        pod.sessionStatus?.captureId === this._session.captureId &&
        pod.sessionStatus.stateName === "prepared") {
      return;
    }
    const id = pod.deviceId || "unknown";
    let pi = this.podIndex.get(id);
    if (pi === undefined) {
      if (this.pods.length >= 255) return;
      pi = this.pods.length;
      this.pods.push({
        position: pod.position || "",
        deviceId: id,
        rateHz: pod.rateHz || 100,
        firstSeq: (frame.sampleIndex ?? frame.seq) >>> 0,
        hasMag: Boolean(pod.hasMag),
        fused: Boolean(pod.fused),
        integrity: {},
      });
      this.podIndex.set(id, pi);
    }
    const st = this.pods[pi];
    st.rateHz = pod.rateHz || st.rateHz;
    const protocol = pod.sessionStatus || {};
    st.integrity = {
      missingFrames: pod.missingFrames,
      gapEvents: pod.gapEvents,
      sensorDropped: protocol.sensorDropped,
      transportDropped: protocol.transportDropped,
      notifyFailures: protocol.notifyFailures,
    };

    const elapsedMs = performance.now() - this.t0;
    if (this.phase === "bias_start" && elapsedMs >= this.stillnessMs) {
      this.phase = "motion";
      this.state = "motion";
    }

    const k = this.write;
    const e = frame.eng;
    this.podIx[k] = pi;
    this.phaseIx[k] = Math.max(0, PHASES.indexOf(this.phase));
    this.idx[k] = (frame.sampleIndex ?? frame.seq) >>> 0;
    this.arrival[k] = elapsedMs;
    const b = k * 6;
    this.eng[b] = e.ax;
    this.eng[b + 1] = e.ay;
    this.eng[b + 2] = e.az;
    this.eng[b + 3] = e.gx;
    this.eng[b + 4] = e.gy;
    this.eng[b + 5] = e.gz;
    if (this.ext) {
      const x = k * 7;
      const q = frame.quat;
      this.ext[x] = q ? q.qw : NaN;
      this.ext[x + 1] = q ? q.qx : NaN;
      this.ext[x + 2] = q ? q.qy : NaN;
      this.ext[x + 3] = q ? q.qz : NaN;
      this.ext[x + 4] = st.hasMag ? e.mx : NaN;
      this.ext[x + 5] = st.hasMag ? e.my : NaN;
      this.ext[x + 6] = st.hasMag ? e.mz : NaN;
    }

    if (this.count === this.capacity) this.dropped += 1;
    this.write = (this.write + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;

    if (this.count % 50 === 0 || this.dropped % 50 === 1) this._emit();
  }

  get rowCount() {
    return this.count;
  }

  get droppedCount() {
    return this.dropped;
  }

  /** Column list for this capture: optional groups only when a pod sent them. */
  get columns() {
    const quat = Boolean(this.ext) && this.pods.some((p) => p.fused);
    const mag = Boolean(this.ext) && this.pods.some((p) => p.hasMag);
    return [
      ...BASE_COLUMNS,
      ...(quat ? QUAT_COLUMNS : []),
      ...(mag ? MAG_COLUMNS : []),
    ];
  }

  download(filename = "c3_tracker_log.csv") {
    if (this.count < 1) return;
    const cols = this.columns;
    const quat = cols.includes("qw");
    const mag = cols.includes("mx_G");
    const parts = [
      ...this.headerLines,
      ...this._integrityLines(),
      `# columns=${cols.join(",")}`,
      cols.join(","),
    ];
    const start = this.count < this.capacity ? 0 : this.write;
    for (let i = 0; i < this.count; i++) {
      const k = (start + i) % this.capacity;
      const p = this.pods[this.podIx[k]];
      const si = this.idx[k];
      const sampleMs = (((si - p.firstSeq) >>> 0) * 1000) / p.rateHz;
      const b = k * 6;
      const ax = this.eng[b];
      const ay = this.eng[b + 1];
      const az = this.eng[b + 2];
      const stationary = Math.abs(Math.hypot(ax, ay, az) - 1) <= 0.08 ? 1 : 0;
      const row = [
        csvEscape(p.position),
        p.deviceId,
        p.rateHz,
        si,
        sampleMs.toFixed(1),
        this.arrival[k].toFixed(1),
        PHASES[this.phaseIx[k]],
        stationary,
        fmt(ax, 6), fmt(ay, 6), fmt(az, 6),
        fmt(this.eng[b + 3], 4), fmt(this.eng[b + 4], 4), fmt(this.eng[b + 5], 4),
      ];
      if (quat || mag) {
        const x = k * 7;
        if (quat) {
          row.push(fmt(this.ext[x], 6), fmt(this.ext[x + 1], 6),
            fmt(this.ext[x + 2], 6), fmt(this.ext[x + 3], 6));
        }
        if (mag) {
          row.push(fmt(this.ext[x + 4], 6), fmt(this.ext[x + 5], 6),
            fmt(this.ext[x + 6], 6));
        }
      }
      parts.push(row.join(","));
    }
    const blob = new Blob([parts.join("\n") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** One line per pod with the last host and device counters seen. */
  _integrityLines() {
    return this.pods.map((p) => {
      const n = p.integrity || {};
      const v = (x) => (x ?? "");
      return `# integrity=position:${csvEscape(p.position)};device:${p.deviceId}` +
        `;missing_frames:${v(n.missingFrames)};gap_events:${v(n.gapEvents)}` +
        `;sensor_dropped:${v(n.sensorDropped)};transport_dropped:${v(n.transportDropped)}` +
        `;notify_failures:${v(n.notifyFailures)}`;
    });
  }

  _buildHeader(session) {
    const iso = new Date().toISOString();
    const pods = session.pods || [];
    const lines = [
      "# C3-Tracker CSV v8",
      `# created_iso=${iso}`,
      `# format=comment_meta_then_columns`,
      `# live_rate_hz=${session.liveRateHz}`,
      `# log_rate_hz=${session.logRateHz}`,
      `# batch_frames=${session.batchFrames ?? ""}`,
      `# capture_id=${session.captureId ?? ""}`,
      "# session_state=PREPARE→PROBE→BIAS_START→MOTION→STOP_REQUESTED→DRAIN→FINALIZE",
      `# ring_capacity=${this.capacity}`,
      `# pod_count=${pods.length}`,
      `# required_stillness_ms=${session.stillnessMs || 2000}`,
      "# timebase=sample_ms is sample_index-derived at rate_hz; arrival_ms is ms since Start and is shared by every frame in one notify",
      "# units=ax/ay/az g (body); gx/gy/gz dps (body); qw..qz and mx/my/mz only when a pod sends them",
      "# stationary_candidate=abs(|accel|-1)<=0.08g",
      "# integrity_note=per-pod lines below hold the last host sequence counters and device snapshot",
      `# training_profile=${session.trainingProfile || 0};station=${session.trainingStation || ""}`,
      `# preflight=${csvEscape(session.preflightSummary || "")}`,
    ];
    pods.forEach((p, i) => {
      const sync = p.sync?.ok
        ? `rtt_ms=${Math.round(p.sync.rttMs)};offset_ms=${Number(p.sync.offsetMs).toFixed(1)}`
        : "sync=off";
      lines.push(
        `# pod${i}=id:${p.id};position:${csvEscape(p.position || "")};pod_id:${p.podId ?? ""};proto:${p.protocolVersion ?? ""};${sync}`
      );
      if (p.caps) {
        lines.push(
          `# pod${i}_caps=mtu:${p.caps.attMtu ?? ""};max_batch:${p.caps.maxBatchFrames ?? ""};imu:${p.caps.imuRateHz ?? ""};mag:${p.caps.magRateHz ?? ""};hw:${p.caps.hwRev ?? ""}`
        );
      }
      if (p.magCalibration) {
        const c = p.magCalibration;
        lines.push(
          `# pod${i}_mag_cal=offset:${c.offset.join("/")};scale:${c.scale.join("/")};created:${c.createdIso}`
        );
      }
    });
    return lines;
  }

  _emit() {
    if (this.onChange) this.onChange(this);
  }
}

function fmt(value, digits) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "";
}

function csvEscape(s) {
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}
