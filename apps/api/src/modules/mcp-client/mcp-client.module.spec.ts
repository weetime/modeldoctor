import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { McpClientModule } from "./mcp-client.module.js";
import { McpClientService } from "./mcp-client.service.js";

/**
 * Nest DI smoke test (Task 11 fold-in): the real container must resolve
 * `McpClientService` through `McpClientModule` — exercising the
 * `@Optional() @Inject(MCP_CLIENT_FACTORY)` constructor path, which the
 * plain-`new` unit specs in `mcp-client.service.spec.ts` never touch since
 * they always pass an explicit factory.
 */
describe("McpClientModule (Nest DI)", () => {
  it("resolves McpClientService with the default client factory (no MCP_CLIENT_FACTORY provider)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [McpClientModule],
    }).compile();

    const service = moduleRef.get(McpClientService);

    expect(service).toBeInstanceOf(McpClientService);

    await moduleRef.close();
  });
});
