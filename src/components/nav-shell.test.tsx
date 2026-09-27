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
        session={{
          email: "admin@sunrise.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );

    expect(screen.getByText("admin@sunrise.test")).toBeInTheDocument();
    expect(screen.getByText("Admin · Sunrise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("hides Settings and Security from a RECEPTIONIST", () => {
    render(
      <NavShell
        session={{
          email: "reception@sunrise.test",
          role: "RECEPTIONIST",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument();
  });

  it("shows Security to a HOSPITAL_ADMIN and to a SUPER_ADMIN", () => {
    render(
      <NavShell
        session={{
          email: "admin@sunrise.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/account/security",
    );

    render(
      <NavShell
        session={{
          email: "super@platform.test",
          role: "SUPER_ADMIN",
          hospitalName: null,
          enabledModules: [],
        }}
        onSignOut={() => {}}
      />,
    );
    expect(screen.getAllByRole("link", { name: "Security" })[0]).toHaveAttribute(
      "href",
      "/account/security",
    );
  });

  it("hides USG from a hospital that hasn't enabled that module", () => {
    render(
      <NavShell
        session={{
          email: "admin@sunrise.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );

    expect(screen.queryByRole("link", { name: "USG" })).not.toBeInTheDocument();
  });

  it("shows both Settings and USG to a HOSPITAL_ADMIN whose centre has USG enabled", () => {
    render(
      <NavShell
        session={{
          email: "admin@wellspring.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Wellspring",
          enabledModules: ["GENERAL_OPD", "USG"],
        }}
        onSignOut={() => {}}
      />,
    );

    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "USG" })).toBeInTheDocument();
  });
});
