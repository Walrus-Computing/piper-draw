import type { Block } from "../types";

export interface ValidationErrorItem {
  position: [number, number, number] | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
}

export async function validateDiagram(
  blocks: Map<string, Block>,
): Promise<ValidationResult> {
  const payload = Array.from(blocks.values()).map((b) => ({
    pos: [b.pos.x, b.pos.y, b.pos.z],
    type: b.type,
  }));

  try {
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: payload }),
    });
    if (!res.ok) {
      return {
        valid: false,
        errors: [{ position: null, message: `Server error: ${res.status}` }],
      };
    }
    return (await res.json()) as ValidationResult;
  } catch {
    return {
      valid: false,
      errors: [
        {
          position: null,
          message: "Verification server not available. Start with: npm run dev",
        },
      ],
    };
  }
}
