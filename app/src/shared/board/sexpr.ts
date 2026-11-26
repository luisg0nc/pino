// Ported from the board-view spike. Minimal S-expression reader for KiCad files. A node is [head, ...children]; atoms are strings
// (quoted strings are unescaped, numbers stay as text).
export type Node = Array<Node | string>;

export function parseSexpr(src: string): Node {
  const n = src.length;
  const stack: Node[] = [];
  let cur: Node = [];
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 40) { // (
      const child: Node = [];
      cur.push(child);
      stack.push(cur);
      cur = child;
      i++;
    } else if (c === 41) { // )
      const parent = stack.pop();
      if (!parent) throw new Error(`unbalanced ) at ${i}`);
      cur = parent;
      i++;
    } else if (c === 32 || c === 10 || c === 9 || c === 13) {
      i++;
    } else if (c === 34) { // "
      let j = i + 1;
      let escaped = false;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 92) { escaped = true; j += 2; continue; }
        if (d === 34) break;
        j++;
      }
      let s = src.slice(i + 1, j);
      if (escaped) s = s.replace(/\\(.)/g, (_, e) => (e === 'n' ? '\n' : e === 't' ? '\t' : e));
      cur.push(s);
      i = j + 1;
    } else {
      let j = i + 1;
      while (j < n) {
        const d = src.charCodeAt(j);
        if (d === 32 || d === 10 || d === 9 || d === 13 || d === 40 || d === 41) break;
        j++;
      }
      cur.push(src.slice(i, j));
      i = j;
    }
  }
  if (stack.length) throw new Error('unbalanced (');
  return cur[0] as Node;
}

export const kids = (node: Node, head: string): Node[] =>
  node.filter((c): c is Node => typeof c !== 'string' && c[0] === head);

export function kid(node: Node, head: string): Node | undefined {
  for (const c of node) if (typeof c !== 'string' && c[0] === head) return c;
  return undefined;
}

export const str = (node: Node, head: string): string | undefined => kid(node, head)?.[1] as string | undefined;

export function num(node: Node, head: string, fallback = 0): number {
  const v = kid(node, head)?.[1];
  return v === undefined ? fallback : Number(v);
}
