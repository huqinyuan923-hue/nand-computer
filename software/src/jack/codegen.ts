/**
 * Jack AST -> VM code generator.
 *
 * Standard mapping:
 *  - static -> static seg; field -> this seg (implicit object at THIS)
 *  - method: argument 0 = this; prologue pushes argument 0 -> pointer 0
 *  - constructor: push nFields; call Memory.alloc 1; pop pointer 0
 *  - varName of class type T: method call compiles to T.method with object pushed
 *  - arrays: a[i] -> addr = a + i (16-bit words); read/write via pointer 1 (THAT)
 *  - string literals -> String.new(len) + appendChar chain
 *  - * and / -> Math.multiply / Math.divide calls
 */

import { ClassDecl, Expr, Stat, SubroutineDec, Type } from "./parser";

interface SymEntry {
  kind: "static" | "field" | "argument" | "local";
  type: Type;
  index: number;
}

interface SymTable {
  [name: string]: SymEntry;
}

export interface CodegenResult {
  vm: string;
  errors: Array<{ line: number; msg: string }>;
}

interface CompileCtx {
  errors: Array<{ line: number; msg: string }>;
  out: string[];
  className: string;
  currentSub: string; // full function name (Class.sub)
  classSyms: SymTable;
  subSyms: SymTable;
  labelCount: number;
  subroutineKinds: Map<string, "method" | "function" | "constructor">; // global across classes
  subroutineRets: Map<string, Type>; // global: return type per full sub name
  classFields: Map<string, number>; // class -> field count (for constructors)
  currentReturnType: Type;
  isMethod: boolean;
}

function kindToSegment(kind: SymEntry["kind"]): string {
  // VM segment names: fields live in the this-segment of the current object
  return kind === "field" ? "this" : kind;
}

export function compileClass(
  cls: ClassDecl,
  cross: {
    subroutineKinds?: Map<string, "method" | "function" | "constructor">;
    classFields?: Map<string, number>;
    subroutineRets?: Map<string, Type>;
  } = {},
): CodegenResult {
  const errors: Array<{ line: number; msg: string }> = [];
  const out: string[] = [];
  const classSyms: SymTable = {};
  let staticIdx = 0;
  let fieldIdx = 0;
  for (const dec of cls.classVars) {
    for (const name of dec.names) {
      if (name in classSyms) {
        errors.push({ line: dec.line, msg: `duplicate class variable: ${name}` });
        continue;
      }
      classSyms[name] = {
        kind: dec.kind, type: dec.type,
        index: dec.kind === "static" ? staticIdx++ : fieldIdx++,
      };
    }
  }
  const subroutineKinds = cross.subroutineKinds ?? new Map<string, "method" | "function" | "constructor">();
  const classFields = cross.classFields ?? new Map<string, number>();
  const subroutineRets = cross.subroutineRets ?? new Map<string, Type>();
  classFields.set(cls.name, fieldIdx);
  for (const sub of cls.subroutines) {
    subroutineKinds.set(sub.name, sub.kind);
    subroutineRets.set(sub.name, sub.retType);
  }

  for (const sub of cls.subroutines) {
    compileSubroutine(cls, sub, {
      errors, out, className: cls.name, currentSub: sub.name,
      classSyms, subSyms: {}, labelCount: 0,
      subroutineKinds, classFields, subroutineRets,
      currentReturnType: sub.retType, isMethod: sub.kind === "method",
    });
  }
  return { vm: out.join("\n") + "\n", errors };
}

function compileSubroutine(cls: ClassDecl, sub: SubroutineDec, ctx: CompileCtx): void {
  const { out } = ctx;
  const subSyms: SymTable = {};
  let argIdx = 0;
  let localIdx = 0;
  if (sub.kind === "method") {
    subSyms["this"] = { kind: "argument", type: cls.name, index: argIdx++ };
  }
  for (const p of sub.params) {
    if (p.name in subSyms) {
      ctx.errors.push({ line: sub.line, msg: `duplicate parameter name: ${p.name}` });
      continue;
    }
    subSyms[p.name] = { kind: "argument", type: p.type, index: argIdx++ };
  }
  for (const l of sub.locals) {
    if (l.name in subSyms) {
      ctx.errors.push({ line: sub.line, msg: `duplicate local name: ${l.name}` });
      continue;
    }
    subSyms[l.name] = { kind: "local", type: l.type, index: localIdx++ };
  }
  ctx.subSyms = subSyms;
  // strip array suffix from declared array types for element access typing
  out.push(`function ${sub.name} ${localIdx}`);
  if (sub.kind === "method") {
    out.push("push argument 0", "pop pointer 0");
  } else if (sub.kind === "constructor") {
    const n = ctx.classFields.get(cls.name) ?? 0;
    out.push(`push constant ${n}`, "call Memory.alloc 1", "pop pointer 0");
  }
  for (const st of sub.body) compileStatement(st, ctx);
  // implicit return only when the body can fall through (last stmt isn't return).
  // void functions push no value: their callers (do-statements) skip the pop.
  const last = sub.body[sub.body.length - 1];
  if (last === undefined || last.kind !== "return") {
    if (sub.retType === "void") {
      out.push("return");
    } else {
      out.push("push constant 0", "return");
    }
  }
}

