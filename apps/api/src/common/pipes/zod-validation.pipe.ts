import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

// ═══════════════════════════════════════════════════
// Validates request values against a Zod schema from
// @eventai/validation and returns the parsed data.
// ═══════════════════════════════════════════════════

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const flattened = result.error.flatten();
      throw new BadRequestException({
        message: 'Validation failed',
        errors: flattened.fieldErrors,
      });
    }
    return result.data;
  }
}
