// Turns the fragmented MP4 that browsers record (moov + many moof/mdat pieces, overall length 0) into a plain
// MP4 (one moov with full sample tables and the real length, then one mdat), the kind phones and WhatsApp expect.
// Any surprise in the input returns null, and the caller keeps the original file.

const u32 = (d, i) => d.getUint32(i);
const u64 = (d, i) => d.getUint32(i) * 2 ** 32 + d.getUint32(i + 4);
const type = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function children(b, d, start, end) {
  const out = [];
  for (let i = start; i + 8 <= end; ) {
    let size = u32(d, i), head = 8;
    if (size === 1) { size = u64(d, i + 8); head = 16; }
    else if (size === 0) size = end - i;
    if (size < head || i + size > end) throw new Error("bad box");
    out.push({ type: type(b, i + 4), start: i, end: i + size, body: i + head });
    i += size;
  }
  return out;
}
const find = (list, t) => list.find((x) => x.type === t);

export function box(t, ...parts) {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  const d = new DataView(out.buffer);
  d.setUint32(0, len);
  for (let k = 0; k < 4; k++) out[4 + k] = t.charCodeAt(k);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function full(t, version, flags, words) { // full box whose body is 32-bit words
  const p = new Uint8Array(4 + words.length * 4);
  const d = new DataView(p.buffer);
  d.setUint32(0, (version << 24) | flags);
  words.forEach((w, k) => d.setUint32(4 + k * 4, w >>> 0));
  return box(t, p);
}

export function defragment(input) {
  try {
    const b = input, d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const top = children(b, d, 0, b.length);
    const ftyp = find(top, "ftyp"), moov = find(top, "moov");
    if (!ftyp || !moov) return null;
    const mk = children(b, d, moov.body, moov.end);
    const mvhd = find(mk, "mvhd");
    const trex = {};
    const mvex = find(mk, "mvex");
    if (!mvex) return null; // already a plain MP4
    for (const x of children(b, d, mvex.body, mvex.end))
      if (x.type === "trex") trex[u32(d, x.body + 4)] = { dur: u32(d, x.body + 12), size: u32(d, x.body + 16), flags: u32(d, x.body + 20) };

    const tracks = new Map(); // id -> { trak, samples: [], chunks: [] }
    for (const x of mk.filter((x) => x.type === "trak")) {
      const tk = children(b, d, x.body, x.end);
      const tkhd = find(tk, "tkhd");
      const v = b[tkhd.body];
      const id = u32(d, tkhd.body + (v ? 20 : 12));
      tracks.set(id, { box: x, samples: [], chunks: [] });
    }

    // walk the fragments in order; each traf run of samples becomes one chunk
    const order = []; // [{ id, from, to }] sample index ranges, in file order
    for (const m of top.filter((x) => x.type === "moof")) {
      for (const traf of children(b, d, m.body, m.end).filter((x) => x.type === "traf")) {
        const tc = children(b, d, traf.body, traf.end);
        const th = find(tc, "tfhd");
        const tf = u32(d, th.body) & 0xffffff;
        const id = u32(d, th.body + 4);
        const tr = tracks.get(id);
        if (!tr) return null;
        let o = th.body + 8;
        let base = m.start;
        if (tf & 0x1) { base = u64(d, o); o += 8; }
        if (tf & 0x2) o += 4;
        const def = { ...(trex[id] || { dur: 0, size: 0, flags: 0 }) };
        if (tf & 0x8) { def.dur = u32(d, o); o += 4; }
        if (tf & 0x10) { def.size = u32(d, o); o += 4; }
        if (tf & 0x20) { def.flags = u32(d, o); o += 4; }
        let cursor = base;
        for (const run of tc.filter((x) => x.type === "trun")) {
          const vf = u32(d, run.body), v = vf >>> 24, f = vf & 0xffffff;
          let p = run.body + 4;
          const count = u32(d, p); p += 4;
          if (f & 0x1) { cursor = base + d.getInt32(p); p += 4; }
          let first = null;
          if (f & 0x4) { first = u32(d, p); p += 4; }
          const from = tr.samples.length;
          for (let k = 0; k < count; k++) {
            const dur = f & 0x100 ? u32(d, (p += 4) - 4) : def.dur;
            const size = f & 0x200 ? u32(d, (p += 4) - 4) : def.size;
            let flags = f & 0x400 ? u32(d, (p += 4) - 4) : def.flags;
            if (k === 0 && first !== null) flags = first;
            const cto = f & 0x800 ? (v ? d.getInt32((p += 4) - 4) : u32(d, (p += 4) - 4)) : 0;
            if (cursor + size > b.length) return null;
            tr.samples.push({ at: cursor, size, dur, sync: !(flags & 0x10000), cto });
            cursor += size;
          }
          if (count) order.push({ id, from, to: tr.samples.length });
        }
      }
    }
    if (!order.length) return null;

    const mvTs = u32(d, mvhd.body + (b[mvhd.body] ? 20 : 12));
    const total = order.reduce((n, c) => n + c.to - c.from, 0);
    const dataLen = [...tracks.values()].reduce((n, tr) => n + tr.samples.reduce((m, s) => m + s.size, 0), 0);
    if (dataLen > 0xffffffff - 1e7) return null;

    // build moov twice: first to learn its size, then with the real chunk offsets
    const build = (mdatStart) => {
      let off = mdatStart + 8;
      for (const tr of tracks.values()) tr.chunks = [];
      for (const c of order) {
        const tr = tracks.get(c.id);
        tr.chunks.push({ off, n: c.to - c.from });
        for (let k = c.from; k < c.to; k++) off += tr.samples[k].size;
      }
      let longest = 0;
      const traks = [];
      for (const tr of tracks.values()) {
        const tk = children(b, d, tr.box.body, tr.box.end);
        const mdia = find(tk, "mdia");
        const ma = children(b, d, mdia.body, mdia.end);
        const mdhd = find(ma, "mdhd");
        const minf = find(ma, "minf");
        const mi = children(b, d, minf.body, minf.end);
        const stbl = find(mi, "stbl");
        const stsd = find(children(b, d, stbl.body, stbl.end), "stsd");
        const S = tr.samples;
        const mediaDur = S.reduce((n, s) => n + s.dur, 0);
        const mdTs = u32(d, mdhd.body + (b[mdhd.body] ? 20 : 12));
        const movieDur = Math.round((mediaDur * mvTs) / (mdTs || 1));
        longest = Math.max(longest, movieDur);

        const stts = [];
        for (const s of S) {
          const last = stts[stts.length - 1];
          if (last && last[1] === s.dur) last[0]++; else stts.push([1, s.dur]);
        }
        const stsc = [];
        tr.chunks.forEach((c, k) => { if (!stsc.length || stsc[stsc.length - 1][1] !== c.n) stsc.push([k + 1, c.n, 1]); });
        const parts = [
          b.slice(stsd.start, stsd.end),
          full("stts", 0, 0, [stts.length, ...stts.flat()]),
        ];
        if (S.some((s) => s.cto)) {
          const ct = [];
          for (const s of S) {
            const last = ct[ct.length - 1];
            if (last && last[1] === s.cto) last[0]++; else ct.push([1, s.cto]);
          }
          parts.push(full("ctts", S.some((s) => s.cto < 0) ? 1 : 0, 0, [ct.length, ...ct.flat()]));
        }
        if (!S.every((s) => s.sync)) {
          const ss = S.map((s, k) => (s.sync ? k + 1 : 0)).filter(Boolean);
          parts.push(full("stss", 0, 0, [ss.length, ...ss]));
        }
        parts.push(full("stsc", 0, 0, [stsc.length, ...stsc.flat()]));
        parts.push(full("stsz", 0, 0, [0, S.length, ...S.map((s) => s.size)]));
        parts.push(full("stco", 0, 0, [tr.chunks.length, ...tr.chunks.map((c) => c.off)]));
        const newStbl = box("stbl", ...parts);
        const newMinf = box("minf", ...mi.map((x) => (x === stbl ? newStbl : b.slice(x.start, x.end))));
        const newMdhd = b.slice(mdhd.start, mdhd.end);
        setDuration(newMdhd, mediaDur, "mdhd");
        const newMdia = box("mdia", ...ma.map((x) => (x === mdhd ? newMdhd : x === minf ? newMinf : b.slice(x.start, x.end))));
        const tkhd = find(tk, "tkhd");
        const newTkhd = b.slice(tkhd.start, tkhd.end);
        setDuration(newTkhd, movieDur, "tkhd");
        traks.push(box("trak", ...tk.map((x) => (x === tkhd ? newTkhd : x === mdia ? newMdia : b.slice(x.start, x.end)))));
      }
      const newMvhd = b.slice(mvhd.start, mvhd.end);
      setDuration(newMvhd, longest, "mvhd");
      const rest = mk.filter((x) => x.type !== "mvhd" && x.type !== "trak" && x.type !== "mvex").map((x) => b.slice(x.start, x.end));
      return box("moov", newMvhd, ...traks, ...rest);
    };
    const ft = b.slice(ftyp.start, ftyp.end);
    let mv = build(ft.length);
    mv = build(ft.length + mv.length);

    const out = new Uint8Array(ft.length + mv.length + 8 + dataLen);
    out.set(ft, 0);
    out.set(mv, ft.length);
    let o = ft.length + mv.length;
    new DataView(out.buffer).setUint32(o, 8 + dataLen);
    out.set([109, 100, 97, 116], o + 4); // "mdat"
    o += 8;
    for (const c of order) {
      const S = tracks.get(c.id).samples;
      for (let k = c.from; k < c.to; k++) { out.set(b.subarray(S[k].at, S[k].at + S[k].size), o); o += S[k].size; }
    }
    return total ? out : null;
  } catch {
    return null;
  }
}

// mvhd / mdhd / tkhd keep their duration at a fixed place for each version
function setDuration(bx, value, t) {
  const d = new DataView(bx.buffer, bx.byteOffset, bx.byteLength);
  const v = bx[8];
  const at = t === "tkhd" ? (v ? 36 : 28) : v ? 32 : 24;
  if (v) { d.setUint32(at, Math.floor(value / 2 ** 32)); d.setUint32(at + 4, value >>> 0); }
  else d.setUint32(at, Math.min(value, 0xffffffff));
}
