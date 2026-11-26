import uuid

from pino_kernel import ids


def test_symbol_uuid_is_uuid5_of_key():
    assert ids.symbol_uuid("U1") == str(uuid.uuid5(ids.NAMESPACE, "symbol/U1"))
    assert ids.footprint_path("pullup") == "/" + ids.symbol_uuid("pullup")
    assert len({ids.symbol_uuid("U1"), ids.footprint_uuid("U1"), ids.sheet_uuid()}) == 3
