// SysML v2 仕様に合わせるケース（ADR-0013）。期待値はモックではなく仕様から手で書き、根拠の BNF 規則と章を添える。
// TS と Rust の両方のパーサとモデル構築で同じケースを満たす（ADR-0015）。
// 章番号は SysML 2.1 Beta 2（SysML-v2-Release 2026-08）のもの。docs/reference/sysml-conformance.md も参照。
import { describe, expect, it } from "vitest";
import SAMPLE from "../samples/electric-kettle.sysml?raw";
import { PARSERS } from "./testing/parsers";

for (const [impl, parse, build] of PARSERS) {
  describe(impl, () => {
    const entry = (text: string, name: string) => parse(text).entries.find((e) => e.name === name);
    const problems = (text: string): string[] => build(parse(text)).problems.map((p) => p.msg);

    describe("前置メタデータ（PrefixMetadataMember、8.2.2.27）", () => {
      it("#M を前に付けた宣言も、モデルから消えずに読める", () => {
        // Arrange
        const text = "package P { metadata def M; #M part def A; part def B; }";
        // Act
        const a = entry(text, "A");
        // Assert
        expect(a?.kind).toBe("part def");
        expect(a?.meta?.["M"]).toEqual({});
      });

      it("複数の #M を前に付けられる（境界値）", () => {
        // Arrange
        const text = "package P { metadata def M; metadata def N; #M #N part def A; }";
        // Act
        const a = entry(text, "A");
        // Assert
        expect(Object.keys(a?.meta ?? {})).toEqual(["M", "N"]);
      });

      it("#derivation dependency はこれまでどおり関係として読む（正常系）", () => {
        // Arrange
        const text = "package P { requirement def A; requirement def B; #derivation dependency from B to A; }";
        // Act
        const rels = parse(text).rels.map((r) => r.rel);
        // Assert
        expect(rels).toEqual(["derive"]);
      });
    });

    describe("部分集合・再定義・参照（Subsets / Redefines / References、8.2.2.6）", () => {
      it("使用の :> は型ではなく部分集合なので、型として探さない", () => {
        // Arrange
        const text = "package P { part def A; part def W { part a : A; part b :> a; } }";
        // Act
        const b = entry(text, "b");
        // Assert
        expect(b?.type).toBe("");
        expect(problems(text)).toEqual([]);
      });

      it.each([["subsets"], ["references"], ["::>"]])("%s も型として扱わない", (op) => {
        // Arrange
        const text = `package P { part def A; part def W { part a : A; part b ${op} a; } }`;
        // Act
        const b = entry(text, "b");
        // Assert
        expect(b?.type).toBe("");
        expect(problems(text)).toEqual([]);
      });

      it("型と部分集合を両方書けば、型だけを型として読む", () => {
        // Arrange
        const text = "package P { part def A; part def B; part def W { part a : A; part b : B :> a; } }";
        // Act
        const b = entry(text, "b");
        // Assert
        expect(b?.type).toBe("B");
        expect(problems(text)).toEqual([]);
      });

      it("名前の無い :>> は、再定義する特徴の名前を名前にする", () => {
        // Arrange
        const text = "package P { part def A { attribute mass; } part def B :> A { attribute :>> mass = 1500; } }";
        // Act
        const e = parse(text).entries.find((x) => x.pe?.name === "B");
        // Assert
        expect(e?.name).toBe("mass");
        expect(e?.type).toBe("");
        expect(e?.value).toBe("1500");
      });

      it("redefines は名前ではなく、再定義のキーワードとして読む", () => {
        // Arrange
        const text = "package P { part def A { attribute x; } part def B :> A { attribute redefines x = 1; } }";
        // Act
        const names = parse(text).entries.map((e) => e.name);
        // Assert
        expect(names).not.toContain("redefines");
        expect(names.filter((n) => n === "x")).toHaveLength(2);
      });

      it("定義の :> は特殊化として、これまでどおり記録する（モックと同じ）", () => {
        // Arrange
        const text = "package P { part def A; part def B :> A; }";
        // Act
        const b = entry(text, "B");
        // Assert
        expect(b?.type).toBe("A");
      });
    });

    describe("名前（NAME・Identification、8.2.2.1〜2）", () => {
      it("引用名 'Fuel Tank' を名前として読み、型の参照にも使える", () => {
        // Arrange
        const text = "package P { part def 'Fuel Tank'; part def Car { part t : 'Fuel Tank'; } }";
        // Act
        const t = entry(text, "t");
        // Assert
        expect(entry(text, "Fuel Tank")?.kind).toBe("part def");
        expect(t?.type).toBe("Fuel Tank");
        expect(problems(text)).toEqual([]);
      });

      it("引用なしの短い名前 <R1> も読む", () => {
        // Arrange
        const text = "package P { requirement def <R1> Req1; }";
        // Act
        const r = entry(text, "Req1");
        // Assert
        expect(r?.short).toBe("R1");
      });

      it("引用付きの短い名前 <'R-1'> はこれまでどおり読む（正常系）", () => {
        // Arrange
        const text = "package P { requirement def <'R-1'> Req1; }";
        // Act
        const r = entry(text, "Req1");
        // Assert
        expect(r?.short).toBe("R-1");
      });
    });

    describe("まだ扱えない文（F-EDIT-5・C-6 の趣旨：黙って捨てない）", () => {
      it("知らない文は捨てずに「まだ扱えない」と知らせる", () => {
        // Arrange
        const text = "package P { send s; part def A; }";
        // Act
        const M = build(parse(text));
        // Assert
        const info = M.problems.filter((p) => p.kind === "unsupported");
        expect(info.map((p) => p.msg)).toEqual(["「send s」は Modelith ではまだ扱えないため、図とツリーに出ません"]);
      });

      it("まだ扱えない文は、エラーとして数えない", () => {
        // Arrange
        const text = "package P { send s; }";
        // Act
        const errors = build(parse(text)).problems.filter((p) => !p.kind);
        // Assert
        expect(errors).toEqual([]);
      });

      it("式や、扱いを決めて読み飛ばしている文（import・doc など）は知らせない", () => {
        // Arrange
        const text = "package P { private import ISQ::*; constraint def C { in x : Real; x >= 0 } }";
        // Act
        const info = build(parse(text)).problems.filter((p) => p.kind === "unsupported");
        // Assert
        expect(info).toEqual([]);
      });

      it("公開サンプルには、まだ扱えない文が無い", () => {
        // Arrange・Act
        const info = build(parse(SAMPLE)).problems.filter((p) => p.kind === "unsupported");
        // Assert
        expect(info).toEqual([]);
      });
    });

    describe("view・expose・filter・render（8.2.2.26、9.2.20 標準ビュー定義）", () => {
      const MODEL = `package P {
        metadata def Safety;
        part def A { part b : B; }
        part def B;
        #Safety part def C;
        requirement def R;
        package Q { part def D; package Deep { part def E; } }
    `;
      const view = (body: string, name = "v") => build(parse(MODEL + body + "\n}")).views.find((v) => v.name === name);

      it("expose A は要素そのもの（MembershipExpose）、図の種類は型の標準ビュー定義から決める", () => {
        // Arrange
        const body = "view v : GeneralView { expose P::A; expose P::R; }";
        // Act
        const v = view(body);
        // Assert
        expect(v?.nodeKeys).toEqual(["A", "R"]);
        expect(v).toMatchObject({ kind: "general", std: "GeneralView" });
      });

      it("expose Q::* は中身だけ、Q::** は入れ子もすべて（NamespaceExpose・isRecursive）", () => {
        // Arrange
        const members = "view v { expose P::Q::*; }";
        const recursive = "view v { expose P::Q::**; }";
        // Act
        const m = view(members);
        const r = view(recursive);
        // Assert（Q::* の中身の package Deep は、枠として中身ごと描く。F-VIEW-9）
        expect(m?.nodeKeys).toEqual(["D", "E"]);
        expect(m?.frames.map((f) => [f.name, f.nodeKeys])).toEqual([["Deep", ["E"]]]);
        expect(r?.nodeKeys).toEqual(["D", "E"]);
      });

      it("F-VIEW-9: expose P::Q は package そのもの。枠として描き、中の要素（入れ子も）を枠に入れる（MembershipExpose、8.2.3.5）", () => {
        // Arrange
        const body = "view v { expose P::Q; }";
        // Act
        const v = view(body);
        // Assert
        expect(v?.nodeKeys).toEqual(["D", "E"]);
        expect(v?.frames.map((f) => [f.name, f.entry.name, f.nodeKeys])).toEqual([["Q", "Q", ["D", "E"]]]);
      });

      it("F-VIEW-9: 入れ子の package を両方出すと、外側から順に枠になる", () => {
        // Arrange
        const body = "view v { expose P::Q; expose P::Q::Deep; }";
        // Act
        const v = view(body);
        // Assert
        expect(v?.frames.map((f) => [f.name, f.nodeKeys])).toEqual([["Q", ["D", "E"]], ["Deep", ["E"]]]);
      });

      it("F-VIEW-9: package が filter に合わなければ枠にせず、中の要素も出さない（境界値）", () => {
        // Arrange（Q の中身は部品定義 D と package Deep。@PartDefinition は D だけに合う）
        const members = "view v { expose P::Q::*; filter @PartDefinition; }";
        const whole = "view v { expose P::Q; filter @PartDefinition; }";
        // Act
        const m = view(members);
        const w = view(whole);
        // Assert
        expect([m?.nodeKeys, m?.frames]).toEqual([["D"], []]);
        expect([w?.nodeKeys, w?.frames]).toEqual([[], []]);
      });

      it("filter @SysML::PartDefinition はメタクラスで、filter @Safety はメタデータで絞り込む（ElementFilterMember）", () => {
        // Arrange
        const byMetaclass = "view v { expose P::*; filter @SysML::PartDefinition; }";
        const byMetadata = "view v { expose P::*; filter @Safety; }";
        // Act
        const a = view(byMetaclass);
        const b = view(byMetadata);
        // Assert
        expect(a?.nodeKeys).toEqual(["A", "B", "C"]);
        expect(b?.nodeKeys).toEqual(["C"]);
      });

      it("expose の [式] は、その expose で出す要素だけを絞り込む（FilterPackageMember）", () => {
        // Arrange
        const body = "view v { expose P::*[@SysML::RequirementDefinition]; expose P::A; }";
        // Act
        const v = view(body);
        // Assert
        expect(v?.nodeKeys).toEqual(["R", "A"]);
      });

      it("短い名前（iv）と、標準ビュー定義を特殊化した view def の型も、たどって描き方を決める", () => {
        // Arrange
        const short = "view v : iv { expose P::A; }";
        const special = "view def MyStates :> StandardViewDefinitions::StateTransitionView; view v : MyStates;";
        // Act
        const a = view(short);
        const b = view(special);
        // Assert
        expect(a).toMatchObject({ kind: "interconnection", std: "InterconnectionView" });
        expect(a?.targets.map((e) => e.name)).toEqual(["A"]);
        expect(b).toMatchObject({ kind: "stateTransition", std: "StateTransitionView" });
      });

      it("render asInterconnectionDiagram は、型より優先する（ViewRenderingMember）", () => {
        // Arrange
        const body = "view v : GeneralView { expose P::A; render asInterconnectionDiagram; }";
        // Act
        const v = view(body);
        // Assert
        expect(v?.kind).toBe("interconnection");
      });

      it("標準ビュー定義の型は「見つからない」と言わず、view と view def は図の要素にしない", () => {
        // Arrange
        const text = MODEL + "view def MyView :> GeneralView; view v : GeneralView; view w : MyView; }";
        // Act
        const m = build(parse(text));
        // Assert
        expect(m.problems).toEqual([]);
        expect(m.nodes.map((n) => n.name)).not.toContain("MyView");
      });

      it("見つからない expose の対象はエラーにし、扱えない filter・render・図の種類は黙って捨てずに知らせる（異常系）", () => {
        // Arrange
        const body = "view v : GeometryView { expose P::Nope; filter @A and @B; render asElementTable; }";
        // Act
        const ps = build(parse(MODEL + body + "\n}")).problems;
        // Assert
        expect(ps.filter((p) => !p.kind).map((p) => p.msg)).toEqual(["図「v」に出す要素「P::Nope」が見つかりません（expose）"]);
        expect(ps.filter((p) => p.kind === "unsupported").map((p) => p.msg)).toEqual([
          "図「v」の種類（形状の図）の描き方はまだ無いため、一般の図として描きます（GeometryView）",
          "図「v」の表し方（asElementTable）はまだ扱えないため、図として描きます（render）",
          "図「v」の絞り込み「@A and @B」はまだ扱えないため、絞り込まずに描きます（filter）",
        ]);
      });

      it("expose の無い view は何も描かない（境界値）", () => {
        // Arrange
        const body = "view v;";
        // Act
        const v = view(body);
        // Assert
        expect(v?.nodeKeys).toEqual([]);
      });
    });
  });
}

