export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private readonly mask: number;
  private readonly cap: number;
  private _dropped = 0;

  constructor(capacity: number) {
    this.cap = 1 << Math.ceil(Math.log2(capacity));
    this.mask = this.cap - 1;
    this.buf = new Array(this.cap);
  }

  get size(): number {
    return (this.tail - this.head + this.cap) & this.mask;
  }

  get dropped(): number {
    return this._dropped;
  }

  push(item: T): boolean {
    const nextTail = (this.tail + 1) & this.mask;
    if (nextTail === this.head) {
      // Full: drop-oldest
      this.buf[this.tail] = item;
      this.tail = nextTail;
      this.head = (this.head + 1) & this.mask;
      this._dropped++;
      return false;
    }
    this.buf[this.tail] = item;
    this.tail = nextTail;
    return true;
  }

  pushBatch(items: T[]): number {
    let dropped = 0;
    for (const item of items) {
      if (!this.push(item)) dropped++;
    }
    return dropped;
  }

  drain(max: number): T[] {
    const out: T[] = [];
    while (out.length < max && this.size > 0) {
      const item = this.buf[this.head];
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) & this.mask;
      out.push(item!);
    }
    return out;
  }
}
