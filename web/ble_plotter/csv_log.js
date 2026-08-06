const HEADER =
  "arrival_ms,sample_ms,seq,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,mx_G,my_G,mz_G,ax_raw,ay_raw,az_raw,gx_raw,gy_raw,gz_raw,mx_raw,my_raw,mz_raw";

export class CsvLogger {
  constructor() {
    this.rows = [];
    this.recording = false;
    this.t0 = 0;
    this.firstSeq = null;
    this.onChange = null;
  }

  start() {
    this.rows = [HEADER];
    this.recording = true;
    this.t0 = performance.now();
    this.firstSeq = null;
    this._emit();
  }

  stop() {
    this.recording = false;
    this._emit();
  }

  clear() {
    this.rows = [];
    this.recording = false;
    this._emit();
  }

  /** @param {{seq:number, eng:object, raw:object}} frame @param {number} rateHz */
  push(frame, rateHz) {
    if (!this.recording) return;
    if (this.firstSeq === null) this.firstSeq = frame.seq;
    const arrivalMs = (performance.now() - this.t0).toFixed(1);
    const seqDelta = (frame.seq - this.firstSeq + 0x10000) & 0xffff;
    const sampleMs = ((seqDelta * 1000) / rateHz).toFixed(1);
    const e = frame.eng;
    const r = frame.raw;
    this.rows.push(
      [
        arrivalMs,
        sampleMs,
        frame.seq,
        e.ax, e.ay, e.az,
        e.gx, e.gy, e.gz,
        e.mx, e.my, e.mz,
        r.ax, r.ay, r.az,
        r.gx, r.gy, r.gz,
        r.mx, r.my, r.mz,
      ].join(",")
    );
    if (this.rows.length % 25 === 0) this._emit();
  }

  get rowCount() {
    return Math.max(0, this.rows.length - (this.rows[0] === HEADER ? 1 : 0));
  }

  download(filename = "c3_tracker_log.csv") {
    if (this.rows.length < 2) return;
    const blob = new Blob([this.rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  _emit() {
    if (this.onChange) this.onChange(this);
  }
}
