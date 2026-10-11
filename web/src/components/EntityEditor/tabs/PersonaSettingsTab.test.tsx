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
  } as unknown as PersonaEntity;
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
