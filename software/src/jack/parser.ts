/**
 * Jack recursive-descent parser producing an AST.
 *
 * Expression grammar (precedence low -> high):
 *   expression := orTerm ('|' orTerm)*          // lowest
 *   orTerm     := andTerm ('&' andTerm)*
 *   andTerm    := relTerm (('='|'<'|'>') relTerm)?
 *   relTerm    := addTerm (('+'|'-') addTerm)*
 *   addTerm    := mulTerm (('*'|'/') mulTerm)*
 *   mulTerm    := unaryTerm
 *   unaryTerm  := ('-'|'~') unaryTerm | primary
 *   primary    := int | string | true/false/null/this | '(' expr ')'
 *              | name ('[' expr ']')? | callSuffix
 *   callSuffix := name '(' args ')' ('.' name '(' args ')')?  resolved by lookahead
 */

import { Token, tokenize } from "./tokenizer";

// ---- AST ----

export type Type = string; // int, char, boolean, void, or class name; "X[]" for arrays

export interface ClassVarDec {
  kind: "static" | "field";
  type: Type;
  names: string[];
  line: number;
}

export interface Param {
  type: Type;
  name: string;
}

export type Expr =
  | { kind: "int"; value: number; line: number }
  | { kind: "str"; value: string; line: number }
  | { kind: "true"; line: number }
  | { kind: "false"; line: number }
  | { kind: "null"; line: number }
  | { kind: "this"; line: number }
  | { kind: "var"; name: string; index?: Expr; line: number }
  | { kind: "unary"; op: "-" | "~"; expr: Expr; line: number }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "=" | "<" | ">" | "&" | "|"; left: Expr; right: Expr; line: number }
  | { kind: "call"; target?: string; name: string; args: Expr[]; line: number };

export type Stat =
  | { kind: "let"; name: string; index?: Expr; expr: Expr; line: number }
  | { kind: "if"; cond: Expr; then: Stat[]; else?: Stat[]; line: number }
  | { kind: "while"; cond: Expr; body: Stat[]; line: number }
  | { kind: "do"; call: Extract<Expr, { kind: "call" }>; line: number }
  | { kind: "return"; expr?: Expr; line: number };

export interface SubroutineDec {
  kind: "constructor" | "function" | "method";
  retType: Type;
  name: string;
  params: Param[];
  locals: Array<{ type: Type; name: string }>;
  body: Stat[];
  line: number;
}

export interface ClassDecl {
  name: string;
  classVars: ClassVarDec[];
  subroutines: SubroutineDec[];
}

export interface ParseResult {
  cls: ClassDecl | null;
  errors: Array<{ line: number; msg: string }>;
}

class Parser {
  private t: Token[];
  private pos = 0;
  private errors: Array<{ line: number; msg: string }>;
  private className = "";

  constructor(tokens: Token[], errors: Array<{ line: number; msg: string }>) {
    this.t = tokens;
    this.errors = errors;
  }

  private peek(offset = 0): Token | null {
    return this.t[this.pos + offset] ?? null;
  }

  private next(): Token {
    const tok = this.t[this.pos++];
    return tok;
  }

  private err(line: number, msg: string): void {
    this.errors.push({ line, msg });
  }

  private isSym(v: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok !== null && tok.type === "symbol" && tok.value === v;
  }

  private isKw(v: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok !== null && tok.type === "keyword" && tok.value === v;
  }

  private expectSym(v: string): Token | null {
    if (this.isSym(v)) return this.next();
    const tok = this.peek();
    this.err(tok?.line ?? 0, `expected '${v}'${tok ? `, got '${tok.value}'` : ", got end of file"}`);
    return null;
  }

  private expectKw(v: string): Token | null {
    if (this.isKw(v)) return this.next();
    const tok = this.peek();
    this.err(tok?.line ?? 0, `expected '${v}'${tok ? `, got '${tok.value}'` : ", got end of file"}`);
    return null;
  }

  private expectIdent(what: string): string | null {
    const tok = this.peek();
    if (tok !== null && tok.type === "identifier") {
      this.next();
      return tok.value;
    }
    this.err(tok?.line ?? 0, `expected ${what}${tok ? `, got '${tok.value}'` : ", got end of file"}`);
    return null;
  }

  /** Recover: skip tokens until one of the given symbols, consuming it. */
  private sync(syms: string[]): void {
    while (this.pos < this.t.length) {
      const tok = this.t[this.pos];
      if (tok.type === "symbol" && syms.includes(tok.value)) {
        this.pos++;
        return;
      }
      this.pos++;
    }
  }

  hasMoreTokens(): boolean {
    return this.pos < this.t.length;
  }

