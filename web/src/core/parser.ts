// SysML v2 テキストの簡易パーサ（暫定コア、ADR-0009）。
// 正規表現で文を区切り、宣言・関係・メタデータを取り出す。Rust の CST パーサに置き換えるまでの実装で、
// 出力は reference/golden/*.json と一致させる。

import type { Block, Entry, ParseError, ParseResult, Rel, Scope } from "./types";

export const DEF_KINDS = [
  "metadata def", "occurrence def", "part def", "requirement def", "constraint def", "port def", "item def", "attribute def",
  "concern def", "verification def", "analysis def", "state def", "action def", "interface def", "calc def", "connection def",
  "use case def", "enum def",
];
export const USAGE_KINDS = [
  "perform action", "occurrence", "exhibit state", "use case", "part", "requirement", "constraint", "port", "item", "attribute",
  "concern", "analysis", "verification", "state", "action", "interface", "calc", "connection", "subject", "stakeholder",
];
const KW_ALT = [...DEF_KINDS, "package", ...USAGE_KINDS].map((k) => k.replace(/ /g, "\\s+")).join("|");
const DECL_RE = new RegExp(
  "^(" + KW_ALT + ")(?![\\w])\\s*(?:<'([^']*)'>\\s*)?([A-Za-z_]\\w*)?\\s*(?:(?::>>|:>|:)\\s*(~?)\\s*([A-Za-z_][\\w:]*))?",
);
const MOD_RE = /^(?:(?:private|public|protected|abstract|in|out|inout|derived|readonly|end|ref|variation|individual)\s+)+/;
const SKIP_RE =
  /^(import|alias|doc|comment|entry|transition|first|accept|objective|require|assume|assert|exit|do|if|else|succession|bind|message|dependency|allocate|expose|filter|language|rep|then|@\w+)\b/;
/** 配置情報を埋め込むコメント（ADR-0005 の移行期の形式）。 */
export const LAYOUT_RE = /\/\*\s*@layout\s*([\s\S]*?)\*\//;

const lastSeg = (s: string): string => s.split("::").pop() ?? "";

/**
 * コメントと doc 本文を空白で塗りつぶす（位置は変えない）。
 * doc の本文は、doc キーワードの位置をキーにして返す。
 */
export function mask(text: string): { m: string; docs: Map<number, string> } {
  const docs = new Map<number, string>();
  let t = text.replace(
    /\b(doc|comment)(\s+[A-Za-z_]\w*)?\s*\/\*([\s\S]*?)\*\//g,
    (s: string, kw: string, _nm: string | undefined, body: string, off: number) => {
      docs.set(off, body.replace(/\s+/g, " ").trim());
      return kw + s.slice(kw.length, -1).replace(/[^\n]/g, " ") + ";";
    },
  );
  t = t.replace(/\/\*[\s\S]*?(\*\/|$)|\/\/[^\n]*/g, (s) => s.replace(/[^\n]/g, " "));
  return { m: t, docs };
}

