import * as base from '@scure/base';
import * as P from 'micro-packed';

const UNKNOWN = '(???)';
const bold = '\x1b[1m';
const gray = '\x1b[90m';
const reset = '\x1b[0m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';

type DebugPath = { start: number; end?: number; path: string; value?: any };
class DebugReader extends P.Reader {
  debugLst: DebugPath[] = [];
  cur?: DebugPath;
  get lastElm() {
    if (this.debugLst.length) return this.debugLst[this.debugLst.length - 1];
    return { start: 0, end: 0, path: '' };
  }
  fieldPathPush(s: string) {
    const last = this.lastElm;
    if (last.end === undefined) last.end = this.pos;
    else if (last.end !== this.pos) {
      this.debugLst.push({
        path: [...this.fieldPath, UNKNOWN].join('/'),
        start: last.end,
        end: this.pos,
      });
    }
    this.cur = { path: [...this.fieldPath, s].join('/'), start: this.pos };
    super.fieldPathPush(s);
  }
  fieldPathPop() {
    // happens if pop after pop (exit from nested structure)
    if (!this.cur) {
      const last = this.lastElm;
      if (last.end === undefined) last.end = this.pos;
      else if (last.end !== this.pos) {
        this.debugLst.push({ start: last.end, end: this.pos, path: last.path + `/${UNKNOWN}` });
      }
    } else {
      this.cur.end = this.pos;
      const lastItem = this.path[this.path.length - 1];
      const lastField = this.fieldPath[this.fieldPath.length - 1];
      if (lastItem && lastField !== undefined) this.cur.value = lastItem[lastField];
      this.debugLst.push(this.cur);
      this.cur = undefined;
    }
    super.fieldPathPop();
  }
  finishDebug(): void {
    const end = this.data.length;
    if (this.cur) this.debugLst.push({ end, ...this.cur });
    const last = this.lastElm;
    if (!last || last.end !== end) this.debugLst.push({ start: this.pos, end, path: UNKNOWN });
  }
}

function toBytes(data: string | P.Bytes): P.Bytes {
  if (P.isBytes(data)) return data;
  if (typeof data !== 'string') throw new Error('PD: data should be string or Uint8Array');
  try {
    return base.base64.decode(data);
  } catch (e) {}
  try {
    return base.hex.decode(data);
  } catch (e) {}
  throw new Error(`PD: data has unknown string format: ${data}`);
}

type DebugData = { path: string; data: P.Bytes; value?: any };
function mapData(lst: DebugPath[], data: P.Bytes): DebugData[] {
  let end = 0;
  const res: DebugData[] = [];
  for (const elm of lst) {
    if (elm.start !== end) throw new Error(`PD: elm start=${elm.start} after prev elm end=${end}`);
    if (elm.end === undefined) throw new Error(`PD: elm.end is undefined=${elm}`);
    res.push({ path: elm.path, data: data.slice(elm.start, elm.end), value: elm.value });
    end = elm.end;
  }
  if (end !== data.length) throw new Error('PD: not all data mapped');
  return res;
}

function chrWidth(s: string) {
  /*
  It is almost impossible to find out real characters width in terminal since it depends on terminal itself, current unicode version and moon's phase.
  So, we just stripping ANSI, tabs and unicode supplimental characters. Emoji support requires big tables (and have no guarantee to work), so we ignore it for now.
  Also, no support for full width unicode characters for now.
  */
  return s
    .replace(
      /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g,
      ''
    )
    .replace('\t', '  ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ').length;
}

function wrap(s: string, padding: number = 0) {
  const limit = process.stdout.columns - 3 - padding;
  if (chrWidth(s) <= limit) return s;
  while (chrWidth(s) > limit) s = s.slice(0, -1);
  return `${s}${reset}...`;
}

export function table(data: any[]) {
  let res: string[] = [];
  const str = (v: any) => (v === undefined ? '' : '' + v);
  const pad = (s: string, width: number) =>
    `${s}${''.padEnd(Math.max(0, width - chrWidth(s)), ' ')}`;
  let widths: Record<string, number> = {};
  for (let elm of data) {
    for (let k in elm) {
      widths[k] = Math.max(
        widths[k] || 0,
        chrWidth(str(k)),
        str(elm[k])
          .split('\n')
          .reduce((a, b) => Math.max(a, chrWidth(b)), 0)
      );
    }
  }
  const columns = Object.keys(widths);
  if (!data.length || !columns.length) throw new Error('No data');
  const padding = ` ${reset}${gray}│${reset} `;
  res.push(wrap(` ${columns.map((c) => `${bold}${pad(c, widths[c])}`).join(padding)}${reset}`, 3));
  for (let idx = 0; idx < data.length; idx++) {
    const elm = data[idx];
    const row = columns.map((i) => str(elm[i]).split('\n'));
    let message = [...Array(Math.max(...row.map((i) => i.length))).keys()]
      .map((line) => row.map((c, i) => pad(str(c[line]), widths[columns[i]])))
      .map((line, i) => wrap(` ${line.join(padding)} `, 1))
      .join('\n');
    res.push(message);
  }
  for (let i = 0; i < res.length; i++) {
    const border = columns
      .map((c) => ''.padEnd(widths[c], '─'))
      .join(`─${i === res.length - 1 ? '┴' : '┼'}─`);
    res[i] += wrap(`\n${reset}${gray}─${border}─${reset}`);
  }
  console.log(res.join('\n'));
}

