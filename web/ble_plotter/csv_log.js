/** Column header row (data table starts after # meta comments). */
export const CSV_COLUMNS =
  "position,device_id,pod_id,rate_hz,sample_index,sample_ms,arrival_ms," +
  "capture_phase,stationary,qw,qx,qy,qz,ax_g,ay_g,az_g,mx_G,my_G,mz_G," +
  "missing_frames,gap_events,sensor_dropped,transport_dropped,notify_failures";

/** Default ring capacity: ~6 min @ 448 Hz one pod, or ~4 min @ 4×112 Hz. */
const DEFAULT_CAPACITY = 120000;

/**
 * Ring-buffer CSV logger for on-device Mahony output.
 * Newest samples overwrite the oldest once capacity is reached.
 */
export class CsvLogger {
  /**
   * @param {{capacity?: number}} [opts]
   */
  constructor(opts = {}) {
    this.capacity = opts.capacity || DEFAULT_CAPACITY;
    /** @type {(string|undefined)[]} */
    this.ring = new Array(this.capacity);
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = false;
    this.t0 = 0;
    /** @type {string[]} */
    this.headerLines = [];
    /** @type {Map<string,{firstSeq:number|null,rateHz:number,position:string,podId:number}>} */
    this.podState = new Map();
    this.onChange = null;
    this._session = null;
    this.phase = "idle";
    this.state = "idle";
    this.stillnessMs = 2000;
  }

  /**
   * @param {{
   *   liveRateHz:number,
   *   logRateHz:number,
   *   pods:Array<{id:string,position:string,podId:number,sync?:object}>
   * }} session
   */
  start(session) {
    this.ring = new Array(this.capacity);
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = true;
    this.t0 = performance.now();
    this.podState.clear();
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
    this.ring = new Array(this.capacity);
    this.write = 0;
    this.count = 0;
    this.dropped = 0;
    this.recording = false;
    this.headerLines = [];
    this.podState.clear();
    this._session = null;
    this.phase = "idle";
    this.state = "idle";
    this._emit();
  }

  /**
   * @param {{seq:number, sampleIndex?:number, eng:object, quat?:{qw:number,qx:number,qy:number,qz:number}}} frame
   * @param {{position:string,deviceId:string,podId:number,rateHz:number,sessionStatus?:object,missingFrames?:number,gapEvents?:number}} pod
   */
  push(frame, pod) {
    if (!this.recording) return;
    if (this._session?.captureId &&
        pod.sessionStatus?.captureId === this._session.captureId &&
        pod.sessionStatus.stateName === "prepared") {
      return;
    }
    const id = pod.deviceId || "unknown";
    let st = this.podState.get(id);
    if (!st) {
      st = {
        firstSeq: null,
        rateHz: pod.rateHz || 100,
        position: pod.position || "",
        podId: pod.podId ?? 0,
      };
      this.podState.set(id, st);
    }
    st.rateHz = pod.rateHz || st.rateHz;
    const sampleIndex = frame.sampleIndex ?? frame.seq;
    if (st.firstSeq === null) st.firstSeq = sampleIndex;

    const elapsedMs = performance.now() - this.t0;
    if (this.phase === "bias_start" && elapsedMs >= this.stillnessMs) {
      this.phase = "motion";
      this.state = "motion";
    }
    const sampleMs = ((Math.max(0, sampleIndex - st.firstSeq) * 1000) / st.rateHz);
    const e = frame.eng;
    const q = frame.quat;
    const protocol = pod.sessionStatus || {};
    const accelNorm = Math.hypot(e.ax, e.ay, e.az);
    const stationary = Math.abs(accelNorm - 1) <= 0.08 ? 1 : 0;
    const line = [
      csvEscape(pod.position || ""),
      id,
      pod.podId ?? "",
      st.rateHz,
      sampleIndex,
      sampleMs.toFixed(1),
      elapsedMs.toFixed(1),
      this.phase,
      stationary,
      q ? fmt(q.qw, 6) : "",
      q ? fmt(q.qx, 6) : "",
      q ? fmt(q.qy, 6) : "",
      q ? fmt(q.qz, 6) : "",
      fmt(e.ax, 6), fmt(e.ay, 6), fmt(e.az, 6),
      fmt(e.mx, 6), fmt(e.my, 6), fmt(e.mz, 6),
      pod.missingFrames ?? "",
      pod.gapEvents ?? "",
      protocol.sensorDropped ?? "",
      protocol.transportDropped ?? "",
      protocol.notifyFailures ?? "",
    ].join(",");

    if (this.count === this.capacity) {
      this.dropped += 1;
    }
    this.ring[this.write] = line;
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

  download(filename = "c3_tracker_log.csv") {
    if (this.count < 1) return;
    const parts = [...this.headerLines, CSV_COLUMNS];
    const start = this.count < this.capacity ? 0 : this.write;
    for (let i = 0; i < this.count; i++) {
      parts.push(this.ring[(start + i) % this.capacity]);
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

  _buildHeader(session) {
    const iso = new Date().toISOString();
    const pods = session.pods || [];
    const lines = [
      "# C3-Tracker CSV v7",
      `# created_iso=${iso}`,
      `# format=comment_meta_then_columns`,
      `# live_rate_hz=${session.liveRateHz}`,
      `# log_rate_hz=${session.logRateHz}`,
      `# capture_id=${session.captureId ?? ""}`,
      "# session_state=PREPARE→CONFIGURE→BIAS_START→MOTION→STOP_REQUESTED→DRAIN→FINALIZE",
      `# ring_capacity=${this.capacity}`,
      `# pod_count=${pods.length}`,
      `# required_stillness_ms=${session.stillnessMs || 2000}`,
      "# timebase=arrival_ms is ms since Start; sample_ms is sample_index-derived at log_rate_hz",
      "# units=Mahony qw..qz unit quaternion; ax/ay/az g (body); mx/my/mz gauss as consumed by Mahony",
      "# stationary_candidate=abs(|accel|-1)<=0.08g (accel only; fused CSV omits raw gyro)",
      "# integrity=missing_frames/gap_events are host sequence; sensor/transport/notify are device snapshots",
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
          `# pod${i}_caps=mtu:${p.caps.attMtu ?? ""};max_batch:${p.caps.maxBatchFrames ?? ""};imu:${p.caps.imuRateHz ?? ""};mag:${p.caps.magRateHz ?? ""}`
        );
      }
      if (p.magCalibration) {
        const c = p.magCalibration;
        lines.push(
          `# pod${i}_mag_cal=offset:${c.offset.join("/")};scale:${c.scale.join("/")};created:${c.createdIso}`
        );
      }
    });
    lines.push(`# columns=${CSV_COLUMNS}`);
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
