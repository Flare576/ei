import { hostname } from "node:os";

export function getMachineId(): string {
  return hostname().split(".")[0].toLowerCase();
}