/** テキストを解析して宣言・関係・構文エラー・配置情報を返す。 */
export function parse(text: string): ParseResult {
  const { m, docs } = mask(text);
  const entries: Entry[] = [];
  const rels: Rel[] = [];
  const errors: ParseError[] = [];
  const stack: Scope[] = [];
  const top = (): Scope | null => stack[stack.length - 1] ?? null;
  const named = (b: Scope | null): Entry | null => {
    while (b && b.anon) b = b.owner;
    return b ?? null;
  };

  function stmt(rawHead: string, hs: number, endPos: number, term: string): Entry | null {
    const owner = top();
    const pe = named(owner);
    let h = rawHead;
    if (!h) return null;
    const modm = h.match(MOD_RE);
    const mods = modm ? modm[0].trim() : "";
    if (modm) h = h.slice(modm[0].length);
    if (h === "doc" || h.startsWith("doc ")) {
      const d = docs.get(hs);
      if (d !== undefined && pe) pe.doc = d;
      return null;
    }
    let mm: RegExpMatchArray | null;
    // メタデータ（@Phase { stage = PhaseKind::X; }）
    if (owner && owner.anon && owner.kw.startsWith("@") && pe && (mm = h.match(/^([A-Za-z_]\w*)\s*=\s*([\w:]+)/))) {
      const md = owner.kw.slice(1);
      const key = mm[1]!;
      const val = mm[2]!;
      pe.meta ||= {};
      (pe.meta[md] ||= {})[key] = lastSeg(val);
      const vp = m.indexOf(val, hs);
      if (md === "Phase") {
        pe.phaseVal = { start: vp, end: vp + val.length };
        pe.phaseBlock = owner;
      }
      return null;
    }
    if (pe && pe.kind === "enum def" && (mm = h.match(/^(?:enum\s+)?([A-Za-z_]\w*)$/))) {
      (pe.enumValues ||= []).push(mm[1]!);
      return null;
    }
    if ((mm = h.match(/^#(\w+)\s+dependency\s+(?:[A-Za-z_]\w*\s+)?from\s+([\w.:]+)\s+to\s+([\w.:]+)/))) {
      rels.push({ rel: mm[1] === "derivation" ? "derive" : "dependency", a: mm[2]!, b: mm[3]!, pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^(?:then\s+)?message\s+(?:(?!of\b|from\b)([A-Za-z_]\w*)\s+)?(?:of\s+([\w:]+)\s+)?from\s+([\w.]+)\s+to\s+([\w.]+)/))) {
      rels.push({ rel: "message", name: mm[1] || "", item: lastSeg(mm[2] || ""), a: mm[3]!, b: mm[4]!, pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^satisfy\s+(?:requirement\s+)?([\w.:]+)\s+by\s+([\w.:]+)/))) {
      rels.push({ rel: "satisfy", req: mm[1]!, by: mm[2]!, pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^verify\s+(?:requirement\s+)?([\w.:]+)/))) {
      rels.push({ rel: "verify", req: mm[1]!, pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^frame\s+(?:concern\s+)?([A-Za-z_]\w*)\s*:\s*([\w:]+)/))) {
      rels.push({ rel: "frame", name: mm[1]!, type: lastSeg(mm[2]!), pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^flow\s+(?:of\s+([\w:]+)\s+)?from\s+([\w.]+)\s+to\s+([\w.]+)/))) {
      rels.push({ rel: "flow", item: lastSeg(mm[1] || ""), a: mm[2]!, b: mm[3]!, pe, start: hs, end: endPos });
      return null;
    }
    if ((mm = h.match(/^transition\s+(?:[A-Za-z_]\w*\s+)?first\s+(\w+)(?:\s+accept\s+(\w+))?.*?\s+then\s+(\w+)/))) {
      rels.push({ rel: "transition", from: mm[1]!, ev: mm[2] || "", to: mm[3]!, pe, start: hs, end: endPos });
      return null;
    }
    if (/^then\s+action\b/.test(h)) h = h.replace(/^then\s+/, "");
    if (/^return\s+/.test(h)) h = h.replace(/^return\s+/, "");
    if (SKIP_RE.test(h)) return null;
    if ((mm = h.match(DECL_RE)) && mm[1]) {
      const kind = mm[1].replace(/\s+/g, " ");
      const e: Entry = {
        kind, isDef: / def$/.test(kind), short: mm[2] || "", name: mm[3] || "", conj: !!mm[4], type: mm[5] ? lastSeg(mm[5]) : "",
        owner, pe, start: hs, headEnd: endPos, end: endPos + 1, head: h, mods, exprs: [], children: [], idx: entries.length,
      };
      const vm = h.match(/=\s*(.+)$/);
      if (vm) e.value = vm[1]!.trim();
      const cm = h.match(/connect\s+([\w.]+)\s+to\s+([\w.]+)/);
      if (cm) rels.push({ rel: "connect", a: cm[1]!, b: cm[2]!, item: e.type, pe, start: hs, end: endPos, usage: e });
      entries.push(e);
      if (pe) pe.children.push(e);
      return e;
    }
    if (modm && (mm = h.match(/^([A-Za-z_]\w*)\s*:\s*(~?)([\w:]+)/))) {
      const e: Entry = {
        kind: "param", dir: mods, isDef: false, name: mm[1]!, short: "", type: lastSeg(mm[3]!), owner, pe,
        start: hs, headEnd: endPos, end: endPos + 1, head: h, exprs: [], children: [], idx: entries.length,
      };
      entries.push(e);
      if (pe) pe.children.push(e);
      return e;
    }
    if (pe && (term === "}" || /[=<>]/.test(h))) pe.exprs.push({ text: h, via: owner && owner.anon ? owner.kw : "" });
    return null;
  }

  const re = /[;{}]/g;
  let i = 0;
  for (;;) {
    re.lastIndex = i;
    const r = re.exec(m);
    if (!r) break;
    const j = r.index;
    const ch = m[j]!;
    const raw = m.slice(i, j);
    const lead = raw.length - raw.trimStart().length;
    const head = raw.trim().replace(/\s+/g, " ");
    const hs = i + lead;
    if (ch === "}") {
      if (head) stmt(head, hs, j, "}");
      const b = stack.pop();
      if (!b) errors.push({ pos: j, msg: "対応する「{」がない「}」があります" });
      else {
        b.close = j;
        b.end = j + 1;
      }
    } else {
      const e = stmt(head, hs, j, ch);
      if (ch === "{") {
        const blk: Scope = e || ({ anon: true, kw: head.split(" ")[0] || "", head, start: hs, owner: top() } satisfies Block);
        blk.open = j;
        stack.push(blk);
      }
    }
    i = j + 1;
  }
  if (m.slice(i).trim()) errors.push({ pos: i, msg: "末尾の文が「;」で終わっていません" });
  for (const b of stack) errors.push({ pos: b.start, msg: `「${(!b.anon && b.name) || b.head || "{"}」のブロックが閉じていません` });
  let layout: Record<string, unknown> = {};
  const lm = text.match(LAYOUT_RE);
  if (lm) {
    try {
      layout = JSON.parse(lm[1]!) as Record<string, unknown>;
    } catch {
      errors.push({ pos: lm.index ?? 0, msg: "@layout コメントが読み取れません" });
    }
  }
  return { entries, rels, errors, layout };
}