function lookup(ctx: CompileCtx, name: string): SymEntry | null {
  if (name in ctx.subSyms) return ctx.subSyms[name];
  if (name in ctx.classSyms) return ctx.classSyms[name];
  return null;
}

/**
 * Emit a boolean condition, optionally inverted with ONE statement-level not.
 * A top-level `~cond` in the source folds into that single not (never doubled).
 */
function emitCond(cond: Expr, ctx: CompileCtx, invert: boolean): void {
  if (invert) {
    if (cond.kind === "unary" && cond.op === "~") {
      compileExpr(cond.expr, ctx);
    } else {
      compileExpr(cond, ctx);
      ctx.out.push("not");
    }
  } else {
    compileExpr(cond, ctx);
  }
}

function compileStatement(st: Stat, ctx: CompileCtx): void {
  const { out } = ctx;
  switch (st.kind) {
    case "let": {
      const sym = lookup(ctx, st.name);
      if (sym === null) {
        ctx.errors.push({ line: st.line, msg: `undefined variable: ${st.name}` });
        return;
      }
      if (st.index !== undefined) {
        if (!isIndexable(sym.type)) {
          ctx.errors.push({ line: st.line, msg: `'${st.name}' is not an array` });
          return;
        }
        // RHS first: its own a[j] reads use pointer 1 and would clobber a
        // pre-computed write address. Value stack, then address, then store.
        compileExpr(st.expr, ctx);
        compileExpr({ kind: "var", name: st.name, line: st.line }, ctx); // base
        compileExpr(st.index, ctx); // index
        out.push("add", "pop pointer 1");
        out.push("pop that 0");
      } else {
        compileExpr(st.expr, ctx);
        out.push(`pop ${kindToSegment(sym.kind)} ${sym.index}`);
      }
      return;
    }
    case "if": {
      const l0 = ctx.labelCount++;
      const lThen = `${ctx.currentSub}$IF.${l0}.THEN`;
      const lElse = `${ctx.currentSub}$IF.${l0}.ELSE`;
      const lEnd = `${ctx.currentSub}$IF.${l0}.END`;
      if (st.else === undefined) {
        // short form: ONE statement-level not (a source-level top-level ~
        // folds into it, never doubled)
        emitCond(st.cond, ctx, true);
        out.push(`if-goto ${lEnd}`);
        for (const s of st.then) compileStatement(s, ctx);
        out.push(`label ${lEnd}`);
      } else {
        // cond; if-goto THEN; goto ELSE; THEN: ... (no extra not: the
        // expression's own ~ must survive intact)
        compileExpr(st.cond, ctx);
        out.push(`if-goto ${lThen}`, `goto ${lElse}`, `label ${lThen}`);
        for (const s of st.then) compileStatement(s, ctx);
        out.push(`goto ${lEnd}`, `label ${lElse}`);
        for (const s of st.else) compileStatement(s, ctx);
        out.push(`label ${lEnd}`);
      }
      return;
    }
    case "while": {
      const l0 = ctx.labelCount++;
      const lExp = `${ctx.currentSub}$WHILE.${l0}.EXP`;
      const lEnd = `${ctx.currentSub}$WHILE.${l0}.END`;
      out.push(`label ${lExp}`);
      emitCond(st.cond, ctx, true);
      out.push(`if-goto ${lEnd}`);
      for (const s of st.body) compileStatement(s, ctx);
      out.push(`goto ${lExp}`, `label ${lEnd}`);
      return;
    }
    case "do": {
      compileExpr(st.call, ctx);
      // VM `return` leaves one word at *ARG even for void callees, so every
      // discarded call must drop it or the caller's SP drifts up by 1 per call.
      out.push("pop temp 0");
      return;
    }
    case "return": {
      if (st.expr !== undefined) {
        compileExpr(st.expr, ctx);
      } else if (ctx.currentReturnType !== "void") {
        out.push("push constant 0");
      }
      out.push("return");
      return;
    }
  }
}

