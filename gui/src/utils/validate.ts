import type { Block } from "../types";

export interface ValidationErrorItem {
  position: [number, number, number] | null;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
  /**
   * Set when the failure was transport-level (server unreachable or non-2xx),
   * not a semantic TQEC violation. Lets callers render distinct UI for
   * "your fixture is broken" vs "the verifier isn't running".
   */
  transportError?: boolean;
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
        transportError: true,
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
      transportError: true,
    };
  }
}
