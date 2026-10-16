// SysML v2 テキストの簡易パーサ（暫定コア、ADR-0009）。
// 正規表現で文を区切り、宣言・関係・メタデータを取り出す。Rust の CST パーサに置き換えるまでの実装で、
// 出力は reference/golden/*.json と一致させる。

import type { Block, Entry, ParseError, ParseResult, Rel, Scope, Unsupported } from "./types";

export const DEF_KINDS = [
  "metadata def", "occurrence def", "part def", "requirement def", "constraint def", "port def", "item def", "attribute def",
  "concern def", "verification def", "analysis def", "state def", "action def", "interface def", "calc def", "connection def",
  "use case def", "enum def", "view def",
];
export const USAGE_KINDS = [
  "perform action", "occurrence", "exhibit state", "use case", "part", "requirement", "constraint", "port", "item", "attribute",
  "concern", "analysis", "verification", "state", "action", "interface", "calc", "connection", "subject", "stakeholder", "view",
];
const KW_ALT = [...DEF_KINDS, "package", ...USAGE_KINDS].map((k) => k.replace(/ /g, "\\s+")).join("|");
/** 基本名か引用名（NAME、8.2.2.1）。 */
const NAME = "[A-Za-z_]\\w*|'[^']*'";
/**
 * 宣言の頭。グループ: 1 種類、2・3 短い名前（引用あり・なし）、4 名前の前の再定義など、5 名前、
 * 6 名前の後の関係（: 型付け、:> 特殊化・部分集合、:>> 再定義、::> 参照）、7 共役、8 相手。
 */
const DECL_RE = new RegExp(
  "^(" + KW_ALT + ")(?![\\w])\\s*(?:<(?:'([^']*)'|([A-Za-z_]\\w*))>\\s*)?" +
    "(?:(redefines|subsets|references|:>>|::>|:>)\\s*)?(" + NAME + ")?\\s*" +
    "(?:(:>>|::>|:>|:|specializes|subsets|redefines|references)\\s*(~?)\\s*([A-Za-z_][\\w:]*|'[^']*'))?",
);
/** 前置メタデータ（#M、8.2.2.27）。 */
const PREFIX_META_RE = /^(?:#([A-Za-z_]\w*)\s+)+/;
/** SysML の予約語（SysML-textual-bnf の RESERVED_KEYWORD）。どの読み方にも当たらない文がこれで始まれば、まだ扱えない構文として知らせる。 */
const RESERVED = new Set(
  ("about abstract accept action actor after alias all allocate allocation analysis and as assert assign assume at attribute bind binding " +
    "by calc case comment concern connect connection constant constraint crosses decide def default defined dependency derived do doc else " +
    "end entry enum event exhibit exit expose false filter first flow for fork frame from hastype if implies import in include individual " +
    "inout interface istype item join language library locale loop merge message meta metadata new nonunique not null objective occurrence " +
    "of or ordered out package parallel part perform port private protected public redefines ref references render rendering rep require " +
    "requirement return satisfy send snapshot specializes stakeholder standard state subject subsets succession terminate then timeslice to " +
    "transition true until use variant variation verification verify via view viewpoint when while xor").split(" "),
);
/**
 * SysML の予約語か（名前に使うときは引用名にする）。
 *
 * @param w 調べる語（引用符なし）
 * @returns SysML-textual-bnf の RESERVED_KEYWORD に入っていれば true
 * @example
 * isReservedWord("part")   // → true
 * isReservedWord("Engine") // → false
 */
export const isReservedWord = (w: string): boolean => RESERVED.has(w);
/**
 * 引用名（`'…'`）の引用符を外す。
 *
 * @param s 基本名か引用名
 * @returns 引用符を外した名前。引用名でなければ s のまま
 * @example
 * unquote("'my part'") // → "my part"
 * unquote("A")         // → "A"
 */
const unquote = (s: string): string => (s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1) : s);
const MOD_RE = /^(?:(?:private|public|protected|abstract|in|out|inout|derived|readonly|end|ref|variation|individual)\s+)+/;
const SKIP_RE =
  /^(import|alias|doc|comment|entry|transition|first|accept|objective|require|assume|assert|exit|do|if|else|succession|bind|message|dependency|allocate|expose|filter|language|rep|then|@\w+)\b/;
