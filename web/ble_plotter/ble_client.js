import {
  CFG_BATT,
  CFG_CAPS,
  CFG_INFO,
  CFG_NAME,
  CFG_PROFILE,
  CFG_RATE,
  CFG_SESSION,
  CFG_SESSION_V16,
  CFG_STATUS,
  CFG_STATUS_V16,
  CFG_SVC,
  CFG_SYNC,
  MOTION_DATA,
  MOTION_DATA_FUSED,
  MOTION_DATA_V16,
  MOTION_META,
  MOTION_SVC,
  RATE_LIVE_HZ,
  SequenceTracker,
  SESSION_COMMAND_STATE,
  decodeBatt,
  decodeCaps,
  decodeCfgInfo,
  decodeFrames,
  decodeFramesFused,
  decodeFramesV16,
  decodeMeta,
  decodeSessionStatus,
  decodeSessionStatusV16,
  decodeSyncRsp,
  encodeSessionCommand,
  encodeSessionCommandV16,
  gyroDpsFromQuat,
  rateToWire,
} from "./protocol.js";

export class BleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.dataChar = null;
    this.dataV16Char = null;
    this.dataFusedChar = null;
    this.nameChar = null;
    this.syncChar = null;
    this.battChar = null;
    this.rateChar = null;
    this.profileChar = null;
    this.sessionChar = null;
    this.sessionV16Char = null;
    this.statusChar = null;
    this.statusV16Char = null;
    this.capsChar = null;
    this.meta = {
      accel_lsb_per_g: 2048,
      gyro_lsb_per_dps: 16,
      mag_lsb_per_gauss: 3750,
      rate_hz: RATE_LIVE_HZ,
      flags: 0,
    };
    this.info = { mode: 0, podId: 0, hasCustomName: false };
    this.battery = { millivolts: 0, percent: 0, valid: false };
    this.caps = null;
    this.workoutProfile = 0;
    this.sessionStatus = null;
    this.protocolVersion = 1;
    this.usesV16Motion = false;
    this.usesFusedMotion = false;
    this.advName = "";
    this.onFrame = null;
    this.onStatus = null;
    this.onSessionStatus = null;
    this.onDisconnect = null;
    this._seqTracker = new SequenceTracker({ bits: 16 });
    this.gaps = 0;
    this.missingFrames = 0;
    this._boundNotify = this._onNotify.bind(this);
    this._boundNotifyV16 = this._onNotifyV16.bind(this);
    this._boundNotifyFused = this._onNotifyFused.bind(this);
    this._boundSync = this._onSyncNotify.bind(this);
    this._boundSessionStatus = this._onSessionStatusNotify.bind(this);
    this._boundSessionStatusV16 = this._onSessionStatusNotifyV16.bind(this);
    this._boundDisconnect = this._onDisconnect.bind(this);
    this._syncWaiters = [];
    this._gattQueue = Promise.resolve();
    this._stage = "idle";
    this._motionNotifications = false;
    this._peerHold = false;
    this._nextCommandId = 1;
    this._lastQuat = null;
  }

  get deviceId() {
    return this.device?.id || null;
  }

  _setStatus(text, cls = "") {
    if (this.onStatus) this.onStatus(text, cls);
  }

  _queueGatt(operation) {
    const run = this._gattQueue.then(operation, operation);
    this._gattQueue = run.catch(() => {});
    return run;
  }

  async _connectGattWithRetry() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.device.gatt.connect();
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  /**
   * Firmware requests ATT MTU exchange on connect. Poll status/caps briefly so
   * we can choose v16 motion only when a 22-byte frame actually fits.
   * Also probe the browser's write-without-response size (often the only host
   * MTU signal Web Bluetooth exposes on Windows).
   */
  async _waitForUsableMtu({ timeoutMs = 2000, pollMs = 150 } = {}) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      try {
        if (this.statusV16Char || this.statusChar) {
          await this.readSessionStatusUnlocked();
        }
        if (this.capsChar) {
          this.caps = decodeCaps(await this.capsChar.readValue());
          if (this.sessionStatus?.attMtu) {
            this.caps = { ...this.caps, attMtu: this.sessionStatus.attMtu };
          }
        }
      } catch (_) {
        /* Status may not be ready yet during early GATT setup. */
      }
      const hostHint = this._hostAttMtuHint();
      if (hostHint && this.caps) {
        this.caps = { ...this.caps, hostAttMtuHint: hostHint };
      }
      const mtu = this.sessionStatus?.attMtu || this.caps?.attMtu || 23;
      if (mtu >= 27) return mtu;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return this.sessionStatus?.attMtu || this.caps?.attMtu || 23;
  }

  /** Best-effort host MTU hint; Web Bluetooth has no direct ATT MTU API. */
  _hostAttMtuHint() {
    try {
      const write = this.nameChar?.maxWriteWithoutResponseSize;
      if (typeof write === "number" && write > 0) {
        return write + 3;
      }
    } catch (_) {
      /* Characteristic may not expose the property on all browsers. */
    }
    return null;
  }

  async connect(options = {}) {
    let stage = "requestDevice";
    const setStage = (value) => {
      stage = value;
      this._stage = value;
    };
    try {
      if (!navigator.bluetooth) {
        throw new Error("Web Bluetooth unavailable — use Chrome/Edge on localhost or HTTPS");
      }
      /* OR filters: service UUID and/or name prefix (name is in scan response). */
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [MOTION_SVC] },
          { namePrefix: "C3-Tracker" },
          { namePrefix: "C3-T-" },
        ],
        optionalServices: [MOTION_SVC, CFG_SVC],
      });
      this.advName = this.device.name || "";
      this.device.addEventListener("gattserverdisconnected", this._boundDisconnect);
      if (options.beforeGattConnect) {
        setStage("holding existing pod streams");
        await options.beforeGattConnect();
      }
      setStage("gatt.connect");
      this.server = await this._connectGattWithRetry();

      setStage("discover motion service");
      const motion = await this.server.getPrimaryService(MOTION_SVC);
      this.dataChar = await motion.getCharacteristic(MOTION_DATA);
      const metaChar = await motion.getCharacteristic(MOTION_META);
      try {
        this.dataV16Char = await motion.getCharacteristic(MOTION_DATA_V16);
      } catch (_) {
        this.dataV16Char = null;
      }
      try {
        this.dataFusedChar = await motion.getCharacteristic(MOTION_DATA_FUSED);
      } catch (_) {
        this.dataFusedChar = null;
      }
      setStage("read motion metadata");
      const metaView = await metaChar.readValue();
      this.meta = { ...this.meta, ...decodeMeta(metaView) };

      try {
        setStage("discover config service");
        const cfg = await this.server.getPrimaryService(CFG_SVC);
        const infoChar = await cfg.getCharacteristic(CFG_INFO);
        this.nameChar = await cfg.getCharacteristic(CFG_NAME);
        this.syncChar = await cfg.getCharacteristic(CFG_SYNC);
        try {
          this.battChar = await cfg.getCharacteristic(CFG_BATT);
        } catch (_) {
          this.battChar = null;
        }
        try {
          this.rateChar = await cfg.getCharacteristic(CFG_RATE);
        } catch (_) {
          this.rateChar = null;
        }
        try {
          this.profileChar = await cfg.getCharacteristic(CFG_PROFILE);
          const profileView = await this.profileChar.readValue();
          this.workoutProfile = profileView.getUint8(0);
        } catch (_) {
          this.profileChar = null;
        }
        try {
          this.capsChar = await cfg.getCharacteristic(CFG_CAPS);
          this.caps = decodeCaps(await this.capsChar.readValue());
          this.protocolVersion = this.caps.firmwareProto || 2;
        } catch (_) {
          this.capsChar = null;
          this.caps = null;
          this.protocolVersion = 1;
        }
        try {
          this.sessionV16Char = await cfg.getCharacteristic(CFG_SESSION_V16);
        } catch (_) {
          this.sessionV16Char = null;
        }
        try {
          this.sessionChar = await cfg.getCharacteristic(CFG_SESSION);
        } catch (_) {
          this.sessionChar = null;
        }
        try {
          this.statusV16Char = await cfg.getCharacteristic(CFG_STATUS_V16);
          await this.statusV16Char.startNotifications();
          this.statusV16Char.addEventListener(
            "characteristicvaluechanged",
            this._boundSessionStatusV16
          );
          this.sessionStatus = decodeSessionStatusV16(
            await this.statusV16Char.readValue()
          );
        } catch (_) {
          this.statusV16Char = null;
        }
        if (!this.statusV16Char) {
          try {
            this.statusChar = await cfg.getCharacteristic(CFG_STATUS);
            await this.statusChar.startNotifications();
            this.statusChar.addEventListener(
              "characteristicvaluechanged",
              this._boundSessionStatus
            );
            this.sessionStatus = decodeSessionStatus(
              await this.statusChar.readValue()
            );
          } catch (_) {
            this.statusChar = null;
            this.sessionStatus = null;
          }
        }
        setStage("read pod configuration");
        const infoView = await infoChar.readValue();
        this.info = decodeCfgInfo(infoView);
        const nameView = await this.nameChar.readValue();
        this.advName = new TextDecoder().decode(nameView) || this.advName;
        setStage("subscribe sync");
        await this.syncChar.startNotifications();
        this.syncChar.addEventListener("characteristicvaluechanged", this._boundSync);
        setStage("read battery");
        await this.readBattery();
        setStage("set live rate");
        await this.setRate(RATE_LIVE_HZ);
        setStage("wait for ATT MTU");
        await this._waitForUsableMtu();
      } catch (e) {
        console.warn(`optional config setup failed at ${stage}`, e);
      }

      const attMtu = this.sessionStatus?.attMtu || this.caps?.attMtu || 23;
      /* 24-byte fused needs ATT MTU ≥ 27; 22-byte v16 needs ≥ 25. */
      this.usesFusedMotion = Boolean(
        this.dataFusedChar && this.caps?.supportsFused && attMtu >= 27
      );
      this.usesV16Motion = Boolean(
        !this.usesFusedMotion &&
          this.dataV16Char &&
          this.caps?.supportsV16 &&
          attMtu >= 25
      );
      this._seqTracker = new SequenceTracker({
        bits: this.usesFusedMotion || this.usesV16Motion ? 32 : 16,
      });
      this._lastQuat = null;

      const motionLabel = this.usesFusedMotion
        ? "fused"
        : this.usesV16Motion
          ? "v16"
          : "v1";
      this._setStatus(
        `Connected · ${this.advName || "pod"} · proto v${this.protocolVersion}` +
          ` · motion ${motionLabel} · MTU ${attMtu}` +
          ` · meta v${this.meta.ver} @ ${this.meta.rate_hz} Hz`,
        "ok"
      );

      this.gaps = 0;
      this.missingFrames = 0;
      setStage("subscribe motion");
      if (this.usesFusedMotion) {
        await this.dataFusedChar.startNotifications();
        this.dataFusedChar.addEventListener(
          "characteristicvaluechanged",
          this._boundNotifyFused
        );
      } else if (this.usesV16Motion) {
        await this.dataV16Char.startNotifications();
        this.dataV16Char.addEventListener(
          "characteristicvaluechanged",
          this._boundNotifyV16
        );
      } else {
        await this.dataChar.startNotifications();
        this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
      }
      this._motionNotifications = true;
      this._stage = "ready";
    } catch (error) {
      const device = this.device;
      const wasConnected = Boolean(device?.gatt?.connected);
      this._cleanup();
      if (wasConnected) device.gatt.disconnect();
      this.device = null;
      const detail = error?.message || String(error);
      const wrapped = new Error(`BLE setup failed at ${stage}: ${detail}`);
      wrapped.name = error?.name || "BLEError";
      throw wrapped;
    }
  }

  async setName(name) {
    return this._queueGatt(async () => {
      if (!this.nameChar) throw new Error("config name characteristic missing");
      const enc = new TextEncoder().encode(String(name || "").slice(0, 20));
      await this.nameChar.writeValueWithoutResponse(enc);
      this.advName = String(name || "");
      this.info.hasCustomName = this.advName.length > 0;
    });
  }

  async readBattery() {
    return this._queueGatt(async () => {
      if (!this.battChar) {
        this.battery = { millivolts: 0, percent: 0, valid: false };
        return this.battery;
      }
      const view = await this.battChar.readValue();
      this.battery = decodeBatt(view);
      return this.battery;
    });
  }

  async readCaps() {
    return this._queueGatt(async () => {
      if (!this.capsChar) return this.caps;
      this.caps = decodeCaps(await this.capsChar.readValue());
      this.protocolVersion = this.caps.firmwareProto || 2;
      return this.caps;
    });
  }

  /** @param {56|112|224|448} hz */
  async setRate(hz) {
    return this._queueGatt(async () => {
      if (![56, 112, 224, 448].includes(hz)) {
        throw new Error(`unsupported rate ${hz}`);
      }
      if (this.rateChar) {
        await this.rateChar.writeValueWithoutResponse(
          Uint8Array.of(rateToWire(hz))
        );
      }
      this.meta.rate_hz = hz;
    });
  }

  /** @param {0|1} profile */
  async setWorkoutProfile(profile) {
    return this._queueGatt(async () => {
      if (![0, 1].includes(profile)) {
        throw new Error(`unsupported workout profile ${profile}`);
      }
      if (this.profileChar) {
        await this.profileChar.writeValueWithoutResponse(Uint8Array.of(profile));
      }
      this.workoutProfile = profile;
    });
  }

  async readSessionStatus() {
    return this._queueGatt(async () => {
      try {
        return await Promise.race([
          this.readSessionStatusUnlocked(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("status read timeout")), 800)
          ),
        ]);
      } catch (error) {
        /* Prefer last notified status over wedging the GATT queue. */
        if (this.sessionStatus) return this.sessionStatus;
        throw error;
      }
    });
  }

  async sendSessionCommand(command, captureId, rateHz = 0, flags = 0) {
    return this._queueGatt(async () => {
      const expectState = SESSION_COMMAND_STATE[command] || null;
      if (this.sessionV16Char) {
        const commandId = this._nextCommandId++ & 0xffff || 1;
        const value = encodeSessionCommandV16(
          command,
          captureId,
          rateHz,
          flags,
          commandId
        );
        /* Write Command (no response): Write Request hangs under dual-pod
         * notify load on Windows/Chrome and never delivers STOP/DRAIN. */
        if (this.sessionV16Char.writeValueWithoutResponse) {
          await this.sessionV16Char.writeValueWithoutResponse(value);
        } else if (this.sessionV16Char.writeValueWithResponse) {
          await this.sessionV16Char.writeValueWithResponse(value);
        } else {
          await this.sessionV16Char.writeValue(value);
        }
      } else if (this.sessionChar) {
        const value = encodeSessionCommand(command, captureId, rateHz, flags);
        if (this.sessionChar.writeValueWithoutResponse) {
          await this.sessionChar.writeValueWithoutResponse(value);
        } else if (this.sessionChar.writeValueWithResponse) {
          await this.sessionChar.writeValueWithResponse(value);
        } else {
          await this.sessionChar.writeValue(value);
        }
      } else {
        throw new Error("session command characteristic missing");
      }
      return await this._awaitSessionState(expectState, 4000);
    });
  }

  /**
   * Prefer status notifications; fall back to short timed reads so a stalled
   * ATT Read cannot wedge the capture lifecycle forever.
   */
  async _awaitSessionState(expectState, timeoutMs = 4000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (!expectState || this.sessionStatus?.stateName === expectState) {
        return this.sessionStatus;
      }
      try {
        await Promise.race([
          this.readSessionStatusUnlocked(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("status read timeout")), 400)
          ),
        ]);
      } catch (_) {
        /* Notify may still update sessionStatus asynchronously. */
      }
      if (!expectState || this.sessionStatus?.stateName === expectState) {
        return this.sessionStatus;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    if (expectState) {
      throw new Error(
        `session command timeout waiting for ${expectState}` +
          ` (have ${this.sessionStatus?.stateName || "none"})`
      );
    }
    return this.sessionStatus;
  }

  async readSessionStatusUnlocked() {
    if (this.statusV16Char) {
      this.sessionStatus = decodeSessionStatusV16(
        await this.statusV16Char.readValue()
      );
      if (this.sessionStatus?.appliedRateHz) {
        this.meta.rate_hz = this.sessionStatus.appliedRateHz;
      }
      return this.sessionStatus;
    }
    if (!this.statusChar) return null;
    this.sessionStatus = decodeSessionStatus(await this.statusChar.readValue());
    return this.sessionStatus;
  }

  /**
   * Software sync handshake. Returns estimated device_time_ms at browser epoch.
   * offsetMs ≈ deviceWallMs - performance.now() for later alignment.
   */
  async syncClock() {
    return this._queueGatt(async () => {
      if (!this.syncChar) {
        return { offsetMs: 0, rttMs: 0, seq: 0 };
      }
      const t0 = performance.now();
      const req = new ArrayBuffer(8);
      new DataView(req).setBigUint64(0, BigInt(Math.round(t0)), true);

      const rspPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("sync timeout")), 1500);
        this._syncWaiters.push({
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
        });
      });

      await this.syncChar.writeValueWithoutResponse(new Uint8Array(req));
      const rsp = await rspPromise;
      const t1 = performance.now();
      const rttMs = t1 - t0;
      const deviceMs = rsp.deviceUs / 1000;
      const clientMid = t0 + rttMs / 2;
      const offsetMs = deviceMs - clientMid;
      return { offsetMs, rttMs, seq: rsp.seq, deviceMs, clientMid };
    });
  }

  async disconnect() {
    return this._queueGatt(async () => {
      await this._stopMotionNotifications();
      if (this.syncChar) {
        try {
          this.syncChar.removeEventListener("characteristicvaluechanged", this._boundSync);
          await this.syncChar.stopNotifications();
        } catch (_) { /* ignore */ }
      }
      if (this.statusChar) {
        try {
          this.statusChar.removeEventListener(
            "characteristicvaluechanged",
            this._boundSessionStatus
          );
          await this.statusChar.stopNotifications();
        } catch (_) { /* ignore */ }
      }
      if (this.statusV16Char) {
        try {
          this.statusV16Char.removeEventListener(
            "characteristicvaluechanged",
            this._boundSessionStatusV16
          );
          await this.statusV16Char.stopNotifications();
        } catch (_) { /* ignore */ }
      }
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
      this._cleanup();
      this._setStatus("Disconnected");
    });
  }

  async _stopMotionNotifications() {
    if (this.usesFusedMotion && this.dataFusedChar) {
      try {
        this.dataFusedChar.removeEventListener(
          "characteristicvaluechanged",
          this._boundNotifyFused
        );
        await this.dataFusedChar.stopNotifications();
      } catch (_) { /* ignore */ }
    } else if (this.usesV16Motion && this.dataV16Char) {
      try {
        this.dataV16Char.removeEventListener(
          "characteristicvaluechanged",
          this._boundNotifyV16
        );
        await this.dataV16Char.stopNotifications();
      } catch (_) { /* ignore */ }
    } else if (this.dataChar) {
      try {
        this.dataChar.removeEventListener("characteristicvaluechanged", this._boundNotify);
        await this.dataChar.stopNotifications();
      } catch (_) { /* ignore */ }
    }
    this._motionNotifications = false;
  }

  async pauseNotifications() {
    return this._queueGatt(async () => {
      if (!this._motionNotifications) return false;
      await this._stopMotionNotifications();
      return true;
    });
  }

  async resumeNotifications() {
    return this._queueGatt(async () => {
      if (this._motionNotifications) return false;
      if (this.usesFusedMotion && this.dataFusedChar) {
        await this.dataFusedChar.startNotifications();
        this.dataFusedChar.addEventListener(
          "characteristicvaluechanged",
          this._boundNotifyFused
        );
      } else if (this.usesV16Motion && this.dataV16Char) {
        await this.dataV16Char.startNotifications();
        this.dataV16Char.addEventListener(
          "characteristicvaluechanged",
          this._boundNotifyV16
        );
      } else if (this.dataChar) {
        await this.dataChar.startNotifications();
        this.dataChar.addEventListener("characteristicvaluechanged", this._boundNotify);
      } else {
        return false;
      }
      this._motionNotifications = true;
      this.resyncSequence();
      return true;
    });
  }

  /**
   * Soft hold: keep CCCD subscribed so firmware keeps sampling (no sequence
   * gap / stale UI), but ignore gap accounting during peer-pod connect.
   */
  beginPeerHold() {
    this._peerHold = true;
  }

  endPeerHold() {
    this._peerHold = false;
    this.resyncSequence();
  }

  resyncSequence() {
    const bits =
      this._seqTracker?.bits ||
      (this.usesFusedMotion || this.usesV16Motion ? 32 : 16);
    this._seqTracker = new SequenceTracker({ bits });
    this.gaps = 0;
    this.missingFrames = 0;
    this._lastQuat = null;
  }

  _emitFrames(frames) {
    for (const frame of frames) {
      if (this._peerHold) {
        /* Keep UI fresh during peer connect; do not accumulate false gaps. */
        if (this.onFrame) {
          this.onFrame({ ...frame, missing: 0 }, this.gaps, this.missingFrames);
        }
        continue;
      }
      const tracked = this._seqTracker.observe(frame.sampleIndex ?? frame.seq);
      this.gaps = this._seqTracker.gapEvents;
      this.missingFrames = this._seqTracker.missingFrames;
      let eng = frame.eng;
      if (frame.quat) {
        if (tracked.missing) {
          this._lastQuat = frame.quat;
        } else {
          const dt = 1 / Math.max(1, this.meta.rate_hz || RATE_LIVE_HZ);
          const gyro = gyroDpsFromQuat(this._lastQuat, frame.quat, dt);
          this._lastQuat = frame.quat;
          eng = { ...eng, ...gyro };
        }
      }
      const enriched = {
        ...frame,
        eng,
        sampleIndex: tracked.logical,
        missing: tracked.missing,
      };
      if (this.onFrame) this.onFrame(enriched, this.gaps, this.missingFrames);
    }
  }

  _onNotify(ev) {
    const view = ev.target.value;
    try {
      this._emitFrames(decodeFrames(view, this.meta));
    } catch (e) {
      console.warn(e);
    }
  }

  _onNotifyV16(ev) {
    const view = ev.target.value;
    try {
      this._emitFrames(decodeFramesV16(view, this.meta));
    } catch (e) {
      console.warn(e);
    }
  }

  _onNotifyFused(ev) {
    const view = ev.target.value;
    try {
      this._emitFrames(decodeFramesFused(view, this.meta));
    } catch (e) {
      console.warn(e);
    }
  }

  _onSyncNotify(ev) {
    try {
      const rsp = decodeSyncRsp(ev.target.value);
      const waiter = this._syncWaiters.shift();
      if (waiter) waiter.resolve(rsp);
    } catch (e) {
      console.warn(e);
    }
  }

  _onSessionStatusNotify(ev) {
    try {
      this.sessionStatus = decodeSessionStatus(ev.target.value);
      if (this.onSessionStatus) this.onSessionStatus(this.sessionStatus);
    } catch (e) {
      console.warn(e);
    }
  }

  _onSessionStatusNotifyV16(ev) {
    try {
      this.sessionStatus = decodeSessionStatusV16(ev.target.value);
      if (this.sessionStatus?.appliedRateHz) {
        this.meta.rate_hz = this.sessionStatus.appliedRateHz;
      }
      if (this.caps && this.sessionStatus?.attMtu) {
        this.caps = { ...this.caps, attMtu: this.sessionStatus.attMtu };
      }
      if (this.onSessionStatus) this.onSessionStatus(this.sessionStatus);
    } catch (e) {
      console.warn(e);
    }
  }

  _onDisconnect() {
    this._cleanup();
    this._setStatus("Disconnected (link lost)", "err");
    if (this.onDisconnect) this.onDisconnect();
  }

  _cleanup() {
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this._boundDisconnect);
    }
    if (this.statusChar) {
      this.statusChar.removeEventListener(
        "characteristicvaluechanged",
        this._boundSessionStatus
      );
    }
    if (this.statusV16Char) {
      this.statusV16Char.removeEventListener(
        "characteristicvaluechanged",
        this._boundSessionStatusV16
      );
    }
    this.dataChar = null;
    this.dataV16Char = null;
    this.dataFusedChar = null;
    this.nameChar = null;
    this.syncChar = null;
    this.battChar = null;
    this.rateChar = null;
    this.profileChar = null;
    this.sessionChar = null;
    this.sessionV16Char = null;
    this.statusChar = null;
    this.statusV16Char = null;
    this.capsChar = null;
    this.sessionStatus = null;
    this.server = null;
    this._motionNotifications = false;
    while (this._syncWaiters.length) {
      this._syncWaiters.shift().resolve?.({ clientMs: 0, deviceUs: 0, seq: 0 });
    }
  }
}
