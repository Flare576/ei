import { describe, it, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { MaskedInput, type MaskedInputHandle } from "../../src/components/MaskedInput";

const MASK_CHAR = "•";

describe("MaskedInput", () => {
  it("masks every typed character and never renders the plaintext", async () => {
    let handle: MaskedInputHandle | undefined;
    const frames: string[] = [];
    const plaintext = "hunter2!S";

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <MaskedInput ref={(h) => (handle = h)} focused />,
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      frames.push(captureCharFrame());

      for (const char of plaintext) {
        await mockInput.typeText(char);
        await renderOnce();
        frames.push(captureCharFrame());
      }

      // Real value was tracked correctly the whole time.
      expect(handle?.getValue()).toBe(plaintext);

      // No rendered frame — at any point during typing — ever contained the
      // plaintext or any individual plaintext character run.
      for (const frame of frames) {
        expect(frame.includes(plaintext)).toBe(false);
      }
      for (const char of new Set(plaintext)) {
        for (const frame of frames) {
          expect(frame.includes(char)).toBe(false);
        }
      }

      // The final frame shows exactly one mask char per typed character.
      const finalFrame = frames[frames.length - 1];
      expect(finalFrame.includes(MASK_CHAR.repeat(plaintext.length))).toBe(true);
    } finally {
      renderer.destroy();
    }
  });

  it("setValue('') clears both the internal value and the rendered mask", async () => {
    let handle: MaskedInputHandle | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <MaskedInput ref={(h) => (handle = h)} focused />,
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      await mockInput.typeText("secret");
      await renderOnce();

      expect(handle?.getValue()).toBe("secret");
      expect(captureCharFrame().includes(MASK_CHAR.repeat(6))).toBe(true);

      handle?.setValue("");
      await renderOnce();

      expect(handle?.getValue()).toBe("");
      expect(captureCharFrame().includes(MASK_CHAR)).toBe(false);
    } finally {
      renderer.destroy();
    }
  });

  it("getValue() returns the real string typed, independent of display", async () => {
    let handle: MaskedInputHandle | undefined;

    const { renderOnce, mockInput, renderer } = await testRender(
      () => <MaskedInput ref={(h) => (handle = h)} focused />,
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      await mockInput.typeText("Pa55w0rd With Space");
      await renderOnce();

      expect(handle?.getValue()).toBe("Pa55w0rd With Space");

      mockInput.pressBackspace();
      mockInput.pressBackspace();
      await renderOnce();

      expect(handle?.getValue()).toBe("Pa55w0rd With Spa");
    } finally {
      renderer.destroy();
    }
  });

  it("ignores keystrokes while unfocused", async () => {
    let handle: MaskedInputHandle | undefined;

    const { renderOnce, mockInput, renderer } = await testRender(
      () => <MaskedInput ref={(h) => (handle = h)} focused={false} />,
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      await mockInput.typeText("ignored");
      await renderOnce();

      expect(handle?.getValue()).toBe("");
    } finally {
      renderer.destroy();
    }
  });

  it("masks pasted text too, never exposing it in a rendered frame", async () => {
    let handle: MaskedInputHandle | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <MaskedInput ref={(h) => (handle = h)} focused />,
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      await mockInput.pasteBracketedText("sk-pasted-secret");
      await renderOnce();

      expect(handle?.getValue()).toBe("sk-pasted-secret");
      const frame = captureCharFrame();
      expect(frame.includes("sk-pasted-secret")).toBe(false);
      expect(frame.includes(MASK_CHAR.repeat("sk-pasted-secret".length))).toBe(true);
    } finally {
      renderer.destroy();
    }
  });

  it("calls onSubmit with the real value on Enter", async () => {
    let handle: MaskedInputHandle | undefined;
    let submitted: string | undefined;

    const { renderOnce, mockInput, renderer } = await testRender(
      () => (
        <MaskedInput
          ref={(h) => (handle = h)}
          focused
          onSubmit={(value) => {
            submitted = value;
          }}
        />
      ),
      { width: 40, height: 3 }
    );

    try {
      await renderOnce();
      await mockInput.typeText("done");
      mockInput.pressEnter();
      await renderOnce();

      expect(submitted).toBe("done");
      expect(handle?.getValue()).toBe("done");
    } finally {
      renderer.destroy();
    }
  });
});