/** 修飾名（A::B::C。各部分は基本名か引用名）。 */
const QNAME = `(?:${NAME})(?:::(?:${NAME}))*`;
/** `expose A`・`expose A::*`・`expose A::**`・`expose A::*::**`、後ろに `[式]` の絞り込み（Expose、8.2.2.26.2）。 */
const EXPOSE_RE = new RegExp(`^expose\\s+(${QNAME})(::\\*(?!\\*))?(::\\*\\*)?\\s*(?:\\[(.*)\\])?$`);
/** 配置情報を埋め込むコメント（ADR-0005 の移行期の形式）。 */
export const LAYOUT_RE = /\/\*\s*@layout\s*([\s\S]*?)\*\//;

/**
 * 修飾名の最後の区切り（`::` の後ろ）を取り出す。
 *
 * @param s 修飾名（`P::Q::A` など）
 * @returns 最後の区切り。`::` が無ければ s のまま
 * @example
 * lastSeg("PhaseKind::X") // → "X"
 * lastSeg("A")            // → "A"
 */
const lastSeg = (s: string): string => s.split("::").pop() ?? "";

/**
 * コメントと doc 本文を空白で塗りつぶす（位置は変えない。改行は残す）。
 * doc の本文は、doc キーワードの位置をキーにして返す。
 *
 * @param text 元のテキスト
 * @returns 塗りつぶしたテキスト m（長さは text と同じ。doc・comment の本文の最後は「;」にして文として区切る）と、
 *   doc キーワードの位置（UTF-16）から、空白を詰めた本文への対応
 * @example
 * mask("a // x\nb").m                              // → "a     \nb"
 * mask("part def A { doc /* hi  there *\/ }").docs // → Map { 13 => "hi there" }
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

/**
 * テキストを解析して宣言・関係・構文エラー・配置情報・まだ扱えない構文を返す。
 * 構文の誤りは例外にせず、errors に入れる（位置は UTF-16）。
 *
 * @param text SysML v2 のテキスト全文
 * @returns 解析結果
 * @example
 * parse("package P { part def A; }").entries.map((e) => [e.kind, e.name])
 * // → [["package", "P"], ["part def", "A"]]
 * parse("package P { part def A;").errors // → [{ pos: 0, msg: "「P」のブロックが閉じていません" }]
 */
