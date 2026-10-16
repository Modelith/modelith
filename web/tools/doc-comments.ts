// 関数の doc コメントの検査（programming-principles §4）。判断だけの純粋関数で、ファイルの読み書きは doc-comments-cli.ts が行う。
// 構文解析器は使わず、宣言の行と直前のコメントを読む。対象は、テスト以外の名前のある関数とメソッド。

/** 検査で見つかった不足 1 件。 */
export interface Finding {
  /** 関数の名前。 */
  name: string;
  /** 宣言の行（1 始まり）。 */
  line: number;
  /** 足りないもの（画面にそのまま出す文）。 */
  message: string;
}

/** 宣言から読み取った関数の形。 */
interface Signature {
  name: string;
  line: number;
  /** 引数の名前。分割代入などで名前が無い引数は null。 */
  params: (string | null)[];
  /** 値を返すか。 */
  returns: boolean;
}

/**
 * 括弧の中身を、いちばん外側のカンマで分ける。
 *
 * @param inner 括弧の中の文字列（外側の括弧は含めない）
 * @returns 前後の空白を除いた各部分。空の部分は除く
 * @example
 * splitTopLevel("a: number, b: Map<string, number>") // → ["a: number", "b: Map<string, number>"]
 * splitTopLevel("")                                    // → []
 */
export function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * 宣言の始まりから、引数の括弧の中身と、閉じ括弧の後ろ（戻り値の型など）を取り出す。
 *
 * @param text 宣言の行から後ろのテキスト（複数行にまたがってよい）
 * @param open 引数の開き括弧 `(` の位置
 * @returns 括弧の中身・閉じ括弧から本体の始まり（`{`・`=>`・`;`）までの文字列・本体の始まり以降の文字列。括弧が閉じなければ null
 * @example
 * signatureParts("f(a: A, b: B): R {", 1) // → { inner: "a: A, b: B", after: ": R ", rest: "{" }
 * signatureParts("f(a", 1)                // → null（閉じていない）
 */
export function signatureParts(text: string, open: number): { inner: string; after: string; rest: string } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) {
      const tail = text.slice(i + 1);
      const end = tail.search(/\{|=>|;/);
      return { inner: text.slice(open + 1, i), after: end < 0 ? tail : tail.slice(0, end), rest: end < 0 ? "" : tail.slice(end) };
    }
  }
  return null;
}

/**
 * TypeScript の引数 1 つから名前を取り出す。
 *
 * @param param 引数の宣言（`a: number`・`...rest: T[]`・`{ x }: P` など）
 * @returns 引数の名前。分割代入で名前が無ければ null
 * @example
 * tsParamName("private readonly port: CorePort") // → "port"
 * tsParamName("...xs: number[]")                 // → "xs"
 * tsParamName("{ a, b }: P")                     // → null
 */
export function tsParamName(param: string): string | null {
  const p = param.replace(/^(?:(?:public|private|protected|readonly)\s+)+/, "").replace(/^\.\.\./, "");
  return /^[A-Za-z_$][\w$]*/.exec(p)?.[0] ?? null;
}

/**
 * TypeScript の戻り値の型の注記が、値を返さない型か。
 *
 * @param annotation 閉じ括弧の後ろの `: 型` の部分（無ければ空文字列）
 * @returns `void`・`Promise<void>`・`never`・`undefined` なら true。注記が無いときも true
 * @example
 * isVoidType(": Promise<void> ") // → true
 * isVoidType(": string ")        // → false
 */
export function isVoidType(annotation: string): boolean {
  const t = annotation.replace(/^\s*:\s*/, "").trim();
  return t === "" || /^(void|never|undefined|Promise<void>)$/.test(t);
}

const TS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "with", "new", "typeof", "await"]);

/**
 * TypeScript のソースから、検査する関数の宣言を探す。
 * 関数宣言・最上位の `const 名前 = (…) =>`・クラスやオブジェクトのメソッドを対象にし、関数の中の短い無名関数は除く。
 *
 * @param source ファイルの中身
 * @returns 見つけた関数の形と、宣言の行の番号（0 始まり）
 * @example
 * findTsFunctions("export function f(a: number): number {\n  return a;\n}")
 * // → [{ sig: { name: "f", line: 1, params: ["a"], returns: true }, at: 0 }]
 */
