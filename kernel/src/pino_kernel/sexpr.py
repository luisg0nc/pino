"""Minimal KiCad S-expression reader and writer.

Nodes are Python lists. Atoms are either `Sym` (bare token: keywords, numbers, yes/no)
or plain `str` (a quoted string). Numbers stay as `Sym` text so a parsed footprint
re-emits exactly; computed numbers go through `num()`.
"""

from __future__ import annotations


class Sym(str):
    """A bare (unquoted) atom."""

    __slots__ = ()


def num(v: float) -> Sym:
    """Deterministic number text: up to 6 decimals, no trailing zeros, no -0."""
    if isinstance(v, int):
        return Sym(str(v))
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    return Sym(s)


def parse(text: str):
    i, n = 0, len(text)
    stack: list[list] = [[]]
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
        elif c == "(":
            stack.append([])
            i += 1
        elif c == ")":
            node = stack.pop()
            stack[-1].append(node)
            i += 1
        elif c == '"':
            j = i + 1
            buf = []
            while text[j] != '"':
                if text[j] == "\\":
                    nxt = text[j + 1]
                    buf.append({"n": "\n", "t": "\t", "\\": "\\", '"': '"'}.get(nxt, "\\" + nxt))
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            stack[-1].append("".join(buf))
            i = j + 1
        else:
            j = i
            while j < n and text[j] not in ' \t\r\n()"':
                j += 1
            stack[-1].append(Sym(text[i:j]))
            i = j
    assert len(stack) == 1 and len(stack[0]) == 1, "unbalanced s-expression"
    return stack[0][0]


def _atom(a) -> str:
    if isinstance(a, Sym):
        return str(a)
    if isinstance(a, bool):
        return "yes" if a else "no"
    if isinstance(a, (int, float)):
        return str(num(a))
    s = str(a).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{s}"'


# Lists that KiCad prints on one line even though they hold lists.
_INLINE_CHILDREN = {"pts"}


def dump(node, indent: int = 0) -> str:
    out: list[str] = []
    _dump(node, indent, out)
    return "".join(out)


def _dump(node, indent: int, out: list[str]) -> None:
    tab = "\t" * indent
    if not any(isinstance(c, list) for c in node):
        out.append(tab + "(" + " ".join(_atom(a) for a in node) + ")")
        return
    head = []
    rest = []
    for c in node:
        if rest or isinstance(c, list):
            rest.append(c)
        else:
            head.append(c)
    out.append(tab + "(" + " ".join(_atom(a) for a in head))
    if head and head[0] in _INLINE_CHILDREN:
        out.append("\n" + tab + "\t" + " ".join(dump(c) for c in rest))
    else:
        for c in rest:
            out.append("\n")
            if isinstance(c, list):
                _dump(c, indent + 1, out)
            else:
                out.append(tab + "\t" + _atom(c))
    out.append("\n" + tab + ")")


def find(node, key):
    for c in node:
        if isinstance(c, list) and c and c[0] == key:
            return c
    return None


def find_all(node, key):
    return [c for c in node if isinstance(c, list) and c and c[0] == key]
