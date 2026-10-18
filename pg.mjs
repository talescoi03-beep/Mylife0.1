// Test-only minimal PostgreSQL client (simple query protocol, trust auth).
import net from 'node:net';

export class Pg {
  constructor({ socket, host = '127.0.0.1', port = 5432, user = 'postgres', database = 'postgres' }) {
    this.opts = { socket, host, port, user, database };
    this.queue = Promise.resolve();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const s = this.opts.socket ? net.connect(this.opts.socket) : net.connect(this.opts.port, this.opts.host);
      this.sock = s;
      this.buf = Buffer.alloc(0);
      this.waiter = null;
      s.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
      s.on('error', (e) => { if (this.waiter) this.waiter.reject(e); else reject(e); });
      const params = Buffer.from(`user\0${this.opts.user}\0database\0${this.opts.database}\0\0`);
      const head = Buffer.alloc(8);
      head.writeInt32BE(8 + params.length, 0);
      head.writeInt32BE(196608, 4);
      s.once('connect', () => s.write(Buffer.concat([head, params])));
      this.waiter = { resolve, reject, rows: [], err: null, startup: true };
    });
  }

  drain() {
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < 1 + len) return;
      const body = this.buf.subarray(5, 1 + len);
      this.buf = this.buf.subarray(1 + len);
      const w = this.waiter;
      if (!w) continue;
      if (type === 'R' && body.readInt32BE(0) !== 0) { w.reject(new Error('Unsupported auth method (use trust)')); continue; }
      if (type === 'D') {
        const n = body.readInt16BE(0);
        let off = 2;
        const row = [];
        for (let i = 0; i < n; i++) {
          const l = body.readInt32BE(off); off += 4;
          if (l === -1) row.push(null);
          else { row.push(body.subarray(off, off + l).toString('utf8')); off += l; }
        }
        w.rows.push(row);
      } else if (type === 'E') {
        const fields = {};
        let off = 0;
        while (off < body.length && body[off] !== 0) {
          const code = String.fromCharCode(body[off]);
          const end = body.indexOf(0, off + 1);
          fields[code] = body.subarray(off + 1, end).toString('utf8');
          off = end + 1;
        }
        const err = new Error(fields.M || 'Postgres error');
        err.code = fields.C;
        err.detail = fields.D;
        w.err = w.err || err;
      } else if (type === 'Z') {
        this.waiter = null;
        if (w.err) w.reject(w.err); else w.resolve(w.startup ? this : w.rows);
      }
    }
  }

  /** Runs SQL (may contain several statements). Resolves with rows of text values. */
  query(sql) {
    return this.enqueue(() => this.raw(sql));
  }

  /** Runs a transaction script; on error rolls back before the next query runs. */
  transaction(sql) {
    return this.enqueue(async () => {
      try { return await this.raw(sql); } catch (e) { await this.raw('rollback').catch(() => {}); throw e; }
    });
  }

  enqueue(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  raw(sql) {
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject, rows: [], err: null };
      const q = Buffer.from(sql + '\0');
      const head = Buffer.alloc(5);
      head.write('Q', 0);
      head.writeInt32BE(4 + q.length, 1);
      this.sock.write(Buffer.concat([head, q]));
    });
  }

  end() { this.sock?.end(); }
}

export const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
export function dollar(text) {
  let tag = 'j';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
}