  parseClass(): ClassDecl | null {
    if (this.expectKw("class") === null) return null;
    const name = this.expectIdent("class name");
    if (name === null) return null;
    this.className = name;
    if (this.expectSym("{") === null) return null;
    const classVars: ClassVarDec[] = [];
    const subroutines: SubroutineDec[] = [];
    while (this.errors.length === 0 || this.errors.length < 50) {
      if (this.isSym("}")) { this.next(); break; }
      if (this.pos >= this.t.length) {
        this.err(this.t[this.t.length - 1]?.line ?? 0, "unexpected end of file in class body");
        return { name, classVars, subroutines };
      }
      if (this.isKw("static") || this.isKw("field")) {
        const dec = this.parseClassVarDec();
        if (dec !== null) classVars.push(dec);
        continue;
      }
      if (this.isKw("constructor") || this.isKw("function") || this.isKw("method")) {
        const sub = this.parseSubroutine();
        if (sub !== null) subroutines.push(sub);
        continue;
      }
      const tok = this.peek();
      this.err(tok?.line ?? 0, `expected declaration in class body, got '${tok?.value}'`);
      this.sync(["}"]);
      if (this.pos <= this.t.length && this.t[this.pos - 1]?.value === "}") break;
      continue;
    }
    return { name, classVars, subroutines };
  }

  private parseType(allowVoid: boolean): Type | null {
    const tok = this.peek();
    if (tok === null) { this.err(0, "expected type, got end of file"); return null; }
    if (tok.type === "keyword" && ["int", "char", "boolean"].includes(tok.value)) {
      this.next();
      let t = tok.value as Type;
      while (this.isSym("[") && this.isSym("]", 1)) {
        this.next(); this.next();
        t += "[]";
      }
      return t;
    }
    if (tok.type === "keyword" && tok.value === "void") {
      if (!allowVoid) { this.err(tok.line, "void not allowed here"); return null; }
      this.next();
      return "void";
    }
    if (tok.type === "identifier") {
      this.next();
      let t: Type = tok.value;
      while (this.isSym("[") && this.isSym("]", 1)) {
        this.next(); this.next();
        t += "[]";
      }
      return t;
    }
    this.err(tok.line, `expected type, got '${tok.value}'`);
    return null;
  }

  private parseClassVarDec(): ClassVarDec | null {
    const kindTok = this.next(); // static | field
    const type = this.parseType(false);
    if (type === null) { this.sync([";"]); return null; }
    const names: string[] = [];
    for (; ;) {
      const name = this.expectIdent("variable name");
      if (name === null) { this.sync([";"]); return null; }
      names.push(name);
      if (this.isSym(",")) { this.next(); continue; }
      break;
    }
    if (this.expectSym(";") === null) { this.sync([";"]); return null; }
    return { kind: kindTok.value as "static" | "field", type, names, line: kindTok.line };
  }

  private parseSubroutine(): SubroutineDec | null {
    const kindTok = this.next(); // constructor | function | method
    const retType = this.parseType(true);
    if (retType === null) { this.sync(["}"]); return null; }
    const name = this.expectIdent("subroutine name");
    if (name === null) { this.sync(["}"]); return null; }
    if (this.expectSym("(") === null) { this.sync(["}"]); return null; }
    const params: Param[] = [];
    if (!this.isSym(")")) {
      for (; ;) {
        const ptype = this.parseType(false);
        if (ptype === null) { this.sync([")"]); break; }
        const pname = this.expectIdent("parameter name");
        if (pname === null) { this.sync([")"]); break; }
        params.push({ type: ptype, name: pname });
        if (this.isSym(",")) { this.next(); continue; }
        break;
      }
    }
    this.expectSym(")");
    if (this.errors.length > 0) { this.sync(["}"]); return null; }
    if (this.expectSym("{") === null) { this.sync(["}"]); return null; }
    // local var declarations
    const locals: Array<{ type: Type; name: string }> = [];
    while (this.isKw("var")) {
      this.next();
      const ltype = this.parseType(false);
      if (ltype === null) { this.sync([";"]); continue; }
      for (; ;) {
        const lname = this.expectIdent("local variable name");
        if (lname === null) break;
        locals.push({ type: ltype, name: lname });
        if (this.isSym(",")) { this.next(); continue; }
        break;
      }
      this.expectSym(";");
    }
    const body: Stat[] = this.parseStatements();
    if (this.expectSym("}") === null) { this.sync(["}"]); }
    return {
      kind: kindTok.value as SubroutineDec["kind"],
      retType, name: `${this.className}.${name}`, params, locals, body,
      line: kindTok.line,
    };
  }