export function parse(text: string): ParseResult {
  const { m, docs } = mask(text);
  const entries: Entry[] = [];
  const rels: Rel[] = [];
  const errors: ParseError[] = [];
  const unsupported: Unsupported[] = [];
  const stack: Scope[] = [];
  const top = (): Scope | null => stack[stack.length - 1] ?? null;
  const named = (b: Scope | null): Entry | null => {
    while (b && b.anon) b = b.owner;
    return b ?? null;
  };

  /**
   * 区切った文 1 つを読み、宣言なら entries に、関係なら rels に、扱えない構文なら unsupported に足す。
   * メタデータ・列挙値・式は、外側の宣言（pe）に書き足す。
   *
   * @param rawHead 文の頭（区切り文字の手前まで。空白は詰めてある）
   * @param hs 文の始まりの位置（UTF-16）
   * @param endPos 区切り文字（`;`・`{`・`}`）の位置（UTF-16）
   * @param term 区切り文字（";"・"{"・"}"）
   * @returns 宣言なら作った Entry。宣言でない文（関係・メタデータ・doc・空など）は null
   * @example
   * stmt("part def A", 12, 22, ";") // → { kind: "part def", name: "A", … }
   * stmt("import ISQ::*", 0, 13, ";") // → null（読み飛ばす文）
   */
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
    // view・view def の中の expose・filter・render（8.2.2.26）
    if (pe && (pe.kind === "view" || pe.kind === "view def")) {
      if ((mm = h.match(EXPOSE_RE))) {
        const target = mm[1]!.split("::").map(unquote).join("::");
        (pe.exposes ||= []).push({ target, members: !!mm[2], recursive: !!mm[3], ...(mm[4] ? { filter: mm[4].trim() } : {}), start: hs, end: endPos });
        return null;
      }
      if ((mm = h.match(/^filter\s+(.+)$/))) {
        (pe.filters ||= []).push(mm[1]!.trim());
        return null;
      }
      if ((mm = h.match(/^render\s+([A-Za-z_][\w:]*)$/))) {
        pe.render = lastSeg(mm[1]!);
        return null;
      }
    }
    // 前置メタデータは、続く宣言のメタデータとして読む（ADR-0013）
    const pm = h.match(PREFIX_META_RE);
    const prefixMeta = pm ? [...pm[0].matchAll(/#([A-Za-z_]\w*)/g)].map((x) => x[1]!) : [];
    if (pm) h = h.slice(pm[0].length);
    if (/^then\s+action\b/.test(h)) h = h.replace(/^then\s+/, "");
    if (/^return\s+/.test(h)) h = h.replace(/^return\s+/, "");
    if (SKIP_RE.test(h)) return null;
    if ((mm = h.match(DECL_RE)) && mm[1]) {
      const kind = mm[1].replace(/\s+/g, " ");
      const isDef = / def$/.test(kind);
      // 名前の後の関係のうち、型として読むのは型付け（:）と、定義の特殊化（:> / specializes）だけ。
      // 使用の :> は部分集合、:>> は再定義、::> は参照で、型ではない（8.2.2.6）
      const op = mm[6] ?? "";
      const typed = op === ":" || (isDef && (op === ":>" || op === "specializes"));
      // 名前の無い再定義（:>> mass）は、再定義する特徴の名前を名前にする
      const name = mm[5] ? unquote(mm[5]) : "";
      const e: Entry = {
        kind, isDef, short: mm[2] ?? mm[3] ?? "", name, conj: typed && !!mm[7], type: typed && mm[8] ? lastSeg(unquote(mm[8])) : "",
        owner, pe, start: hs, headEnd: endPos, end: endPos + 1, head: h, mods, exprs: [], children: [], idx: entries.length,
      };
      if (prefixMeta.length) {
        e.meta ||= {};
        for (const md of prefixMeta) e.meta[md] ||= {};
      }
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
    else if (RESERVED.has(h.split(/[\s{;]/)[0] ?? "")) unsupported.push({ start: hs, end: endPos, head: h });
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
  return { entries, rels, errors, layout: readLayout(text, errors), unsupported };
}

/**
 * `/* @layout {…} *\/` コメントの中身を読む（ADR-0005 の移行期の形式）。
 *
 * @param text SysML v2 のテキスト全文
 * @param errors 読めなかったときに誤りを書き足す先（書き換える）
 * @returns 配置情報の JSON。コメントが無ければ空のオブジェクト。JSON が読めなければ errors に足して空のオブジェクト
 * @example
 * readLayout('/* @layout {"A":{"x":1}} *\/', errors) // → { A: { x: 1 } }
 * readLayout("/* @layout {x *\/", errors)            // → {}（errors に「@layout コメントが読み取れません」）
 * readLayout("package P;", errors)                  // → {}
 */
export function readLayout(text: string, errors: ParseError[]): Record<string, unknown> {
  const lm = text.match(LAYOUT_RE);
  if (!lm) return {};
  try {
    return JSON.parse(lm[1]!) as Record<string, unknown>;
  } catch {
    errors.push({ pos: lm.index ?? 0, msg: "@layout コメントが読み取れません" });
    return {};
  }
}
