import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SimplePager } from "./simple-pager";

describe("SimplePager", () => {
  it("renders nothing for a single page with no next page", () => {
    const { container } = render(
      <SimplePager page={1} pageSize={50} shown={12} hasNext={false} basePath="/x" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the next page (and keeps extra params) when more rows exist", () => {
    render(
      <SimplePager
        page={1}
        pageSize={50}
        shown={50}
        hasNext
        basePath="/dashboard/patients"
        extraParams={{ when: "all" }}
      />,
    );
    expect(screen.getByText("Showing 1–50")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/dashboard/patients?when=all&page=2",
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
  });

  it("offers Previous on later pages and disables Next on the last one", () => {
    render(<SimplePager page={3} pageSize={50} shown={7} hasNext={false} basePath="/x" />);
    expect(screen.getByText("Showing 101–107")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/x?page=2");
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });
});
