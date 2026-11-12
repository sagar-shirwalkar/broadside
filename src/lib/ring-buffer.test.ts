import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer.js";

describe("RingBuffer", () => {
  it("rounds capacity up to the next power of two", () => {
    const ring = new RingBuffer<number>(3);

    // Capacity 4 leaves three usable slots; the fourth push drops the oldest.
    expect(ring.pushBatch([1, 2, 3, 4])).toBe(1);
    expect(ring.size).toBe(3);
    expect(ring.dropped).toBe(1);
  });

  it("pushes and drains items in FIFO order", () => {
    const ring = new RingBuffer<string>(8);

    expect(ring.push("a")).toBe(true);
    expect(ring.push("b")).toBe(true);
    expect(ring.size).toBe(2);
    expect(ring.dropped).toBe(0);

    expect(ring.drain(1)).toEqual(["a"]);
    expect(ring.size).toBe(1);

    expect(ring.drain(10)).toEqual(["b"]);
    expect(ring.size).toBe(0);
    expect(ring.drain(1)).toEqual([]);
  });

  it("drops the oldest item when full", () => {
    const ring = new RingBuffer<number>(2);

    expect(ring.push(1)).toBe(true);
    expect(ring.push(2)).toBe(false);
    expect(ring.dropped).toBe(1);
    expect(ring.drain(10)).toEqual([2]);
  });

  it("tracks drops across wrapped writes", () => {
    const ring = new RingBuffer<number>(2);

    expect(ring.pushBatch([1, 2, 3, 4, 5])).toBe(4);
    expect(ring.size).toBe(1);
    expect(ring.dropped).toBe(4);
    expect(ring.drain(10)).toEqual([5]);
  });

  it("returns an empty array when draining an empty buffer", () => {
    const ring = new RingBuffer<number>(4);

    expect(ring.drain(0)).toEqual([]);
    expect(ring.drain(4)).toEqual([]);
  });
});
