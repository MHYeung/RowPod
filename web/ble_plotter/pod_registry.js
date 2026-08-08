import { BleClient } from "./ble_client.js";
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

  async addPod() {
    const client = new BleClient();
    await client.connect();
    const id = client.deviceId;
    if (!id) throw new Error("device id missing");
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
      windowStart: performance.now(),
      sync: { offsetMs: 0, rttMs: 0, ok: false },
      battery: { ...client.battery },
      mode: client.info.mode,
      podId: client.info.podId,
    };

    client.onFrame = (frame, gaps) => {
      session.gaps = gaps;
      session.frames += 1;
      const now = performance.now();
      if (now - session.windowStart >= 1000) {
        session.rate = session.frames;
        session.frames = 0;
        session.windowStart = now;
        this._emitStats();
      }
      const syncedMs = now + (session.sync.offsetMs || 0);
      if (this.onFrame) this.onFrame(session, frame, syncedMs);
    };
    client.onDisconnect = () => {
      session.status = "lost";
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
