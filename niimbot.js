// NIIMBOT B1 over Web Bluetooth, after niimbluelib (MultiMote) B1PrintTask.
// Frame: 55 55 CMD LEN DATA.. XOR(CMD,LEN,DATA) AA AA

export const SERVICE = "e7810a71-73ae-499d-8c15-faa9aef0c3f2";
export const DPMM = 8;              // 203 dpi
export const PRINTHEAD = 384;       // px

const hi = (v) => (v >> 8) & 255;
const lo = (v) => v & 255;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function packet(cmd, data = [1]) {
  const p = new Uint8Array(data.length + 7);
  p[0] = p[1] = 0x55;
  p[2] = cmd;
  p[3] = data.length;
  p.set(data, 4);
  let x = cmd ^ data.length;
  for (const b of data) x ^= b;
  p[p.length - 3] = x;
  p[p.length - 2] = p[p.length - 1] = 0xaa;
  return p;
}

/** Row packets for 1-bit pixels (1 = black, row-major). Empty rows -> 0x84, others -> 0x85. */
export function rowPackets(px, width, height) {
  const bytes = Math.ceil(width / 8), chunk = PRINTHEAD / 8 / 3; // black counts per third of the printhead
  const out = [];
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(bytes), parts = [0, 0, 0];
    let total = 0;
    for (let x = 0; x < width; x++) {
      if (!px[y * width + x]) continue;
      line[x >> 3] |= 0x80 >> (x & 7);
      parts[Math.min(2, Math.floor((x >> 3) / chunk))]++;
      total++;
    }
    out.push(total === 0 ? packet(0x84, [hi(y), lo(y), 1]) : packet(0x85, [hi(y), lo(y), ...parts, 1, ...line]));
  }
  return out;
}

/** Threshold canvas ImageData to 1-bit pixels. */
export function toPixels(img, threshold = 128) {
  const px = new Uint8Array(img.width * img.height);
  for (let i = 0; i < px.length; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2], a = img.data[i * 4 + 3];
    px[i] = a > 127 && (r * 299 + g * 587 + b * 114) / 1000 < threshold ? 1 : 0;
  }
  return px;
}

export class Printer {
  constructor(device) {
    this.device = device;
    this.buf = [];
    this.waiters = [];
  }

  get name() { return this.device.name || "NIIMBOT"; }
  get connected() { return !!this.device.gatt?.connected && !!this.channel; }

  /** Shows the browser's device chooser (needs a user gesture). */
  static async pick() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "B" }, { namePrefix: "D" }, { services: [SERVICE] }],
      optionalServices: [SERVICE],
    });
    return new Printer(device);
  }

  /** A printer this site was allowed before, if the browser supports getDevices(). */
  static async remembered(name) {
    if (!navigator.bluetooth.getDevices) return null;
    const list = await navigator.bluetooth.getDevices();
    const d = list.find((x) => !name || x.name === name) ?? list[0];
    return d ? new Printer(d) : null;
  }

  async connect() {
    const server = await this.device.gatt.connect();
    for (const s of await server.getPrimaryServices()) {
      if (s.uuid.length < 5) continue;
      for (const c of await s.getCharacteristics()) {
        if (c.properties.notify && c.properties.writeWithoutResponse) { this.channel = c; break; }
      }
      if (this.channel) break;
    }
    if (!this.channel) throw new Error("Druckerkanal nicht gefunden");
    this.channel.addEventListener("characteristicvaluechanged", (e) => { const v = e.target.value; this.feed(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); });
    await this.channel.startNotifications();
    // Connect packet is prefixed with 0x03; older firmware may not answer.
    await this.write(new Uint8Array([3, ...packet(0xc1)]));
    await this.wait(0xc2, 1500).catch(() => {});
  }

  disconnect() { try { this.device.gatt.disconnect(); } catch {} }

  async write(bytes) { await this.channel.writeValueWithoutResponse(bytes); }

  feed(bytes) {
    this.buf.push(...bytes);
    for (;;) {
      let i = this.buf.findIndex((b, k) => b === 0x55 && this.buf[k + 1] === 0x55);
      if (i < 0) { this.buf = []; return; }
      if (i > 0) this.buf.splice(0, i);
      if (this.buf.length < 4 || this.buf.length < this.buf[3] + 7) return;
      const frame = this.buf.splice(0, this.buf[3] + 7);
      const cmd = frame[2], data = frame.slice(4, -3);
      const w = this.waiters.findIndex((x) => x.cmd === cmd || cmd === 0xdb);
      if (w >= 0) {
        const [x] = this.waiters.splice(w, 1);
        clearTimeout(x.timer);
        cmd === 0xdb ? x.reject(new Error(`Drucker lehnt ab (Fehler ${data[0]})`)) : x.resolve(data);
      }
    }
  }

  wait(cmd, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const x = { cmd, resolve, reject };
      x.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(x), 1); reject(new Error(`Keine Antwort 0x${cmd.toString(16)}`)); }, timeout);
      this.waiters.push(x);
    });
  }

  async send(cmd, resp, data = [1], timeout = 3000) {
    const p = this.wait(resp, timeout);
    await this.write(packet(cmd, data));
    return p;
  }

  /** Prints the same page `copies` times. onProgress(0..100). */
  async print(px, width, height, { copies = 1, density = 3, labelType = 1 } = {}, onProgress = () => {}) {
    await this.send(0x21, 0x31, [density]);                          // SetDensity
    await this.send(0x23, 0x33, [labelType]);                        // SetLabelType
    for (let attempt = 1; ; attempt++) {                             // PrintStart (7b): total labels
      try { await this.send(0x01, 0x02, [hi(copies), lo(copies), 0, 0, 0, 0, 0]); break; }
      catch (e) { if (attempt >= 5) throw e; await sleep(1000); }   // still finishing a previous job
    }
    await this.send(0x03, 0x04, [1], 30000);                         // PageStart
    await this.send(0x13, 0x14, [hi(height), lo(height), hi(width), lo(width), hi(copies), lo(copies)], 30000); // SetPageSize
    const rows = rowPackets(px, width, height);
    for (let i = 0; i < rows.length; i++) {
      await sleep(10);                                                // BLE pacing like NiimBlue
      await this.write(rows[i]);
      if (i % 16 === 0) onProgress(Math.round((i / rows.length) * 50));
    }
    await this.send(0xe3, 0xe4, [1], 30000);                         // PageEnd
    const until = Date.now() + 20000 + 8000 * copies;
    for (;;) {
      const s = await this.send(0xa3, 0xb3);                          // PrintStatus: page u16, print%, feed%
      if (s.length >= 10 && s[6] !== 0) throw new Error(`Druckerfehler ${s[6]}`);
      const done = (s[0] << 8) | s[1];
      onProgress(50 + Math.min(50, Math.round(((done * 100 + (s[2] + s[3]) / 2) / copies) / 2)));
      if (done >= copies) break;
      if (Date.now() > until) throw new Error("Drucker meldet kein fertiges Etikett");
      await sleep(300);
    }
    await this.send(0xf3, 0xf4);                                      // PrintEnd
  }
}
