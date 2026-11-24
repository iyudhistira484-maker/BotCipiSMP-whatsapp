const crypto = require('crypto');
const vm = require('vm');
const zlib = require('zlib');

const JS_KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
  'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'static',
]);

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'throw', 'case', 'typeof', 'void', 'delete', 'in', 'of',
  'instanceof', 'new', 'yield', 'await', 'else', 'do',
]);

const REGEX_PRECEDING_PUNCTS = new Set([
  '(', '[', '{', ',', ';', ':', '?', '=', '==', '===', '!=', '!==',
  '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '**', '&&', '||', '??',
  '!', '~', '&', '|', '^', '<<', '>>', '>>>',
  '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=',
  '&=', '|=', '^=', '<<=', '>>=', '>>>=', '=>', '...',
]);

const MULTI_PUNCTS = [
  '>>>=', '===', '!==', '**=', '<<=', '>>=', '&&=', '||=', '??=', '...',
  '>>>', '=>', '?.', '??', '&&', '||', '==', '!=', '<=', '>=', '++', '--',
  '**', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
];

const FORBIDDEN_SANDBOX_IDENTS = new Set([
  'process', 'require', 'global', 'globalThis', 'Function', 'eval',
  'constructor', '__proto__', 'prototype', 'Reflect', 'Proxy',
  'child_process', 'fs', 'net', 'http', 'https', 'fetch', 'WebSocket',
  'Buffer', 'module', 'exports', 'import', 'Deno', 'Bun',
]);

const VALID_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Cek apakah kode valid sebagai sintaks JavaScript (tanpa mengeksekusinya!)
 */
