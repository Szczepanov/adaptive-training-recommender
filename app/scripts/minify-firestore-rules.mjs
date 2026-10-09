// Canonical lexical tokens, not an AST: string literals retain their exact spelling.
export function minifyRules(source) {
  if (typeof source !== 'string') throw new TypeError('Rules source must be a string.');
  const tokens = [];
  const word = /[A-Za-z_][A-Za-z_0-9]*/y;
  const number = /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (pair === '//') {
      while (index < source.length && !/[\r\n]/.test(source[index])) index += 1;
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new SyntaxError(`Unterminated block comment at ${index}.`);
      index = end + 2;
      continue;
    }
    if (pair === '*/') throw new SyntaxError(`Unexpected block comment terminator at ${index}.`);
    if (char === "'" || char === '"') {
      const start = index++;
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (/[\r\n\u0000-\u001f]/.test(current)) throw new SyntaxError(`Invalid string character at ${index - 1}.`);
        if (current === '\\') {
          if (index === source.length || /[\r\n\u0000-\u001f]/.test(source[index])) {
            throw new SyntaxError(`Invalid string escape at ${index - 1}.`);
          }
          index += 1;
        } else if (current === char) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new SyntaxError(`Unterminated string at ${start}.`);
      tokens.push(source.slice(start, index));
      continue;
    }
    const pattern = /[A-Za-z_]/.test(char) ? word : /[0-9]/.test(char) ? number : undefined;
    if (pattern) {
      pattern.lastIndex = index;
      const [token] = pattern.exec(source);
      tokens.push(token);
      index += token.length;
    } else if (['&&', '||', '==', '!=', '<=', '>=', '**', '$('].includes(pair)) {
      tokens.push(pair);
      index += 2;
    } else if (/[{}()[\];:,.\/+*%\-=!<>&|?$]/.test(char)) {
      tokens.push(char);
      index += 1;
    } else {
      throw new SyntaxError(`Unexpected rules character at ${index}.`);
    }
  }
  let previous = '';
  const compact = tokens.map((token) => {
    const boundary = previous.slice(-1) + token[0];
    const separate = (/^[A-Za-z_0-9'"]/.test(previous) && /^[A-Za-z_0-9'"]/.test(token))
      || (/^[0-9]/.test(previous) && token === '.')
      || (previous === '.' && /^[0-9]/.test(token))
      || ['&&', '||', '==', '!=', '<=', '>=', '**', '$(', '//', '/*', '*/'].includes(boundary);
    previous = token;
    return separate ? ` ${token}` : token;
  });
  // Rules paths and service names require compact punctuation; separate only merging tokens.
  return compact.join('');
}
