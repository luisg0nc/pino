from pino_kernel.sexpr import Sym, dump, find, find_all, num, parse


def test_parse_marks_bare_atoms_and_keeps_strings():
    node = parse('(kicad_pcb (version 20260206) (generator "pino") (net "GND"))')
    assert isinstance(node[0], Sym) and node[0] == "kicad_pcb"
    gen = find(node, "generator")[1]
    assert gen == "pino" and not isinstance(gen, Sym)
    assert parse(dump(node)) == node


def test_num_is_canonical():
    assert [num(1.0), num(-0.0), num(0.1 + 0.2), num(1.23456789), num(100)] == ["1", "0", "0.3", "1.234568", "100"]


def test_dump_escapes_and_indents_with_tabs():
    text = dump([Sym("property"), 'a"b\\c', [Sym("at"), num(1), num(2)]])
    assert '"a\\"b\\\\c"' in text and "\n\t(at 1 2)" in text


def test_find_all():
    assert [n[1] for n in find_all(parse("(a (b 1) (c) (b 2))"), "b")] == ["1", "2"]