function fmtData(data: P.Bytes, perLine = 8) {
  const res = [];
  for (let i = 0; i < data.length; i += perLine) {
    res.push(base.hex.encode(data.slice(i, i + perLine)));
  }
  return res.map((i) => `${bold}${i}${reset}`).join('\n');
}


function fmtValue(value: any) {
  if (P.isBytes(value)) return `b(${green}${base.hex.encode(value)}${reset} len=${value.length})`;
  if (typeof value === 'string') return `s(${green}"${value}"${reset} len=${value.length})`;
  if (typeof value === 'number' || typeof value === 'bigint') return `n(${value})`;
  // console.log('fmt', value);
  // if (Object.prototype.toString.call(value) === '[object Object]') return inspect(value);
  return '' + value;
}

export function decode(
  coder: P.CoderType<any>,
  data: string | P.Bytes,
  forcePrint = false
): ReturnType<typeof coder['decode']> {
  data = toBytes(data);
  const r = new DebugReader(data);
  let res, e;
  try {
    res = coder.decodeStream(r);
    r.finish();
  } catch (_e) {
    e = _e;
  }
  r.finishDebug();
  if (e || forcePrint) {
    console.log('==== DECODED BEFORE ERROR ====');
    table(
      mapData(r.debugLst, data).map((elm) => ({
        Data: fmtData(elm.data),
        Len: elm.data.length,
        Path: `${green}${elm.path}${reset}`,
        Value: fmtValue(elm.value),
      }))
    );
    console.log('==== /DECODED BEFORE ERROR ====');
  }
  if (e) throw e;
  return res;
}

function getMap(coder: P.CoderType<any>, data: string | P.Bytes) {
  data = toBytes(data);
  const r = new DebugReader(data);
  coder.decodeStream(r);
  r.finish();
  r.finishDebug();
  return mapData(r.debugLst, data);
}

function diffData(a: P.Bytes, e: P.Bytes) {
  const len = Math.max(a.length, e.length);
  let outA = '',
    outE = '';
  const charHex = (n: number) => n.toString(16).padStart(2, '0');
  for (let i = 0; i < len; i++) {
    const [aI, eI] = [a[i], e[i]];
    if (i && !(i % 8)) {
      if (aI !== undefined) outA += '\n';
      if (eI !== undefined) outE += '\n';
    }
    if (aI !== undefined) outA += aI === eI ? charHex(aI) : `${yellow}${charHex(aI)}${reset}`;
    if (eI !== undefined) outE += aI === eI ? charHex(eI) : `${yellow}${charHex(eI)}${reset}`;
  }
  return [outA, outE];
}

function diffPath(a: string, e: string) {
  if (a === e) return a;
  return `A: ${red}${a}${reset}\nE: ${green}${e}${reset}`;
}
function diffLength(a: P.Bytes, e: P.Bytes) {
  const [aLen, eLen] = [a.length, e.length];
  if (aLen === eLen) return aLen;
  return `A: ${red}${aLen}${reset}\nE: ${green}${eLen}${reset}`;
}

function diffValue(a: any, e: any) {
  const [aV, eV] = [a, e].map(fmtValue);
  if (aV === eV) return aV;
  return `A: ${red}${aV}${reset}\nE: ${green}${eV}${reset}`;
}

export function diff(
  coder: P.CoderType<any>,
  actual: string | P.Bytes,
  expected: string | P.Bytes,
  skipSame = true
) {
  console.log('==== DIFF ====');
  const [_actual, _expected] = [actual, expected].map((i) => getMap(coder, i)) as [
    DebugData[],
    DebugData[]
  ];
  const len = Math.max(_actual.length, _expected.length);
  const data = [];
  const DEF = { data: P.EMPTY, path: '' };
  for (let i = 0; i < len; i++) {
    const [a, e] = [_actual[i] || DEF, _expected[i] || DEF];
    if (P.equalBytes(a.data, e.data) && skipSame) continue;
    const [adata, edata] = diffData(a.data, e.data);
    data.push({
      'Data (A)': adata,
      'Data (E)': edata,
      Len: diffLength(a.data, e.data),
      Path: diffPath(a.path, e.path),
      Value: diffValue(a.value, e.value),
    });
  }
  table(data);
  console.log('==== /DIFF ====');
}
