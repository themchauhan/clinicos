import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavShell } from "./nav-shell";

describe("NavShell", () => {
  it("renders the product name and primary nav links", () => {
    render(<NavShell />);

    expect(screen.getByText("ClinicOS")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Patients" })).toHaveAttribute(
      "href",
      "/dashboard/patients",
    );
  });

  it("shows a sign-in link when signed out", () => {
    render(<NavShell />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows the signed-in user and a sign-out control when a session is given", () => {
    render(
      <NavShell
        session={{ email: "admin@sunrise.test", role: "HOSPITAL_ADMIN", hospitalName: "Sunrise" }}
        onSignOut={() => {}}
      />,
    );

    expect(screen.getByText("admin@sunrise.test")).toBeInTheDocument();
    expect(screen.getByText("Admin · Sunrise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });
});
