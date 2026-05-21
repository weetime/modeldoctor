-- Enum-narrowing carve-out (per CLAUDE.md): `serverKindSchema` no longer
-- accepts "higress" (it's a gateway, not an engine; gateway presence now
-- surfaces as a tag — see inferTags + deriveGatewayHints). Existing rows
-- with server_kind='higress' would fail zod parse on every Connection
-- read, so coerce them to NULL ("unknown engine") here. NULL is a
-- legitimate, contract-accepted state — operators pick the actual engine
-- afterward, or leave it blank for gateway-fronted connections where the
-- backend engine isn't observable.
UPDATE "connections" SET "server_kind" = NULL WHERE "server_kind" = 'higress';