  private parseStatements(): Stat[] {
    const stats: Stat[] = [];
    for (; ;) {
      if (this.peek() === null) return stats;
      if (this.isSym("}")) return stats;
      if (this.isKw("let")) { const s = this.parseLet(); if (s) stats.push(s); continue; }
      if (this.isKw("if")) { const s = this.parseIf(); if (s) stats.push(s); continue; }
      if (this.isKw("while")) { const s = this.parseWhile(); if (s) stats.push(s); continue; }
      if (this.isKw("do")) { const s = this.parseDo(); if (s) stats.push(s); continue; }
      if (this.isKw("return")) { const s = this.parseReturn(); if (s) stats.push(s); continue; }
      const tok = this.peek();
      this.err(tok?.line ?? 0, `expected statement, got '${tok?.value}'`);
      this.sync([";", "}"]);
      continue;
    }
  }

  private parseLet(): Stat | null {
    const kw = this.next(); // let
    const name = this.expectIdent("variable name");
    if (name === null) { this.sync([";"]); return null; }
    let index: Expr | undefined;
    if (this.isSym("[")) {
      this.next();
      const idx = this.parseExpr();
      if (idx === null) { this.sync([";"]); return null; }
      if (this.expectSym("]") === null) { this.sync([";"]); return null; }
      index = idx;
    }
    if (this.expectSym("=") === null) { this.sync([";"]); return null; }
    const expr = this.parseExpr();
    if (expr === null) { this.sync([";"]); return null; }
    if (this.expectSym(";") === null) { this.sync([";"]); return null; }
    return { kind: "let", name, index, expr, line: kw.line };
  }

  private parseIf(): Stat | null {
    const kw = this.next();
    if (this.expectSym("(") === null) { this.sync(["}", ";"]); return null; }
    const cond = this.parseExpr();
    if (cond === null) { this.sync(["}", ";"]); return null; }
    if (this.expectSym(")") === null) { this.sync(["}", ";"]); return null; }
    if (this.expectSym("{") === null) { this.sync(["}", ";"]); return null; }
    const then = this.parseStatements();
    this.expectSym("}");
    let elseBlock: Stat[] | undefined;
    if (this.isKw("else")) {
      this.next();
      if (this.expectSym("{") === null) { this.sync(["}"]); return null; }
      elseBlock = this.parseStatements();
      this.expectSym("}");
    }
    return { kind: "if", cond, then, else: elseBlock, line: kw.line };
  }

  private parseWhile(): Stat | null {
    const kw = this.next();
    if (this.expectSym("(") === null) { this.sync(["}", ";"]); return null; }
    const cond = this.parseExpr();
    if (cond === null) { this.sync(["}", ";"]); return null; }
    if (this.expectSym(")") === null) { this.sync(["}", ";"]); return null; }
    if (this.expectSym("{") === null) { this.sync(["}", ";"]); return null; }
    const body = this.parseStatements();
    this.expectSym("}");
    return { kind: "while", cond, body, line: kw.line };
  }

  private parseDo(): Stat | null {
    const kw = this.next(); // do
    const call = this.parseCallExpr(true);
    if (call === null) { this.sync([";"]); return null; }
    if (this.expectSym(";") === null) { this.sync([";"]); return null; }
    return { kind: "do", call: call as Extract<Expr, { kind: "call" }>, line: kw.line };
  }

  private parseReturn(): Stat | null {
    const kw = this.next();
    let expr: Expr | undefined;
    if (!this.isSym(";")) {
      const e = this.parseExpr();
      if (e === null) { this.sync([";"]); return null; }
      expr = e;
    }
    if (this.expectSym(";") === null) { this.sync([";"]); return null; }
    return { kind: "return", expr, line: kw.line };
  }

  // ---- expressions ----

  parseExpr(): Expr | null {
    let left = this.parseBinary(0);
    return left;
  }

  private static readonly OPS: string[][] = [
    ["|"], ["&"], ["=", "<", ">"], ["+", "-"], ["*", "/"],
  ];

