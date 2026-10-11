import { describe, it, expect } from "vitest";
import { TOOLS_RAN_NO_REPLY_SILENCE_REASON as fromBarrel } from "../../../src/core/types.js";
import { TOOLS_RAN_NO_REPLY_SILENCE_REASON as fromLeaf } from "../../../src/core/types/tool-calls.js";

describe("TOOLS_RAN_NO_REPLY_SILENCE_REASON export identity", () => {
  it("is the identical non-empty string from the types barrel and from its leaf module", () => {
    expect(typeof fromLeaf).toBe("string");
    expect(fromLeaf.length).toBeGreaterThan(0);
    expect(fromBarrel).toBe(fromLeaf);
  });
});
