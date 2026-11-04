// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolForm } from "../../components/tools/tool-form";

afterEach(cleanup);

async function fill(user: ReturnType<typeof userEvent.setup>, values: { name?: string; category?: string; condition?: string; description?: string }) {
  if (values.name !== undefined) await user.type(screen.getByLabelText(/tool name/i), values.name);
  if (values.category) await user.selectOptions(screen.getByLabelText(/category/i), values.category);
  if (values.condition) await user.selectOptions(screen.getByLabelText(/condition/i), values.condition);
  if (values.description !== undefined) await user.type(screen.getByLabelText(/description/i), values.description);
}

describe("ToolForm", () => {
  it("shows an error on every missing field and does not submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ToolForm submitLabel="List tool" pending={false} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "List tool" }));
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(screen.getByText("Description is required")).toBeTruthy();
    // "Choose a category" is also the placeholder option, so check the field's invalid state instead.
    expect(screen.getByLabelText(/category/i).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/condition/i).getAttribute("aria-invalid")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says a short description is too short rather than required", async () => {
    const user = userEvent.setup();
    render(<ToolForm submitLabel="List tool" pending={false} onSubmit={vi.fn()} />);
    await fill(user, { name: "Drill", category: "Power tools", condition: "Good", description: "tiny" });
    await user.click(screen.getByRole("button", { name: "List tool" }));
    expect(screen.getByText("Description must be at least 10 characters")).toBeTruthy();
  });

  it("marks invalid fields for assistive technology", async () => {
    const user = userEvent.setup();
    render(<ToolForm submitLabel="List tool" pending={false} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "List tool" }));
    expect(screen.getByLabelText(/tool name/i).getAttribute("aria-invalid")).toBe("true");
  });

  it("submits trimmed, validated values", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ToolForm submitLabel="List tool" pending={false} onSubmit={onSubmit} />);
    await fill(user, { name: "  Cordless drill  ", category: "Power tools", condition: "Good", description: "18V drill with two batteries." });
    await user.click(screen.getByRole("button", { name: "List tool" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Cordless drill", category: "Power tools", condition: "Good", description: "18V drill with two batteries." });
  });

  it("ignores submissions while a save is pending", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <ToolForm submitLabel="List tool" pending onSubmit={onSubmit} initialValues={{ name: "Drill", category: "Power tools", condition: "Good", description: "A perfectly good description." }} />,
    );
    expect(screen.getByRole("button", { name: /saving/i }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: /saving/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts from the initial values when editing", () => {
    render(<ToolForm submitLabel="Save changes" pending={false} onSubmit={vi.fn()} initialValues={{ name: "Old name", category: "Garden", condition: "Worn", description: "Existing description text." }} />);
    expect((screen.getByLabelText(/tool name/i) as HTMLInputElement).value).toBe("Old name");
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe("Garden");
  });
});
