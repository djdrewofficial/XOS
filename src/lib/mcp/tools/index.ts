import { coverageTools } from "./coverage";
import { officeTools } from "./office";
import { parityTools } from "./parity";
import { remainingTools } from "./remaining";

export const mcpTools = [...officeTools, ...coverageTools, ...parityTools, ...remainingTools];
