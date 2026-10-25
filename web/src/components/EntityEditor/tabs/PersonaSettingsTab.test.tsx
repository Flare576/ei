import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PersonaSettingsTab } from "./PersonaSettingsTab";
import type { PersonaEntity } from "../../../../../src/core/types";

function makePersona(extra: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "Ada",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("PersonaSettingsTab thinking toggle", () => {
  it("shows the toggle checked when the setting was never stored, since absent means on", () => {
    render(<PersonaSettingsTab persona={makePersona()} onChange={() => {}} />);

    expect(screen.getByRole("checkbox", { name: /Show Thinking/ })).toBeChecked();
  });

  it("shows the toggle unchecked only for an explicit false", () => {
    render(<PersonaSettingsTab persona={makePersona({ show_thinking: false })} onChange={() => {}} />);

    expect(screen.getByRole("checkbox", { name: /Show Thinking/ })).not.toBeChecked();
  });

  it("writes the opposite boolean to show_thinking when toggled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PersonaSettingsTab persona={makePersona()} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Show Thinking/ }));
    expect(onChange).toHaveBeenLastCalledWith("show_thinking", false);

    rerender(<PersonaSettingsTab persona={makePersona({ show_thinking: false })} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Show Thinking/ }));
    expect(onChange).toHaveBeenLastCalledWith("show_thinking", true);
  });
});

describe("PersonaSettingsTab heartbeat minimum", () => {
  const field = () => screen.getByLabelText("Heartbeat Length (minutes)");

  it.each([["0"], ["-5"], ["4"]])("never writes %s minutes for a non-static persona and alerts on blur", (input) => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onChange = vi.fn();
    render(<PersonaSettingsTab persona={makePersona()} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: input } });
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalledWith("heartbeat_delay_ms", expect.anything());
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("at least 5 minute"));
  });

  it("writes exactly 5 minutes as milliseconds", () => {
    const onChange = vi.fn();
    render(<PersonaSettingsTab persona={makePersona()} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith("heartbeat_delay_ms", 300000);
  });

  it("a static persona with a stored 0 renders and is not rewritten or alerted just by opening/blurring", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onChange = vi.fn();
    render(<PersonaSettingsTab persona={makePersona({ is_static: true, heartbeat_delay_ms: 0 })} onChange={onChange} />);
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalledWith("heartbeat_delay_ms", expect.anything());
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("a static persona may still be edited to a value under the minimum (heartbeat is inert for static personas)", () => {
    const onChange = vi.fn();
    render(<PersonaSettingsTab persona={makePersona({ is_static: true, heartbeat_delay_ms: 0 })} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith("heartbeat_delay_ms", 120000);
  });
});
