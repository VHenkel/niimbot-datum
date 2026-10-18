// node test.mjs — checks packet encoding against a known NIIMBOT frame and the row packet layout.
import assert from "node:assert/strict";
import { packet, rowPackets, toPixels, Printer } from "./niimbot.js";

const hex = (a) => Buffer.from(a).toString("hex");

// known frame from niimbluelib packet_generator.ts (indexed row 0x83)
assert.equal(hex(packet(0x83, [...Buffer.from("007e0004000100270028002900" + "2a", "hex")])), "5555830e007e00040001002700280029002afaaaaa");
assert.equal(hex(packet(0xc1)), "5555c10101c1aaaa");

// 2 rows of 384 px: first empty, second with pixels 0, 200, 383
const px = new Uint8Array(2 * 384);
px[384 + 0] = px[384 + 200] = px[384 + 383] = 1;
const [r0, r1] = rowPackets(px, 384, 2);
assert.equal(r0[2], 0x84);
assert.equal(r1[2], 0x85);
assert.equal(r1[3], 54);                       // 6 header bytes + 48 data bytes
assert.deepEqual([...r1.slice(6, 9)], [1, 1, 1]); // one black pixel per printhead third
assert.equal(r1[10], 0x80);                    // pixel 0 = MSB of first byte
assert.equal(r1[r1.length - 4], 0x01);         // pixel 383 = LSB of last byte

// threshold
const img = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
assert.deepEqual([...toPixels(img)], [1, 0]);

// full print job against a simulated B1 (answers like the real one, split over several notifications)
const sent = [];
const sim = new Printer({ name: "B1-SIM" });
let printed = 0;
sim.channel = {
  async writeValueWithoutResponse(bytes) {
    const cmd = bytes[0] === 3 ? bytes[3] : bytes[2];
    sent.push(cmd);
    const answer = { 0xc1: 0xc2, 0x21: 0x31, 0x23: 0x33, 0x01: 0x02, 0x03: 0x04, 0x13: 0x14, 0xe3: 0xe4, 0xf3: 0xf4 }[cmd];
    let reply = answer ? packet(answer, [1]) : null;
    if (cmd === 0xe3) printed = 2;
    if (cmd === 0xa3) reply = packet(0xb3, [0, printed, 100, 100]);
    if (reply) setTimeout(() => { sim.feed(reply.slice(0, 3)); sim.feed(reply.slice(3)); }, 1);
  },
};
const page = new Uint8Array(16 * 8); page[5] = 1;
const progress = [];
await sim.print(page, 16, 8, { copies: 2 }, (p) => progress.push(p));
assert.deepEqual(sent.filter((c) => c !== 0x84 && c !== 0x85), [0x21, 0x23, 0x01, 0x03, 0x13, 0xe3, 0xa3, 0xf3]);
assert.equal(sent.filter((c) => c === 0x84 || c === 0x85).length, 8);
assert.equal(progress.at(-1), 100);

console.log("ok");