  private parseBinary(level: number): Expr | null {
    if (level >= Parser.OPS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    if (left === null) return null;
    const opsHere = Parser.OPS[level];
    // '=' '<' '>' are non-associative (single comparison), others left-assoc chains
    const nonAssoc = level === 2;
    while (this.peek() !== null && this.peek()!.type === "symbol" && opsHere.includes(this.peek()!.value)) {
      const opTok = this.next();
      const right = this.parseBinary(level + 1);
      if (right === null) return null;
      left = { kind: "binary", op: opTok.value as "+" | "-" | "*" | "/" | "=" | "<" | ">" | "&" | "|", left, right, line: opTok.line };
      if (nonAssoc) break;
    }
    return left;
  }

  private parseUnary(): Expr | null {
    const tok = this.peek();
    if (tok !== null && tok.type === "symbol" && (tok.value === "-" || tok.value === "~")) {
      this.next();
      const inner = this.parseUnary();
      if (inner === null) return null;
      return { kind: "unary", op: tok.value as "-" | "~", expr: inner, line: tok.line };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr | null {
    const tok = this.peek();
    if (tok === null) { this.err(0, "expected expression, got end of file"); return null; }
    if (tok.type === "intConst") {
      this.next();
      return { kind: "int", value: parseInt(tok.value, 10), line: tok.line };
    }
    if (tok.type === "stringConst") {
      this.next();
      return { kind: "str", value: tok.value, line: tok.line };
    }
    if (tok.type === "keyword") {
      if (tok.value === "true") { this.next(); return { kind: "true", line: tok.line }; }
      if (tok.value === "false") { this.next(); return { kind: "false", line: tok.line }; }
      if (tok.value === "null") { this.next(); return { kind: "null", line: tok.line }; }
      if (tok.value === "this") {
        this.next();
        // this.method(args) suffix
        if (this.isSym(".")) {
          this.next();
          const member = this.expectIdent("subroutine name");
          if (member === null) { this.sync([";"]); return null; }
          if (this.expectSym("(") === null) { this.sync([";"]); return null; }
          const args = this.parseArgs();
          if (args === null) return null;
          return { kind: "call", target: "this", name: member, args, line: tok.line };
        }
        return { kind: "this", line: tok.line };
      }
      this.err(tok.line, `unexpected keyword in expression: '${tok.value}'`);
      this.next();
      return null;
    }
    if (tok.type === "symbol" && tok.value === "(") {
      this.next();
      const e = this.parseExpr();
      if (e === null) return null;
      if (this.expectSym(")") === null) return null;
      return e;
    }
    if (tok.type === "identifier") {
      return this.parseCallExpr(false);
    }
    this.err(tok.line, `expected expression, got '${tok.value}'`);
    this.next();
    return null;
  }

  /** name | name[expr] | name(args) | name.name(args) — ambiguity resolved by lookahead. */
  private parseCallExpr(asCallOnly: boolean): Expr | null {
    const nameTok = this.next(); // identifier
    // var[expr]
    if (!asCallOnly && this.isSym("[")) {
      this.next();
      const idx = this.parseExpr();
      if (idx === null) { this.sync(["]"]); return null; }
      if (this.expectSym("]") === null) { this.sync([";"]); return null; }
      return { kind: "var", name: nameTok.value, index: idx, line: nameTok.line };
    }
    // direct call: name(args)
    if (this.isSym("(")) {
      this.next();
      const args = this.parseArgs();
      if (args === null) return null;
      return { kind: "call", name: nameTok.value, args, line: nameTok.line };
    }
    // name.name(args): target may be class or object
    if (this.isSym(".")) {
      this.next();
      const member = this.expectIdent("subroutine name");
      if (member === null) { this.sync([";"]); return null; }
      if (this.expectSym("(") === null) { this.sync([";"]); return null; }
      const args = this.parseArgs();
      if (args === null) return null;
      return { kind: "call", target: nameTok.value, name: member, args, line: nameTok.line };
    }
    if (asCallOnly) {
      this.err(nameTok.line, `expected subroutine call after '${nameTok.value}'`);
      return null;
    }
    return { kind: "var", name: nameTok.value, line: nameTok.line };
  }

  private parseArgs(): Expr[] | null {
    // '(' already consumed
    const args: Expr[] = [];
    if (this.isSym(")")) { this.next(); return args; }
    for (; ;) {
      const e = this.parseExpr();
      if (e === null) { this.sync([")"]); return null; }
      args.push(e);
      if (this.isSym(",")) { this.next(); continue; }
      break;
    }
    if (this.expectSym(")") === null) { this.sync([")"]); return null; }
    return args;
  }
}

export function parseJack(src: string): ParseResult {
  const { tokens, errors } = tokenize(src);
  if (errors.length > 0) return { cls: null, errors };
  const p = new Parser(tokens, errors);
  const cls = p.parseClass();
  return { cls, errors };
}

export interface UnitsResult {
  classes: ClassDecl[];
  errors: Array<{ line: number; msg: string }>;
}

/** Parse all classes in one source unit (multiple classes per file allowed). */
export function parseJackUnits(src: string): UnitsResult {
  const { tokens, errors } = tokenize(src);
  if (errors.length > 0) return { classes: [], errors };
  const p = new Parser(tokens, errors);
  const classes: ClassDecl[] = [];
  while (p.hasMoreTokens()) {
    const cls = p.parseClass();
    if (cls === null) break;
    classes.push(cls);
  }
  return { classes, errors };
}
