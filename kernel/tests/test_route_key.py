import re

from copper_boards import R0603, board, fp, track
import pytest

from pino_kernel.routing.key import PARTS, RouteKey, labels_only, route_key, stale_reasons
from pino_kernel.routing.plan import plan_route
from pino_kernel.sexpr import dump, parse
from route_cases import DRU_2L, PRO_2L, pro


def board_text(*, r1="10k", r1_at=(0, 0), r1_pad1_net="A", silk="", uuid=None, tracks=()):
    return board(footprints=[fp("R1", (*r1_at, 0), R0603, nets={"1": r1_pad1_net, "2": "B"}, value=r1, silk=silk, uuid=uuid),
                             fp("R2", (5, 0, 0), R0603, nets={"1": "A", "2": "B"}, value="1k")], tracks=tracks)


PLAN = plan_route(board_text(), PRO_2L, DRU_2L)


def test_value_change_keeps_the_key():
    assert route_key(board_text(r1="10k"), PRO_2L, DRU_2L, PLAN).key == route_key(board_text(r1="4.7k"), PRO_2L, DRU_2L, PLAN).key


def test_move_and_net_change_name_the_reason():
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    assert stale_reasons(a, route_key(board_text(r1_at=(3, 0)), PRO_2L, DRU_2L, PLAN)) == ["parts moved"]
    assert stale_reasons(a, route_key(board_text(r1_pad1_net="C"), PRO_2L, DRU_2L, PLAN)) == ["connections changed"]
    assert stale_reasons(a, route_key(board_text(), pro(clearance=0.25), DRU_2L, PLAN)) == ["rules changed"]
    assert stale_reasons(a, route_key(board_text(), PRO_2L, DRU_2L, PLAN, router_id="other")) == ["router or kernel version changed"]


def test_key_ignores_uuids_silk_and_formatting():
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN).key
    assert route_key(board_text(uuid="99999999-9999-4999-8999-999999999999", silk="hello"), PRO_2L, DRU_2L, PLAN).key == a
    flat = dump(parse(board_text())).replace("\n", " ").replace("\t", " ")
    assert route_key(flat, PRO_2L, DRU_2L, PLAN).key == a


def test_a_moved_or_hidden_label_changes_the_key():
    # the routed board is the build's board with the copper on it, so a label moved by board.py needs a new one
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    text = board_text()
    assert text.count("(at 0 -1.5 0)") == 2
    moved = text.replace("(at 0 -1.5 0)", "(at 0 1.6 90)", 1)
    assert stale_reasons(a, route_key(moved, PRO_2L, DRU_2L, PLAN)) == ["labels moved"]
    hidden = text.replace('(layer "F.SilkS")', '(layer "F.SilkS") (hide yes)', 1)
    assert stale_reasons(a, route_key(hidden, PRO_2L, DRU_2L, PLAN)) == ["labels moved"]
    # with a part moved too, the move is the reason
    both = board_text(r1_at=(3, 0)).replace("(at 0 -1.5 0)", "(at 0 1.6 90)", 1)
    assert stale_reasons(a, route_key(both, PRO_2L, DRU_2L, PLAN)) == ["parts moved"]


def test_kept_copper_changes_the_key():
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    b = route_key(board_text(tracks=[track("A", (-4.2, 0), (4.2, 0), locked=True)]), PRO_2L, DRU_2L, PLAN)
    assert stale_reasons(a, b) == ["kept copper changed"]


def test_unlocked_copper_does_not_change_the_key():
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    assert route_key(board_text(tracks=[track("A", (-4.2, 0), (4.2, 0))]), PRO_2L, DRU_2L, PLAN).key == a.key


def test_key_is_twelve_hex_and_round_trips():
    k = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    assert re.fullmatch(r"[0-9a-f]{12}", k.key) and list(k.parts) == list(PARTS)
    assert RouteKey.from_json(k.to_json()) == k


def keys_differing_in(*names):
    old = RouteKey("000000000000", {k: "a" for k in PARTS})
    return old, RouteKey("111111111111", {k: ("b" if k in names else "a") for k in PARTS})


def test_labels_only_when_the_labels_alone_differ():
    assert labels_only(*keys_differing_in("labels"))
    assert not labels_only(*keys_differing_in())  # the same board is a cached route, not a reuse
    old, new = keys_differing_in("labels")
    assert not labels_only(RouteKey(old.key, {k: v for k, v in old.parts.items() if k != "router"}), new)


@pytest.mark.parametrize("part", [k for k in PARTS if k != "labels"])
def test_labels_only_is_false_when_anything_else_differs(part):
    assert not labels_only(*keys_differing_in(part))
    assert not labels_only(*keys_differing_in(part, "labels"))
