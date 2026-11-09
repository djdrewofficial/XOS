import { coverageTools } from "./coverage";
import { officeTools } from "./office";
import { parityTools } from "./parity";

export const mcpTools = [...officeTools, ...coverageTools, ...parityTools];
