const STATUS_COLUMNS =
  "created_iso,elapsed_s,device_id,pod_id,position,connection_state," +
  "sensor_state,health,expected_rate_hz,observed_rate_hz,sequence_gaps,missing_frames," +
  "outlier_rows,total_frames,battery_valid,battery_mV,battery_percent," +
  "battery_read_error,capture_id,firmware_state,rate_epoch,protocol_ver,first_sample,last_produced," +
  "last_sent,final_sample,has_samples,drain_done,queue_depth,queue_high_water,sensor_dropped," +
  "transport_dropped,notify_failures,att_mtu,browser_visibility,interval_s";

const DEFAULT_CAPACITY = 20000;

/**
 * @brief Browser-side endurance-test status logger.
 *
 * Each row is a low-rate health snapshot; it complements, rather than replaces,
 * the fused motion CSV (Mahony quaternion + body accel/mag).
 */
export class StatusLogger {
  constructor(opts = {}) {
    this.capacity = opts.capacity || DEFAULT_CAPACITY;
    this.rows = [];
    this.recording = false;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.createdIso = "";
    this.intervalSeconds = 60;
    this.label = "";
    this.onChange = null;
  }

  start({ intervalSeconds = 60, label = "" } = {}) {
    this.rows = [];
    this.recording = true;
    this.startedAt = performance.now();
    this.stoppedAt = 0;
    this.createdIso = new Date().toISOString();
    this.intervalSeconds = intervalSeconds;
    this.label = String(label).trim();
    this._emit();
  }

  stop() {
    if (this.recording) this.stoppedAt = performance.now();
    this.recording = false;
    this._emit();
  }

  clear() {
    this.rows = [];
    this.recording = false;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.createdIso = "";
    this.label = "";
    this._emit();
  }

  capture(sessions, visibility = "visible") {
    if (!this.recording) return;
    const elapsedSeconds = (performance.now() - this.startedAt) / 1000;
    const createdIso = new Date().toISOString();
    for (const session of sessions) {
      const battery = session.battery || {};
      this.rows.push({
        createdIso,
        elapsedSeconds,
        deviceId: session.id,
        podId: session.podId,
        position: session.position,
        connectionState: session.status,
        sensorState: session.sensorState,
        health: session.health,
        expectedRateHz: session.expectedRateHz,
        observedRateHz: session.observedRateHz,
        gaps: session.gaps,
        missingFrames: session.missingFrames || 0,
        outliers: session.outliers,
        totalFrames: session.totalFrames,
        batteryValid: battery.valid ? 1 : 0,
        batteryMv: battery.valid ? battery.millivolts : "",
        batteryPercent: battery.valid ? battery.percent : "",
        batteryReadError: session.batteryReadError || "",
        captureId: session.sessionStatus?.captureId ?? "",
        firmwareState: session.sessionStatus?.stateName || "",
        rateEpoch: session.sessionStatus?.rateEpoch ?? "",
        protocolVersion: session.protocolVersion ?? session.sessionStatus?.protocol ?? "",
        firstSample: session.sessionStatus?.firstSample ?? session.sessionStatus?.firstSeq ?? "",
        lastProduced: session.sessionStatus?.lastProduced ?? session.sessionStatus?.lastSeq ?? "",
        lastSent: session.sessionStatus?.lastSent ?? "",
        finalSample: session.sessionStatus?.finalSample ?? "",
        hasSamples: session.sessionStatus?.hasSamples ? 1 : 0,
        drainDone: session.sessionStatus?.drainDone ? 1 : 0,
        queueDepth: session.sessionStatus?.queueDepth ?? "",
        queueHighWater: session.sessionStatus?.queueHighWater ?? "",
        sensorDropped: session.sessionStatus?.sensorDropped ?? "",
        transportDropped: session.sessionStatus?.transportDropped ?? "",
        notifyFailures: session.sessionStatus?.notifyFailures ?? "",
        attMtu: session.sessionStatus?.attMtu ?? session.caps?.attMtu ?? "",
        visibility,
        intervalSeconds: this.intervalSeconds,
      });
    }
    if (this.rows.length > this.capacity) {
      this.rows.splice(0, this.rows.length - this.capacity);
    }
    this._emit();
  }

  get rowCount() {
    return this.rows.length;
  }

  get elapsedSeconds() {
    if (!this.startedAt) return 0;
    const end = this.recording ? performance.now() : this.stoppedAt;
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  latestByDevice() {
    const latest = new Map();
    for (const row of this.rows) latest.set(row.deviceId, row);
    return [...latest.values()];
  }

  download(filename = "c3_tracker_status.csv") {
    if (!this.rows.length) return;
    const header = [
      "# C3-Tracker status log v3",
      `# created_iso=${this.createdIso}`,
      `# test_label=${csvEscape(this.label)}`,
      `# requested_interval_s=${this.intervalSeconds}`,
      "# battery_mV is loaded ADC voltage, not measured mAh or open-circuit state-of-charge",
      "# browser_visibility records whether the page was visible at each sample",
      `# columns=${STATUS_COLUMNS}`,
      STATUS_COLUMNS,
    ];
    const body = this.rows.map((row) => [
      row.createdIso,
      row.elapsedSeconds.toFixed(1),
      row.deviceId,
      row.podId,
      csvEscape(row.position),
      row.connectionState,
      row.sensorState,
      row.health,
      row.expectedRateHz,
      row.observedRateHz,
      row.gaps,
      row.missingFrames,
      row.outliers,
      row.totalFrames,
      row.batteryValid,
      row.batteryMv,
      row.batteryPercent,
      csvEscape(row.batteryReadError),
      row.captureId,
      row.firmwareState,
      row.rateEpoch,
      row.protocolVersion,
      row.firstSample,
      row.lastProduced,
      row.lastSent,
      row.finalSample,
      row.hasSamples,
      row.drainDone,
      row.queueDepth,
      row.queueHighWater,
      row.sensorDropped,
      row.transportDropped,
      row.notifyFailures,
      row.attMtu,
      row.visibility,
      row.intervalSeconds,
    ].join(","));
    const blob = new Blob([[...header, ...body].join("\n") + "\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  _emit() {
    if (this.onChange) this.onChange(this);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
