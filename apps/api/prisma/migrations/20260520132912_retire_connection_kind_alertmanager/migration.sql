-- Enum-narrowing carve-out (per CLAUDE.md): connectionKindSchema dropped
-- "alertmanager" in #218. Pre-existing rows tagged with that kind become
-- orphans that fail zod parse on every list/detail read, so a one-off DML
-- delete alongside the enum narrowing is the required data fixup.
--
-- No schema change accompanies this migration — Alertmanager was already
-- modeled as just an extra Connection.kind value with a baseUrl column;
-- removing it is purely a data-and-contract change.
DELETE FROM "connections" WHERE kind = 'alertmanager';