export function findTsFunctions(source: string): { sig: Signature; at: number }[] {
  const lines = source.split("\n");
  const found: { sig: Signature; at: number }[] = [];
  lines.forEach((line, at) => {
    const decl =
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)\s*(?:<[^(]*>)?\(/.exec(line) ??
      /^(?:export\s+)?const\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:<[^(]*>)?\(/.exec(line) ??
      /^\s+(?:(?:static|private|public|protected|readonly|async|get|set|override)\s+)*([\w$]+)\s*(?:<[^(]*>)?\((?!.*=>\s*$)/.exec(line);
    const name = decl?.[1];
    if (!decl || !name || TS_KEYWORDS.has(name)) return;
    const text = lines.slice(at, at + 30).join("\n");
    const open = text.indexOf("(", text.indexOf(name) + name.length);
    const parts = signatureParts(text, open);
    if (!parts) return;
    const rest = parts.rest;
    const isArrowConst = decl[0].trimStart().replace(/^export\s+/, "").startsWith("const");
    if (isArrowConst && !rest.startsWith("=>")) return;
    // メソッドは、閉じ括弧の後ろが戻り値の型の注記だけで、本体（{）が続くものだけ（`$(…).x = …` のような呼び出しの文を除く）
    const isMethod = !isArrowConst && !/(^|\s)function\b/.test(decl[0]);
    if (isMethod && (!rest.startsWith("{") || !/^\s*(:[^=]*)?$/.test(parts.after))) return;
    const expressionBody = isArrowConst && !/^=>\s*\{/.test(rest);
    const annotated = /^\s*:/.test(parts.after);
    const returns = name === "constructor" ? false : annotated ? !isVoidType(parts.after) : expressionBody;
    found.push({ sig: { name, line: at + 1, params: splitTopLevel(parts.inner).map(tsParamName), returns }, at });
  });
  return found;
}

/**
 * 宣言の直前にある JSDoc（`/** … *\/`）の中身を取り出す。
 *
 * @param lines ファイルの行
 * @param at 宣言の行の番号（0 始まり）
 * @returns 先頭の `*` を除いた各行。直前に JSDoc が無ければ null
 * @example
 * // lines が「JSDoc の開き・ * 概要・閉じ・function f() {}」の 4 行のとき
 * jsdocBefore(lines, 3) // → ["概要"]
 */
export function jsdocBefore(lines: readonly string[], at: number): string[] | null {
  let end = at - 1;
  while (end >= 0 && /^\s*@\w/.test(lines[end] ?? "")) end--; // デコレータは飛ばす
  const last = lines[end]?.trim() ?? "";
  if (!last.endsWith("*/")) return null;
  let start = end;
  while (start >= 0 && !(lines[start] ?? "").includes("/**")) start--;
  if (start < 0) return null;
  return lines
    .slice(start, end + 1)
    .join("\n")
    .replace(/^\s*\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, "").trimEnd())
    .filter((l, i, all) => l !== "" || (i > 0 && i < all.length - 1));
}

/**
 * JSDoc が、関数の形に必要な記述をそろえているかを調べる。
 * 概要（最初のタグより前の文）・引数ごとの `@param`・値を返すなら `@returns` と `@example`（入力と期待する出力）を求める。
 *
 * @param sig 関数の形
 * @param doc JSDoc の各行。JSDoc が無ければ null
 * @returns 足りないものの一覧。そろっていれば空
 * @example
 * checkJsdoc({ name: "f", line: 1, params: ["a"], returns: true }, ["概要", "@param a 値"])
 * // → [{ name: "f", line: 1, message: "@returns がありません" }, { …, message: "@example（入力と期待する出力）がありません" }]
 */
export function checkJsdoc(sig: Signature, doc: string[] | null): Finding[] {
  const miss = (message: string): Finding => ({ name: sig.name, line: sig.line, message });
  if (!doc) return [miss("doc コメント（/** … */）がありません")];
  const out: Finding[] = [];
  const firstTag = doc.findIndex((l) => l.startsWith("@"));
  const summary = (firstTag < 0 ? doc : doc.slice(0, firstTag)).join("").trim();
  if (!summary) out.push(miss("概要がありません"));
  const tags = doc.filter((l) => l.startsWith("@param"));
  sig.params.forEach((p, i) => {
    const ok = p ? tags.some((t) => new RegExp(`^@param\\s+(\\{[^}]*\\}\\s+)?\\[?${p.replace(/\$/g, "\\$")}\\b`).test(t)) : tags.length > i;
    if (!ok) out.push(miss(`引数 ${p ?? `${i + 1} 番目`} の @param がありません`));
  });
  if (sig.returns) {
    if (!doc.some((l) => /^@returns?\b/.test(l))) out.push(miss("@returns がありません"));
    if (!doc.some((l) => l.startsWith("@example"))) out.push(miss("@example（入力と期待する出力）がありません"));
  }
  return out;
}

/**
 * TypeScript のソースの、すべての関数の doc コメントを調べる。
 *
 * @param source ファイルの中身
 * @returns 足りないものの一覧（宣言の順）
 * @example
 * checkTs("function f(a: number): number { return a; }") // → 4 件（doc コメントが無い 1 件として返る）
 */
export function checkTs(source: string): Finding[] {
  const lines = source.split("\n");
  return findTsFunctions(source).flatMap(({ sig, at }) => checkJsdoc(sig, jsdocBefore(lines, at)));
}

// ---- Rust ----

/**
 * Rust のソースから、文字列・文字・コメントを空白に置き換える（括弧の数え間違いを防ぐ）。改行と位置は保つ。
 *
 * @param source ファイルの中身
 * @returns 同じ長さで、文字列などの中身を空白にした文字列
 * @example
 * maskRust('let s = "{}"; // }') // → 'let s = "  ";     '（引用符は残す）
 */
export function maskRust(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i, i + 3);
    if (rest.startsWith("//")) {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (rest.startsWith("/*")) {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (/^r#*"/.test(source.slice(i, i + 8))) {
      const hashes = /^r(#*)"/.exec(source.slice(i))?.[1] ?? "";
      const close = `"${hashes}`;
      const begin = i + 2 + hashes.length;
      const end = source.indexOf(close, begin);
      const stop = end < 0 ? source.length : end;
      blank(begin, stop);
      i = stop + close.length;
    } else if (source[i] === '"') {
      let k = i + 1;
      while (k < source.length && source[k] !== '"') k += source[k] === "\\" ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
    } else if (source[i] === "'" && /^'(\\.|[^\\'])'/.test(source.slice(i, i + 4))) {
      const len = source[i + 1] === "\\" ? 4 : 3;
      blank(i + 1, i + len - 1);
      i += len;
    } else i++;
  }
  return out.join("");
}

/**
 * Rust の引数 1 つから名前を取り出す。`self` は数えない。
 *
 * @param param 引数の宣言（`mut a: usize`・`&self` など）
 * @returns 引数の名前。`self` の類いや、名前の無いパターンなら null
 * @example
 * rustParamName("mut text: String") // → "text"
 * rustParamName("&mut self")        // → null
 */
export function rustParamName(param: string): string | null {
  const p = param.replace(/^mut\s+/, "");
  if (/^&?('\w+\s+)?(mut\s+)?self\b/.test(p)) return null;
  return /^([A-Za-z_]\w*)\s*:/.exec(p)?.[1] ?? null;
}

/**
 * Rust のソースから、検査する関数の宣言を探す。
 * `#[cfg(test)]` のモジュールと、トレイトの実装（`impl X for Y`）の中のメソッドは除く（トレイトの側に説明がある）。
 *
 * @param source ファイルの中身
 * @returns 見つけた関数の形と、宣言の行の番号（0 始まり）
 * @example
 * findRustFunctions("/// 足す\npub fn add(a: i32, b: i32) -> i32 { a + b }")
 * // → [{ sig: { name: "add", line: 2, params: ["a", "b"], returns: true }, at: 1 }]
 */
export function findRustFunctions(source: string): { sig: Signature; at: number }[] {
  const masked = maskRust(source);
  const lines = masked.split("\n");
  // 除く範囲（テストのモジュールとトレイトの実装）の、行の始まりと終わり
  const skipped: [number, number][] = [];
  const lineOf = (pos: number): number => masked.slice(0, pos).split("\n").length - 1;
  const blockEnd = (open: number): number => {
    let depth = 0;
    for (let k = open; k < masked.length; k++) {
      if (masked[k] === "{") depth++;
      else if (masked[k] === "}" && --depth === 0) return k;
    }
    return masked.length;
  };
  const skip = (re: RegExp): void => {
    for (const m of masked.matchAll(re)) {
      const open = masked.indexOf("{", m.index);
      if (open >= 0) skipped.push([lineOf(m.index), lineOf(blockEnd(open))]);
    }
  };
  skip(/#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s+\w+\s*\{/g);
  skip(/^\s*impl\b[^{;]*\bfor\b[^{;]*\{/gm);
  const inSkipped = (at: number): boolean => skipped.some(([a, b]) => a <= at && at <= b);
  const found: { sig: Signature; at: number }[] = [];
  lines.forEach((line, at) => {
    const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/.exec(line);
    if (!m?.[1] || inSkipped(at)) return;
    const prev = lines.slice(Math.max(0, at - 3), at).join("\n");
    if (/#\[test\]/.test(prev)) return;
    const text = lines.slice(at, at + 30).join("\n");
    const open = text.indexOf("(", m[0].length - 1);
    const parts = signatureParts(text.replace(/->/g, "→ "), open);
    if (!parts) return;
    const ret = /→\s*([^{;]*)/.exec(parts.after)?.[1]?.replace(/\bwhere\b[\s\S]*$/, "").trim() ?? "";
    found.push({ sig: { name: m[1], line: at + 1, params: splitTopLevel(parts.inner).map(rustParamName).filter((p) => p !== null), returns: ret !== "" && ret !== "()" }, at });
  });
  return found;
}

/**
 * 宣言の直前にある Rust の doc コメント（`///` の行）を取り出す。属性（`#[…]`）の行は飛ばす。
 *
 * @param lines ファイルの行（文字列やコメントを空白にしていない元の行）
 * @param at 宣言の行の番号（0 始まり）
 * @returns `///` を除いた各行（上から順）。doc コメントが無ければ null
 * @example
 * rustDocBefore(["/// 足す", "#[inline]", "fn add() {}"], 2) // → ["足す"]
 */
export function rustDocBefore(lines: readonly string[], at: number): string[] | null {
  let k = at - 1;
  while (k >= 0 && /^\s*#\[/.test(lines[k] ?? "")) k--;
  const doc: string[] = [];
  while (k >= 0 && /^\s*\/\/\//.test(lines[k] ?? "")) {
    doc.unshift((lines[k] ?? "").replace(/^\s*\/\/\/ ?/, "").trimEnd());
    k--;
  }
  return doc.length ? doc : null;
}

/**
 * Rust の doc コメントが、関数の形に必要な記述をそろえているかを調べる。
 * 概要（最初の節より前の文）・`# 引数` に引数ごとの `` `名前` ``・値を返すなら `# 戻り値` と `# 例`（入力と期待する出力）を求める。
 *
 * @param sig 関数の形
 * @param doc doc コメントの各行。無ければ null
 * @returns 足りないものの一覧。そろっていれば空
 * @example
 * checkRustDoc({ name: "f", line: 1, params: [], returns: false }, ["概要"]) // → []
 */
export function checkRustDoc(sig: Signature, doc: string[] | null): Finding[] {
  const miss = (message: string): Finding => ({ name: sig.name, line: sig.line, message });
  if (!doc) return [miss("doc コメント（///）がありません")];
  const out: Finding[] = [];
  const section = (title: string): string[] | null => {
    const i = doc.findIndex((l) => l.trim() === `# ${title}`);
    if (i < 0) return null;
    const next = doc.findIndex((l, j) => j > i && /^# /.test(l.trim()));
    return doc.slice(i + 1, next < 0 ? undefined : next);
  };
  const firstSection = doc.findIndex((l) => /^# /.test(l.trim()));
  if (!(firstSection < 0 ? doc : doc.slice(0, firstSection)).join("").trim()) out.push(miss("概要がありません"));
  if (sig.params.length) {
    const args = section("引数")?.join("\n") ?? "";
    for (const p of sig.params) if (!args.includes(`\`${p ?? ""}\``)) out.push(miss(`# 引数 に \`${p ?? ""}\` がありません`));
  }
  if (sig.returns) {
    if (!section("戻り値")?.join("").trim()) out.push(miss("# 戻り値 がありません"));
    if (!section("例")?.join("").trim()) out.push(miss("# 例（入力と期待する出力）がありません"));
  }
  return out;
}

/**
 * Rust のソースの、すべての関数の doc コメントを調べる。
 *
 * @param source ファイルの中身
 * @returns 足りないものの一覧（宣言の順）
 * @example
 * checkRust("fn f() {}") // → [{ name: "f", line: 1, message: "doc コメント（///）がありません" }]
 */
export function checkRust(source: string): Finding[] {
  const lines = source.split("\n");
  return findRustFunctions(source).flatMap(({ sig, at }) => checkRustDoc(sig, rustDocBefore(lines, at)));
}
