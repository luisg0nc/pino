"""Plain JSON for pino's dataclasses: field order kept for lists, floats rounded to 6 places."""

from __future__ import annotations

import dataclasses
import types
import typing
from functools import cache
from typing import Any, Union

DECIMALS = 6


def encode(obj: Any) -> Any:
    if hasattr(obj, "__json__"):
        return obj.__json__()
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: encode(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, bool) or obj is None or isinstance(obj, (int, str)):
        return obj
    if isinstance(obj, float):
        v = round(obj, DECIMALS)
        return 0.0 if v == 0 else v
    if isinstance(obj, dict):
        return {str(k): encode(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [encode(v) for v in obj]
    raise TypeError(f"cannot write {type(obj).__name__} as JSON")


@cache
def _hints(cls) -> dict[str, Any]:
    return typing.get_type_hints(cls)


def _tuples(v: Any) -> Any:
    return tuple(_tuples(x) for x in v) if isinstance(v, list) else v


def decode(tp: Any, value: Any) -> Any:
    if value is None:
        return None
    if hasattr(tp, "__from_json__"):
        return tp.__from_json__(value)
    origin = typing.get_origin(tp)
    if origin in (Union, types.UnionType):
        args = [a for a in typing.get_args(tp) if a is not type(None)]
        return decode(args[0], value) if len(args) == 1 else value
    if dataclasses.is_dataclass(tp):
        hints = _hints(tp)
        kwargs = {f.name: decode(hints[f.name], value[f.name]) for f in dataclasses.fields(tp) if f.name in value}
        return tp(**kwargs)
    if origin is list:
        (arg,) = typing.get_args(tp) or (Any,)
        return [decode(arg, v) for v in value]
    if origin is tuple:
        args = typing.get_args(tp)
        if len(args) == 2 and args[1] is Ellipsis:
            return tuple(decode(args[0], v) for v in value)
        if args:
            return tuple(decode(a, v) for a, v in zip(args, value))
        return _tuples(value)
    if tp is tuple:
        return _tuples(value)
    if origin is dict:
        _, vt = typing.get_args(tp) or (str, Any)
        return {k: decode(vt, v) for k, v in value.items()}
    return value
