import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavShell } from "./nav-shell";

// A test that calls render() more than once (to compare two sessions)
// leaves both instances mounted -- click the most recently rendered
// "More" button, matching how such tests already pick the latest
// render's elements out of the accumulated DOM (e.g. getAllByRole(...)[0]
// below, ordered newest-first by NavShell's own internal DOM order).
function openMoreMenu() {
  const buttons = screen.getAllByRole("button", { name: /more/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

function openUserMenu() {
  const buttons = screen.getAllByRole("button", { name: "Account menu" });
  fireEvent.click(buttons[buttons.length - 1]);
}

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
          name: "Demo Admin",
          email: "admin@sunrise.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );

    // The compact trigger shows just the first name next to an avatar
    // -- full identity and sign-out live behind it.
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    openUserMenu();
    expect(screen.getByText("Demo Admin")).toBeInTheDocument();
    expect(screen.getByText("admin@sunrise.test")).toBeInTheDocument();
    expect(screen.getByText("Admin · Sunrise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("hides Settings and Security from a RECEPTIONIST, but still shows Connect a device", () => {
    render(
      <NavShell
        session={{
          name: "Demo Receptionist",
          email: "reception@sunrise.test",
          role: "RECEPTIONIST",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );
    openMoreMenu();

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a device" })).toHaveAttribute(
      "href",
      "/dashboard/devices",
    );
  });

  it("shows Security (in the More menu) to a HOSPITAL_ADMIN and to a SUPER_ADMIN", () => {
    render(
      <NavShell
        session={{
          name: "Demo Admin",
          email: "admin@sunrise.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Sunrise",
          enabledModules: ["GENERAL_OPD"],
        }}
        onSignOut={() => {}}
      />,
    );
    openMoreMenu();
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
      "href",
      "/account/security",
    );

    render(
      <NavShell
        session={{
          name: "Platform Admin",
          email: "super@platform.test",
          role: "SUPER_ADMIN",
          hospitalName: null,
          enabledModules: [],
        }}
        onSignOut={() => {}}
      />,
    );
    openMoreMenu();
    expect(screen.getAllByRole("link", { name: "Security" })[0]).toHaveAttribute(
      "href",
      "/account/security",
    );
  });

  it("hides Connect a device from a SUPER_ADMIN", () => {
    render(
      <NavShell
        session={{
          name: "Platform Admin",
          email: "super@platform.test",
          role: "SUPER_ADMIN",
          hospitalName: null,
          enabledModules: [],
        }}
        onSignOut={() => {}}
      />,
    );
    openMoreMenu();
    expect(screen.queryByRole("link", { name: "Connect a device" })).not.toBeInTheDocument();
  });

  it("hides USG from a hospital that hasn't enabled that module", () => {
    render(
      <NavShell
        session={{
          name: "Demo Admin",
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
          name: "Demo Admin",
          email: "admin@wellspring.test",
          role: "HOSPITAL_ADMIN",
          hospitalName: "Wellspring",
          enabledModules: ["GENERAL_OPD", "USG"],
        }}
        onSignOut={() => {}}
      />,
    );
    openMoreMenu();

    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "USG" })).toBeInTheDocument();
  });
});
