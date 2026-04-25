import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CheckVegetaResponse } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";

const execP = promisify(exec);

@Injectable()
export class HealthService {
  async checkVegeta(): Promise<CheckVegetaResponse> {
    try {
      const { stdout } = await execP("which vegeta");
      const path = stdout.trim();
      if (!path) {
        return {
          installed: false,
          message: "Vegeta is not installed. Please install it first.",
          path: null,
        };
      }
      return { installed: true, message: "Vegeta is installed", path };
    } catch {
      return {
        installed: false,
        message: "Vegeta is not installed. Please install it first.",
        path: null,
      };
    }
  }
}
