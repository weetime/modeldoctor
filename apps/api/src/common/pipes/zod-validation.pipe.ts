import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // When applied at the method level via @UsePipes, NestJS invokes the
    // pipe for every parameter (body, params, query, custom decorators
    // like @CurrentUser). Validate only the request body — other params
    // (e.g. JwtPayload from @CurrentUser) pass through unchanged.
    if (metadata.type !== "body") return value;
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const first = result.error.issues[0];
    const path = first?.path.join(".") || "body";
    const message = first?.message || "Validation failed";
    throw new BadRequestException({
      message: `${path}: ${message}`,
      details: result.error.issues,
    });
  }
}
