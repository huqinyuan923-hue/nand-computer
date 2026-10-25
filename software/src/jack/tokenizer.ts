/**
 * Jack tokenizer: keyword / symbol / integerConstant / stringConstant / identifier.
 * Comments: "//" line comments and slash-star block comments (non-nesting).
 */

export type TokenType = "keyword" | "symbol" | "intConst" | "stringConst" | "identifier";

export interface Token {
  type: TokenType;
  value: string; // for stringConst: the raw contents without quotes
  line: number;
}

export const KEYWORDS = new Set([
  "class", "constructor", "function", "method", "field", "static", "var",
  "int", "char", "boolean", "void", "true", "false", "null", "this",
  "if", "else", "while", "return", "let", "do",
]);

export const SYMBOLS = new Set([
  "{", "}", "(", ")", "[", "]", ".", ",", ";",
  "+", "-", "*", "/", "&", "|", "<", ">", "=", "~",
]);

export interface TokenizeResult {
  tokens: Token[];
  errors: Array<{ line: number; msg: string }>;
}

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  const errors: Array<{ line: number; msg: string }> = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  const isDigit = (c: string): boolean => c >= "0" && c <= "9";
  const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
  const isIdentPart = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    // comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const startLine = line;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      if (i >= n) errors.push({ line: startLine, msg: "unterminated block comment" });
      else i += 2;
      continue;
    }
    if (c === '"') {
      const startLine = line;
      i++;
      let s = "";
      while (i < n && src[i] !== '"' && src[i] !== "\n") {
        s += src[i];
        i++;
      }
      if (i >= n || src[i] === "\n") {
        errors.push({ line: startLine, msg: `unterminated string constant: "${s}` });
        if (i < n) continue; // stop at newline (line counter already advanced at next pass)
        continue;
      }
      i++; // closing quote
      tokens.push({ type: "stringConst", value: s, line: startLine });
      continue;
    }
    if (isDigit(c)) {
      let s = "";
      while (i < n && isDigit(src[i])) { s += src[i]; i++; }
      const v = parseInt(s, 10);
      if (v > 32767) errors.push({ line, msg: `integer constant out of range: ${s}` });
      tokens.push({ type: "intConst", value: s, line });
      continue;
    }
    if (isIdentStart(c)) {
      let s = "";
      while (i < n && isIdentPart(src[i])) { s += src[i]; i++; }
      if (KEYWORDS.has(s)) tokens.push({ type: "keyword", value: s, line });
      else tokens.push({ type: "identifier", value: s, line });
      continue;
    }
    if (SYMBOLS.has(c)) {
      tokens.push({ type: "symbol", value: c, line });
      i++;
      continue;
    }
    errors.push({ line, msg: `unexpected character: ${JSON.stringify(c)}` });
    i++;
  }
  return { tokens, errors };
}
