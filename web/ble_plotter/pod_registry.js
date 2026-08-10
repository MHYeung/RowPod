import { BleClient } from "./ble_client.js";
import { MotionOutlierFilter } from "./outlier_filter.js";
import { POD_COLORS } from "./protocol.js";

const STORE_KEY = "c3_pod_labels_v1";

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

export class PodRegistry {
  constructor() {
    this.sessions = new Map();
    this.labels = loadLabels();
    this.selectedId = null;
    this.onChange = null;
    /** Lightweight rate/battery/gap updates — must not rebuild rename inputs. */
    this.onStats = null;
    this.onFrame = null;
    this._colorIdx = 0;
    this._addPromise = null;
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

  async pauseStreams() {
    const paused = [];
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      try {
        if (await session.client.pauseNotifications()) paused.push(session);
      } catch (error) {
        console.warn("pause stream failed", session.position, error);
      }
    }
    return paused;
  }

  async resumeStreams(sessions) {
    for (const session of sessions || []) {
      if (session.status !== "connected") continue;
      try {
        await session.client.resumeNotifications();
      } catch (error) {
        console.warn("resume stream failed", session.position, error);
      }
    }
  }

  async addPod() {
    if (this._addPromise) return this._addPromise;
    this._addPromise = this._addPod();
    try {
      return await this._addPromise;
    } finally {
      this._addPromise = null;
    }
  }

  async _addPod() {
    const client = new BleClient();
    let pausedSessions = [];
    try {
      await client.connect({
        beforeGattConnect: async () => {
          pausedSessions = await this.pauseStreams();
        },
      });
      await this.resumeStreams(pausedSessions);
    } catch (error) {
      await this.resumeStreams(pausedSessions);
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
    const session = {
      id,
      client,
      position,
      color,
      status: "connected",
      gaps: 0,
      rate: 0,
      frames: 0,
      totalFrames: 0,
      windowStart: performance.now(),
      sync: { offsetMs: 0, rttMs: 0, ok: false },
      battery: { ...client.battery },
      mode: client.info.mode,
      podId: client.info.podId,
      sensorStatus: "waiting",
      lastFrameAt: performance.now(),
      outliers: 0,
      history: [],
      outlierFilter: new MotionOutlierFilter(),
    };

    client.onFrame = (frame, gaps) => {
      session.gaps = gaps;
      session.frames += 1;
      const now = performance.now();
      session.lastFrameAt = now;
      session.sensorStatus = "streaming";
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
      const syncedMs = now + (session.sync.offsetMs || 0);
      if (this.onFrame) this.onFrame(session, frame, syncedMs, quality);
    };
    client.onDisconnect = () => {
      session.status = "lost";
      session.sensorStatus = "lost";
      this._emit();
    };

    this.sessions.set(id, session);
    if (!this.selectedId) this.selectedId = id;
    this.labels[id] = { ...(this.labels[id] || {}), position };
    saveLabels(this.labels);

    try {
      session.sync = { ...(await client.syncClock()), ok: true };
    } catch (e) {
      console.warn("sync failed", e);
      session.sync = { offsetMs: 0, rttMs: 0, ok: false };
    }

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
    } catch (e) {
      session.sync = { offsetMs: 0, rttMs: 0, ok: false };
      throw e;
    }
    this._emit();
  }

  async refreshBattery(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.battery = { ...(await session.client.readBattery()) };
    this._emitStats();
    return session.battery;
  }

  async refreshAllBatteries() {
    for (const s of this.sessions.values()) {
      if (s.status !== "connected") continue;
      try {
        s.battery = { ...(await s.client.readBattery()) };
      } catch (e) {
        console.warn("battery read failed", e);
      }
    }
    this._emitStats();
  }

  /** @param {56|112|224} hz */
  async setRateAll(hz) {
    for (const s of this.sessions.values()) {
      if (s.status !== "connected") continue;
      try {
        await s.client.setRate(hz);
      } catch (e) {
        console.warn("setRate failed", s.position, e);
      }
    }
    this._emitStats();
  }

  /** @param {0|1} profile */
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

  async disconnect(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.client.disconnect();
    this.sessions.delete(id);
    if (this.selectedId === id) {
      this.selectedId = this.sessions.keys().next().value || null;
    }
    this._emit();
  }

  async disconnectAll() {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.disconnect(id);
    }
  }
}
