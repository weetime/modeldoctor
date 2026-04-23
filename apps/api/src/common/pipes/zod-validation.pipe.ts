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

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const first = result.error.issues[0];
    const path = first?.path.join(".") || "body";
    const message = first?.message || "Validation failed";
    throw new BadRequestException(`${path}: ${message}`);
  }
}