function compileCall(expr: Extract<Expr, { kind: "call" }>, ctx: CompileCtx): void {
  const { out } = ctx;
  const { target, name, args } = expr;
  if (target === undefined) {
    // bare call f(...): subroutine of the current class (method gets implicit this)
    const kind = ctx.subroutineKinds.get(`${ctx.className}.${name}`);
    if (kind === "method") {
      out.push("push pointer 0");
      for (const a of args) compileExpr(a, ctx);
      out.push(`call ${ctx.className}.${name} ${args.length + 1}`);
    } else if (kind === "function" || kind === "constructor") {
      for (const a of args) compileExpr(a, ctx);
      out.push(`call ${ctx.className}.${name} ${args.length}`);
    } else {
      ctx.errors.push({ line: expr.line, msg: `unknown subroutine: ${name}` });
    }
    return;
  }
  // qualified: obj.f(...) or Class.f(...)
  const sym = lookup(ctx, target);
  if (sym !== undefined && sym !== null && !isPrimitiveScalar(sym.type) && !sym.type.endsWith("[]")) {
    // object method: push the object, then the args
    compileExpr({ kind: "var", name: target, line: expr.line }, ctx);
    for (const a of args) compileExpr(a, ctx);
    out.push(`call ${sym.type}.${name} ${args.length + 1}`);
    return;
  }
  if (sym !== null && sym.type.endsWith("[]")) {
    ctx.errors.push({ line: expr.line, msg: `cannot call method on array '${target}'` });
    return;
  }
  // Class.f(...) static call
  for (const a of args) compileExpr(a, ctx);
  out.push(`call ${target}.${name} ${args.length}`);
}

/** int/char/boolean (not arrays, not class types) */
function isPrimitiveScalar(type: Type): boolean {
  return type === "int" || type === "char" || type === "boolean";
}

/** indexing is allowed on arrays and any non-primitive type (Array a; a[i]) */
function isIndexable(type: Type): boolean {
  return !isPrimitiveScalar(type);
}

export function compileExpr(expr: Expr, ctx: CompileCtx): void {
  const { out } = ctx;
  switch (expr.kind) {
    case "int":
      out.push(`push constant ${expr.value}`);
      return;
    case "str": {
      out.push(`push constant ${expr.value.length}`, "call String.new 1");
      for (const ch of expr.value) {
        out.push(`push constant ${ch.charCodeAt(0)}`, "call String.appendChar 2");
      }
      return;
    }
    case "true":
      out.push("push constant 0", "not");
      return;
    case "false":
    case "null":
      out.push("push constant 0");
      return;
    case "this":
      out.push("push pointer 0");
      return;
    case "var": {
      const sym = lookup(ctx, expr.name);
      if (sym === null) {
        ctx.errors.push({ line: expr.line, msg: `undefined variable: ${expr.name}` });
        return;
      }
      if (expr.index !== undefined) {
        if (!isIndexable(sym.type)) {
          ctx.errors.push({ line: expr.line, msg: `'${expr.name}' is not an array` });
          return;
        }
        compileExpr({ kind: "var", name: expr.name, line: expr.line }, ctx);
        compileExpr(expr.index, ctx);
        out.push("add", "pop pointer 1", "push that 0");
        return;
      }
      out.push(`push ${kindToSegment(sym.kind)} ${sym.index}`);
      return;
    }
    case "unary":
      compileExpr(expr.expr, ctx);
      out.push(expr.op === "-" ? "neg" : "not");
      return;
    case "binary": {
      if (expr.op === "*" || expr.op === "/") {
        compileExpr(expr.left, ctx);
        compileExpr(expr.right, ctx);
        out.push(expr.op === "*" ? "call Math.multiply 2" : "call Math.divide 2");
        return;
      }
      compileExpr(expr.left, ctx);
      compileExpr(expr.right, ctx);
      const op = expr.op === "+" ? "add"
        : expr.op === "-" ? "sub"
        : expr.op === "=" ? "eq"
        : expr.op === "<" ? "lt"
        : expr.op === ">" ? "gt"
        : expr.op === "&" ? "and"
        : "or";
      out.push(op);
      return;
    }
    case "call":
      compileCall(expr, ctx);
      return;
  }
}
