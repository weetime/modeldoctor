import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { ConnectionService } from "../connection/connection.service.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { EvaluationsController } from "./controllers/evaluations.controller.js";
import { RunsController } from "./controllers/runs.controller.js";
import { EndpointCaller } from "./endpoint-caller.js";
import { type JudgeRegistry, createJudgeRegistry } from "./judges/registry.js";
import { EvaluationsRepository } from "./repositories/evaluations.repository.js";
import { RunsRepository } from "./repositories/runs.repository.js";
import { EvaluationsService } from "./services/evaluations.service.js";
import { QualityGateRunExecutor } from "./services/run-executor.service.js";
import { RunsService } from "./services/runs.service.js";

@Module({
  imports: [ConnectionModule, LlmJudgeModule],
  controllers: [EvaluationsController, RunsController],
  providers: [
    // All quality-gate classes use `import type` for their dependencies, which
    // causes TypeScript to erase the token at runtime (emitting Object/Function).
    // We wire every provider explicitly via useFactory so NestJS gets concrete
    // class references as injection tokens.

    {
      provide: EvaluationsRepository,
      useFactory: (prisma: PrismaService) => new EvaluationsRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: RunsRepository,
      useFactory: (prisma: PrismaService) => new RunsRepository(prisma),
      inject: [PrismaService],
    },
    {
      provide: EvaluationsService,
      useFactory: (repo: EvaluationsRepository) => new EvaluationsService(repo),
      inject: [EvaluationsRepository],
    },

    // EndpointCaller needs a ConnectionsServiceLike with
    // findByIdWithDecryptedKey(id, userId). We adapt ConnectionService.getOwnedDecrypted
    // which has the same semantics but reversed argument order.
    {
      provide: EndpointCaller,
      useFactory: (connections: ConnectionService): EndpointCaller => {
        const adapter = {
          findByIdWithDecryptedKey: (id: string, userId: string) =>
            connections.getOwnedDecrypted(userId, id).catch(() => null),
        };
        return new EndpointCaller(adapter);
      },
      inject: [ConnectionService],
    },

    // JUDGE_REGISTRY factory: adapts LlmJudgeService (global provider config) +
    // chatCompletion (llm-client) into the LlmJudgeService interface that
    // createJudgeRegistry / createLlmJudge expect.
    {
      provide: "JUDGE_REGISTRY",
      useFactory: (llmJudge: LlmJudgeService): JudgeRegistry =>
        createJudgeRegistry({
          runJudge: async (input) => {
            const provider = await llmJudge.getDecrypted();
            if (!provider || !provider.enabled) {
              throw new Error(
                "No enabled LLM judge provider configured. Configure one at Settings → LLM Judge.",
              );
            }
            const result = await chatCompletion(
              { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model },
              [
                { role: "system", content: input.systemPrompt },
                { role: "user", content: input.userPrompt },
              ],
              { jsonMode: true },
            );
            return { content: result.content };
          },
        }),
      inject: [LlmJudgeService],
    },

    // QualityGateRunExecutor: RunsRepository + EndpointCaller are import type,
    // and JudgeRegistry uses the "JUDGE_REGISTRY" string token — all wired explicitly.
    {
      provide: QualityGateRunExecutor,
      useFactory: (
        repo: RunsRepository,
        endpointCaller: EndpointCaller,
        judges: JudgeRegistry,
      ): QualityGateRunExecutor => new QualityGateRunExecutor(repo, endpointCaller, judges),
      inject: [RunsRepository, EndpointCaller, "JUDGE_REGISTRY"],
    },

    // RunsService: all constructor params are import type — wire via factory.
    // ConnectionService uses (userId, id) order; ConnectionsLike wants (id, userId).
    {
      provide: RunsService,
      useFactory: (
        repo: RunsRepository,
        evaluations: EvaluationsService,
        connections: ConnectionService,
        executor: QualityGateRunExecutor,
      ): RunsService => {
        const connectionsAdapter = {
          findById: (id: string, userId: string) =>
            connections.findOwnedPublic(userId, id).catch(() => null),
        };
        return new RunsService(repo, evaluations, connectionsAdapter, executor);
      },
      inject: [RunsRepository, EvaluationsService, ConnectionService, QualityGateRunExecutor],
    },
  ],
  exports: [EvaluationsService, RunsService],
})
export class QualityGateModule {}
