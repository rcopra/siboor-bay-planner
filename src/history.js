// Undo and redo over snapshots (strings) of the layout: record one after every change; a snapshot
// equal to the current one is not a change.
export class History {
  constructor(first, limit = 200) {
    this.past = []; this.future = []; this.now = first; this.limit = limit;
  }

  record(snap) {
    if (snap === this.now) return false;
    this.past.push(this.now);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.now = snap;
    return true;
  }

  // the snapshot to go back to, or null
  undo() {
    if (!this.past.length) return null;
    this.future.push(this.now);
    return (this.now = this.past.pop());
  }

  redo() {
    if (!this.future.length) return null;
    this.past.push(this.now);
    return (this.now = this.future.pop());
  }
}
