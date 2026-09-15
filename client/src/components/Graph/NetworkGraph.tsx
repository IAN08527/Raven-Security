import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useRef } from "react";
import type { GraphEdge, GraphEntityType, GraphNode } from "../../types/api";

cytoscape.use(fcose);

/** fCoSE options we rely on. The layout itself is untyped
 *  third-party (`cytoscape-fcose` ships no types), so options travel as
 *  a plain record cast once at the `cy.layout` call below. */
interface FcoseOptions {
  name: "fcose";
  randomize: boolean;
  animate: boolean;
  fit: boolean;
  padding: number;
  nodeDimensionsIncludeLabels: boolean;
  idealEdgeLength: number;
}

export const NODE_STYLE: Record<GraphEntityType, { shape: string; color: string }> = {
  PERSON: { shape: "hexagon", color: "#D8665C" },
  ORGANIZATION: { shape: "octagon", color: "#D89A45" },
  ACCOUNT: { shape: "hexagon", color: "#C9A653" },
  LOCATION: { shape: "diamond", color: "#4FAE79" },
  VEHICLE: { shape: "round-rectangle", color: "#8273A8" },
};

// EntityDetail carries `type` as a plain string (the server stores the
// validated value but the wire type is unconstrained), so indexing
// NODE_STYLE with it needs a fallback for values outside the five
// contracted types. Unknown types render neutral grey rather than
// crashing the panel — a display default, never stored data.
const UNKNOWN_STYLE = { shape: "ellipse", color: "#706E68" };

export function nodeStyleFor(type: string): { shape: string; color: string } {
  return (NODE_STYLE as Record<string, { shape: string; color: string }>)[type] ?? UNKNOWN_STYLE;
}

const TRANSITION_S = 0.18; // 180ms selection/isolate transitions; cytoscape takes seconds

interface NetworkGraphProps {
  caseId: string;
  payload: { nodes: GraphNode[]; edges: GraphEdge[] };
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isolatedNodeId: string | null;
  onNodeSelect: (id: string | null) => void;
  onEdgeSelect: (id: string | null) => void;
  /** Receives the export filename for the audit trail. */
  onExported?: (filename: string) => void;
}

/**
 * M4-T5. Person-centric network (D23) on Cytoscape.js + fCoSE. Layout
 * runs with animation off, always: the first run starts from a
 * deterministic grid (never a degenerate all-zero stack), positions are
 * cached, and later runs restart from the cache -- filtering re-queries
 * data but never re-randomises the picture. The ONLY transitions are
 * the 180ms selection ring and the 180ms isolate dimming; nothing
 * animates continuously and layout never animates on filter change.
 */
