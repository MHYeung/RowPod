/** Column header row (data table starts after # meta comments). */
export const CSV_COLUMNS =
  "position,device_id,pod_id,rate_hz,synced_ms,arrival_ms,sample_ms,seq," +
  "ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,mx_G,my_G,mz_G," +
  "ax_raw,ay_raw,az_raw,gx_raw,gy_raw,gz_raw,mx_raw,my_raw,mz_raw";

/** Default ring capacity: ~20 min @ 100 Hz one pod, or ~5 min @ 4 pods. */
const DEFAULT_CAPACITY = 120000;

/**
 * Ring-buffer CSV logger.
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
    this.headerLines = this._buildHeader(session);
    this._emit();
  }

  stop() {
    this.recording = false;
    this._emit();
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
    this._emit();
  }

  /**
   * @param {{seq:number, eng:object, raw:object}} frame
   * @param {{position:string,deviceId:string,podId:number,rateHz:number,syncedMs?:number}} pod
   */
  push(frame, pod) {
    if (!this.recording) return;
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
    if (st.firstSeq === null) st.firstSeq = frame.seq;

    const arrivalMs = (performance.now() - this.t0).toFixed(1);
    const seqDelta = (frame.seq - st.firstSeq + 0x10000) & 0xffff;
    const sampleMs = ((seqDelta * 1000) / st.rateHz).toFixed(1);
    const syncedMs =
      pod.syncedMs != null ? Number(pod.syncedMs).toFixed(1) : arrivalMs;
    const e = frame.eng;
    const r = frame.raw;
    const line = [
      csvEscape(pod.position || ""),
      id,
      pod.podId ?? "",
      st.rateHz,
      syncedMs,
      arrivalMs,
      sampleMs,
      frame.seq,
      e.ax, e.ay, e.az,
      e.gx, e.gy, e.gz,
      e.mx, e.my, e.mz,
      r.ax, r.ay, r.az,
      r.gx, r.gy, r.gz,
      r.mx, r.my, r.mz,
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
      "# C3-Tracker CSV v2",
      `# created_iso=${iso}`,
      `# format=comment_meta_then_columns`,
      `# live_rate_hz=${session.liveRateHz}`,
      `# log_rate_hz=${session.logRateHz}`,
      `# ring_capacity=${this.capacity}`,
      `# pod_count=${pods.length}`,
      "# timebase=arrival_ms is ms since Start; sample_ms is seq-derived at log_rate_hz",
      "# synced_ms=browser estimate (software sync offset); not sample-locked IMU time",
      "# units=ax/ay/az g; gx/gy/gz dps; mx/my/mz gauss; raw=int16 sensor LSB",
    ];
    pods.forEach((p, i) => {
      const sync = p.sync?.ok
        ? `rtt_ms=${Math.round(p.sync.rttMs)};offset_ms=${Number(p.sync.offsetMs).toFixed(1)}`
        : "sync=off";
      lines.push(
        `# pod${i}=id:${p.id};position:${csvEscape(p.position || "")};pod_id:${p.podId ?? ""};${sync}`
      );
    });
    lines.push(`# columns=${CSV_COLUMNS}`);
    return lines;
  }

  _emit() {
    if (this.onChange) this.onChange(this);
  }
}

function csvEscape(s) {
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}
