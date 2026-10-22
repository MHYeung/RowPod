import { BleClient, BLE_REMEMBER_HINT } from "./ble_client.js?v=16.13";
import { MotionOutlierFilter } from "./outlier_filter.js";
import { POD_COLORS, capturePreflight } from "./protocol.js";
import { PodTimeBase } from "./timebase.js";

const STORE_KEY = "c3_pod_labels_v1";
const SEAT_STORE_KEY = "c3_pod_seats_v1";
const SHELF_KEY = "c3_shelf_log_v1";
const SHELF_MAX = 2000;
const RESYNC_PERIOD_MS = 4000;

export { BLE_REMEMBER_HINT };

function loadShelf() {
  try {
    const rows = JSON.parse(localStorage.getItem(SHELF_KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function appendShelf(entry) {
  const rows = loadShelf();
  rows.push(entry);
  localStorage.setItem(SHELF_KEY, JSON.stringify(rows.slice(-SHELF_MAX)));
}

/** Connect-time pack readings. Coarse; the µA meter is the shelf-life result. */
export function shelfLogRows() {
  return loadShelf();
}

export function shelfLogCsv() {
  const header = "iso,device_id,position,battery_mV,battery_percent,battery_valid";
  const lines = loadShelf().map((row) =>
    [
      row.iso || "",
      row.device_id || "",
      String(row.position || "").replace(/,/g, " "),
      row.mV ?? "",
      row.percent ?? "",
      row.valid ? "1" : "0",
    ].join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

function loadLabels() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLabels(map) {
  localStorage.setItem(STORE_KEY, JSON.stringify(map));
}

function loadSeats() {
  try {
    return JSON.parse(localStorage.getItem(SEAT_STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSeats(map) {
  localStorage.setItem(SEAT_STORE_KEY, JSON.stringify(map));
}

export class PodRegistry {
  constructor() {
    this.sessions = new Map();
    this.labels = loadLabels();
    this.seats = loadSeats();
    this.selectedId = null;
    this._resyncTimer = null;
    this.onChange = null;
    /** Lightweight rate/battery/gap updates — must not rebuild rename inputs. */
    this.onStats = null;
    this.onFrame = null;
    this._colorIdx = 0;
    this._addPromise = null;
    /** While a capture records, skip periodic sync writes on every link. */
    this.quiet = false;
  }

  list() {
    return [...this.sessions.values()];
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  get selected() {
    return this.selectedId ? this.sessions.get(this.selectedId) : null;
  }

  _emit() {
    if (this.onChange) this.onChange(this.list(), this.selectedId);
  }

  _emitStats() {
    if (this.onStats) this.onStats(this.list(), this.selectedId);
  }

  async softHoldStreams() {
    const held = [];
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      try {
        session.client.beginPeerHold();
        session.sensorStatus = "paused";
        held.push(session);
      } catch (error) {
        console.warn("soft hold failed", session.position, error);
      }
    }
    return held;
  }

  async releaseSoftHold(sessions) {
    for (const session of sessions || []) {
      if (session.status !== "connected") continue;
      try {
        session.client.endPeerHold();
        session.gaps = 0;
        session.missingFrames = 0;
        session.recentMissingFrames = 0;
        session.lastFrameAt = performance.now();
        session.sensorStatus = "streaming";
      } catch (error) {
        console.warn("soft hold release failed", session.position, error);
      }
    }
    this._emitStats();
  }

  /**
   * Reconnect pods this browser already paired. One GATT setup at a time.
   * @returns {Promise<{connected: object[], missing: string[]}>}
   */
  async reconnectKnown(options = {}) {
    if (!BleClient.canRememberDevices()) {
      return { connected: [], missing: [], unavailable: true };
    }
    const devices = await BleClient.knownDevices();
    const connected = [];
    const missing = [];
    for (const device of devices) {
      const existing = this.sessions.get(device.id);
      if (existing?.status === "connected") continue;
      if (existing) this.sessions.delete(device.id);
      const label = device.name || this.labels[device.id]?.position || device.id;
      if (options.onProgress) options.onProgress(label);
      /* A scan beside a live connection is what left the new pod's motion
       * queue empty. Watch only while nothing is connected. */
      const live = [...this.sessions.values()].some((s) => s.status === "connected");
      if (!live) {
        const seen = await BleClient.waitForAdvertising(device, options.advertiseMs || 4000);
        if (seen === false) {
          missing.push(label);
          continue;
        }
        if (seen === true) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      const paused = [];
      for (const session of this.sessions.values()) {
        if (session.status !== "connected") continue;
        try {
          await session.client.pauseNotifications();
          paused.push(session);
        } catch (error) {
          console.warn("pause before reconnect failed", session.position, error);
        }
      }
      try {
        const session = await this.addPod({
          device,
          preferRawGyro: options.preferRawGyro,
        });
        if (session.client.motionPackets === 0) {
          await session.client.ensureMotionFlow();
        }
        connected.push(session);
      } catch (error) {
        console.warn("reconnect failed", label, error);
        missing.push(label);
      } finally {
        for (const session of paused) {
          try {
            await session.client.resumeNotifications();
          } catch (error) {
            console.warn("resume after reconnect failed", session.position, error);
          }
        }
      }
    }
    return { connected, missing, unavailable: false };
  }

  async addPod(options = {}) {
    if (this._addPromise) return this._addPromise;
    this._addPromise = this._addPod(options);
    try {
      return await this._addPromise;
    } finally {
      this._addPromise = null;
    }
  }

  async _addPod(options = {}) {
    const client = new BleClient();
    let heldSessions = [];
    try {
      await client.connect({
        device: options.device,
        preferRawGyro: options.preferRawGyro,
        beforeGattConnect: async () => {
          /* Soft-hold only: keep CCCD so existing pods keep sampling. Hard
           * pause (stopNotifications) stopped the firmware stream and created
           * sequence gaps that left the first pod stale/degraded forever. */
          heldSessions = await this.softHoldStreams();
        },
      });
      await this.releaseSoftHold(heldSessions);
    } catch (error) {
      await this.releaseSoftHold(heldSessions);
      try {
        await client.disconnect();
      } catch (_) {
        /* The failed setup has already cleaned its GATT handle. */
      }
      throw error;
    }
    const id = client.deviceId;
    if (!id) {
      await client.disconnect();
      throw new Error("device id missing");
    }
    if (this.sessions.has(id)) {
      await client.disconnect();
      throw new Error("pod already connected");
    }

    const color = POD_COLORS[this._colorIdx++ % POD_COLORS.length];
    const stored = this.labels[id]?.position;
    const position = stored || client.advName || `Pod-${client.info.podId.toString(16)}`;
    const storedSeat = this.seats[id] || {};
    const session = {
      id,
      client,
      position,
      color,
      status: "connected",
      gaps: 0,
      missingFrames: 0,
      recentMissingFrames: 0,
      rate: 0,
      frames: 0,
      totalFrames: 0,
      windowStart: performance.now(),
      sync: { offsetMs: 0, rttMs: 0, ok: false },
      timebase: new PodTimeBase({ nominalHz: client.meta.rate_hz || 56 }),
      seat: storedSeat.seat || "",
      hand:
        storedSeat.hand === "bow" || storedSeat.hand === "stroke"
          ? storedSeat.hand
          : "",
      side: storedSeat.side === "port" ? "port" : "starboard",
      battery: { ...client.battery },
      batteryReadError: "",
      mode: client.info.mode,
      podId: client.info.podId,
      sensorStatus: "waiting",
      lastFrameAt: performance.now(),
      outliers: 0,
      history: [],
      outlierFilter: new MotionOutlierFilter(),
      sessionStatus: client.sessionStatus,
      caps: client.caps,
      protocolVersion: client.protocolVersion,
      protocolError: "",
    };

    client.onFrame = (frame, gaps, missingFrames = 0) => {
      session.gaps = gaps;
      session.missingFrames = missingFrames;
      if (frame.missing) {
        session.recentMissingFrames =
          (session.recentMissingFrames || 0) + frame.missing;
        session._cleanFrames = 0;
      } else {
        session._cleanFrames = (session._cleanFrames || 0) + 1;
        const clearAfter = Math.max(56, (session.rate || 56) * 2);
        if (session._cleanFrames >= clearAfter) {
          session.recentMissingFrames = 0;
        }
      }
      session.frames += 1;
      const now = performance.now();
      session.lastFrameAt = now;
      if (session.sensorStatus !== "paused") {
        session.sensorStatus = "streaming";
      }
      session.totalFrames += 1;
      const quality = session.outlierFilter.observe(frame);
      if (quality.mask) session.outliers += 1;
      const e = quality.eng;
      session.activity = Math.min(
        1.5,
        (Math.hypot(e.gx, e.gy, e.gz) / 180 +
          Math.abs(Math.hypot(e.ax, e.ay, e.az) - 1) / 0.6) / 2
      );
      session.history.push({
        t: now,
        activity: session.activity,
        gyro: Math.hypot(e.gx, e.gy, e.gz),
        accel: Math.hypot(e.ax, e.ay, e.az),
      });
      if (session.history.length > 96) session.history.shift();
      if (now - session.windowStart >= 1000) {
        session.rate = session.frames;
        session.frames = 0;
        session.windowStart = now;
        this._emitStats();
      }
      const idx = frame.sampleIndex ?? frame.seq;
      const fromClock = session.timebase.hostMsFromSample(idx);
      const syncedMs = fromClock != null ? fromClock : now;
      if (this.onFrame) this.onFrame(session, frame, syncedMs, quality);
    };
    client.onDisconnect = () => {
      session.status = "lost";
      session.sensorStatus = "lost";
      this._emit();
    };
    client.onSessionStatus = (status) => {
      session.sessionStatus = status;
      session.protocolError = "";
      const applied = status?.appliedRateHz || status?.rateHz;
      if (applied) session.client.meta.rate_hz = applied;
      if (status?.attMtu && session.caps) {
        session.caps = { ...session.caps, attMtu: status.attMtu };
      }
      this._emitStats();
    };

    this.sessions.set(id, session);
    if (!this.selectedId) this.selectedId = id;
    if (session.battery?.valid) {
      appendShelf({
        device_id: id,
        position,
        iso: new Date().toISOString(),
        mV: session.battery.millivolts,
        percent: session.battery.percent,
        valid: true,
      });
    }
    this.labels[id] = { ...(this.labels[id] || {}), position };
    saveLabels(this.labels);

    try {
      session.sync = { ...(await client.syncClock()), ok: true };
      this._ingestSync(session, session.sync);
    } catch (e) {
      console.warn("sync failed", e);
      session.sync = { offsetMs: 0, rttMs: 0, ok: false };
    }

    this._ensureResyncLoop();
    this._emit();
    return session;
  }

  select(id) {
    if (this.sessions.has(id)) {
      this.selectedId = id;
      this._emit();
    }
  }

  async rename(id, position) {
    const session = this.sessions.get(id);
    if (!session) return;
    const name = String(position || "").trim().slice(0, 20);
    await session.client.setName(name);
    session.position = name || session.client.advName || session.position;
    this.labels[id] = { ...(this.labels[id] || {}), position: session.position };
    saveLabels(this.labels);
    this._emit();
  }

  async resync(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.sync = { ...(await session.client.syncClock()), ok: true };
      this._ingestSync(session, session.sync);
    } catch (e) {
      session.sync = { offsetMs: 0, rttMs: 0, ok: false };
      throw e;
    }
    this._emit();
  }

  /**
   * @param {string} id
   * @param {{seat?:string,hand?:string,side?:string}} assignment
   */
  assignSeat(id, assignment) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (assignment.seat != null) session.seat = String(assignment.seat).slice(0, 16);
    if (assignment.hand === "bow" || assignment.hand === "stroke") {
      session.hand = assignment.hand;
    }
    if (assignment.side === "port" || assignment.side === "starboard") {
      session.side = assignment.side;
    }
    this.seats[id] = {
      seat: session.seat,
      hand: session.hand,
      side: session.side,
    };
    saveSeats(this.seats);
    this._emit();
  }

  _ingestSync(session, sync) {
    if (!session?.timebase || !sync) return;
    const hz = session.client?.meta?.rate_hz;
    if (hz) session.timebase.setNominalHz(hz);
    const sampleIndex = sync.sampleIndex ?? sync.seq;
    if (sync.clientMid == null || sampleIndex == null) return;
    session.timebase.observe({
      sampleIndex,
      hostMs: sync.clientMid,
      rttMs: sync.rttMs,
    });
  }

  _ensureResyncLoop() {
    if (this._resyncTimer) return;
    this._resyncTimer = setInterval(() => {
      this.resyncAllQuiet().catch(() => {});
    }, RESYNC_PERIOD_MS);
  }

  _stopResyncLoopIfEmpty() {
    if (this.sessions.size > 0) return;
    if (this._resyncTimer) {
      clearInterval(this._resyncTimer);
      this._resyncTimer = null;
    }
  }

  async resyncAllQuiet({ force = false } = {}) {
    if (this.quiet && !force) return;
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      try {
        session.sync = { ...(await session.client.syncClock()), ok: true };
        this._ingestSync(session, session.sync);
      } catch (_) {
        /* Keep the last good fit; a missed ping is not fatal. */
      }
    }
    this._emitStats();
  }

  async refreshBattery(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    try {
      session.battery = { ...(await session.client.readBattery()) };
      session.batteryReadError = "";
    } catch (error) {
      session.batteryReadError = String(error.message || error);
      throw error;
    }
    this._emitStats();
    return session.battery;
  }

  async refreshAllBatteries() {
    for (const s of this.sessions.values()) {
      if (s.status !== "connected") continue;
      try {
        s.battery = { ...(await s.client.readBattery()) };
        s.batteryReadError = "";
      } catch (e) {
        s.batteryReadError = String(e.message || e);
        console.warn("battery read failed", e);
      }
    }
    this._emitStats();
  }

  /** @param {56|112|224|448} hz */
  async setRateAll(hz) {
    for (const s of this.sessions.values()) {
      if (s.status !== "connected") continue;
      try {
        await s.client.setRate(hz);
        if (s.timebase) s.timebase.setNominalHz(hz);
      } catch (e) {
        console.warn("setRate failed", s.position, e);
      }
    }
    this._emitStats();
  }

  /** @param {0|1|2} profile */
  async setWorkoutProfileAll(profile) {
    for (const s of this.sessions.values()) {
      if (s.status !== "connected") continue;
      try {
        await s.client.setWorkoutProfile(profile);
      } catch (e) {
        console.warn("set workout profile failed", s.position, e);
      }
    }
    this._emitStats();
  }

  /**
   * Clear sequence / freshness counters after intentional capture teardown so
   * Summary health is not stuck on capture-time radio gaps.
   */
  clearIntegrityCounters() {
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      session.client.resyncSequence();
      session.gaps = 0;
      session.missingFrames = 0;
      session.recentMissingFrames = 0;
      session._cleanFrames = 0;
      session.lastFrameAt = performance.now();
      if (session.sensorStatus !== "paused") {
        session.sensorStatus = "streaming";
      }
    }
    this._emitStats();
  }

  async sessionCommandAll(command, captureId, rateHz = 0, flags = 0) {
    const connected = this.list().filter((s) => s.status === "connected");
    const results = [];
    for (const session of connected) {
      try {
        const status = await session.client.sendSessionCommand(
          command,
          captureId,
          rateHz,
          flags
        );
        session.sessionStatus = status || session.client.sessionStatus;
        session.protocolError = "";
        if (session.sessionStatus?.appliedRateHz || session.sessionStatus?.rateHz) {
          session.client.meta.rate_hz =
            session.sessionStatus.appliedRateHz || session.sessionStatus.rateHz;
        }
        results.push(session.sessionStatus);
      } catch (error) {
        session.protocolError = String(error.message || error);
        this._emitStats();
        throw new Error(`${session.position}: ${session.protocolError}`);
      }
    }
    this._emitStats();
    return results;
  }

  async refreshAllSessionStatus() {
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      try {
        session.sessionStatus = await session.client.readSessionStatus();
        session.caps = session.client.caps || session.caps;
        session.protocolVersion = session.client.protocolVersion;
        session.protocolError = "";
      } catch (error) {
        session.protocolError = String(error.message || error);
      }
    }
    this._emitStats();
  }

  /**
   * @param {number} rateHz
   * @returns {{ok:boolean,warnings:string[],details:object[]}}
   */
  capturePreflightAll(rateHz, hostMaxBatch = 0) {
    const connected = this.list().filter((s) => s.status === "connected");
    const details = connected.map((session) => {
      const caps = {
        ...(session.caps || {}),
        /* Pod view: the firmware packs batches against this. The PREPARE
         * probe proves the host side before START. */
        attMtu: session.sessionStatus?.attMtu || session.caps?.attMtu || 23,
        /* Preflight must use the stream we will actually send. */
        supportsFused: Boolean(session.client.usesFusedMotion),
        supportsV16: Boolean(session.client.usesV16Motion),
      };
      const result = capturePreflight(
        caps,
        rateHz,
        connected.length,
        hostMaxBatch
      );
      return {
        position: session.position,
        protocolVersion: session.protocolVersion,
        ...result,
        caps,
      };
    });
    const warnings = details.flatMap((d) =>
      d.warnings.map((w) => `${d.position}: ${w}`)
    );
    return { ok: warnings.length === 0, warnings, details };
  }

  /**
   * After PREPARE, confirm every pod's link delivers full batched packets.
   * Returns the positions that did not, empty when all pass.
   * @param {number} frames frames per notify requested in PREPARE flags
   */
  async probeMotionBatch(frames, waitMs = 500) {
    const connected = this.list().filter((s) => s.status === "connected");
    const before = connected.map((s) => s.client.motionPackets);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return connected
      .filter((s, i) => {
        const c = s.client;
        return !(
          c.motionPackets > before[i] &&
          c.lastMotionPacketLen === frames * c.motionFrameLen
        );
      })
      .map((s) => s.position);
  }

  async waitForDrain(captureId, { timeoutMs = 5000, pollMs = 100 } = {}) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      await this.refreshAllSessionStatus();
      const connected = this.list().filter((s) => s.status === "connected");
      const pending = connected.filter((s) => {
        const status = s.sessionStatus;
        if (!status || status.captureId !== captureId) return true;
        if (status.errorReason) return true;
        return !(status.drainDone && (status.queueDepth ?? 1) === 0);
      });
      if (!pending.length) {
        return connected.map((s) => s.sessionStatus);
      }
      const hardFail = pending.find((s) => s.sessionStatus?.errorReason);
      if (hardFail) {
        throw new Error(
          `${hardFail.position}: ${hardFail.sessionStatus.errorName || "protocol error"}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("drain timed out before queue emptied");
  }

  /**
   * Disconnect and revoke the browser permission so reconnect skips this pod.
   * @returns {Promise<boolean>} false when Chrome cannot forget devices.
   */
  async forget(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    let forgot = false;
    try {
      forgot = await session.client.forgetDevice();
    } catch (error) {
      console.warn("forget failed", session.position, error);
    }
    this.sessions.delete(id);
    if (this.selectedId === id) {
      this.selectedId = this.sessions.keys().next().value || null;
    }
    this._stopResyncLoopIfEmpty();
    this._emit();
    return forgot;
  }

  async disconnect(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.client.disconnect();
    this.sessions.delete(id);
    if (this.selectedId === id) {
      this.selectedId = this.sessions.keys().next().value || null;
    }
    this._stopResyncLoopIfEmpty();
    this._emit();
  }

  async disconnectAll() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.disconnect(id);
    }
  }
}