function verifyJsSyntax(code = '') {
  const clean = String(code || '').replace(/^#![^\r\n]*/, '');
  if (!clean.trim()) return false;
  try {
    new vm.Script(clean, { filename: 'syntax-check.js' });
    return true;
  } catch {
    // Coba bungkus async function untuk top-level await sederhana
    try {
      new vm.Script(`(async () => {\n${clean}\n})`, { filename: 'syntax-check-async.js' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Deteksi apakah teks kemungkinan besar adalah kode script JavaScript/TypeScript
 */
function looksLikeJavaScript(input = '', fileName = '') {
  if (/\.(?:m?js|cjs|ts|jsx|tsx)$/i.test(String(fileName || ''))) {
    return true;
  }
  const s = String(input || '').trim();
  if (!s || s.length < 8) return false;
  if (/^(?:const|let|var|function|async\s+function|class|import\s|export\s|module\.exports|exports\.|\(function\s*\(|eval\s*\(|#!\/)/.test(s)) {
    return true;
  }
  let score = 0;
  if (/\b(?:const|let|var|function|return|require|async|await|module\.exports|console\.)\b/.test(s)) score += 2;
  if (/_0x[0-9a-fA-F]{2,}/.test(s)) score += 3;
  if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/.test(s)) score += 4;
  if (/String\.fromCharCode|Buffer\.from\s*\(/.test(s)) score += 2;
  if (/[{};()]/.test(s) && /[=.]/.test(s)) score += 1;
  return score >= 3;
}

/**
 * Decode isi literal string JS ('...' atau "...") menjadi nilai string murni
 */
function decodeJsStringLiteral(rawLiteral = '') {
  const quote = rawLiteral[0];
  if (quote !== "'" && quote !== '"') return rawLiteral;
  const inner = rawLiteral.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= inner.length) break;
    const esc = inner[i];
    switch (esc) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\\': out += '\\'; break;
      case "'": out += "'"; break;
      case '"': out += '"'; break;
      case '\n': break;
      case '\r':
        if (inner[i + 1] === '\n') i += 1;
        break;
      case 'x': {
        const hex = inner.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += 'x';
        }
        break;
      }
      case 'u': {
        if (inner[i + 1] === '{') {
          const endBrace = inner.indexOf('}', i + 2);
          if (endBrace !== -1) {
            const codeHex = inner.slice(i + 2, endBrace);
            if (/^[0-9a-fA-F]+$/.test(codeHex)) {
              out += String.fromCodePoint(parseInt(codeHex, 16));
              i = endBrace;
              break;
            }
          }
        }
        const uHex = inner.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(uHex)) {
          out += String.fromCharCode(parseInt(uHex, 16));
          i += 4;
        } else {
          out += 'u';
        }
        break;
      }
      default:
        out += esc;
    }
  }
  return out;
}

/**
 * Encode nilai string murni kembali ke literal string JS yang bersih dan mudah dibaca
 */
function encodeJsStringLiteral(value = '', preferredQuote = "'") {
  const s = String(value);
  const quote = preferredQuote === '"' ? '"' : "'";
  let out = quote;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 32 || code === 127 || code === 0x2028 || code === 0x2029) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  out += quote;
  return out;
}

function canRegexFollow(prevSig, parenClosesCondition = false) {
  if (!prevSig) return true;
  if (prevSig.type === 'ident') {
    return REGEX_PRECEDING_KEYWORDS.has(prevSig.value);
  }
  if (prevSig.type === 'punct') {
    if (prevSig.value === ')') return Boolean(parenClosesCondition);
    return REGEX_PRECEDING_PUNCTS.has(prevSig.value);
  }
  return false;
}

/**
 * Tokenizer JavaScript lengkap (mendukung string, template literal bersarang, regex vs divisi, komentar)
 */
function tokenizeJs(source = '') {
  const src = String(source || '');
  const len = src.length;
  const tokens = [];
  let i = 0;
  let prevSig = null;
  const parenStack = [];
  let lastParenClosedCond = false;

  if (src.startsWith('#!')) {
    let end = src.indexOf('\n');
    if (end === -1) end = len;
    tokens.push({ type: 'shebang', value: src.slice(0, end) });
    i = end;
  }

  while (i < len) {
    const ch = src[i];

    // 1. Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      const start = i;
      let hasNewline = false;
      while (i < len) {
        const c = src[i];
        if (c === '\n' || c === '\r') hasNewline = true;
        else if (c !== ' ' && c !== '\t' && c !== '\f' && c !== '\v') break;
        i += 1;
      }
      tokens.push({ type: 'ws', value: src.slice(start, i), hasNewline });
      continue;
    }

    // 2. Komentar sebaris //
    if (ch === '/' && src[i + 1] === '/') {
      const start = i;
      i += 2;
      while (i < len && src[i] !== '\n' && src[i] !== '\r') i += 1;
      tokens.push({ type: 'comment', value: src.slice(start, i), multiline: false });
      continue;
    }

    // 3. Komentar blok /* ... */
    if (ch === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = Math.min(len, i + 2);
      tokens.push({ type: 'comment', value: src.slice(start, i), multiline: true });
      continue;
    }

    // 4. String literal '...' atau "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < len) {
        const c = src[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        i += 1;
        if (c === quote) break;
      }
      const tok = { type: 'string', value: src.slice(start, i) };
      tokens.push(tok);
      prevSig = tok;
      lastParenClosedCond = false;
      continue;
    }

    // 5. Template literal `...` (termasuk ekspresi ${ ... } bersarang!)
    if (ch === '`') {
      const start = i;
      i += 1;
      while (i < len) {
        const c = src[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          i += 1;
          break;
        }
        if (c === '$' && src[i + 1] === '{') {
          i += 2;
          let braceDepth = 1;
          while (i < len && braceDepth > 0) {
            const bc = src[i];
            if (bc === '\\') {
              i += 2;
              continue;
            }
            if (bc === "'" || bc === '"' || bc === '`') {
              const q = bc;
              i += 1;
              while (i < len) {
                if (src[i] === '\\') {
                  i += 2;
                  continue;
                }
                if (src[i] === q) {
                  i += 1;
                  break;
                }
                i += 1;
              }
              continue;
            }
            if (bc === '/' && src[i + 1] === '/') {
              while (i < len && src[i] !== '\n') i += 1;
              continue;
            }
            if (bc === '/' && src[i + 1] === '*') {
              i += 2;
              while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
              i += 2;
              continue;
            }
            if (bc === '{') braceDepth += 1;
            else if (bc === '}') braceDepth -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      const tok = { type: 'template', value: src.slice(start, i) };
      tokens.push(tok);
      prevSig = tok;
      lastParenClosedCond = false;
      continue;
    }

    // 6. Regex literal /.../flags
    if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && canRegexFollow(prevSig, lastParenClosedCond)) {
      // Pastikan bukan /= jika sebelumnya bukan ekspresi pembuka regex murni? (/= adalah regex yang diawali =)
      const start = i;
      let j = i + 1;
      let inClass = false;
      let validRegex = false;
      while (j < len) {
        const rc = src[j];
        if (rc === '\n' || rc === '\r') break;
        if (rc === '\\') {
          j += 2;
          continue;
        }
        if (rc === '[') inClass = true;
        else if (rc === ']') inClass = false;
        else if (rc === '/' && !inClass) {
          j += 1;
          while (j < len && /[dgimsuvy]/.test(src[j])) j += 1;
          validRegex = true;
          break;
        }
        j += 1;
      }
      if (validRegex) {
        const tok = { type: 'regex', value: src.slice(start, j) };
        tokens.push(tok);
        prevSig = tok;
        lastParenClosedCond = false;
        i = j;
        continue;
      }
    }

    // 7. Angka (Hex, Binary, Octal, Float, BigInt)
    if (
      (ch >= '0' && ch <= '9') ||
      (ch === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')
    ) {
      const start = i;
      if (ch === '0' && /[xXbBoO]/.test(src[i + 1] || '')) {
        i += 2;
        while (i < len && /[0-9a-fA-F_]/.test(src[i])) i += 1;
      } else {
        while (i < len && /[0-9_]/.test(src[i])) i += 1;
        if (src[i] === '.' && src[i + 1] !== '.') {
          i += 1;
          while (i < len && /[0-9_]/.test(src[i])) i += 1;
        }
        if (/[eE]/.test(src[i] || '')) {
          i += 1;
          if (src[i] === '+' || src[i] === '-') i += 1;
          while (i < len && /[0-9_]/.test(src[i])) i += 1;
        }
      }
      if (src[i] === 'n') i += 1;
      const tok = { type: 'number', value: src.slice(start, i) };
      tokens.push(tok);
      prevSig = tok;
      lastParenClosedCond = false;
      continue;
    }

    // 8. Identifier / Keyword (termasuk unicode escape \uXXXX)
    if (/[A-Za-z_$]/.test(ch) || (ch === '\\' && src[i + 1] === 'u')) {
      const start = i;
      i += 1;
      while (i < len) {
        if (/[A-Za-z0-9_$]/.test(src[i])) {
          i += 1;
        } else if (src[i] === '\\' && src[i + 1] === 'u') {
          i += 2;
        } else if (src.charCodeAt(i) > 127 && /\p{ID_Continue}/u.test(src[i])) {
          i += 1;
        } else {
          break;
        }
      }
      const rawIdent = src.slice(start, i);
      const tok = { type: 'ident', value: rawIdent };
      tokens.push(tok);
      prevSig = tok;
      lastParenClosedCond = false;
      continue;
    }

    // 9. Multi-char & Single-char Punctuator
    let matchedPunct = null;
    for (const mp of MULTI_PUNCTS) {
      if (src.startsWith(mp, i)) {
        matchedPunct = mp;
        break;
      }
    }
    if (!matchedPunct) {
      matchedPunct = ch;
    }
    i += matchedPunct.length;

    if (matchedPunct === '(') {
      const isCond = Boolean(
        prevSig &&
          prevSig.type === 'ident' &&
          (prevSig.value === 'if' || prevSig.value === 'while' || prevSig.value === 'for' || prevSig.value === 'with')
      );
      parenStack.push(isCond);
      lastParenClosedCond = false;
    } else if (matchedPunct === ')') {
      lastParenClosedCond = Boolean(parenStack.pop());
    } else {
      lastParenClosedCond = false;
    }

    const tok = { type: 'punct', value: matchedPunct };
    tokens.push(tok);
    prevSig = tok;
  }

  return tokens;
}

// ============================================================================
// BAGIAN 1: JAVASCRIPT OBFUSCATOR / ENCRYPTOR (.ecode / .encode)
// ============================================================================

function randomHexIdent(prefix = '_0x') {
  return `${prefix}${crypto.randomBytes(2).toString('hex')}`;
}

function xorEncryptToBase64(plainUtf8, xorKeyBytes) {
  const buf = Buffer.from(plainUtf8, 'utf8');
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i += 1) {
    out[i] = buf[i] ^ xorKeyBytes[i % xorKeyBytes.length];
  }
  return out.toString('base64');
}

/**
 * Mode Pack: Enkripsi Zlib + XOR self-runner untuk script Node.js
 */
function packJavaScriptContainer(sourceCode) {
  const cleanShebang = String(sourceCode).replace(/^#![^\r\n]*\r?\n?/, '');
  const compressed = zlib.deflateRawSync(Buffer.from(cleanShebang, 'utf8'), { level: 9 });
  const key = crypto.randomBytes(12);
  const enc = Buffer.allocUnsafe(compressed.length);
  for (let i = 0; i < compressed.length; i += 1) {
    enc[i] = compressed[i] ^ key[i % key.length];
  }
  const b64 = enc.toString('base64');
  const keyHex = [...key].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(',');

  const vPay = randomHexIdent('_0x');
  const vKey = randomHexIdent('_0x');
  const vBuf = randomHexIdent('_0x');
  const vIdx = randomHexIdent('_0x');
  const vSrc = randomHexIdent('_0x');

  return [
    `/* CipiSMP Protected Script */`,
    `(function(exports,require,module,__filename,__dirname){`,
    `const ${vPay}='${b64}',${vKey}=[${keyHex}],${vBuf}=Buffer.from(${vPay},'base64');`,
    `for(let ${vIdx}=0;${vIdx}<${vBuf}.length;${vIdx}++)${vBuf}[${vIdx}]^=${vKey}[${vIdx}%${vKey}.length];`,
    `const ${vSrc}=require('zlib').inflateRawSync(${vBuf}).toString('utf8');`,
    `return new Function('exports','require','module','__filename','__dirname',${vSrc})(exports,require,module,__filename,__dirname);`,
    `})(typeof exports!=='undefined'?exports:{},typeof require!=='undefined'?require:()=>{},typeof module!=='undefined'?module:{exports:{}},typeof __filename!=='undefined'?__filename:'',typeof __dirname!=='undefined'?__dirname:'');`,
  ].join('');
}

/**
 * Obfuscate kode JavaScript (_0x String Table + Rotasi + XOR Decoder + Property Obfuscation + Hex Math)
 */
function obfuscateJavaScript(sourceCode = '', options = {}) {
  const raw = String(sourceCode || '');
  if (!raw.trim()) {
    throw new Error('Kode script yang ingin di-encode masih kosong.');
  }
  if (!verifyJsSyntax(raw)) {
    throw new Error('Sintaks JavaScript tidak valid (ada kurung/kutip yang belum ditutup). Perbaiki error syntax sebelum di-encode.');
  }

  const mode = String(options.mode || 'hard').toLowerCase();
  if (mode === 'pack' || mode === 'eval') {
    const packed = packJavaScriptContainer(raw);
    return {
      format: 'JS Packed Container (Zlib + XOR)',
      code: packed,
      syntaxValid: verifyJsSyntax(packed),
    };
  }

  const allTokens = tokenizeJs(raw);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  const sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');

  // Kumpulkan tabel string terenkripsi XOR + Base64 murni (tanpa butuh Buffer agar jalan di Node & Browser!)
  const xorKey = crypto.randomBytes(6);
  const baseOffset = 0x110 + (crypto.randomBytes(1)[0] % 0x90);
  const poolIndexMap = new Map();
  const poolEncrypted = [];

  const registerString = (plainVal) => {
    if (poolIndexMap.has(plainVal)) {
      return poolIndexMap.get(plainVal);
    }
    const idx = poolEncrypted.length;
    poolEncrypted.push(xorEncryptToBase64(plainVal, xorKey));
    poolIndexMap.set(plainVal, idx);
    return idx;
  };

  const fnArr = randomHexIdent('_0x');
  const fnDec = randomHexIdent('_0x');
  const fnAlias = randomHexIdent('_0x');

  const outParts = [];
  const needSpaceBetween = (prevStr, nextStr) => {
    if (!prevStr || !nextStr) return false;
    const a = prevStr[prevStr.length - 1];
    const b = nextStr[0];
    if (/[A-Za-z0-9_$]/.test(a) && /[A-Za-z0-9_$]/.test(b)) return true;
    if ((a === '+' && b === '+') || (a === '-' && b === '-')) return true;
    if (a === '/' && (b === '/' || b === '*')) return true;
    return false;
  };

  let lastEmitted = '';
  const emit = (piece, forceNewlineBefore = false) => {
    if (forceNewlineBefore && outParts.length > 0 && !lastEmitted.endsWith('\n')) {
      outParts.push('\n');
      lastEmitted = '\n';
    } else if (needSpaceBetween(lastEmitted, piece)) {
      outParts.push(' ');
    }
    outParts.push(piece);
    lastEmitted = piece;
  };

  // Lacak apakah baris asli punya newline sebelum token signifikan (penting untuk ASI!)
  const sigHasNewlineBefore = new Array(sig.length).fill(false);
  {
    let sIdx = 0;
    let sawNl = false;
    for (const t of allTokens) {
      if (t.type === 'shebang') continue;
      if (t.type === 'ws') {
        if (t.hasNewline) sawNl = true;
        continue;
      }
      if (t.type === 'comment') {
        if (t.multiline && /[\r\n]/.test(t.value)) sawNl = true;
        continue;
      }
      sigHasNewlineBefore[sIdx] = sawNl;
      sawNl = false;
      sIdx += 1;
    }
  }

  for (let idx = 0; idx < sig.length; idx += 1) {
    const tok = sig[idx];
    const prev = idx > 0 ? sig[idx - 1] : null;
    const next = idx + 1 < sig.length ? sig[idx + 1] : null;
    const nlBefore = sigHasNewlineBefore[idx];

    // 1. Obfuscate dot property access: obj.prop -> obj[_0xdec(0x...)]
    if (
      mode === 'hard' &&
      tok.type === 'punct' &&
      tok.value === '.' &&
      prev &&
      !(prev.type === 'ident' && (prev.value === 'new' || prev.value === 'import' || prev.value === 'super')) &&
      next &&
      next.type === 'ident' &&
      VALID_IDENT_RE.test(next.value)
    ) {
      const strIdx = registerString(next.value);
      const hexArg = `0x${(baseOffset + strIdx).toString(16)}`;
      emit(`[${fnAlias}(${hexArg})]`, false);
      idx += 1; // lewati ident properti
      continue;
    }

    // 2. Obfuscate string literal
    if (tok.type === 'string') {
      const decodedVal = decodeJsStringLiteral(tok.value);
      const isDirective = decodedVal === 'use strict' && (!prev || prev.value === '{' || prev.value === ';');
      const isModuleSpec =
        Boolean(prev && prev.type === 'ident' && (prev.value === 'from' || prev.value === 'import'));

      if (!isDirective && !isModuleSpec && decodedVal.length <= 400) {
        const strIdx = registerString(decodedVal);
        const hexArg = `0x${(baseOffset + strIdx).toString(16)}`;
        const callExpr = `${fnAlias}(${hexArg})`;

        // Jika string menjadi key object/class ({ "key": 1 } atau { "key"() {} }), bungkus sebagai computed [ _0x(...) ]
        const isPropKey =
          Boolean(next && (next.value === ':' || next.value === '(')) &&
          Boolean(
            prev &&
              (prev.value === '{' ||
                prev.value === ',' ||
                prev.value === ';' ||
                prev.value === '}' ||
                (prev.type === 'ident' && ['async', 'static', 'get', 'set'].includes(prev.value)))
          ) &&
          !(prev && prev.type === 'ident' && prev.value === 'case');

        emit(isPropKey ? `[${callExpr}]` : callExpr, nlBefore);
        continue;
      }
    }

    // 3. Obfuscate boolean true/false
    if (
      tok.type === 'ident' &&
      (tok.value === 'true' || tok.value === 'false') &&
      !(prev && prev.value === '.') &&
      !(next && (next.value === ':' || next.value === '('))
    ) {
      emit(tok.value === 'true' ? '!![]' : '![]', nlBefore);
      continue;
    }

    // 4. Obfuscate angka bulat desimal kecil-menengah menjadi ekspresi XOR hex
    if (
      mode === 'hard' &&
      tok.type === 'number' &&
      /^(?:0|[1-9][0-9]{0,5})$/.test(tok.value) &&
      !(prev && prev.value === '.') &&
      !(next && (next.value === ':' || next.value === '.'))
    ) {
      const numVal = Number(tok.value);
      const mask = 0x100 + (crypto.randomBytes(2).readUInt16BE(0) & 0x7eff);
      const xored = (numVal ^ mask) >>> 0;
      emit(`(0x${xored.toString(16)}^0x${mask.toString(16)})`, nlBefore);
      continue;
    }

    emit(tok.value, nlBefore);
  }

  // Bangun stub dekoder murni (tanpa ketergantungan global Buffer, jalan di Node & Browser)
  const rotShift = poolEncrypted.length > 1 ? 1 + (crypto.randomBytes(1)[0] % (poolEncrypted.length - 1)) : 0;
  const rotatedPool =
    rotShift > 0
      ? [...poolEncrypted.slice(poolEncrypted.length - rotShift), ...poolEncrypted.slice(0, poolEncrypted.length - rotShift)]
      : poolEncrypted;

  const keyNums = [...xorKey].map((b) => `0x${b.toString(16)}`).join(',');
  const poolLiterals = rotatedPool.map((s) => `'${s}'`).join(',');

  const headerStub =
    poolEncrypted.length > 0
      ? [
          `function ${fnArr}(){const _p=[${poolLiterals}];${fnArr}=function(){return _p;};return ${fnArr}();}`,
          rotShift > 0
            ? `(function(_a,_n){const _t=_a();for(let _i=0;_i<_n;_i++)_t.push(_t.shift());})(${fnArr},0x${rotShift.toString(16)});`
            : '',
          `function ${fnDec}(_i){_i=_i-0x${baseOffset.toString(16)};const _t=${fnArr}();if(!${fnDec}._c)${fnDec}._c={};if(${fnDec}._c[_i]!==undefined)return ${fnDec}._c[_i];const _s=_t[_i],_k=[${keyNums}],_m='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';let _b=[],_p=0;while(_p<_s.length){const _c1=_m.indexOf(_s[_p++]),_c2=_m.indexOf(_s[_p++]),_c3=_m.indexOf(_s[_p++]),_c4=_m.indexOf(_s[_p++]);_b.push((_c1<<2)|(_c2>>4));if(_c3!==64&&_c3!==-1)_b.push(((_c2&15)<<4)|(_c3>>2));if(_c4!==64&&_c4!==-1)_b.push(((_c3&3)<<6)|_c4);}const _u=new Uint8Array(_b.length);for(let _j=0;_j<_b.length;_j++)_u[_j]=_b[_j]^_k[_j%_k.length];const _r=new TextDecoder('utf-8').decode(_u);${fnDec}._c[_i]=_r;return _r;}`,
          `const ${fnAlias}=${fnDec};`,
        ]
          .filter(Boolean)
          .join('')
      : '';

  const combined = `${shebang}${headerStub}${outParts.join('')}`;
  if (verifyJsSyntax(combined)) {
    return {
      format: 'JS Obfuscator (_0x + Rotated XOR)',
      code: combined,
      stringsEncrypted: poolEncrypted.length,
      syntaxValid: true,
    };
  }

  // Fallback aman 100% bila ada konstruksi sintaks khusus
  const fallback = packJavaScriptContainer(raw);
  return {
    format: 'JS Packed Container (Zlib + XOR)',
    code: fallback,
    stringsEncrypted: 0,
    syntaxValid: verifyJsSyntax(fallback),
  };
}

// ============================================================================
// BAGIAN 2: JAVASCRIPT DEOBFUSCATOR & BEAUTIFIER (.dcode / .decode)
// ============================================================================

/**
 * Unpack Dean Edwards P.A.C.K.E.R: eval(function(p,a,c,k,e,d){...}('payload',62,count,'dict'.split('|'),0,{}))
 */
function tryUnpackDeanEdwards(code = '') {
  const trimmed = String(code || '').trim();
  const marker = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{/;
  if (!marker.test(trimmed)) return null;

  const argsMatch = trimmed.match(
    /\}\s*\(\s*(['"`][\s\S]*?['"`])\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"`][\s\S]*?['"`])\.split\s*\(\s*['"]\|['"]\s*\)/
  );
  if (!argsMatch) return null;

  const payload = decodeJsStringLiteral(argsMatch[1]);
  const radix = Number(argsMatch[2]);
  let count = Number(argsMatch[3]);
  const symtab = decodeJsStringLiteral(argsMatch[4]).split('|');
  if (!radix || radix < 2 || radix > 62 || count > 50000) return null;

  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const encodeBase = (num) => {
    const first = num < radix ? '' : encodeBase(Math.floor(num / radix));
    const rem = num % radix;
    const ch = rem > 35 ? String.fromCharCode(rem + 29) : alphabet[rem] || rem.toString(36);
    return first + ch;
  };

  const dict = new Map();
  while (count > 0) {
    count -= 1;
    const key = encodeBase(count);
    dict.set(key, symtab[count] || key);
  }

  return payload.replace(/\b\w+\b/g, (word) => (dict.has(word) ? dict.get(word) : word));
}

/**
 * Unpack CipiSMP / Node.js Zlib + XOR / Buffer.from Base64/Hex container tanpa mengeksekusi kode berbahaya
 */
function tryUnpackContainerLayers(code = '') {
  const s = String(code || '').trim();

  // 1. Container Zlib + XOR (seperti packJavaScriptContainer)
  const zlibXorMatch = s.match(
    /const\s+([A-Za-z0-9_$]+)\s*=\s*['"]([A-Za-z0-9+/=]+)['"]\s*,\s*([A-Za-z0-9_$]+)\s*=\s*\[([0-9xXa-fA-F,\s]+)\][\s\S]{0,260}?inflateRawSync/
  );
  if (zlibXorMatch) {
    try {
      const buf = Buffer.from(zlibXorMatch[2], 'base64');
      const key = zlibXorMatch[4]
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n));
      if (key.length > 0) {
        for (let i = 0; i < buf.length; i += 1) {
          buf[i] ^= key[i % key.length];
        }
        return zlib.inflateRawSync(buf).toString('utf8');
      }
    } catch {
      // Lanjut pola lain
    }
  }

  // 2. eval(Buffer.from('...', 'base64' | 'hex').toString(...)) atau Function(...)(...)
  const bufEvalMatch = s.match(
    /^(?:eval|Function|new\s+Function|vm\.runInThisContext)\s*\(\s*Buffer\.from\s*\(\s*(['"][A-Za-z0-9+/=\s]+['"])\s*,\s*['"](base64|hex)['"]\s*\)\.toString\s*\([^)]*\)\s*\)\s*(?:\([^)]*\))?\s*;?$/
  );
  if (bufEvalMatch) {
    try {
      const innerRaw = decodeJsStringLiteral(bufEvalMatch[1]).replace(/\s+/g, '');
      return Buffer.from(innerRaw, bufEvalMatch[2]).toString('utf8');
    } catch {
      // Lanjut
    }
  }

  // 3. eval(atob('...')) / eval(unescape('...')) / eval(decodeURIComponent('...'))
  const webEvalMatch = s.match(
    /^eval\s*\(\s*(atob|unescape|decodeURIComponent)\s*\(\s*(['"][\s\S]+['"])\s*\)\s*\)\s*;?$/
  );
  if (webEvalMatch) {
    try {
      const fn = webEvalMatch[1];
      const arg = decodeJsStringLiteral(webEvalMatch[2]);
      if (fn === 'atob') return Buffer.from(arg, 'base64').toString('utf8');
      if (fn === 'decodeURIComponent') return decodeURIComponent(arg);
      if (fn === 'unescape') {
        return arg.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (_, u4, h2) =>
          String.fromCharCode(parseInt(u4 || h2, 16))
        );
      }
    } catch {
      // Lanjut
    }
  }

  // 4. eval(String.fromCharCode(104, 101, ...))
  const charCodeEval = s.match(
    /^eval\s*\(\s*String\.fromCharCode\s*\(\s*([0-9xXa-fA-F,\s]+)\s*\)\s*\)\s*;?$/
  );
  if (charCodeEval) {
    const nums = charCodeEval[1]
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 0x10ffff);
    if (nums.length > 0) {
      return nums.map((n) => String.fromCodePoint(n)).join('');
    }
  }

  return null;
}

/**
 * Ekstrak blok pernyataan tingkat atas (top-level statements) dari daftar token signifikan
 */
function splitTopLevelStatements(sigTokens) {
  const stmts = [];
  let start = 0;
  let brace = 0;
  let paren = 0;
  let bracket = 0;

  for (let i = 0; i < sigTokens.length; i += 1) {
    const t = sigTokens[i];
    if (t.type === 'punct') {
      if (t.value === '{') brace += 1;
      else if (t.value === '}') {
        brace = Math.max(0, brace - 1);
        if (brace === 0 && paren === 0 && bracket === 0) {
          // Cek apakah ini akhir deklarasi function top-level atau IIFE diikuti ';'
          const first = sigTokens[start];
          if (first && first.type === 'ident' && first.value === 'function') {
            let end = i + 1;
            if (sigTokens[end]?.value === ';') end += 1;
            stmts.push({ start, end });
            start = end;
            i = end - 1;
            continue;
          }
        }
      } else if (t.value === '(') paren += 1;
      else if (t.value === ')') paren = Math.max(0, paren - 1);
      else if (t.value === '[') bracket += 1;
      else if (t.value === ']') bracket = Math.max(0, bracket - 1);
      else if (t.value === ';' && brace === 0 && paren === 0 && bracket === 0) {
        stmts.push({ start, end: i + 1 });
        start = i + 1;
      }
    }
  }
  if (start < sigTokens.length) {
    stmts.push({ start, end: sigTokens.length });
  }
  return stmts;
}

function reconstructFromSigSlice(sigTokens, start, end) {
  let out = '';
  for (let i = start; i < end; i += 1) {
    const val = sigTokens[i].value;
    if (
      out &&
      /[A-Za-z0-9_$]/.test(out[out.length - 1]) &&
      /[A-Za-z0-9_$]/.test(val[0])
    ) {
      out += ' ';
    }
    out += val;
  }
  return out;
}

function isSafeStringTableStmt(sigTokens, start, end) {
  for (let i = start; i < end; i += 1) {
    const t = sigTokens[i];
    if (t.type === 'ident' && FORBIDDEN_SANDBOX_IDENTS.has(t.value)) {
      return false;
    }
  }
  return true;
}

/**
 * Resolusi tabel string _0x (javascript-obfuscator v1-v4 & CipiSMP obfuscator) di sandbox terisolasi ketat
 */
function resolveObfuscatorStringTable(code = '') {
  const allTokens = tokenizeJs(code);
  const sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');
  if (sig.length < 8) return { code, restoredCount: 0 };

  const stmts = splitTopLevelStatements(sig);
  if (stmts.length < 2) return { code, restoredCount: 0 };

  // Deteksi pernyataan preamble tabel string (array besar / fungsi array + rotator IIFE + fungsi dekoder)
  const preambleIndices = [];
  const declaredFuncsAndVars = new Set();
  const decoderCandidates = new Set();

  for (let sIdx = 0; sIdx < Math.min(stmts.length, 6); sIdx += 1) {
    const st = stmts[sIdx];
    const slice = sig.slice(st.start, st.end);
    if (!isSafeStringTableStmt(sig, st.start, st.end)) break;

    const stmtCode = reconstructFromSigSlice(sig, st.start, st.end);

    // Pola 1: function _0x...() { const _ = ['...', ...]; ... } ATAU function _0xdec(_a, _b) yang memanggil fungsi array di atas
    if (
      slice[0]?.value === 'function' &&
      slice[1]?.type === 'ident' &&
      (slice.some((t) => t.type === 'string') ||
        [...declaredFuncsAndVars].some((fn) => stmtCode.includes(fn)))
    ) {
      const fnName = slice[1].value;
      const hasParams = slice[2]?.value === '(' && slice[3]?.type === 'ident';
      preambleIndices.push(sIdx);
      declaredFuncsAndVars.add(fnName);
      if (hasParams) decoderCandidates.add(fnName);
      continue;
    }

    // Pola 2: var/let/const _0x... = ['...', ...]
    if (
      ['var', 'let', 'const'].includes(slice[0]?.value) &&
      slice[1]?.type === 'ident' &&
      slice[2]?.value === '=' &&
      slice[3]?.value === '['
    ) {
      preambleIndices.push(sIdx);
      declaredFuncsAndVars.add(slice[1].value);
      continue;
    }

    // Pola 3: Rotator IIFE (function(_a, _b) { ... })(_0xArr, 0x...)
    if (
      slice[0]?.value === '(' &&
      slice[1]?.value === 'function' &&
      [...declaredFuncsAndVars].some((fn) => stmtCode.includes(fn))
    ) {
      preambleIndices.push(sIdx);
      continue;
    }

    // Pola 4: var/const _0xdec = function(_a, _b) { ... } yang merujuk ke array di atas
    if (
      ['var', 'let', 'const'].includes(slice[0]?.value) &&
      slice[1]?.type === 'ident' &&
      slice[2]?.value === '=' &&
      slice[3]?.value === 'function' &&
      [...declaredFuncsAndVars].some((fn) => stmtCode.includes(fn))
    ) {
      preambleIndices.push(sIdx);
      declaredFuncsAndVars.add(slice[1].value);
      decoderCandidates.add(slice[1].value);
      continue;
    }

    // Pola 5: Alias tingkat atas const _0xalias = _0xdec;
    if (
      ['var', 'let', 'const'].includes(slice[0]?.value) &&
      slice[1]?.type === 'ident' &&
      slice[2]?.value === '=' &&
      slice[3]?.type === 'ident' &&
      decoderCandidates.has(slice[3].value) &&
      slice.length <= 5
    ) {
      preambleIndices.push(sIdx);
      decoderCandidates.add(slice[1].value);
      continue;
    }

    break;
  }

  if (decoderCandidates.size === 0 || preambleIndices.length === 0) {
    return { code, restoredCount: 0 };
  }

  const preambleEndTokenIdx = stmts[preambleIndices[preambleIndices.length - 1]].end;
  const preambleJs = reconstructFromSigSlice(sig, 0, preambleEndTokenIdx);

  // Jalankan preamble di VM super ketat (codeGeneration.strings=false, tanpa prototype global berbahaya)
  const sandbox = Object.create(null);
  sandbox.Uint8Array = Uint8Array;
  sandbox.TextDecoder = TextDecoder;
  sandbox.parseInt = parseInt;
  sandbox.String = String;
  sandbox.Math = Math;
  sandbox.decodeURIComponent = decodeURIComponent;
  sandbox.atob = (b64) => Buffer.from(String(b64), 'base64').toString('binary');

  const ctx = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  try {
    const exposeCode = [...decoderCandidates]
      .map((name) => `if (typeof ${name} === 'function') __dec_${name} = ${name};`)
      .join('\n');
    new vm.Script(`${preambleJs}\n${exposeCode}`).runInContext(ctx, { timeout: 250 });
  } catch {
    return { code, restoredCount: 0 };
  }

  // Kumpulkan fungsi dekoder yang berhasil diekspos + lacak semua alias lokal (const _0x99 = _0xdec)
  const aliasToDecoder = new Map();
  for (const name of decoderCandidates) {
    if (typeof sandbox[`__dec_${name}`] === 'function') {
      aliasToDecoder.set(name, sandbox[`__dec_${name}`]);
    }
  }
  if (aliasToDecoder.size === 0) {
    return { code, restoredCount: 0 };
  }

  // Scan seluruh body untuk menemukan alias berantai (const a = _0xdec; const b = a;)
  let aliasChanged = true;
  while (aliasChanged) {
    aliasChanged = false;
    for (let i = preambleEndTokenIdx; i + 2 < sig.length; i += 1) {
      if (
        sig[i].type === 'ident' &&
        sig[i + 1].value === '=' &&
        sig[i + 2].type === 'ident' &&
        aliasToDecoder.has(sig[i + 2].value) &&
        !aliasToDecoder.has(sig[i].value)
      ) {
        const after = sig[i + 3];
        if (!after || after.value === ';' || after.value === ',' || after.value === ')') {
          aliasToDecoder.set(sig[i].value, aliasToDecoder.get(sig[i + 2].value));
          aliasChanged = true;
        }
      }
    }
  }

  // Ganti semua pemanggilan _0xdec(arg1 [, arg2]) pada sisa token!
  let restoredCount = 0;
  const bodyOut = [];
  for (let i = preambleEndTokenIdx; i < sig.length; i += 1) {
    const tok = sig[i];

    // Hapus deklarasi alias mati sederhana: const _0xalias = _0xdec;
    if (
      ['const', 'let', 'var'].includes(tok.value) &&
      sig[i + 1]?.type === 'ident' &&
      sig[i + 2]?.value === '=' &&
      sig[i + 3]?.type === 'ident' &&
      aliasToDecoder.has(sig[i + 3].value) &&
      sig[i + 4]?.value === ';'
    ) {
      i += 4;
      continue;
    }

    if (tok.type === 'ident' && aliasToDecoder.has(tok.value) && sig[i + 1]?.value === '(') {
      // Baca argumen literal di dalam (...)
      const args = [];
      let j = i + 2;
      let okArgs = true;
      while (j < sig.length && sig[j].value !== ')') {
        let sign = 1;
        if (sig[j].value === '-' || sig[j].value === '+') {
          sign = sig[j].value === '-' ? -1 : 1;
          j += 1;
        }
        if (sig[j]?.type === 'number' && !sig[j].value.endsWith('n')) {
          args.push(sign * Number(sig[j].value.replace(/_/g, '')));
          j += 1;
        } else if (sig[j]?.type === 'string' && sign === 1) {
          args.push(decodeJsStringLiteral(sig[j].value));
          j += 1;
        } else {
          okArgs = false;
          break;
        }
        if (sig[j]?.value === ',') {
          j += 1;
        } else if (sig[j]?.value !== ')') {
          okArgs = false;
          break;
        }
      }

      if (okArgs && args.length >= 1 && args.length <= 2 && sig[j]?.value === ')') {
        try {
          const decFn = aliasToDecoder.get(tok.value);
          const strVal = decFn(...args);
          if (typeof strVal === 'string') {
            bodyOut.push({ type: 'string', value: encodeJsStringLiteral(strVal, "'") });
            restoredCount += 1;
            i = j;
            continue;
          }
        } catch {
          // Biarkan apa adanya bila gagal pada satu argumen
        }
      }
    }

    bodyOut.push(tok);
  }

  if (restoredCount === 0) {
    return { code, restoredCount: 0 };
  }

  // Cek apakah masih ada referensi tersisa ke fungsi dekoder/array di bodyOut
  const stillReferenced = bodyOut.some(
    (t) => t.type === 'ident' && (aliasToDecoder.has(t.value) || declaredFuncsAndVars.has(t.value))
  );

  const rebuiltBody = reconstructFromSigSlice(bodyOut, 0, bodyOut.length);
  const candidate = stillReferenced ? `${preambleJs}\n${rebuiltBody}` : rebuiltBody;
  if (verifyJsSyntax(candidate)) {
    return { code: candidate, restoredCount };
  }
  return { code: `${preambleJs}\n${rebuiltBody}`, restoredCount };
}

/**
 * Penyederhanaan token obfuscation ("Disempurnakan"):
 * - Unescape \xNN & \uNNNN menjadi teks bersih
 * - String.fromCharCode(...) -> '...'
 * - !![] -> true, ![] -> false
 * - (0x1a ^ 0x10) -> 10, 0x1f4 -> 500
 * - 'con' + 'sole' -> 'console'
 * - console['log'] -> console.log & { ['name']: 'ping' } -> { name: 'ping' }
 */
function simplifyObfuscatedTokens(code = '') {
  const allTokens = tokenizeJs(code);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  let sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');

  // Pass A: Unescape semua string literal & konversi hex integer sederhana
  sig = sig.map((t) => {
    if (t.type === 'string') {
      const plain = decodeJsStringLiteral(t.value);
      return { type: 'string', value: encodeJsStringLiteral(plain, "'") };
    }
    if (t.type === 'number' && /^0[xX][0-9a-fA-F]+$/.test(t.value)) {
      const n = parseInt(t.value.slice(2), 16);
      if (Number.isSafeInteger(n) && n <= 100000000) {
        return { type: 'number', value: String(n) };
      }
    }
    return t;
  });

  // Pass B: Lipat ekspresi konstan (!![], ![], (A ^ B), String.fromCharCode, 'a' + 'b')
  for (let pass = 0; pass < 3; pass += 1) {
    const nextSig = [];
    for (let i = 0; i < sig.length; i += 1) {
      // !![] -> true
      if (
        sig[i]?.value === '!' &&
        sig[i + 1]?.value === '!' &&
        sig[i + 2]?.value === '[' &&
        sig[i + 3]?.value === ']'
      ) {
        nextSig.push({ type: 'ident', value: 'true' });
        i += 3;
        continue;
      }

      // ![] -> false
      if (
        sig[i]?.value === '!' &&
        sig[i + 1]?.value === '[' &&
        sig[i + 2]?.value === ']'
      ) {
        nextSig.push({ type: 'ident', value: 'false' });
        i += 2;
        continue;
      }

      // (angka ^ angka) / (angka + angka) / (angka - angka)
      if (
        sig[i]?.value === '(' &&
        sig[i + 1]?.type === 'number' &&
        ['^', '+', '-'].includes(sig[i + 2]?.value) &&
        sig[i + 3]?.type === 'number' &&
        sig[i + 4]?.value === ')'
      ) {
        const a = Number(sig[i + 1].value);
        const b = Number(sig[i + 3].value);
        const op = sig[i + 2].value;
        if (Number.isSafeInteger(a) && Number.isSafeInteger(b)) {
          const val = op === '^' ? a ^ b : op === '+' ? a + b : a - b;
          if (val >= 0) {
            nextSig.push({ type: 'number', value: String(val) });
            i += 4;
            continue;
          }
        }
      }

      // String.fromCharCode(65, 66, ...)
      if (
        sig[i]?.value === 'String' &&
        sig[i + 1]?.value === '.' &&
        sig[i + 2]?.value === 'fromCharCode' &&
        sig[i + 3]?.value === '('
      ) {
        let j = i + 4;
        const codes = [];
        let ok = true;
        while (j < sig.length && sig[j].value !== ')') {
          if (sig[j].type === 'number') {
            codes.push(Number(sig[j].value));
            j += 1;
          } else {
            ok = false;
            break;
          }
          if (sig[j]?.value === ',') j += 1;
          else if (sig[j]?.value !== ')') {
            ok = false;
            break;
          }
        }
        if (ok && codes.length > 0 && sig[j]?.value === ')') {
          const str = codes.map((c) => String.fromCharCode(c)).join('');
          nextSig.push({ type: 'string', value: encodeJsStringLiteral(str, "'") });
          i = j;
          continue;
        }
      }

      // Penggabungan string konstan 'con' + 'sole' (pastikan sebelum token pertama bukan + lain yang ambigu)
      if (
        sig[i]?.type === 'string' &&
        sig[i + 1]?.value === '+' &&
        sig[i + 2]?.type === 'string' &&
        nextSig[nextSig.length - 1]?.value !== '+'
      ) {
        const merged = decodeJsStringLiteral(sig[i].value) + decodeJsStringLiteral(sig[i + 2].value);
        nextSig.push({ type: 'string', value: encodeJsStringLiteral(merged, "'") });
        i += 2;
        continue;
      }

      nextSig.push(sig[i]);
    }
    sig = nextSig;
  }

  // Pass C: Ubah bracket property obj['log'] -> obj.log & computed key ['name']: -> name:
  const cleanProps = [];
  for (let i = 0; i < sig.length; i += 1) {
    const prev = cleanProps[cleanProps.length - 1] || null;
    if (
      sig[i]?.value === '[' &&
      sig[i + 1]?.type === 'string' &&
      sig[i + 2]?.value === ']'
    ) {
      const propName = decodeJsStringLiteral(sig[i + 1].value);
      if (VALID_IDENT_RE.test(propName) && propName !== '__proto__') {
        // Kasus 1: Akses properti objek (sebelumnya ident, regex, string, template, ), ])
        if (
          prev &&
          ((prev.type === 'ident' && (!JS_KEYWORDS.has(prev.value) || prev.value === 'this' || prev.value === 'super')) ||
            prev.type === 'regex' ||
            prev.type === 'string' ||
            prev.type === 'template' ||
            prev.value === ')' ||
            prev.value === ']')
        ) {
          cleanProps.push({ type: 'punct', value: '.' });
          cleanProps.push({ type: 'ident', value: propName });
          i += 2;
          continue;
        }
        // Kasus 2: Key objek / method { ['name']: 1 } atau { ['execute'](ctx) {} }
        const afterBracket = sig[i + 3];
        if (
          prev &&
          (prev.value === '{' || prev.value === ',' || prev.value === ';' ||
            (prev.type === 'ident' && ['async', 'static', 'get', 'set'].includes(prev.value))) &&
          afterBracket &&
          (afterBracket.value === ':' || afterBracket.value === '(') &&
          !JS_KEYWORDS.has(propName)
        ) {
          cleanProps.push({ type: 'ident', value: propName });
          i += 2;
          continue;
        }
      }
    }
    cleanProps.push(sig[i]);
  }

  const candidate = `${shebang}${reconstructFromSigSlice(cleanProps, 0, cleanProps.length)}`;
  return verifyJsSyntax(candidate) ? candidate : code;
}

/**
 * Beautifier / Pretty-Printer JavaScript 2-spasi berbasis Token
 */
function beautifyJavaScript(code = '') {
  const tokens = tokenizeJs(code);
  const sig = [];
  for (const t of tokens) {
    if (t.type === 'ws') continue;
    sig.push(t);
  }
  if (sig.length === 0) return code;

  const BINARY_SPACED = new Set([
    '=', '==', '===', '!=', '!==', '<', '<=', '>', '>=',
    '+', '-', '*', '/', '%', '**', '&&', '||', '??',
    '&', '|', '^', '<<', '>>', '>>>',
    '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=',
    '&=', '|=', '^=', '<<=', '>>=', '>>>=', '=>', '?',
  ]);

  const SPACE_AFTER_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'case',
    'const', 'let', 'var', 'function', 'class', 'extends', 'new', 'typeof',
    'delete', 'void', 'in', 'of', 'instanceof', 'await', 'yield', 'async',
    'import', 'export', 'from', 'else', 'try', 'finally', 'do', 'static',
  ]);

  let indent = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let ternaryDepth = 0;
  let out = '';
  let atLineStart = true;

  const writeIndent = () => {
    if (atLineStart) {
      out += '  '.repeat(Math.max(0, indent));
      atLineStart = false;
    }
  };

  const writeNewline = () => {
    out = out.replace(/[ \t]+$/, '');
    if (!out.endsWith('\n')) out += '\n';
    atLineStart = true;
  };

  for (let i = 0; i < sig.length; i += 1) {
    const tok = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;

    if (tok.type === 'shebang') {
      out += `${tok.value}\n`;
      atLineStart = true;
      continue;
    }

    if (tok.type === 'comment') {
      writeIndent();
      out += tok.value;
      writeNewline();
      continue;
    }

    if (tok.type === 'punct') {
      const v = tok.value;

      if (v === '(') {
        writeIndent();
        if (prev?.type === 'ident' && ['if', 'for', 'while', 'switch', 'catch'].includes(prev.value)) {
          if (!out.endsWith(' ')) out += ' ';
        }
        out += '(';
        parenDepth += 1;
        continue;
      }

      if (v === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        writeIndent();
        out += ')';
        if (next?.value === '{') out += ' ';
        continue;
      }

      if (v === '[') {
        writeIndent();
        out += '[';
        bracketDepth += 1;
        continue;
      }

      if (v === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        writeIndent();
        out += ']';
        continue;
      }

      if (v === '{') {
        writeIndent();
        if (
          prev &&
          !out.endsWith(' ') &&
          !out.endsWith('(') &&
          !out.endsWith('[') &&
          prev.value !== '{'
        ) {
          out += ' ';
        }
        out += '{';
        if (next?.value === '}') {
          out += '}';
          i += 1;
          continue;
        }
        indent += 1;
        writeNewline();
        continue;
      }

      if (v === '}') {
        indent = Math.max(0, indent - 1);
        if (!atLineStart) writeNewline();
        writeIndent();
        out += '}';
        if (
          next &&
          ((next.type === 'ident' && ['else', 'catch', 'finally', 'while'].includes(next.value)) ||
            next.value === ';' ||
            next.value === ',' ||
            next.value === ')')
        ) {
          if (next.type === 'ident') out += ' ';
        } else if (next) {
          writeNewline();
        }
        continue;
      }

      if (v === ';') {
        writeIndent();
        out += ';';
        if (parenDepth === 0 && bracketDepth === 0) {
          if (next) writeNewline();
        } else if (next && next.value !== ')') {
          out += ' ';
        }
        continue;
      }

      if (v === ',') {
        writeIndent();
        out += ',';
        if (parenDepth === 0 && bracketDepth === 0 && indent > 0 && next && next.value !== '}') {
          writeNewline();
        } else if (next) {
          out += ' ';
        }
        continue;
      }

      if (v === '?') {
        ternaryDepth += 1;
        writeIndent();
        if (!out.endsWith(' ')) out += ' ';
        out += '? ';
        continue;
      }

      if (v === ':') {
        writeIndent();
        if (ternaryDepth > 0) {
          ternaryDepth -= 1;
          if (!out.endsWith(' ')) out += ' ';
          out += ': ';
        } else {
          out += ': ';
          // Untuk case ...: atau default: pindah baris
          if (prev && (prev.value === 'default' || sig[i - 2]?.value === 'case')) {
            writeNewline();
          }
        }
        continue;
      }

      if (v === '.' || v === '?.') {
        writeIndent();
        out += v;
        continue;
      }

      // Unary + / - vs Binary + / -
      const isUnaryPlusMinus =
        (v === '+' || v === '-') &&
        (!prev ||
          (prev.type === 'punct' && prev.value !== ')' && prev.value !== ']' && prev.value !== '++' && prev.value !== '--') ||
          (prev.type === 'ident' && REGEX_PRECEDING_KEYWORDS.has(prev.value)));

      if (isUnaryPlusMinus || v === '!' || v === '~' || v === '++' || v === '--' || v === '...') {
        writeIndent();
        if (
          prev &&
          prev.type === 'ident' &&
          SPACE_AFTER_KEYWORDS.has(prev.value) &&
          !out.endsWith(' ')
        ) {
          out += ' ';
        }
        out += v;
        continue;
      }

      if (BINARY_SPACED.has(v)) {
        writeIndent();
        if (!out.endsWith(' ')) out += ' ';
        out += `${v} `;
        continue;
      }

      writeIndent();
      out += v;
      continue;
    }

    // Ident, String, Number, Template, Regex
    writeIndent();
    if (
      prev &&
      !out.endsWith(' ') &&
      !out.endsWith('\n') &&
      !out.endsWith('(') &&
      !out.endsWith('[') &&
      !out.endsWith('.') &&
      prev.value !== '!' &&
      prev.value !== '~' &&
      prev.value !== '...'
    ) {
      if (
        (prev.type === 'ident' && (SPACE_AFTER_KEYWORDS.has(prev.value) || /[A-Za-z0-9_$]/.test(tok.value[0]))) ||
        prev.type === 'number' ||
        prev.type === 'string'
      ) {
        out += ' ';
      }
    }

    out += tok.value;

    if (tok.type === 'ident' && SPACE_AFTER_KEYWORDS.has(tok.value)) {
      if (next && next.value !== ';' && next.value !== '(' && next.value !== ':' && next.value !== ',') {
        out += ' ';
      }
    }
  }

  const trimmedOut = `${out.trim()}\n`;
  return verifyJsSyntax(trimmedOut) ? trimmedOut : code;
}

/**
 * Pipeline utama Dekripsi + Deobfuscate + Penyempurnaan (Beautify) Script JavaScript
 */
function deobfuscateAndBeautifyJavaScript(rawSource = '') {
  let working = String(rawSource || '').trim();
  if (!working) {
    throw new Error('Kode script yang ingin di-decode masih kosong.');
  }

  let layersUnpacked = 0;
  let totalStringsRestored = 0;
  const detectedTechniques = [];

  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;

    // 1. Cek container Zlib+XOR / Buffer.from / atob / fromCharCode eval
    const containerUnpacked = tryUnpackContainerLayers(working);
    if (containerUnpacked && containerUnpacked !== working) {
      working = containerUnpacked.trim();
      layersUnpacked += 1;
      if (!detectedTechniques.includes('Encrypted Container / Eval')) {
        detectedTechniques.push('Encrypted Container / Eval');
      }
      changed = true;
      continue;
    }

    // 2. Cek Dean Edwards P.A.C.K.E.R
    const packerUnpacked = tryUnpackDeanEdwards(working);
    if (packerUnpacked && packerUnpacked !== working) {
      working = packerUnpacked.trim();
      layersUnpacked += 1;
      if (!detectedTechniques.includes('Dean Edwards P.A.C.K.E.R')) {
        detectedTechniques.push('Dean Edwards P.A.C.K.E.R');
      }
      changed = true;
      continue;
    }

    // 3. Cek _0x String-Array + Rotator + Decoder
    const tableRes = resolveObfuscatorStringTable(working);
    if (tableRes.restoredCount > 0 && tableRes.code !== working) {
      working = tableRes.code;
      layersUnpacked += 1;
      totalStringsRestored += tableRes.restoredCount;
      if (!detectedTechniques.includes('_0x String-Array Obfuscator')) {
        detectedTechniques.push('_0x String-Array Obfuscator');
      }
      changed = true;
    }

    // 4. Penyederhanaan ekspresi terenkripsi (\xNN, !![], XOR hex, bracket property)
    const simplified = simplifyObfuscatedTokens(working);
    if (simplified !== working) {
      working = simplified;
      if (!detectedTechniques.includes('Hex/Constant Simplifier')) {
        detectedTechniques.push('Hex/Constant Simplifier');
      }
      changed = true;
    }

    if (!changed) break;
  }

  // 5. Rapikan & sempurnakan format kode JavaScript (2-space indent)
  const beautified = beautifyJavaScript(working);
  if (beautified !== working && !detectedTechniques.includes('JS Beautifier')) {
    detectedTechniques.push('JS Beautifier');
  }

  return {
    code: beautified,
    layersUnpacked,
    stringsRestored: totalStringsRestored,
    techniques: detectedTechniques.length > 0 ? detectedTechniques : ['JS Beautifier'],
    syntaxValid: verifyJsSyntax(beautified),
  };
}

module.exports = {
  verifyJsSyntax,
  looksLikeJavaScript,
  tokenizeJs,
  obfuscateJavaScript,
  deobfuscateAndBeautifyJavaScript,
  beautifyJavaScript,
};
