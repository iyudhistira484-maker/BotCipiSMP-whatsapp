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

const IO_FORBIDDEN_IDENTS = new Set([
  'require', 'fs', 'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns',
  'cluster', 'child_process', 'worker_threads', 'os', 'path', 'crypto', 'zlib',
  'axios', 'fetch', 'WebSocket', 'XMLHttpRequest', 'setInterval', 'setTimeout',
  'setImmediate', 'console', 'eval', 'Function',
]);

const RESERVED_GLOBAL_NAMES = new Set([
  ...JS_KEYWORDS,
  'undefined', 'NaN', 'Infinity', 'global', 'globalThis', 'window', 'document',
  'process', 'require', 'module', 'exports', '__dirname', '__filename',
  'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'Promise', 'Object', 'Array', 'String',
  'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'JSON', 'Reflect', 'Proxy', 'Intl',
  'Uint8Array', 'Int32Array', 'Float64Array', 'ArrayBuffer', 'DataView',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'fetch', 'atob', 'btoa',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
  'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape',
]);

function stripLeadingCommentsAndShebang(code = '') {
  let s = String(code || '').replace(/^#![^\r\n]*\r?\n?/, '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    if (s.startsWith('//')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1).trim();
      changed = true;
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/', 2);
      if (end !== -1) {
        s = s.slice(end + 2).trim();
        changed = true;
      }
    }
  }
  return s;
}

/**
 * Unpack Dean Edwards P.A.C.K.E.R: eval(function(p,a,c,k,e,d){...}('payload',62,count,'dict'.split('|'),0,{}))
 */