// alpha.7 から、暫定の TS コアは alpha.6 の範囲で止め、新しく直した文法と読み方は Rust のコアだけで確かめる（ADR-0015）。
// 暫定コアは beta.1 で削除する。
for (const [impl, parse, build] of PARSERS.filter(([name]) => name === "Rust")) {
  describe(`${impl}（alpha.7 から Rust だけ）`, () => {
    const entry = (text: string, name: string) => parse(text).entries.find((e) => e.name === name);
    const problems = (text: string): string[] => build(parse(text)).problems.map((p) => p.msg);
    const errors = (text: string): string[] => build(parse(text)).problems.filter((p) => !p.kind).map((p) => p.msg);
    const edges = (text: string): string[] => build(parse(text)).edges.map((e) => `${e.kind}|${e.from}|${e.to}`);

    describe("テキストでの表し方（TextualRepresentation、8.2.2.4）", () => {
      it("rep … language \"…\" /* … */ は本文のコメントで終わり、続く宣言を読む", () => {
        // Arrange
        const text = 'package P { rep r language "x" /* body */ part def B; }';
        // Act
        const b = entry(text, "B");
        // Assert
        expect(b?.pe?.name).toBe("P");
        expect(problems(text)).toEqual([]);
      });

      it("本体の中の language \"…\" /* … */ も、次の行の宣言を隠さない（境界値：rep の無い形）", () => {
        // Arrange
        const text = 'package P { part def A {\n  language "x" /* body */\n  part c;\n} }';
        // Act
        const c = entry(text, "c");
        // Assert
        expect(c?.pe?.name).toBe("A");
        expect(problems(text)).toEqual([]);
      });
    });

    describe("assert not・assume・require の制約（AssertConstraintUsage・RequirementConstraintMember、8.2.2.20〜21）", () => {
      it("assert not constraint d { x < 0 } と assume constraint { y < 1 } は、式を持ち主に入れる", () => {
        // Arrange
        const text = "package P { part def A { assert not constraint d { x < 0 } assume constraint { y < 1 } require constraint c { z < 2 } } }";
        // Act
        const a = entry(text, "A");
        // Assert
        expect(a?.exprs.map((x) => [x.text, x.via])).toEqual([["x < 0", "assert"], ["y < 1", "assume"], ["z < 2", "require"]]);
        expect(problems(text)).toEqual([]);
      });
    });

    describe("verify（RequirementVerificationUsage、8.2.2.24）", () => {
      it("パッケージ直下の使用の中の verify は、相手を見つけ、使用の型から線を引く", () => {
        // Arrange
        const text = "package P { requirement def RD; verification def VD; verification v : VD { objective { verify RD; } } }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["verify|VD|RD"]);
        expect(problems(text)).toEqual([]);
      });
    });

    describe("viewpoint の frame（ViewpointDefinition・FramedConcernMember、8.2.2.26）", () => {
      it("viewpoint はツリーにだけ出し、中の frame は記録するが線にも「見つからない」にもしない", () => {
        // Arrange
        const text = "package P { concern def C; viewpoint def VP { frame concern c : C; } viewpoint vp { frame concern c : C; } }";
        // Act
        const P = parse(text);
        const M = build(P);
        // Assert
        expect(P.entries.map((e) => e.kind)).toEqual(["package", "concern def", "viewpoint def", "viewpoint"]);
        expect(P.rels.map((r) => r.rel)).toEqual(["frame", "frame"]);
        expect(M.problems).toEqual([]);
        expect(M.edges).toEqual([]);
      });
    });

    describe("まだ扱えない文の本体（F-EDIT-8）", () => {
      it.each([
        ["join j { part x; }"],
        ["merge m { part x; }"],
      ])("%s の中の宣言を、外側の package の中身として読まない", (stmt) => {
        // Arrange
        const text = `package P { ${stmt} }`;
        // Act
        const x = entry(text, "x");
        // Assert
        expect(x).toBeUndefined();
        expect(build(parse(text)).problems.map((p) => p.kind)).toEqual(["unsupported"]);
      });
    });

    describe("修飾名（QualifiedName、8.2.2.1〜2。名前は参照した場所から外へ探す、8.2.2.5）", () => {
      const MODEL = "package X { part def A; } package P { package Q { part def A; } part def H { ";

      it("Q::A は、H から見える Q の中の A につなぐ（同じ名前の X::A ではない）", () => {
        // Arrange
        const text = `${MODEL}part a : Q::A; } }`;
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["comp|H|A@Q"]);
        expect(problems(text)).toEqual([]);
      });

      it("たどれない修飾名は、最後の名前が同じ要素があっても「見つからない」とする（異常系）", () => {
        // Arrange
        const text = `${MODEL}part b : Nope::A; part c : X::Z; } }`;
        // Act
        const ps = errors(text);
        // Assert
        expect(ps).toEqual(["型「Nope::A」が見つかりません（b）", "型「X::Z」が見つかりません（c）"]);
      });

      it("標準ライブラリの修飾名（ISQ::MassValue・ScalarValues::Real）は知らせない", () => {
        // Arrange
        const text = "package P { part def H { attribute m : ISQ::MassValue; attribute r : ScalarValues::Real; } }";
        // Act
        const ps = problems(text);
        // Assert
        expect(ps).toEqual([]);
      });
    });

    describe("ケース（CaseDefinition・CaseUsage、8.2.2.22）", () => {
      it("case def と case は要素になり、本体（subject・actor・objective）も読む", () => {
        // Arrange
        const text = "package P { part def V; case def CS { subject v : V; actor a : V; objective { require constraint { t < 1 } } } case c : CS; }";
        // Act
        const P = parse(text);
        // Assert
        expect(P.entries.map((e) => [e.kind, e.name])).toEqual([
          ["package", "P"], ["part def", "V"], ["case def", "CS"], ["subject", "v"], ["actor", "a"], ["case", "c"],
        ]);
        expect(entry(text, "CS")?.exprs.map((x) => x.text)).toEqual(["t < 1"]);
        expect(problems(text)).toEqual([]);
      });

      it("case def は図の要素にしない（ツリーにだけ出す）", () => {
        // Arrange
        const text = "package P { case def CS; part def A; }";
        // Act
        const keys = build(parse(text)).nodes.map((n) => n.key);
        // Assert
        expect(keys).toEqual(["A"]);
      });
    });

    describe("アクターと include（ActorUsage・IncludeUseCaseUsage、8.2.2.24〜25）", () => {
      it("actor は型付きの要素、include use case は含めるユースケースを型にした要素になる", () => {
        // Arrange
        const text = "package P { part def User; use case def Boil; use case def Make { actor u : User; include use case b : Boil; include other; } }";
        // Act
        const P = parse(text);
        // Assert
        expect(P.entries.slice(4).map((e) => [e.kind, e.name, e.type])).toEqual([
          ["actor", "u", "User"], ["include use case", "b", "Boil"], ["include use case", "other", ""],
        ]);
        expect(problems(text)).toEqual([]);
      });
    });

    describe("列挙の使用・出来事（EnumerationUsage 8.2.2.7、EventOccurrenceUsage・PortionUsage 8.2.2.9）", () => {
      it("enum e : E は要素になり、enum def の中の enum は列挙値のまま", () => {
        // Arrange
        const text = "package P { enum def E { enum a; } part def H { enum e : E; } }";
        // Act
        const P = parse(text);
        // Assert
        expect(entry(text, "E")?.enumValues).toEqual(["a"]);
        expect(entry(text, "e")?.kind).toBe("enum");
        expect(P.unsupported).toEqual([]);
      });

      it("event occurrence・timeslice・snapshot は、書いた語を種類にした使用になる", () => {
        // Arrange
        const text = "package P { occurrence def O { event occurrence e; timeslice t; snapshot occurrence s; timeslice part p; } }";
        // Act
        const kinds = parse(text).entries.slice(2).map((e) => [e.kind, e.name, e.mods]);
        // Assert
        expect(kinds).toEqual([
          ["event occurrence", "e", ""], ["timeslice", "t", "timeslice"], ["snapshot", "s", "snapshot"], ["part", "p", "timeslice"],
        ]);
      });
    });

    describe("typed by・constant・variant（TypedBy・UsagePrefix・VariantUsageMember、8.2.2.6）", () => {
      it("typed by A は : A と同じく型になる", () => {
        // Arrange
        const text = "package P { part def A; part p typed by A; }";
        // Act
        const p = entry(text, "p");
        // Assert
        expect(p?.type).toBe("A");
        expect(problems(text)).toEqual([]);
      });

      it("constant・variant は修飾として記録し、宣言はそのまま読む", () => {
        // Arrange
        const text = "package P { part def H { constant attribute k : Real = 1; } variation part def V { variant part a; } }";
        // Act
        const P = parse(text);
        // Assert
        expect([entry(text, "k")?.kind, entry(text, "k")?.mods, entry(text, "k")?.value]).toEqual(["attribute", "constant", "1"]);
        expect([entry(text, "V")?.mods, entry(text, "a")?.mods]).toEqual(["variation", "variant"]);
        expect(entry(text, "H")?.exprs).toEqual([]);
        expect(P.unsupported).toEqual([]);
      });
    });

    describe("rendering（RenderingDefinition・RenderingUsage、8.2.2.26）", () => {
      it("rendering def と rendering はツリーにだけ出す要素になる", () => {
        // Arrange
        const text = "package P { rendering def RD; rendering r : RD; }";
        // Act
        const M = build(parse(text));
        // Assert
        expect(parse(text).entries.map((e) => e.kind)).toEqual(["package", "rendering def", "rendering"]);
        expect(M.nodes).toEqual([]);
        expect(M.problems).toEqual([]);
      });
    });

    describe("メタデータ（MetadataUsage・MetadataBody、8.2.2.27）", () => {
      it("metadata M about A, B { … } は、A と B のそれぞれにメタデータと値を付ける", () => {
        // Arrange
        const text = "package P { metadata def Safety; part def A; part def B; metadata Safety about A, B { level = 2; } }";
        // Act
        const [a, b] = [entry(text, "A"), entry(text, "B")];
        // Assert
        expect(a?.meta).toEqual({ Safety: { level: "2" } });
        expect(b?.meta).toEqual({ Safety: { level: "2" } });
        expect(problems(text)).toEqual([]);
      });

      it("about の相手が無ければ問題にする（異常系）", () => {
        // Arrange
        const text = "package P { metadata def Safety; metadata Safety about Nope; }";
        // Act
        const ps = errors(text);
        // Assert
        expect(ps).toEqual(["メタデータを付ける相手「Nope」が見つかりません（metadata about）"]);
      });

      it("about の無い metadata M; は、@M; と同じく持ち主に付ける", () => {
        // Arrange
        const text = "package P { metadata def M; metadata def N; part def A { metadata M; @N; } }";
        // Act
        const a = entry(text, "A");
        // Assert
        expect(a?.meta).toEqual({ M: {}, N: {} });
      });

      it("本体の値は式全体を残し、列挙値の修飾名だけは最後の名前にする", () => {
        // Arrange
        const text = "package P { part def A { @M { k = 1 + 2; e = K::High; } } }";
        // Act
        const a = entry(text, "A");
        // Assert
        expect(a?.meta).toEqual({ M: { k: "1 + 2", e: "High" } });
      });

      it("利用者定義のキーワード #X def H・#X h は捨てずに読み、メタデータ X を付ける", () => {
        // Arrange
        const text = "package P { metadata def X; #X def H; part def A { #X h : H; } }";
        // Act
        const [h, u] = [entry(text, "H"), entry(text, "h")];
        // Assert
        expect([h?.kind, h?.isDef, h?.meta]).toEqual(["def", true, { X: {} }]);
        expect([u?.kind, u?.type, u?.meta]).toEqual(["usage", "H", { X: {} }]);
        expect(build(parse(text)).problems).toEqual([]);
      });

      it("メタデータの定義が baseType で基の型を決めていれば、その種類の宣言として読む", () => {
        // Arrange
        const text = "package P { metadata def Cmd :> SemanticMetadata { :>> baseType = commands meta SysML::PartUsage; } #Cmd def Pump; }";
        // Act
        const M = build(parse(text));
        // Assert
        expect(entry(text, "Pump")?.kind).toBe("part def");
        expect(M.nodes.map((n) => n.key)).toEqual(["Pump"]);
      });
    });

    describe("満たす関係の書き方（SatisfyRequirementUsage、8.2.2.21）", () => {
      const MODEL = "package P { enum def K { enum a; enum b; } metadata def Phase { attribute stage : K; } requirement def R { @Phase { stage = K::b; } } ";

      it("by の無い satisfy R; は、持ち主が R を満たす線になる", () => {
        // Arrange
        const text = "package P { requirement def R; part def H { satisfy R; } }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["satisfy|H|R"]);
        expect(problems(text)).toEqual([]);
      });

      it("assert satisfy R by X は satisfy R by X と同じ", () => {
        // Arrange
        const text = "package P { requirement def R; part def X; assert satisfy R by X; }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["satisfy|X|R"]);
      });

      it("not satisfy R by X は線にせず、満たす要素として数えない（トレースの抜けが残る）", () => {
        // Arrange
        const text = `${MODEL}part def X; not satisfy R by X; }`;
        // Act
        const M = build(parse(text));
        // Assert
        expect(M.edges.filter((e) => e.kind === "satisfy")).toEqual([]);
        expect(M.problems.filter((p) => p.kind === "gap").map((p) => p.msg)).toContain("R R：この要求を満たす要素がありません（satisfy）");
        expect(M.problems.filter((p) => p.kind === "unsupported")).toEqual([]);
      });
    });

    describe("名前付きの制約の参照（AssertConstraintUsage・RequirementConstraintMember、8.2.2.20〜21）", () => {
      it("本体の無い assert constraint c : CD; と require c : CD; は、持ち主の式として残す", () => {
        // Arrange
        const text = "package P { constraint def CD; requirement def R { require c : CD; } part def H { assert constraint d : CD; } }";
        // Act
        const [r, h] = [entry(text, "R"), entry(text, "H")];
        // Assert
        expect(r?.exprs.map((x) => [x.text, x.via])).toEqual([["c : CD", "require"]]);
        expect(h?.exprs.map((x) => [x.text, x.via])).toEqual([["d : CD", "assert"]]);
      });
    });

    describe("標準ライブラリの型の名前（ScalarValues・Time・ISQ、9 章の標準ライブラリ）", () => {
      it("ScalarValues と Time の名前（Positive・Rational・Iso8601DateTime）は知らせない", () => {
        // Arrange
        const text = "package P { part def H { attribute a : Positive; attribute b : Rational; attribute c : Iso8601DateTime; } }";
        // Act
        const ps = problems(text);
        // Assert
        expect(ps).toEqual([]);
      });

      it("…Value で終わる名前は、ISQ などを import したときだけ標準ライブラリの型とみなす", () => {
        // Arrange
        const without = "package P { part def H { attribute m : MassValue; attribute t : MyTypoValue; } }";
        const withImport = "package P { private import ISQ::*; part def H { attribute m : MassValue; } }";
        // Act
        const [a, b] = [errors(without), errors(withImport)];
        // Assert
        expect(a).toEqual(["型「MassValue」が見つかりません（m）", "型「MyTypoValue」が見つかりません（t）"]);
        expect(b).toEqual([]);
      });
    });

    describe("別名（AliasMember、8.2.2.5）", () => {
      it("同じファイルの alias B for Q::A で型付けすると、A につなぐ", () => {
        // Arrange
        const text = "package P { package Q { part def A; } alias B for Q::A; part def H { part b : B; } }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["comp|H|A"]);
        expect(problems(text)).toEqual([]);
      });
    });

    describe("特殊化・部分集合・再定義・参照の線（SubclassificationPart・FeatureSpecializationPart 8.2.2.6、8.2.3 の type-relationship）", () => {
      it("定義の :> A, B と specializes は、相手ごとに特殊化の線になる", () => {
        // Arrange
        const text = "package P { part def A; part def B; part def C :> A, B; part def D specializes C; }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["specialize|C|A", "specialize|C|B", "specialize|D|C"]);
        expect(problems(text)).toEqual([]);
      });

      it("特殊化の線を消すと、その相手だけがテキストから消える範囲を指す", () => {
        // Arrange
        const text = "package P { part def A; part def B; part def C :> A, B; }";
        // Act
        const srcs = build(parse(text)).edges.map((e) => text.slice(e.src.start, e.src.end));
        // Assert
        expect(srcs).toEqual(["A, ", ", B"]);
      });

      it("package の直下の部品どうしの :>・:>>・::> は、部分集合・再定義・参照の線になる", () => {
        // Arrange
        const text = "package P { part def A; part a : A; part b :> a; part c redefines a; part d references a; }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["defined|a|A", "subset|b|a", "redefine|c|a", "reference|d|a"]);
        expect(problems(text)).toEqual([]);
      });

      it("標準ライブラリの定義や、定義の中の特性への関係は、線にも問題にもしない（異常系）", () => {
        // Arrange
        const text = "package P { part def A :> Part { attribute m; } part def B :> A { attribute :>> m = 1; part x :> nope; } }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["specialize|B|A"]);
        expect(problems(text)).toEqual([]);
      });
    });

    describe("依存（Dependency、8.2.2.3・8.2.3.3 の binary-dependency）", () => {
      it("dependency A, B to C; は、依存する側とされる側の組ごとに線になる", () => {
        // Arrange
        const text = "package P { part def A; part def B; part def C; dependency A, B to C; }";
        // Act
        const es = edges(text);
        // Assert
        expect(es).toEqual(["dependency|A|C", "dependency|B|C"]);
        expect(problems(text)).toEqual([]);
      });

      it("名前と、前に付けたメタデータ（#derivation 以外）は線のラベルになる", () => {
        // Arrange
        const text = "package P { metadata def trace; part def A; part def B; #trace dependency d from A to B; }";
        // Act
        const labels = build(parse(text)).edges.map((e) => e.label);
        // Assert
        expect(labels).toEqual(["«trace» d"]);
      });

      it("見つからない相手は、ほかの関係と同じ言い方で知らせる（異常系）", () => {
        // Arrange
        const text = "package P { part def A; dependency d from A to Nope; }";
        // Act
        const ps = errors(text);
        // Assert
        expect(ps).toEqual(["「依存」関係の相手「Nope」が見つかりません（dependency）"]);
      });
    });

    describe("接続と結び付け（ConnectionUsage・BindingConnectorAsUsage、8.2.2.13）", () => {
      it("connection の無い connect a to b; は、名前の無い接続として connection connect と同じ線になる", () => {
        // Arrange
        const text = "package P { part def A { port p; } part def H { part a : A; part b : A; connect a.p to b.p; } }";
        // Act
        const M = build(parse(text));
        // Assert
        expect(M.edges.filter((e) => e.kind === "flow").map((e) => `${e.from}|${e.to}|${e.fromPort}|${e.toPort}`)).toEqual(["A|A|port:p|port:p"]);
        expect(M.problems).toEqual([]);
      });

      it("n 項の connect (a, b, c) は、すべての端を残し、一般の図の線にはしない", () => {
        // Arrange
        const text = "package P { part def A { port p; } part def H { part a : A; part b : A; part c : A; connect (a.p, b.p, c.p); } }";
        // Act
        const P = parse(text);
        // Assert
        expect(P.rels.map((r) => (r as { ends?: string[] }).ends)).toEqual([["a.p", "b.p", "c.p"]]);
        expect(build(P).edges.filter((e) => e.kind === "flow")).toEqual([]);
      });

      it("bind a = b; は持ち主の式にならず、見つからない相手を知らせる（異常系）", () => {
        // Arrange
        const text = "package P { part def H { part a; bind a = gone; } }";
        // Act
        const [h, ps] = [entry(text, "H"), errors(text)];
        // Assert
        expect(h?.exprs).toEqual([]);
        expect(ps).toEqual(["「結び付け」の相手「gone」が見つかりません（bind）"]);
      });
    });

    describe("割り当て（AllocationDefinition・AllocationUsage、8.2.2.15）", () => {
      it("allocation def と allocation は要素になり、本体の中も読む", () => {
        // Arrange
        const text = "package P { allocation def AD { end f : F; } allocation a : AD allocate x to y; part def F; }";
        // Act
        const [ad, a, f] = [entry(text, "AD"), entry(text, "a"), entry(text, "f")];
        // Assert
        expect([ad?.kind, a?.kind, a?.type, f?.pe?.name]).toEqual(["allocation def", "allocation", "AD", "AD"]);
        expect(build(parse(text)).problems.filter((p) => p.kind === "unsupported")).toEqual([]);
      });

      it("allocate x to y は、図に描く要素の間の «allocate» の線になる（8.2.3.15 の allocate-relationship）", () => {
        // Arrange
        const text = "package P { part def Logical; part def Physical; allocation def AD; allocate Logical to Physical; allocation a : AD allocate Logical to Physical; }";
        // Act
        const M = build(parse(text));
        // Assert
        expect(M.edges.map((e) => `${e.kind}|${e.from}|${e.to}|${e.label}`)).toEqual([
          "allocate|Logical|Physical|«allocate»",
          "allocate|Logical|Physical|«allocate» a",
        ]);
        expect(M.problems).toEqual([]);
      });

      it("見つからない相手は、ほかの関係と同じ言い方で知らせる（異常系）", () => {
        // Arrange
        const text = "package P { part def Logical; allocate Logical to Nope; }";
        // Act
        const ps = errors(text);
        // Assert
        expect(ps).toEqual(["「割り当て」関係の相手「Nope」が見つかりません（allocate）"]);
      });
    });

    describe("フロー（FlowDefinition・FlowUsage、8.2.2.16）", () => {
      it("flow def は定義、名前付きのフローは使用になり、本体の中も読む", () => {
        // Arrange
        const text = "package P { item def Water; flow def FD { end x : Water; } part def H { flow f : FD from a.o to b.i; } }";
        // Act
        const [fd, f, x] = [entry(text, "FD"), entry(text, "f"), entry(text, "x")];
        // Assert
        expect([fd?.kind, f?.kind, f?.type, x?.pe?.name]).toEqual(["flow def", "flow", "FD", "FD"]);
        expect(build(parse(text)).problems.filter((p) => p.kind === "unsupported")).toEqual([]);
      });

      it("名前付きのフローの線には、名前と型（of のアイテム）を書く（8.2.3.16 の flow-label）", () => {
        // Arrange
        const text = "package P { part def S { port o; } part def T { port i; } item def Water; flow def FD; part def H { part s : S; part t : T; flow f : FD from s.o to t.i; flow g of Water from s.o to t.i; } }";
        // Act
        const labels = build(parse(text)).edges.filter((e) => e.kind === "flow").map((e) => e.label);
        // Assert
        expect(labels).toEqual(["f : FD", "g of Water"]);
      });
    });

    describe("多重度（MultiplicityPart、8.2.2.6）", () => {
      it("[…] の中と ordered・nonunique を宣言に残し、部品として持つ線の端に書く", () => {
        // Arrange
        const text = "package P { part def W; part def V { part w : W[0..4] ordered; attribute n : Real nonunique; } }";
        // Act
        const [w, n] = [entry(text, "w"), entry(text, "n")];
        const ends = build(parse(text)).edges.map((e) => e.endLabel);
        // Assert
        expect(w?.multiplicity).toEqual({ range: "0..4", ordered: true, nonunique: false });
        expect(n?.multiplicity).toEqual({ range: "", ordered: false, nonunique: true });
        expect(ends).toEqual(["[0..4] ordered"]);
        expect(problems(text)).toEqual([]);
      });

      it("特殊化の相手は、記号の種類と書いた相手を宣言に残す", () => {
        // Arrange
        const text = "package P { part def A { attribute m; } part def B :> A { attribute :>> m = 1; } }";
        // Act
        const [b, m] = [entry(text, "B"), parse(text).entries.find((e) => e.pe?.name === "B")];
        // Assert
        expect(b?.specs?.map((s) => [s.op, s.target])).toEqual([["specializes", "A"]]);
        expect(m?.specs?.map((s) => [s.op, s.target])).toEqual([["redefines", "m"]]);
      });
    });
  });
}
