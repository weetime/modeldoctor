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
    // Skip values produced by custom parameter decorators (e.g. @CurrentUser
    // returning JwtPayload). Method-level @UsePipes(pipe) would otherwise run
    // this validator on every parameter, including @CurrentUser, and surface
    // misleading "Required" errors for fields that don't belong on the user
    // object. Body / query / param pipes still flow through.
    if (metadata.type === "custom") return value;
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