function tryUnpackDeanEdwards(code = '') {
  const trimmed = stripLeadingCommentsAndShebang(code);
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
  if (!radix || radix < 2 || radix > 62 || count > 100000) return null;

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
  const s = stripLeadingCommentsAndShebang(code);

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

function reconstructFromSigSlice(sigTokens, start, end) {
  let out = '';
  for (let i = start; i < end; i += 1) {
    const val = sigTokens[i].value;
    if (
      out &&
      ((/[A-Za-z0-9_$]/.test(out[out.length - 1]) && /[A-Za-z0-9_$]/.test(val[0])) ||
        (out[out.length - 1] === '+' && val[0] === '+') ||
        (out[out.length - 1] === '-' && val[0] === '-') ||
        (out[out.length - 1] === '/' && val[0] === '/'))
    ) {
      out += ' ';
    }
    out += val;
  }
  return out;
}

/**
 * Telusuri setiap ekspresi ${ ... } di dalam template literal (`...${expr}...`) secara rekursif
 */
function transformTemplateExpressions(rawTemplate = '', mapExprFn, inlineConstStrings = false) {
  if (!rawTemplate.startsWith('`') || !rawTemplate.endsWith('`') || !rawTemplate.includes('${')) {
    return rawTemplate;
  }
  let out = '`';
  let i = 1;
  const endLimit = rawTemplate.length - 1;

  while (i < endLimit) {
    const ch = rawTemplate[i];
    if (ch === '\\') {
      out += rawTemplate.slice(i, Math.min(endLimit, i + 2));
      i += 2;
      continue;
    }
    if (ch === '$' && rawTemplate[i + 1] === '{') {
      const exprStart = i + 2;
      let cursor = exprStart;
      let depth = 1;
      while (cursor < endLimit && depth > 0) {
        const bc = rawTemplate[cursor];
        if (bc === '\\') {
          cursor += 2;
          continue;
        }
        if (bc === "'" || bc === '"' || bc === '`') {
          const q = bc;
          cursor += 1;
          while (cursor < endLimit) {
            if (rawTemplate[cursor] === '\\') {
              cursor += 2;
              continue;
            }
            if (rawTemplate[cursor] === q) {
              cursor += 1;
              break;
            }
            cursor += 1;
          }
          continue;
        }
        if (bc === '{') depth += 1;
        else if (bc === '}') depth -= 1;
        cursor += 1;
      }
      if (depth === 0) {
        const innerRaw = rawTemplate.slice(exprStart, cursor - 1);
        const mapped = mapExprFn(innerRaw);
        if (inlineConstStrings) {
          const mTokens = tokenizeJs(mapped).filter((t) => t.type !== 'ws' && t.type !== 'comment');
          if (mTokens.length === 1 && mTokens[0].type === 'string') {
            const plain = decodeJsStringLiteral(mTokens[0].value);
            if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(plain)) {
              out += plain
                .replace(/\\/g, '\\\\')
                .replace(/`/g, '\\`')
                .replace(/\$\{/g, '\\${');
              i = cursor;
              continue;
            }
          }
        }
        out += `\${${mapped}}`;
        i = cursor;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  out += '`';
  return out;
}

function collectIdentsFromToken(tok, onIdent) {
  if (tok.type === 'ident') {
    onIdent(tok.value);
    return;
  }
  if (tok.type === 'template' && tok.value.includes('${')) {
    transformTemplateExpressions(tok.value, (inner) => {
      const sub = tokenizeJs(inner);
      for (const st of sub) {
        if (st.type === 'ident' || st.type === 'template') {
          collectIdentsFromToken(st, onIdent);
        }
      }
      return inner;
    });
  }
}

function findMatchingClose(sig, openIdx) {
  const openVal = sig[openIdx]?.value;
  const closeVal = openVal === '(' ? ')' : openVal === '{' ? '}' : openVal === '[' ? ']' : '';
  if (!closeVal) return -1;
  let depth = 0;
  for (let i = openIdx; i < sig.length; i += 1) {
    const v = sig[i].value;
    if (v === openVal) depth += 1;
    else if (v === closeVal) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sliceHasIoForbidden(sig, start, end) {
  for (let i = start; i < end; i += 1) {
    const t = sig[i];
    if (t.type === 'ident' && IO_FORBIDDEN_IDENTS.has(t.value)) {
      return true;
    }
  }
  return false;
}

function parseParamList(sig, openParenIdx, closeParenIdx) {
  const params = [];
  for (let i = openParenIdx + 1; i < closeParenIdx; i += 1) {
    const t = sig[i];
    if (t.type === 'ident') {
      params.push(t.value);
      if (sig[i + 1] && i + 1 < closeParenIdx && sig[i + 1].value !== ',') {
        return null;
      }
      i += 1;
    } else {
      return null;
    }
  }
  return params;
}

function splitCallArgs(sig, openParenIdx, closeParenIdx) {
  const args = [];
  let argStart = openParenIdx + 1;
  let p = 0;
  let b = 0;
  let c = 0;
  for (let i = openParenIdx + 1; i < closeParenIdx; i += 1) {
    const v = sig[i].value;
    if (v === '(') p += 1;
    else if (v === ')') p -= 1;
    else if (v === '[') b += 1;
    else if (v === ']') b -= 1;
    else if (v === '{') c += 1;
    else if (v === '}') c -= 1;
    else if (v === ',' && p === 0 && b === 0 && c === 0) {
      if (i === argStart) return null;
      args.push({ start: argStart, end: i });
      argStart = i + 1;
    }
  }
  if (closeParenIdx > openParenIdx + 1) {
    if (argStart >= closeParenIdx) return null;
    args.push({ start: argStart, end: closeParenIdx });
  }
  return args;
}

/**
 * Evaluator ekspresi konstan murni (angka desimal/hex, string, aritmatika & bitwise bertingkat)
 * Digunakan untuk argumen pemanggil _0xdec(-0x1c3 * 0x2 + 0x5e5, 'k9#a') & pelipatan angka terenkripsi
 */
function evalPureConstArgTokens(sig, start, end) {
  if (start >= end) return { ok: false };
  let pos = start;

  function parseBitOr() {
    let left = parseBitXor();
    if (!left.ok) return left;
    while (pos < end && sig[pos].value === '|') {
      pos += 1;
      const right = parseBitXor();
      if (!right.ok || typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false };
      left = { ok: true, value: left.value | right.value };
    }
    return left;
  }

  function parseBitXor() {
    let left = parseBitAnd();
    if (!left.ok) return left;
    while (pos < end && sig[pos].value === '^') {
      pos += 1;
      const right = parseBitAnd();
      if (!right.ok || typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false };
      left = { ok: true, value: left.value ^ right.value };
    }
    return left;
  }

  function parseBitAnd() {
    let left = parseShift();
    if (!left.ok) return left;
    while (pos < end && sig[pos].value === '&') {
      pos += 1;
      const right = parseShift();
      if (!right.ok || typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false };
      left = { ok: true, value: left.value & right.value };
    }
    return left;
  }

  function parseShift() {
    let left = parseAdd();
    if (!left.ok) return left;
    while (pos < end && (sig[pos].value === '<<' || sig[pos].value === '>>' || sig[pos].value === '>>>')) {
      const op = sig[pos].value;
      pos += 1;
      const right = parseAdd();
      if (!right.ok || typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false };
      const v = op === '<<' ? left.value << right.value : op === '>>' ? left.value >> right.value : left.value >>> right.value;
      left = { ok: true, value: v };
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    if (!left.ok) return left;
    while (pos < end && (sig[pos].value === '+' || sig[pos].value === '-')) {
      const op = sig[pos].value;
      pos += 1;
      const right = parseMul();
      if (!right.ok) return { ok: false };
      if (op === '+' && (typeof left.value === 'string' || typeof right.value === 'string')) {
        left = { ok: true, value: String(left.value) + String(right.value) };
      } else if (typeof left.value === 'number' && typeof right.value === 'number') {
        left = { ok: true, value: op === '+' ? left.value + right.value : left.value - right.value };
      } else {
        return { ok: false };
      }
    }
    return left;
  }

  function parseMul() {
    let left = parseUnary();
    if (!left.ok) return left;
    while (pos < end && (sig[pos].value === '*' || sig[pos].value === '/' || sig[pos].value === '%')) {
      const op = sig[pos].value;
      pos += 1;
      const right = parseUnary();
      if (!right.ok || typeof left.value !== 'number' || typeof right.value !== 'number') return { ok: false };
      if ((op === '/' || op === '%') && right.value === 0) return { ok: false };
      const v = op === '*' ? left.value * right.value : op === '/' ? left.value / right.value : left.value % right.value;
      if (!Number.isFinite(v)) return { ok: false };
      left = { ok: true, value: v };
    }
    return left;
  }

  function parseUnary() {
    if (pos >= end) return { ok: false };
    const v = sig[pos].value;
    if (v === '+' || v === '-' || v === '~' || v === '!') {
      pos += 1;
      const sub = parseUnary();
      if (!sub.ok) return { ok: false };
      if (v === '!') return { ok: true, value: !sub.value };
      if (typeof sub.value !== 'number') return { ok: false };
      if (v === '+') return { ok: true, value: +sub.value };
      if (v === '-') return { ok: true, value: -sub.value };
      return { ok: true, value: ~sub.value };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    if (pos >= end) return { ok: false };
    const t = sig[pos];
    if (t.value === '(') {
      pos += 1;
      const inner = parseBitOr();
      if (!inner.ok || pos >= end || sig[pos].value !== ')') return { ok: false };
      pos += 1;
      return inner;
    }
    if (t.type === 'number' && !t.value.endsWith('n')) {
      const num = Number(t.value.replace(/_/g, ''));
      if (!Number.isFinite(num)) return { ok: false };
      pos += 1;
      return { ok: true, value: num };
    }
    if (t.type === 'string') {
      pos += 1;
      return { ok: true, value: decodeJsStringLiteral(t.value) };
    }
    if (t.type === 'ident' && (t.value === 'true' || t.value === 'false')) {
      pos += 1;
      return { ok: true, value: t.value === 'true' };
    }
    if (
      t.value === '[' &&
      sig[pos + 1]?.value === ']'
    ) {
      pos += 2;
      return { ok: true, value: '' };
    }
    return { ok: false };
  }

  const res = parseBitOr();
  if (!res.ok || pos !== end) return { ok: false };
  return res;
}

const EXPR_PREFIX_FOR_FUNC = new Set([
  '=', ':', '(', '[', ',', '!', '~', '+', '-', '*', '/', '%',
  '&&', '||', '??', '?', '==', '===', '!=', '!==',
  'return', 'throw', 'yield', 'await', 'void', 'typeof', 'delete',
]);

/**
 * Deteksi apakah sebuah fungsi kecil adalah wrapper murni ke decoder yang sudah dikenal:
 * Contoh: function _0xwrap(a, b, c) { return _0x5dcb(a - 0x1a4, c); }
 */
function inspectPureDecoderWrapperBody(sig, bodyOpenBrace, bodyCloseBrace, paramNames, knownDecoders) {
  const paramSet = new Set(paramNames);
  let cursor = bodyOpenBrace + 1;
  const localAliases = new Map();

  // Opsional: const _local = _0xdec; di awal fungsi wrapper
  while (
    cursor + 4 < bodyCloseBrace &&
    ['const', 'let', 'var'].includes(sig[cursor].value) &&
    sig[cursor + 1]?.type === 'ident' &&
    sig[cursor + 2]?.value === '=' &&
    sig[cursor + 3]?.type === 'ident' &&
    (knownDecoders.has(sig[cursor + 3].value) || localAliases.has(sig[cursor + 3].value)) &&
    sig[cursor + 4]?.value === ';'
  ) {
    localAliases.set(sig[cursor + 1].value, sig[cursor + 3].value);
    cursor += 5;
  }

  if (sig[cursor]?.value !== 'return') return false;
  cursor += 1;
  const callee = sig[cursor];
  if (
    !callee ||
    callee.type !== 'ident' ||
    (!knownDecoders.has(callee.value) && !localAliases.has(callee.value)) ||
    sig[cursor + 1]?.value !== '('
  ) {
    return false;
  }

  const callClose = findMatchingClose(sig, cursor + 1);
  if (callClose === -1 || callClose >= bodyCloseBrace) return false;

  // Setelah ')' hanya boleh ada ';' opsional lalu tutup '}'
  let afterCall = callClose + 1;
  if (sig[afterCall]?.value === ';') afterCall += 1;
  if (afterCall !== bodyCloseBrace) return false;

  // Pastikan semua token di dalam argumen panggilan murni parameter/angka/string/operator aritmatika
  for (let k = cursor + 2; k < callClose; k += 1) {
    const tk = sig[k];
    if (tk.type === 'ident') {
      if (!paramSet.has(tk.value)) return false;
    } else if (tk.type === 'number' || tk.type === 'string') {
      continue;
    } else if (
      tk.type === 'punct' &&
      ['+', '-', '*', '/', '%', '^', '&', '|', '<<', '>>', '>>>', '~', '(', ')', ','].includes(tk.value)
    ) {
      continue;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Coba parse ekspresi IIFE tingkat atas mulai dari indeks i
 * Mendukung:
 *  - (function(_a, _b){ ... }(_0x1a7c, 740518))   [Crockford style — rudal2.js!]
 *  - (function(_a, _b){ ... })(_0x1a7c, 740518)   [Standard style]
 *  - !function(_a, _b){ ... }(_0x1a7c, 740518)    [Unary prefix style]
 *  - ((_a, _b) => { ... })(_0x1a7c, 740518)       [Arrow IIFE style]
 */
function tryParseTopLevelIifeAt(sig, startIdx) {
  let i = startIdx;
  if (
    sig[i] &&
    (['!', '+', '-', '~'].includes(sig[i].value) || (sig[i].type === 'ident' && sig[i].value === 'void'))
  ) {
    i += 1;
  }

  // Kasus 1: Diawali '('
  if (sig[i]?.value === '(') {
    const outerClose = findMatchingClose(sig, i);
    if (outerClose === -1) return null;

    // Subkasus 1A: (function optName(params) { body }(args))
    if (sig[i + 1]?.value === 'function') {
      let pOpen = i + 2;
      if (sig[pOpen]?.type === 'ident') pOpen += 1;
      if (sig[pOpen]?.value === '(') {
        const pClose = findMatchingClose(sig, pOpen);
        if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
          const bClose = findMatchingClose(sig, pClose + 1);
          if (bClose !== -1) {
            // Panggilan di dalam kurung luar: }(args))
            if (sig[bClose + 1]?.value === '(') {
              const innerCallClose = findMatchingClose(sig, bClose + 1);
              if (innerCallClose === outerClose - 1) {
                return {
                  start: startIdx,
                  end: outerClose + 1,
                  bodyStart: pClose + 2,
                  bodyEnd: bClose,
                  argsStart: bClose + 2,
                  argsEnd: innerCallClose,
                };
              }
            }
            // Panggilan di luar kurung luar: )(args)
            if (bClose === outerClose - 1 && sig[outerClose + 1]?.value === '(') {
              const extCallClose = findMatchingClose(sig, outerClose + 1);
              if (extCallClose !== -1) {
                return {
                  start: startIdx,
                  end: extCallClose + 1,
                  bodyStart: pClose + 2,
                  bodyEnd: bClose,
                  argsStart: outerClose + 2,
                  argsEnd: extCallClose,
                };
              }
            }
          }
        }
      }
    }

    // Subkasus 1B: ((params) => { body })(args)
    if (sig[i + 1]?.value === '(' && sig[outerClose + 1]?.value === '(') {
      const pClose = findMatchingClose(sig, i + 1);
      if (pClose !== -1 && sig[pClose + 1]?.value === '=>' && sig[pClose + 2]?.value === '{') {
        const bClose = findMatchingClose(sig, pClose + 2);
        const extCallClose = findMatchingClose(sig, outerClose + 1);
        if (bClose === outerClose - 1 && extCallClose !== -1) {
          return {
            start: startIdx,
            end: extCallClose + 1,
            bodyStart: pClose + 3,
            bodyEnd: bClose,
            argsStart: outerClose + 2,
            argsEnd: extCallClose,
          };
        }
      }
    }
  }

  // Kasus 2: !function optName(params) { body }(args)
  if (i > startIdx && sig[i]?.value === 'function') {
    let pOpen = i + 1;
    if (sig[pOpen]?.type === 'ident') pOpen += 1;
    if (sig[pOpen]?.value === '(') {
      const pClose = findMatchingClose(sig, pOpen);
      if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
        const bClose = findMatchingClose(sig, pClose + 1);
        if (bClose !== -1 && sig[bClose + 1]?.value === '(') {
          const callClose = findMatchingClose(sig, bClose + 1);
          if (callClose !== -1) {
            return {
              start: startIdx,
              end: callClose + 1,
              bodyStart: pClose + 2,
              bodyEnd: bClose,
              argsStart: bClose + 2,
              argsEnd: callClose,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Scan seluruh level atas file (awal, tengah, hingga baris paling bawah!) untuk menemukan
 * fungsi/variabel Array String, Fungsi Dekoder Utama, dan IIFE Rotator yang ter-hoist.
 */
function scanTopLevelStringTablePieces(sig) {
  const arrayProviderCandidates = new Map();
  const decoderCandidates = [];
  const iifeCandidates = [];

  let brace = 0;
  let paren = 0;
  let bracket = 0;

  for (let i = 0; i < sig.length; i += 1) {
    const t = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;

    if (brace === 0 && paren === 0 && bracket === 0) {
      // 1. Top-level function declaration: function _0x...(...) { ... }
      if (
        t.type === 'ident' &&
        t.value === 'function' &&
        sig[i + 1]?.type === 'ident' &&
        sig[i + 2]?.value === '(' &&
        (!prev || !EXPR_PREFIX_FOR_FUNC.has(prev.value))
      ) {
        const fnName = sig[i + 1].value;
        const pClose = findMatchingClose(sig, i + 2);
        if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
          const bClose = findMatchingClose(sig, pClose + 1);
          if (bClose !== -1) {
            const params = parseParamList(sig, i + 2, pClose);
            if (params && !sliceHasIoForbidden(sig, pClose + 1, bClose + 1)) {
              if (params.length === 0) {
                let strCount = 0;
                let hasBracketOrSplit = false;
                for (let k = pClose + 2; k < bClose; k += 1) {
                  if (sig[k].type === 'string') strCount += 1;
                  if (sig[k].value === '[' || sig[k].value === 'split') hasBracketOrSplit = true;
                }
                if (hasBracketOrSplit && (strCount >= 2 || (strCount >= 1 && /^_0x/i.test(fnName)))) {
                  arrayProviderCandidates.set(fnName, {
                    name: fnName,
                    kind: 'func',
                    start: i,
                    end: bClose + 1,
                    code: reconstructFromSigSlice(sig, i, bClose + 1),
                  });
                }
              } else if (params.length >= 1 && params.length <= 6) {
                decoderCandidates.push({
                  name: fnName,
                  kind: 'func',
                  params,
                  start: i,
                  end: bClose + 1,
                  bodyStart: pClose + 2,
                  bodyEnd: bClose,
                  code: reconstructFromSigSlice(sig, i, bClose + 1),
                });
              }
            }
            i = bClose;
            continue;
          }
        }
      }

      // 2. Top-level var/let/const array provider atau function expression decoder
      if (t.type === 'ident' && ['var', 'let', 'const'].includes(t.value) && prev?.value !== '(') {
        let cur = i + 1;
        while (cur < sig.length) {
          if (sig[cur]?.type === 'ident' && sig[cur + 1]?.value === '=') {
            const varName = sig[cur].value;
            const rhsStart = cur + 2;
            // Kasus 2A: var _0xarr = ['...', '...', ...]
            if (sig[rhsStart]?.value === '[') {
              const arrClose = findMatchingClose(sig, rhsStart);
              if (arrClose !== -1 && !sliceHasIoForbidden(sig, rhsStart, arrClose + 1)) {
                let strCount = 0;
                let nonLit = false;
                for (let k = rhsStart + 1; k < arrClose; k += 1) {
                  if (sig[k].type === 'string') strCount += 1;
                  else if (sig[k].type === 'number' || sig[k].value === ',' || sig[k].value === '-') continue;
                  else {
                    nonLit = true;
                    break;
                  }
                }
                if (!nonLit && strCount >= 2) {
                  arrayProviderCandidates.set(varName, {
                    name: varName,
                    kind: 'var',
                    start: cur,
                    end: arrClose + 1,
                    code: `var ${varName} = ${reconstructFromSigSlice(sig, rhsStart, arrClose + 1)};`,
                  });
                }
              }
            }
            // Kasus 2B: var _0xdec = function(a, b) { ... }
            if (sig[rhsStart]?.value === 'function') {
              let pOpen = rhsStart + 1;
              if (sig[pOpen]?.type === 'ident') pOpen += 1;
              if (sig[pOpen]?.value === '(') {
                const pClose = findMatchingClose(sig, pOpen);
                if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
                  const bClose = findMatchingClose(sig, pClose + 1);
                  const params = parseParamList(sig, pOpen, pClose);
                  if (
                    bClose !== -1 &&
                    params &&
                    params.length >= 1 &&
                    params.length <= 6 &&
                    !sliceHasIoForbidden(sig, pClose + 1, bClose + 1)
                  ) {
                    decoderCandidates.push({
                      name: varName,
                      kind: 'var',
                      params,
                      start: cur,
                      end: bClose + 1,
                      bodyStart: pClose + 2,
                      bodyEnd: bClose,
                      code: `var ${varName} = ${reconstructFromSigSlice(sig, rhsStart, bClose + 1)};`,
                    });
                  }
                }
              }
            }
          }
          // Lompat ke ',' atau ';' berikutnya pada kedalaman 0
          let dBrace = 0;
          let dParen = 0;
          let dBracket = 0;
          while (cur < sig.length) {
            const cv = sig[cur].value;
            if (cv === '{') dBrace += 1;
            else if (cv === '}') dBrace = Math.max(0, dBrace - 1);
            else if (cv === '(') dParen += 1;
            else if (cv === ')') dParen = Math.max(0, dParen - 1);
            else if (cv === '[') dBracket += 1;
            else if (cv === ']') dBracket = Math.max(0, dBracket - 1);
            else if (dBrace === 0 && dParen === 0 && dBracket === 0) {
              if (cv === ',') {
                cur += 1;
                break;
              }
              if (cv === ';') break;
            }
            cur += 1;
          }
          if (cur >= sig.length || sig[cur]?.value === ';') break;
        }
      }

      // 3. Top-level IIFE (setelah awal file, ';', '}', atau ',')
      if (!prev || prev.value === ';' || prev.value === '}' || prev.value === ',') {
        const iife = tryParseTopLevelIifeAt(sig, i);
        if (iife && !sliceHasIoForbidden(sig, iife.bodyStart, iife.bodyEnd)) {
          iifeCandidates.push(iife);
          i = iife.end - 1;
          continue;
        }
      }
    }

    if (t.type === 'punct') {
      if (t.value === '{') brace += 1;
      else if (t.value === '}') brace = Math.max(0, brace - 1);
      else if (t.value === '(') paren += 1;
      else if (t.value === ')') paren = Math.max(0, paren - 1);
      else if (t.value === '[') bracket += 1;
      else if (t.value === ']') bracket = Math.max(0, bracket - 1);
    }
  }

  return { arrayProviderCandidates, decoderCandidates, iifeCandidates };
}

/**
 * Bersihkan deklarasi alias mati (termasuk multi-declarator `const a = _0xdec, b = new Promise(...)`)
 * serta fungsi dekoder/array yang sudah 0 referensi di luar dirinya sendiri.
 */
function pruneDeadObfuscatorArtifacts(sigTokens, removableVarNames, removableFuncNames) {
  let cur = sigTokens;

  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;

    // Hitung jumlah pemakaian baca setiap identifier (abaikan sisi kiri deklarasi alias `id = ...` yang sedang diuji)
    const declRhsSpans = [];
    const totalIdentOccurrences = new Map();
    for (let i = 0; i < cur.length; i += 1) {
      collectIdentsFromToken(cur[i], (id) => {
        totalIdentOccurrences.set(id, (totalIdentOccurrences.get(id) || 0) + 1);
      });
    }

    // Tahap A: Pangkas declarator alias mati di dalam var/let/const (baik tunggal maupun multi-declarator!)
    const afterVarPrune = [];
    for (let i = 0; i < cur.length; i += 1) {
      const tok = cur[i];
      const prev = i > 0 ? cur[i - 1] : null;

      if (
        tok.type === 'ident' &&
        ['var', 'let', 'const'].includes(tok.value) &&
        prev?.value !== '(' &&
        !(prev?.type === 'ident' && prev.value === 'export')
      ) {
        // Parse seluruh declarator sampai ';' pada kedalaman lokal 0
        const decls = [];
        let scan = i + 1;
        let dStart = scan;
        let b = 0;
        let p = 0;
        let k = 0;
        let endedWithSemi = false;

        while (scan < cur.length) {
          const v = cur[scan].value;
          if (v === '{') b += 1;
          else if (v === '}') {
            if (b === 0) break;
            b -= 1;
          } else if (v === '(') p += 1;
          else if (v === ')') {
            if (p === 0) break;
            p -= 1;
          } else if (v === '[') k += 1;
          else if (v === ']') {
            if (k === 0) break;
            k -= 1;
          } else if (b === 0 && p === 0 && k === 0) {
            if (v === ',') {
              decls.push({ start: dStart, end: scan });
              dStart = scan + 1;
            } else if (v === ';') {
              decls.push({ start: dStart, end: scan });
              endedWithSemi = true;
              break;
            }
          }
          scan += 1;
        }

        if (endedWithSemi && decls.length >= 1 && decls.every((d) => d.end > d.start)) {
          const surviving = [];
          let removedAny = false;

          for (const d of decls) {
            const firstTok = cur[d.start];
            const eqTok = cur[d.start + 1];
            let isDeadRemovable = false;

            if (
              firstTok?.type === 'ident' &&
              eqTok?.value === '=' &&
              removableVarNames.has(firstTok.value)
            ) {
              // Hitung kemunculan firstTok.value di dalam declarator ini sendiri vs di seluruh file
              let selfCount = 0;
              for (let s = d.start; s < d.end; s += 1) {
                if (cur[s].type === 'ident' && cur[s].value === firstTok.value) selfCount += 1;
              }
              const totalCount = totalIdentOccurrences.get(firstTok.value) || 0;
              if (totalCount <= selfCount) {
                isDeadRemovable = true;
              }
            }

            if (isDeadRemovable) {
              removedAny = true;
            } else {
              surviving.push(d);
            }
          }

          if (removedAny) {
            changed = true;
            if (surviving.length > 0) {
              afterVarPrune.push(tok);
              surviving.forEach((d, idx) => {
                if (idx > 0) afterVarPrune.push({ type: 'punct', value: ',' });
                for (let s = d.start; s < d.end; s += 1) afterVarPrune.push(cur[s]);
              });
              afterVarPrune.push({ type: 'punct', value: ';' });
            }
            i = scan;
            continue;
          }
        }
      }

      afterVarPrune.push(tok);
    }

    cur = afterVarPrune;

    // Hitung ulang kemunculan identifier untuk memangkas function _0x...() yang sudah 0 pemanggil luar
    const funcCounts = new Map();
    for (let i = 0; i < cur.length; i += 1) {
      collectIdentsFromToken(cur[i], (id) => {
        funcCounts.set(id, (funcCounts.get(id) || 0) + 1);
      });
    }

    const afterFuncPrune = [];
    for (let i = 0; i < cur.length; i += 1) {
      const tok = cur[i];
      const prev = afterFuncPrune[afterFuncPrune.length - 1] || null;
      if (
        tok.type === 'ident' &&
        tok.value === 'function' &&
        cur[i + 1]?.type === 'ident' &&
        removableFuncNames.has(cur[i + 1].value) &&
        cur[i + 2]?.value === '(' &&
        (!prev || !EXPR_PREFIX_FOR_FUNC.has(prev.value))
      ) {
        const fnName = cur[i + 1].value;
        const pClose = findMatchingClose(cur, i + 2);
        if (pClose !== -1 && cur[pClose + 1]?.value === '{') {
          const bClose = findMatchingClose(cur, pClose + 1);
          if (bClose !== -1) {
            let internalCount = 0;
            for (let s = i; s <= bClose; s += 1) {
              if (cur[s].type === 'ident' && cur[s].value === fnName) internalCount += 1;
            }
            const totalCount = funcCounts.get(fnName) || 0;
            if (totalCount <= internalCount) {
              let skipEnd = bClose;
              if (cur[skipEnd + 1]?.value === ';') skipEnd += 1;
              i = skipEnd;
              changed = true;
              continue;
            }
          }
        }
      }
      afterFuncPrune.push(tok);
    }

    cur = afterFuncPrune;
    void declRhsSpans;
    if (!changed) break;
  }

  return cur;
}

/**
 * Resolusi tabel string _0x (javascript-obfuscator / obfuscator.io v1-v4, hoisted di atas/tengah/bawah,
 * desimal & hex, Base64/RC4, alias bertingkat, serta fungsi wrapper lokal) di VM kedap udara.
 */
function resolveObfuscatorStringTable(code = '') {
  const allTokens = tokenizeJs(code);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  const sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');
  if (sig.length < 8) return { code, restoredCount: 0 };

  const { arrayProviderCandidates, decoderCandidates, iifeCandidates } = scanTopLevelStringTablePieces(sig);
  if (arrayProviderCandidates.size === 0 || decoderCandidates.length === 0) {
    return { code, restoredCount: 0 };
  }

  // Hubungkan Primary Decoder <-> Array Provider (hanya yang benar-benar saling merujuk!)
  const primaryDecoders = [];
  const activeArrayProviders = new Map();

  for (const dec of decoderCandidates) {
    const referencedProviders = [];
    for (let k = dec.bodyStart; k < dec.bodyEnd; k += 1) {
      const tk = sig[k];
      if (tk.type === 'ident' && arrayProviderCandidates.has(tk.value)) {
        referencedProviders.push(tk.value);
      }
    }
    if (referencedProviders.length > 0) {
      primaryDecoders.push(dec);
      for (const pName of referencedProviders) {
        activeArrayProviders.set(pName, arrayProviderCandidates.get(pName));
      }
    }
  }

  if (primaryDecoders.length === 0 || activeArrayProviders.size === 0) {
    return { code, restoredCount: 0 };
  }

  const primaryDecoderNames = new Set(primaryDecoders.map((d) => d.name));

  // Cari IIFE Rotator yang memutar salah satu Active Array Provider
  const rotatorIifes = [];
  for (const iife of iifeCandidates) {
    let mentionsProvider = false;
    for (let k = iife.argsStart; k < iife.argsEnd; k += 1) {
      if (sig[k].type === 'ident' && activeArrayProviders.has(sig[k].value)) {
        mentionsProvider = true;
        break;
      }
    }
    if (!mentionsProvider) {
      for (let k = iife.bodyStart; k < iife.bodyEnd; k += 1) {
        if (sig[k].type === 'ident' && activeArrayProviders.has(sig[k].value)) {
          mentionsProvider = true;
          break;
        }
      }
    }
    if (!mentionsProvider) continue;

    let hasRotateLogic = false;
    for (let k = iife.bodyStart; k < iife.bodyEnd; k += 1) {
      const v = sig[k].value;
      if (v === 'shift' || v === 'push' || v === 'while' || v === 'for' || v === 'reverse') {
        hasRotateLogic = true;
        break;
      }
    }
    if (hasRotateLogic) {
      rotatorIifes.push(iife);
    }
  }

  // Siapkan V8 Context murni tanpa satu pun objek host (100% bebas celah constructor escape!)
  const ctx = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  const pureAtobPolyfill = `
    var __b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    function atob(input) {
      var str = String(input).replace(/=+$/, '');
      var output = '';
      for (var bc = 0, bs = 0, buffer, idx = 0; (buffer = str.charAt(idx++)); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))) : 0) {
        buffer = __b64chars.indexOf(buffer);
      }
      return output;
    }
    function TextDecoder() {}
    TextDecoder.prototype.decode = function(bytes) {
      if (!bytes) return '';
      var pct = '';
      for (var idx = 0; idx < bytes.length; idx++) {
        pct += '%' + ('00' + (bytes[idx] & 255).toString(16)).slice(-2);
      }
      return decodeURIComponent(pct);
    };
    var __cipiDecoders = Object.create(null);
  `;

  const vmBootParts = [pureAtobPolyfill];
  for (const prov of activeArrayProviders.values()) {
    vmBootParts.push(prov.code);
  }
  for (const dec of primaryDecoders) {
    vmBootParts.push(dec.code);
  }

  // Sertakan juga alias & fungsi wrapper tingkat atas sebelum Rotator IIFE berjalan (jika Rotator memanggil alias/wrapper)
  const preRotatorKnown = new Set(primaryDecoderNames);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const cand of decoderCandidates) {
      if (preRotatorKnown.has(cand.name)) continue;
      if (inspectPureDecoderWrapperBody(sig, cand.bodyStart - 1, cand.bodyEnd, cand.params, preRotatorKnown)) {
        vmBootParts.push(cand.code);
        preRotatorKnown.add(cand.name);
      }
    }
    let b = 0;
    let p = 0;
    let k = 0;
    for (let i = 0; i + 2 < sig.length; i += 1) {
      const v = sig[i].value;
      if (v === '{') b += 1;
      else if (v === '}') b = Math.max(0, b - 1);
      else if (v === '(') p += 1;
      else if (v === ')') p = Math.max(0, p - 1);
      else if (v === '[') k += 1;
      else if (v === ']') k = Math.max(0, k - 1);
      else if (
        b === 0 &&
        p === 0 &&
        k === 0 &&
        sig[i].type === 'ident' &&
        !preRotatorKnown.has(sig[i].value) &&
        sig[i - 1]?.value !== '.' &&
        sig[i + 1]?.value === '=' &&
        sig[i + 2]?.type === 'ident' &&
        preRotatorKnown.has(sig[i + 2].value)
      ) {
        const after = sig[i + 3];
        if (!after || after.value === ';' || after.value === ',') {
          vmBootParts.push(`var ${sig[i].value} = ${sig[i + 2].value};`);
          preRotatorKnown.add(sig[i].value);
        }
      }
    }
  }

  for (const rot of rotatorIifes) {
    vmBootParts.push(`${reconstructFromSigSlice(sig, rot.start, rot.end)};`);
  }
  for (const dec of primaryDecoders) {
    vmBootParts.push(`if (typeof ${dec.name} === 'function') __cipiDecoders[${ JSON.stringify(dec.name) }] = ${dec.name};`);
  }

  try {
    new vm.Script(vmBootParts.join('\n')).runInContext(ctx, { timeout: 900 });
  } catch {
    return { code, restoredCount: 0 };
  }

  const aliasToDecoder = new Map();
  const exposedDecoders = vm.runInContext('__cipiDecoders', ctx);
  for (const name of primaryDecoderNames) {
    if (typeof exposedDecoders[name] === 'function') {
      aliasToDecoder.set(name, name);
    }
  }
  if (aliasToDecoder.size === 0) {
    return { code, restoredCount: 0 };
  }

  // Hitung berapa kali tiap identifier ditulis/dimutasi di seluruh file agar hanya alias konstan yang dilacak
  const writeCounts = new Map();
  const incWrite = (id) => writeCounts.set(id, (writeCounts.get(id) || 0) + 1);
  for (let i = 0; i < sig.length; i += 1) {
    const t = sig[i];
    const prev = i > 0 ? sig[i - 1] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;
    if (t.type === 'ident') {
      if (prev?.value === 'function') incWrite(t.value);
      else if (
        next &&
        ['=', '+=', '-=', '*=', '/=', '%=', '|=', '&=', '^=', '??=', '||=', '&&=', '++', '--'].includes(next.value) &&
        prev?.value !== '.'
      ) {
        incWrite(t.value);
      } else if (prev && (prev.value === '++' || prev.value === '--')) {
        incWrite(t.value);
      }
    }
  }

  const removableVarNames = new Set();
  const removableFuncNames = new Set([...activeArrayProviders.keys(), ...primaryDecoderNames]);
  for (const prov of activeArrayProviders.values()) {
    if (prov.kind === 'var') removableVarNames.add(prov.name);
  }
  for (const dec of primaryDecoders) {
    if (dec.kind === 'var') removableVarNames.add(dec.name);
  }

  // Tandai rentang token milik preamble (Array Provider, Primary Decoder, Rotator IIFE) agar dilewati saat substitusi
  const preambleRanges = [
    ...[...activeArrayProviders.values()].filter((p) => p.kind === 'func').map((p) => [p.start, p.end]),
    ...primaryDecoders.filter((d) => d.kind === 'func').map((d) => [d.start, d.end]),
    ...rotatorIifes.map((r) => [r.start, r.end]),
  ];
  const isInPreamble = (idx) => preambleRanges.some(([s, e]) => idx >= s && idx < e);

  // Lacak seluruh alias berantai (const a = _0xdec; const b = a;) & wrapper lokal (function w(x,y){ return a(x-10,y); })
  let wrapperSeq = 0;
  let aliasChanged = true;
  while (aliasChanged) {
    aliasChanged = false;
    for (let i = 0; i < sig.length; i += 1) {
      if (isInPreamble(i)) continue;

      // 1. Alias variabel langsung: _0xalias = _0xknownDec
      if (
        sig[i].type === 'ident' &&
        !aliasToDecoder.has(sig[i].value) &&
        sig[i - 1]?.value !== '.' &&
        sig[i + 1]?.value === '=' &&
        sig[i + 2]?.type === 'ident' &&
        aliasToDecoder.has(sig[i + 2].value)
      ) {
        const after = sig[i + 3];
        if (
          (!after || after.value === ';' || after.value === ',' || after.value === ')') &&
          (writeCounts.get(sig[i].value) || 0) <= 1
        ) {
          aliasToDecoder.set(sig[i].value, aliasToDecoder.get(sig[i + 2].value));
          removableVarNames.add(sig[i].value);
          aliasChanged = true;
          continue;
        }
      }

      // 2. Fungsi wrapper murni: function _0xwrap(p1, p2, ...) { return _0xknown(p1 - 0x1a4, p2); }
      if (
        sig[i].value === 'function' &&
        sig[i + 1]?.type === 'ident' &&
        !aliasToDecoder.has(sig[i + 1].value) &&
        sig[i + 2]?.value === '('
      ) {
        const wName = sig[i + 1].value;
        const pClose = findMatchingClose(sig, i + 2);
        if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
          const bClose = findMatchingClose(sig, pClose + 1);
          const params = parseParamList(sig, i + 2, pClose);
          if (
            bClose !== -1 &&
            params &&
            params.length >= 1 &&
            params.length <= 8 &&
            (writeCounts.get(wName) || 0) <= 1 &&
            inspectPureDecoderWrapperBody(sig, pClose + 1, bClose, params, aliasToDecoder)
          ) {
            wrapperSeq += 1;
            const vmKey = `__wrap_${wrapperSeq}`;
            // Ganti nama target decoder di body ke referensi VM aktualnya bila memakai alias lokal
            let bodyCode = reconstructFromSigSlice(sig, pClose + 2, bClose);
            for (const [aName, targetVmKey] of aliasToDecoder.entries()) {
              if (aName !== targetVmKey && bodyCode.includes(aName)) {
                bodyCode = `var ${aName} = __cipiDecoders[${JSON.stringify(targetVmKey)}];\n${bodyCode}`;
              }
            }
            try {
              vm.runInContext(
                `__cipiDecoders[${JSON.stringify(vmKey)}] = function(${params.join(',')}){ ${bodyCode} };`,
                ctx,
                { timeout: 100 }
              );
              aliasToDecoder.set(wName, vmKey);
              removableFuncNames.add(wName);
              preambleRanges.push([i, bClose + 1]);
              aliasChanged = true;
            } catch {
              // Abaikan bila gagal kompilasi wrapper
            }
          }
        }
      }

      // 3. Ekspresi variabel wrapper: const _0xwrap = function(p1, p2) { return _0xknown(...); }
      if (
        sig[i].type === 'ident' &&
        !aliasToDecoder.has(sig[i].value) &&
        sig[i + 1]?.value === '=' &&
        sig[i + 2]?.value === 'function'
      ) {
        const wName = sig[i].value;
        let pOpen = i + 3;
        if (sig[pOpen]?.type === 'ident') pOpen += 1;
        if (sig[pOpen]?.value === '(') {
          const pClose = findMatchingClose(sig, pOpen);
          if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
            const bClose = findMatchingClose(sig, pClose + 1);
            const params = parseParamList(sig, pOpen, pClose);
            if (
              bClose !== -1 &&
              params &&
              params.length >= 1 &&
              params.length <= 8 &&
              (writeCounts.get(wName) || 0) <= 1 &&
              inspectPureDecoderWrapperBody(sig, pClose + 1, bClose, params, aliasToDecoder)
            ) {
              wrapperSeq += 1;
              const vmKey = `__wrap_${wrapperSeq}`;
              let bodyCode = reconstructFromSigSlice(sig, pClose + 2, bClose);
              for (const [aName, targetVmKey] of aliasToDecoder.entries()) {
                if (aName !== targetVmKey && bodyCode.includes(aName)) {
                  bodyCode = `var ${aName} = __cipiDecoders[${JSON.stringify(targetVmKey)}];\n${bodyCode}`;
                }
              }
              try {
                vm.runInContext(
                  `__cipiDecoders[${JSON.stringify(vmKey)}] = function(${params.join(',')}){ ${bodyCode} };`,
                  ctx,
                  { timeout: 100 }
                );
                aliasToDecoder.set(wName, vmKey);
                removableVarNames.add(wName);
                aliasChanged = true;
              } catch {
                // Abaikan
              }
            }
          }
        }
      }
    }
  }

  // Bangun peta rentang token IIFE Rotator yang wajib dihapus (termasuk ';' atau ',' pemisah)
  const removeRanges = rotatorIifes.map((rot) => {
    let rStart = rot.start;
    let rEnd = rot.end;
    if (sig[rEnd]?.value === ';') {
      rEnd += 1;
    } else if (sig[rEnd]?.value === ',') {
      rEnd += 1;
    } else if (rStart > 0 && sig[rStart - 1]?.value === ',') {
      rStart -= 1;
    }
    return [rStart, rEnd];
  });

  // Ganti seluruh pemanggilan _0xdec(arg1, arg2, ...) di luar fungsi dekoder & rotator
  const decoderFnMap = vm.runInContext('__cipiDecoders', ctx);
  let restoredCount = 0;
  const rewritten = [];

  for (let i = 0; i < sig.length; i += 1) {
    const matchingRemove = removeRanges.find(([s, e]) => i >= s && i < e);
    if (matchingRemove) {
      i = matchingRemove[1] - 1;
      continue;
    }

    const tok = sig[i];
    const prev = rewritten[rewritten.length - 1] || null;

    if (
      !isInPreamble(i) &&
      tok.type === 'ident' &&
      aliasToDecoder.has(tok.value) &&
      sig[i + 1]?.value === '(' &&
      prev?.value !== '.' &&
      prev?.value !== '?.' &&
      prev?.value !== 'function'
    ) {
      const callClose = findMatchingClose(sig, i + 1);
      if (callClose !== -1) {
        const rawArgSpans = splitCallArgs(sig, i + 1, callClose);
        if (rawArgSpans && rawArgSpans.length >= 1 && rawArgSpans.length <= 8) {
          const evaluatedArgs = [];
          let allOk = true;
          for (const sp of rawArgSpans) {
            const ev = evalPureConstArgTokens(sig, sp.start, sp.end);
            if (!ev.ok) {
              allOk = false;
              break;
            }
            evaluatedArgs.push(ev.value);
          }
          if (allOk) {
            try {
              const vmTargetKey = aliasToDecoder.get(tok.value);
              const fn = decoderFnMap[vmTargetKey];
              const strVal = typeof fn === 'function' ? fn(...evaluatedArgs) : null;
              if (typeof strVal === 'string') {
                rewritten.push({ type: 'string', value: encodeJsStringLiteral(strVal, "'") });
                restoredCount += 1;
                i = callClose;
                continue;
              }
            } catch {
              // Biarkan pemanggilan tersebut bila argumen di luar indeks
            }
          }
        }
      }
    }

    if (!isInPreamble(i) && tok.type === 'template' && tok.value.includes('${')) {
      const rewriteInnerCalls = (exprSrc) => {
        const subTokens = tokenizeJs(exprSrc).filter((st) => st.type !== 'ws' && st.type !== 'comment');
        const subOut = [];
        for (let k = 0; k < subTokens.length; k += 1) {
          const st = subTokens[k];
          const sprev = subOut[subOut.length - 1] || null;
          if (st.type === 'template' && st.value.includes('${')) {
            subOut.push({ type: 'template', value: transformTemplateExpressions(st.value, rewriteInnerCalls, true) });
            continue;
          }
          if (
            st.type === 'ident' &&
            aliasToDecoder.has(st.value) &&
            subTokens[k + 1]?.value === '(' &&
            sprev?.value !== '.' &&
            sprev?.value !== '?.'
          ) {
            const cClose = findMatchingClose(subTokens, k + 1);
            if (cClose !== -1) {
              const aSpans = splitCallArgs(subTokens, k + 1, cClose);
              if (aSpans && aSpans.length >= 1 && aSpans.length <= 8) {
                const evArgs = [];
                let ok = true;
                for (const sp of aSpans) {
                  const ev = evalPureConstArgTokens(subTokens, sp.start, sp.end);
                  if (!ev.ok) {
                    ok = false;
                    break;
                  }
                  evArgs.push(ev.value);
                }
                if (ok) {
                  try {
                    const fn = decoderFnMap[aliasToDecoder.get(st.value)];
                    const sVal = typeof fn === 'function' ? fn(...evArgs) : null;
                    if (typeof sVal === 'string') {
                      subOut.push({ type: 'string', value: encodeJsStringLiteral(sVal, "'") });
                      restoredCount += 1;
                      k = cClose;
                      continue;
                    }
                  } catch {
                    // Abaikan
                  }
                }
              }
            }
          }
          subOut.push(st);
        }
        return simplifyObfuscatedTokens(reconstructFromSigSlice(subOut, 0, subOut.length));
      };

      const newTpl = transformTemplateExpressions(tok.value, rewriteInnerCalls, true);
      rewritten.push({ type: 'template', value: newTpl });
      continue;
    }

    rewritten.push(tok);
  }

  if (restoredCount === 0) {
    return { code, restoredCount: 0 };
  }

  // Bersihkan seluruh alias mati & fungsi dekoder/array yang sudah tidak dipakai lagi
  const cleanedTokens = pruneDeadObfuscatorArtifacts(rewritten, removableVarNames, removableFuncNames);
  const candidate = `${shebang}${reconstructFromSigSlice(cleanedTokens, 0, cleanedTokens.length)}`;
  if (verifyJsSyntax(candidate)) {
    return { code: candidate, restoredCount };
  }

  const fallback = `${shebang}${reconstructFromSigSlice(rewritten, 0, rewritten.length)}`;
  if (verifyJsSyntax(fallback)) {
    return { code: fallback, restoredCount };
  }
  return { code, restoredCount: 0 };
}

/**
 * Inline objek dispatcher Control-Flow Flattening murni:
 * const _0xabc = { 'k1': 'utf-8', 'k2': function(a,b){ return a + b; }, 'k3': function(f,x){ return f(x); } };
 */
function inlineControlFlowProxyObjects(code = '') {
  const allTokens = tokenizeJs(code);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  const sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');
  if (sig.length < 10) return code;

  const ALLOWED_PROXY_BIN_OPS = new Set([
    '+', '-', '*', '/', '%', '===', '!==', '==', '!=',
    '<', '<=', '>', '>=', '&&', '||', '??',
    '|', '&', '^', '<<', '>>', '>>>', 'in', 'instanceof',
  ]);

  const proxyObjects = new Map();

  for (let i = 0; i + 4 < sig.length; i += 1) {
    if (
      sig[i].type === 'ident' &&
      /^_0x[0-9a-fA-F]{2,}$/i.test(sig[i].value) &&
      sig[i - 1]?.value !== '.' &&
      sig[i + 1]?.value === '=' &&
      sig[i + 2]?.value === '{'
    ) {
      const objName = sig[i].value;
      const braceClose = findMatchingClose(sig, i + 2);
      if (braceClose === -1 || proxyObjects.has(objName)) continue;

      // Pastikan objName tidak pernah dimutasi atau dikirim sebagai nilai utuh di luar deklarasinya
      let safeUsage = true;
      for (let u = 0; u < sig.length; u += 1) {
        if (u === i) {
          u = braceClose;
          continue;
        }
        if (sig[u].type === 'ident' && sig[u].value === objName) {
          if (sig[u + 1]?.value === '.' && sig[u + 2]?.type === 'ident') {
            if (sig[u + 3]?.value === '=') {
              safeUsage = false;
              break;
            }
          } else if (
            sig[u + 1]?.value === '[' &&
            sig[u + 2]?.type === 'string' &&
            sig[u + 3]?.value === ']'
          ) {
            if (sig[u + 4]?.value === '=') {
              safeUsage = false;
              break;
            }
          } else {
            safeUsage = false;
            break;
          }
        }
      }
      if (!safeUsage) continue;

      // Parse entri properti murni di dalam { ... }
      const entries = new Map();
      let cur = i + 3;
      let allEntriesPure = true;

      while (cur < braceClose) {
        let keyName = null;
        if (sig[cur]?.type === 'string' && sig[cur + 1]?.value === ':') {
          keyName = decodeJsStringLiteral(sig[cur].value);
          cur += 2;
        } else if (sig[cur]?.type === 'ident' && sig[cur + 1]?.value === ':') {
          keyName = sig[cur].value;
          cur += 2;
        } else {
          allEntriesPure = false;
          break;
        }

        // Entri 1: Literal string / angka / boolean
        if (
          (sig[cur]?.type === 'string' ||
            sig[cur]?.type === 'number' ||
            (sig[cur]?.type === 'ident' && (sig[cur].value === 'true' || sig[cur].value === 'false'))) &&
          (sig[cur + 1]?.value === ',' || cur + 1 === braceClose)
        ) {
          entries.set(keyName, { kind: 'literal', token: sig[cur] });
          cur += sig[cur + 1]?.value === ',' ? 2 : 1;
          continue;
        }

        // Entri 2: function(p0, p1, ...) { return ...; }
        if (sig[cur]?.value === 'function' && sig[cur + 1]?.value === '(') {
          const pClose = findMatchingClose(sig, cur + 1);
          if (pClose !== -1 && sig[pClose + 1]?.value === '{') {
            const bClose = findMatchingClose(sig, pClose + 1);
            const params = parseParamList(sig, cur + 1, pClose);
            if (bClose !== -1 && bClose < braceClose && params && sig[pClose + 2]?.value === 'return') {
              const retStart = pClose + 3;
              let retEnd = bClose;
              if (sig[retEnd - 1]?.value === ';') retEnd -= 1;

              // 2A: Binary op: return p0 <op> p1
              if (
                params.length === 2 &&
                retEnd - retStart === 3 &&
                sig[retStart]?.value === params[0] &&
                ALLOWED_PROXY_BIN_OPS.has(sig[retStart + 1]?.value) &&
                sig[retStart + 2]?.value === params[1]
              ) {
                entries.set(keyName, { kind: 'binop', opTok: sig[retStart + 1] });
                cur = bClose + 1;
                if (sig[cur]?.value === ',') cur += 1;
                continue;
              }

              // 2B: Call forwarder: return p0(p1, p2, ...)
              if (
                params.length >= 1 &&
                sig[retStart]?.value === params[0] &&
                sig[retStart + 1]?.value === '(' &&
                sig[retEnd - 1]?.value === ')'
              ) {
                const fwdParams = parseParamList(sig, retStart + 1, retEnd - 1);
                if (
                  fwdParams &&
                  fwdParams.length === params.length - 1 &&
                  fwdParams.every((fp, idx) => fp === params[idx + 1])
                ) {
                  entries.set(keyName, { kind: 'call', arity: params.length });
                  cur = bClose + 1;
                  if (sig[cur]?.value === ',') cur += 1;
                  continue;
                }
              }
            }
          }
        }

        allEntriesPure = false;
        break;
      }

      if (allEntriesPure && entries.size > 0) {
        proxyObjects.set(objName, entries);
      }
      i = braceClose;
    }
  }

  if (proxyObjects.size === 0) return code;

  let inlinedAny = false;
  let working = sig;

  for (let pass = 0; pass < 3; pass += 1) {
    let passChanged = false;
    const out = [];

    for (let i = 0; i < working.length; i += 1) {
      const tok = working[i];
      if (tok.type === 'ident' && proxyObjects.has(tok.value)) {
        const entries = proxyObjects.get(tok.value);
        let propKey = null;
        let afterAccessIdx = -1;

        if (working[i + 1]?.value === '.' && working[i + 2]?.type === 'ident') {
          propKey = working[i + 2].value;
          afterAccessIdx = i + 3;
        } else if (
          working[i + 1]?.value === '[' &&
          working[i + 2]?.type === 'string' &&
          working[i + 3]?.value === ']'
        ) {
          propKey = decodeJsStringLiteral(working[i + 2].value);
          afterAccessIdx = i + 4;
        }

        const spec = propKey !== null ? entries.get(propKey) : null;
        if (spec) {
          if (spec.kind === 'literal' && working[afterAccessIdx]?.value !== '(') {
            out.push(spec.token);
            i = afterAccessIdx - 1;
            inlinedAny = true;
            passChanged = true;
            continue;
          }

          if ((spec.kind === 'binop' || spec.kind === 'call') && working[afterAccessIdx]?.value === '(') {
            const callClose = findMatchingClose(working, afterAccessIdx);
            if (callClose !== -1) {
              const callArgs = splitCallArgs(working, afterAccessIdx, callClose);
              if (spec.kind === 'binop' && callArgs && callArgs.length === 2) {
                const wrapL = callArgs[0].end - callArgs[0].start > 1;
                const wrapR = callArgs[1].end - callArgs[1].start > 1;
                out.push({ type: 'punct', value: '(' });
                if (wrapL) out.push({ type: 'punct', value: '(' });
                for (let k = callArgs[0].start; k < callArgs[0].end; k += 1) out.push(working[k]);
                if (wrapL) out.push({ type: 'punct', value: ')' });
                out.push(spec.opTok);
                if (wrapR) out.push({ type: 'punct', value: '(' });
                for (let k = callArgs[1].start; k < callArgs[1].end; k += 1) out.push(working[k]);
                if (wrapR) out.push({ type: 'punct', value: ')' });
                out.push({ type: 'punct', value: ')' });
                i = callClose;
                inlinedAny = true;
                passChanged = true;
                continue;
              }
              if (spec.kind === 'call' && callArgs && callArgs.length === spec.arity) {
                for (let k = callArgs[0].start; k < callArgs[0].end; k += 1) out.push(working[k]);
                out.push({ type: 'punct', value: '(' });
                for (let aIdx = 1; aIdx < callArgs.length; aIdx += 1) {
                  if (aIdx > 1) out.push({ type: 'punct', value: ',' });
                  for (let k = callArgs[aIdx].start; k < callArgs[aIdx].end; k += 1) out.push(working[k]);
                }
                out.push({ type: 'punct', value: ')' });
                i = callClose;
                inlinedAny = true;
                passChanged = true;
                continue;
              }
            }
          }
        }
      }
      out.push(tok);
    }

    working = out;
    if (!passChanged) break;
  }

  if (!inlinedAny) return code;

  const pruned = pruneDeadObfuscatorArtifacts(working, new Set(proxyObjects.keys()), new Set());
  const candidate = `${shebang}${reconstructFromSigSlice(pruned, 0, pruned.length)}`;
  return verifyJsSyntax(candidate) ? candidate : code;
}

const ARITH_LEFT_BOUNDARIES = new Set([
  '(', '[', ',', ';', '=', ':', '?', '==', '===', '!=', '!==',
  '<', '<=', '>', '>=', '+=', '-=', '*=', '&&', '||', '??', '=>',
  'return', 'throw', 'case',
]);

const ARITH_RIGHT_BOUNDARIES = new Set([
  ')', ']', ',', ';', ':', '}', '==', '===', '!=', '!==',
  '<', '<=', '>', '>=', '&&', '||', '??', '?',
]);

/**
 * Penyederhanaan token obfuscation ("Disempurnakan"):
 * - Unescape \xNN & \uNNNN menjadi teks bersih (tetap menjaga \x1b ANSI escape tetap aman)
 * - Konversi hex integer & lipat ekspresi angka terenkripsi (-0x1388 + -0x2 * -0x9c4 + 0x1388 -> 5000)
 * - String.fromCharCode(...) -> '...' & penggabungan 'con' + 'sole' -> 'console'
 * - !![] -> true, ![] -> false
 * - console['log'] -> console.log, {'httpsAgent': agent} -> { httpsAgent: agent }
 */
function simplifyObfuscatedTokens(code = '') {
  const allTokens = tokenizeJs(code);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  let sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');

  // Pass A: Unescape string literal & konversi hex integer ke desimal bersih
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

  // Pass B: Lipat ekspresi konstan (!![], ![], aritmatika konstan, String.fromCharCode, 'a' + 'b')
  for (let pass = 0; pass < 4; pass += 1) {
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

      // String.fromCharCode(65, 66, ...)
      if (
        sig[i]?.value === 'String' &&
        sig[i + 1]?.value === '.' &&
        sig[i + 2]?.value === 'fromCharCode' &&
        sig[i + 3]?.value === '('
      ) {
        const cClose = findMatchingClose(sig, i + 3);
        if (cClose !== -1) {
          const argSpans = splitCallArgs(sig, i + 3, cClose);
          if (argSpans && argSpans.length > 0) {
            const codes = [];
            let ok = true;
            for (const sp of argSpans) {
              const ev = evalPureConstArgTokens(sig, sp.start, sp.end);
              if (!ev.ok || typeof ev.value !== 'number') {
                ok = false;
                break;
              }
              codes.push(ev.value);
            }
            if (ok) {
              const str = codes.map((c) => String.fromCharCode(c)).join('');
              nextSig.push({ type: 'string', value: encodeJsStringLiteral(str, "'") });
              i = cClose;
              continue;
            }
          }
        }
      }

      // Penggabungan string konstan beruntun 'a' + 'b' + 'c' (aman dari 'x = ' + a + 'b' bila a variabel)
      if (
        sig[i]?.type === 'string' &&
        sig[i + 1]?.value === '+' &&
        sig[i + 2]?.type === 'string' &&
        nextSig[nextSig.length - 1]?.value !== '+'
      ) {
        let merged = decodeJsStringLiteral(sig[i].value);
        let j = i;
        while (sig[j + 1]?.value === '+' && sig[j + 2]?.type === 'string') {
          merged += decodeJsStringLiteral(sig[j + 2].value);
          j += 2;
        }
        nextSig.push({ type: 'string', value: encodeJsStringLiteral(merged, "'") });
        i = j;
        continue;
      }

      // Pelipatan rantai aritmatika angka terenkripsi (numbersToExpressions): -0x1388 + -0x2 * -0x9c4 + 0x1388 -> 5000
      const prevOut = nextSig[nextSig.length - 1] || null;
      if (
        (!prevOut || ARITH_LEFT_BOUNDARIES.has(prevOut.value)) &&
        (sig[i]?.type === 'number' ||
          sig[i]?.value === '(' ||
          ((sig[i]?.value === '-' || sig[i]?.value === '+') && sig[i + 1]?.type === 'number'))
      ) {
        let endArith = i;
        let pDepth = 0;
        let hasOperator = false;
        let hasNumber = false;
        while (endArith < sig.length) {
          const tk = sig[endArith];
          if (tk.type === 'number' && !tk.value.endsWith('n')) {
            hasNumber = true;
            endArith += 1;
          } else if (tk.value === '(') {
            pDepth += 1;
            endArith += 1;
          } else if (tk.value === ')' && pDepth > 0) {
            pDepth -= 1;
            endArith += 1;
          } else if (['+', '-', '*', '%', '^', '&', '|', '<<', '>>', '>>>'].includes(tk.value)) {
            if (endArith > i) hasOperator = true;
            endArith += 1;
          } else {
            break;
          }
        }
        const rightTok = sig[endArith];
        if (
          pDepth === 0 &&
          hasNumber &&
          hasOperator &&
          endArith - i >= 3 &&
          (!rightTok || ARITH_RIGHT_BOUNDARIES.has(rightTok.value))
        ) {
          const ev = evalPureConstArgTokens(sig, i, endArith);
          if (ev.ok && typeof ev.value === 'number' && Number.isSafeInteger(ev.value)) {
            if (ev.value < 0) {
              nextSig.push({ type: 'punct', value: '-' });
              nextSig.push({ type: 'number', value: String(Math.abs(ev.value)) });
            } else {
              nextSig.push({ type: 'number', value: String(ev.value) });
            }
            i = endArith - 1;
            continue;
          }
        }
      }

      nextSig.push(sig[i]);
    }
    sig = nextSig;
  }

  // Pass C: Ubah bracket property obj['log'] -> obj.log & unquote key objek {'httpsAgent': agent} -> { httpsAgent: agent }
  const cleanProps = [];
  for (let i = 0; i < sig.length; i += 1) {
    const prev = cleanProps[cleanProps.length - 1] || null;

    // Unquote key objek string {'httpsAgent': agent} -> { httpsAgent: agent }
    if (
      sig[i]?.type === 'string' &&
      sig[i + 1]?.value === ':' &&
      prev &&
      (prev.value === '{' || prev.value === ',')
    ) {
      // Pastikan bukan cabang ternary '? "str" : ...' (prev adalah '{' atau ',')
      const keyName = decodeJsStringLiteral(sig[i].value);
      if (VALID_IDENT_RE.test(keyName) && !JS_KEYWORDS.has(keyName) && keyName !== '__proto__') {
        cleanProps.push({ type: 'ident', value: keyName });
        continue;
      }
    }

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
        // Kasus 2: Key objek terkomputasi { ['name']: 1 } atau { ['execute'](ctx) {} }
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
 * Rapikan nama variabel/parameter lokal acak _0x[0-9a-f]{3,} menjadi nama bersih yang mudah dibaca
 * menggunakan alpha-renaming bijektif bebas bentrok (tanpa pernah menyentuh properti objek atau nama asli).
 */
function humanizeHexIdentifiers(code = '') {
  const allTokens = tokenizeJs(code);
  const shebang = allTokens[0]?.type === 'shebang' ? `${allTokens[0].value}\n` : '';
  const sig = allTokens.filter((t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'shebang');
  if (sig.length === 0) return { code, renamedCount: 0 };

  // Jika kode akhir masih memakai eval(...) dinamis, jangan ganti nama variabel lokal demi keamanan referensi string
  if (sig.some((t) => t.type === 'ident' && t.value === 'eval')) {
    return { code, renamedCount: 0 };
  }

  const usedNames = new Set(RESERVED_GLOBAL_NAMES);
  const doNotRename = new Set();
  const hexCandidates = [];
  const seenHex = new Set();

  for (let i = 0; i < sig.length; i += 1) {
    const t = sig[i];
    if (t.type === 'template') {
      collectIdentsFromToken(t, (id) => {
        usedNames.add(id);
        if (/^_0x[0-9a-fA-F]{3,}$/i.test(id) && !seenHex.has(id)) {
          seenHex.add(id);
          hexCandidates.push({ name: id, firstIdx: i });
        }
      });
      continue;
    }
    if (t.type !== 'ident') continue;
    usedNames.add(t.value);

    if (!/^_0x[0-9a-fA-F]{3,}$/i.test(t.value)) continue;

    const prev = i > 0 ? sig[i - 1] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;

    // Jangan pernah me-rename properti member (. _0x), key objek ({ _0x: 1 }), atau shorthand objek ({ _0x })
    if (
      prev?.value === '.' ||
      prev?.value === '?.' ||
      ((prev?.value === '{' || prev?.value === ',') &&
        (next?.value === ':' || next?.value === '}' || (prev?.value === '{' && next?.value === ',')))
    ) {
      doNotRename.add(t.value);
      continue;
    }

    if (!seenHex.has(t.value)) {
      seenHex.add(t.value);
      hexCandidates.push({ name: t.value, firstIdx: i });
    }
  }

  if (hexCandidates.length === 0) {
    return { code, renamedCount: 0 };
  }

  const counters = Object.create(null);
  const allocFreshName = (base, allowBare = false) => {
    const cleanBase = VALID_IDENT_RE.test(base) && !RESERVED_GLOBAL_NAMES.has(base) ? base : 'val';
    if (allowBare && !usedNames.has(cleanBase)) {
      usedNames.add(cleanBase);
      return cleanBase;
    }
    let idx = (counters[cleanBase] || 0) + 1;
    while (usedNames.has(`${cleanBase}${idx}`)) idx += 1;
    counters[cleanBase] = idx;
    const chosen = `${cleanBase}${idx}`;
    usedNames.add(chosen);
    return chosen;
  };

  // Tentukan nama kontekstual berdasarkan posisi kemunculan pertama masing-masing variabel _0x
  const renameMap = new Map();
  for (let i = 0; i < sig.length; i += 1) {
    const t = sig[i];
    if (t.type !== 'ident' || !seenHex.has(t.value) || doNotRename.has(t.value) || renameMap.has(t.value)) {
      continue;
    }

    const prev = i > 0 ? sig[i - 1] : null;
    const prev2 = i > 1 ? sig[i - 2] : null;
    const next = i + 1 < sig.length ? sig[i + 1] : null;
    const next2 = i + 2 < sig.length ? sig[i + 2] : null;

    // 1. catch (_0x...) -> err
    if (prev?.value === '(' && prev2?.value === 'catch') {
      renameMap.set(t.value, allocFreshName('err', true));
      continue;
    }

    // 2. new Promise((_0xres, _0xrej) => ...)
    if (
      prev?.value === '(' &&
      prev2?.value === '(' &&
      sig[i - 3]?.value === 'Promise'
    ) {
      renameMap.set(t.value, allocFreshName('resolve', true));
      if (next?.value === ',' && next2?.type === 'ident' && /^_0x[0-9a-fA-F]{3,}$/i.test(next2.value) && !doNotRename.has(next2.value)) {
        renameMap.set(next2.value, allocFreshName('reject', true));
      }
      continue;
    }

    // 3. .then(_0xres => ...) atau .catch(_0xerr => ...)
    if (prev?.value === '(' && prev2?.value === 'then') {
      renameMap.set(t.value, allocFreshName('res', true));
      continue;
    }
    if (prev?.value === '(' && prev2?.value === 'catch') {
      renameMap.set(t.value, allocFreshName('err', true));
      continue;
    }

    // 4. Loop for (var/let _0xidx = 0; ...)
    if (
      ['var', 'let'].includes(prev?.value) &&
      prev2?.value === '(' &&
      sig[i - 3]?.value === 'for'
    ) {
      const loopSingle = ['i', 'j', 'k'].find((ch) => !usedNames.has(ch));
      if (loopSingle) {
        usedNames.add(loopSingle);
        renameMap.set(t.value, loopSingle);
      } else {
        renameMap.set(t.value, allocFreshName('idx', false));
      }
      continue;
    }

    // 5. Destructuring { status: _0x4eb5cb } -> statusVal
    if (prev?.value === ':' && prev2?.type === 'ident' && !/^_0x/i.test(prev2.value)) {
      renameMap.set(t.value, allocFreshName(`${prev2.value}Val`, true));
      continue;
    }

    // 6. function _0xfn(...) -> fn1
    if (prev?.value === 'function') {
      renameMap.set(t.value, allocFreshName('fn', false));
      continue;
    }

    // 7. Parameter fungsi: function name(_0xp1, _0xp2) atau arrow _0xp =>
    if (next?.value === '=>') {
      renameMap.set(t.value, allocFreshName('item', false));
      continue;
    }
    if (
      (prev?.value === '(' && prev2?.type === 'ident' && prev2.value !== 'if' && prev2.value !== 'while' && prev2.value !== 'switch') ||
      (prev?.value === ',' && renameMap.size > 0)
    ) {
      // Cek apakah sedang di daftar parameter ( ... ) diikuti '{' atau '=>'
      let scanP = i;
      let pDepth = 1;
      while (scanP < sig.length && pDepth > 0) {
        if (sig[scanP].value === '(') pDepth += 1;
        else if (sig[scanP].value === ')') pDepth -= 1;
        scanP += 1;
      }
      if (sig[scanP]?.value === '=>' || (sig[scanP]?.value === '{' && sig[i - 2]?.value !== 'if')) {
        renameMap.set(t.value, allocFreshName('arg', false));
        continue;
      }
    }

    // 8. Inisialisasi regex: _0x... = /.../
    if (next?.value === '=' && next2?.type === 'regex') {
      renameMap.set(t.value, allocFreshName('regex', false));
      continue;
    }

    // 9. Variabel umum
    renameMap.set(t.value, allocFreshName('val', false));
  }

  if (renameMap.size === 0) {
    return { code, renamedCount: 0 };
  }

  const applyRenameToTemplate = (tplRaw) =>
    transformTemplateExpressions(tplRaw, (innerSrc) => {
      const subTokens = tokenizeJs(innerSrc).filter((st) => st.type !== 'ws' && st.type !== 'comment');
      const mapped = subTokens.map((st) => {
        if (st.type === 'ident' && renameMap.has(st.value)) {
          return { type: 'ident', value: renameMap.get(st.value) };
        }
        if (st.type === 'template' && st.value.includes('${')) {
          return { type: 'template', value: applyRenameToTemplate(st.value) };
        }
        return st;
      });
      return reconstructFromSigSlice(mapped, 0, mapped.length);
    });

  const renamedSig = sig.map((t) => {
    if (t.type === 'ident' && renameMap.has(t.value)) {
      return { type: 'ident', value: renameMap.get(t.value) };
    }
    if (t.type === 'template' && t.value.includes('${')) {
      return { type: 'template', value: applyRenameToTemplate(t.value) };
    }
    return t;
  });

  const candidate = `${shebang}${reconstructFromSigSlice(renamedSig, 0, renamedSig.length)}`;
  if (verifyJsSyntax(candidate)) {
    return { code: candidate, renamedCount: renameMap.size };
  }
  return { code, renamedCount: 0 };
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
  const delimStack = [];
  let inTopVarDecl = false;
  let extraVarIndent = 0;
  let out = '';
  let atLineStart = true;

  const topDelim = () => (delimStack.length > 0 ? delimStack[delimStack.length - 1] : null);

  const writeIndent = () => {
    if (atLineStart) {
      out += '  '.repeat(Math.max(0, indent + extraVarIndent));
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
    const prev2 = i > 1 ? sig[i - 2] : null;
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

    if (
      topDelim() === null &&
      tok.type === 'ident' &&
      ['const', 'let', 'var'].includes(tok.value)
    ) {
      inTopVarDecl = true;
    }

    if (tok.type === 'punct') {
      const v = tok.value;

      if (v === '(') {
        writeIndent();
        if (
          prev?.type === 'ident' &&
          ['if', 'for', 'while', 'switch', 'catch'].includes(prev.value) &&
          prev2?.value !== '.' &&
          prev2?.value !== '?.'
        ) {
          if (!out.endsWith(' ')) out += ' ';
        }
        out += '(';
        parenDepth += 1;
        delimStack.push(prev?.type === 'ident' && prev.value === 'for' && prev2?.value !== '.' ? 'for(' : '(');
        continue;
      }

      if (v === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        if (topDelim() === '(' || topDelim() === 'for(') delimStack.pop();
        writeIndent();
        out += ')';
        if (
          next &&
          (next.value === '{' || next.value === '=>' || next.type === 'ident' || next.type === 'string' || next.type === 'number')
        ) {
          out += ' ';
        }
        continue;
      }

      if (v === '[') {
        writeIndent();
        out += '[';
        bracketDepth += 1;
        delimStack.push('[');
        continue;
      }

      if (v === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        if (topDelim() === '[') delimStack.pop();
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
        extraVarIndent = 0;
        delimStack.push('{');
        writeNewline();
        continue;
      }

      if (v === '}') {
        indent = Math.max(0, indent - 1);
        if (topDelim() === '{') delimStack.pop();
        if (!atLineStart) writeNewline();
        writeIndent();
        out += '}';
        if (
          next &&
          ((next.type === 'ident' && ['else', 'catch', 'finally', 'while'].includes(next.value)) ||
            next.value === ';' ||
            next.value === ',' ||
            next.value === ')' ||
            next.value === '.' ||
            next.value === '=')
        ) {
          if (next.type === 'ident' || next.value === '=') out += ' ';
        } else if (next) {
          writeNewline();
        }
        continue;
      }

      if (v === ';') {
        writeIndent();
        out += ';';
        const td = topDelim();
        if (td === null || td === '{') {
          if (td === null) {
            inTopVarDecl = false;
            extraVarIndent = 0;
          }
          if (next) writeNewline();
        } else if (next && next.value !== ')') {
          out += ' ';
        }
        continue;
      }

      if (v === ',') {
        writeIndent();
        out += ',';
        const td = topDelim();
        if ((td === null || td === '{') && next && next.value !== '}') {
          if (td === null && inTopVarDecl) {
            extraVarIndent = 1;
          }
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
  let identifiersRenamed = 0;
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

    // 3. Cek _0x String-Array + Rotator + Hoisted Decoder + Local Wrappers
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

    // 4. Inline objek proxy Control-Flow Flattening (_0xabc.xyz(a, b) -> a + b)
    const proxyInlined = inlineControlFlowProxyObjects(working);
    if (proxyInlined !== working) {
      working = proxyInlined;
      if (!detectedTechniques.includes('Control-Flow Proxy Inliner')) {
        detectedTechniques.push('Control-Flow Proxy Inliner');
      }
      changed = true;
    }

    // 5. Penyederhanaan ekspresi terenkripsi (\xNN, !![], numbersToExpressions, bracket property)
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

  // 6. Rapikan seluruh nama variabel/parameter lokal _0x... menjadi nama bersih yang manusiawi
  const humanized = humanizeHexIdentifiers(working);
  if (humanized.renamedCount > 0 && humanized.code !== working) {
    working = humanized.code;
    identifiersRenamed = humanized.renamedCount;
    if (!detectedTechniques.includes('_0x Variable Humanizer')) {
      detectedTechniques.push('_0x Variable Humanizer');
    }
  }

  // 7. Rapikan & sempurnakan format kode JavaScript (2-space indent)
  const beautified = beautifyJavaScript(working);
  if (beautified !== working && !detectedTechniques.includes('JS Beautifier')) {
    detectedTechniques.push('JS Beautifier');
  }

  return {
    code: beautified,
    layersUnpacked,
    stringsRestored: totalStringsRestored,
    identifiersRenamed,
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

