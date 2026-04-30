import { Module } from "@nestjs/common";
import { AudioController } from "./audio.controller.js";
import { AudioService } from "./audio.service.js";
import { ChatController } from "./chat.controller.js";
import { ChatService } from "./chat.service.js";
import { EmbeddingsController } from "./embeddings.controller.js";
import { EmbeddingsService } from "./embeddings.service.js";
import { ImagesController } from "./images.controller.js";
import { ImagesService } from "./images.service.js";
import { RerankController } from "./rerank.controller.js";
import { RerankService } from "./rerank.service.js";

@Module({
  controllers: [
    ChatController,
    EmbeddingsController,
    RerankController,
    ImagesController,
    AudioController,
  ],
  providers: [ChatService, EmbeddingsService, RerankService, ImagesService, AudioService],
})
export class PlaygroundModule {}