export function NetworkGraph({
  caseId,
  payload,
  selectedNodeId,
  selectedEdgeId,
  isolatedNodeId,
  onNodeSelect,
  onEdgeSelect,
  onExported,
}: NetworkGraphProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const firstLayoutDone = useRef(false);
  const callbacksRef = useRef({ onNodeSelect, onEdgeSelect });
  callbacksRef.current = { onNodeSelect, onEdgeSelect };

  /** PNG export (M4-T5): renders off the live canvas and downloads as
   *  `Raven_Graph_{case_id}_{date}.png`. The date is wall-clock
   *  filename metadata, not case data. Resolves the filename for the
   *  audit trail. */
  const exportPng = async (): Promise<string> => {
    const cy = cyRef.current;
    if (!cy) throw new Error("graph not ready");
    const date = new Date().toISOString().slice(0, 10);
    const filename = `Raven_Graph_${caseId}_${date}.png`;
    const dataUrl = cy.png({ bg: "#151514", full: true, scale: 2 }) as string;
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return filename;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            color: "#E8E5DD",
            "font-size": 10,
            "text-valign": "bottom",
            "text-margin-y": 4,
            "border-width": 0,
            "transition-property": "border-width, border-color, opacity",
            "transition-duration": TRANSITION_S,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 3,
            "border-color": "#E8E5DD",
            "transition-property": "border-width, border-color, opacity",
            "transition-duration": TRANSITION_S,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#4A4945",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#4A4945",
            "curve-style": "bezier",
            "transition-property": "opacity, line-color",
            "transition-duration": TRANSITION_S,
          },
        },
        {
          selector: "edge:selected",
          style: {
            width: 3,
            "line-color": "#E8E5DD",
            "target-arrow-color": "#E8E5DD",
            "transition-property": "opacity, line-color",
            "transition-duration": TRANSITION_S,
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.08 },
        },
      ],
    });
    cyRef.current = cy;
    cy.on("tap", "node", (event: cytoscape.EventObject) => {
      callbacksRef.current.onNodeSelect(event.target.id() as string);
    });
    cy.on("tap", "edge", (event: cytoscape.EventObject) => {
      callbacksRef.current.onEdgeSelect(event.target.id() as string);
    });
    cy.on("tap", (event: cytoscape.EventObject) => {
      if (event.target === cy) {
        callbacksRef.current.onNodeSelect(null);
        callbacksRef.current.onEdgeSelect(null);
      }
    });
    return () => {
      cyRef.current = null;
      cy.destroy();
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      for (const node of payload.nodes) {
        const visual = NODE_STYLE[node.type];
        const cached = positionsRef.current.get(node.id);
        cy.add({
          group: "nodes",
          data: { id: node.id, label: node.label, nodeType: node.type },
          position: cached ?? { x: 0, y: 0 },
          style: { shape: visual.shape, "background-color": visual.color },
        });
      }
      for (const edge of payload.edges) {
        cy.add({
          group: "edges",
          data: { id: edge.id, source: edge.src, target: edge.dst, label: edge.type },
        });
      }
      if (!firstLayoutDone.current) {
        // Deterministic grid seed: the only run without cached
        // positions, so the start is spread out rather than stacked.
        const nodes = cy.nodes();
        const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
        nodes.forEach((node, index) => {
          node.position({
            x: (index % columns) * 120,
            y: Math.floor(index / columns) * 120,
          });
        });
      } else {
        for (const [id, position] of positionsRef.current) {
          const node = cy.getElementById(id);
          if (node.nonempty()) node.position(position);
        }
      }
    });
    const options: FcoseOptions = {
      name: "fcose",
      randomize: false,
      animate: false,
      fit: true,
      padding: 40,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: 120,
    };
    const layout = cy.layout(options as unknown as cytoscape.LayoutOptions);
    layout.one("layoutstop", () => {
      cy.nodes().forEach((node) => {
        const position = node.position();
        positionsRef.current.set(node.id(), { x: position.x, y: position.y });
      });
      firstLayoutDone.current = true;
    });
    layout.run();
  }, [payload]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().unselect();
      cy.edges().unselect();
      if (selectedNodeId) {
        const node = cy.getElementById(selectedNodeId);
        if (node.nonempty() && node.isNode()) node.select();
      }
      if (selectedEdgeId) {
        const edge = cy.getElementById(selectedEdgeId);
        if (edge.nonempty() && edge.isEdge()) edge.select();
      }
    });
  }, [selectedNodeId, selectedEdgeId, payload]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("dimmed");
      if (isolatedNodeId) {
        const center = cy.getElementById(isolatedNodeId);
        if (center.nonempty()) {
          const keep = center.closedNeighborhood();
          cy.elements().not(keep).addClass("dimmed");
        }
      }
    });
  }, [isolatedNodeId, payload]);

  return (
    <div className="flex h-full w-full flex-col bg-[#151514]">
      <div className="flex shrink-0 items-center justify-end border-b border-[#30302D] px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            void exportPng().then((filename) => onExported?.(filename));
          }}
          className="rounded-sm bg-[#262624] px-3 py-1 text-xs font-semibold text-[#A5A29A]"
        >
          Export PNG
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
