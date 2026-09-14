import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MapScreen, originColor, popupHtml } from "./MapScreen";
import { login, resetSessionForTests } from "../../lib/session";

vi.mock("maplibre-gl", () => {
  class StubMarker {
    setLngLat(): this {
      return this;
    }
    setPopup(): this {
      return this;
    }
    addTo(): this {
      return this;
    }
    remove(): void {
      // No-op stub.
    }
  }
  class StubPopup {
    setHTML(): this {
      return this;
    }
  }
  class StubBounds {
    extend(): void {
      // No-op stub.
    }
  }
  class StubMap {
    loaded(): boolean {
      return true;
    }
    getSource(): undefined {
      return undefined;
    }
    addSource(): void {
      // No-op stub.
    }
    addLayer(): void {
      // No-op stub.
    }
    setCenter(): void {
      // No-op stub.
    }
    setZoom(): void {
      // No-op stub.
    }
    fitBounds(): void {
      // No-op stub.
    }
    once(): void {
      // No-op stub.
    }
    remove(): void {
      // No-op stub.
    }
  }
  return {
    default: {
      Marker: StubMarker,
      Popup: StubPopup,
      LngLatBounds: StubBounds,
      Map: StubMap,
      addProtocol: (): void => undefined,
    },
  };
});

const POINTS = [
  {
    ts: "2025-11-02T10:00:00.000Z",
    clock: "case",
    lat: 19.076,
    lon: 72.8777,
    origin: "cdr",
    accuracy_m: 50,
    provenance: "collected",
    source_file_id: "f1",
    camera_id: null,
    declared_start_ts: null,
  },
  {
    ts: "2025-11-02T13:00:00.000Z",
    clock: "case",
    lat: 19.0761,
    lon: 72.8778,
    origin: "cctv",
    accuracy_m: null,
    provenance: "collected",
    source_file_id: null,
    camera_id: "cam-1",
    declared_start_ts: "2025-11-02T09:00:00.000Z",
  },
];

const ROUTINE = {
  clusters: [
    {
      area: "19.07°, 72.87°",
      lat: 19.07,
      lon: 72.87,
      visit_count: 12,
      confidence_pct: 80,
      typical_window: "Sun 12:00–14:00",
      low_data: false,
    },
    {
      area: "18.52°, 73.85°",
      lat: 18.52,
      lon: 73.85,
      visit_count: 3,
      confidence_pct: 20,
      typical_window: null,
      low_data: true,
    },
  ],
  total_points: 15,
};

function stubMovement(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes("/auth/v1/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "test-jwt",
              user: { id: "officer-1", email: "officer@example.test", app_metadata: { app_role: "io" } },
            }),
            { status: 200 },
          ),
        );
      }
      if (target.includes("/cases/case-1/entities")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: "e1",
                  type: "PERSON",
                  canonical_name: "Ravi Kumar",
                  identifiers: [],
                  case_count: 1,
                  provenance: "collected",
                  sync_state: "synced",
                },
              ],
              next_cursor: null,
            }),
            { status: 200 },
          ),
        );
      }
      if (target.includes("/entities/e1/timeline")) {
        return Promise.resolve(
          new Response(JSON.stringify({ results: POINTS, next_cursor: null }), { status: 200 }),
        );
      }
      if (target.includes("/entities/e1/routine")) {
        return Promise.resolve(new Response(JSON.stringify(ROUTINE), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("map screen", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
    // NOTE: vi.stubEnv does not reach the casted import.meta.env reads,
    // so the map instance stays absent here and these tests cover list,
    // strip, routine and popup-copy behavior — not live rendering.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selecting a person loads timeline marks and routine clusters", async () => {
    stubMovement();
    await login("officer@example.test", "password");
    render(<MapScreen caseId="case-1" />);
    fireEvent.click(await screen.findByText("Ravi Kumar"));
    // Two timeline strip marks (titles carry timestamp + origin).
    expect(await screen.findByTitle("2025-11-02T10:00:00.000Z · cdr")).toBeTruthy();
    expect(screen.getByTitle("2025-11-02T13:00:00.000Z · cctv")).toBeTruthy();
    // Routine panel: counts prominent, low-data badge, window note.
    expect(await screen.findByText("19.07°, 72.87°")).toBeTruthy();
    expect(screen.getByText("80% confidence · 12 visits")).toBeTruthy();
    expect(screen.getByText("Low data")).toBeTruthy();
    expect(screen.getByText("Typically present Sun 12:00–14:00")).toBeTruthy();
  });

  it("dragging the strip filters the map to a range", async () => {
    stubMovement();
    await login("officer@example.test", "password");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 48,
      width: 100,
      height: 48,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    render(<MapScreen caseId="case-1" />);
    fireEvent.click(await screen.findByText("Ravi Kumar"));
    await screen.findByTitle("2025-11-02T13:00:00.000Z · cctv");
    const strip = screen.getByLabelText("Time range filter: drag to filter the map");
    fireEvent.pointerDown(strip, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 90, pointerId: 1 });
    fireEvent.pointerUp(strip, { pointerId: 1 });
    expect(await screen.findByText("Reset range")).toBeTruthy();
  });

  it("popup copy anchors appropriately and never invents", () => {
    const camera = popupHtml(
      {
        ts: "2025-11-02T13:00:00.000Z",
        clock: "case",
        lat: 0,
        lon: 0,
        origin: "cctv",
        accuracy_m: null,
        provenance: "collected",
        source_file_id: null,
        camera_id: "cam-1",
        declared_start_ts: "2025-11-02T09:00:00.000Z",
      },
      false,
    );
    expect(camera).toContain("CASE TIME");
    expect(camera).toContain("2025-11-02T09:00:00.000Z");
    const file = popupHtml(
      {
        ts: "2025-11-02T10:00:00.000Z",
        clock: "case",
        lat: 0,
        lon: 0,
        origin: "cdr",
        accuracy_m: 50,
        provenance: "collected",
        source_file_id: "01234567-89ab-cdef-0123-456789abcdef",
        camera_id: null,
        declared_start_ts: null,
      },
      false,
    );
    expect(file).toContain("Source file: 01234567");
    expect(file).toContain("±50m");
    expect(originColor("cctv")).toBe("#D8665C");
    expect(originColor("something-new")).toBe("#A5A29A");
  });
});
